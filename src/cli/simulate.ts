// 헤드리스 장기 실행: 화면 없이 같은 엔진·저장 계층으로 여러 시즌을 돌리고 성능과 일관성을 측정한다.
// 사용: npm run sim -- --seasons 10 --seed abc
// 첫 해는 스토브리그(2026-11-08)부터 1주씩 진행해 시즌 모드로 넘어간 뒤 정규시즌을 치른다.
// 주의: 포스트시즌·두 번째 스토브리그·성장·노화가 아직 없어 둘째 해부터는 '정규시즌 반복'이다(임시 시즌 전환).
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Dispatcher } from '../host/dispatcher';
import { checkInvariants } from '../host/invariants';
import type { AdvanceResult, DashboardView, PlayerListItem, StandingView } from '../shared/protocol';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

async function main() {
  const seasons = Number(arg('seasons', '3'));
  const seed = arg('seed', 'sim-seed');
  const baseDir = mkdtempSync(join(tmpdir(), 'fo-sim-'));
  const d = new Dispatcher({ baseDir, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: 'CLI' }, appVersion: 'cli' }) });
  const call = async <T>(name: string, payload?: unknown): Promise<T> => {
    const r = await d.respond(name as never, payload as never);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.result as T;
  };
  const rows: Array<Record<string, unknown>> = [];
  const tNew = performance.now();
  await call<DashboardView>('game.new', { clubId: 1, saveName: '장기 실행', seed });
  const newGameMs = Math.round(performance.now() - tNew);

  const tStove = performance.now();
  let stoveWeeks = 0;
  while ((await call<DashboardView>('game.dashboard')).phase === 'stove') {
    await call('game.advance', { mode: 'week' });
    stoveWeeks++;
  }
  const stoveMs = Math.round(performance.now() - tStove);
  const afterStove = await call<DashboardView>('game.dashboard');
  console.log(JSON.stringify({ stoveWeeks, stoveMs, date: afterStove.date, cashAfterStove: afterStove.cashWon }));

  for (let s = 1; s <= seasons; s++) {
    // 두 번째 시즌부터: 한국시리즈 뒤 스토브리그를 주 단위로 지나 다음 시즌으로 간다(D-085).
    if (s > 1) while ((await call<DashboardView>('game.dashboard')).phase === 'stove') await call('game.advance', { mode: 'week' });
    const t0 = performance.now();
    const adv = await call<AdvanceResult>('game.advance', { mode: 'untilSeasonEnd' });
    const simMs = performance.now() - t0;
    const dash = await call<DashboardView>('game.dashboard');
    const q0 = performance.now();
    const hitters = await call<PlayerListItem[]>('game.players', { scope: 'all', group: 'hitters', sortKey: 'OPS', sortDesc: true });
    const q1 = performance.now();
    await call<PlayerListItem[]>('game.players', { scope: 'all', group: 'pitchers', sortKey: 'ERA' });
    const q2 = performance.now();
    const standings = await call<StandingView[]>('game.standings');
    const q3 = performance.now();
    const firstFixture = (await call<Array<{ fixtureId: number; played: boolean }>>('game.schedule', {})).find((f) => f.played);
    if (firstFixture) await call('game.boxScore', { fixtureId: firstFixture.fixtureId });
    const q4 = performance.now();
    const t5 = performance.now();
    await call('save.save', { slot: 'longrun' });
    const saveMs = performance.now() - t5;
    const inv = checkInvariants(d.saves.repository(), dash.season);
    const lg = hitters.reduce(
      (acc, h) => {
        acc.pa += Number(h.stats.PA ?? 0);
        acc.hr += Number(h.stats.HR ?? 0);
        return acc;
      },
      { pa: 0, hr: 0 },
    );
    rows.push({
      season: dash.season,
      games: `${dash.gamesPlayedLeague}/${dash.gamesTotalLeague}`,
      days: adv.daysProcessed,
      simSec: +(simMs / 1000).toFixed(2),
      msPerGame: +(simMs / Math.max(1, adv.gamesPlayed)).toFixed(2),
      hitterListMs: Math.round(q1 - q0),
      pitcherListMs: Math.round(q2 - q1),
      standingsMs: Math.round(q3 - q2),
      boxScoreMs: Math.round(q4 - q3),
      saveMs: Math.round(saveMs),
      sessionMB: +(statSync(d.saves.sessionPath).size / 1e6).toFixed(1),
      saveFileMB: +(statSync(join(d.saves.savesDir, 'longrun.db')).size / 1e6).toFixed(1),
      leagueHRperPA: lg.pa ? +(lg.hr / lg.pa).toFixed(4) : null,
      runsPerGame: +(standings.reduce((a, r) => a + (r.runsFor ?? 0), 0) / Math.max(1, dash.gamesPlayedLeague)).toFixed(2),
      cashWon: dash.cashWon,
      invariantErrors: inv.length,
      firstErrors: inv.slice(0, 3),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
    // 정규시즌 측정 뒤 포스트시즌을 마치면 시즌 마감 → 스토브리그로 넘어간다(D-085).
    await call<AdvanceResult>('game.advance', { mode: 'untilSeasonEnd' });
  }
  const tLoad = performance.now();
  await call('save.load', { slot: 'longrun' });
  const loadMs = Math.round(performance.now() - tLoad);
  const report = {
    environment: { node: process.versions.node, electron: process.versions.electron ?? null, platform: process.platform, arch: process.arch },
    seed,
    seasons,
    newGameMs,
    stoveWeeks,
    stoveMs,
    loadMs,
    rows,
  };
  const out = arg('out', '');
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  d.close();
  rmSync(baseDir, { recursive: true, force: true });
  console.log(JSON.stringify({ newGameMs, loadMs }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
