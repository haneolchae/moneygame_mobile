// 포지션 최소 인원 (D-098 초기안)
import { afterEach, describe, expect, it } from 'vitest';
import { LEAGUE, ROSTER_COMPOSITION } from '../src/engine/config';
import { Rng } from '../src/engine/rng';
import { canRemove, compositionViolations, neededGroup, needFirst, pickRemovals, rosterCounts } from '../src/engine/roster';
import type { PlayerTruth } from '../src/engine/types';
import { assignActiveRoster, generateDomesticFreePool, generateWorld } from '../src/engine/worldgen';
import { checkRosterComposition } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

/** 생성된 리그의 한 구단(국내 36 + 외국인 4) */
const club = (): PlayerTruth[] => generateWorld(Rng.fromSeed('comp'), 2026).filter((p) => p.clubId === 1);

describe('포지션 최소 인원 (D-098)', () => {
  it('생성된 구단은 최소 인원을 지키고, 부족한 쪽을 포수 → 부족이 큰 쪽 순으로 알려준다', () => {
    const team = club();
    expect(compositionViolations(team)).toEqual([]);
    expect(neededGroup(team)).toBeNull();
    const c = rosterCounts(team);
    // 야수를 최소 인원 아래로 줄이면 야수 부족
    const fewHitters = [...team.filter((p) => p.isPitcher), ...team.filter((p) => !p.isPitcher && p.position !== 'C').slice(0, ROSTER_COMPOSITION.minHitters - c.catchers - 2), ...team.filter((p) => p.position === 'C')];
    expect(neededGroup(fewHitters)).toBe('H');
    // 포수가 모자라면 포수가 먼저
    const noCatcher = team.filter((p) => p.position !== 'C' || p.isPitcher).concat(team.filter((p) => p.position === 'C').slice(0, 1));
    expect(neededGroup(noCatcher)).toBe('C');
    const ordered = needFirst(noCatcher, team, (p) => p);
    expect(ordered[0]!.position).toBe('C');
  });

  it('방출 순서에서 최소 인원 아래로 내려가는 선수는 건너뛴다. 못 채우면 40인 한도를 우선한다', () => {
    const team = club();
    const catchers = team.filter((p) => p.position === 'C');
    expect(catchers.length).toBe(ROSTER_COMPOSITION.minCatchers);
    expect(canRemove(team, catchers[0]!)).toBe(false);
    // 포수 3명을 가장 먼저 방출 후보로 둬도 포수는 남긴다.
    const others = team.filter((p) => p.position !== 'C' && p.origin === 'domestic');
    const picked = pickRemovals(team, [...catchers, ...others], 2);
    expect(picked).toHaveLength(2);
    expect(picked.some((p) => p.position === 'C')).toBe(false);
    // 후보가 포수뿐이면 한도를 위해 그대로 고른다(미달은 규칙 검사가 기록).
    expect(pickRemovals(team, catchers, 1)).toHaveLength(1);
  });

  it('1군 편성: 한쪽이 모자라면 다른 쪽으로 26명을 채우고, 규칙 검사에는 포지션 최소 인원 미달로 남는다', () => {
    const team = club();
    const pitchers = team.filter((p) => p.isPitcher);
    const hitters = team.filter((p) => !p.isPitcher).slice(0, ROSTER_COMPOSITION.activeMinHitters - 1); // 야수 12명
    const thin = [...pitchers, ...hitters];
    assignActiveRoster(thin);
    const active = thin.filter((p) => p.level === '1군');
    expect(active).toHaveLength(LEAGUE.activeRoster);
    expect(active.filter((p) => !p.isPitcher)).toHaveLength(ROSTER_COMPOSITION.activeMinHitters - 1);
    expect(compositionViolations(thin).join()).toContain('1군 야수 12명');
  });

  it('국내 미계약 선수 풀은 포수를 포함하고 소속이 없다', () => {
    const pool = generateDomesticFreePool(Rng.fromSeed('pool'), 2026, 10_000);
    expect(pool.every((p) => p.clubId === null && p.origin === 'domestic' && p.contractYears === 0)).toBe(true);
    expect(pool.filter((p) => p.position === 'C' && !p.isPitcher).length).toBeGreaterThanOrEqual(ROSTER_COMPOSITION.minCatchers);
  });

  it('새 게임 시작 상태에서 모든 구단이 포지션 최소 인원을 지킨다. 깨뜨리면 규칙 위반으로 잡힌다', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 2, saveName: 't', seed: 'comp-new' });
    const repo = d.saves.repository();
    expect(checkRosterComposition(repo)).toEqual([]);
    const catchers = repo.getPlayers().filter((p) => p.clubId === 3 && p.position === 'C');
    repo.savePlayers(catchers.slice(0, 1).map((p) => ({ ...p, clubId: null })));
    expect(checkRosterComposition(repo).join()).toContain('포지션 최소 인원 미달: 포수');
    d.close();
  });
});
