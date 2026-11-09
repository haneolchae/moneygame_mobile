// 타석 결과 확률 — 성적 혼합 없는 기준 모델 (10a 문서 2·3·5장, D-091). 계수는 probabilityConfig에만 둔다.
// 순서: 사구 → 볼넷 b → 삼진 k → 홈런 h → 홈런이 아닌 인플레이 타구는 유형(땅볼·라인드라이브·뜬공)을 먼저 정하고,
// 그 유형의 안타 확률로 안타 여부·종류와 아웃·실책을 정한다. 결과는 같은 조건부 구조를 펼친 분포이며 합은 1이다.
// 3b에서 최근·과거 성적 혼합(q_player)이 q_ability 자리에 들어온다.
import { PROBABILITY_CONFIG as C } from './probabilityConfig';
import type { Pitch, PlayerTruth } from './types';

/** 시즌 리그 환경: 기준값 대비 편차(예: 0.05 = +5%). 누적하지 않는다(D-100) */
export interface LeagueEnvironment {
  runs: number;
  hr: number;
  /** 시즌 재조정(D-103): 득점 로그 비율 보정(ln(목표/측정)). 없으면 0 */
  runsAdj?: number;
  /** 시즌 재조정(D-103): 홈런 기준 확률 배율. 없으면 1 */
  hrAdj?: number;
}
export const NEUTRAL_ENVIRONMENT: LeagueEnvironment = { runs: 0, hr: 0 };

/** 수비 쪽 팀 지수(능력 척도 1~100, 50 = 평균) */
export interface DefenseContext {
  infield: number;
  outfield: number;
  /** 포수 프레이밍 */
  framing: number;
}
export const NEUTRAL_DEFENSE: DefenseContext = { infield: 50, outfield: 50, framing: 50 };

export type PaProbabilities = Record<'BB' | 'K' | 'HR' | 'HBP' | '1B' | '2B' | '3B' | 'ROE' | 'GO' | 'FO', number>;

const clampP = (p: number) => Math.min(1 - C.probabilityFloor, Math.max(C.probabilityFloor, p));
export const logit = (p: number) => {
  const q = clampP(p);
  return Math.log(q / (1 - q));
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const z = (v: number) => (v - 50) / 50;

/**
 * 타자·투수 대결(10a 5장): logit(q) = logit(q_batter) + logit(q_pitcher) − logit(q_league) + delta_context.
 * 여기서 q_batter·q_pitcher는 각각 리그 기준에서 자기 능력만큼 옮긴 확률이다.
 */
export function matchProbability(league: number, batterLogitShift: number, pitcherLogitShift: number, context = 0): number {
  const L = logit(league);
  const qb = sigmoid(L + batterLogitShift);
  const qp = sigmoid(L + pitcherLogitShift);
  const ctx = Math.max(-C.context.maxAbsLogit, Math.min(C.context.maxAbsLogit, context));
  return sigmoid(logit(qb) + logit(qp) - L + ctx);
}

/** 구종 반영 실효 구위·제구: 구종 품질·제구의 선수 값 대비 잔차를 사용 비중으로 더한다 */
export function effectivePitching(p: PlayerTruth): { stuff: number; control: number; velocityZ: number } {
  const pr = p.pitching;
  if (!pr) return { stuff: 20, control: 20, velocityZ: -2 };
  const pitches: readonly Pitch[] = p.pitches ?? [];
  const w = pitches.reduce((a, x) => a + x.usage, 0) || 1;
  const quality = pitches.reduce((a, x) => a + (x.quality - pr.stuff) * x.usage, 0) / w;
  const command = pitches.reduce((a, x) => a + (x.command - pr.control) * x.usage, 0) / w;
  return {
    stuff: pr.stuff + C.pitchMix.qualityWeight * quality,
    control: pr.control + C.pitchMix.commandWeight * command,
    velocityZ: (pr.velocityAvg - C.velocity.leagueAvg) / C.velocity.sd,
  };
}

/** 타석 결과 확률(합 1). env: 시즌 리그 환경, defense: 수비 팀 지수 */
export function paProbabilities(batter: PlayerTruth, pitcher: PlayerTruth, defense: DefenseContext = NEUTRAL_DEFENSE, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT): PaProbabilities {
  const b = batter.batting;
  const p = effectivePitching(pitcher);
  const gbRating = pitcher.pitching?.groundball ?? 50;
  const hrScale = (1 + env.hr) * (env.hrAdj ?? 1);
  const runsShift = C.environment.runsLogitPerLogRatio * (Math.log(1 + env.runs) + (env.runsAdj ?? 0) - C.environment.hrRunsOffset * Math.log(hrScale));

  // 볼넷 b (사구가 아닌 타석 대비)
  const bb = matchProbability(C.base.b, C.walk.batterEye * z(b.eye) + C.walk.batterContact * z(b.contact) + runsShift, -C.walk.pitcherControl * z(p.control), -C.context.framingOnWalk * z(defense.framing));
  // 삼진 k (볼넷이 아닌 타석 대비)
  const k = matchProbability(C.base.k, -C.strikeout.batterContact * z(b.contact) - C.strikeout.batterEye * z(b.eye), C.strikeout.pitcherStuff * z(p.stuff) + C.strikeout.pitcherVelocity * p.velocityZ, C.context.framingOnStrikeout * z(defense.framing));
  // 홈런 h (볼넷·삼진이 아닌 타석 대비). 땅볼 유도는 쓰지 않는다.
  const h = matchProbability(C.base.h * hrScale, C.homeRun.batterPower * z(b.power) + C.homeRun.batterContact * z(b.contact), -C.homeRun.pitcherStuff * z(p.stuff));

  // 홈런이 아닌 인플레이 타구: 유형을 먼저 정한다(땅볼 유도는 이 분포에만 적용).
  const bbCfg = C.battedBall;
  const gb = sigmoid(logit(bbCfg.groundball) + bbCfg.pitcherGroundball * z(gbRating) - bbCfg.batterPower * z(b.power));
  const air = 1 - gb;
  const ld = air * (bbCfg.lineDrive / (bbCfg.lineDrive + bbCfg.flyBall));
  const fb = air - ld;
  const types = [
    { share: gb, cfg: C.hitByType.groundball, xb: C.extraBase.groundball, err: C.error.groundball, def: defense.infield, out: 'GO' as const },
    { share: ld, cfg: C.hitByType.lineDrive, xb: C.extraBase.lineDrive, err: C.error.lineDrive, def: defense.outfield, out: 'FO' as const },
    { share: fb, cfg: C.hitByType.flyBall, xb: C.extraBase.flyBall, err: C.error.flyBall, def: defense.outfield, out: 'FO' as const },
  ];

  const hbp = C.base.hbp;
  const pBB = (1 - hbp) * bb;
  const pK = (1 - hbp) * (1 - bb) * k;
  const pHR = (1 - hbp) * (1 - bb) * (1 - k) * h;
  const inPlay = (1 - hbp) * (1 - bb) * (1 - k) * (1 - h);
  const out: PaProbabilities = { BB: pBB, K: pK, HR: pHR, HBP: hbp, '1B': 0, '2B': 0, '3B': 0, ROE: 0, GO: 0, FO: 0 };
  for (const t of types) {
    const x = matchProbability(
      t.cfg.base,
      t.cfg.contact * z(b.contact) + t.cfg.speed * z(b.speed) + t.cfg.power * z(b.power) + runsShift,
      -t.cfg.stuff * z(p.stuff),
      -t.cfg.defense * z(t.def),
    );
    const mass = inPlay * t.share;
    const hits = mass * x;
    const triple = Math.min(0.5, t.xb.triple * Math.exp(C.extraBase.speedOnTriple * z(b.speed)));
    const double = Math.min(0.8 - triple, t.xb.double * Math.exp(C.extraBase.powerOnDouble * z(b.power)));
    out['3B'] += hits * triple;
    out['2B'] += hits * double;
    out['1B'] += hits * (1 - triple - double);
    const outs = mass - hits;
    const err = Math.min(0.2, t.err * Math.exp(-C.error.defense * z(t.def)));
    out.ROE += outs * err;
    out[t.out] += outs * (1 - err);
  }
  return out;
}

/** 시즌 리그 환경 다음 값(D-100): 직전 편차에서 −5%p·0·+5%p 이동, ±10% 안. pick은 0·1·2 중 하나(저장되는 리그 난수) */
export function nextEnvironmentDeviation(previous: number, pick: number): number {
  const step = (pick - 1) * C.environment.stepPct;
  const v = Math.round((previous + step) * 100) / 100;
  return Math.max(-C.environment.maxPct, Math.min(C.environment.maxPct, v));
}
