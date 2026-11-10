// 4b-2 집중 훈련(11 문서, D-128). 순수 규칙: 유효 계획, 목표 검증, 담당 코치 파트, 코치·수용도 계수, 능력별 훈련 강도.
// 효과는 4a 연간 기대 변화에 곱해지고(development.withTraining), 반영 주기·월 상한·잠재 상한은 4a 그대로다.
import { TRAINING as T } from './config';
import { devKeys } from './development';
import type { PlayerTruth, TrainingIntensity, TrainingPlan } from './types';

export const INTENSITIES: readonly TrainingIntensity[] = ['low', 'normal', 'high'];

/** 지금 효과를 내는 계획: 소속 구단이 세운 계획만 */
export function activePlan(p: PlayerTruth): TrainingPlan | null {
  const t = p.training;
  return t && !p.retired && p.clubId !== null && t.clubId === p.clubId ? t : null;
}

export function trainingKeys(p: PlayerTruth): string[] {
  return devKeys(p).map((k) => k.key);
}

/** 계획 형식 오류(없으면 null) */
export function planError(p: PlayerTruth, primary: string, secondary: string | null, intensity: string): string | null {
  const keys = trainingKeys(p);
  if (!keys.includes(primary)) return '이 선수에게 맞지 않는 주 목표입니다.';
  if (secondary !== null && !keys.includes(secondary)) return '이 선수에게 맞지 않는 보조 목표입니다.';
  if (secondary === primary) return '주 목표와 보조 목표가 같습니다.';
  if (!(INTENSITIES as readonly string[]).includes(intensity)) return '강도는 낮음·보통·높음 중 하나입니다.';
  return null;
}

/** 담당 코치 파트(D-128 초기안): 목표와 1·2군으로 자동 배정 */
export function coachPart(p: PlayerTruth, key: string): string {
  const fut = p.level !== '1군';
  if (p.isPitcher) return fut ? '퓨처스 투수' : '투수';
  if (key === 'speed') return fut ? '퓨처스 주루·배터리' : '작전·주루(1루)';
  if (key === 'range' || key === 'fielding') {
    if (p.position === 'C') return fut ? '퓨처스 주루·배터리' : '배터리';
    return fut ? '퓨처스 수비' : '수비';
  }
  return fut ? '퓨처스 타격' : '타격';
}

export const coachCapacity = (communication: number) => T.loadBase + Math.floor(communication / T.loadPer);

/** 코치·수용도 계수 0.8~1.2 */
export function coachFactor(coaching: number, coachability: number): number {
  return T.coachMin + (T.coachSpan * (T.coachWeight * coaching + (1 - T.coachWeight) * coachability)) / 100;
}

/** 담당 과부하 계수: 한도 이하 1, 넘으면 한도/인원 */
export const overloadFactor = (load: number, capacity: number) => (load > capacity ? capacity / load : 1);

/**
 * 능력별 훈련 강도(주 목표 1, 보조 0.5) × 코치·과부하 계수 × 강도 가중 기간 비율.
 * weighted = 지난 30일 중 유효·비부상 날의 그날 강도 효과 합 / 30 (모두 보통이면 0~1, 모두 높음이면 최대 1.3)
 */
export function planStrength(plan: TrainingPlan, factor: number, weighted: number): Record<string, number> {
  const base = factor * Math.max(0, Math.min(T.intensity.high.effect, weighted));
  const out: Record<string, number> = {};
  if (base <= 0) return out;
  out[plan.primary] = base;
  if (plan.secondary) out[plan.secondary] = T.secondaryShare * base;
  return out;
}

/** 부상 위험 배수(4b-1 부상 확률에 곱함) */
export function intensityInjury(p: PlayerTruth): number {
  const plan = activePlan(p);
  return plan ? T.intensity[plan.intensity].injury : 1;
}
