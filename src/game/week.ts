// 행동력·처리량의 주 구분. 게임 진행(service)과 조직(organization)이 같은 규칙을 쓴다.
import { addDays, mondayOf, weekday, type GameDate } from '../engine/calendar';
import { NEW_GAME } from '../engine/config';

/** 행동력 주 ID: 그 주의 월요일. 단, 게임 시작일이 일요일이면 다음 주에 붙인다(첫 주 11/8~11/15, 22 문서). */
export function weekIdFor(date: GameDate, startDate: GameDate = NEW_GAME.startDate): GameDate {
  if (date === startDate && weekday(date) === 0) return addDays(date, 1);
  return mondayOf(date);
}
