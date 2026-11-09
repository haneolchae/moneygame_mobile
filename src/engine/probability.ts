// 타석 결과 확률 — 성적 혼합 없는 기준 모델 (10a 문서 2·3·5장, D-091·D-102). 계수는 probabilityConfig에만 둔다.
// 순서: 사구 → 볼넷 b → 삼진 k → 홈런 h → 홈런이 아닌 인플레이 타구. 인플레이 타구는 유형(땅볼·라인드라이브·뜬공)을
// 정한 뒤 존 모델(10b, zone.ts)이 구역·수비수·판정·주자 진루를 정한다. 안타 여부의 기대값은 x_match에 고정된다.
// 3b에서 최근·과거 성적 혼합(q_player)이 q_ability 자리에 들어온다.
import { logit, sigmoid } from './mathx';
import { PROBABILITY_CONFIG as C } from './probabilityConfig';
import type { Pitch, PlayerTruth } from './types';
import { anchorTheta, cellsFor, expectedInPlay, type TypeShares } from './zone';

export { logit, sigmoid };

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

/** 수비 쪽 상황 보정(능력 척도 1~100, 50 = 평균). 개인 수비 능력은 존 모델(10b)이 수비수별로 쓴다 */
export interface DefenseContext {
  /** 포수 프레이밍 */
  framing: number;
}
export const NEUTRAL_DEFENSE: DefenseContext = { framing: 50 };

export type PaProbabilities = Record<'BB' | 'K' | 'HR' | 'HBP' | '1B' | '2B' | '3B' | 'ROE' | 'GO' | 'FO', number>;

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

/** 실효 투구 값 캐시: 같은 선수 객체(같은 날 같은 능력)면 다시 계산하지 않는다(성능용, 결과 동일) */
const EFFECTIVE_CACHE = new WeakMap<PlayerTruth, { stuff: number; control: number; velocityZ: number }>();

/** 구종 반영 실효 구위·제구: 구종 품질·제구의 선수 값 대비 잔차를 사용 비중으로 더한다 */
export function effectivePitching(p: PlayerTruth): { stuff: number; control: number; velocityZ: number } {
  const hit = EFFECTIVE_CACHE.get(p);
  if (hit) return hit;
  const v = computeEffectivePitching(p);
  EFFECTIVE_CACHE.set(p, v);
  return v;
}

function computeEffectivePitching(p: PlayerTruth): { stuff: number; control: number; velocityZ: number } {
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

/** 그 타석의 타격 방향: 스위치 타자는 투수 반대쪽(10b §1) */
export function battingSide(batter: PlayerTruth, pitcher: PlayerTruth): 'R' | 'L' {
  if (batter.bats === 'S') return pitcher.throws === 'L' ? 'R' : 'L';
  return batter.bats;
}

/** 타구 유형 비율: 땅볼 유도 ↑ → 땅볼 ↑(이 분포에만 적용), 타자 장타 ↑ → 띄우는 쪽 */
export function typeShares(batter: PlayerTruth, pitcher: PlayerTruth): TypeShares {
  const bbCfg = C.battedBall;
  const gb = sigmoid(logit(bbCfg.groundball) + bbCfg.pitcherGroundball * z(pitcher.pitching?.groundball ?? 50) - bbCfg.batterPower * z(batter.batting.power));
  const air = 1 - gb;
  const ld = air * (bbCfg.lineDrive / (bbCfg.lineDrive + bbCfg.flyBall));
  return { GB: gb, LD: ld, FB: air - ld };
}

/** 타석 위 단계: 사구·볼넷·삼진·홈런·인플레이(합 1)와 인플레이 안타 확률 x_match(10a, D-102: 타자 컨택·장타, 투수 구위·구속만) */
export function topLevelProbabilities(batter: PlayerTruth, pitcher: PlayerTruth, defense: DefenseContext = NEUTRAL_DEFENSE, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT) {
  const b = batter.batting;
  const p = effectivePitching(pitcher);
  const hrScale = (1 + env.hr) * (env.hrAdj ?? 1);
  const runsShift = C.environment.runsLogitPerLogRatio * (Math.log(1 + env.runs) + (env.runsAdj ?? 0) - C.environment.hrRunsOffset * Math.log(hrScale));
  // 볼넷 b (사구가 아닌 타석 대비)
  const bb = matchProbability(C.base.b, C.walk.batterEye * z(b.eye) + C.walk.batterContact * z(b.contact) + runsShift, -C.walk.pitcherControl * z(p.control), -C.context.framingOnWalk * z(defense.framing));
  // 삼진 k (볼넷이 아닌 타석 대비)
  const k = matchProbability(C.base.k, -C.strikeout.batterContact * z(b.contact) - C.strikeout.batterEye * z(b.eye), C.strikeout.pitcherStuff * z(p.stuff) + C.strikeout.pitcherVelocity * p.velocityZ, C.context.framingOnStrikeout * z(defense.framing));
  // 홈런 h (볼넷·삼진이 아닌 타석 대비). 땅볼 유도는 쓰지 않는다.
  const h = matchProbability(C.base.h * hrScale, C.homeRun.batterPower * z(b.power) + C.homeRun.batterContact * z(b.contact), -C.homeRun.pitcherStuff * z(p.stuff));
  // 인플레이 안타 x_match: 타자 주력·수비·구장은 존 모델에서만 적용한다(같은 효과를 두 번 넣지 않음).
  const X = C.inPlayHit;
  const x = matchProbability(X.base, X.contact * z(b.contact) + X.power * z(b.power) + runsShift, -X.stuff * z(p.stuff) - X.velocity * p.velocityZ);
  const hbp = C.base.hbp;
  return {
    BB: (1 - hbp) * bb,
    K: (1 - hbp) * (1 - bb) * k,
    HR: (1 - hbp) * (1 - bb) * (1 - k) * h,
    HBP: hbp,
    inPlay: (1 - hbp) * (1 - bb) * (1 - k) * (1 - h),
    x,
    shares: typeShares(batter, pitcher),
    stuff: p.stuff,
    velocityZ: p.velocityZ,
  };
}

export type TopLevel = ReturnType<typeof topLevelProbabilities>;

interface TopEntry {
  contact: number;
  power: number;
  eye: number;
  stuff: number;
  control: number;
  velocityZ: number;
  groundball: number;
  framing: number;
  runs: number;
  hr: number;
  runsAdj: number;
  hrAdj: number;
  top: TopLevel;
}
const TOP_CACHE = new Map<number, TopEntry[]>();
const TOP_CACHE_MAX = 100_000;
/**
 * 타석 위 단계 확률 캐시(성능용, 결과 동일): 결과를 정하는 입력(타자 컨택·장타·선구안, 투수 실효 구위·제구·구속·땅볼 유도,
 * 포수 프레이밍, 시즌 환경)이 모두 같을 때만 다시 쓴다. 저장하지 않는다.
 */
export function cachedTopLevel(batter: PlayerTruth, pitcher: PlayerTruth, defense: DefenseContext, env: LeagueEnvironment): TopLevel {
  const b = batter.batting;
  const p = effectivePitching(pitcher);
  const gb = pitcher.pitching?.groundball ?? 50;
  const key = batter.id * 1_000_003 + pitcher.id;
  const list = TOP_CACHE.get(key);
  const runsAdj = env.runsAdj ?? 0;
  const hrAdj = env.hrAdj ?? 1;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.contact === b.contact && e.power === b.power && e.eye === b.eye && e.stuff === p.stuff && e.control === p.control && e.velocityZ === p.velocityZ && e.groundball === gb && e.framing === defense.framing && e.runs === env.runs && e.hr === env.hr && e.runsAdj === runsAdj && e.hrAdj === hrAdj) {
        // 최근에 쓴 항목을 앞으로(다른 세이브의 같은 ID 항목이 섞여도 첫 비교에서 맞게)
        if (i > 0) [list[0], list[i]] = [e, list[0]!];
        return e.top;
      }
    }
  }
  if (TOP_CACHE.size >= TOP_CACHE_MAX) TOP_CACHE.clear();
  const top = topLevelProbabilities(batter, pitcher, defense, env);
  const entry: TopEntry = { contact: b.contact, power: b.power, eye: b.eye, stuff: p.stuff, control: p.control, velocityZ: p.velocityZ, groundball: gb, framing: defense.framing, runs: env.runs, hr: env.hr, runsAdj, hrAdj, top };
  if (list) list.unshift(entry);
  else TOP_CACHE.set(key, [entry]);
  return top;
}

/** 존 모델 앵커링(10b §6): 이 대결의 구역 칸과 x 고정 보정 θ */
export function anchorFor(batter: PlayerTruth, top: ReturnType<typeof topLevelProbabilities>, hand: 'R' | 'L'): { theta: number; cells: ReturnType<typeof cellsFor> } {
  const cells = cellsFor(top.shares, batter.batting.power, top.stuff, top.velocityZ, hand);
  return { theta: anchorTheta(cells, top.x), cells };
}

/**
 * 타석 결과 기대 분포(합 1). 인플레이 부분은 존 모델의 중립 조건 기대값(평균 수비·평균 주력)이다.
 * 경기 진행은 topLevelProbabilities + 존 모델 추첨을 쓰고, 이 함수는 시작 이전 기록 생성·검증에 쓴다.
 */
export function paProbabilities(batter: PlayerTruth, pitcher: PlayerTruth, defense: DefenseContext = NEUTRAL_DEFENSE, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT): PaProbabilities {
  const top = topLevelProbabilities(batter, pitcher, defense, env);
  const { theta, cells } = anchorFor(batter, top, battingSide(batter, pitcher));
  const ip = expectedInPlay(cells, theta);
  return {
    BB: top.BB,
    K: top.K,
    HR: top.HR,
    HBP: top.HBP,
    '1B': top.inPlay * ip['1B'],
    '2B': top.inPlay * ip['2B'],
    '3B': top.inPlay * ip['3B'],
    ROE: top.inPlay * ip.ROE,
    GO: top.inPlay * ip.GO,
    FO: top.inPlay * ip.FO,
  };
}

/** 시즌 리그 환경 다음 값(D-100): 직전 편차에서 −5%p·0·+5%p 이동, ±10% 안. pick은 0·1·2 중 하나(저장되는 리그 난수) */
export function nextEnvironmentDeviation(previous: number, pick: number): number {
  const step = (pick - 1) * C.environment.stepPct;
  const v = Math.round((previous + step) * 100) / 100;
  return Math.max(-C.environment.maxPct, Math.min(C.environment.maxPct, v));
}
