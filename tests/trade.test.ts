// 5a 트레이드(D-130·D-131·D-132): 사전 등록 ①~④ AI 평가 기준, 거래 기간, 세션 과금(첫 제안만 행동력 1, 세션당 3회),
// 명령 식별자 재전송(⑥), 수락 시 양 구단 일괄 이적·현금·선수단 규칙, 역제안 수락 무비용, 상대 선수 히든·실제 능력 비공개
import { describe, expect, it } from 'vitest';
import { TRADE } from '../src/engine/config';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth } from '../src/engine/types';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkRosterComposition, checkRosterLimits } from '../src/host/invariants';
import type { TradeOps } from '../src/game/trade';
import type { GameMeta } from '../src/game/ports';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const EOK = 100_000_000;
type Svc = { trades: TradeOps; meta: () => GameMeta };
const svc = (d: Dispatcher) => (d as unknown as { service: Svc }).service;

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('트레이드 (5a)', () => {
  it.each(['trade-eval', 'trade-eval-2'])('사전 등록 ①~④(D-133: 두 시드 모두): %s', async (seed) => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 3, saveName: 't', seed });
      await until(d, '2026-11-16');
      const s = svc(d);
      const meta = s.meta();
      const players = d.saves.repository().getPlayers();
      const ok = (p: PlayerTruth, club: number) => s.trades.tradableReason(meta, p, club) === null;
      const ours = players.filter((p) => p.clubId === 3 && ok(p, 3));
      const rng = Rng.derive(`${seed}-test`, 1);
      const buckets: Record<'fair' | 'high' | 'low', [number, number]> = { fair: [0, 0], high: [0, 0], low: [0, 0] };
      const best: number[] = [];
      for (const c of d.saves.repository().getClubs()) {
        if (c.id === 3) continue;
        const theirs = players.filter((p) => p.clubId === c.id && ok(p, c.id));
        let top = 0;
        for (let i = 0; i < 300; i++) {
          const a = rng.pick(ours);
          const b = rng.pick(theirs);
          const va = s.trades.truthValue(meta, a);
          const vb = s.trades.truthValue(meta, b);
          const accepted = s.trades.evaluate(meta, c.id, { give: [a.id], get: [b.id], cashWon: 0 }).decision.kind === 'accept';
          if (accepted && va > 0 && vb > 0) top = Math.max(top, vb / va);
          if (va < EOK || vb < EOK) continue;
          const ratio = va / vb;
          const k = ratio >= 0.95 && ratio <= 1.05 ? 'fair' : ratio >= 1.4 ? 'high' : ratio <= 0.75 ? 'low' : null;
          if (k) {
            buckets[k][0]++;
            if (accepted) buckets[k][1]++;
          }
        }
        if (top > 0) best.push(top);
      }
      const rate = (b: number[]) => b[1]! / b[0]!;
      const exploit = best.reduce((a, b) => a + b, 0) / best.length;
      console.log(JSON.stringify({ seed, D132: { fair: { n: buckets.fair[0], rate: rate(buckets.fair) }, high: { n: buckets.high[0], rate: rate(buckets.high) }, low: { n: buckets.low[0], rate: rate(buckets.low) }, exploitMean: exploit, clubs: best.length } }));
      expect(buckets.fair[0]).toBeGreaterThan(20);
      expect(rate(buckets.fair)).toBeGreaterThanOrEqual(0.05);
      expect(rate(buckets.fair)).toBeLessThanOrEqual(0.5);
      expect(rate(buckets.high)).toBeGreaterThanOrEqual(0.7);
      expect(rate(buckets.low)).toBeLessThanOrEqual(0.05);
      expect(exploit).toBeLessThanOrEqual(1.5);
    } finally {
      d.close();
      cleanup(dir);
    }
  });

  it('기간·세션 과금·명령 식별자·일괄 이적·역제안·정보 경계', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'trade-flow' });
      const repo = d.saves.repository();
      const s = svc(d);
      const players = repo.getPlayers();
      const mine = players.filter((p) => p.clubId === 3);
      const other = players.filter((p) => p.clubId === 6);
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);

      // 시즌 마감 단계(K+5 전)에는 거래 불가, 비용 없음
      const ap0 = await ap();
      const early = await d.respond('trade.propose', { clubId: 6, give: [mine[0]!.id], get: [other[0]!.id], cashWon: 0, commandId: 'early-0001' });
      expect(early.ok).toBe(false);
      expect(await ap()).toBe(ap0);

      await until(d, '2026-11-16');
      const meta = s.meta();
      const tradable = (p: PlayerTruth, c: number) => s.trades.tradableReason(meta, p, c) === null;
      const ours = mine.filter((p) => tradable(p, 3));
      const theirs = other.filter((p) => tradable(p, 6));
      // 수락·역제안·거절 교환안 찾기(규칙 검증 통과)
      // 서로 다른 선수로 수락·역제안·거절 교환안을 고른다(앞 거래가 뒤 교환안을 무효로 만들지 않게)
      const used = new Set<number>();
      const find = (kind: string) => {
        for (const a of ours) for (const b of theirs) {
          if (used.has(a.id) || used.has(b.id)) continue;
          const pkg = { give: [a.id], get: [b.id], cashWon: 0 };
          if (s.trades.evaluate(meta, 6, pkg).decision.kind !== kind) continue;
          if (s.trades.validate(meta, 6, pkg).errors.length === 0) {
            used.add(a.id).add(b.id);
            return pkg;
          }
        }
        return null;
      };
      const rejectPkg = find('reject')!;
      const counterPkg = find('counter');
      const acceptPkg = find('accept')!;
      expect(rejectPkg && acceptPkg).toBeTruthy();

      // 첫 제안: 행동력 1(세션 시작). 같은 식별자 재전송: 같은 결과, 비용 없음
      const ap1 = await ap();
      const r1 = await call(d, 'trade.propose', { clubId: 6, ...rejectPkg, commandId: 'cmd-reject-1' });
      expect(r1.result).toBe('reject');
      expect(r1.apCharged).toBe(TRADE.sessionAp);
      expect(await ap()).toBe(ap1 - TRADE.sessionAp);
      const again = await call(d, 'trade.propose', { clubId: 6, ...rejectPkg, commandId: 'cmd-reject-1' });
      expect(again.message).toBe(r1.message);
      expect(again.apCharged).toBe(0);
      expect(await ap()).toBe(ap1 - TRADE.sessionAp);
      expect(r1.view.session).toMatchObject({ open: true, proposalsLeft: TRADE.proposalsPerSession - 1, apCost: 0 });
      // 상대 선수 실제 능력·히든 값은 응답에 없다
      expect(r1.view.theirs.every((r) => Object.keys(r.item.ratings).length === 0)).toBe(true);
      expect(JSON.stringify(r1.view)).not.toMatch(/potential|coachability|"hidden"/);

      // 역제안 → 수락(추가 행동력 없음)
      if (counterPkg) {
        const r2 = await call(d, 'trade.propose', { clubId: 6, ...counterPkg, commandId: 'cmd-counter-1' });
        expect(r2.result).toBe('counter');
        expect(r2.counter!.cashWon).toBeGreaterThan(counterPkg.cashWon);
        const cash0 = repo.cashBalance(3);
        const ap2 = await ap();
        const r3 = await call(d, 'trade.acceptCounter', { clubId: 6, commandId: 'cmd-counter-accept' });
        expect(r3.result).toBe('accept');
        expect(await ap()).toBe(ap2);
        expect(repo.cashBalance(3)).toBe(cash0 - r2.counter!.cashWon);
        expect(repo.getPlayer(counterPkg.give[0]!)!.clubId).toBe(6);
        expect(repo.getPlayer(counterPkg.get[0]!)!.clubId).toBe(3);
        // 재전송: 다시 이적·결제하지 않음
        await call(d, 'trade.acceptCounter', { clubId: 6, commandId: 'cmd-counter-accept' });
        expect(repo.cashBalance(3)).toBe(cash0 - r2.counter!.cashWon);
      }

      // 수락: 양쪽 소속이 함께 바뀌고 선수단 규칙 유지. 세션당 제안 상한 뒤에는 무비용 거부
      const fresh = s.meta();
      const still = acceptPkg.give.every((id) => repo.getPlayer(id)!.clubId === 3) && acceptPkg.get.every((id) => repo.getPlayer(id)!.clubId === 6);
      if (still && s.trades.session(fresh, 6).proposalsLeft > 0 && s.trades.validate(fresh, 6, acceptPkg).errors.length === 0 && s.trades.evaluate(fresh, 6, acceptPkg).decision.kind === 'accept') {
        const ap3 = await ap();
        const r4 = await call(d, 'trade.propose', { clubId: 6, ...acceptPkg, commandId: 'cmd-accept-1' });
        expect(r4.result).toBe('accept');
        expect(await ap()).toBe(ap3);
        expect(repo.getPlayer(acceptPkg.give[0]!)!.clubId).toBe(6);
        expect(repo.getPlayer(acceptPkg.get[0]!)!.clubId).toBe(3);
        expect(repo.getPlayer(acceptPkg.get[0]!)!.level).toBeDefined();
      }
      expect(checkRosterLimits(repo)).toEqual([]);
      expect(checkRosterComposition(repo)).toEqual([]);
      expect(s.meta().tradeHistory!.length).toBeGreaterThanOrEqual(1);
      expect(s.meta().actionLog!.some((e) => e.commandId === 'cmd-reject-1')).toBe(true);
      // 상한까지 쓰면 무비용 거부
      for (let i = 0; i < 5 && s.trades.session(s.meta(), 6).proposalsLeft > 0; i++) {
        const r = await d.respond('trade.propose', { clubId: 6, ...rejectPkg, cashWon: (i + 1) * 10_000_000, commandId: `fill-${i}-xxxx` });
        if (!r.ok) throw new Error(`채우기 제안 실패: ${r.error.message}`);
      }
      expect(s.trades.session(s.meta(), 6).proposalsLeft).toBe(0);
      const ap4 = await ap();
      const limited = await d.respond('trade.propose', { clubId: 6, ...rejectPkg, cashWon: 1, commandId: 'cmd-limit-1' });
      expect(limited.ok).toBe(false);
      if (!limited.ok) expect(limited.error.code).toBe('TRADE_LIMIT');
      expect(await ap()).toBe(ap4);
      // 다른 구단과는 새 세션(행동력 1)
      const view7 = await call(d, 'trade.view', { clubId: 7 });
      expect(view7.session).toMatchObject({ open: false, apCost: TRADE.sessionAp });
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
