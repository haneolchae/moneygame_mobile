// 7a AI 구단 운영 상태(19 문서, D-155). 순수 함수만 둔다.
// 상태는 매월 1일 순위와 현금으로 다시 평가한다. 시작 전력(상·중·하)은 쓰지 않는다.
import { AI_CLUB as A } from './config';
import { EOK } from './money';

export type ClubStance = 'contend' | 'middle' | 'rebuild' | 'austerity';

export const STANCES: readonly ClubStance[] = ['contend', 'middle', 'rebuild', 'austerity'];

export const STANCE_LABEL: Record<ClubStance, string> = { contend: '우승 경쟁', middle: '중위권 경쟁', rebuild: '리빌딩', austerity: '재정 긴축' };

/** 순위만으로 본 상태 */
export function stanceByRank(rank: number): ClubStance {
  return rank <= A.contendRank ? 'contend' : rank >= A.rebuildRank ? 'rebuild' : 'middle';
}

/**
 * 평가일의 운영 상태. 현금이 0 미만이면 재정 긴축, 긴축 중에는 현금이 해제 기준 이상으로 회복돼야 순위 기준 상태로 돌아간다.
 */
export function assessStance(prev: ClubStance | undefined, rank: number, cashWon: number): ClubStance {
  if (cashWon < 0) return 'austerity';
  if (prev === 'austerity' && cashWon < A.austerityExitWon) return 'austerity';
  return stanceByRank(rank);
}

/** 긴축 구단 모기업 긴급 지원: 부족액 + 여유분, 억 단위 올림(리그 유지용) */
export function emergencySupport(cashWon: number): number {
  return cashWon < 0 ? Math.ceil((-cashWon + A.emergencyBufferWon) / EOK) * EOK : 0;
}
