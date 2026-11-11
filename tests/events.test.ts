// EV-1 이벤트 엔진·턴 브리핑(D-203·D-204): ① 매주 브리핑 ② 재현·불러오기 중복 없음 ③ 카드 규격 ④ 후보 선택기
// ⑤ 효과 ⑥ 다른 난수 스트림 불변 ⑦ 조건식 거부 ⑧ D2 리포트(참고)
import { describe, expect, it } from 'vitest';
import { addDays, weekday } from '../src/engine/calendar';
import { EVENTS } from '../src/engine/config';
import { CARD_ERRORS, CARDS, parseCards, passesLimits, pickCandidate, type Candidate, type CardHistory } from '../src/engine/events/cards';
import { evalExpr, parseExpr } from '../src/engine/events/expr';
import { Rng } from '../src/engine/rng';
import { seasonKeyDates } from '../src/engine/schedule';
import { newEventState, weekNumber } from '../src/game/events';
import type { GameService } from '../src/game/service';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const svcOf = (d: unknown) => (d as { game(): GameService }).game();
type D = ReturnType<typeof makeDispatcher>;
const today = async (d: D) => (await call(d, 'game.dashboard')).date;
async function advanceTo(d: D, date: string) {
  while ((await today(d)) < date) await call(d, 'game.advance', { mode: (await call(d, 'game.dashboard')).phase === 'stove' || addDays(await today(d), 7) <= date ? 'week' : 'day' });
}

describe('이벤트 엔진·턴 브리핑 (EV-1)', () => {
  it('조건식·카드 규격·후보 선택기', () => {
    // ⑦ 허용 밖 문법 거부, 허용 문법 계산
    for (const bad of ['process.exit()', 'a = 1', 'x[0]', 'club.rank ;', '`x`', 'club.rank > ']) expect(() => parseExpr(bad), bad).toThrow();
    const v = (n: string) => ({ 'club.rank': 3, 'club.fan': 25, 'flag.x': 1 } as Record<string, number>)[n];
    expect(evalExpr(parseExpr('club.rank <= 3 && (club.fan < 30 || flag.y)'), v)).toBe(1);
    expect(evalExpr(parseExpr('!flag.x || -club.rank * 2 + 1 > 0'), v)).toBe(0);
    // ③ 데이터 파일 규격 오류 0건, 연결 전 효과 카드는 비활성
    expect(CARD_ERRORS).toEqual([]);
    expect(CARDS.find((c) => c.id === 'FAN-01')!.inactive).toBeNull();
    // EV-2에서 기분·컨디션 등이 연결돼 켜졌고, 계약 효과(EV-4)를 쓰는 카드는 아직 비활성
    expect(CARDS.find((c) => c.id === 'PRV-04')!.inactive).toBeNull();
    expect(CARDS.find((c) => c.id === 'INJ-01')!.inactive).toContain('CONTRACT');
    const bad = parseCards([{ ...CARDS[0], id: 'X', trigger: 'secret.hidden > 1' }, { ...CARDS[0], id: 'Y', delegateDefault: 'nope' }]);
    expect(bad.errors.length).toBe(2);

    // ④ 후보 선택기(합성 카드 2,000주)
    const mk = (id: string, category: string, priority = false, weight = 1) => ({ id, category, priority, weight, cooldownWeeks: EVENTS.cooldownWeeks, seasonCap: 1 }) as Candidate['card'];
    const pool: Candidate[] = [{ card: mk('A', 'injury'), playerId: null }, { card: mk('B', 'ops'), playerId: null }, { card: mk('C', 'ops'), playerId: null }];
    const rng = new Rng(Rng.derive('ev1', 'pick').state());
    let empty = 0;
    let sameAfterOps = 0;
    let opsAfterOps = 0;
    for (let i = 0; i < 2000; i++) {
      const r = pickCandidate(pool, rng, i % 2 ? 'ops' : null);
      if (r.empty) empty++;
      if (i % 2 && r.pick) {
        opsAfterOps++;
        if (r.pick.card.category === 'ops') sameAfterOps++;
      }
    }
    expect(Math.abs(empty / 2000 - EVENTS.emptyShare)).toBeLessThanOrEqual(0.03);
    // 직전 주가 ops면 ops 비율이 가중치 미적용(2/3)보다 낮다
    expect(sameAfterOps / opsAfterOps).toBeLessThan(2 / 3 - 0.1);
    // 우선 카드가 있으면 항상 우선 카드
    for (let i = 0; i < 200; i++) expect(pickCandidate([...pool, { card: mk('P', 'coach', true), playerId: null }], rng, null).pick!.card.id).toBe('P');
    // 쿨다운·시즌 상한·같은 선수 4주
    const h: CardHistory[] = [{ cardId: 'A', playerId: 7, week: 100, season: 2027 }];
    expect(passesLimits({ card: mk('A', 'injury'), playerId: null }, h, 107, 2027)).toBe(false);
    expect(passesLimits({ card: mk('A', 'injury'), playerId: null }, h, 108, 2028)).toBe(true);
    expect(passesLimits({ card: mk('A', 'injury'), playerId: null }, h, 120, 2027)).toBe(false);
    expect(passesLimits({ card: mk('B', 'ops'), playerId: 7 }, h, 103, 2027)).toBe(false);
    expect(passesLimits({ card: mk('B', 'ops'), playerId: 7 }, h, 104, 2027)).toBe(true);
  });

  it('한 시즌 매주 브리핑, 불러와 이어도 같은 기록, 효과 적용, 다른 난수 불변', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'events-ev1' });
      const repo = d.saves.repository();
      const svc = svcOf(d);
      const k = seasonKeyDates(2027);
      const mid = '2027-05-03';
      const check = '2027-06-07';
      await advanceTo(d, mid);
      await call(d, 'save.save', { slot: 'ev' });
      // 지연 결과 공개 확인용: 다음 주 시작에 처리할 결과 하나를 넣는다
      const st = repo.getMeta().eventState!;
      repo.updateMeta({ eventState: { ...st, queue: [...st.queue, { week: weekNumber(addDays(mid, 7)), cardId: 'TEST', playerId: null, effects: [{ type: 'FAN_NOW', value: 1 }], text: '시험 지연 결과' }], spawns: [{ week: weekNumber(addDays(mid, 7)), cardId: 'FAN-01', playerId: null }] } });
      await advanceTo(d, addDays(mid, 14));
      expect(repo.getNews({ weekId: addDays(mid, 7) }).some((n) => n.kind === 'result' && n.text.startsWith('시험 지연 결과'))).toBe(true);
      // 연쇄로 예약한 카드는 그 주에 발생하고 담당 팀이 위임 기본 선택지로 처리, 결과는 다음 브리핑에
      const fan = repo.getEventLog().find((e) => e.cardId === 'FAN-01')!;
      expect(fan.weekId).toBe(addDays(mid, 7));
      expect(fan.by).toBe('delegate');
      expect(fan.choiceId).toBe('statement');
      expect(repo.getNews({ weekId: addDays(mid, 14) }).some((n) => n.kind === 'result' && n.text.includes('마케팅팀') && n.text.includes('입장문'))).toBe(true);
      await call(d, 'save.load', { slot: 'ev' });
      await advanceTo(d, check);
      const snap = (r: typeof repo) => JSON.stringify({ news: r.getNews({ season: 2027 }).filter((n) => n.weekId <= check), log: r.getEventLog({ season: 2027 }).filter((e) => e.date <= check) });
      const first = snap(d.saves.repository());
      // 정규시즌 끝까지
      await advanceTo(d, addDays(k.regularSeasonEnd, 1));
      const r2 = d.saves.repository();
      // ① 시즌 모드 매주 월요일 브리핑 1개, 줄 수 3~15, 경기·재정·건강 줄
      const news = r2.getNews({ season: 2027 });
      const weeks = [...new Set(news.map((n) => n.weekId))];
      expect(weeks.every((w) => weekday(w) === 1)).toBe(true);
      for (let w = addDays(k.openingWeekMonday, 7); w <= k.regularSeasonEnd; w = addDays(w, 7)) {
        const lines = news.filter((n) => n.weekId === w);
        expect(lines.length, w).toBeGreaterThanOrEqual(EVENTS.briefingMin);
        expect(lines.length, w).toBeLessThanOrEqual(EVENTS.briefingMax);
        for (const kind of ['game', 'money', 'health']) expect(lines.filter((n) => n.kind === kind).length, `${w} ${kind}`).toBe(1);
        // 다시 열어도 같은 줄
        const view = svcOf(d).briefingView(w)!;
        expect(view.lines.map((x) => x.text)).toEqual(lines.map((x) => x.text));
      }
      // 같은 주 중복 없음
      expect(new Set(news.map((n) => `${n.weekId}|${n.seq}`)).size).toBe(news.length);
      // ③ 비활성 카드 발생 0건, ② 불러와 이어 진행해도 같은 기록
      const log = r2.getEventLog({ season: 2027 });
      expect(log.every((e) => !CARDS.find((c) => c.id === e.cardId)!.inactive)).toBe(true);
      expect(snap(r2)).toBe(first);
      // 위임 처리 결과는 다음 브리핑 결과 회수 줄에 나온다
      for (const e of log) {
        const nextWeek = addDays(e.weekId, 7);
        if (nextWeek > k.regularSeasonEnd) continue;
        const choiceText = CARDS.find((c) => c.id === e.cardId)!.choices.find((c) => c.id === e.choiceId)!.text;
        expect(news.some((n) => n.weekId === nextWeek && n.kind === 'result' && n.text.includes(choiceText)), e.cardId).toBe(true);
      }

      // EV-2(D-206 ⑧): 켜진 카드가 한 시즌에 실제로 나온다(위임 기본 선택지)
      expect(log.length).toBeGreaterThan(0);
      expect(log.every((e) => e.by === 'delegate' && e.choiceId === CARDS.find((c) => c.id === e.cardId)!.delegateDefault)).toBe(true);
      // ⑤ 효과
      const svc2 = svcOf(d);
      const meta = r2.getMeta();
      const state = newEventState();
      const ctx = { meta, date: meta.currentDate, clubId: 1, playerId: null as number | null, rng: new Rng(Rng.derive('x', 'y').state()), week: weekNumber(meta.currentDate), cardId: 'TEST', state };
      const base = svc2.events.baseBudget(meta);
      const cash0 = r2.cashBalance(1);
      svc2.events.applyEffects([{ type: 'CASH', grade: 'medium' }], ctx);
      const spent = cash0 - r2.cashBalance(1);
      expect(spent).toBeGreaterThanOrEqual(Math.floor((base * EVENTS.costBp.medium![0]) / 10_000) - 1_000_000);
      expect(spent).toBeLessThanOrEqual(Math.ceil((base * EVENTS.costBp.medium![1]) / 10_000) + 1_000_000);
      expect(r2.ledgerEntries(1, 5).some((e) => e.category === 'event' && e.amount === -spent)).toBe(true);
      const fan0 = r2.getMeta().fans!['1']!.satisfaction;
      svc2.events.applyEffects([{ type: 'FAN_NOW', value: -10 }, { type: 'FAN_NOW', value: -10 }], ctx);
      expect(Math.round((fan0 - r2.getMeta().fans!['1']!.satisfaction) * 10) / 10).toBe(Math.min(fan0, EVENTS.fanDropCap));
      const pid = r2.getPlayers().find((p) => p.clubId === 1 && p.level === '1군')!.id;
      svc2.events.applyEffects([{ type: 'REST', days: 3 }], { ...ctx, playerId: pid });
      expect(r2.getMeta().restOrders?.[String(pid)]).toBe(addDays(meta.currentDate, 2));
      const trust0 = r2.getStaff(1).find((s) => s.title === '감독')!.manager?.trust ?? 50;
      svc2.events.applyEffects([{ type: 'TRUST', value: -3 }], ctx);
      const mgr = r2.getStaff(1).find((s) => s.title === '감독')!.manager!;
      expect(mgr.trust).toBeCloseTo(Math.max(0, trust0 - 3), 6);
      expect(mgr.events?.at(-1)?.source).toContain('구단 사건');
      svc2.events.applyEffects([{ type: 'SPAWN', card: 'FAN-01', weeks: 2 }, { type: 'FLAG', name: 'test', weeks: 3 }], ctx);
      expect(state.spawns).toEqual([{ week: ctx.week + 2, cardId: 'FAN-01', playerId: null }]);
      expect(state.flags.test).toEqual({ value: 1, expiresWeek: ctx.week + 3 });

      // ⑥ 주 시작 이벤트 처리는 다른 난수 스트림을 바꾸지 않는다
      const before = r2.getMeta().rngStreams;
      const monday = addDays(meta.currentDate, 7 - ((weekday(meta.currentDate) + 6) % 7));
      svc2.events.weekStart(r2.getMeta(), monday);
      const after = r2.getMeta().rngStreams;
      for (const key of ['world', 'schedule', 'business']) expect(JSON.stringify(after[key])).toBe(JSON.stringify(before[key]));

      // ⑧ D2 리포트(참고)
      console.log('EV-1 D2', JSON.stringify(svc2.events.report(2027, 1)));
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);
});
