// 6d 굿즈(15 문서, D-153). 순수 규칙: 판매가·원가, 수요, 입고·이동평균 원가, 판매(재고 한도), 자동 재주문 수량.
import { type GameDate } from './calendar';
import { MERCH as M } from './config';
import { stableNormal } from './rng';

export type Sku = keyof typeof M.skus;
export type VendorKind = keyof typeof M.vendors;
export const SKUS = Object.keys(M.skus) as Sku[];
export const VENDOR_KINDS = Object.keys(M.vendors) as VendorKind[];

export interface Vendor {
  kind: VendorKind;
  /** 브랜드 파트너일 때 브랜드 이름(리스트 파일에서 복사) */
  brand?: string;
  season: number;
}

export interface MerchOrder {
  sku: Sku;
  qty: number;
  unitCostWon: number;
  arrive: GameDate;
}

export interface SkuTotals {
  sold: number;
  revenueWon: number;
  cogsWon: number;
  received: number;
}

export interface MerchState {
  vendor: Vendor;
  /** 스토브리그에 고른 다음 시즌 업체 */
  nextVendor?: Vendor;
  stock: Record<Sku, { qty: number; avgCostWon: number }>;
  orders: MerchOrder[];
  auto: boolean;
  targetWeeks: number;
  /** 이번 주 판매(진행 중)와 지난 주들(최근 4주) */
  week: Record<Sku, number>;
  recent: Array<Record<Sku, number>>;
  /** 직전 홈경기 수요(온라인 판매 기준) */
  lastDemand: Record<Sku, number>;
  totals: Record<string, Record<Sku, SkuTotals>>;
}

const zero = (): Record<Sku, number> => ({ uniform: 0, cap: 0, cheer: 0 });
export const emptyTotals = (): Record<Sku, SkuTotals> => ({ uniform: { sold: 0, revenueWon: 0, cogsWon: 0, received: 0 }, cap: { sold: 0, revenueWon: 0, cogsWon: 0, received: 0 }, cheer: { sold: 0, revenueWon: 0, cogsWon: 0, received: 0 } });

export function newMerch(season: number): MerchState {
  return { vendor: { kind: 'standard', season }, stock: { uniform: { qty: 0, avgCostWon: 0 }, cap: { qty: 0, avgCostWon: 0 }, cheer: { qty: 0, avgCostWon: 0 } }, orders: [], auto: true, targetWeeks: M.targetWeeksDefault, week: zero(), recent: [], lastDemand: zero(), totals: {} };
}

export const unitPrice = (sku: Sku, inflation: number) => Math.round((M.skus[sku].priceWon * inflation) / 100) * 100;
export const unitCost = (sku: Sku, vendor: VendorKind, inflation: number) => Math.round(unitPrice(sku, inflation) * M.vendors[vendor].costRate);

/** 팬 만족도의 굿즈 수요 배수(관중과 같은 ±15%, 팬 반발은 ×0.7) */
export const merchFanFactor = (satisfaction: number) => (satisfaction < 20 ? M.backlashDemand : 1 + (M.demandSlope * (satisfaction - 50)) / 50);

/** 홈경기 하루 수요(개). 같은 경기·상품은 항상 같은 값 */
export function gameDemand(seed: string, fixtureKey: string | number, sku: Sku, attendance: number, vendor: VendorKind, satisfaction: number): number {
  const v = M.vendors[vendor];
  const noise = 1 + Math.max(-2, Math.min(2, stableNormal(seed, 'merch', fixtureKey, sku))) * (M.noise / 2);
  return Math.max(0, Math.round(attendance * M.skus[sku].buyRate * (sku === 'uniform' ? v.uniformDemand : v.demand) * merchFanFactor(satisfaction) * noise));
}

/** 도착한 발주를 재고에 넣는다(이동평균 원가). 입고 수량을 돌려준다 */
export function receive(s: MerchState, date: GameDate, season: number): Record<Sku, number> {
  const got = zero();
  const rest: MerchOrder[] = [];
  for (const o of s.orders) {
    if (o.arrive > date) {
      rest.push(o);
      continue;
    }
    const st = s.stock[o.sku];
    st.avgCostWon = Math.round((st.qty * st.avgCostWon + o.qty * o.unitCostWon) / (st.qty + o.qty));
    st.qty += o.qty;
    got[o.sku] += o.qty;
    totalsOf(s, season)[o.sku].received += o.qty;
  }
  s.orders = rest;
  return got;
}

export function totalsOf(s: MerchState, season: number): Record<Sku, SkuTotals> {
  return (s.totals[String(season)] ??= emptyTotals());
}

/** 판매: 입고된 재고까지만. 매출을 돌려준다 */
export function sell(s: MerchState, sku: Sku, demand: number, priceWon: number, season: number): number {
  const st = s.stock[sku];
  const qty = Math.max(0, Math.min(demand, st.qty));
  if (qty === 0) return 0;
  st.qty -= qty;
  s.week[sku] += qty;
  const t = totalsOf(s, season)[sku];
  t.sold += qty;
  t.revenueWon += qty * priceWon;
  t.cogsWon += qty * st.avgCostWon;
  return qty * priceWon;
}

/** 주가 바뀔 때: 이번 주 판매를 지난 주 목록으로 넘긴다 */
export function rollWeek(s: MerchState): void {
  s.recent = [...s.recent, s.week].slice(-M.recentWeeks);
  s.week = zero();
}

/** 첫 발주용 주간 수요 추정(판매 기록이 없을 때) */
export function baselineWeekly(sku: Sku, capacity: number, vendor: VendorKind): number {
  const v = M.vendors[vendor];
  const perGame = capacity * M.baselineOccupancy * M.skus[sku].buyRate * (sku === 'uniform' ? v.uniformDemand : v.demand);
  return Math.round(perGame * (M.baselineGamesPerWeek + (7 - M.baselineGamesPerWeek) * M.onlineShare));
}

/** 자동 재주문 수량: 최근 평균 판매 × 목표 주수 − (재고 + 입고 예정). 최소 발주량 미만이면 최소 발주량 */
export function reorderQty(s: MerchState, sku: Sku, baseline: number): number {
  const weekly = s.recent.length ? s.recent.reduce((a, w) => a + w[sku], 0) / s.recent.length : baseline;
  const onOrder = s.orders.filter((o) => o.sku === sku).reduce((a, o) => a + o.qty, 0);
  const need = Math.round(Math.max(weekly, baseline * 0.25) * s.targetWeeks) - s.stock[sku].qty - onOrder;
  return need > 0 ? Math.max(need, M.vendors[s.vendor.kind].minOrder[sku]) : 0;
}
