// 지난 시즌 상세 기록 압축 (D-106): 압축 전후 통계가 같고, 원시 기록은 지워지고, 경기 최종 스코어는 남는다.
import { afterEach, describe, expect, it } from 'vitest';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

describe('지난 시즌 상세 기록 압축 (D-106)', () => {
  it('새 시즌이 시작되면 직전 시즌 원시 기록을 시즌 합계로 바꾸고, 통계·스프레이 차트·수비 합계는 그대로다', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'compress' });
    while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 정규시즌
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 포스트시즌 → 시즌 마감 → 스토브리그
    const repo = d.saves.repository();
    const season = 2027;
    expect(repo.getMeta().mode).toBe('stove');
    // 스토브리그 동안은 막 끝난 시즌의 상세 기록이 남아 있다.
    expect(repo.isCompressed(season)).toBe(false);
    const fixtureId = repo.getGames(season)[0]!.fixtureId;
    expect(repo.getGameEvents(fixtureId).pas.length).toBeGreaterThan(0);
    expect((await call(d, 'game.boxScore', { fixtureId })).detailKept).toBe(true);
    const sample = repo.getPlayers().filter((p) => p.clubId !== null).slice(0, 40).map((p) => p.id);
    const before = {
      bat: JSON.stringify([...repo.battingTotals(season)].sort((a, b) => a[0] - b[0])),
      batClub: JSON.stringify([...repo.battingTotals(season, undefined, 4)].sort((a, b) => a[0] - b[0])),
      pit: JSON.stringify([...repo.pitchingTotals(season)].sort((a, b) => a[0] - b[0])),
      pitClub: JSON.stringify([...repo.pitchingTotals(season, undefined, 4)].sort((a, b) => a[0] - b[0])),
      team: JSON.stringify(repo.teamTotals(season)),
      league: JSON.stringify(repo.leaguePitchingTotals(season)),
      spray: JSON.stringify(sample.map((id) => repo.sprayTotals(season, id))),
      fielding: JSON.stringify(sample.map((id) => repo.fieldingTotals(season, id))),
      played: repo.countFixtures(season).played,
    };
    while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
    expect(repo.getMeta().season).toBe(season + 1);
    expect(repo.isCompressed(season)).toBe(true);
    expect(repo.getGameEvents(fixtureId)).toEqual({ pas: [], runs: [], fielding: [], plays: [] });
    expect(JSON.stringify([...repo.battingTotals(season)].sort((a, b) => a[0] - b[0]))).toBe(before.bat);
    expect(JSON.stringify([...repo.battingTotals(season, undefined, 4)].sort((a, b) => a[0] - b[0]))).toBe(before.batClub);
    expect(JSON.stringify([...repo.pitchingTotals(season)].sort((a, b) => a[0] - b[0]))).toBe(before.pit);
    expect(JSON.stringify([...repo.pitchingTotals(season, undefined, 4)].sort((a, b) => a[0] - b[0]))).toBe(before.pitClub);
    expect(JSON.stringify(repo.teamTotals(season))).toBe(before.team);
    expect(JSON.stringify(repo.leaguePitchingTotals(season))).toBe(before.league);
    expect(JSON.stringify(sample.map((id) => repo.sprayTotals(season, id)))).toBe(before.spray);
    expect(JSON.stringify(sample.map((id) => repo.fieldingTotals(season, id)))).toBe(before.fielding);
    // 경기는 최종 스코어·이닝별 점수만 남는다.
    expect(repo.countFixtures(season).played).toBe(before.played);
    const box = await call(d, 'game.boxScore', { fixtureId });
    expect(box.detailKept).toBe(false);
    expect(box.hits).toBeNull();
    expect(box.lineScore.home.length).toBeGreaterThan(0);
    d.close();
  }, 180_000);
});
