// 계약·FA 협상 규칙 (08 문서, D-031·D-042·D-046·D-048). 순수 함수만 둔다.
// 협상 판단은 결정론적이다. 같은 날짜·같은 조건의 제안은 같은 결과를 낸다(08 문서: 수락 확률을 클릭마다 굴리지 않는다).
// 선수별 성향 차이는 stableNormal(시드·선수 ID 기반 고정값)로 만들며 난수 흐름을 쓰지 않는다.
// 외국인 규정 상수(FOREIGN)는 config에 있다.
export { FOREIGN, usdToWon, wonToUsd } from './config';
import { FOREIGN, wonToUsd } from './config';
import { stableNormal } from './rng';
import type { ClubProfile, PlayerTruth } from './types';
import { domesticSalary, overall } from './worldgen';

/** FA 협상 설정 (ASSUMPTION, D-075) */
export const FA_RULES = {
  premium: 1.25, // FA 시장 프리미엄
  bonusShare: 0.4, // 총액 중 계약금 비중(요구안)
  bonusWeight: 1.08, // 선수는 계약금(즉시 받는 돈)을 더 높게 친다
  thresholdStart: 1.0,
  thresholdDropPerWeek: 0.025,
  thresholdFloor: 0.82,
  counterWindow: 0.15,
  gradeShares: { A: 0.3, B: 0.6 },
  compensationMultiple: { A: 3, B: 2, C: 1.5 } as Record<'A' | 'B' | 'C', number>,
  aiCashReserve: 30 * 100_000_000,
  aiMaxOffersPerWeek: 2,
  salaryAcceptRatio: 0.98,
} as const;

export interface ContractOffer {
  years: number;
  salary: number; // 연봉(원)
  bonus: number; // 계약금 총액(원)
}

export const offerTotal = (o: ContractOffer) => o.salary * o.years + o.bonus;
const weighted = (o: ContractOffer) => o.salary * o.years + o.bonus * FA_RULES.bonusWeight;
const round1m = (won: number) => Math.max(0, Math.round(won / 1_000_000) * 1_000_000);

/** 리그가 공통으로 보는 선수 가치(시장 평가). 실제 능력에 고정 오차를 더한 값이다. */
export function publicOverall(seed: string, p: PlayerTruth): number {
  return overall(p) + stableNormal(seed, 'public', p.id) * 3;
}

/** 특정 구단의 평가(구단마다 다른 오차). AI는 이 값으로 판단하고 실제 능력을 직접 읽지 않는다. */
export function clubEstimate(seed: string, clubId: number, p: PlayerTruth): number {
  return overall(p) + stableNormal(seed, 'club-eval', clubId, p.id) * 5;
}

export function ageAt(p: PlayerTruth, year: number): number {
  return year - Number(p.birthDate.slice(0, 4));
}

/** FA 요구 조건: 나이에 따른 기간, 성향에 따른 금액, 계약금 비중 */
export function faDemand(seed: string, p: PlayerTruth, year: number): ContractOffer {
  const age = ageAt(p, year);
  const years = age <= 30 ? 4 : age <= 32 ? 3 : age <= 34 ? 2 : 1;
  const greed = 1 + 0.15 * ((p.hidden.competitiveness - 50) / 50) + stableNormal(seed, 'greed', p.id) * 0.04;
  // FA 선수는 직전 연봉보다 낮게 요구하지 않는다(직전 연봉의 105% 이상).
  const aav = Math.max(domesticSalary(publicOverall(seed, p), age, p.career.proSeasons) * FA_RULES.premium, p.salary * 1.05) * greed;
  const total = aav * years;
  const bonus = round1m(total * FA_RULES.bonusShare);
  return { years, salary: round1m((total - bonus) / years), bonus };
}

export type FaGrade = 'A' | 'B' | 'C';

/** FA 등급: FA 신청 선수 중 직전 연봉 상위 30% A, 30~60% B, 나머지 C (D-031) */
export function assignGrades(players: Array<{ id: number; salary: number }>): Map<number, FaGrade> {
  const sorted = [...players].sort((a, b) => b.salary - a.salary || a.id - b.id);
  const out = new Map<number, FaGrade>();
  sorted.forEach((p, i) => {
    const r = (i + 1) / sorted.length;
    out.set(p.id, r <= FA_RULES.gradeShares.A ? 'A' : r <= FA_RULES.gradeShares.B ? 'B' : 'C');
  });
  return out;
}

export function compensationFor(grade: FaGrade, priorSalary: number): number {
  return round1m(priorSalary * FA_RULES.compensationMultiple[grade]);
}

export interface OfferContext {
  seed: string;
  player: PlayerTruth;
  demand: ContractOffer;
  club: ClubProfile;
  isFormerClub: boolean;
}

/** 선수가 보는 제안의 매력도. 1.0 = 요구 조건과 같은 가치. */
export function offerScore(o: ContractOffer, ctx: OfferContext, year: number): number {
  let s = weighted(o) / weighted(ctx.demand);
  const age = ageAt(ctx.player, year);
  const diff = o.years - ctx.demand.years;
  if (diff < 0) s += 0.04 * diff; // 기간이 짧으면 불만
  else if (diff > 0) s += (age >= 31 ? 0.02 : 0.005) * diff; // 나이가 많을수록 긴 계약 선호
  s += ctx.club.strength === '상' ? 0.04 : ctx.club.strength === '하' ? -0.04 : 0;
  if (ctx.isFormerClub) s += 0.03 + (ctx.player.career.franchise ? 0.03 : 0);
  return s;
}

/** 주차가 지날수록 눈높이를 낮춘다. 선수마다 고정된 차이가 있다. */
export function acceptThreshold(seed: string, p: PlayerTruth, weeksSinceOpen: number): number {
  const base = FA_RULES.thresholdStart - FA_RULES.thresholdDropPerWeek * Math.max(0, weeksSinceOpen);
  return Math.max(FA_RULES.thresholdFloor, base) + stableNormal(seed, 'threshold', p.id) * 0.02;
}

export type OfferResponse = { kind: 'accept' } | { kind: 'counter'; counter: ContractOffer; message: string } | { kind: 'reject'; message: string };

/** 우리 제안에 대한 즉시 응답. 경쟁 제안 중 최고 매력도(bestOther)보다 낮으면 수락하지 않는다. */
export function respondToOffer(o: ContractOffer, ctx: OfferContext, year: number, weeksSinceOpen: number, bestOther: number): OfferResponse {
  const s = offerScore(o, ctx, year);
  const thr = acceptThreshold(ctx.seed, ctx.player, weeksSinceOpen);
  const need = Math.max(thr, bestOther + 0.01);
  if (s >= need) return { kind: 'accept' };
  if (s >= need - FA_RULES.counterWindow) {
    // 역제안: 요구 기간과 구조를 유지하고, 목표 매력도에 맞게 금액을 조정한다.
    const base = { ...ctx.demand };
    const baseScore = offerScore(base, ctx, year);
    // 매력도가 금액에 정비례하지 않고 백만 원 단위로 반올림하므로, 역제안을 그대로 받으면 수락되도록 1%씩 보정한다.
    let k = need / baseScore;
    let counter = { years: base.years, salary: round1m(base.salary * k), bonus: round1m(base.bonus * k) };
    for (let i = 0; i < 30 && offerScore(counter, ctx, year) < need; i++) {
      k *= 1.01;
      counter = { years: base.years, salary: round1m(base.salary * k), bonus: round1m(base.bonus * k) };
    }
    const msg = bestOther > thr ? '다른 구단에서 더 좋은 조건을 받았습니다. 이 정도는 맞춰 주셔야 합니다.' : '조금만 더 생각해 주시면 사인하겠습니다.';
    return { kind: 'counter', counter, message: msg };
  }
  return { kind: 'reject', message: '제안 조건이 기대와 차이가 큽니다.' };
}

/**
 * AI 구단의 제안: 선수의 요구 조건을 기준으로, 자기 평가가 시장 평가보다 높으면 더, 낮으면 덜 준다(±20%).
 * 우승 경쟁 구단은 3% 더, 리빌딩 구단은 10% 덜, 기간도 2년까지만 제안한다. 실제 능력은 읽지 않는다.
 */
export function aiOffer(seed: string, club: ClubProfile, p: PlayerTruth, demand: ContractOffer, year: number, contender: boolean, rebuilding: boolean): ContractOffer {
  void year;
  const valueRatio = Math.max(0.8, Math.min(1.2, Math.exp((clubEstimate(seed, club.id, p) - publicOverall(seed, p)) / 15)));
  const stance = contender ? 1.03 : rebuilding ? 0.9 : 0.97;
  const years = rebuilding ? Math.min(demand.years, 2) : demand.years;
  const total = (offerTotal(demand) / demand.years) * years * valueRatio * stance;
  const bonus = round1m(total * FA_RULES.bonusShare);
  return { years, salary: round1m((total - bonus) / years), bonus };
}

/** 보류 선수 연봉 협상 요구액: 시장 평가 기준. 최저 연봉 이상. */
export function salaryDemand(seed: string, p: PlayerTruth, year: number): number {
  return domesticSalary(publicOverall(seed, p), ageAt(p, year), p.career.proSeasons);
}

export function salaryAccepts(seed: string, p: PlayerTruth, offer: number, demand: number): boolean {
  return offer >= demand * (FA_RULES.salaryAcceptRatio + stableNormal(seed, 'salary-accept', p.id) * 0.01);
}

/** 외국인 재계약 요구: 직전 연봉의 112%(1만 달러 단위). 아시아쿼터는 직전 + 10만 달러 이하. */
export function foreignRenewalDemandUsd(p: PlayerTruth): number {
  const prev = wonToUsd(p.salary);
  const raised = Math.round((prev * 1.12) / 10_000) * 10_000;
  return p.origin === 'asia' ? Math.min(raised, prev + FOREIGN.asiaRenewalStepUsd) : raised;
}

/** 외국인 구성 검증 (D-046·D-048). 위반 사유 목록을 돌려준다. */
export function validateForeign(players: Array<{ origin: PlayerTruth['origin']; isPitcher: boolean; salaryUsd: number; renewals: number; isNew: boolean }>): string[] {
  const errors: string[] = [];
  const foreign = players.filter((p) => p.origin === 'foreign');
  const asia = players.filter((p) => p.origin === 'asia');
  if (foreign.length > FOREIGN.maxForeign) errors.push(`외국인은 ${FOREIGN.maxForeign}명까지 보유할 수 있습니다.`);
  if (asia.length > FOREIGN.maxAsia) errors.push('아시아쿼터는 1명까지 보유할 수 있습니다.');
  if (foreign.length === 3 && (foreign.every((p) => p.isPitcher) || foreign.every((p) => !p.isPitcher))) errors.push('외국인 3명이 모두 투수이거나 모두 야수일 수 없습니다.');
  for (const p of foreign) if (p.isNew && p.salaryUsd > FOREIGN.newCapUsd) errors.push('신규 외국인은 1인당 100만 달러를 넘을 수 없습니다.');
  const totalCap = FOREIGN.totalCapUsd + foreign.reduce((a, p) => a + p.renewals * FOREIGN.totalCapPerRenewalUsd, 0);
  const total = foreign.reduce((a, p) => a + p.salaryUsd, 0);
  if (total > totalCap) errors.push(`외국인 3명 총액(${(total / 10_000).toFixed(0)}만 달러)이 상한(${(totalCap / 10_000).toFixed(0)}만 달러)을 넘습니다.`);
  for (const p of asia) if (p.isNew && p.salaryUsd > FOREIGN.asiaNewCapUsd) errors.push('신규 아시아쿼터는 20만 달러를 넘을 수 없습니다.');
  return errors;
}

/** 샐러리캡 (D-040): 2026 143억 9,723만 원, 매년 5%. 외국인 제외 국내 선수 연봉 + 계약금 연평균. */
export function salaryCap(seasonYear: number): number {
  let cap = 14_397_230_000;
  for (let y = 2027; y <= seasonYear; y++) cap = Math.round(cap * 1.05);
  return cap;
}
