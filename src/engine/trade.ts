// 5a 트레이드 가치·판단(09·19 문서, D-131). 순수 함수만 둔다.
// 가치 = 남은 보유 기간 동안 (시장 가치(예상 능력) − 그해 연봉)의 할인 합. 예상 능력은 공개 나이 곡선만 쓰고
// 히든 잠재력·정점 나이를 읽지 않는다. 다른 구단 선수는 결합 추정(구단 추정과 리그 공통 평가의 평균, D-133).
// 판단은 결정론적이다: 같은 날 같은 조건이면 같은 응답(구단·선수·시즌 고정 오차만 쓰고 난수 흐름을 쓰지 않음).
import { TRADE as T } from './config';
import { publicOverall } from './contracts';
import { stableNormal } from './rng';
import type { PlayerTruth } from './types';
import { domesticSalary, FA_SERVICE_YEARS_REQUIRED, overall } from './worldgen';

export type ClubPhase = 'contender' | 'neutral' | 'rebuild';

export interface ValueContext {
  seed: string;
  season: number;
  /** 평가 구단. null이면 실제 가치(실제 현재 능력·중립 수요·중립 단계 — 검증용) */
  evaluatorClubId: number | null;
  /** 시즌 모드면 true(올해 남은 몫만 계산), 스토브리그면 false(다음 시즌 전체) */
  inSeason: boolean;
  /** 올해 남은 정규시즌 비율(0~1) */
  seasonShare: number;
  phase: ClubPhase;
  /** 받는 선수 쪽 수요 배수(투수·야수·포수) */
  need: { pitcher: number; hitter: number; catcher: number };
}

export const neutralNeed = { pitcher: 1, hitter: 1, catcher: 1 };

/** 평가 구단이 보는 현재 능력: 자기 선수는 실제, 다른 구단 선수는 결합 추정, null은 실제 */
export function ratingFor(seed: string, season: number, evaluatorClubId: number | null, p: PlayerTruth): number {
  if (evaluatorClubId === null || p.clubId === evaluatorClubId) return overall(p);
  const club = overall(p) + stableNormal(seed, 'trade-eval', evaluatorClubId, p.id, season) * T.clubEstimateSd;
  // D-133: 두 독립 추정의 평균(결합 추정). 첫 설계(낮은 값)는 과소평가가 겹쳐 D-132 ①을 통과하지 못했다
  return (club + publicOverall(seed, p)) / 2;
}

export function ageStep(age: number): number {
  for (const [upTo, step] of T.ageCurve) if (age <= upTo) return step;
  return T.ageCurve[T.ageCurve.length - 1]![1];
}

/** 시장 가치(연): 같은 능력 FA가 받을 연봉 */
export const worth = (rating: number) => domesticSalary(rating, T.worthAge, T.worthProSeasons) * T.worthPremium;

/** 남은 보유 기간(시즌 수, 1~4)과 그중 계약 연봉이 고정된 시즌 수 */
export function horizon(p: PlayerTruth, inSeason: boolean): { years: number; fixed: number } {
  const contract = Math.max(0, p.contractYears) + (inSeason ? 1 : 0);
  const fixed = Math.max(1, contract);
  const multiYear = p.career.lastFaSeason !== undefined || p.origin !== 'domestic' || p.contractYears >= 1;
  const reserve = Math.max(1, FA_SERVICE_YEARS_REQUIRED - p.career.faServiceYears + (inSeason ? 1 : 0));
  const years = p.origin !== 'domestic' ? fixed : multiYear ? Math.max(fixed, reserve) : reserve;
  return { years: Math.max(1, Math.min(T.maxHorizon, years)), fixed };
}

/**
 * 선수 가치(원). role: 'get' 받는 선수(수요 배수), 'give' 내주는 선수(간판 선수 배수), 'truth' 검증용.
 * injuryDays: 평가 구단이 아는 남은 결장 추정(일).
 */
export function playerValue(p: PlayerTruth, rating: number, age: number, ctx: ValueContext, role: 'get' | 'give' | 'truth', injuryDays = 0): number {
  const h = horizon(p, ctx.inSeason);
  let r = rating;
  let total = 0;
  for (let y = 0; y < h.years; y++) {
    if (y > 0) r += ageStep(age + y - 1);
    const salary = y < h.fixed ? p.salary : Math.max(p.salary, domesticSalary(r, age + y, p.career.proSeasons + y));
    let term = (worth(r) - salary) * T.discount ** y;
    if (y === 0) term *= (ctx.inSeason ? ctx.seasonShare : 1) * Math.max(0, 1 - injuryDays / 180);
    if (role !== 'truth') {
      if (ctx.phase === 'contender') term *= y === 0 ? T.contenderNow : T.contenderLater;
      else if (ctx.phase === 'rebuild') term *= (y === 0 ? T.rebuildNow : T.rebuildLater) * (age >= T.rebuildVeteranAge ? T.rebuildVeteran : 1);
    }
    total += term;
  }
  if (total > 0 && role === 'get') total *= p.isPitcher ? ctx.need.pitcher : p.position === 'C' ? Math.max(ctx.need.catcher, ctx.need.hitter) : ctx.need.hitter;
  if (total > 0 && role === 'give' && p.career.franchise) total *= T.franchiseKeep;
  return total;
}

/** 구단·시즌 고정 여유(협상 성향) */
export const clubMargin = (seed: string, clubId: number, season: number) => T.margin + stableNormal(seed, 'trade-margin', clubId, season) * T.marginSd;

export type TradeDecision = { kind: 'accept'; required: number } | { kind: 'counter'; required: number; cashNeeded: number } | { kind: 'reject'; required: number };

/**
 * AI 판단: 받는 가치 G(받는 현금 포함) ≥ 주는 가치 L(내는 현금 포함) + |L| × 여유 + 마찰 비용이면 수락.
 * 모자란 만큼이 작으면(필요 값의 80% 이상, 또는 2억 이하) 현금 역제안, 그 밖에는 거절.
 */
export function decide(G: number, L: number, margin: number): TradeDecision {
  const required = L + Math.abs(L) * margin + T.frictionWon;
  if (G >= required) return { kind: 'accept', required };
  const gap = required - G;
  const allowed = Math.max(required * (1 - T.counterRatio), 2 * T.frictionWon);
  if (gap <= allowed) return { kind: 'counter', required, cashNeeded: Math.ceil(gap / T.cashStepWon) * T.cashStepWon };
  return { kind: 'reject', required };
}

/** 40인 안 같은 쪽 인원으로 수요 배수 */
export function needOf(roster: readonly PlayerTruth[]): ValueContext['need'] {
  const pitchers = roster.filter((p) => p.isPitcher).length;
  const hitters = roster.length - pitchers;
  const catchers = roster.filter((p) => !p.isPitcher && p.position === 'C').length;
  const f = (n: number, thin: number, thick: number) => (n <= thin ? T.needUp : n >= thick ? T.needDown : 1);
  return { pitcher: f(pitchers, T.needThin.pitchers, T.needThick.pitchers), hitter: f(hitters, T.needThin.hitters, T.needThick.hitters), catcher: f(catchers, T.needThin.catchers, T.needThick.catchers) };
}

export function phaseOf(rank: number | null): ClubPhase {
  if (rank === null) return 'neutral';
  return rank <= T.contenderRank ? 'contender' : rank >= T.rebuildRank ? 'rebuild' : 'neutral';
}
