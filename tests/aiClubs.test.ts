// 7a AI 구단 운영 상태·긴축·AI 간 트레이드(D-155·D-156): 운영 상태 판정(순위·현금·긴축 해제), 긴축 진입 때 긴급 지원과 다음 시즌 차감,
// 긴축 구단의 연봉 증가 거래 거절, 재트레이드 60일 제한(무비용 거부), AI 간 거래 뒤 양쪽 선수단 규칙·장부 일치
import { describe, expect, it } from 'vitest';
import { assessStance, emergencySupport, stanceByRank } from '../src/engine/aiClub';
import { AI_CLUB, TRADE } from '../src/engine/config';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkAiClubs, checkRosterComposition, checkRosterLimits } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('AI 구단 운영 상태·긴축·AI 간 트레이드 (7a)', () => {
  it('운영 상태 판정: 순위, 현금 0 미만 긴축, 해제 기준 회복', () => {
    expect([1, AI_CLUB.contendRank, AI_CLUB.contendRank + 1, AI_CLUB.rebuildRank - 1, AI_CLUB.rebuildRank, 10].map(stanceByRank)).toEqual(['contend', 'contend', 'middle', 'middle', 'rebuild', 'rebuild']);
    expect(assessStance('contend', 1, -1)).toBe('austerity');
    expect(assessStance('austerity', 1, AI_CLUB.austerityExitWon - 1)).toBe('austerity');
    expect(assessStance('austerity', 1, AI_CLUB.austerityExitWon)).toBe('contend');
    expect(assessStance('middle', 9, 0)).toBe('rebuild');
    expect(emergencySupport(-250_000_000)).toBe(1_300_000_000);
    expect(emergencySupport(0)).toBe(0);
  });

  it('긴축 진입·긴급 지원·거래 거절, 재트레이드 제한, AI 간 거래', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'ai-7a' });
      const repo = d.saves.repository();
      const ai = repo.getClubs().filter((c) => c.id !== 1);
      expect(ai.every((c) => repo.getMeta().clubStance?.[String(c.id)])).toBe(true);
      expect(repo.getMeta().clubStance?.['1']).toBeUndefined();
      expect((await call(d, 'club.view', { clubId: 2 })).stance).not.toBeNull();
      expect((await call(d, 'club.view', { clubId: 1 })).stance).toBeNull();

      // 구단 2의 현금을 0 아래로 만든다 → 다음 1일 평가에서 긴축 + 긴급 지원(다음 시즌 차감)
      const target = 2;
      const cash0 = repo.cashBalance(target);
      repo.addLedger([{ clubId: target, date: repo.getMeta().currentDate, category: 'etc' as never, amount: -(cash0 + 50_000_000_000), memo: '시험: 현금 고갈' }]);
      await until(d, '2026-12-02');
      const meta = repo.getMeta();
      expect(meta.clubStance?.[String(target)]?.stance).toBe('austerity');
      const support = Object.values(meta.aiSupportDeduction ?? {}).reduce((a, m) => a + (m[String(target)] ?? 0), 0);
      expect(support).toBeGreaterThanOrEqual(1_000_000_000);
      expect(repo.ledgerEntries(target, 100000).some((e) => e.category === 'parentSupport' && e.memo.includes('긴급 지원') && e.amount === support)).toBe(true);
      expect(meta.stanceLog?.some((x) => x.clubId === target && x.to === 'austerity')).toBe(true);

      // 긴축 구단은 연봉 합계가 늘어나는 거래를 받지 않는다
      const origin = new Map(repo.getPlayers().map((p) => [p.id, p.origin]));
      const tv = await call(d, 'trade.view', { clubId: target });
      expect(tv.windowReason).toBeNull();
      const ours = tv.ours.filter((r) => r.tradable && origin.get(r.item.id) === 'domestic').sort((a, b) => b.item.salaryWon - a.item.salaryWon)[0]!.item;
      const theirs = tv.theirs.filter((r) => r.tradable && origin.get(r.item.id) === 'domestic' && r.item.isPitcher === ours.isPitcher).sort((a, b) => a.item.salaryWon - b.item.salaryWon)[0]!.item;
      expect(ours.salaryWon).toBeGreaterThan(theirs.salaryWon);
      const r = await call(d, 'trade.propose', { clubId: target, give: [ours.id], get: [theirs.id], cashWon: 0, commandId: 'austerity-1' });
      expect(r.result).toBe('reject');
      expect(r.message).toContain('재정 긴축');

      // 재트레이드 제한: 최근 거래 기록이 있는 선수는 검증에서 무비용 거부
      const other = (await call(d, 'trade.view', { clubId: 3 })).theirs.filter((x) => x.tradable)[0]!.item;
      const today = repo.getMeta().currentDate;
      repo.updateMeta({ tradeHistory: [...(repo.getMeta().tradeHistory ?? []), { date: today, season: repo.getMeta().season, period: 'stove', clubA: 4, clubB: 3, aToB: [other.id], bToA: [], cashAtoB: 0 }] });
      const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
      const locked = await d.respond('trade.propose', { clubId: 3, give: [ours.id], get: [other.id], cashWon: 0, commandId: 'retrade-1' });
      expect(locked.ok).toBe(false);
      expect(!locked.ok && locked.error.message).toContain('최근 트레이드');
      expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap);
      repo.updateMeta({ tradeHistory: (repo.getMeta().tradeHistory ?? []).filter((h) => !(h.clubA === 4 && h.aToB.includes(other.id))) });
      expect(TRADE.retradeLockDays).toBe(60);

      // 스토브리그 동안 AI 구단 간 거래: 우리 구단 제외, 주 1건·구단별 2건 이하, 선수단 규칙 유지, 현금 합계 0
      await until(d, '2027-02-01');
      const deals = (repo.getMeta().tradeHistory ?? []).filter((h) => h.ai);
      expect(deals.length).toBeGreaterThanOrEqual(1);
      expect(deals.every((h) => h.clubA !== 1 && h.clubB !== 1 && h.aToB.length === 1 && h.bToA.length === 1)).toBe(true);
      const players = new Map(repo.getPlayers().map((p) => [p.id, p]));
      const lastMove = new Map<number, number>();
      for (const h of deals) {
        for (const id of h.aToB) lastMove.set(id, h.clubB);
        for (const id of h.bToA) lastMove.set(id, h.clubA);
      }
      for (const [id, club] of lastMove) expect([club, null]).toContain(players.get(id)!.clubId);
      const cashNet = ai.reduce((a, c) => a + repo.ledgerEntries(c.id, 100000).filter((e) => e.category === 'tradeCash').reduce((x, e) => x + e.amount, 0), 0);
      expect(cashNet).toBe(0);
      expect([...checkAiClubs(repo), ...checkRosterLimits(repo), ...checkRosterComposition(repo)]).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
