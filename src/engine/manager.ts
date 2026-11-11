// 4c-2b 감독 능력치·성향·신뢰도(03·10a 11장, D-162·D-163·D-172). 순수 함수만 둔다.
// 감독 보정은 경기마다 우리 선수 사본에 더하고 저장된 선수 능력치는 바꾸지 않는다.
import { MANAGER as M } from './config';
import type { PlayerTruth } from './types';

/** 감독 능력치 8개 키(직원 기록 abilities에 둔다) */
export const MANAGER_KEYS = ['hitting', 'pitching', 'fieldRun', 'tactics', 'authority', 'leadership', 'condition', 'development'] as const;
export type ManagerKey = (typeof MANAGER_KEYS)[number];
export const MANAGER_LABEL: Record<ManagerKey, string> = {
  hitting: '타격 지휘',
  pitching: '투수 운용',
  fieldRun: '수비·주루 지휘',
  tactics: '작전',
  authority: '권위',
  leadership: '리더십',
  condition: '컨디션 관리',
  development: '육성',
};
/** 성향 2개(좋고 나쁨이 아닌 스타일, 0~100) */
export const TENDENCY_KEYS = ['smallBall', 'quickHook'] as const;
export const TENDENCY_LABEL: Record<(typeof TENDENCY_KEYS)[number], [string, string]> = { smallBall: ['빅볼', '스몰볼'], quickHook: ['선발 신뢰', '불펜 조기 투입'] };

export interface ManagerProfile {
  ratings: Record<ManagerKey, number>;
  smallBall: number;
  quickHook: number;
  /** 감독 신뢰도 0~100 */
  trust: number;
}

/** 평균 감독(보정 없음) */
export const NEUTRAL_MANAGER: ManagerProfile = {
  ratings: { hitting: 50, pitching: 50, fieldRun: 50, tactics: 50, authority: 50, leadership: 50, condition: 50, development: 50 },
  smallBall: 50,
  quickHook: 50,
  trust: 50,
};

export const mz = (v: number) => Math.max(-1, Math.min(1, (v - 50) / 50));

/** 신뢰도 배율 m(0.9~1.1)을 유리한 쪽으로만: 좋은 보정 × m, 나쁜 보정 × (2 − m) */
export function trustScaled(base: number, trust: number): number {
  const m = 0.9 + (0.2 * trust) / 100;
  return base >= 0 ? base * m : base * (2 - m);
}

/** 유효 능력치 보정 점수(11.1) */
export const ratingBonus = (m: ManagerProfile, key: ManagerKey) => trustScaled(mz(m.ratings[key]) * M.K, m.trust);

/** 배율 항목(1 + 계수 × z, 계수 부호가 유리한 방향이 되도록 호출하는 쪽이 정한다)의 신뢰도 반영 값 */
export function factor(m: ManagerProfile, key: ManagerKey, coef: number): number {
  return 1 + trustScaled(coef * mz(m.ratings[key]), m.trust);
}

/** 권위: 작전 수행 확률 로짓 보정 */
export const authorityLogit = (m: ManagerProfile) => trustScaled(M.authorityLogit * mz(m.ratings.authority), m.trust);

/** 리더십: 압박 손실·경기별 수행 편차 배율(작을수록 좋다) */
export const leadershipFactor = (m: ManagerProfile) => 1 - trustScaled(M.leadership * mz(m.ratings.leadership), m.trust);

/** 투수 운용: 경기 중 투구 수 소모 배율(작을수록 오래 던진다) */
export const staminaFactor = (m: ManagerProfile) => 1 - trustScaled(M.stamina * mz(m.ratings.pitching), m.trust);

/** 컨디션 관리: 경기 사이 부상 위험 배율 */
export const conditionFactor = (m: ManagerProfile) => 1 - trustScaled(M.condition * mz(m.ratings.condition), m.trust);

/** 육성: 집중 훈련 효과 배율 */
export const developmentFactor = (m: ManagerProfile) => 1 + trustScaled(M.development * mz(m.ratings.development), m.trust);

/** 작전: 감독 AI 판단 오차 표준편차 */
export const judgmentSd = (m: ManagerProfile) => M.judgmentSd * (1 - 0.5 * mz(m.ratings.tactics));

/** 스몰볼 성향: 도루·번트·히트앤드런 시도 비율 배율 */
export const smallBallFactor = (m: ManagerProfile) => 0.5 + m.smallBall / 100;

/** 불펜 조기 투입 성향: 선발 투구 수 한도 조정(구) */
export const hookAdjust = (m: ManagerProfile) => -(m.quickHook - 50) / M.quickHookDivisor;

const cap = (v: number) => Math.max(1, Math.min(100, v));

/**
 * 경기용 선수 사본: 타격 지휘·투수 운용·수비·주루 지휘 보정을 더한다(평균 감독이면 원본 그대로).
 * ASSUMPTION(D-172): 장타는 정수여야 존 모델의 묶음 계산(빠른 경로)을 쓰므로 보정 뒤 값을 경기마다 확률적으로 반올림한다
 * (powerRound는 선수·경기별 균등 난수, 소수 부분 확률로 올림 — 기대값은 보정 그대로).
 */
export function managedPlayer(p: PlayerTruth, m: ManagerProfile, powerRound = 0.5): PlayerTruth {
  const hit = ratingBonus(m, 'hitting');
  const pit = ratingBonus(m, 'pitching');
  const fld = ratingBonus(m, 'fieldRun');
  if (hit === 0 && pit === 0 && fld === 0) return p;
  const pw = cap(p.batting.power + hit);
  const power = Math.floor(pw) + (powerRound < pw - Math.floor(pw) ? 1 : 0);
  return {
    ...p,
    batting: { ...p.batting, contact: cap(p.batting.contact + hit), eye: cap(p.batting.eye + hit), power, speed: cap(p.batting.speed + fld), baserunning: cap(p.batting.baserunning + fld) },
    defense: { ...p.defense, range: cap(p.defense.range + fld), fielding: cap(p.defense.fielding + fld) },
    ...(p.pitching ? { pitching: { ...p.pitching, control: cap(p.pitching.control + pit), stuff: cap(p.pitching.stuff + pit) } } : {}),
  };
}

/** 결정 하나의 신뢰도 갱신(D-163): 결정 점수 = 승리 확률 변화 − 팀 기준선 */
export function nextTrust(trust: number, wpDelta: number, baseline: number): number {
  return Math.max(0, Math.min(100, trust + M.trust.gain * (wpDelta - baseline) * 100));
}

/** 팀 기준선 지수이동평균 갱신 */
export function nextBaseline(baseline: number, wpDelta: number): number {
  const a = 1 - Math.pow(0.5, 1 / M.trust.baselineHalfLife);
  return baseline + a * (wpDelta - baseline);
}

/** 시즌 마감: 신뢰도를 50 쪽으로 절반 되돌린다 */
export const regressTrust = (trust: number) => 50 + (trust - 50) * M.trust.seasonRegression;
