// EV-4 히든 생활 요인·평판 메모·중대 사건·징계(D-210·D-211)
import { describe, expect, it } from 'vitest';
import { addDays, weekday } from '../src/engine/calendar';
import { EVENTS } from '../src/engine/config';
import { falseRate, hitRate, lifeOf, reputationNotes, type LifeFactors } from '../src/engine/events/life';
import { caseTruth, MAJOR_CASES, MAJOR_ERRORS } from '../src/engine/events/major';
import { Rng } from '../src/engine/rng';
import { createSnapshot } from '../src/engine/scouting';
import { seasonKeyDates } from '../src/engine/schedule';
import { newEventState, weekNumber } from '../src/game/events';
import type { GameService } from '../src/game/service';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const svcOf = (d: unknown) => (d as { game(): GameService }).game();
type D = ReturnType<typeof makeDispatcher>;
const today = async (d: D) => (await call(d, 'game.dashboard')).date;
const fake = (id: number, workEthic: number) => ({ id, hidden: { workEthic } as never });

describe('히든 생활 요인·중대 사건 (EV-4)', () => {
  it('① 생활 요인 분포·상관 ② 평판 메모 적중·오탐·고정 ③ 진실 규칙', () => {
    expect(MAJOR_ERRORS).toEqual([]);
    const rng = new Rng(Rng.derive('ev4', 'we').state());
    const n = 20_000;
    const rows = Array.from({ length: n }, (_, i) => {
      const we = Math.max(1, Math.min(100, Math.round(rng.normal(50, 15))));
      return { we, l: lifeOf('ev4-seed', fake(i + 1, we)) };
    });
    const share = (r: string) => rows.filter((x) => x.l.pastRecord === r).length / n;
    expect(Math.abs(share('none') - 0.92)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share('minor') - 0.06)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share('major') - 0.02)).toBeLessThanOrEqual(0.02);
    const mx = rows.reduce((a, x) => a + x.we, 0) / n;
    const my = rows.reduce((a, x) => a + x.l.selfControl, 0) / n;
    const cov = rows.reduce((a, x) => a + (x.we - mx) * (x.l.selfControl - my), 0);
    const sx = Math.sqrt(rows.reduce((a, x) => a + (x.we - mx) ** 2, 0));
    const sy = Math.sqrt(rows.reduce((a, x) => a + (x.l.selfControl - my) ** 2, 0));
    const corr = cov / (sx * sy);
    expect(corr).toBeGreaterThanOrEqual(0.2);
    expect(corr).toBeLessThanOrEqual(0.4);
    // 같은 시드·선수면 같은 값
    expect(lifeOf('ev4-seed', fake(77, 50))).toEqual(lifeOf('ev4-seed', fake(77, 50)));

    // ② 평판 메모: 과거 이력 문구의 적중·오탐(합성 요인, 조사 역량 0.5)
    const base: LifeFactors = { selfControl: 50, publicAwareness: 50, warmth: 50, humility: 50, pastRecord: 'none' };
    const pastText = ['고교 시절 팀 내 갈등이 있었다는 이야기가 돈다', '졸업 동기들과 연락을 거의 안 한다'];
    const rate = (f: LifeFactors) => Array.from({ length: 5000 }, (_, i) => reputationNotes('ev4-rep', 3, fake(i + 1, 50), 0.5, f).some((x) => pastText.includes(x.text))).filter(Boolean).length / 5000;
    const hit = rate({ ...base, pastRecord: 'major' });
    const fp = rate(base);
    expect(hit).toBeGreaterThanOrEqual(0.5);
    expect(hit).toBeLessThanOrEqual(0.7);
    expect(fp).toBeGreaterThanOrEqual(0.05);
    expect(fp).toBeLessThanOrEqual(0.15);
    expect(Math.abs(hit - hitRate(0.5))).toBeLessThan(0.03);
    expect(Math.abs(fp - falseRate(0.5))).toBeLessThan(0.02);
    // 다시 조사해도 같은 메모
    expect(reputationNotes('ev4-rep', 3, fake(9, 50), 0.5)).toEqual(reputationNotes('ev4-rep', 3, fake(9, 50), 0.5));

    // ③ MAJ-01 진실: 중대 → 사실, 없음 → 허위, 경미 → 사실·과장 반반
    const def = MAJOR_CASES.find((c) => c.id === 'MAJ-01')!;
    const tr = new Rng(Rng.derive('ev4', 'truth').state());
    expect(caseTruth(def, { ...base, pastRecord: 'major' }, tr)).toBe('fact');
    expect(caseTruth(def, base, tr)).toBe('false');
    const minor = Array.from({ length: 2000 }, () => caseTruth(def, { ...base, pastRecord: 'minor' }, tr));
    expect(minor.every((t) => t === 'fact' || t === 'exaggerated')).toBe(true);
    expect(Math.abs(minor.filter((t) => t === 'fact').length / 2000 - 0.5)).toBeLessThan(0.05);
  });

  it('④ 징계 ⑤ 중대 사건 카드 ⑥ 계약 조치 ⑧ 흑역사·약물 시즌 표기, 스카우트 평판 판단 유보', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'events-ev4' });
      const opening = seasonKeyDates(2027).opening;
      while ((await today(d)) < addDays(opening, 2)) await call(d, 'game.advance', { mode: (await call(d, 'game.dashboard')).phase === 'stove' || addDays(await today(d), 7) <= addDays(opening, 2) ? 'week' : 'day' });
      const repo = d.saves.repository();
      const svc = svcOf(d);
      const clear = async () => {
        for (let i = 0; i < 5; i++) {
          const c = (await call(d, 'game.dashboard')).card;
          if (!c) break;
          await call(d, 'events.choose', { choiceId: c.choices.find((x) => x.isDefault)!.id });
        }
      };
      await clear();
      // 스카우트 평판: 신뢰도 40 미만은 판단 유보
      const other = repo.getPlayers().find((p) => p.clubId === 2)!;
      expect(createSnapshot('s', 1, other, '2027-04-01', 'x', 1).reputation).toBeUndefined();
      const otherView = await call(d, 'game.player', { playerId: other.id });
      expect(otherView.reputation.pending).toBe(true);

      // ④ 징계: 1군 → 다음 날 2군, 1군 등록 거부, 정규시즌 경기마다 차감
      const target = repo.getPlayers().find((p) => p.clubId === 1 && p.level === '1군' && !p.isPitcher)!;
      const meta = repo.getMeta();
      const state = newEventState();
      const ctx = { meta, date: meta.currentDate, clubId: 1, playerId: target.id, rng: new Rng(Rng.derive('ev4', 'c').state()), week: weekNumber(meta.currentDate), cardId: 'PRV-09', state };
      svc.events.applyEffects([{ type: 'SUSPEND', games: 40 }], ctx);
      expect(repo.getPlayer(target.id)!.sanction!.left).toBe(EVENTS.sanctionMax); // 한 사건 30 상한
      svc.events.applyEffects([{ type: 'SUSPEND', games: -25 }], ctx);
      expect(repo.getPlayer(target.id)!.sanction!.left).toBe(5);
      const games0 = repo.getGames(2027, 'regular').filter((g) => g.home === 1 || g.away === 1).length;
      await call(d, 'game.advance', { mode: 'day' });
      expect(repo.getPlayer(target.id)!.level).toBe('2군');
      expect((await d.respond('roster.move', { promote: [target.id], demote: [] })).ok).toBe(false);
      for (let i = 0; i < 6; i++) await call(d, 'game.advance', { mode: 'day' });
      const played = repo.getGames(2027, 'regular').filter((g) => g.home === 1 || g.away === 1).length - games0;
      const left = repo.getPlayer(target.id)!.sanction?.left ?? 0;
      expect(left).toBe(Math.max(0, 5 - played));

      // ⑤ 중대 사건 카드: 우리 선수 학교폭력 폭로(사실로 둔다) → 위임 불가·진행 거부 → 보류·조사 → 결론 → 구단 징계 수위
      await clear();
      const p2 = repo.getPlayers().find((p) => p.clubId === 1 && p.level === '1군' && p.id !== target.id && !p.sanction)!;
      const w = weekNumber(await today(d));
      const st = repo.getMeta().eventState ?? newEventState();
      const id = `MAJ-01-${w}-${p2.id}`;
      repo.updateMeta({ eventState: { ...st, pendingMajor: { caseId: id, kind: 'open' }, cases: [...(st.cases ?? []), { id, type: 'MAJ-01', playerId: p2.id, clubId: 1, season: 2027, date: await today(d), stage: 'open', truth: 'fact', openedWeek: w, resolveWeek: w + 2, choice: null, games: 0, result: null }] } });
      const view = (await call(d, 'game.dashboard')).card!;
      expect(view.major).toBe(true);
      expect(JSON.stringify(view)).not.toContain('fact');
      const blocked = await d.respond('game.advance', { mode: 'day', autoCards: false });
      expect(blocked.ok).toBe(false);
      expect((await d.respond('events.setDelegation', { category: 'major', delegate: true })).ok).toBe(false);
      await call(d, 'events.choose', { choiceId: 'hold' });
      expect(repo.getMeta().restOrders?.[String(p2.id)]).toBeTruthy();
      expect((await call(d, 'game.player', { playerId: p2.id })).caseOpen).toContain('조사 중');
      // 2주 뒤 결론: 사실 → 팬 만족도 하락·구단 징계 수위 카드
      for (let i = 0; i < 3 && !(repo.getMeta().eventState?.cases ?? []).some((c) => c.id === id && c.stage === 'closed'); i++) {
        await call(d, 'game.advance', { mode: 'week', autoCards: false }).catch(async () => {
          const c = (await call(d, 'game.dashboard')).card;
          if (c && !c.major) await call(d, 'events.choose', { choiceId: c.choices.find((x) => x.isDefault)!.id });
        });
      }
      const closed = repo.getMeta().eventState!.cases!.find((c) => c.id === id)!;
      expect(closed.stage).toBe('closed');
      expect(closed.resolveWeek - closed.openedWeek).toBeGreaterThanOrEqual(2);
      const sanctionCard = (await call(d, 'game.dashboard')).card!;
      expect(sanctionCard.major).toBe(true);
      expect(sanctionCard.choices.map((c) => c.id)).toEqual(['sanction:10', 'sanction:20', 'sanction:30']);
      await call(d, 'events.choose', { choiceId: 'sanction:20' });
      expect(repo.getPlayer(p2.id)!.sanction?.total).toBe(20);
      // ⑧ 흑역사(일요일 판정)
      await clear();
      const nextSun = addDays(await today(d), (7 - weekday(await today(d))) % 7);
      while ((await today(d)) <= nextSun) {
        await clear();
        await call(d, 'game.advance', { mode: 'day', autoCards: true });
      }
      expect(repo.getAchievements().some((a) => a.key.startsWith('Q_scandal'))).toBe(true);
      // 약물 징계 시즌 수상 표기(수상은 유지)
      const drugP = repo.getPlayers().find((p) => p.clubId === 1 && p.id !== p2.id && p.id !== target.id)!;
      const s2 = repo.getMeta().eventState!;
      repo.updateMeta({ eventState: { ...s2, cases: [...s2.cases!, { id: 'MAJ-04-x', type: 'MAJ-04', playerId: drugP.id, clubId: 1, season: 2027, date: await today(d), stage: 'closed', truth: 'fact', openedWeek: 0, resolveWeek: 0, choice: 'apologize', games: 30, result: null }] } });
      repo.insertAwards([{ season: 2027, award: 'monthly_bat', slot: '2027-04', playerId: drugP.id, clubId: 1, staffId: null, date: await today(d), score: 1, detail: '' }]);
      expect((await call(d, 'game.player', { playerId: drugP.id })).awards.some((a) => a.title.includes('금지약물 징계 시즌'))).toBe(true);

      // ⑥ 계약 조치
      const mk = (pid: number | null) => ({ ...ctx, meta: repo.getMeta(), date: repo.getMeta().currentDate, playerId: pid });
      const cutP = repo.getPlayers().find((p) => p.clubId === 1 && p.contractYears > 0 && p.id !== drugP.id)!;
      svc.events.applyEffects([{ type: 'CONTRACT', kind: 'release' }], mk(cutP.id));
      expect(repo.getPlayer(cutP.id)!.clubId).toBeNull();
      expect(repo.getObligations().some((o) => o.playerId === cutP.id)).toBe(true);
      const payP = repo.getPlayers().find((p) => p.clubId === 1 && p.salary >= 100_000_000)!;
      const sal = payP.salary;
      svc.events.applyEffects([{ type: 'CONTRACT', kind: 'payCut' }], mk(payP.id));
      expect(repo.getPlayer(payP.id)!.salary).toBe(Math.round((sal * 0.9) / 1_000_000) * 1_000_000);
      const wdP = repo.getPlayers().find((p) => p.clubId === 1 && p.id !== cutP.id && p.id !== payP.id)!;
      svc.events.applyEffects([{ type: 'CONTRACT', kind: 'withdrawPick' }], mk(wdP.id));
      expect(repo.getPlayer(wdP.id)!.clubId).toBeNull();
      expect(repo.getObligations().some((o) => o.playerId === wdP.id)).toBe(false);
      const cash = repo.cashBalance(1);
      svc.events.applyEffects([{ type: 'CONTRACT', kind: 'fireManager' }], mk(null));
      expect(repo.getStaff(1).some((s) => s.title === '감독')).toBe(false);
      expect(repo.cashBalance(1)).toBeLessThan(cash);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);

  it('⑦ 리그 사건: 한 시즌 자동 실행에서 리그 전체 1~10건(참고 범위)', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'events-ev4-league' });
      const end = seasonKeyDates(2027).regularSeasonEnd;
      while ((await today(d)) <= end) await call(d, 'game.advance', { mode: 'week' });
      const cases = (d.saves.repository().getMeta().eventState?.cases ?? []).filter((c) => c.season === 2027);
      console.log('EV-4 league cases', cases.length, JSON.stringify(cases.map((c) => `${c.type}:${c.clubId}:${c.truth}:${c.stage}:${c.games}`)));
      expect(cases.length).toBeGreaterThanOrEqual(1);
      expect(cases.length).toBeLessThanOrEqual(10);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 400_000);
});
