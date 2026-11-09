// 포지션 최소 인원 (D-098 초기안): AI 구단과 우리 구단 운영팀이 같은 함수로 선수 구성을 판단한다.
// 드래프트·FA·외국인 영입은 모자란 쪽을 먼저 고르고, 방출은 최소 인원 아래로 내려가지 않게 한다.
import { ROSTER_COMPOSITION } from './config';
import type { PlayerTruth } from './types';

export type RosterGroup = 'P' | 'H' | 'C';

export interface RosterCounts {
  pitchers: number;
  hitters: number;
  catchers: number;
}

export function rosterCounts(players: readonly PlayerTruth[]): RosterCounts {
  let pitchers = 0;
  let catchers = 0;
  for (const p of players) {
    if (p.isPitcher) pitchers++;
    else if (p.position === 'C') catchers++;
  }
  return { pitchers, hitters: players.length - pitchers, catchers };
}

/** 40인 기준 부족 인원(0 이상) */
export function rosterDeficits(players: readonly PlayerTruth[]): RosterCounts {
  const c = rosterCounts(players);
  return {
    pitchers: Math.max(0, ROSTER_COMPOSITION.minPitchers - c.pitchers),
    hitters: Math.max(0, ROSTER_COMPOSITION.minHitters - c.hitters),
    catchers: Math.max(0, ROSTER_COMPOSITION.minCatchers - c.catchers),
  };
}

/** 가장 먼저 채워야 할 쪽: 포수 → 부족 인원이 많은 쪽. 부족이 없으면 null */
export function neededGroup(players: readonly PlayerTruth[]): RosterGroup | null {
  const d = rosterDeficits(players);
  if (d.catchers > 0) return 'C';
  if (d.pitchers === 0 && d.hitters === 0) return null;
  return d.pitchers >= d.hitters ? 'P' : 'H';
}

export function inGroup(p: PlayerTruth, g: RosterGroup): boolean {
  return g === 'P' ? p.isPitcher : g === 'H' ? !p.isPitcher : !p.isPitcher && p.position === 'C';
}

/** 모자란 쪽 후보를 앞으로 보낸다(같은 쪽 안에서는 원래 순서 유지). */
export function needFirst<T>(players: readonly PlayerTruth[], items: readonly T[], playerOf: (x: T) => PlayerTruth): T[] {
  const g = neededGroup(players);
  if (!g) return [...items];
  return [...items.filter((x) => inGroup(playerOf(x), g)), ...items.filter((x) => !inGroup(playerOf(x), g))];
}

/** 이 선수를 빼도 투수·야수·포수 최소 인원을 지키는가 */
export function canRemove(players: readonly PlayerTruth[], p: PlayerTruth): boolean {
  const c = rosterCounts(players);
  if (p.isPitcher) return c.pitchers - 1 >= ROSTER_COMPOSITION.minPitchers;
  if (c.hitters - 1 < ROSTER_COMPOSITION.minHitters) return false;
  return p.position !== 'C' || c.catchers - 1 >= ROSTER_COMPOSITION.minCatchers;
}

/**
 * 방출 순서(가치 낮은 순으로 정렬된 후보)에서 최소 인원을 지키며 n명을 고른다.
 * 그래도 n명을 못 채우면 남은 후보로 채운다(40인 한도가 우선, 미달은 규칙 검사가 기록한다).
 */
export function pickRemovals(players: readonly PlayerTruth[], ordered: readonly PlayerTruth[], n: number): PlayerTruth[] {
  const left = [...players];
  const out: PlayerTruth[] = [];
  for (const p of ordered) {
    if (out.length >= n) break;
    if (!canRemove(left, p)) continue;
    out.push(p);
    left.splice(left.indexOf(p), 1);
  }
  for (const p of ordered) {
    if (out.length >= n) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** 규칙 위반 문구: 40인·1군 최소 인원 미달 */
export function compositionViolations(players: readonly PlayerTruth[]): string[] {
  const out: string[] = [];
  const all = rosterCounts(players);
  if (all.pitchers < ROSTER_COMPOSITION.minPitchers) out.push(`투수 ${all.pitchers}명 < ${ROSTER_COMPOSITION.minPitchers}`);
  if (all.hitters < ROSTER_COMPOSITION.minHitters) out.push(`야수 ${all.hitters}명 < ${ROSTER_COMPOSITION.minHitters}`);
  if (all.catchers < ROSTER_COMPOSITION.minCatchers) out.push(`포수 ${all.catchers}명 < ${ROSTER_COMPOSITION.minCatchers}`);
  const active = rosterCounts(players.filter((p) => p.level === '1군'));
  if (active.pitchers < ROSTER_COMPOSITION.activeMinPitchers) out.push(`1군 투수 ${active.pitchers}명 < ${ROSTER_COMPOSITION.activeMinPitchers}`);
  if (active.hitters < ROSTER_COMPOSITION.activeMinHitters) out.push(`1군 야수 ${active.hitters}명 < ${ROSTER_COMPOSITION.activeMinHitters}`);
  return out;
}
