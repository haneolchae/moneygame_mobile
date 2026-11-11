// 4c-3 경기 관전·승부처 참여(D-174·D-175): ① 추천만 수락하면 1일 진행과 같다 ② 경기 중 종료 뒤 다시 열면 기록된 지시가 재생되고
// 확정 결과가 마지막 미리보기와 같다 ④ 정보 경계 ⑤ 경기 중 저장 거부 ⑥ 추천과 다른 구단주 지시는 감독 결정에 들어가지 않는다
import { describe, expect, it } from 'vitest';
import { applyDirective, createGame, mergeOwner, OwnerPause, runGame, type DecisionPoint } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/worldgen';
import type { Dispatcher } from '../src/host/dispatcher';
import type { LiveChoice, LiveGameView } from '../src/shared/protocol';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const SEED = 'live-4c3';

async function toRegularSeason(d: Dispatcher) {
  await call(d, 'game.new', { clubId: 1, saveName: 't', seed: SEED });
  while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
  for (let i = 0; i < 10 && (await call(d, 'game.dashboard')).date < '2027-04-01'; i++) await call(d, 'game.advance', { mode: 'week' });
}

/** 결정 지점마다 추천을 그대로 보낸다. 멈춘 지점 수를 돌려준다 */
async function acceptAll(d: Dispatcher, v: LiveGameView): Promise<{ view: LiveGameView; points: number }> {
  let points = 0;
  while (v.game?.decision) {
    v = await call(d, 'live.decide', { choice: v.game.decision.recommendation });
    points++;
  }
  return { view: v, points };
}

/** 추천과 다른 선택: 수비는 투수(다른 불펜) 또는 수비 위치, 공격은 가능한 다른 작전 또는 대타 */
function differentChoice(v: LiveGameView): LiveChoice | null {
  const dec = v.game!.decision!;
  const rec = dec.recommendation;
  if (rec.kind === 'count') {
    const other = dec.tactics!.find((t) => t.key !== rec.tactic && !t.disabled);
    return other ? { ...rec, tactic: other.key } : null;
  }
  if (dec.role === 'def') {
    const p = dec.pitchers!.find((o) => o.key !== 'keep' && Number(o.key) !== rec.pitcherId);
    if (p) return { ...rec, pitcherId: Number(p.key) };
    return { ...rec, align: { infield: 'in', outfield: 'in', lines: false } };
  }
  const play = dec.plays!.find((o) => o.key !== rec.play && !o.disabled);
  if (play) return { ...rec, play: play.key };
  const ph = dec.pinchHitters!.find((o) => o.key !== 'keep' && Number(o.key) !== rec.pinchHitter);
  return ph ? { ...rec, pinchHitter: Number(ph.key) } : null;
}

describe('경기 관전·승부처 참여 (4c-3)', () => {
  it('① 추천 수락 = 1일 진행, ② 다시 열기·확정 = 마지막 미리보기, ④ 정보 경계, ⑤ 저장 거부', async () => {
    const dirA = tempDir();
    const dirB = tempDir();
    let a = makeDispatcher(dirA);
    const b = makeDispatcher(dirB);
    try {
      await toRegularSeason(a);
      await toRegularSeason(b);
      expect(fingerprint(a)).toBe(fingerprint(b));

      // ① 서로 다른 날 우리 경기 5경기 이상(참여 지점 있는 경기 3경기 이상)을 관전·추천 수락 vs 그냥 1일 진행
      let games = 0;
      let withPoints = 0;
      for (let day = 0; day < 30 && (games < 5 || withPoints < 3); day++) {
        const dash = await call(a, 'game.dashboard');
        if (dash.live.available) {
          const v = await call(a, 'live.start');
          expect(v.active).toBe(true);
          // ④ 결정 화면: 상대 선수는 추정 범위만, 우리 선수는 실제 능력치
          if (v.game?.decision) {
            const dec = v.game.decision;
            const opp = dec.role === 'off' ? dec.pitcher : dec.batter;
            const own = dec.role === 'off' ? dec.batter : dec.pitcher;
            expect(opp.ratings).toEqual({});
            expect(Object.keys(own.ratings).length).toBeGreaterThan(0);
            // ⑤ 경기 중 저장 거부
            const r = await a.respond('save.save', { slot: 'x' });
            expect(r.ok ? '' : r.error.code).toBe('LIVE_GAME');
          }
          const { view, points } = await acceptAll(a, v);
          expect(view.game!.over).toBe(true);
          games++;
          if (points > 0) withPoints++;
        }
        await call(a, 'game.advance', { mode: 'day' });
        await call(b, 'game.advance', { mode: 'day' });
        expect(a.saves.repository().getMeta().liveGame ?? null).toBeNull();
      }
      expect(games).toBeGreaterThanOrEqual(5);
      expect(withPoints).toBeGreaterThanOrEqual(3);
      const managerState = (d: Dispatcher) => JSON.stringify(d.saves.repository().getStaff().filter((s) => s.title === '감독').map((s) => [s.id, s.clubId, s.manager]));
      expect(fingerprint(a)).toBe(fingerprint(b));
      expect(managerState(a)).toBe(managerState(b));

      // ② 추천과 다른 지시를 내린 뒤 종료 → 다시 열기 → 재생 → 확정 = 마지막 미리보기
      let tested = false;
      for (let day = 0; day < 20 && !tested; day++) {
        if ((await call(a, 'game.dashboard')).live.available) {
          let v = await call(a, 'live.start');
          const choice = v.game?.decision ? differentChoice(v) : null;
          if (choice) {
            v = await call(a, 'live.decide', { choice });
            a.close();
            a = makeDispatcher(dirA);
            await call(a, 'save.resumeSession');
            const again = await call(a, 'live.view');
            expect(JSON.stringify(again)).toBe(JSON.stringify(v));
            const { view } = await acceptAll(a, again);
            const repo = a.saves.repository();
            const fixtureId = view.game!.fixtureId;
            await call(a, 'game.advance', { mode: 'day' });
            const g = repo.getGames(repo.getMeta().season).find((x) => x.fixtureId === fixtureId)!;
            expect({ home: g.homeRuns, away: g.awayRuns }).toEqual(view.game!.score);
            expect(repo.getGameEvents(fixtureId).pas.length).toBe(view.game!.feed.filter((f) => f.kind === 'pa').length);
            tested = true;
            continue;
          }
          await acceptAll(a, v);
        }
        await call(a, 'game.advance', { mode: 'day' });
      }
      expect(tested).toBe(true);
      // 7) 시즌 통계: 우리 경기 수·참여 지점 수
      const stats = a.saves.repository().getMeta().liveStats?.['2027'];
      expect(stats!.games).toBeGreaterThan(0);
    } finally {
      a.close();
      b.close();
      cleanup(dirA);
      cleanup(dirB);
    }
  }, 240_000);

  it('⑥ 추천과 다른 구단주 지시는 감독 결정(신뢰도)에 들어가지 않는다', () => {
    const world = generateWorld(Rng.fromSeed('live-world'), 2026);
    const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
    const active = (c: number) => world.filter((p) => p.clubId === c && p.level === '1군');
    let checked = 0;
    for (let n = 0; n < 200 && checked < 3; n++) {
      const [h, aw] = [clubs[n % clubs.length]!, clubs[(n + 1) % clubs.length]!];
      const g = createGame(9000 + n, prepareTeam(h, active(h), [], null), prepareTeam(aw, active(aw), [], null), Rng.derive('live', 'game', n), 11, undefined, {
        owner: { clubId: h, enabled: true, maxPerGame: 2, prePa: () => undefined, count: () => undefined, pauseWhenMissing: true },
      });
      let point;
      try {
        runGame(g);
      } catch (e) {
        if (!(e instanceof OwnerPause)) throw e;
        point = e.point;
      }
      if (!point || point.kind !== 'prePa' || point.role !== 'def') continue;
      // 수비 위치를 전진으로 바꾼 지시: 우리(홈) 쪽 결정이 열리지 않는다. 같은 지시를 감독 결정으로 적용하면 열린다
      const d: DecisionPoint = { kind: 'prePa', side: 'home', batSide: 'away', inning: g.inning, atInningStart: g.atHalfStart, key: point.key };
      const dir = mergeOwner(point.recommended, { align: { infield: 'in', outfield: 'in', lines: false } }, 'def');
      applyDirective(g, d, dir, 'home');
      expect(g.openDecisions.filter((x) => x.side === 'home')).toEqual([]);
      g.openDecisions = [];
      applyDirective(g, d, dir);
      expect(g.openDecisions.filter((x) => x.side === 'home').length).toBe(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
