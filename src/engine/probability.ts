// 타석 결과 확률 (10a 문서 2~6장, D-091·D-102·D-107). 계수는 probabilityConfig에만 둔다.
// 순서: 사구 → 볼넷 b → 삼진 k → 홈런 h → 홈런이 아닌 인플레이 타구. 인플레이 타구는 유형(땅볼·라인드라이브·뜬공)을
// 정한 뒤 존 모델(10b, zone.ts)이 구역·수비수·판정·주자 진루를 정한다. 안타 여부의 기대값은 x_match에 고정된다.
// 대결 한쪽 값(batterSide·pitcherSide)은 최근·과거 성적을 섞은 q_player이며 경기마다 한 번 계산한다(form.ts).
import { logit, sigmoid } from './mathx';
import { PROBABILITY_CONFIG as C } from './probabilityConfig';
import { blendEvent, FORM_EVENTS, type FormEvent, type PlayerForm } from './form';
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

/** 사건별 리그 기준 로짓과 득점 환경 이동(D-100·D-103). 득점 이동은 타자 쪽 볼넷·인플레이 안타에 더한다 */
function leagueLogits(env: LeagueEnvironment): { L: SideLogits; runsShift: number } {
  const hrScale = (1 + env.hr) * (env.hrAdj ?? 1);
  const runsShift = C.environment.runsLogitPerLogRatio * (Math.log(1 + env.runs) + (env.runsAdj ?? 0) - C.environment.hrRunsOffset * Math.log(hrScale));
  return { L: { b: logit(C.base.b), k: logit(C.base.k), h: logit(C.base.h * hrScale), x: logit(C.inPlayHit.base) }, runsShift };
}

/** 대결 한쪽(타자 또는 투수)의 사건별 확률 로짓 logit(q_player). 성적 혼합 표본이 없으면 logit(q_ability) */
export type SideLogits = Record<FormEvent, number>;

const toSide = (shift: SideLogits, role: 'batter' | 'pitcher', form: PlayerForm | undefined, consistency: number): SideLogits => {
  const out = {} as SideLogits;
  for (const e of FORM_EVENTS) out[e] = logit(blendEvent(e, role, sigmoid(shift[e]), form, consistency));
  return out;
};

/** 타자 쪽(10a 3·4장): 능력치 로짓을 만들고 최근·과거 성적과 섞는다. 인플레이 안타는 컨택·장타만(D-102) */
export function batterSide(batter: PlayerTruth, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, form?: PlayerForm): SideLogits {
  const b = batter.batting;
  const { L, runsShift } = leagueLogits(env);
  const X = C.inPlayHit;
  return toSide(
    {
      b: L.b + C.walk.batterEye * z(b.eye) + C.walk.batterContact * z(b.contact) + runsShift,
      k: L.k - C.strikeout.batterContact * z(b.contact) - C.strikeout.batterEye * z(b.eye),
      h: L.h + C.homeRun.batterPower * z(b.power) + C.homeRun.batterContact * z(b.contact),
      x: L.x + X.contact * z(b.contact) + X.power * z(b.power) + runsShift,
    },
    'batter',
    form,
    batter.hidden.consistency,
  );
}

/** 투수 쪽(허용 확률): 구종 반영 실효 구위·제구·구속. 땅볼 유도는 타구 유형에만 쓴다 */
export function pitcherSide(pitcher: PlayerTruth, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, form?: PlayerForm): SideLogits {
  const p = effectivePitching(pitcher);
  const { L } = leagueLogits(env);
  const X = C.inPlayHit;
  return toSide(
    {
      b: L.b - C.walk.pitcherControl * z(p.control),
      k: L.k + C.strikeout.pitcherStuff * z(p.stuff) + C.strikeout.pitcherVelocity * p.velocityZ,
      h: L.h - C.homeRun.pitcherStuff * z(p.stuff),
      x: L.x - X.stuff * z(p.stuff) - X.velocity * p.velocityZ,
    },
    'pitcher',
    form,
    pitcher.hidden.consistency,
  );
}

/** 포수 프레이밍의 사건별 상황 보정(로짓) */
export function framingContext(defense: DefenseContext): SideLogits {
  return { b: -C.context.framingOnWalk * z(defense.framing), k: C.context.framingOnStrikeout * z(defense.framing), h: 0, x: 0 };
}

/**
 * 대결(10a 5장): logit(q) = logit(q_batter) + logit(q_pitcher) − logit(q_league) + delta_context.
 * context: 사건별 delta_context 합(프레이밍·수행 편차·압박). 사건마다 ±context.maxAbsLogit로 제한한다.
 */
export function combineTop(bat: SideLogits, pit: SideLogits, env: LeagueEnvironment, context: SideLogits, shares: TypeShares, stuff: number, velocityZ: number) {
  const { L } = leagueLogits(env);
  const cap = C.context.maxAbsLogit;
  const q = (e: FormEvent) => sigmoid(bat[e] + pit[e] - L[e] + Math.max(-cap, Math.min(cap, context[e])));
  const bb = q('b');
  const k = q('k');
  const h = q('h');
  const hbp = C.base.hbp;
  return {
    BB: (1 - hbp) * bb,
    K: (1 - hbp) * (1 - bb) * k,
    HR: (1 - hbp) * (1 - bb) * (1 - k) * h,
    HBP: hbp,
    inPlay: (1 - hbp) * (1 - bb) * (1 - k) * (1 - h),
    /** 인플레이 안타 x_match: 타자 주력·수비·구장은 존 모델에서만 적용한다(같은 효과를 두 번 넣지 않음) */
    x: q('x'),
    shares,
    stuff,
    velocityZ,
  };
}

/** 타석 위 단계(성적 혼합·수행 편차 없는 기준 모델): 사구·볼넷·삼진·홈런·인플레이(합 1)와 x_match */
export function topLevelProbabilities(batter: PlayerTruth, pitcher: PlayerTruth, defense: DefenseContext = NEUTRAL_DEFENSE, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT) {
  const p = effectivePitching(pitcher);
  return combineTop(batterSide(batter, env), pitcherSide(pitcher, env), env, framingContext(defense), typeShares(batter, pitcher), p.stuff, p.velocityZ);
}

export type TopLevel = ReturnType<typeof topLevelProbabilities>;

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
