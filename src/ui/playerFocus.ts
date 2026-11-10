// 선수 상세를 닫으면 진입 목록의 문맥(검색·정렬·필터)과 호출 선수 포커스를 되돌린다(3c·3d, 18a 1장).
import type { PlayerQuery } from '../shared/protocol';

export const playerFocus: { id: number | null } = { id: null };

/** 선수단 목록의 마지막 조회 조건. 상세에서 돌아오면 그대로 복원한다. */
export const playersMemory: { query: PlayerQuery; watchedOnly: boolean } = {
  query: { scope: 'mine', group: 'hitters', level: 'all', sortKey: 'OPS', sortDesc: true },
  watchedOnly: false,
};

/**
 * 화면 이탈 전 확인(메뉴 이동·날짜 진행·저장 화면 이동). 선수 상세가 미저장 메모 저장 함수를 등록한다.
 * false를 돌려주면 이동하지 않는다.
 */
export const leaveGuard: { run: (() => Promise<boolean>) | null } = { run: null };
