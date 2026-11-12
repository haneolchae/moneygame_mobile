// 9b-1 기록 증분 집계(D-243): 지금 시즌 선수 합계·시상 기간 합계를 날짜별 줄 캐시에서 내도
// 원시 기록 SQL 집계와 값·순서가 같고, 하루를 더 진행하면 그날 기록만 더해져도 다시 같다. 롤백하면 캐시를 버린다.
import { describe, expect, it } from 'vitest';
import type { SqliteGameRepository } from '../src/persistence/repository';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

/** 캐시 경로와 원시 기록 경로의 결과를 같은 형태(순서 포함)로 펼친다 */
function snapshot(repo: SqliteGameRepository, season: number, opening: string, date: string) {
  const ids = [...repo.battingTotals(season).keys()].filter((_, i) => i % 7 === 0);
  const pids = [...repo.pitchingTotals(season).keys()].filter((_, i) => i % 5 === 0);
  const flat = <V>(m: Map<number, V>) => JSON.stringify([...m]);
  const out: string[] = [];
  out.push(flat(repo.battingTotals(season)), flat(repo.pitchingTotals(season)));
  out.push(flat(repo.battingTotals(season, ids)), flat(repo.pitchingTotals(season, pids)), flat(repo.battingTotals(season, [])));
  for (const club of [1, 4, 10]) out.push(flat(repo.battingTotals(season, undefined, club)), flat(repo.pitchingTotals(season, undefined, club)), flat(repo.pitchingTotals(season, pids, club)));
  for (const range of [undefined, { from: opening, to: date }, { from: '2027-04-01', to: '2027-04-10' }, { from: opening, to: '2027-03-31' }]) {
    const a = repo.awardLines(season, range);
    out.push(flat(a.batting), flat(a.pitching));
    const b = repo.awardLines(season, range, ids, true);
    out.push(flat(b.batting), flat(b.pitching));
  }
  return out;
}

describe('기록 증분 집계 (9b-1)', () => {
  it('캐시 결과 = 원시 기록 SQL 집계(전체·선수·구단·기간), 하루 더 진행해도 같다', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'stats-9b1', start: 'camp' });
      for (let i = 0; i < 200 && (await call(d, 'game.dashboard')).date < '2027-04-12'; i++) await call(d, 'game.advance', { mode: 'week' });
      const repo = d.saves.repository() as SqliteGameRepository;
      const season = repo.getMeta().season;
      const opening = repo.getGames(season)[0]!.date;
      expect(repo.getGames(season).length).toBeGreaterThan(50);
      const check = () => {
        const date = repo.getMeta().currentDate;
        repo.useStatCache = true;
        const cached = snapshot(repo, season, opening, date);
        repo.useStatCache = false;
        const sql = snapshot(repo, season, opening, date);
        repo.useStatCache = true;
        expect(cached).toEqual(sql);
      };
      check();
      // 캐시가 있는 채로 이틀 진행: 그날 기록만 더한 값이 다시 원시 기록 집계와 같다
      await call(d, 'game.advance', { mode: 'day' });
      await call(d, 'game.advance', { mode: 'day' });
      check();
      // 롤백하면 캐시를 버린다(트랜잭션 안에서 만든 캐시가 남지 않는다)
      expect(() =>
        repo.transaction(() => {
          repo.battingTotals(season);
          throw new Error('rollback');
        }),
      ).toThrow('rollback');
      expect((repo as unknown as { statCache: unknown }).statCache).toBeNull();
      check();
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 240_000);
});
