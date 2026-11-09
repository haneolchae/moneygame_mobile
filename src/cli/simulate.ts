// 헤드리스 장기 실행: 화면 없이 같은 엔진·저장 계층으로 여러 시즌을 돌리고 성능과 일관성을 측정한다.
// 사용: npm run sim -- --seasons 10 --seed abc [--max-stall 10]
// 첫 해는 스토브리그(2026-11-08)부터 1주씩 진행해 시즌 모드로 넘어간 뒤 정규시즌을 치른다.
// 한국시리즈 뒤에는 시즌 마감 → 스토브리그를 주 단위로 지나 다음 시즌으로 간다(D-085).
// 우리 구단은 운영·경영지원팀을 완전 위임으로 두고 돌린다. 사람 대신 내리는 결정은 없고, 게임 규칙(위임·의무 안건 D-095)만 쓴다.
// 진행 요청이 0일 진행으로 끝나는 일이 연속 --max-stall회(기본 10, verify BUDGET.stallAdvances, D-096)면 즉시 실패로 끝낸다.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PROBABILITY_CONFIG } from '../engine/probabilityConfig';
import { Dispatcher } from '../host/dispatcher';
import { checkInvariants, checkRegularSeasons, checkRosterComposition, checkRosterLimits } from '../host/invariants';
import type { AdvanceResult, DashboardView, DelegationPolicyView, OrganizationView, PlayerListItem, StandingView } from '../shared/protocol';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

async function main() {
  const seasons = Number(arg('seasons', '3'));
  const seed = arg('seed', 'sim-seed');
  const maxStall = Number(arg('max-stall', '10'));
  const baseDir = mkdtempSync(join(tmpdir(), 'fo-sim-'));
  const d = new Dispatcher({ baseDir, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: 'CLI' }, appVersion: 'cli' }) });
  const call = async <T>(name: string, payload?: unknown): Promise<T> => {
    const r = await d.respond(name as never, payload as never);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.result as T;
  };
  const rows: Array<Record<string, unknown>> = [];
  // 진행 정체 감시: 0일 진행이 연속 maxStall회면 원인(멈춘 이유·날짜)을 출력하고 실패로 끝낸다.
  let stall = 0;
  const advance = async (mode: 'day' | 'week' | 'untilSeasonEnd') => {
    const r = await call<AdvanceResult>('game.advance', { mode });
    stall = r.daysProcessed === 0 ? stall + 1 : 0;
    if (stall >= maxStall) {
      const dash = await call<DashboardView>('game.dashboard');
      console.log(JSON.stringify({ stalled: true, consecutiveZeroDayAdvances: stall, mode, date: dash.date, phase: dash.phase, reason: r.stoppedReason }));
      d.close();
      process.exit(2);
    }
    return r;
  };
  const tNew = performance.now();
  await call<DashboardView>('game.new', { clubId: 1, saveName: '장기 실행', seed });
  const newGameMs = Math.round(performance.now() - tNew);
  // 우리 구단: 위임 가능한 팀을 완전 위임으로 둔다(정책 한도는 기본값).
  const org = await call<OrganizationView>('org.view');
  for (const p of org.policies.filter((x) => x.team === 'ops' || x.team === 'admin')) await call('org.setPolicy', { ...p, mode: 'auto' } satisfies DelegationPolicyView);

  const tStove = performance.now();
  let stoveWeeks = 0;
  while ((await call<DashboardView>('game.dashboard')).phase === 'stove') {
    await advance('week');
    stoveWeeks++;
  }
  const stoveMs = Math.round(performance.now() - tStove);
  const afterStove = await call<DashboardView>('game.dashboard');
  console.log(JSON.stringify({ stoveWeeks, stoveMs, date: afterStove.date, cashAfterStove: afterStove.cashWon }));

  for (let s = 1; s <= seasons; s++) {
    // 두 번째 시즌부터: 한국시리즈 뒤 스토브리그를 주 단위로 지나 다음 시즌으로 간다(D-085).
    // 스토브리그를 지난 직후: 모든 구단 40인 한도(우리 구단은 의무 안건, AI는 같은 정리 규칙)
    const stoveErrors: string[] = [];
    if (s > 1) while ((await call<DashboardView>('game.dashboard')).phase === 'stove') await advance('week');
    stoveErrors.push(...[...checkRosterLimits(d.saves.repository()), ...checkRosterComposition(d.saves.repository())].map((e) => `스토브리그 후 ${e}`));
    const t0 = performance.now();
    const adv = await advance('untilSeasonEnd');
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
    const inv = [...stoveErrors, ...checkInvariants(d.saves.repository(), dash.season)];
    // 정규시즌 경기 수는 시즌 ID별 기록에서 읽는다.
    const regular = dash.lastRegularSeason;
    // 그 시즌 리그 목표(D-100): 기준값 × (1 + 시즌 편차)
    const env = d.saves.repository().getMeta().leagueEnvironment?.[String(dash.season)] ?? { runs: 0, hr: 0 };
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
      games: regular && regular.season === dash.season ? `${regular.played}/${regular.total}` : '0/1', // 기록이 없으면 미완료로 판정
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
      envRuns: env.runs,
      envHr: env.hr,
      targetRunsPerGame: +(PROBABILITY_CONFIG.leagueTarget.runsPerGame * (1 + env.runs)).toFixed(2),
      targetHrPerPa: +(PROBABILITY_CONFIG.leagueTarget.hrPerPa * (1 + env.hr)).toFixed(4),
      runsPerGame: +(standings.reduce((a, r) => a + (r.runsFor ?? 0), 0) / Math.max(1, dash.gamesPlayedLeague)).toFixed(2),
      cashWon: dash.cashWon,
      invariantErrors: inv.length,
      firstErrors: inv.slice(0, 3),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
    // 정규시즌 측정 뒤 포스트시즌을 마치면 시즌 마감 → 스토브리그로 넘어간다(D-085).
    await advance('untilSeasonEnd');
    // 다음 시즌 일정이 생긴 뒤에도 정규시즌 기록이 같은지 시즌마다 확인한다.
    const after = checkRegularSeasons(d.saves.repository());
    if (after.length) {
      const last = rows[rows.length - 1]!;
      last.invariantErrors = Number(last.invariantErrors) + after.length;
      last.firstErrors = [...(last.firstErrors as string[]), ...after].slice(0, 3);
      console.log(JSON.stringify({ season: dash.season, afterPostseasonErrors: after }));
    }
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
