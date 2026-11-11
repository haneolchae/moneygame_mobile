// 8e 올스타전(D-189·D-190·D-191): ① 같은 시드·같은 진행이면 같은 투표·선정·경기·홈런 레이스 ② 팀당 24명·전 구단 1명 이상·자격·부상
// ③ 정규 기록과 분리 ④ 투수 6아웃·9회 ⑥ 8e-2 연결(캠페인·유치 신청·인센티브·연봉 가산·피로·한정 유니폼)
import { describe, expect, it } from 'vitest';
import { allStarDates, allStarWindow, teamOfClub } from '../src/engine/allStar';
import { addDays } from '../src/engine/calendar';
import { ALLSTAR } from '../src/engine/config';
import { injuredOn, pitcherFatigue } from '../src/engine/health';
import { salaryDemand } from '../src/engine/contracts';
import { settle, type SponsorContract } from '../src/engine/sponsors';
import type { GameService } from '../src/game/service';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const svcOf = (d: unknown) => (d as { game(): GameService }).game();
type D = ReturnType<typeof makeDispatcher>;
const today = async (d: D) => (await call(d, 'game.dashboard')).date;
/** date가 될 때까지(그 전날까지 처리) 진행: 멀면 주 단위, 가까우면 하루씩 */
async function advanceTo(d: D, date: string) {
  while ((await today(d)) < date) {
    const now = await today(d);
    await call(d, 'game.advance', { mode: addDays(now, 7) <= date ? 'week' : 'day' });
  }
}

/** 새 게임(유치 신청) → 투표 시작(캠페인·한정 유니폼 발주) → 올스타 판매 기간 시작 전날까지 */
async function play(seed: string, checks: boolean) {
  const dir = tempDir();
  const d = makeDispatcher(dir);
  const dates = allStarDates(2027);
  await call(d, 'game.new', { clubId: 1, saveName: 't', seed });
  const repo = d.saves.repository();
  // 8e-2 유치 신청: 스토브리그 행동력 2, 같은 시즌 두 번째는 거부
  const apply = await call(d, 'allStar.apply', {});
  expect(apply.view.hosting.applied).toBe(true);
  await expect(call(d, 'allStar.apply', {})).rejects.toThrow();
  await advanceTo(d, addDays(dates.voteStart, -1));
  // 투표 시작 전날: 캠페인은 기간 밖이라 거부(비용 없음)
  const cash = repo.cashBalance(1);
  await expect(call(d, 'allStar.campaign', {})).rejects.toThrow();
  expect(repo.cashBalance(1)).toBe(cash);
  await call(d, 'game.advance', { mode: 'day' });
  const cash0 = repo.cashBalance(1);
  const c = await call(d, 'allStar.campaign', {});
  expect(c.view.campaign.done).not.toBeNull();
  expect(repo.cashBalance(1)).toBe(cash0 - c.view.campaign.costWon);
  const cash1 = repo.cashBalance(1);
  await expect(call(d, 'allStar.campaign', {})).rejects.toThrow();
  expect(repo.cashBalance(1)).toBe(cash1);
  // 한정 유니폼은 직접 발주만(입고는 판매 기간 전)
  await call(d, 'business.orderMerch', { sku: 'allstar', qty: 2000 });
  await advanceTo(d, allStarWindow(2027).from);
  if (checks) {
    const m = repo.getMeta().merch!['1']!;
    expect(m.stock.allstar.qty).toBe(2000);
    expect(m.totals['2027']?.allstar.sold ?? 0).toBe(0);
  }
  return { d, dir, repo };
}

describe('올스타전 (8e)', () => {
  it('선정·대체·경기·홈런 레이스, 정규 기록 분리, 재현성, 8e-2 연결', async () => {
    const dates = allStarDates(2027);
    const win = allStarWindow(2027);
    const run1 = await play('allstar-8e', true);
    const { d, dir, repo } = run1;
    try {
      // 정규 기록 스냅숏: 올스타 주(목~월)는 정규 경기가 없으므로 올스타 처리 전후 같아야 한다
      await advanceTo(d, dates.hrRace);
      const before = JSON.stringify({ bat: [...repo.awardLines(2027).batting.entries()], pit: [...repo.awardLines(2027).pitching.entries()], games: repo.getGames(2027, 'regular').length, st: repo.getSeasonStandings(2027) });
      await advanceTo(d, addDays(dates.letter, 1));
      const after = JSON.stringify({ bat: [...repo.awardLines(2027).batting.entries()], pit: [...repo.awardLines(2027).pitching.entries()], games: repo.getGames(2027, 'regular').length, st: repo.getSeasonStandings(2027) });
      expect(after).toBe(before);
      expect(repo.getGames(2027, 'regular').some((x) => x.fixtureId === ALLSTAR.fixtureBase + 2027)).toBe(false);

      const row = repo.getAllStar(2027)!;
      expect(row.interim.length).toBe(ALLSTAR.interimWeeks);
      // 유치 신청 반영
      expect(row.applicants).toContain(1);
      expect(row.hostBy).toBe('application');
      expect(row.campaign?.clubId).toBe(1);
      // ② 팀당 24명(부상으로 빠진 선수 제외), 같은 팀 모든 구단 1명 이상, 투표 자격자 안에서만
      for (const t of ['dream', 'nanum'] as const) {
        expect(row.picks.filter((p) => p.team === t && p.status !== 'injured').length, t).toBe(24);
        for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((x) => teamOfClub(x) === t)) expect(row.picks.some((p) => p.clubId === c), `club ${c}`).toBe(true);
      }
      expect(row.picks.every((p) => teamOfClub(p.clubId) === p.team)).toBe(true);
      const ballotIds = new Set(row.ballot.map((b) => b.playerId));
      expect(row.picks.every((p) => ballotIds.has(p.playerId))).toBe(true);
      // 경기 출전자는 출전 가능 선정자만(부상 0), ④ 투수 6아웃·9회
      const g = row.game!;
      const okIds = new Set(row.picks.filter((p) => p.status === 'ok').map((p) => p.playerId));
      const players = new Map(repo.getPlayers().map((p) => [p.id, p]));
      for (const l of g.lines) {
        expect(okIds.has(l.playerId), `played ${l.playerId}`).toBe(true);
        expect(injuredOn(players.get(l.playerId)?.health?.injury, g.date)).toBe(false);
        expect(l.OUTS).toBeLessThanOrEqual(ALLSTAR.maxOuts);
      }
      expect(g.innings).toBe(ALLSTAR.innings);
      expect(g.mvp.length).toBeGreaterThan(0);
      expect(row.hrRace!.matches.length).toBe(7);
      // 화면·명예의 전당·선수 상세
      const view = await call(d, 'allStar.view', { season: 2027 });
      expect(view.stage).toBe('done');
      expect(view.roster.length).toBe(row.picks.length);
      const hof = await call(d, 'awards.list', { season: 2027 });
      expect(hof.items.some((i) => i.award === 'allstar_mvp')).toBe(true);
      expect(hof.items.some((i) => i.award === 'hr_race')).toBe(true);
      const mvpDetail = await call(d, 'game.player', { playerId: g.mvp[0]! });
      expect(mvpDetail.allStar.count).toBe(1);
      expect(mvpDetail.allStar.record).not.toBeNull();
      // 업적: 우리 선수 선정 수 = O_allstar 판정 값
      const ours = row.picks.filter((p) => p.clubId === 1).length;
      const got = new Set(repo.getAchievements().map((x) => x.key));
      [1, 5, 10, 25].forEach((t, i) => expect(got.has(`O_allstar.${i + 1}`), `O_allstar ${t} (보유 ${ours})`).toBe(ours >= t));
      [3, 5, 7].forEach((t, i) => expect(got.has(`O_allstarSeason.${i + 1}`), `O_allstarSeason ${t}`).toBe(ours >= t));

      // 8e-2 피로: 올스타전에 던진 투수는 그날을 출전일로 센다
      const svc = svcOf(d);
      const pitched = g.lines.find((l) => l.pitches > 0)!;
      const next = addDays(g.date, 1);
      const usage = repo.getRecentPitcherUsage(addDays(next, -7), next).filter((u) => u.pitcherId === pitched.playerId).map((u) => ({ daysAgo: Math.round((Date.parse(g.date) - Date.parse(u.date)) / 86_400_000), pitches: u.pitches }));
      const withAs = svc.health.fatigueMap(next, [players.get(pitched.playerId)!]).get(pitched.playerId)!;
      expect(withAs).toBeGreaterThan(pitcherFatigue(usage));

      // 8e-2 한정 유니폼: 판매 기간에만 팔리고 기간이 끝나면 판매 0
      await advanceTo(d, addDays(win.to, 1));
      const soldEnd = repo.getMeta().merch!['1']!.totals['2027']!.allstar.sold;
      expect(soldEnd).toBeGreaterThan(0);
      await advanceTo(d, addDays(win.to, 8));
      expect(repo.getMeta().merch!['1']!.totals['2027']!.allstar.sold).toBe(soldEnd);

      // 8e-2 스폰서 인센티브 조건
      const base = { incentive: { kind: 'allstar3', bonusWon: 100 }, obligation: 'none', guaranteedWon: 1000 } as unknown as SponsorContract;
      const facts = { postseason: false, rank: 5, occupancy: 0.5, satisfaction: 50, campaigns: 0 };
      expect(settle(base, { ...facts, allStars: 3 }).incentiveWon).toBe(100);
      expect(settle(base, { ...facts, allStars: 2 }).incentiveWon).toBe(0);
      expect(settle({ ...base, incentive: { kind: 'mrAllstar', bonusWon: 100 } } as SponsorContract, { ...facts, mrAllstar: true }).incentiveWon).toBe(100);

      // 8e-2 연봉 요구액: 직전 시즌 올스타는 +5%(스토브리그 협상 시작을 그대로 호출)
      const meta = repo.getMeta();
      const star = repo.getPlayers().find((p) => p.origin === 'domestic' && p.clubId !== null && row.picks.some((x) => x.playerId === p.id))!;
      const plain = repo.getPlayers().find((p) => p.origin === 'domestic' && p.clubId !== null && !row.picks.some((x) => x.playerId === p.id))!;
      repo.savePlayers([{ ...star, contractYears: 0 }, { ...plain, contractYears: 0 }]);
      const stove = { ...meta, mode: 'stove' as const };
      (svc.market as unknown as { openSalaryTalks(m: unknown, d: string, o: unknown): void }).openSalaryTalks(stove, meta.currentDate, { inbox: [], ledger: [] });
      const talks = repo.getSalaryTalks((svc.market as unknown as { offseason(m: unknown): number }).offseason(stove));
      const r1m = (n: number) => Math.round(n / 1_000_000) * 1_000_000;
      expect(talks.find((t) => t.playerId === star.id)!.demand).toBe(r1m(salaryDemand(meta.seed, { ...star, contractYears: 0 }, 2028) * (1 + ALLSTAR.salaryBonus)));
      expect(talks.find((t) => t.playerId === plain.id)!.demand).toBe(salaryDemand(meta.seed, { ...plain, contractYears: 0 }, 2028));

      // ① 같은 시드·같은 진행이면 같은 투표·선정·경기·홈런 레이스
      const run2 = await play('allstar-8e', false);
      try {
        await advanceTo(run2.d, addDays(dates.letter, 1));
        expect(JSON.stringify(run2.repo.getAllStar(2027))).toBe(JSON.stringify(row));
      } finally {
        run2.d.close();
        cleanup(run2.dir);
      }
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);
});
