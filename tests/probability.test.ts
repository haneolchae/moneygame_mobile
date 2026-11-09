// 타석 확률 기준 모델 (10a 문서 9.1 단위 테스트, D-086~D-088·D-091·D-100)
import { describe, expect, it } from 'vitest';
import { matchProbability, nextEnvironmentDeviation, paProbabilities, NEUTRAL_DEFENSE, type DefenseContext } from '../src/engine/probability';
import { PROBABILITY_CONFIG } from '../src/engine/probabilityConfig';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

const world = generateWorld(Rng.fromSeed('prob'), 2026);
const baseHitter = world.find((p) => !p.isPitcher && p.origin === 'domestic')!;
const basePitcher = world.find((p) => p.isPitcher && p.position === 'SP' && p.origin === 'domestic')!;

/** 모든 능력이 50인 기준 선수에서 일부만 바꾼다(다른 조건 고정) */
function hitter(over: Partial<PlayerTruth['batting']> = {}): PlayerTruth {
  const flat = Object.fromEntries(Object.keys(baseHitter.batting).map((k) => [k, 50])) as unknown as PlayerTruth['batting'];
  return { ...baseHitter, batting: { ...flat, ...over } };
}
function pitcher(over: Partial<NonNullable<PlayerTruth['pitching']>> = {}): PlayerTruth {
  const pr = basePitcher.pitching!;
  const flat = { ...pr, stuff: 50, control: 50, groundball: 50, velocityAvg: PROBABILITY_CONFIG.velocity.leagueAvg };
  return { ...basePitcher, pitching: { ...flat, ...over }, pitches: [] };
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const gbShare = (b: PlayerTruth, p: PlayerTruth) => {
  const r = paProbabilities(b, p);
  return r.GO / (r.GO + r.FO);
};

describe('타석 확률 기준 모델 (10a)', () => {
  it('모든 사건 확률이 0~1이고 합은 1이다(극단 능력·환경 포함)', () => {
    const cases: Array<[PlayerTruth, PlayerTruth, DefenseContext, { runs: number; hr: number }]> = [
      [hitter(), pitcher(), NEUTRAL_DEFENSE, { runs: 0, hr: 0 }],
      [hitter({ contact: 100, power: 100, eye: 100, speed: 100 }), pitcher({ stuff: 1, control: 1 }), { infield: 1, outfield: 1, framing: 1 }, { runs: 0.1, hr: 0.1 }],
      [hitter({ contact: 1, power: 1, eye: 1, speed: 1 }), pitcher({ stuff: 100, control: 100, groundball: 100 }), { infield: 100, outfield: 100, framing: 100 }, { runs: -0.1, hr: -0.1 }],
    ];
    for (const [b, p, d, env] of cases) {
      const r = paProbabilities(b, p, d, env);
      for (const v of Object.values(r)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(r)) expect(v).toBeLessThanOrEqual(1);
      expect(sum(r)).toBeCloseTo(1, 10);
    }
  });

  it('대결 공식: 한쪽이 리그 평균이면 다른 쪽 값이 유지되고, 둘 다 평균이면 리그 평균이다', () => {
    expect(matchProbability(0.2, 0, 0)).toBeCloseTo(0.2, 10);
    const alone = 1 / (1 + Math.exp(-(Math.log(0.2 / 0.8) + 0.4)));
    expect(matchProbability(0.2, 0.4, 0)).toBeCloseTo(alone, 10);
    // 상황 보정은 ±0.25 로짓을 넘지 않는다.
    expect(matchProbability(0.2, 0, 0, 5)).toBeCloseTo(matchProbability(0.2, 0, 0, 0.25), 10);
  });

  it('부호 고정: 컨택 ↑ → 삼진 ↓, 장타 ↑ → 홈런 ↑, 선구안 ↑ → 볼넷 ↑, 제구 ↑ → 볼넷 허용 ↓, 구위 ↑ → 삼진 ↑', () => {
    expect(paProbabilities(hitter({ contact: 70 }), pitcher()).K).toBeLessThan(paProbabilities(hitter(), pitcher()).K);
    expect(paProbabilities(hitter({ power: 70 }), pitcher()).HR).toBeGreaterThan(paProbabilities(hitter(), pitcher()).HR);
    expect(paProbabilities(hitter({ eye: 70 }), pitcher()).BB).toBeGreaterThan(paProbabilities(hitter(), pitcher()).BB);
    expect(paProbabilities(hitter(), pitcher({ control: 70 })).BB).toBeLessThan(paProbabilities(hitter(), pitcher()).BB);
    expect(paProbabilities(hitter(), pitcher({ stuff: 70 })).K).toBeGreaterThan(paProbabilities(hitter(), pitcher()).K);
  });

  it('땅볼 유도 ↑ → 땅볼 비율 ↑, 홈런 확률은 변하지 않는다(타구 유형 단계에만 적용)', () => {
    const low = paProbabilities(hitter(), pitcher({ groundball: 30 }));
    const high = paProbabilities(hitter(), pitcher({ groundball: 80 }));
    expect(gbShare(hitter(), pitcher({ groundball: 80 }))).toBeGreaterThan(gbShare(hitter(), pitcher({ groundball: 30 })));
    expect(high.HR).toBeCloseTo(low.HR, 12);
    expect(high.BB).toBeCloseTo(low.BB, 12);
    expect(high.K).toBeCloseTo(low.K, 12);
  });

  it('수비가 좋으면 인플레이 안타가 줄고, 포수 프레이밍이 좋으면 볼넷이 줄고 삼진이 는다', () => {
    const hitsOf = (d: DefenseContext) => {
      const r = paProbabilities(hitter(), pitcher(), d);
      return r['1B'] + r['2B'] + r['3B'];
    };
    expect(hitsOf({ infield: 75, outfield: 75, framing: 50 })).toBeLessThan(hitsOf(NEUTRAL_DEFENSE));
    const framed = paProbabilities(hitter(), pitcher(), { ...NEUTRAL_DEFENSE, framing: 80 });
    const base = paProbabilities(hitter(), pitcher());
    expect(framed.BB).toBeLessThan(base.BB);
    expect(framed.K).toBeGreaterThan(base.K);
  });

  it('시즌 리그 환경: 5%p 단계로만 움직이고 ±10%를 넘지 않으며, 홈런 편차는 홈런 확률에 반영된다(D-100)', () => {
    expect(nextEnvironmentDeviation(0, 0)).toBe(-0.05);
    expect(nextEnvironmentDeviation(0, 1)).toBe(0);
    expect(nextEnvironmentDeviation(0, 2)).toBe(0.05);
    expect(nextEnvironmentDeviation(0.1, 2)).toBe(0.1);
    expect(nextEnvironmentDeviation(-0.1, 0)).toBe(-0.1);
    let v = 0;
    const rng = Rng.fromSeed('env');
    for (let i = 0; i < 200; i++) {
      v = nextEnvironmentDeviation(v, rng.int(0, 2));
      expect(Math.abs(v)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    const hrUp = paProbabilities(hitter(), pitcher(), NEUTRAL_DEFENSE, { runs: 0, hr: 0.1 }).HR;
    const hr0 = paProbabilities(hitter(), pitcher()).HR;
    expect(hrUp / hr0).toBeGreaterThan(1.07);
    expect(hrUp / hr0).toBeLessThan(1.11);
  });
});

describe('능력치 데이터 구조 (D-086~D-088)', () => {
  it('능력치는 1~100, 구속은 km/h, 구종 사용 비중 합은 1, 히든 요소는 12종이다', () => {
    for (const p of world) {
      const scale = [...Object.values(p.batting), ...Object.values(p.defense), ...Object.values(p.catcher ?? {})];
      if (p.pitching) {
        const { velocityAvg, velocityMax, ...rest } = p.pitching;
        scale.push(...Object.values(rest));
        expect(velocityAvg).toBeGreaterThan(125);
        expect(velocityAvg).toBeLessThan(165);
        expect(velocityMax).toBeGreaterThan(velocityAvg);
        expect(p.pitches!.length).toBeGreaterThanOrEqual(2);
        expect(p.pitches!.reduce((a, x) => a + x.usage, 0)).toBeCloseTo(1, 6);
      }
      for (const v of scale) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(100);
      }
      const { potential: _potential, ...traits } = p.hidden;
      expect(Object.keys(traits)).toHaveLength(13); // 성장 속도·정점 나이·노화 속도(성장·노화 곡선) 포함 12종 + 잠재 상한
      if (p.position === 'C') expect(p.catcher).toBeDefined();
      if (!p.isPitcher) expect(p.positions[p.position]).toBeGreaterThanOrEqual(50);
    }
  });
});
