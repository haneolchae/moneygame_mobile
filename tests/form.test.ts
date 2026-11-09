// 최근·과거 성적 혼합·수행 편차·압박 (10a 9.1, D-090·D-107). 순수 함수만 검사해 빠르게 끝난다.
import { describe, expect, it } from 'vitest';
import { BATTER_DIRECTION, blendEvent, blendWeights, buildForm, emptySamples, FORM_EVENTS, PaCode, pressureIndex, pressureLoss, type PlayerForm } from '../src/engine/form';
import { batterSide, combineTop, framingContext, NEUTRAL_DEFENSE, NEUTRAL_ENVIRONMENT, pitcherSide, typeShares, type SideLogits } from '../src/engine/probability';
import { PROBABILITY_CONFIG } from '../src/engine/probabilityConfig';
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/worldgen';

const F = PROBABILITY_CONFIG.form;
const world = generateWorld(Rng.fromSeed('form'), 2026);
const hitter = world.find((p) => !p.isPitcher)!;
const pitcher = world.find((p) => p.isPitcher)!;

/** 볼넷(b) 사건에 최근·과거 원시 비율을 넣은 표본 */
function formB(recentRate: number, nRecent: number, historyRate: number, nHistory: number): PlayerForm {
  const f = { recent: emptySamples(), history: emptySamples() };
  f.recent.b = { succ: recentRate * nRecent, opp: nRecent };
  f.history.b = { succ: historyRate * nHistory, opp: nHistory };
  return f;
}

describe('성적 혼합 (10a 4장)', () => {
  it('비중: 충분 표본 50:30:20, 절반 75:15:10, 최근 없음 80:0:20, 기록 없음 100:0:0', () => {
    const nR = F.nRecent.batter.b;
    const nH = F.nHistory.b;
    const close = (w: { ability: number; recent: number; history: number }, a: number, r: number, h: number) => {
      expect(w.ability).toBeCloseTo(a, 12);
      expect(w.recent).toBeCloseTo(r, 12);
      expect(w.history).toBeCloseTo(h, 12);
    };
    close(blendWeights('b', 'batter', nR, nH), 0.5, 0.3, 0.2);
    close(blendWeights('b', 'batter', nR * 3, nH * 3), 0.5, 0.3, 0.2);
    close(blendWeights('b', 'batter', nR / 2, nH / 2), 0.75, 0.15, 0.1);
    close(blendWeights('b', 'batter', 0, nH), 0.8, 0, 0.2);
    close(blendWeights('b', 'batter', 0, 0), 1, 0, 0);
    expect(blendEvent('b', 'batter', 0.3, undefined, 50)).toBe(0.3);
  });

  it('문서 예시: 일관성은 최근 민감도만 바꾸고 호성적·부진에 대칭이다', () => {
    const nR = F.nRecent.batter.b;
    const nH = F.nHistory.b;
    const hot = formB(0.36, nR, 0.28, nH);
    expect(blendEvent('b', 'batter', 0.3, hot, 1)).toBeCloseTo(0.3212, 10);
    expect(blendEvent('b', 'batter', 0.3, hot, 50.5)).toBeCloseTo(0.314, 10);
    expect(blendEvent('b', 'batter', 0.3, hot, 100)).toBeCloseTo(0.3068, 10);
    const cold = formB(0.24, nR, 0.28, nH);
    expect(blendEvent('b', 'batter', 0.3, cold, 1)).toBeCloseTo(0.2708, 10);
    expect(blendEvent('b', 'batter', 0.3, cold, 50.5)).toBeCloseTo(0.278, 10);
    expect(blendEvent('b', 'batter', 0.3, cold, 100)).toBeCloseTo(0.2852, 10);
  });

  it('극단적인 호조·부진도 사건별 상한 d를 넘지 못한다(낮은 일관성 포함)', () => {
    for (const e of FORM_EVENTS) {
      const d = F.cap[e];
      for (const raw of [0, 1]) {
        const f = { recent: emptySamples(), history: emptySamples() };
        f.recent[e] = { succ: raw * 1000, opp: 1000 };
        f.history[e] = { succ: raw * 5000, opp: 5000 };
        const q = blendEvent(e, 'batter', 0.3, f, 1);
        expect(Math.abs(q - 0.3)).toBeLessThanOrEqual(d * 0.5 + 1e-12); // 최근 0.3·과거 0.2 비중 × 상한
      }
    }
  });

  it('최근·과거 창은 겹치지 않고, 경기 당일 이후 기록은 받지 않는다', () => {
    const today = 1000;
    const days: number[] = [];
    const codes: number[] = [];
    const total = emptySamples();
    const all = [PaCode.BB, PaCode.K, PaCode.HR, PaCode.HIT, PaCode.OUT, PaCode.HBP];
    for (let i = 0; i < 300; i++) {
      days.push(today - 120 + Math.floor(i / 2.5));
      codes.push(all[i % all.length]!);
    }
    // 가중치 1 합계
    for (const c of codes) {
      if (c === PaCode.HBP) continue;
      total.b.opp++;
      if (c === PaCode.BB) { total.b.succ++; continue; }
      total.k.opp++;
      if (c === PaCode.K) { total.k.succ++; continue; }
      total.h.opp++;
      if (c === PaCode.HR) { total.h.succ++; continue; }
      total.x.opp++;
      if (c === PaCode.HIT) total.x.succ++;
    }
    const form = buildForm(days, codes, days.length, today, 'batter', total);
    // 최근 창: 최대 100타석, 60일 이내 → 과거(현재 시즌분) + 최근 창 타석 수 = 전체
    const recentPa = days.filter((d, i) => i >= days.length - F.recentWindow.batterPa && today - d <= F.recentWindow.maxDays).length;
    expect(recentPa).toBeGreaterThan(0);
    const nonHbpRecent = codes.slice(days.length - recentPa).filter((c) => c !== PaCode.HBP).length;
    expect(form.history.b.opp + nonHbpRecent).toBe(total.b.opp);
    expect(() => buildForm([...days, today], [...codes, PaCode.OUT], days.length + 1, today, 'batter', total)).toThrow();
  });
});

describe('수행 편차·압박 (10a 6장)', () => {
  it('압박 0이면 손실 0, 멘탈이 높을수록 손실이 작다', () => {
    expect(pressureIndex({ inning: 3, scoreDiff: 6, runners: 3, postseason: false })).toBe(0);
    expect(pressureLoss(0, 1, 100)).toBe(0);
    const p = pressureIndex({ inning: 9, scoreDiff: 0, runners: 2, postseason: false });
    expect(p).toBeGreaterThan(0.9);
    expect(pressureLoss(p, 90, 50)).toBeLessThan(pressureLoss(p, 20, 50));
    expect(pressureLoss(p, 50, 10)).toBeLessThan(pressureLoss(p, 50, 90));
  });

  it('방향: 타자 수행 ↓ → 볼넷·홈런·인플레이 안타 ↓·삼진 ↑, 투수 멘탈이 좋으면 홈런 허용이 늘지 않는다', () => {
    const bs = batterSide(hitter);
    const ps = pitcherSide(pitcher);
    const top = (batPerf: number, pitPerf: number) => {
      const fr = framingContext(NEUTRAL_DEFENSE);
      const ctx = {} as SideLogits;
      for (const e of FORM_EVENTS) ctx[e] = fr[e] + BATTER_DIRECTION[e] * (batPerf - pitPerf);
      return combineTop(bs, ps, NEUTRAL_ENVIRONMENT, ctx, typeShares(hitter, pitcher), 50, 0);
    };
    const base = top(0, 0);
    const slump = top(-0.1, 0);
    expect(slump.BB).toBeLessThan(base.BB);
    expect(slump.HR).toBeLessThan(base.HR);
    expect(slump.x).toBeLessThan(base.x);
    expect(slump.K / (1 - slump.BB - slump.HBP)).toBeGreaterThan(base.K / (1 - base.BB - base.HBP));
    const p = pressureIndex({ inning: 9, scoreDiff: 1, runners: 1, postseason: true });
    const calm = top(0, -pressureLoss(p, 95, 50));
    const shaky = top(0, -pressureLoss(p, 10, 50));
    expect(calm.HR).toBeLessThan(shaky.HR);
    // 합계 상한: 어떤 수행 차이도 ±0.25 로짓을 넘지 않는다
    const huge = top(5, -5);
    const capped = top(PROBABILITY_CONFIG.context.maxAbsLogit, 0);
    expect(huge.x).toBeCloseTo(capped.x, 12);
  });
});
