// 정기 수입·지출 일정 (17 문서). 날짜와 구단 상태를 받아 그날 장부에 기록할 항목을 만든다.
// 시즌 연도는 2월(시즌 모드 시작)~다음 해 1월이다. 금액 기준은 2026년이며 물가 상승률을 적용한다(D-037).
//
// 이번 단계(2a)에 구현한 항목: 모기업 지원, 명명권, 중계권료, KBO 사업 배분금, 선수 연봉, 직원 급여(2c부터 실제 직원 연봉 합계),
// 구장 사용료, 일반관리비, 2군 운영비, 분석·스카우트 운영비, 선수단 운영비, 경기 운영비.
// 2b: 계약금·FA 보상금(계약 시점, market.ts), 방출 선수 잔여 연봉(선수 연봉과 같은 일정).
// 아직 없는 항목(입장·시즌권·광고·스폰서·굿즈·식음료·임대·포스트시즌 배당·마케팅·시설 유지비)은
// 해당 기능 단계에서 추가한다. 목록은 NOT_YET_IMPLEMENTED에 있다.
import type { GameDate } from './calendar';
import { addDays } from './calendar';
import { SUPPORT_RENEGOTIATION } from './config';
import { EOK, growBy, prorate, splitEvenly, type Won } from './money';
import type { ClubProfile } from './types';

export type LedgerCategory =
  | 'startCash'
  | 'parentSupport'
  | 'namingRights'
  | 'broadcast'
  | 'kboShare'
  | 'playerSalary'
  | 'staffPayroll'
  | 'stadiumFee'
  | 'generalAdmin'
  | 'futuresOps'
  | 'analysisScouting'
  | 'teamOps'
  | 'gameOps'
  | 'signingBonus'
  | 'faCompensation'
  | 'releasedSalary'
  | 'staffSeverance'
  | 'tradeCash'
  | 'ticketRevenue'
  | 'concessions'
  | 'stadiumGateFee'
  | 'facilityConstruction'
  | 'facilityUpkeep'
  | 'marketing'
  | 'sponsorship'
  | 'merchSales'
  | 'merchOrder'
  | 'merchPartner'
  | 'event'
  | 'postingFee'
  | 'capPenalty';

export const CATEGORY_LABEL: Record<LedgerCategory, string> = {
  startCash: '기초 현금',
  parentSupport: '모기업 지원금',
  namingRights: '명명권 수입',
  broadcast: '중계권료 배분',
  kboShare: 'KBO 사업 배분금',
  playerSalary: '선수 연봉',
  staffPayroll: '직원 급여',
  staffSeverance: '직원 해고 보상금',
  stadiumFee: '구장 사용료',
  generalAdmin: '일반관리비',
  futuresOps: '2군 운영비',
  analysisScouting: '분석·스카우트 운영비',
  teamOps: '선수단 운영비',
  gameOps: '경기 운영비',
  signingBonus: '계약금',
  faCompensation: 'FA 보상금',
  releasedSalary: '방출 선수 잔여 연봉',
  tradeCash: '트레이드 현금',
  ticketRevenue: '입장 수입',
  concessions: '식음료(매점) 수입',
  stadiumGateFee: '구장 관람료(입장수입 10%)',
  facilityConstruction: '시설 공사비',
  facilityUpkeep: '시설 유지비',
  marketing: '마케팅·캠페인',
  sponsorship: '스폰서 수입',
  merchSales: '굿즈 판매',
  merchOrder: '굿즈 발주(재고 취득)',
  merchPartner: '제작 파트너 후원금',
  event: '이벤트',
  postingFee: '포스팅 이적료',
  capPenalty: '샐러리캡 제재금',
};

export const NOT_YET_IMPLEMENTED = [
  '시즌권·좌석 등급',
  '구장 광고·명명권 재협상',
  '임대',
  '포스트시즌 배당금',
  '시설 감가상각',
];

/** 2026년 기준 금액 (17·21 문서, D-038). 직원 급여는 2c 조직 구현 전까지 임시 총액이다(ASSUMPTION). */
export const FINANCE_BASE = {
  broadcastLeagueTotal: 800 * EOK,
  broadcastGrowthBp: 500, // CONFIRMED D-036: 매년 5%
  broadcastRenewalEveryYears: 3,
  broadcastFirstContractYear: 2027,
  broadcastRenewalBpAssumed: 1500, // ASSUMPTION(D-112): 관중 추세 모델 전까지 10~20%의 중간값
  kboShare: 15 * EOK,
  staffPayroll: 60 * EOK, // 2b까지 쓰던 임시 총액. 2c부터 장부는 실제 직원 연봉 합계를 쓰고, 이 값은 비교용 기준으로만 남긴다 (D-038, D-076)
  generalAdmin: 15 * EOK,
  futuresOps: 15 * EOK,
  analysisScouting: 8 * EOK,
  teamOps: 35 * EOK,
  gameOps: 30 * EOK,
  homeGamesPerSeason: 72,
  stadiumFeeMin: 15 * EOK,
  stadiumFeeMax: 30 * EOK,
} as const;

export interface LedgerEntry {
  clubId: number;
  date: GameDate;
  category: LedgerCategory;
  amount: Won; // 수입 +, 지출 −
  memo: string;
}

/** 시즌 연도별 물가 상승률(bp)로 2026년 기준 금액을 해당 시즌 금액으로 바꾼다. */
export function inflate(base2026: Won, seasonYear: number, ratesBp: Record<string, number>): Won {
  let amount = base2026;
  for (let y = 2027; y <= seasonYear; y++) amount = growBy(amount, ratesBp[String(y)] ?? 0);
  return amount;
}

/** 시즌 연도의 리그 중계권료 총액. 물가 대신 고유 인상 규칙(D-036)을 쓴다. */
export function broadcastLeagueTotal(seasonYear: number): Won {
  let total: Won = FINANCE_BASE.broadcastLeagueTotal;
  for (let y = 2027; y <= seasonYear; y++) {
    total = growBy(total, FINANCE_BASE.broadcastGrowthBp);
    const sinceFirst = y - FINANCE_BASE.broadcastFirstContractYear;
    if (sinceFirst > 0 && sinceFirst % FINANCE_BASE.broadcastRenewalEveryYears === 0) total = growBy(total, FINANCE_BASE.broadcastRenewalBpAssumed);
  }
  return total;
}

/**
 * 모기업 지원금 재협상 배수(bp, D-135): 보유 현금 / 시작 현금 R이 1.2를 넘으면 줄이고(하한 0.2, D-242), 0.8보다 낮으면 늘린다(상한 1.2).
 */
export function supportFactorBp(cash: Won, startCash: Won): number {
  const S = SUPPORT_RENEGOTIATION;
  const r = startCash > 0 ? cash / startCash : 1;
  const f = r > S.upper ? Math.max(S.minFactor, 1 - S.cutSlope * (r - S.upper)) : r < S.lower ? Math.min(S.maxFactor, 1 + S.raiseSlope * (S.lower - r)) : 1;
  return Math.round(f * 10_000);
}

export function stadiumFee(club: ClubProfile): Won {
  const t = Math.max(0, Math.min(1, (club.stadiumCapacity - 16_000) / 8_000));
  return FINANCE_BASE.stadiumFeeMin + Math.round(((FINANCE_BASE.stadiumFeeMax - FINANCE_BASE.stadiumFeeMin) * t) / 1_000_000) * 1_000_000;
}

const isMonthEnd = (date: GameDate) => addDays(date, 1).slice(8, 10) === '01';
const month = (date: GameDate) => Number(date.slice(5, 7));

/** 시즌 연도 안에서 몇 번째 달인지 (2월 = 0 … 1월 = 11) */
const seasonMonthIndex = (date: GameDate) => (month(date) + 10) % 12;

export interface FinanceContext {
  date: GameDate;
  seasonYear: number;
  inflationBp: Record<string, number>;
  club: ClubProfile;
  /** 그 구단 선수들의 연봉 목록. 스토브리그 중에는 시즌 종료 시점 계약(스냅샷)을 쓴다 */
  salaries: Won[];
  /** 방출 선수 잔여 연봉(이번 시즌 지급분) */
  releasedSalaries: Won[];
  /** 직원(프런트·코칭스태프) 연봉 합계. 계약 금액이라 물가를 따르지 않는다 (2c, D-076) */
  staffPayroll: Won;
  /** 오늘 치른 홈경기 수 */
  homeGamesToday: number;
  /** 6e(D-177): 운영비 배수(분석·스카우트, 2군, 선수단). 없으면 1 */
  ops?: { scouting: number; futures: number; teamOps: number };
}

export function scheduledEntries(ctx: FinanceContext): LedgerEntry[] {
  const { date, seasonYear, inflationBp, club } = ctx;
  const out: LedgerEntry[] = [];
  const add = (category: LedgerCategory, amount: Won, memo = '') => {
    if (amount !== 0) out.push({ clubId: club.id, date, category, amount, memo });
  };
  const inf = (base: Won) => inflate(base, seasonYear, inflationBp);
  // 6e: 운영비는 기준 × 물가 × 배수(배수 1이면 6e 전과 같은 금액)
  const scaled = (base: Won, m = 1) => (m === 1 ? inf(base) : Math.round(inf(base) * m));

  if (ctx.homeGamesToday > 0) {
    add('gameOps', -prorate(inf(FINANCE_BASE.gameOps), ctx.homeGamesToday, FINANCE_BASE.homeGamesPerSeason), `홈경기 ${ctx.homeGamesToday}경기`);
  }
  if (!isMonthEnd(date)) return out;

  const idx = seasonMonthIndex(date);
  const monthly = (annual: Won) => splitEvenly(annual, 12)[idx] ?? 0;
  const label = `${seasonYear} 시즌 ${month(date)}월분`;

  add('parentSupport', monthly(inf(club.parentSupport)), label);
  add('namingRights', monthly(club.namingRights), label); // 계약 금액은 물가를 따르지 않는다(D-037)
  add('staffPayroll', -monthly(ctx.staffPayroll), label);
  add('stadiumFee', -monthly(inf(stadiumFee(club))), label);
  add('generalAdmin', -monthly(inf(FINANCE_BASE.generalAdmin)), label);
  add('futuresOps', -monthly(scaled(FINANCE_BASE.futuresOps, ctx.ops?.futures)), label);
  add('analysisScouting', -monthly(scaled(FINANCE_BASE.analysisScouting, ctx.ops?.scouting)), label);

  // 선수단 운영비: 2~10월(9개월)
  if (idx <= 8) add('teamOps', -(splitEvenly(scaled(FINANCE_BASE.teamOps, ctx.ops?.teamOps), 9)[idx] ?? 0), label);

  // 선수 연봉: 2~11월 10회 분할 (D-059)
  if (idx <= 9) {
    const paid = ctx.salaries.reduce((sum, s) => sum + (splitEvenly(s, 10)[idx] ?? 0), 0);
    add('playerSalary', -paid, `${label} (${ctx.salaries.length}명)`);
    const released = ctx.releasedSalaries.reduce((sum, s) => sum + (splitEvenly(s, 10)[idx] ?? 0), 0);
    add('releasedSalary', -released, `${label} (${ctx.releasedSalaries.length}명)`);
  }

  // 중계권료: 시즌 연도 분기 말(4·7·10·1월)에 4회 분할
  const quarterIdx = [2, 5, 8, 11].indexOf(idx);
  if (quarterIdx >= 0) {
    const perClub = Math.floor(broadcastLeagueTotal(seasonYear) / 10);
    add('broadcast', splitEvenly(perClub, 4)[quarterIdx] ?? 0, `${seasonYear} 시즌 ${quarterIdx + 1}회차`);
  }

  // KBO 사업 배분금: 12월 말 연 1회
  if (month(date) === 12) add('kboShare', inf(FINANCE_BASE.kboShare), `${seasonYear} 시즌`);

  return out;
}
