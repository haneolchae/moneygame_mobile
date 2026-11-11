// 4c-1 볼카운트 층·승부처(D-161·D-167·D-168): 체인 흡수 확률의 정확성(수식 vs 표본), 대결 맞춤 오차, 기준표의 결과별 평균 투구 수,
// 투구 단위 진행의 카운트·투구 수 일관성, 승부처는 7회 이후만·같은 시드 같은 경기, 'all' 모드에서도 득점 분포가 크게 변하지 않음
import { describe, expect, it } from 'vitest';
import { CLUTCH, SIM } from '../src/engine/config';
import { chainSummary, fitMatchup, meanPitches, runCountPa, type CountTable } from '../src/engine/count';
import COUNT_MODEL from '../src/engine/data/countModel.json';
import { simulateGame, type GameResult } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/worldgen';
import { leverage, winProbability } from '../src/engine/winProb';

const P0 = (COUNT_MODEL as { table: CountTable }).table;

function games(n: number, opts: Parameters<typeof simulateGame>[6] = {}, seed = 'count-test'): GameResult[] {
  const world = generateWorld(Rng.fromSeed('count-world'), 2026);
  const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
  const active = (c: number) => world.filter((p) => p.clubId === c && p.level === '1군');
  const out: GameResult[] = [];
  for (let g = 0; g < n; g++) {
    const h = clubs[g % clubs.length]!;
    const a = clubs[(g * 3 + 1) % clubs.length]!;
    if (h === a) continue;
    out.push(simulateGame(5000 + g, prepareTeam(h, active(h), [], null), prepareTeam(a, active(a), [], null), Rng.derive(seed, 'game', g), 11, undefined, opts));
  }
  return out;
}

describe('볼카운트 층 (4c-1)', () => {
  it('설정 파일: 기준표 12행·각 행 합 1, 승리 확률 표 채워짐', () => {
    expect(P0).toHaveLength(12);
    for (const row of P0) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(leverage(9, 'B', 2, 7, 0, false)).toBeGreaterThan(2); // 9회말 2사 만루 동점은 큰 승부처
    expect(leverage(9, 'T', 2, 0, 9, false)).toBeLessThan(0.2); // 9회초 2사 9점 차는 승부처 아님
    expect(winProbability(1, 'T', 0, 0, 0, false)).toBeGreaterThan(0.45);
    expect(winProbability(1, 'T', 0, 0, 0, false)).toBeLessThan(0.6);
    expect(winProbability(9, 'B', 2, 0, 3, false)).toBe(1);
  });

  it('흡수 확률 수식이 표본 진행과 맞고(표본 오차 안), 투구 수 = 볼 + 스트라이크 + 파울(+ 마지막 사구·인플레이)', () => {
    const fit = fitMatchup(P0, { BB: 0.12, K: 0.28, HBP: 0.011 }, CLUTCH.fitTolerance, CLUTCH.fitMaxIter);
    expect(fit.ok).toBe(true);
    const want = chainSummary(fit.table);
    const n = 40_000;
    const got = { BB: 0, K: 0, HBP: 0, IP: 0 };
    let pitches = 0;
    for (let i = 0; i < n; i++) {
      const r = runCountPa(fit.table, (k) => Rng.fromKeys(7, i, 3, k).next(), CLUTCH.maxPitches);
      got[r.result]++;
      pitches += r.pitches;
      const terminal = r.result === 'HBP' || r.result === 'IP' ? 1 : 0;
      expect(r.pitches).toBe(r.balls + r.strikeEvents + r.fouls + terminal);
      expect(r.strikes).toBeGreaterThanOrEqual(r.strikeEvents);
      if (r.result === 'BB') expect(r.balls).toBe(4);
      if (r.result === 'K') expect(r.strikes).toBe(3);
    }
    const se = (p: number) => 4 * Math.sqrt((p * (1 - p)) / n);
    expect(Math.abs(got.BB / n - want.absorb[0])).toBeLessThan(se(want.absorb[0]));
    expect(Math.abs(got.K / n - want.absorb[1])).toBeLessThan(se(want.absorb[1]));
    expect(Math.abs(got.IP / n - want.absorb[3])).toBeLessThan(se(want.absorb[3]));
    const mean = want.pitchMass.reduce((a, b) => a + b, 0);
    expect(Math.abs(pitches / n - mean)).toBeLessThan(0.05);
  });

  it('대결 맞춤: 격자 전체에서 사건별 오차 0.002 이하, 리그 기준 대결의 결과별 평균 투구 수가 기존 모델 ±0.1', () => {
    for (const bb of [0.03, 0.115, 0.2])
      for (const k of [0.08, 0.24, 0.4]) {
        const f = fitMatchup(P0, { BB: bb, K: k, HBP: 0.011 }, CLUTCH.fitTolerance, CLUTCH.fitMaxIter);
        expect(f.ok).toBe(true);
        expect(f.maxError).toBeLessThan(0.002);
      }
    const m = meanPitches(chainSummary(P0));
    expect(Math.abs(m[0] - SIM.pitches.bb)).toBeLessThan(0.1);
    expect(Math.abs(m[1] - SIM.pitches.k)).toBeLessThan(0.1);
    expect(Math.abs(m[2] - SIM.pitches.hbp)).toBeLessThan(0.1);
    expect(Math.abs(m[3] - SIM.pitches.other)).toBeLessThan(0.1);
  });

  it('승부처는 7회 이후만, 투구 수가 종료 조건에 맞고, 같은 시드면 같은 경기', () => {
    const a = games(40);
    let clutch = 0;
    for (const g of a)
      for (const e of g.events) {
        if (!e.clutch) continue;
        clutch++;
        expect(e.inning).toBeGreaterThanOrEqual(CLUTCH.minInning);
        expect(e.countFallback).toBeUndefined();
        const c = e.count!;
        if (e.outcome === 'BB') expect([c.balls, e.pitches >= 4]).toEqual([4, true]);
        if (e.outcome === 'K') expect([c.strikes, e.pitches >= 3]).toEqual([3, true]);
      }
    expect(clutch).toBeGreaterThan(0);
    expect(JSON.stringify(games(40))).toBe(JSON.stringify(a));
    // 승부처 판정을 끄면 볼카운트 타석이 없다
    expect(games(10, { countLayer: 'off' }).some((g) => g.events.some((e) => e.clutch))).toBe(false);
  });

  it("모든 타석을 볼카운트로 진행해도(all) 볼넷·삼진 비율이 타석 단위와 표본 오차 안", () => {
    const rate = (gs: GameResult[], o: string) => {
      const ev = gs.flatMap((g) => g.events);
      return ev.filter((e) => e.outcome === o).length / ev.length;
    };
    const off = games(300, { countLayer: 'off' }, 'rate');
    const all = games(300, { countLayer: 'all' }, 'rate');
    const n = off.flatMap((g) => g.events).length;
    for (const o of ['BB', 'K']) {
      const p = rate(off, o);
      expect(Math.abs(rate(all, o) - p)).toBeLessThan(4 * Math.sqrt((2 * p * (1 - p)) / n));
    }
  });
});
