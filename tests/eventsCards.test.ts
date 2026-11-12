// EV-3 결정 카드 화면·위임·카드 목록(D-207·D-208): ① 대기 카드 진행 거부·선택 ② 위임·처리량 ③ 화면 응답 경계 ④ 데이터 ⑤ D2 한 시즌
import { describe, expect, it } from 'vitest';
import { addDays, weekday } from '../src/engine/calendar';
import { EVENTS } from '../src/engine/config';
import { CARD_ERRORS, CARDS, CATEGORY_TEAM } from '../src/engine/events/cards';
import { findCard } from '../src/engine/events/story';
import { seasonKeyDates } from '../src/engine/schedule';
import { weekNumber } from '../src/game/events';
import type { GameService } from '../src/game/service';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const svcOf = (d: unknown) => (d as { game(): GameService }).game();
type D = ReturnType<typeof makeDispatcher>;
const today = async (d: D) => (await call(d, 'game.dashboard')).date;

async function toSeason(d: D, seed: string, clubId: number) {
  await call(d, 'game.new', { clubId, saveName: 't', seed });
  for (let i = 0; i < 40 && (await call(d, 'game.dashboard')).phase === 'stove'; i++) await call(d, 'game.advance', { mode: 'week' });
}

describe('결정 카드 화면·위임 (EV-3)', () => {
  it('데이터 규격, 대기 카드 진행 거부·선택, 위임 처리량, 화면 응답 경계', async () => {
    // ④ 규격 오류 0, 모든 카드 위임 기본 선택지·문구 3종
    expect(CARD_ERRORS).toEqual([]);
    for (const c of CARDS) {
      expect(c.choices.some((x) => x.id === c.delegateDefault), c.id).toBe(true);
      expect(c.texts.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.delegateTeam, c.id).toBe(CATEGORY_TEAM[c.category]);
    }
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await toSeason(d, 'events-ev3', 1);
      const repo = d.saves.repository();
      const svc = svcOf(d);
      // 대기 카드가 있으면 진행 거부(날짜·현금 그대로)
      const pid = repo.getPlayers().find((p) => p.clubId === 1 && p.level === '1군')!.id;
      const waiting = (await call(d, 'game.dashboard')).card;
      if (waiting) await call(d, 'events.choose', { choiceId: waiting.choices.find((c) => c.isDefault)!.id });
      svc.forceCard('PRV-04', pid);
      const date0 = await today(d);
      const cash0 = repo.cashBalance(1);
      const blocked = await d.respond('game.advance', { mode: 'day', autoCards: false });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error.code).toBe('DECISION_PENDING');
      expect(await today(d)).toBe(date0);
      expect(repo.cashBalance(1)).toBe(cash0);
      // ③ 화면 응답: 확정 효과 숫자·방향, 확률은 등급만, 히든 값 없음
      const view = (await call(d, 'game.dashboard')).card!;
      expect(view.cardId).toBe('PRV-04');
      expect(view.choices.find((c) => c.id === 'leave')!.effects).toEqual(['3일 휴식(경기 제외)', '기분 ▲']);
      const json = JSON.stringify(view);
      for (const bad of ['"p":', 'hidden', 'consistency', 'pressureSensitivity', 'durability', 'mood"']) expect(json, bad).not.toContain(bad);
      // 선택: 구단주 처리, 효과 바로 반영, 두 번째 선택 거부, 진행 가능
      const r = await call(d, 'events.choose', { choiceId: 'leave' });
      expect(r.message).toContain('휴가');
      expect(repo.getMeta().restOrders?.[String(pid)]).toBeTruthy();
      expect(repo.getPlayer(pid)!.mood).toBe(65);
      expect((await d.respond('events.choose', { choiceId: 'leave' })).ok).toBe(false);
      const log = repo.getEventLog().at(-1)!;
      expect(log.by).toBe('owner');
      expect(log.cardId).toBe('PRV-04');
      // 다음 주 브리핑 결과 회수 줄에 구단주 처리
      const nextMonday = addDays(date0, ((8 - weekday(date0)) % 7) || 7);
      await call(d, 'game.advance', { mode: 'week', autoCards: false }).catch(() => undefined);
      while ((await today(d)) < nextMonday) {
        const card = (await call(d, 'game.dashboard')).card;
        if (card) await call(d, 'events.choose', { choiceId: card.choices.find((c) => c.isDefault)!.id });
        await call(d, 'game.advance', { mode: 'week', autoCards: false });
      }
      expect(repo.getNews({ weekId: nextMonday }).some((n) => n.kind === 'result' && n.text.includes('구단주') && n.text.includes('휴가'))).toBe(true);

      // ② 위임: 시상·감독 분류는 맡길 수 없다
      expect((await d.respond('events.setDelegation', { category: 'award', delegate: true })).ok).toBe(false);
      const rows = await call(d, 'events.setDelegation', { category: 'personal', delegate: true });
      expect(rows.find((x) => x.category === 'personal')!.delegate).toBe(true);
      // 맡긴 분류: 연쇄 예약 카드를 담당 팀이 처리량 4로 처리
      const pend = repo.getMeta().eventState!.pendingCard;
      if (pend) await call(d, 'events.choose', { choiceId: findCard(pend.cardId)!.delegateDefault });
      const m1 = addDays(await today(d), ((8 - weekday(await today(d))) % 7) || 7);
      const wid = m1;
      const st = repo.getMeta().eventState!;
      repo.updateMeta({ eventState: { ...st, pendingCard: null, spawns: [{ week: weekNumber(m1), cardId: 'PRV-11', playerId: pid }] } });
      svc.org.ensureWeek(repo.getMeta(), wid, 'season');
      const wp0 = repo.getWp(wid).find((x) => x.team === 'pr')!;
      svc.events.weekStart(repo.getMeta(), m1);
      const after = repo.getEventLog().at(-1)!;
      expect(after.cardId).toBe('PRV-11');
      expect(after.by).toBe('delegate');
      expect(repo.getWp(wid).find((x) => x.team === 'pr')!.used - wp0.used).toBe(EVENTS.delegateWp);
      expect(repo.getMeta().eventState!.pendingCard ?? null).toBeNull();
      // 처리량이 모자라면 직접 받는다
      const m2 = addDays(m1, 7);
      svc.org.ensureWeek(repo.getMeta(), m2, 'season');
      const pr2 = repo.getWp(m2).find((x) => x.team === 'pr')!;
      repo.spendWp(m2, 'pr', pr2.granted - pr2.used, true);
      const st2 = repo.getMeta().eventState!;
      repo.updateMeta({ eventState: { ...st2, spawns: [{ week: weekNumber(m2), cardId: 'GOOD-05', playerId: pid }] } });
      svc.events.weekStart(repo.getMeta(), m2);
      expect(repo.getMeta().eventState!.pendingCard?.cardId).toBe('GOOD-05');
      expect(repo.getNews({ weekId: m2 }).some((n) => n.kind === 'decide')).toBe(true);
      // D-212 추가 카드: 4장 모두 활성, 시즌 상한 기본 2(일부 1), 육성선수 계약
      for (const id of ['AWD-02', 'OPS-01', 'DEV-01', 'CS-04']) expect(CARDS.find((c) => c.id === id) ? CARDS.find((c) => c.id === id)!.inactive : 'missing', id).toBeNull();
      // ①: 스토브리그 'MLB 관심'(D-228)도 시즌에 한 번
      expect(CARDS.filter((c) => c.seasonCap === 1).map((c) => c.id).sort()).toEqual(['CS-04', 'MGR-04', 'MLB-01', 'SPN-03', 'SPN-05']);
      const fa = repo.getPlayers().find((p) => p.clubId === null && !p.retired && p.origin === 'domestic')!;
      const mt = repo.getMeta();
      svc.events.applyEffects([{ type: 'CONTRACT', kind: 'signTrial' }], { meta: mt, date: mt.currentDate, clubId: 1, playerId: fa.id, rng: new (await import('../src/engine/rng')).Rng((await import('../src/engine/rng')).Rng.derive('x', 'y').state()), week: weekNumber(mt.currentDate), cardId: 'DEV-01', state: mt.eventState! });
      const signed = repo.getPlayer(fa.id)!;
      expect([signed.clubId, signed.level, signed.salary, signed.contractYears]).toEqual([1, '2군', 30_000_000, 1]);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);

  it('D2 한 시즌 자동 실행(시드 2개·구단 2곳): 결정 카드 수·카드 장부 순액', async () => {
    const out: string[] = [];
    const reps: Array<{ seed: string; rep: ReturnType<GameService['events']['report']> }> = [];
    for (const [seed, club] of [['events-d2-a', 1], ['events-d2-b', 6]] as const) {
      const dir = tempDir();
      const d = makeDispatcher(dir);
      try {
        await toSeason(d, seed, club);
        const end = seasonKeyDates(2027).regularSeasonEnd;
        while ((await today(d)) <= end) await call(d, 'game.advance', { mode: 'week' });
        const rep = svcOf(d).events.report(2027, club);
        out.push(`${seed}/${club}: ${JSON.stringify(rep)}`);
        reps.push({ seed, rep });
      } finally {
        console.log('EV-3 D2', out.at(-1));
        d.close();
        cleanup(dir);
      }
    }
    // D-208 ⑤·D-213: 카드 장부 순액은 시드마다, 결정 카드 수(22~28장)는 시드 평균으로 판정
    for (const { seed, rep } of reps) expect(Math.abs(rep.eventCashWon) / rep.expenseWon, `${seed} cash`).toBeLessThanOrEqual(0.1);
    const avg = reps.reduce((a, r) => a + r.rep.cards, 0) / reps.length;
    expect(avg).toBeGreaterThanOrEqual(22);
    expect(avg).toBeLessThanOrEqual(28);
  }, 600_000);
});
