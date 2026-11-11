// 4c-2a 작전 사건·감독 AI(D-170·D-171): 정보 경계(상대 실제 값만 바꾸면 판단이 같다), 고의사구 투구 수 0, 희생번트 기록,
// 대타·대주자·대수비 교체 규칙, 주루 사건의 아웃·득점·자살 일관성, 같은 시드 같은 경기
import { describe, expect, it } from 'vitest';
import { applyDirective, createGame, managerDecide, nextDecision, simulateGame, type GameResult } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { Rng } from '../src/engine/rng';
import type { Estimator } from '../src/engine/tactics';
import type { PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

const world = generateWorld(Rng.fromSeed('tactics-world'), 2026);
const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
const active = (c: number) => world.filter((p) => p.clubId === c && p.level === '1군');

function games(n: number, seed = 'tactics'): GameResult[] {
  const out: GameResult[] = [];
  for (let g = 0; g < n; g++) {
    const h = clubs[g % clubs.length]!;
    const a = clubs[(g * 3 + 1) % clubs.length]!;
    if (h === a) continue;
    out.push(simulateGame(7000 + g, prepareTeam(h, active(h), [], null), prepareTeam(a, active(a), [], null), Rng.derive(seed, 'game', g), 11));
  }
  return out;
}

describe('작전 사건·감독 AI (4c-2a)', () => {
  const gs = games(120);
  const events = gs.flatMap((g) => g.events);
  const plays = gs.flatMap((g) => g.plays);
  const subs = gs.flatMap((g) => g.subs);

  it('작전 사건이 실제로 일어나고 기록 규칙을 지킨다', () => {
    for (const k of ['SB', 'WP']) expect(plays.some((p) => p.kind === k)).toBe(true);
    expect(events.some((e) => e.bunt)).toBe(true);
    expect(subs.some((s) => s.kind === 'PH')).toBe(true);
    for (const e of events) {
      if (e.ibb) expect([e.outcome, e.pitches]).toEqual(['BB', 0]);
      if (e.outcome === 'SH') expect([e.outsOnPlay, e.bunt !== undefined]).toEqual([1, true]);
    }
    for (const p of plays) {
      const po = p.credits.filter((c) => c.kind === 'PO').length;
      expect(po).toBe(p.outsOnPlay);
      expect(p.kind === 'CS' || p.kind === 'PO' ? 1 : 0).toBe(p.outsOnPlay);
    }
  });

  it('경기마다 원정 아웃 = 이닝 × 3(주루 사건 아웃 포함), 득점 = 득점 기록 수', () => {
    for (const g of gs) {
      const outs = [...g.events, ...g.plays].filter((x) => x.half === 'T').reduce((a, x) => a + x.outsOnPlay, 0);
      expect(outs).toBe(g.innings * 3);
      expect(g.runs.length).toBe(g.homeRuns + g.awayRuns);
    }
  });

  it('교체된 선수는 다시 나오지 않고 교체 선수는 벤치에서 나온다', () => {
    for (const g of gs) {
      const out = new Set<number>();
      for (const s of g.subs) {
        expect(out.has(s.inId)).toBe(false);
        out.add(s.outId);
      }
      // 교체되어 나간 뒤에는 그 선수의 타석이 없다
      for (const s of g.subs) {
        const after = g.events.filter((e) => e.seq > s.seq && e.batterId === s.outId);
        expect(after).toHaveLength(0);
      }
    }
  });

  it('같은 시드면 같은 경기', () => {
    expect(JSON.stringify(games(20))).toBe(JSON.stringify(gs.slice(0, 20)));
  });

  it('정보 경계: 추정값이 같으면 상대 선수의 실제 값을 바꿔도 감독 AI 판단이 같다', () => {
    const [h, a] = [clubs[0]!, clubs[1]!];
    // 1회초, 무사, 빠르지만 평범한 주자가 1루에 있을 때 원정 공격의 도루 판단을 결정 난수 키 200개에서 모은다
    const steals = (estimator: Estimator | undefined, mutate: (p: PlayerTruth) => PlayerTruth) => {
      const home = prepareTeam(h, active(h).map(mutate), [], null);
      const away = prepareTeam(a, active(a), [], null);
      const g = createGame(1, home, away, Rng.fromSeed('boundary'), 11, undefined, estimator ? { estimator } : {});
      const runner = away.lineup[0]!.player;
      const out: string[] = [];
      for (let key = 0; key < 200; key++) {
        g.seq = key;
        const d = nextDecision(g)!;
        g.bases = [{ id: runner.id, speed: 70, baserunning: 60, pitcherId: home.starter.id, earned: true }, null, null];
        out.push(managerDecide(g, d).play);
      }
      return out;
    };
    const strongArm = (p: PlayerTruth) => (p.position === 'C' ? { ...p, defense: { ...p.defense, armStrength: 99 }, catcher: { ...p.catcher!, transfer: 99 } } : p);
    const fixed: Estimator = () => 55;
    const base = steals(fixed, (p) => p);
    expect(base.filter((x) => x === 'steal2').length).toBeGreaterThan(0);
    // 추정값이 같으면 홈 포수의 실제 송구 능력을 극단으로 바꿔도 판단이 같다
    expect(steals(fixed, strongArm)).toEqual(base);
    // 대조: 실제 값에서 나온 기본 추정이면 포수 능력이 판단을 바꾼다(추정값이 유일한 통로임을 확인)
    expect(steals(undefined, strongArm).filter((x) => x === 'steal2').length).toBeLessThan(steals(undefined, (p) => p).filter((x) => x === 'steal2').length);
  });
});
