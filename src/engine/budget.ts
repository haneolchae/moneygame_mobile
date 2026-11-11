// 6e 예산 배분(D-176·D-177): 예산안 형식, 기본값, 운영비 배수의 효과. 상태를 갖지 않는 순수 함수만 둔다.
import type { ClubStance } from './aiClub';
import { BUDGET_PLAN as B } from './config';
import { salaryCap } from './contracts';

export type OpsKind = 'scouting' | 'futures' | 'teamOps';
export type CapKind = 'payroll' | 'facility' | 'marketing' | 'merch';
export const OPS_KINDS: readonly OpsKind[] = ['scouting', 'futures', 'teamOps'];
export const CAP_KINDS: readonly CapKind[] = ['payroll', 'facility', 'marketing', 'merch'];

/** 예산 연도 한 해의 예산안. 한도는 그해 명목 금액(원) */
export interface BudgetPlan {
  year: number;
  ops: Record<OpsKind, number>;
  caps: Record<CapKind, number>;
  /** 누가 정했나: 구단주, 경영지원팀 자동 편성 */
  setBy: 'owner' | 'auto';
  date: string;
}

export const NEUTRAL_OPS: Record<OpsKind, number> = { scouting: 1, futures: 1, teamOps: 1 };

/** 물가 지수(2026 = 1)를 받아 그해 기본 한도를 만든다 */
export function defaultCaps(year: number, inflation: number): Record<CapKind, number> {
  const r = (won: number) => Math.round((won * inflation) / B.capStepWon) * B.capStepWon;
  return {
    payroll: Math.round((salaryCap(year) + B.defaultCapsWon.payrollExtra * inflation) / B.capStepWon) * B.capStepWon,
    facility: r(B.defaultCapsWon.facility),
    marketing: r(B.defaultCapsWon.marketing),
    merch: r(B.defaultCapsWon.merch),
  };
}

export function defaultPlan(year: number, inflation: number, date: string): BudgetPlan {
  return { year, ops: { ...NEUTRAL_OPS }, caps: defaultCaps(year, inflation), setBy: 'auto', date };
}

export const validMultiplier = (m: number) => Number.isFinite(m) && m >= B.minMultiplier - 1e-9 && m <= B.maxMultiplier + 1e-9 && Math.abs(m / B.multiplierStep - Math.round(m / B.multiplierStep)) < 1e-9;

/** AI 구단 운영비 배수(D-177 (5)): 운영 상태를 따른다. 스카우트 추정 모델은 우리 구단만 있어 1 */
export function aiOps(stance: ClubStance | null): Record<OpsKind, number> {
  const s = B.aiOps[stance ?? 'middle'];
  return { scouting: 1, futures: s.futures, teamOps: s.teamOps };
}

const lg = (m: number) => Math.log2(Math.max(B.minMultiplier, m));
/** 스카우트 추정 오차 배율(작을수록 정확) */
export const scoutingFactor = (m: number) => 1 - B.effects.scoutingPerDoubling * lg(m);
/** 집중 훈련 효과 배율 */
export const trainingFactor = (m: number) => 1 + B.effects.trainingPerDoubling * lg(m);
/** 메디컬 역량 가산(0~1 범위는 호출하는 쪽이 자른다) */
export const medicalBonus = (m: number) => B.effects.medicalPerDoubling * lg(m);
