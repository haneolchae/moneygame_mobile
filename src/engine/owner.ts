// 구단주 성장과 행동력 (02 문서). 레벨·경험치는 감소하지 않는다.
import { OWNER } from './config';

export function weeklyAp(level: number): number {
  return OWNER.weeklyApByLevel.find((r) => level >= r.minLevel)?.ap ?? 6;
}

/** 레벨 L에서 다음 레벨까지 필요한 경험치 */
export function xpToNext(level: number): number {
  return OWNER.xpBase + OWNER.xpPerLevel * (level - 1);
}

/** 경험치를 더하고 레벨업을 처리한다. 새 최대치는 다음 주부터 적용된다(02 문서). */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let l = level;
  let x = xp + gained;
  while (x >= xpToNext(l)) {
    x -= xpToNext(l);
    l++;
  }
  return { level: l, xp: x };
}
