// 행동력·처리량의 주 구분. 게임 진행(service)과 조직(organization)이 같은 규칙을 쓴다.
import { addDays, mondayOf, weekday, type GameDate } from '../engine/calendar';
import { NEW_GAME } from '../engine/config';
import { stoveTurnOf } from '../engine/stove';

/** 행동력 주 ID: 그 주의 월요일. 단, 게임 시작일이 일요일이면 다음 주에 붙인다(첫 주 11/8~11/15, 22 문서). 처리량(WP)은 스토브리그에도 주 단위다. */
export function weekIdFor(date: GameDate, startDate: GameDate = NEW_GAME.startDate): GameDate {
  if (date === startDate && weekday(date) === 0) return addDays(date, 1);
  return mondayOf(date);
}

/**
 * 행동력·협상 세션 기간 ID(D-217·D-218): 시즌은 주(월요일), 스토브리그는 턴(턴 첫날).
 * 행동력 장부(ap_ledger)는 시즌 주와 스토브리그 턴을 같은 구조로 둔다(02 문서 APLedger).
 */
export function apPeriodId(meta: { mode: string; kDate: GameDate; currentDate: GameDate }, date: GameDate = meta.currentDate): string {
  return meta.mode === 'stove' ? stoveTurnOf(meta.kDate, date).start : weekIdFor(date);
}
