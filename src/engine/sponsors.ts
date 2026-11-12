// 6c 스폰서(16·23 문서, D-149). 순수 규칙: 후보, 구단 매력, 제안 생성, 기대 수입, 시즌 마감 정산.
// 금액 규모는 사용자 결정 대기인 임시 초기안이며 config.SPONSOR 한 곳에서 바꾼다.
import type { GameDate } from './calendar';
import { brandsFor, BRAND_INCENTIVES, BRAND_OBLIGATIONS, BRAND_STYLES, type BrandPayment, type BrandSpec } from './brands';
import { SPONSOR as S } from './config';
import { splitEvenly } from './money';
import { Rng } from './rng';
import type { ClubProfile } from './types';

export type SponsorSlot = 'main' | 'sub';
export type SponsorStyle = keyof typeof S.styles;
export type IncentiveKind = keyof typeof S.incentives;
export type ObligationKind = keyof typeof S.obligations;

export interface SponsorOffer {
  id: string;
  slot: SponsorSlot;
  brand: string;
  industry: string;
  tier: '상' | '중' | '하';
  style: SponsorStyle;
  /** 계약 시즌 */
  season: number;
  guaranteedWon: number;
  incentive: { kind: IncentiveKind; bonusWon: number };
  obligation: ObligationKind;
  /** 9b-1(D-236 (2)): 보장액 지급 방식(없는 옛 기록은 일시불) */
  payment?: BrandPayment;
}

export interface SponsorContract extends SponsorOffer {
  signed: GameDate;
  /** 기본 계약(사업제휴팀)·AI 선택 여부 */
  by: 'owner' | 'team' | 'ai';
  /** 9b-1: 지금까지 받은 보장액(없는 옛 기록은 체결일 전액) */
  paidWon?: number;
}

/** 보장액 지급 계획: 체결일 몫과 계약 시즌 월별 몫(월, 금액). 합계는 보장액과 정확히 같다 */
export function paymentPlan(c: Pick<SponsorOffer, 'guaranteedWon' | 'payment'>): { upfrontWon: number; monthly: Array<{ month: number; amountWon: number }> } {
  const kind = c.payment ?? 'lump';
  if (kind === 'lump') return { upfrontWon: c.guaranteedWon, monthly: [] };
  const upfrontWon = kind === 'mixed' ? Math.round((c.guaranteedWon * S.payment.mixedUpfront) / 1_000_000) * 1_000_000 : 0;
  const parts = splitEvenly(c.guaranteedWon - upfrontWon, S.payment.months.length);
  return { upfrontWon, monthly: S.payment.months.map((month, i) => ({ month, amountWon: parts[i]! })) };
}

/** 그 날짜(아직 처리하지 않은 날) 전까지 받았어야 할 보장액: 체결일 몫 + 지난 월말의 월별 몫 */
export function expectedPaid(c: SponsorContract, currentDate: GameDate): number {
  const plan = paymentPlan(c);
  let paid = plan.upfrontWon;
  for (const m of plan.monthly) {
    const nextMonth = m.month === 12 ? `${c.season + 1}-01-01` : `${c.season}-${String(m.month + 1).padStart(2, '0')}-01`;
    if (nextMonth <= currentDate) paid += m.amountWon;
  }
  return paid;
}

/** 받은 보장액(옛 기록은 체결일 전액) */
export const paidOf = (c: SponsorContract) => c.paidWon ?? c.guaranteedWon;

/** 구단 매력(0.7~1.4): 시장 규모·직전 시즌 승률·팬 만족도 */
export function appeal(club: ClubProfile, priorPct: number, satisfaction: number): number {
  const v = 1 + S.appealMarket * (club.marketSize - 1) + S.appealPct * (priorPct - 0.5) + S.appealSatisfaction * (satisfaction - 50);
  return Math.max(S.appealMin, Math.min(S.appealMax, v));
}

const round = (won: number) => Math.round(won / 10_000_000) * 10_000_000;

/**
 * D-246: 지급 방식별 금액 배율(일시불 0.90~1.00, 월별 1.00~1.20, 혼합 0.95~1.10). 제안 ID별 별도 난수 스트림이라
 * 제안 생성의 다른 난수(브랜드·유형·인센티브·의무)는 바뀌지 않는다. 1% 단위
 */
export function paymentFactor(seed: string, offerId: string, kind: BrandPayment): number {
  const [lo, hi] = S.payment.factor[kind];
  const steps = Math.round((hi - lo) * 100);
  return Math.round((lo * 100 + Rng.derive(seed, 'sponsorPay', offerId).int(0, steps))) / 100;
}

/** 그 구단·시즌의 제안(메인 4·서브 6). 같은 시드면 항상 같다 */
export function generateOffers(seed: string, season: number, club: ClubProfile, clubAppeal: number, staffBoost: number, inflation: number): SponsorOffer[] {
  const rng = Rng.derive(seed, 'sponsor', season, club.id);
  // 후보는 브랜드 리스트 파일의 sponsor 역할 브랜드(D-152). 세부 성향(traits)이 있으면 그 안에서 고른다
  const pool = rng.shuffle([...brandsFor('sponsor')]);
  const make = (slot: SponsorSlot, c: BrandSpec, i: number): SponsorOffer => {
    const style = pickStyle(rng, c, i);
    const id = `${season}-${club.id}-${slot}-${i}`;
    const payment = c.payment ?? 'lump';
    // D-246: 지급 방식별 금액 배율(인센티브는 보장액 비율이라 함께 움직인다)
    const base = (slot === 'main' ? S.mainBaseWon : S.subBaseWon) * clubAppeal * (S.tier[c.awareness] ?? 1) * (1 + staffBoost) * inflation * paymentFactor(seed, id, payment);
    const guaranteedWon = round(base * S.styles[style].guaranteed);
    return {
      id,
      slot,
      brand: c.name,
      industry: c.industry,
      tier: c.awareness,
      style,
      season,
      guaranteedWon,
      incentive: { kind: rng.pick(c.traits?.incentives ?? [...BRAND_INCENTIVES]), bonusWon: round(guaranteedWon * S.styles[style].incentive) },
      obligation: rng.pick(c.traits?.obligations ?? [...BRAND_OBLIGATIONS]),
      // 9b-1: 지급 방식은 브랜드 리스트에서(난수를 쓰지 않는다)
      payment,
    };
  };
  return [...pool.slice(0, S.mainOffers).map((c, i) => make('main', c, i)), ...pool.slice(S.mainOffers, S.mainOffers + S.subOffers).map((c, i) => make('sub', c, i))];
}

/** 제안 유형: 브랜드의 유형 가중치가 있으면 그 비율로, 없으면 고르게(순번으로 섞어 한쪽에 몰리지 않게) */
function pickStyle(rng: Rng, c: BrandSpec, i: number): SponsorStyle {
  const w = c.traits?.style;
  if (!w) return BRAND_STYLES[(i + rng.int(0, BRAND_STYLES.length - 1)) % BRAND_STYLES.length]!;
  const total = BRAND_STYLES.reduce((a, k) => a + (w[k] ?? 0), 0);
  let x = rng.next() * total;
  for (const k of BRAND_STYLES) {
    x -= w[k] ?? 0;
    if (x < 0) return k;
  }
  return 'balanced';
}

/** AI·기본 계약의 기대 수입 */
export const expectedValue = (o: SponsorOffer) => o.guaranteedWon + o.incentive.bonusWon * S.aiIncentiveWeight;

export interface SeasonFacts {
  postseason: boolean;
  rank: number;
  occupancy: number;
  satisfaction: number;
  campaigns: number;
  /** 8e-2: 그 시즌 올스타 선정 인원, 미스터 올스타 배출 */
  allStars?: number;
  mrAllstar?: boolean;
}

/** 시즌 마감 정산: 인센티브 지급액과 의무 미달 반환액 */
export function settle(c: SponsorContract, f: SeasonFacts): { incentiveWon: number; refundWon: number } {
  const k = c.incentive.kind;
  const met = k === 'postseason' ? f.postseason : k === 'top3' ? f.rank <= S.topRank : k === 'occupancy' ? f.occupancy >= S.occupancyGoal : k === 'allstar3' ? (f.allStars ?? 0) >= S.allStarGoal : k === 'mrAllstar' ? !!f.mrAllstar : f.satisfaction >= S.satisfactionGoal;
  const broke = c.obligation === 'campaigns' && f.campaigns < S.campaignsRequired;
  return { incentiveWon: met ? c.incentive.bonusWon : 0, refundWon: broke ? Math.round(c.guaranteedWon * S.refundShare) : 0 };
}

/** 슬롯 한도와 업종 독점: 새 제안을 받을 수 없는 이유(없으면 null) */
export function slotReason(contracts: readonly SponsorContract[], o: SponsorOffer): string | null {
  const same = contracts.filter((c) => c.season === o.season);
  if (same.some((c) => c.id === o.id)) return '이미 체결한 제안입니다.';
  if (same.some((c) => c.industry === o.industry)) return `같은 업종(${o.industry}) 스폰서가 이미 있습니다(업종 독점).`;
  const used = same.filter((c) => c.slot === o.slot).length;
  if (used >= (o.slot === 'main' ? S.mainSlots : S.subSlots)) return o.slot === 'main' ? '메인 스폰서 자리가 이미 찼습니다.' : `서브 스폰서 ${S.subSlots}자리가 모두 찼습니다.`;
  return null;
}
