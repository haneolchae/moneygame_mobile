import { afterEach, describe, expect, it } from 'vitest';
import { weekday } from '../src/engine/calendar';
import { computeStandings } from '../src/engine/standings';
import { checkRegularSeasons } from '../src/host/invariants';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const newDir = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function toPostseason(seed: string, clubId = 7): Promise<Dispatcher> {
  const d = makeDispatcher(newDir());
  await call(d, 'game.new', { clubId, saveName: 't', seed });
  while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
  const r = await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
  expect(r.phase).toBe('postseason');
  return d;
}

describe('포스트시즌 (01 문서, D-081)', () => {
  it('정규시즌 1~5위로 대진을 만들고, 와일드카드는 정규시즌 종료 주 다음 목요일 4위 홈에서 시작한다', async () => {
    const d = await toPostseason('ps-bracket');
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    const ps = meta.postseason!;
    const table = computeStandings(repo.getClubs().map((c) => c.id), repo.getGames(meta.season));
    expect(ps.seeds).toEqual(table.slice(0, 5).map((r) => r.clubId));
    const wc = ps.series[0]!;
    expect([wc.high, wc.low]).toEqual([ps.seeds[3], ps.seeds[4]]);
    expect(weekday(wc.dates[0]!)).toBe(4);
    const first = repo.getFixturesOn(wc.dates[0]!)[0]!;
    expect(first.stage).toBe('wc');
    expect(first.home).toBe(ps.seeds[3]);
    const dash = await call(d, 'game.dashboard');
    expect(dash.postseason!.series).toHaveLength(4);
    d.close();
  });

  it('한국시리즈까지 끝나면 우승팀이 정해지고, 시리즈 승수 규칙과 정규시즌 기록 분리가 지켜진다', async () => {
    const d = await toPostseason('ps-full');
    const repo = d.saves.repository();
    const before = fingerprintRegular(d);
    const r = await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
    expect(r.phase).toBe('stove'); // 한국시리즈 다음 날 시즌 마감 → 스토브리그(D-085)
    const meta = repo.getMeta();
    const ps = meta.postseason!;
    expect(ps.champion).not.toBeNull();
    const [wc, semi, po, ks] = ps.series;
    // 와일드카드: 4위는 1승(또는 1무), 5위는 2승이 필요하다.
    expect(wc!.winner === wc!.high ? wc!.highWins >= 2 : wc!.lowWins === 2).toBe(true);
    for (const s of [semi!, po!]) expect(Math.max(s.highWins, s.lowWins)).toBe(3);
    expect(Math.max(ks!.highWins, ks!.lowWins)).toBe(4);
    expect(ks!.high).toBe(ps.seeds[0]);
    expect(semi!.low).toBe(wc!.winner);
    expect(po!.low).toBe(semi!.winner);
    expect(ks!.low).toBe(po!.winner);
    // 포스트시즌 경기 기록은 정규시즌 통계·순위에 섞이지 않는다.
    expect(fingerprintRegular(d)).toBe(before);
    const post = repo.getGames(meta.season, 'postseason');
    expect(post.length).toBeGreaterThanOrEqual(1 + 3 + 3 + 4);
    // 시즌 최종 순위에 포스트시즌 결과가 기록된다.
    const final = repo.getSeasonStandings(meta.season);
    expect(final.find((x) => x.clubId === ps.champion)!.postseason).toBe('한국시리즈 우승');
    expect(final.filter((x) => x.postseason === '').length).toBe(5);
    // 한국시리즈 날짜가 새 스토브리그 기준일이 되고, 다음 시즌 일정이 만들어진다.
    expect(meta.mode).toBe('stove');
    expect(meta.kDate).toBe(ps.finishedDate);
    expect(repo.countFixtures(meta.season + 1).total).toBe(720);
    d.close();
  });

  it('정규시즌 경기 수는 시즌 ID별로 정규시즌 마지막 날 기록되고, 포스트시즌·다음 시즌 일정 뒤에도 같다', async () => {
    const d = await toPostseason('ps-count');
    const repo = d.saves.repository();
    const season = repo.getMeta().season;
    const atEnd = (await call(d, 'game.dashboard')).lastRegularSeason;
    expect(atEnd).toMatchObject({ season, played: 720, total: 720 });
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 한국시리즈 → 시즌 마감 → 다음 시즌 일정 생성
    const dash = await call(d, 'game.dashboard');
    expect(dash.gamesPlayedLeague).toBe(0); // 화면의 현재 시즌 진행은 다음 시즌 기준
    expect(dash.lastRegularSeason).toEqual(atEnd);
    expect(checkRegularSeasons(repo)).toEqual([]);
    // 기록이 실제 경기와 어긋나면 규칙 위반으로 잡힌다.
    repo.updateMeta({ regularSeasons: { [String(season)]: { ...atEnd!, played: 719 } } });
    expect(checkRegularSeasons(repo).join()).toContain('미완료');
    d.close();
  });

  it('같은 시드면 포스트시즌 결과가 같고, 저장 후 불러와 이어도 같다', async () => {
    const run = async (saveMid: boolean) => {
      const d = await toPostseason('ps-repro');
      if (saveMid) {
        await call(d, 'game.advance', { mode: 'week' });
        await call(d, 'save.save', { slot: 'm' });
        await call(d, 'save.load', { slot: 'm' });
      }
      await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
      const out = `${fingerprint(d)}|${JSON.stringify(d.saves.repository().getMeta().postseason)}|${JSON.stringify(d.saves.repository().getGames(2027, 'postseason').map((g) => [g.fixtureId, g.homeRuns, g.awayRuns]))}`;
      d.close();
      return out;
    };
    const a = await run(false);
    expect(await run(true)).toBe(a);
    // 9a: 두 시즌을 두 번 돌리는 무거운 시험. 혼자 30초지만 전체 시험 병렬 부하·CPU 클럭 저하에서 129초까지 걸려 제한을 넉넉히 둔다
  }, 300_000);
});

/** 정규시즌 순위·선수 통계 요약 */
function fingerprintRegular(d: Dispatcher): string {
  const repo = d.saves.repository();
  const meta = repo.getMeta();
  const games = repo.getGames(meta.season);
  const bat = [...repo.battingTotals(meta.season).values()].reduce((a, t) => a + t.PA * 7 + t.HR, 0);
  const team = repo.teamTotals(meta.season).map((t) => `${t.clubId}:${t.pit.W}-${t.pit.L}:${t.bat.R}`);
  return `${games.length}|${bat}|${team.join(',')}`;
}
