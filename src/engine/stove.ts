// 스토브리그 달력 (01·22 문서). K(한국시리즈 최종전) 기준으로 리그 일정을 만든다.
import { addDays, makeDate, mondayOf, type GameDate } from './calendar';
import { STOVE } from './config';

export type StoveEventKind = 'faNotice' | 'faApplyDeadline' | 'faApproval' | 'faMarketOpen' | 'reserveList' | 'inactivePeriod' | 'arbitrationDeadline' | 'campRoster' | 'seasonModeStart';

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

export function stoveEvents(kDate: GameDate): StoveEvent[] {
  const year = Number(kDate.slice(0, 4));
  const md = (y: number, s: string) => {
    const [m, d] = s.split('-').map(Number) as [number, number];
    return makeDate(y, m, d);
  };
  return [
    { date: addDays(kDate, STOVE.faNoticeAfterK), kind: 'faNotice', title: 'FA 자격 선수 공시', body: 'KBO가 FA 자격을 얻은 선수 명단을 공시했습니다. 선수들은 이틀 안에 권리 행사 여부를 정합니다.' },
    { date: addDays(kDate, STOVE.faApplyDeadlineAfterK), kind: 'faApplyDeadline', title: 'FA 신청 마감', body: 'FA 권리 행사 신청이 마감됐습니다.' },
    { date: addDays(kDate, STOVE.faApprovalAfterK), kind: 'faApproval', title: 'FA 승인 선수 공시', body: 'FA 승인 선수가 공시됐습니다. 내일부터 모든 구단과 교섭할 수 있습니다.' },
    { date: addDays(kDate, STOVE.faMarketAfterK), kind: 'faMarketOpen', title: 'FA 시장 개장', body: 'FA 시장이 열렸습니다. 트레이드 시장도 함께 움직입니다.' },
    { date: md(year, STOVE.reserveListMonthDay), kind: 'reserveList', title: '보류선수 명단 확정', body: '다음 시즌 보유 선수 명단(40명 이하)이 확정됩니다.' },
    { date: md(year, STOVE.inactivePeriodStart), kind: 'inactivePeriod', title: '비활동 기간 시작', body: '1월 31일까지 단체 훈련을 할 수 없습니다. 연봉 협상이 시작됩니다.' },
    { date: md(year + 1, STOVE.arbitrationDeadline), kind: 'arbitrationDeadline', title: '연봉조정 신청 마감', body: '연봉 합의를 하지 못한 선수의 조정 신청이 마감됩니다.' },
    // 캠프 명단은 스토브리그 마지막 날을 넘지 않는다(2월 1일이 월요일이 아닌 해는 1월 31일이 이미 시즌 모드).
    { date: minDate(md(year + 1, STOVE.campRosterDeadline), addDays(seasonModeStart(year), -1)), kind: 'campRoster', title: '스프링캠프 명단 확정', body: '스프링캠프 참가 명단이 확정됩니다.' },
    { date: seasonModeStart(year), kind: 'seasonModeStart', title: '스프링캠프 시작', body: '새 시즌 준비가 시작됐습니다. 이제부터 시즌 모드로 진행합니다.' },
  ];
}
