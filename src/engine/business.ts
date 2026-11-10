// 6a 관중·티켓·시설(13·14·16 문서, D-141). 순수 규칙만 둔다: 점유율, 입장·매점 수입, 시설 공사비·기간·지급 일정·효과.
import { addDays, type GameDate } from './calendar';
import { ATTENDANCE as A, FACILITY as F, MARKETING as M } from './config';
import { stableNormal } from './rng';
import type { ClubProfile } from './types';

export type TicketPolicy = keyof typeof A.policy;
export type FacilityKind = keyof typeof F.kinds;
export const FACILITY_KINDS = Object.keys(F.kinds) as FacilityKind[];

export interface FacilityProject {
  kind: FacilityKind;
  toLevel: number;
  costWon: number;
  /** 착수(행동력·승인 요청)일, 착공일, 완공일 */
  requested: GameDate;
  start: GameDate;
  end: GameDate;
  /** 지급 일정과 지급 여부 */
  payments: Array<{ date: GameDate; amountWon: number; paid: boolean }>;
}

export interface ClubFacilities {
  levels: Record<FacilityKind, number>;
  projects: FacilityProject[];
}

export const newFacilities = (): ClubFacilities => ({ levels: { stadium: 1, training: 1, rehab: 1, scouting: 1 }, projects: [] });

export interface AttendanceInput {
  seed: string;
  fixtureId: number;
  home: ClubProfile;
  away: ClubProfile;
  /** 0=일 … 6=토 */
  weekday: number;
  /** 이번 시즌 홈팀 승·패, 직전 시즌 승률(없으면 0.5) */
  wins: number;
  losses: number;
  priorPct: number;
  policy: TicketPolicy;
  stadiumLevel: number;
  /** 6b: 팬 만족도(없으면 50)와 진행 캠페인 수요 보정(0~0.08) */
  satisfaction?: number;
  campaignDemand?: number;
}

/** 점유율(0.2~1.0). 같은 경기는 항상 같은 값(경기 ID 고정 편차) */
export function occupancy(i: AttendanceInput): number {
  const pct = blendedPct(i.wins, i.losses, i.priorPct);
  const perf = 1 + (A.loyaltySensitivity[i.home.loyalty] ?? 0.5) * (pct - 0.5) * 2;
  const v =
    A.baseOccupancy *
    (A.marketBase + A.marketSlope * i.home.marketSize) *
    (A.loyaltyBase[i.home.loyalty] ?? 1) *
    perf *
    (A.weekday[i.weekday] ?? 1) *
    (1 + A.opponentSlope * (i.away.marketSize - 1)) *
    A.policy[i.policy].demand *
    (1 + F.stadiumDemandPerLevel * (i.stadiumLevel - 1)) *
    fanDemand(i.satisfaction ?? M.startSatisfaction) *
    (1 + Math.min(M.maxDemandBoost, i.campaignDemand ?? 0)) *
    (1 + Math.max(-2, Math.min(2, stableNormal(i.seed, 'attendance', i.fixtureId))) * (A.noise / 2));
  return Math.max(A.minOccupancy, Math.min(1, v));
}

export interface GateResult {
  attendance: number;
  ticketWon: number;
  concessionWon: number;
  gateFeeWon: number;
}

/** 한 경기 관중·수입. inflation = 그 시즌 물가 지수(2026 = 1) */
export function gate(i: AttendanceInput, inflation: number): GateResult {
  const attendance = Math.min(i.home.stadiumCapacity, Math.round(i.home.stadiumCapacity * occupancy(i)));
  const price = Math.round(A.ticketPriceWon * inflation * A.policy[i.policy].price);
  const ticketWon = attendance * price;
  const perHead = Math.round(A.concessionPerHeadWon * inflation * (1 + F.stadiumConcessionPerLevel * (i.stadiumLevel - 1)));
  const concessionWon = Math.round((attendance * perHead * A.concessionShareBp) / 10_000);
  return { attendance, ticketWon, concessionWon, gateFeeWon: Math.round((ticketWon * A.gateFeeBp) / 10_000) };
}

// ───────── 6b 팬 만족도·캠페인 (D-147) ─────────

export type CampaignKind = keyof typeof M.campaigns;
export const CAMPAIGN_KINDS = Object.keys(M.campaigns) as CampaignKind[];

export interface Campaign {
  kind: CampaignKind;
  start: GameDate;
  /** 이날까지 효과(포함) */
  end: GameDate;
  costWon: number;
}

export interface FanState {
  satisfaction: number;
  /** 팬 반발(20 미만)이 시작된 날. 25 이상으로 회복하면 지운다 */
  lowSince?: GameDate;
}

/** 만족도의 관중 수요 배수: ±15%, 팬 반발 상태는 ×0.8 */
export function fanDemand(satisfaction: number): number {
  if (satisfaction < M.backlashBelow) return M.backlashDemand;
  return 1 + (M.demandSlope * (satisfaction - 50)) / 50;
}

/** 진행 캠페인의 합계 효과(상한 적용) */
export function campaignBoost(active: readonly Campaign[]): { demand: number; satisfaction: number } {
  return {
    demand: Math.min(M.maxDemandBoost, active.reduce((a, c) => a + M.campaigns[c.kind].demand, 0)),
    satisfaction: Math.min(M.maxSatisfactionBoost, active.reduce((a, c) => a + M.campaigns[c.kind].satisfaction, 0)),
  };
}

/** 주간 만족도 갱신: 목표 쪽으로 차이의 10% 이동(소수 1자리) */
export function nextSatisfaction(current: number, pct: number, loyalty: string, boost: number): number {
  const target = Math.max(M.targetMin, Math.min(M.targetMax, 50 + M.pctSlope * (pct - 0.5) + (M.loyaltyBonus[loyalty] ?? 0) + boost));
  return Math.round((current + (target - current) * M.weeklyMove) * 10) / 10;
}

export const startSatisfaction = (loyalty: string) => M.startSatisfaction + (M.loyaltyBonus[loyalty] ?? 0);

/** 시즌 초 혼합 승률(관중 모델과 같은 규칙) */
export function blendedPct(wins: number, losses: number, priorPct: number): number {
  const played = wins + losses;
  const cur = played > 0 ? wins / played : priorPct;
  const w = Math.min(1, played / A.blendGames);
  return cur * w + priorPct * (1 - w);
}

/** 새 공사: 승인이 필요하면 4주 뒤 착공. 지급은 착공·중간·완공 */
export function planProject(kind: FacilityKind, toLevel: number, requested: GameDate, inflation: number): FacilityProject {
  const costWon = Math.round((F.costWon[toLevel]! * inflation) / 10_000_000) * 10_000_000;
  const start = F.kinds[kind].needsApproval ? addDays(requested, F.approvalWeeks * 7) : requested;
  const days = F.weeks[toLevel]! * 7;
  const end = addDays(start, days);
  const first = Math.round((costWon * F.paymentsBp[0]!) / 10_000);
  const mid = Math.round((costWon * F.paymentsBp[1]!) / 10_000);
  return {
    kind,
    toLevel,
    costWon,
    requested,
    start,
    end,
    payments: [
      { date: start, amountWon: first, paid: false },
      { date: addDays(start, Math.floor(days / 2)), amountWon: mid, paid: false },
      { date: end, amountWon: costWon - first - mid, paid: false },
    ],
  };
}

export const unpaid = (p: FacilityProject) => p.payments.filter((x) => !x.paid).reduce((a, x) => a + x.amountWon, 0);

/** 시설 효과(완공된 단계만) */
export const trainingBoost = (f: ClubFacilities | undefined) => 1 + F.trainingPerLevel * ((f?.levels.training ?? 1) - 1);
export const rehabBoost = (f: ClubFacilities | undefined) => F.rehabPerLevel * ((f?.levels.rehab ?? 1) - 1);
export const scoutingBoost = (f: ClubFacilities | undefined) => 1 - F.scoutingPerLevel * ((f?.levels.scouting ?? 1) - 1);
