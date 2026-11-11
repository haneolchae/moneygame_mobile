import { afterEach, describe, expect, it } from 'vitest';
import { SEASON_2026_STANDINGS } from '../src/engine/clubs';
import { checkAchievements } from '../src/host/invariants';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const newDir = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function weeks(d: Dispatcher, n: number) {
  for (let i = 0; i < n; i++) await call(d, 'game.advance', { mode: 'week' });
}

async function playSeason(seed: string, clubId = 7) {
  const d = makeDispatcher(newDir());
  await call(d, 'game.new', { clubId, saveName: 't', seed });
  while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
  await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
  return d;
}

describe('우리 선수 능력치·기간별 기록 (D-078·D-079)', () => {
  it('우리 선수는 실제 능력치를 그대로, 타 구단 선수는 오차가 있는 평가로 본다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'exact' });
    const repo = d.saves.repository();
    const mine = repo.getPlayers().find((p) => p.clubId === 3 && !p.isPitcher)!;
    const v = await call(d, 'game.player', { playerId: mine.id });
    expect(v.exactRatings).toBe(true);
    expect(v.ratings.contact).toBe(mine.batting.contact);
    expect(v.ratings.def_fielding).toBe(mine.defense.fielding);
    const others = repo.getPlayers().filter((p) => p.clubId !== 3 && p.clubId !== null && !p.isPitcher).slice(0, 30);
    let differs = 0;
    for (const o of others) {
      const ov = await call(d, 'game.player', { playerId: o.id });
      expect(ov.exactRatings).toBe(false);
      if (ov.ratings.contact !== o.batting.contact) differs++;
    }
    expect(differs).toBeGreaterThan(5);
    d.close();
  });

  it('시작 이전 기록: 직전 3개 시즌(2026·2025·2024)과 통산이 맞고, 같은 시드면 같다', async () => {
    const run = async () => {
      const d = makeDispatcher(newDir());
      await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'hist' });
      const vet = d.saves.repository().getPlayers().find((p) => p.clubId === 3 && !p.isPitcher && p.level === '1군' && p.career.proSeasons >= 5)!;
      const v = await call(d, 'game.player', { playerId: vet.id });
      d.close();
      return v.record;
    };
    const r = await run();
    expect(r.current).toBeNull(); // 스토브리그에는 현재 시즌 기록이 없다
    expect(r.recent.map((l) => l.season)).toEqual([2026, 2025, 2024]);
    expect(r.recent.every((l) => l.preGame)).toBe(true);
    expect(Number(r.career!.values.HR)).toBeGreaterThanOrEqual(r.recent.reduce((a, l) => a + Number(l.values.HR), 0));
    expect(JSON.stringify(await run())).toBe(JSON.stringify(r));
  });

  it('시즌을 치르면 현재 기록은 원시 기록과 같고, 통산에 더해진다. 팀 통계는 10개 구단 순위가 붙는다', async () => {
    const d = await playSeason('season-records');
    const repo = d.saves.repository();
    const [pid, raw] = [...repo.battingTotals(2027, undefined, 7).entries()].sort((x, y) => y[1].PA - x[1].PA)[0]!;
    const p = repo.getPlayer(pid)!;
    const v = await call(d, 'game.player', { playerId: p.id });
    expect(v.record.current!.values.HR).toBe(raw.HR);
    expect(v.record.current!.values.PA).toBe(raw.PA);
    const hist = repo.getHistory({ playerIds: [p.id] }).reduce((a, l) => a + (l.totals as { PA: number }).PA, 0);
    expect(v.record.career!.values.PA).toBe(hist + raw.PA);
    const team = await call(d, 'game.team');
    expect(team.statsSeason).toBe(2027);
    for (const i of [...team.batting, ...team.pitching]) {
      expect(i.rank).toBeGreaterThanOrEqual(1);
      expect(i.rank).toBeLessThanOrEqual(10);
    }
    // 팀 홈런 = 선수별 홈런 합(우리 구단 소속 기록)
    const teamHr = [...repo.battingTotals(2027, undefined, 7).values()].reduce((a, t) => a + t.HR, 0);
    expect(team.batting.find((x) => x.key === 'HR')!.value).toBe(String(teamHr));
    const h2026 = team.history.find((h) => h.season === 2026)!;
    const real = SEASON_2026_STANDINGS.find((s) => s.clubId === 7)!;
    expect([h2026.wins, h2026.losses, h2026.rank]).toEqual([real.wins, real.losses, real.rank]);
    expect(team.history.find((h) => h.season === 2027)!.wins).toBeGreaterThan(0);
    expect(team.records.length).toBeGreaterThan(4);
    d.close();
  });
});

describe('업적 (D-080·D-182·D-183)', () => {
  it('실제 기록으로 판정하고 경험치를 주며, 같은 시드면 같은 업적·같은 날짜다. 불러와도 중복되지 않는다. 아래 단계 함께·판정 값 = 기록', async () => {
    const a = await playSeason('ach');
    const b = await playSeason('ach');
    const list = (d: Dispatcher) => JSON.stringify(d.saves.repository().getAchievements());
    expect(list(a)).toBe(list(b));
    const got = a.saves.repository().getAchievements();
    expect(got.some((x) => x.key === 'A_first.1')).toBe(true);
    // 팀 시즌 성적·왕조 업적은 정규시즌 마지막 날 판정된다(포스트시즌 단계 제외).
    for (const s of got.filter((x) => /^(E_|F_)/.test(x.key) && x.date <= '2027-09-19')) expect(s.date).toBe('2027-09-19');
    // ② 아래 단계가 같은 날 이전에 모두 있다, ④ 시즌 업적 경험치 ≤ 300
    expect(checkAchievements(a.saves.repository())).toEqual([]);
    // ③ 타자·투수 시즌 기록: 판정 값이 단계 기준 이상이고 시즌 최종 기록(우리 구단 소속) 이하
    const repo = a.saves.repository();
    const bat = repo.battingTotals(2027, undefined, 7);
    const pit = repo.pitchingTotals(2027, undefined, 7);
    const players = new Map(repo.getPlayers().map((p) => [p.name, p.id]));
    const sample = got.filter((x) => /^(B_hr|B_h|B_rbi|C_w|C_k|C_sv)\./.test(x.key));
    expect(sample.length).toBeGreaterThan(0);
    for (const x of sample) {
      const m = /^2027 (.+) (\d+)(?:홈런|안타|타점|승|탈삼진|세이브)\((\d+)\)$/.exec(x.detail)!;
      expect(m, x.detail).not.toBeNull();
      const [, who, threshold, value] = m;
      expect(Number(value)).toBeGreaterThanOrEqual(Number(threshold));
      const id = players.get(who!)!;
      const final = x.key.startsWith('B_hr') ? bat.get(id)!.HR : x.key.startsWith('B_h.') ? bat.get(id)!.H : x.key.startsWith('B_rbi') ? bat.get(id)!.RBI : x.key.startsWith('C_w') ? pit.get(id)!.W : x.key.startsWith('C_k') ? pit.get(id)!.K : pit.get(id)!.SV;
      expect(Number(value)).toBeLessThanOrEqual(final);
    }
    const meta = a.saves.repository().getMeta();
    const totalXp = got.reduce((s, x) => s + x.xp, 0);
    expect(meta.ownerLevel > 1 || meta.ownerXp === totalXp).toBe(true);
    // 업적 판정 근거와 기록이 맞는지: 첫 승 날짜에 우리 구단 승리가 있다
    const firstWin = got.find((x) => x.key === 'A_first.1')!;
    const games = a.saves.repository().getGames(2027).filter((g) => g.date === firstWin.date && (g.home === 7 || g.away === 7));
    expect(games.some((g) => (g.home === 7 ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns))).toBe(true);
    await call(a, 'save.save', { slot: 'x' });
    await call(a, 'save.load', { slot: 'x' });
    expect(list(a)).toBe(list(b));
    const team = await call(a, 'game.team');
    expect(team.achievements.filter((x) => x.achieved.length).length).toBe(new Set(got.map((x) => x.key)).size);
    // 8d(D-187 ①): 달성 전 P·Q는 이름·조건·키가 응답에 없다
    const hiddenItems = team.achievements.filter((x) => x.masked && x.achieved.length === 0);
    expect(hiddenItems.length).toBeGreaterThan(50);
    for (const x of hiddenItems) expect([x.title, x.seriesTitle, x.key.startsWith('hidden-')]).toEqual(['???', '???', true]);
    const json = JSON.stringify(team.achievements.filter((x) => x.achieved.length === 0));
    for (const word of ['한만두', '퍼펙트 당함', 'P_hanmandu', 'Q_perfect']) expect(json).not.toContain(word);
    // ③ 경기 계열 표본: 판정 값이 그날 우리 경기 기록과 같다
    const games7 = a.saves.repository().getGames(2027).filter((g) => g.home === 7 || g.away === 7);
    let checked = 0;
    for (const x of got.filter((y) => /^(P_bigInning|Q_runsA)\./.test(y.key))) {
      const date = x.detail.slice(0, 10);
      const day = games7.filter((g) => g.date === date);
      expect(day.length, x.detail).toBeGreaterThan(0);
      if (x.key.startsWith('P_bigInning')) expect(day.some((g) => x.detail.includes(`한 이닝 ${Math.max(...(g.home === 7 ? g.lineScore.home : g.lineScore.away))}득점`)), x.detail).toBe(true);
      else expect(day.some((g) => x.detail.includes(` ${g.home === 7 ? g.awayRuns : g.homeRuns}실점`)), x.detail).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    a.close();
    b.close();
  });
});

describe('결재 흐름 (D-077)', () => {
  it('담당 팀이 스스로 안건을 올리고, 주 시작 결재(일괄 포함)는 행동력을 쓰지 않는다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'agenda' });
    await weeks(d, 2); // FA 시장 개장(11/17) 뒤
    const dash = await call(d, 'game.dashboard');
    expect(dash.approvals.length).toBeGreaterThan(0);
    expect(dash.approvals.some((a) => a.kind === 'fa')).toBe(true);
    const ap = dash.owner.apRemaining;
    const r = await call(d, 'org.decideMany', { approvalIds: dash.approvals.map((a) => a.id), approve: true });
    expect(r.message).toContain('승인');
    const after = await call(d, 'game.dashboard');
    expect(after.owner.apRemaining).toBe(ap);
    expect(after.approvals.length).toBeLessThan(dash.approvals.length + 1);
    d.close();
  });

  it('12월 1일 연봉 협상 대상이 자체 안건으로 올라오고, 구단주가 직접 제시하면 그 위임은 멈춘다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'agenda-salary' });
    await weeks(d, 4); // 12/7
    const repo = d.saves.repository();
    const salaryTasks = repo.getTasks({ kind: 'salary' });
    expect(salaryTasks.length).toBeGreaterThan(5);
    const talk = (await call(d, 'market.view')).salaryTalks.find((t) => t.status === '협상 중')!;
    await call(d, 'market.salaryOffer', { playerId: talk.playerId, offerWon: talk.demandWon });
    const t = repo.getTasks({ kind: 'salary', targetId: talk.playerId })[0]!;
    expect(t.status).toBe('cancelled');
    expect(t.note).toBe('구단주 직접 협상으로 전환');
    expect(repo.getApprovals('pending').some((a) => a.taskId === t.id)).toBe(false);
    d.close();
  });
});

describe('실제 KBO 구단 역사 (D-082)', () => {
  it('창단부터 2025까지 실제 시즌 성적·우승·레전드가 구단 역사에 붙고, 이름은 가상이다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'real-history' });
    const v = await call(d, 'game.team');
    expect(v.founded).toBe(1982);
    const years = v.history.map((h) => h.season);
    expect(years[years.length - 1]).toBe(1982);
    expect(years[0]).toBe(2026);
    expect(v.history.filter((h) => h.source === 'real')).toHaveLength(44);
    // 2025까지 8회 + 2026 실제 우승
    expect(v.titles.ks).toHaveLength(9);
    expect(v.legends.length).toBeGreaterThanOrEqual(10);
    for (const l of v.legends) expect(l.name.length).toBeGreaterThan(1);
    // 구단 기록은 실제 기록과 게임 기록 중 더 좋은 쪽
    expect(v.records.some((r) => r.source === 'real')).toBe(true);
    const options = await call(d, 'game.clubOptions');
    expect(options.find((o) => o.id === 8)!.ksTitles).toBe(12);
    expect(options.find((o) => o.id === 3)!.founded).toBe(2008);
    d.close();
  });
});

describe('명예의 전당 (D-083)', () => {
  it('모든 구단을 열람할 수 있고, 구단주 재임 중 우리 구단이 이룬 것만 구단주 달성으로 표시된다', async () => {
    const d = await playSeason('hof');
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 포스트시즌까지
    const mine = await call(d, 'game.hallOfFame', { clubId: 7 });
    expect(mine.isUserClub).toBe(true);
    const h2027 = mine.history.find((h) => h.season === 2027)!;
    expect(h2027.mine).toBe(true);
    expect(mine.history.filter((h) => h.season <= 2026).every((h) => !h.mine)).toBe(true);
    expect(mine.timeline.filter((t) => t.year <= 2026).every((t) => !t.mine)).toBe(true);
    for (const r of mine.records) if (r.mine) expect(r.source).toBe('game');
    const other = await call(d, 'game.hallOfFame', { clubId: 1 });
    expect(other.isUserClub).toBe(false);
    expect(other.founded).toBe(1982);
    expect(other.history.some((h) => h.mine)).toBe(false);
    expect(other.history.find((h) => h.season === 2027)!.wins).toBeGreaterThan(0);
    expect(other.achievements.every((a) => a.achieved.length === 0)).toBe(true);
    expect(other.timeline[0]!.label).toContain('창단');
    const bad = await d.respond('game.hallOfFame', { clubId: 99 });
    expect(bad.ok).toBe(false);
    d.close();
  });
});
