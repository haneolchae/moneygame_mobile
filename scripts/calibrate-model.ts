// 확률 모델 보정 도구 (10a 7a·8·10장, D-100·D-103·D-167): 새로 생성한 리그(능력 평균 50)로 경기만 돌려 리그 분포를 잰다.
// 사용: npm run calibrate -- [--seeds 6] [--games 720] [--runs 0] [--hr 0] [--tables]
//  --runs/--hr: 시즌 리그 환경 편차(예: 0.1 = +10%)를 넣어 환경 반영 크기를 확인한다.
//  --tables: 승리 확률 표(engine/data/winProbability.json)와 볼카운트 기준표(engine/data/countModel.json)를 새로 만든다(D-167 (1)(3)).
//            볼카운트 층을 끈 엔진으로 타석 전이·리그 대결 확률을 잰다. 엔진 사건 구성이 바뀌는 차수 끝에 다시 만든다.
// 기준 확률(PROBABILITY_CONFIG.base 등)은 이 도구로 리그 목표에 맞춘다. 게임 안에서는 시즌마다
// 같은 측정 함수(measureLeague)로 실제 1군 구성에 맞춰 다시 조정한다(D-103).
// 기본 실행은 리그 지표와 함께 4c-1 사전 등록 기준(D-168 ①②⑥)의 측정값을 낸다.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLUTCH, COUNT_BASE_SHAPE, MANAGER, SIM } from '../src/engine/config';
import { chainSummary, fitCountTable, fitMatchup, foulShares, meanPitches, type CountTable } from '../src/engine/count';
import COUNT_MODEL from '../src/engine/data/countModel.json';
import { applyDirective, countModelVersion, createGame, finishGame, managerDecide, nextDecision, preparePa, resolvePa, runPrePlays, simulateGame, type GameOptions, type GameState, type PaEvent, type PreparedPa } from '../src/engine/gamesim';
import { NEUTRAL_MANAGER, nextTrust, type ManagerProfile } from '../src/engine/manager';
import { emptyTotals, measureLeague, type LeagueTotals } from '../src/engine/leagueCalibration';
import { prepareTeam } from '../src/engine/lineup';
import { battingSide, type LeagueEnvironment } from '../src/engine/probability';
import { PROBABILITY_CONFIG } from '../src/engine/probabilityConfig';
import { Rng } from '../src/engine/rng';
import type { ClubId, PlayerId, PlayerTruth } from '../src/engine/types';
import { buildWinTables, END_STATE, tableCell, winTableVersion, type Transitions } from '../src/engine/winProb';
import { generateWorld } from '../src/engine/worldgen';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const seeds = Number(arg('seeds', '6'));
const games = Number(arg('games', '720'));
const env = { runs: Number(arg('runs', '0')), hr: Number(arg('hr', '0')) };
const makeTables = process.argv.includes('--tables');
const managerMode = process.argv.includes('--manager');

function activeOf(s: number): Map<ClubId, PlayerTruth[]> {
  const world = generateWorld(Rng.fromSeed(`calibrate-${s}`), 2026);
  const active = new Map<ClubId, PlayerTruth[]>();
  for (const p of world) if (p.clubId !== null && p.level === '1군') active.set(p.clubId, [...(active.get(p.clubId) ?? []), p]);
  return active;
}

const mask = (b: GameState['bases']) => (b[0] ? 1 : 0) | (b[1] ? 2 : 0) | (b[2] ? 4 : 0);

/** measureLeague와 같은 대진·선발 규칙으로 경기를 한 걸음씩 돌리며 타석마다 콜백(보정 도구 분석용) */
type StepState = { outs: number; bases: number; runs: number; inning: number; half: 'T' | 'B'; diff: number };
const stateOf = (g: GameState): StepState => ({ outs: g.outs, bases: mask(g.bases), runs: g.score.home + g.score.away, inning: g.inning, half: g.half, diff: g.score.home - g.score.away });

/** onStep: 결정 지점부터 타석이 끝날 때까지(주루 사건 포함) 한 걸음. 주루 사건으로 반 이닝이 끝나면 prep·ev는 null */
function playLeague(active: Map<ClubId, PlayerTruth[]>, n: number, seed: string, e: LeagueEnvironment, opts: GameOptions, onPa: (g: GameState, prep: PreparedPa, before: StepState, ev: PaEvent) => void, onStep?: (g: GameState, atDecision: StepState) => void): void {
  const clubs = [...active.keys()];
  const last = new Map<ClubId, PlayerId | null>();
  const pairs = Rng.derive(seed, 'league-calib', 'tool-detail');
  for (let i = 0; i < n; i++) {
    const home = pairs.pick(clubs);
    let away = pairs.pick(clubs);
    while (away === home) away = pairs.pick(clubs);
    const th = prepareTeam(home, active.get(home)!, [], last.get(home) ?? null);
    const ta = prepareTeam(away, active.get(away)!, [], last.get(away) ?? null);
    last.set(home, th.starter.id);
    last.set(away, ta.starter.id);
    const g = createGame(i + 1, th, ta, Rng.derive(seed, 'league-calib-detail', i), PROBABILITY_CONFIG.seasonCalibration.maxInnings, e, opts);
    for (let d = nextDecision(g); d; d = nextDecision(g)) {
      applyDirective(g, d, managerDecide(g, d));
      const atDecision = stateOf(g);
      if (!runPrePlays(g)) {
        onStep?.(g, atDecision);
        continue;
      }
      const prep = preparePa(g);
      const before = stateOf(g);
      const ev = resolvePa(g, prep);
      onPa(g, prep, before, ev);
      onStep?.(g, atDecision);
    }
    finishGame(g);
  }
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);

if (makeTables) {
  // ───────── 표 만들기(D-167 (1)(3)) ─────────
  const t0 = Date.now();
  const counts: Array<Map<string, number>> = Array.from({ length: 24 }, () => new Map());
  const occupancy = new Map<number, number>();
  const T = CLUTCH.table;
  const q = { n: 0, BB: 0, K: 0, HBP: 0 };
  for (let s = 0; s < seeds; s++) {
    // D-172 (8): 결정 지점부터 타석이 끝날 때까지(도루·폭투 같은 주루 사건 포함)를 한 전이로 잰다
    playLeague(
      activeOf(s),
      games,
      `calibrate-${s}`,
      env,
      { countLayer: 'off' },
      (_g, prep) => {
        q.n++;
        q.BB += prep.top.BB;
        q.K += prep.top.K;
        q.HBP += prep.top.HBP;
      },
      (g, at) => {
        const from = at.outs * 8 + at.bases;
        const to = g.outs >= 3 ? END_STATE : g.outs * 8 + mask(g.bases);
        const runs = g.score.home + g.score.away - at.runs;
        const key = `${to}:${runs}`;
        counts[from]!.set(key, (counts[from]!.get(key) ?? 0) + 1);
        const c = tableCell(T.maxInnings, T.diffMax, Math.min(at.inning, T.maxInnings), at.half, at.outs, at.bases, at.diff);
        occupancy.set(c, (occupancy.get(c) ?? 0) + 1);
      },
    );
  }
  const transitions: Transitions = counts.map((m) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    return [...m.entries()].map(([k, v]) => {
      const [to, runs] = k.split(':').map(Number) as [number, number];
      return { to, runs, p: v / total };
    });
  });
  const { wp, eAbs } = buildWinTables(transitions, T.maxInnings, T.diffMax, T.runsCap);
  let occN = 0;
  let occSum = 0;
  for (const [c, n] of occupancy) {
    occN += n;
    occSum += n * eAbs[c]!;
  }
  const normalizer = occSum / occN;
  const winBody = { maxInnings: T.maxInnings, diffMax: T.diffMax, normalizer: +normalizer.toFixed(6), samplePa: occN, wp: wp.map((v) => +v.toFixed(5)), li: eAbs.map((v) => +(v / normalizer).toFixed(4)) };
  const winJson = { version: `wp-${sha(JSON.stringify(winBody))}`, ...winBody };
  writeFileSync(join(process.cwd(), 'src/engine/data/winProbability.json'), JSON.stringify(winJson));
  // 볼카운트 기준표: 리그 기준 대결(볼카운트 층 없이 잰 평균 대결 확률)과 기존 결과별 투구 수에 맞춘다
  const targets = { rates: { BB: q.BB / q.n, K: q.K / q.n, HBP: q.HBP / q.n }, pitches: { BB: SIM.pitches.bb, K: SIM.pitches.k, HBP: SIM.pitches.hbp, IP: SIM.pitches.other }, foul: { ...CLUTCH.foulTargets } };
  const fit = fitCountTable(COUNT_BASE_SHAPE.map((r) => [...r]), targets);
  const countBody = { targets, theta: fit.theta.map((v) => +v.toFixed(6)), maxScaledResidual: +fit.maxScaledResidual.toFixed(6), table: fit.table.map((r) => r.map((v) => +v.toFixed(8))) };
  const countJson = { version: `cm-${sha(JSON.stringify(countBody))}`, ...countBody };
  writeFileSync(join(process.cwd(), 'src/engine/data/countModel.json'), JSON.stringify(countJson));
  console.log(JSON.stringify({ tables: { win: winJson.version, normalizer: winBody.normalizer, samplePa: occN, count: countJson.version, targets, theta: countBody.theta, maxScaledResidual: countBody.maxScaledResidual }, elapsedMs: Date.now() - t0 }));
  process.exit(0);
}

if (managerMode) {
  // ───────── D-173 ① 80 vs 50 감독, ③ 평균 감독 신뢰도 ─────────
  const t1 = Date.now();
  const strong: ManagerProfile = { ...NEUTRAL_MANAGER, ratings: { hitting: 80, pitching: 80, fieldRun: 80, tactics: 80, authority: 80, leadership: 80, condition: 80, development: 80 } };
  const perSeason = 144;
  const diffs: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const active = activeOf(s);
    const clubs = [...active.keys()];
    for (const c of clubs) {
      const wins = (mgr: ManagerProfile) => {
        let w = 0;
        const last = new Map<ClubId, PlayerId | null>();
        for (let i = 0; i < perSeason; i++) {
          const opp = clubs.filter((x) => x !== c)[i % (clubs.length - 1)]!;
          const home = i % 2 === 0;
          const tc = { ...prepareTeam(c, active.get(c)!, [], last.get(c) ?? null), manager: mgr };
          const to = prepareTeam(opp, active.get(opp)!, [], last.get(opp) ?? null);
          last.set(c, tc.starter.id);
          last.set(opp, to.starter.id);
          const r = home ? simulateGame(i + 1, tc, to, Rng.derive(`calibrate-${s}`, 'mgr', c, i), 11, env) : simulateGame(i + 1, to, tc, Rng.derive(`calibrate-${s}`, 'mgr', c, i), 11, env);
          if ((home && r.outcome === 'home') || (!home && r.outcome === 'away')) w++;
          else if (r.outcome === 'tie') w += 0.5;
        }
        return w;
      };
      diffs.push(wins(strong) - wins(NEUTRAL_MANAGER));
    }
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
  // ③ 평균 감독(능력치 50)의 한 시즌 신뢰도: 구단당 144경기, 경기마다 게임과 같은 규칙으로 갱신
  const ends: number[] = [];
  const sums: number[] = [];
  const counts: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const active = activeOf(s);
    const clubs = [...active.keys()];
    const st = new Map(clubs.map((c) => [c, { trust: 50, baseOff: 0, baseDef: 0, sum: 0, n: 0 }]));
    const a = 1 - Math.pow(0.5, 1 / MANAGER.trust.baselineHalfLife);
    const pairs = Rng.derive(`calibrate-${s}`, 'trust-sched');
    const last = new Map<ClubId, PlayerId | null>();
    for (let i = 0; i < (clubs.length * perSeason) / 2; i++) {
      const home = pairs.pick(clubs);
      let away = pairs.pick(clubs);
      while (away === home) away = pairs.pick(clubs);
      const th = prepareTeam(home, active.get(home)!, [], last.get(home) ?? null);
      const ta = prepareTeam(away, active.get(away)!, [], last.get(away) ?? null);
      last.set(home, th.starter.id);
      last.set(away, ta.starter.id);
      const r = simulateGame(i + 1, th, ta, Rng.derive(`calibrate-${s}`, 'trust', i), 11, env);
      for (const tr of r.wpTrack) {
        const m = st.get(tr.clubId)!;
        for (const d of r.managerDecisions.filter((x) => x.clubId === tr.clubId)) {
          const base = d.side === 'off' ? m.baseOff : m.baseDef;
          m.trust = nextTrust(m.trust, d.wpAfter - d.wpBefore, base);
          m.sum += d.wpAfter - d.wpBefore - base;
          m.n++;
        }
        if (tr.offN) m.baseOff += (1 - Math.pow(1 - a, tr.offN)) * (tr.offSum / tr.offN - m.baseOff);
        if (tr.defN) m.baseDef += (1 - Math.pow(1 - a, tr.defN)) * (tr.defSum / tr.defN - m.baseDef);
      }
    }
    for (const v of st.values()) ends.push(v.trust);
    for (const v of st.values()) sums.push(v.sum);
    for (const v of st.values()) counts.push(v.n);
  }
  const tMean = ends.reduce((x, y) => x + y, 0) / ends.length;
  console.log(
    JSON.stringify({
      manager: {
        winDiffPerSeason: +mean.toFixed(2),
        sd: +sd.toFixed(2),
        samples: diffs.length,
        decisions: { perSeason: +(counts.reduce((x, y) => x + y, 0) / counts.length).toFixed(0), scoreSumMean: +(sums.reduce((x, y) => x + y, 0) / sums.length).toFixed(3), scoreSumMaxAbs: +Math.max(...sums.map(Math.abs)).toFixed(3) },
        trustEnd: { min: +Math.min(...ends).toFixed(1), max: +Math.max(...ends).toFixed(1), mean: +tMean.toFixed(1), n: ends.length },
        verdict: { d173_1: mean >= 2 && mean <= 4, d173_3: Math.min(...ends) >= 30 && Math.max(...ends) <= 70 && tMean >= 45 && tMean <= 55 },
        K: MANAGER.K,
        gain: MANAGER.trust.gain,
      },
      elapsedMs: Date.now() - t1,
    }),
  );
  process.exit(0);
}

// D-173 ②: 리그 감독 능력치를 평균 50·표준편차 12로 나눠 준다(구단·시드 고정)
const leagueManager = (s: number) => (clubId: ClubId): ManagerProfile => {
  const r = Rng.derive(`calibrate-${s}`, 'league-manager', clubId);
  const v = () => Math.max(15, Math.min(95, Math.round(r.normal(50, 12))));
  return { ratings: { hitting: v(), pitching: v(), fieldRun: v(), tactics: v(), authority: v(), leadership: v(), condition: v(), development: v() }, smallBall: r.int(0, 100), quickHook: r.int(0, 100), trust: 50 };
};

const t: LeagueTotals = emptyTotals();
const t0 = Date.now();
for (let s = 0; s < seeds; s++) {
  const r = measureLeague(activeOf(s), games, `calibrate-${s}`, 'tool', env, leagueManager(s));
  for (const k of Object.keys(t) as Array<keyof LeagueTotals>) t[k] += r[k];
}
const elapsedMs = Date.now() - t0;
const obp = (t.h + t.bb + t.hbp) / (t.ab + t.bb + t.hbp + t.sf);
const slg = t.tb / t.ab;
const target = PROBABILITY_CONFIG.leagueTarget;

// ───────── 4c-1 사전 등록 기준 측정(D-168 ①②⑥) ─────────
const P0 = (COUNT_MODEL as { table: CountTable }).table;
let clutchReport: Record<string, unknown> = { tables: 'none' };
if (P0.length > 0) {
  // ① 대표 격자: 체인 흡수 확률과 대결 확률의 사건별 최대 차이(수식 계산)
  let gridMax = 0;
  let gridFail = 0;
  for (const bb of [0.03, 0.0725, 0.115, 0.1575, 0.2])
    for (const k of [0.08, 0.16, 0.24, 0.32, 0.4])
      for (const hbp of [0.003, 0.0165, 0.03]) {
        const f = fitMatchup(P0, { BB: bb, K: k, HBP: hbp }, CLUTCH.fitTolerance, CLUTCH.fitMaxIter);
        if (!f.ok) gridFail++;
        gridMax = Math.max(gridMax, f.maxError);
      }
  // ② (a) 리그 기준 대결(조정 없음)의 결과별 평균 투구 수
  const ref = meanPitches(chainSummary(P0));
  // ①·② (b) 실제 승부처 타석: 타석마다 맞춘 체인으로 계산
  let pa = 0;
  let paMax = 0;
  let paFail = 0;
  const mass = [0, 0, 0, 0];
  const absorb = [0, 0, 0, 0];
  // D-171 ③ 좌우: 같은 손·다른 손 대결의 OPS
  const split = { same: { pa: 0, ab: 0, h: 0, tb: 0, ob: 0, sf: 0 }, opp: { pa: 0, ab: 0, h: 0, tb: 0, ob: 0, sf: 0 } };
  for (let s = 0; s < seeds; s++) {
    playLeague(activeOf(s), games, `calibrate-${s}`, env, {}, (_g, prep, _before, ev) => {
      const grp = battingSide(prep.batter, prep.pitcher) === prep.pitcher.throws ? split.same : split.opp;
      const o = ev.outcome;
      grp.pa++;
      if (o === 'BB' || o === 'HBP') grp.ob++;
      else if (o === 'SF') grp.sf++;
      else if (o !== 'SH') grp.ab++;
      const tb = o === '1B' ? 1 : o === '2B' ? 2 : o === '3B' ? 3 : o === 'HR' ? 4 : 0;
      if (tb) (grp.h++, (grp.tb += tb), grp.ob++);
      if (!prep.clutch) return;
      pa++;
      const f = fitMatchup(P0, { BB: prep.top.BB, K: prep.top.K, HBP: prep.top.HBP }, CLUTCH.fitTolerance, CLUTCH.fitMaxIter);
      if (!f.ok) paFail++;
      paMax = Math.max(paMax, f.maxError);
      const c = chainSummary(f.table);
      for (let o = 0; o < 4; o++) {
        mass[o]! += c.pitchMass[o]!;
        absorb[o]! += c.absorb[o]!;
      }
    });
  }
  const old = [SIM.pitches.bb, SIM.pitches.k, SIM.pitches.hbp, SIM.pitches.other];
  const clutchMeans = mass.map((m, o) => +(m / absorb[o]!).toFixed(3));
  // D-169: 기준표의 투구당 파울 비율
  const fouls = foulShares(P0);
  const obpOf = (x: typeof split.same) => x.ob / Math.max(1, x.ab + x.ob - x.h + x.sf);
  const opsOf = (x: typeof split.same) => obpOf(x) + x.tb / Math.max(1, x.ab);
  const platoonGap = +(opsOf(split.opp) - opsOf(split.same)).toFixed(3);
  // D-171 ①: 팀 경기당 작전 사건
  const tg = 2 * t.games;
  const per = (n: number) => +(n / tg).toFixed(3);
  const freq = { stealAttempts: per(t.sb + t.cs), stealPct: +(t.sb / Math.max(1, t.sb + t.cs)).toFixed(3), sacBunt: per(t.sh), ibb: per(t.ibb), wildPitch: per(t.wp), passedBall: per(t.pb), balk: per(t.bk), pickoff: per(t.pickoff), pinchHit: per(t.ph), pinchRun: per(t.pr), defSub: per(t.defSub), hitAndRun: per(t.hnr), squeeze: per(t.squeeze) };
  const inR = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const d171_1 = inR(freq.stealAttempts, 0.4, 1.2) && inR(freq.stealPct, 0.65, 0.82) && inR(freq.sacBunt, 0.08, 0.4) && inR(freq.ibb, 0.03, 0.25) && inR(freq.wildPitch, 0.2, 0.55) && inR(freq.passedBall, 0.02, 0.12) && inR(freq.balk, 0.005, 0.06) && inR(freq.pickoff, 0.01, 0.08) && inR(freq.pinchHit, 0.3, 1.5) && inR(freq.pinchRun, 0.03, 0.4) && inR(freq.defSub, 0.03, 0.5) && inR(freq.hitAndRun, 0.02, 0.25) && freq.squeeze <= 0.06;
  const refMeans = ref.map((v) => +v.toFixed(3));
  const within = (v: number[]) => v.every((x, o) => Math.abs(x - old[o]!) <= 0.1);
  clutchReport = {
    tables: { win: winTableVersion(), count: countModelVersion() },
    leverageThreshold: CLUTCH.leverageThreshold,
    perGame: +(t.clutchPa / t.games).toFixed(2),
    gamesWithClutchPct: +((100 * t.clutchGames) / t.games).toFixed(1),
    chancesPerGame: +(t.clutchChances / t.games).toFixed(2),
    clutchPaPct: +((100 * t.clutchPa) / t.pa).toFixed(2),
    countFallback: t.countFallback,
    // D-168 ①: 사건별 최대 차이(격자 75점, 실제 승부처 타석), 풀이 실패 수
    absorbGridMaxError: gridMax,
    absorbClutchMaxError: paMax,
    fitFailures: gridFail + paFail,
    clutchPaAnalysed: pa,
    // D-168 ②: 결과별 평균 투구 수 [볼넷, 삼진, 사구, 인플레이], 기존 [5.6, 4.8, 3.6, 3.4]
    pitchesOld: old,
    pitchesRef: refMeans,
    pitchesClutch: clutchMeans,
    foulShares: { early: +fouls.early.toFixed(4), twoStrike: +fouls.twoStrike.toFixed(4), target: CLUTCH.foulTargets },
    tactics: freq,
    platoon: { sameOps: +opsOf(split.same).toFixed(3), oppOps: +opsOf(split.opp).toFixed(3), gap: platoonGap, samePa: split.same.pa, oppPa: split.opp.pa },
    verdict: {
      d171_1,
      d171_3: platoonGap >= 0.025 && platoonGap <= 0.09,
      d169_foul: Math.abs(fouls.early - CLUTCH.foulTargets.early) <= 0.01 && Math.abs(fouls.twoStrike - CLUTCH.foulTargets.twoStrike) <= 0.01,
      d168_1: gridMax <= 0.002 && paMax <= 0.002 && gridFail + paFail === 0 && t.countFallback === 0,
      d168_2: within(refMeans) && within(clutchMeans),
      d168_6: t.clutchPa / t.games >= 2 && t.clutchPa / t.games <= 6 && t.clutchChances / t.games >= 1.0,
    },
  };
}

console.log(
  JSON.stringify({
    modelVersion: PROBABILITY_CONFIG.modelVersion,
    env,
    games: t.games,
    runsPerGame: +(t.runs / t.games).toFixed(2),
    targetRunsPerGame: +(target.runsPerGame * (1 + env.runs)).toFixed(2),
    hrPerPa: +(t.hr / t.pa).toFixed(4),
    targetHrPerPa: +(target.hrPerPa * (1 + env.hr)).toFixed(4),
    avg: +(t.h / t.ab).toFixed(3),
    obp: +obp.toFixed(3),
    slg: +slg.toFixed(3),
    ops: +(obp + slg).toFixed(3),
    babip: +((t.h - t.hr) / (t.ab - t.k - t.hr + t.sf)).toFixed(3),
    bbPct: +(t.bb / t.pa).toFixed(3),
    kPct: +(t.k / t.pa).toFixed(3),
    doubles: t.b2,
    triples: t.b3,
    roePct: +(t.roe / t.pa).toFixed(4),
    // 존 모델 검증 지표(10b §14·§15.2, D-104)
    hitRateGB: +(t.hitGB / t.bipGB).toFixed(3),
    hitRateLD: +(t.hitLD / t.bipLD).toFixed(3),
    hitRateFB: +(t.hitFB / t.bipFB).toFixed(3),
    singlePct: +((100 * (t.h - t.hr - t.b2 - t.b3)) / (t.h - t.hr)).toFixed(1),
    doublePct: +((100 * t.b2) / (t.h - t.hr)).toFixed(1),
    triplePct: +((100 * t.b3) / (t.h - t.hr)).toFixed(2),
    infieldHitPct: +((100 * t.infieldHits) / t.h).toFixed(1),
    errorsPerTeamGame: +(t.errors / (2 * t.games)).toFixed(2),
    dpPerTeamGame: +(t.dp / (2 * t.games)).toFixed(2),
    sfPerTeamGame: +(t.sf / (2 * t.games)).toFixed(2),
    /** 순수 경기 계산 시간(measureLeague 4,320경기, D-104 (5)·D-168 ④) */
    elapsedMs,
    clutch: clutchReport,
  }),
);
