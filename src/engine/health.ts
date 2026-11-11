// 4b-1 건강(12 문서, D-126): 피로는 최근 출전 기록에서 계산하고, 부상은 경기 뒤 출전 선수마다 한 번 판정한다.
// 난수는 저장 시드에서 날짜·선수로 파생해 처리 순서·재조회와 무관하다. 실제 복귀일은 숨기고 진단 추정 범위만 공개한다.
import { addDays, diffDays, type GameDate } from './calendar';
import { HEALTH as H } from './config';
import { Rng } from './rng';
import { intensityInjury } from './training';
import type { InjuryState, PlayerTruth } from './types';

const HITTER_PARTS = ['햄스트링', '허리', '손목', '발목', '옆구리', '어깨', '무릎', '손가락'];
const PITCHER_PARTS = ['팔꿈치', '어깨', '옆구리', '허리', '손가락 물집', '햄스트링', '전완근'];

/** 야수 피로: 최근 7일 출전 경기(경과일 감쇠), 포수 가중 */
export function hitterFatigue(daysAgo: number[], catcher: boolean): number {
  const raw = daysAgo.filter((d) => d >= 0 && d < H.fatigueDays).reduce((a, d) => a + H.hitterGameLoad * H.fatigueDecay ** d, 0);
  return Math.min(100, Math.round(raw * (catcher ? H.catcherFactor : 1)));
}

/** 투수 피로: 최근 7일 투구 수(경과일 감쇠) */
export function pitcherFatigue(usage: Array<{ daysAgo: number; pitches: number }>): number {
  return Math.min(100, Math.round(usage.filter((u) => u.daysAgo >= 0 && u.daysAgo < H.fatigueDays).reduce((a, u) => a + u.pitches * H.pitchLoad * H.fatigueDecay ** u.daysAgo, 0)));
}

/** 출전 1회 부상 확률 */
export function injuryChance(p: PlayerTruth, fatigue: number, age: number, eventMult = 1): number {
  const ageF = 1 + Math.max(0, age - H.agePivot) * H.agePerYear;
  const durF = H.durabilityMax - (H.durabilitySpan * p.hidden.durability) / 100;
  // 4b-2(D-128): 집중 훈련 강도 배수(계획 없으면 1). EV-2(D-205 (3)): 카드 부상 위험 배율과 곱해 상한 ×3.0
  const mult = eventMult === 1 ? intensityInjury(p) : Math.min(H.maxRiskMult, intensityInjury(p) * eventMult);
  return H.baseInjuryChance * (1 + fatigue / H.fatigueDivisor) * ageF * durF * mult;
}

/** 부상 위험 등급(특별 검사 보고용): 기준 확률 대비 */
export function riskLevel(chance: number): '낮음' | '보통' | '높음' {
  const ratio = chance / H.baseInjuryChance;
  return ratio < 1.1 ? '낮음' : ratio < 1.6 ? '보통' : '높음';
}

/**
 * 경기 뒤 부상 판정(출전한 선수만, 날짜·선수당 한 번). 부상이면 상태를 만들어 돌려준다.
 * medical: 컨디셔닝·메디컬팀 역량(0~1) — 실제 기간을 줄이고 진단 범위를 좁힌다.
 */
export function rollInjury(seed: string, date: GameDate, p: PlayerTruth, fatigue: number, age: number, medical: number, active: boolean, eventMult = 1): InjuryState | null {
  const rng = Rng.derive(seed, 'injury', date, p.id);
  if (!rng.chance(injuryChance(p, fatigue, age, eventMult))) return null;
  let pick = rng.next();
  const sev = H.severities.find((s) => (pick -= s.share) < 0) ?? H.severities[H.severities.length - 1]!;
  const base = rng.int(sev.min, sev.max);
  const days = Math.max(1, Math.round(base * (1 - H.maxRecoveryCut * medical)));
  const width = H.estimateWidthWorst - (H.estimateWidthWorst - H.estimateWidthBest) * medical;
  // 진단 오차: 추정 중심이 실제와 어긋날 수 있다(역량이 높을수록 작다).
  const center = days * (1 + rng.normal(0, width / 2));
  const lo = Math.max(1, Math.round(center * (1 - width)));
  const hi = Math.max(lo, Math.round(center * (1 + width)));
  return {
    part: rng.pick(p.isPitcher ? PITCHER_PARTS : HITTER_PARTS),
    severity: sev.label,
    date,
    returnDate: addDays(date, days + 1),
    estimate: { from: addDays(date, lo + 1), to: addDays(date, hi + 1) },
    demoted: false,
    wasActive: active,
  };
}

/** 그날 출전 불가인가(부상 발생 다음 날부터 복귀일 전날까지) */
export function injuredOn(inj: InjuryState | null | undefined, date: GameDate): boolean {
  return !!inj && diffDays(date, inj.date) > 0 && diffDays(date, inj.returnDate) < 0;
}

/** 추정 복귀까지 남은 일수(추정 범위 끝 기준) */
export function estimatedDaysLeft(inj: InjuryState, date: GameDate): number {
  return Math.max(0, diffDays(inj.estimate.to, date));
}
