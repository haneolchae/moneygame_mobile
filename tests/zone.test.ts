// 타구·수비 존 모델 (10b 문서 §15.1, D-102)
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth, Position } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';
import {
  anchorTheta,
  cachedTheta,
  cellsFor,
  depthDist,
  directionDist,
  effRange,
  expectedInPlay,
  neutralHitRate,
  qualityDist,
  resolveInPlay,
  type Bases,
  type FieldPos,
  type Fielders,
  type InPlayResult,
  type Runner,
  type TypeShares,
} from '../src/engine/zone';

const world = generateWorld(Rng.fromSeed('zone'), 2026);
const baseHitter = world.find((p) => !p.isPitcher)!;
const basePitcher = world.find((p) => p.isPitcher)!;
const SHARES: TypeShares = { GB: 0.44, LD: 0.21, FB: 0.35 };
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** 모든 수비 능력 50·숙련 70인 수비수(중립 조건) */
function neutral(pos: FieldPos, over: { range?: number; fielding?: number; armStrength?: number; armAccuracy?: number } = {}): PlayerTruth {
  const src = pos === 'P' ? basePitcher : baseHitter;
  return {
    ...src,
    id: 1000 + ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].indexOf(pos),
    batting: { ...src.batting, speed: 50 },
    defense: { range: over.range ?? 50, fielding: over.fielding ?? 50, armStrength: over.armStrength ?? 50, armAccuracy: over.armAccuracy ?? 50 },
    pitching: pos === 'P' ? { ...basePitcher.pitching!, fielding: over.fielding ?? 50 } : null,
    positions: pos === 'P' ? { SP: 100 } : { [pos as Position]: 70 },
    ...(pos === 'C' ? { catcher: { blocking: 50, framing: 50, transfer: 50 } } : {}),
  };
}
function fieldersWith(over: Partial<Record<FieldPos, PlayerTruth>> = {}): Fielders {
  const all = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as FieldPos[];
  return Object.fromEntries(all.map((p) => [p, over[p] ?? neutral(p)])) as Fielders;
}
const batterWith = (over: Partial<PlayerTruth['batting']> = {}): PlayerTruth => ({ ...baseHitter, bats: 'R', batting: { ...baseHitter.batting, contact: 50, power: 50, speed: 50, baserunning: 50, ...over } });
const runner = (id: number, speed = 50): Runner => ({ id, speed, baserunning: 50, pitcherId: 1, earned: true });

/** 같은 난수(공통 난수)로 n번 판정한다 */
function simulate(n: number, opts: { batter?: PlayerTruth; fielders?: Fielders; bases?: () => Bases; outs?: () => number; hand?: 'R' | 'L'; theta?: number }): Array<InPlayResult & { basesBefore: Bases; outsBefore: number }> {
  const batter = opts.batter ?? batterWith();
  const out: Array<InPlayResult & { basesBefore: Bases; outsBefore: number }> = [];
  for (let i = 0; i < n; i++) {
    const rng = Rng.fromInts(77, 1, i);
    const basesBefore = opts.bases ? opts.bases() : ([null, null, null] as Bases);
    const outsBefore = opts.outs ? opts.outs() : 0;
    const r = resolveInPlay(rng, {
      batter,
      hand: opts.hand ?? 'R',
      fielders: opts.fielders ?? fieldersWith(),
      shares: SHARES,
      stuff: 50,
      velocityZ: 0,
      theta: opts.theta ?? 0,
      outs: outsBefore,
      bases: [...basesBefore] as Bases,
      batterRunner: runner(batter.id),
    });
    out.push({ ...r, basesBefore, outsBefore });
  }
  return out;
}
const isHit = (r: InPlayResult) => r.outcome === '1B' || r.outcome === '2B' || r.outcome === '3B';

describe('존 모델 분포와 앵커링 (10b §3·§6)', () => {
  it('모든 분포 합이 1이고, 있을 수 없는 조합(땅볼 펜스 앞, 강한 파울 뜬공)은 0이다. 좌타자는 방향이 거울상이다', () => {
    for (const type of ['GB', 'LD', 'FB'] as const) {
      expect(sum(qualityDist(type, 70, 40, 0.5))).toBeCloseTo(1, 12);
      const r = directionDist(type, 75, 'R');
      expect(sum(r)).toBeCloseTo(1, 12);
      expect(directionDist(type, 75, 'L')).toEqual([...r].reverse());
      for (const q of [0, 1, 2] as const) expect(sum(depthDist(type, q).map(([, p]) => p))).toBeCloseTo(1, 12);
    }
    expect(depthDist('GB', 2).map(([d]) => d)).toEqual(['IN']);
    expect(depthDist('FB', 2).some(([d]) => d === 'FO')).toBe(false);
    const cells = cellsFor(SHARES, 60, 45, 0.3, 'L');
    expect(sum(cells.map((c) => c.p))).toBeCloseTo(1, 10);
    for (const c of cells) expect(c.p).toBeGreaterThanOrEqual(0);
  });

  it('앵커링: 중립 조건의 기대 안타율이 x_match와 ±1e-4 안에서 같다(계산식으로 검사, 캐시 경로 포함)', () => {
    const cases: Array<[TypeShares, number, number, number, 'R' | 'L', number]> = [
      [SHARES, 50, 50, 0, 'R', 0.34],
      [{ GB: 0.6, LD: 0.15, FB: 0.25 }, 30, 70, 1.2, 'L', 0.28],
      [{ GB: 0.3, LD: 0.25, FB: 0.45 }, 85, 35, -0.8, 'R', 0.4],
    ];
    cases.forEach(([shares, power, stuff, velZ, hand, x], i) => {
      const cells = cellsFor(shares, power, stuff, velZ, hand);
      expect(Math.abs(neutralHitRate(cells, anchorTheta(cells, x)) - x)).toBeLessThan(1e-4);
      expect(Math.abs(neutralHitRate(cells, cachedTheta(9000 + i, shares, power, stuff, velZ, hand, x)) - x)).toBeLessThan(1e-4);
    });
  });

  it('같은 x_match에서 장타가 높으면 안타율은 그대로이고 장타(2·3루타) 비중이 커진다', () => {
    const shape = (power: number) => {
      const cells = cellsFor(SHARES, power, 50, 0, 'R');
      const e = expectedInPlay(cells, anchorTheta(cells, 0.33));
      const hits = e['1B'] + e['2B'] + e['3B'];
      return { hits, xbh: (e['2B'] + e['3B']) / hits };
    };
    const low = shape(35);
    const high = shape(80);
    expect(Math.abs(high.hits - low.hits)).toBeLessThan(2e-4);
    expect(high.xbh).toBeGreaterThan(low.xbh);
  });

  it('낯선 포지션은 유효 범위가 줄어 도달이 줄어든다', () => {
    const ss = { ...neutral('SS'), positions: { SS: 70 } };
    expect(effRange(ss, '1B')).toBeLessThan(effRange(ss, 'SS'));
  });
});

describe('수비 판정·주자 진루·기록 (10b §5·§8·§11)', () => {
  const N = 6000;

  it('유격수 범위 ↑ → 유격수 담당 구역 안타 ↓, 우익수 구역은 그대로', () => {
    const base = simulate(N, {});
    const good = simulate(N, { fielders: fieldersWith({ SS: neutral('SS', { range: 85 }) }) });
    const ssZone = (r: InPlayResult) => r.zone === 'S3-IN' || r.zone === 'S2-IN' || r.zone === 'S4-IN';
    const rfZone = (r: InPlayResult) => /^S[67]-(SH|DP|WL)$/.test(r.zone);
    expect(good.filter((r) => ssZone(r) && isHit(r)).length).toBeLessThan(base.filter((r) => ssZone(r) && isHit(r)).length);
    expect(good.filter((r) => rfZone(r) && isHit(r)).length).toBe(base.filter((r) => rfZone(r) && isHit(r)).length);
  });

  it('포구 ↑ → 실책 ↓(도달은 그대로), 송구 파워 ↑ → 내야 안타 ↓', () => {
    const base = simulate(N, {});
    const all = (o: { fielding?: number; armStrength?: number }) => fieldersWith(Object.fromEntries((['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as FieldPos[]).map((p) => [p, neutral(p, o)])));
    const sure = simulate(N, { fielders: all({ fielding: 85 }) });
    const errors = (rs: InPlayResult[]) => rs.filter((r) => r.credits.some((c) => c.kind === 'E')).length;
    expect(errors(sure)).toBeLessThan(errors(base));
    const arms = simulate(N, { fielders: all({ armStrength: 85 }) });
    expect(arms.filter((r) => r.infieldHit).length).toBeLessThan(base.filter((r) => r.infieldHit).length);
  });

  it('타자 주력 ↑ → 내야 안타 ↑, 병살 ↓', () => {
    const slow = simulate(N, { batter: batterWith({ speed: 30 }), bases: () => [runner(2), null, null], outs: () => 0 });
    const fast = simulate(N, { batter: batterWith({ speed: 80 }), bases: () => [runner(2), null, null], outs: () => 0 });
    expect(fast.filter((r) => r.infieldHit).length).toBeGreaterThan(slow.filter((r) => r.infieldHit).length);
    expect(fast.filter((r) => r.outcome === 'DP').length).toBeLessThan(slow.filter((r) => r.outcome === 'DP').length);
  });

  it('여러 상황에서: 아웃마다 자살 1개, 병살·희생플라이·인필드 플라이 조건, 주자 보존, 한 베이스 한 주자', () => {
    const states = Rng.fromSeed('states');
    let id = 10;
    const results = simulate(20000, {
      bases: () => [states.chance(0.5) ? runner(id++) : null, states.chance(0.4) ? runner(id++) : null, states.chance(0.3) ? runner(id++) : null],
      outs: () => states.int(0, 2),
    });
    let dpLoadedNoOut = 0;
    let dpLoadedOneOut = 0;
    for (const r of results) {
      const po = r.credits.filter((c) => c.kind === 'PO').length;
      expect(po).toBe(r.outsAdded);
      const before = r.basesBefore.filter(Boolean).length;
      if (r.outcome === 'DP') {
        expect(r.outsBefore).toBeLessThan(2);
        expect(r.basesBefore[0]).not.toBeNull();
        expect(r.outsAdded).toBe(2);
        if (r.basesBefore.every(Boolean)) {
          if (r.outsBefore === 0) {
            dpLoadedNoOut++;
            expect(r.scored).toHaveLength(1); // 0아웃 만루 병살: 3루 주자 득점 인정(타점 없음)
            expect(r.scored[0]!.rbi).toBe(false);
          } else {
            dpLoadedOneOut++;
            expect(r.scored).toHaveLength(0); // 1아웃이면 이닝 종료, 득점 불인정
          }
        }
      }
      if (r.outcome === 'SF') {
        expect(r.outsBefore).toBeLessThan(2);
        expect(r.scored.length).toBeGreaterThan(0);
      }
      // 인필드 플라이: 2아웃 미만, 1·2루 이상에서 내야 뜬공을 잡으면 타자만 아웃, 주자 그대로
      if (r.type === 'FB' && r.zone.endsWith('-IN') && r.outsBefore < 2 && r.basesBefore[0] && r.basesBefore[1] && r.outcome === 'FO' && r.outsAdded > 0) {
        expect(r.outsAdded).toBe(1);
        expect(r.bases).toEqual(r.basesBefore);
      }
      if (r.outsBefore + r.outsAdded < 3) {
        // 주자 보존: 전 주자 + 타자 = 득점 + 남은 주자 + 아웃
        expect(before + 1).toBe(r.scored.length + r.bases.filter(Boolean).length + r.outsAdded);
        const ids = r.bases.filter((x): x is Runner => x !== null).map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
    expect(dpLoadedNoOut + dpLoadedOneOut).toBeGreaterThan(0);
  });

  it('타석별 하위 난수 흐름: 같은 (경기 키, 경기, 타석)이면 같은 수열, 다른 타석이면 다른 수열', () => {
    expect(Rng.fromInts(5, 9, 3).next()).toBe(Rng.fromInts(5, 9, 3).next());
    expect(Rng.fromInts(5, 9, 3).next()).not.toBe(Rng.fromInts(5, 9, 4).next());
  });
});
