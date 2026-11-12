// 스토브리그 달력 (01·22 문서). K(한국시리즈 최종전) 기준으로 리그 일정과 4턴 경계를 만든다.
import { addDays, diffDays, makeDate, mondayOf, type GameDate } from './calendar';
import { STOVE, STOVE_TURN } from './config';

// D-225 (5): FA 절차는 공시·신청(faNotice) → 시장 개장(faMarketOpen) 2단계. 비활동 기간 규칙은 없다(D-229).
export type StoveEventKind = 'faNotice' | 'faMarketOpen' | 'reserveList' | 'salaryTalks' | 'arbitrationDeadline' | 'campRoster' | 'seasonModeStart';

export interface StoveEvent {
  date: GameDate;
  kind: StoveEventKind;
  title: string;
  body: string;
}

/** 시즌 모드 시작일: 다음 해 2월 1일이 속한 주의 월요일 */
export function seasonModeStart(offseasonYear: number): GameDate {
  const [m, d] = STOVE.seasonModeStartMonthDay.split('-').map(Number) as [number, number];
  return mondayOf(makeDate(offseasonYear + 1, m, d));
}

const minDate = (a: GameDate, b: GameDate) => (a < b ? a : b);
const md = (y: number, s: string) => {
  const [m, d] = s.split('-').map(Number) as [number, number];
  return makeDate(y, m, d);
};

export function stoveEvents(kDate: GameDate): StoveEvent[] {
  const year = Number(kDate.slice(0, 4));
  return [
    { date: addDays(kDate, STOVE.faNoticeAfterK), kind: 'faNotice', title: 'FA 자격 선수 공시·신청', body: 'KBO가 FA 자격을 얻은 선수 명단을 공시했고, 선수들이 권리 행사 여부를 정했습니다.' },
    { date: addDays(kDate, STOVE.faMarketAfterK), kind: 'faMarketOpen', title: 'FA 시장 개장', body: 'FA 시장이 열렸습니다. 모든 구단이 FA 선수와 교섭할 수 있습니다.' },
    { date: md(year, STOVE.reserveListMonthDay), kind: 'reserveList', title: '보류선수 명단 확정', body: '다음 시즌 보유 선수 명단(40명 이하)이 확정됩니다.' },
    { date: md(year, STOVE.salaryTalksStart), kind: 'salaryTalks', title: '연봉 협상 시작', body: '보류 선수와 다음 시즌 연봉 협상이 시작됩니다. 1월 10일까지 합의하지 못하면 연봉조정으로 정해집니다.' },
    { date: md(year + 1, STOVE.arbitrationDeadline), kind: 'arbitrationDeadline', title: '연봉조정 신청 마감', body: '연봉 합의를 하지 못한 선수의 조정 신청이 마감됩니다.' },
    // 캠프 명단은 스토브리그 마지막 날을 넘지 않는다(2월 1일이 월요일이 아닌 해는 1월 31일이 이미 시즌 모드).
    { date: minDate(md(year + 1, STOVE.campRosterDeadline), addDays(seasonModeStart(year), -1)), kind: 'campRoster', title: '스프링캠프 명단 확정', body: '스프링캠프 참가 명단이 확정됩니다.' },
    { date: seasonModeStart(year), kind: 'seasonModeStart', title: '스프링캠프 시작', body: '새 시즌 준비가 시작됐습니다. 이제부터 시즌 모드로 진행합니다.' },
  ];
}

export type StoveTurnIndex = 1 | 2 | 3 | 4;

export interface StoveTurn {
  index: StoveTurnIndex;
  /** 턴 첫날(행동력 기간 ID로도 쓴다) */
  start: GameDate;
  /** 턴 마지막 날(이날까지 처리하면 구간 진행이 끝난다) */
  end: GameDate;
  title: string;
  /** 턴이 끝나는 기준 */
  endLabel: string;
}

/**
 * 스토브리그 4턴(D-216·D-229). 경계는 날짜가 아니라 K 기준 리그 일정에 묶는다.
 * 1턴은 스토브리그 첫날(K+1, 첫 스토브리그는 K)부터 보류 명단 확정 전날까지.
 */
export function stoveTurns(kDate: GameDate): StoveTurn[] {
  const year = Number(kDate.slice(0, 4));
  const reserve = md(year, STOVE.reserveListMonthDay);
  const t2End = addDays(reserve, STOVE_TURN.turn2Weeks * 7 - 1);
  const arb = md(year + 1, STOVE.arbitrationDeadline);
  const last = addDays(seasonModeStart(year), -1);
  return [
    { index: 1, start: addDays(kDate, 1), end: addDays(reserve, -1), title: '1턴 시장 개장', endLabel: '보류 명단 확정' },
    { index: 2, start: reserve, end: t2End, title: '2턴 연말 I', endLabel: `1턴 끝 다음 날부터 ${STOVE_TURN.turn2Weeks}주` },
    { index: 3, start: addDays(t2End, 1), end: arb, title: '3턴 연말 II', endLabel: '연봉조정 신청 마감' },
    { index: 4, start: addDays(arb, 1), end: last, title: '4턴 캠프 준비', endLabel: '캠프 명단 확정' },
  ];
}

/** 그 날짜가 속한 턴. 1턴 시작 전 날짜(첫 스토브리그의 K 당일)는 1턴, 마지막 턴 뒤는 4턴 */
export function stoveTurnOf(kDate: GameDate, date: GameDate): StoveTurn {
  const turns = stoveTurns(kDate);
  return turns.find((t) => diffDays(date, t.end) <= 0) ?? turns[turns.length - 1]!;
}

/** 턴의 주 수(카드 추첨 확률 × 턴 주수, D-220). 일 수 / 7 반올림, 최소 1 */
export function turnWeeks(t: StoveTurn): number {
  return Math.max(1, Math.round((diffDays(t.end, t.start) + 1) / 7));
}
