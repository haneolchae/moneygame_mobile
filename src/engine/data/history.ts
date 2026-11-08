// 실제 KBO 구단 역사 조회 (D-082)
import { KBO_HISTORY } from './kboHistory';
import type { ClubHistoryData } from './historyTypes';

export function clubHistory(clubId: number): ClubHistoryData | undefined {
  return KBO_HISTORY.find((c) => c.clubId === clubId);
}
