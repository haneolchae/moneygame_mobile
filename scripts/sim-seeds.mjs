// 다시드 장기 실행(9b-2, D-242 (2)·D-248): 같은 빌드로 시드 여러 개를 나란히 돌리고 시드 평균으로 판정한다.
// 한 시드 결과가 실행마다 크게 흔들리는 기준(우승 쏠림·수상 쏠림·우리 구단 중대 사건·구단주 레벨·현금 배수)만 여기서 판정하고,
// 규칙 위반과 그 밖의 사전 등록 기준은 시드마다 cli/simulate가 판정한 것을 그대로 모은다.
//
// 사용: npm run sim:seeds -- [--seasons 10] [--seeds 5] [--seed verify] [--parallel 5] [--out 결과.json] [--log-dir 폴더]
//                          [--repeat-of 앞선_실행.json] [--skip-build]
//   --seed       시드 이름 앞부분. 시드는 <앞부분>-1 … <앞부분>-N (기본 verify → verify-1이 verify 기본 시드와 같다)
//   --repeat-of  같은 시드(첫 시드)·같은 시즌 수로 먼저 돌린 cli/simulate 결과 파일. 시간 측정값을 뺀 결과가 같은지 비교한다(같은 시드 결과 동일)
//   --skip-build 이미 빌드한 dist를 쓴다(verify가 부를 때)
// 판정은 10시즌 이상 실행에서만 한다(D-143·D-146). 위반이 있거나 시드 하나라도 실패하면 종료 코드 1.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';

const ROOT = resolve(import.meta.dirname, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const SEASONS = Number(arg('seasons', '10'));
const COUNT = Number(arg('seeds', '5'));
const BASE = arg('seed', 'verify');
const PARALLEL = Math.max(1, Number(arg('parallel', String(COUNT))));
const OUT = arg('out', '');
const REPEAT_OF = arg('repeat-of', '');
let LOG_DIR = arg('log-dir', '');

/** 시드 평균 판정 기준(D-248). 값은 원래 사전 등록 기준(D-137·D-183·D-211·D-239) 그대로이고 평균 방법만 정한다. */
export const SEED_CRITERIA = {
  champMax: { max: 5, label: 'D-239 ④ 한국시리즈 우승 한 구단 최다 횟수(시드 평균)' },
  awardTopShare: { max: 0.25, label: 'D-239 ① 수상 한 구단 최대 몫(시드 평균)' },
  mvpMax: { max: 4, label: 'D-239 ① 정규시즌 MVP 한 구단 최다 횟수(시드 평균)' },
  majorOurs: { min: 0.4, max: 0.6, label: 'D-211 ⑦ 우리 구단 중대 사건(모든 시드·시즌 평균)' },
  lastLevel: { min: 17, max: 20, label: 'D-183 ⑥ 10시즌 뒤 구단주 레벨(시드 평균)' },
  cashEach: { max: 2.0, label: 'D-137 ① 우리 구단 시즌 말 현금 배수(시즌별 시드 평균)' },
  cashLast: { min: 0.8, max: 1.8, label: 'D-137 ① 우리 구단 마지막 시즌 현금 배수(시드 평균)' },
  aiCashLast: { max: 2.0, label: 'D-137 ② AI 구단 마지막 시즌 현금 배수(시드 평균)' },
};

/** 시간 측정값을 뺀 결과 지문(같은 시드 결과 동일 비교용) */
const TIMING_KEYS = new Set(['simSec', 'msPerGame', 'hitterListMs', 'pitcherListMs', 'standingsMs', 'boxScoreMs', 'saveMs', 'sessionMB', 'saveFileMB']);
export function fingerprint(sim) {
  const rows = (sim.rows ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !TIMING_KEYS.has(k))));
  return JSON.stringify({ startDate: sim.startDate, stoveTurnsBySeason: sim.stoveTurnsBySeason, rows, summaryObs: sim.summaryObs });
}

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const r2 = (v) => (v === null ? null : +v.toFixed(2));

/** 시드별 결과에서 평균과 판정을 만든다 */
export function aggregate(sims, seasons) {
  const perSeed = sims.map(({ seed, sim }) => {
    const rows = sim.rows ?? [];
    const obs = rows.map((r) => r.obs ?? {});
    const champions = {};
    const mvpBy = {};
    const awardTotals = {};
    for (const o of obs) {
      if (o.champion !== null && o.champion !== undefined) champions[o.champion] = (champions[o.champion] ?? 0) + 1;
      if (o.mvpClub !== null && o.mvpClub !== undefined) mvpBy[o.mvpClub] = (mvpBy[o.mvpClub] ?? 0) + 1;
      for (const [c, n] of Object.entries(o.awardsByClub ?? {})) awardTotals[c] = (awardTotals[c] ?? 0) + n;
    }
    const awardAll = Object.values(awardTotals).reduce((a, b) => a + b, 0);
    return {
      seed,
      seasons: rows.length,
      invariantErrors: rows.reduce((a, r) => a + r.invariantErrors, 0),
      // 규칙 위반(사전 등록 기준 위반을 뺀 수)과 한 시드 기준 사전 등록 위반 수
      ruleErrors: rows.reduce((a, r) => a + r.invariantErrors - (r.preRegErrors ?? 0), 0),
      preRegErrors: rows.reduce((a, r) => a + (r.preRegErrors ?? 0), 0),
      // 해임 뒤 옮긴 구단(7b)과 중단 사유
      moves: sim.moves ?? [],
      ended: sim.ended ?? null,
      firstErrors: rows.flatMap((r) => (r.firstErrors ?? []).map((e) => `${r.season} ${e}`)),
      champions,
      champMax: Math.max(0, ...Object.values(champions)),
      mvpBy,
      mvpMax: Math.max(0, ...Object.values(mvpBy)),
      awardTopShare: awardAll ? +(Math.max(...Object.values(awardTotals)) / awardAll).toFixed(3) : 0,
      majorOurs: r2(mean(obs.map((o) => Number(o.majorOurs ?? 0)))),
      majorLeague: r2(mean(obs.map((o) => Number(o.majorLeague ?? 0)))),
      cards: r2(mean(obs.map((o) => Number(o.cards ?? 0)))),
      lastLevel: Number(obs.at(-1)?.level ?? 0),
      cash: rows.map((r) => r.cashRatio),
      aiCash: rows.map((r) => r.aiCashRatio),
      foreignFree: obs.map((o) => o.foreignFree ?? null),
      freeAgents: obs.map((o) => o.freeAgents ?? null),
      payrollEok: obs.map((o) => o.payrollEok ?? null),
      // 구단별 순위 흐름(강팀·약팀 재건·쇠퇴 관측)
      ranks: Object.fromEntries((obs[0]?.clubs ?? []).map((c) => [c.id, obs.map((o) => (o.clubs ?? []).find((x) => x.id === c.id)?.rank ?? null)])),
    };
  });
  const done = perSeed.filter((s) => s.seasons === seasons);
  const cashBySeason = Array.from({ length: seasons }, (_, i) => r2(mean(done.map((s) => s.cash[i]).filter((v) => typeof v === 'number'))));
  const aiCashBySeason = Array.from({ length: seasons }, (_, i) => r2(mean(done.map((s) => s.aiCash[i]).filter((v) => typeof v === 'number'))));
  const titles = {};
  for (const s of done) for (const [c, n] of Object.entries(s.champions)) titles[c] = (titles[c] ?? 0) + n;
  const average = {
    seeds: done.length,
    champMax: r2(mean(done.map((s) => s.champMax))),
    awardTopShare: done.length ? +mean(done.map((s) => s.awardTopShare)).toFixed(3) : null,
    mvpMax: r2(mean(done.map((s) => s.mvpMax))),
    majorOurs: r2(mean(done.map((s) => s.majorOurs))),
    majorLeague: r2(mean(done.map((s) => s.majorLeague))),
    cards: r2(mean(done.map((s) => s.cards))),
    lastLevel: r2(mean(done.map((s) => s.lastLevel))),
    cashBySeason,
    cashLast: cashBySeason.at(-1) ?? null,
    aiCashBySeason,
    aiCashLast: aiCashBySeason.at(-1) ?? null,
    // 관측: 모든 시드를 합친 구단별 우승 횟수, 마지막 시즌 외국인 무소속 평균
    titlesAllSeeds: titles,
    foreignFreeLast: r2(mean(done.map((s) => s.foreignFree.at(-1)).filter((v) => typeof v === 'number'))),
  };
  const verdicts = [];
  const errors = [];
  if (seasons >= 10 && done.length) {
    const C = SEED_CRITERIA;
    const check = (key, value, text = String(value)) => {
      const c = C[key];
      const ok = value !== null && (c.min === undefined || value >= c.min) && (c.max === undefined || value <= c.max);
      const range = c.min !== undefined && c.max !== undefined ? `${c.min}~${c.max}` : c.max !== undefined ? `${c.max} 이하` : `${c.min} 이상`;
      verdicts.push({ key, label: c.label, value: text, range, ok });
      if (!ok) errors.push(`사전 등록 ${c.label} 위반: ${text} (${range})`);
    };
    check('champMax', average.champMax, `${average.champMax}회 [${done.map((s) => s.champMax).join(', ')}]`);
    check('awardTopShare', average.awardTopShare, `${(100 * average.awardTopShare).toFixed(1)}% [${done.map((s) => (100 * s.awardTopShare).toFixed(1)).join(', ')}]`);
    verdicts.at(-1).range = `${100 * C.awardTopShare.max}% 이하`;
    check('mvpMax', average.mvpMax, `${average.mvpMax}회 [${done.map((s) => s.mvpMax).join(', ')}]`);
    check('majorOurs', average.majorOurs, `${average.majorOurs}건 [${done.map((s) => s.majorOurs).join(', ')}]`);
    check('lastLevel', average.lastLevel, `${average.lastLevel} [${done.map((s) => s.lastLevel).join(', ')}]`);
    const cashMax = Math.max(...cashBySeason);
    check('cashEach', cashMax, `최대 ${cashMax}배 (시즌별 ${cashBySeason.join(' · ')})`);
    check('cashLast', average.cashLast, `${average.cashLast}배 [${done.map((s) => s.cash.at(-1)).join(', ')}]`);
    check('aiCashLast', average.aiCashLast, `${average.aiCashLast}배 [${done.map((s) => s.aiCash.at(-1)).join(', ')}]`);
  }
  return { perSeed, average, verdicts, errors };
}

function runSeed(seed) {
  return new Promise((done) => {
    const out = join(LOG_DIR, `sim-${seed}.json`);
    const log = createWriteStream(join(LOG_DIR, `sim-${seed}.log`));
    const t0 = Date.now();
    const child = spawn(electronPath, ['dist/cli/simulate.js', '--seasons', String(SEASONS), '--seed', seed, '--max-stall', '10', '--out', out], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => {
      log.end();
      let sim = null;
      try {
        sim = JSON.parse(readFileSync(out, 'utf8'));
      } catch {}
      const sec = +((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[시드 ${seed}] ${sim ? `${(sim.rows ?? []).length}/${SEASONS}시즌` : '결과 없음'} (${sec}s, 종료 코드 ${code})`);
      done({ seed, sim, code, sec });
    });
  });
}

async function main() {
  LOG_DIR ||= mkdtempSync(join(tmpdir(), 'fo-seeds-'));
  mkdirSync(LOG_DIR, { recursive: true });
  process.chdir(ROOT);
  if (!process.argv.includes('--skip-build')) {
    const b = spawnSync('node scripts/build.mjs', { shell: true, stdio: 'inherit' });
    if (b.status !== 0) process.exit(1);
  }
  const seeds = Array.from({ length: COUNT }, (_, i) => `${BASE}-${i + 1}`);
  console.log(`다시드 장기 실행: ${SEASONS}시즌 × 시드 ${seeds.join(', ')} (동시 ${PARALLEL}개, 로그 ${LOG_DIR})`);
  const results = [];
  const queue = [...seeds];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, seeds.length) }, async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) results.push(await runSeed(s));
  }));
  results.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
  const failed = results.filter((r) => !r.sim || (r.sim.rows ?? []).length !== SEASONS).map((r) => r.seed);
  const agg = aggregate(results.filter((r) => r.sim).map((r) => ({ seed: r.seed, sim: r.sim })), SEASONS);
  // 같은 시드 결과 동일: 먼저 돌린 실행과 첫 시드 결과를 비교한다
  let repeat = null;
  if (REPEAT_OF) {
    try {
      const prev = JSON.parse(readFileSync(REPEAT_OF, 'utf8'));
      const cur = results.find((r) => r.seed === prev.seed)?.sim;
      repeat = cur && prev.seasons === SEASONS ? { seed: prev.seed, same: fingerprint(prev) === fingerprint(cur) } : { seed: prev.seed, same: null };
    } catch {
      repeat = { seed: null, same: null };
    }
  }
  const report = { seasons: SEASONS, seeds, failed, secBySeed: Object.fromEntries(results.map((r) => [r.seed, r.sec])), repeat, ...agg };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  for (const s of agg.perSeed) console.log(`[시드 ${s.seed}] 규칙 위반 ${s.ruleErrors}건·사전 등록(한 시드 기준) 위반 ${s.preRegErrors}건${s.firstErrors.length ? `: ${s.firstErrors.slice(0, 4).join(' / ')}` : ''} · 우승 ${JSON.stringify(s.champions)} · 레벨 ${s.lastLevel} · 우리 사건 ${s.majorOurs} · 현금 ${s.cash.at(-1)}·AI ${s.aiCash.at(-1)}`);
  for (const v of agg.verdicts) console.log(`[${v.ok ? '통과' : '미달'}] ${v.label}: ${v.value} — 기준 ${v.range}`);
  if (repeat) console.log(`같은 시드(${repeat.seed}) 다시 실행 결과: ${repeat.same === true ? '동일' : repeat.same === false ? '다름' : '비교 못 함'}`);
  if (failed.length) console.log(`완료하지 못한 시드: ${failed.join(', ')}`);
  // 실패: 완료하지 못한 시드, 시드 평균 기준 미달, 규칙 위반(어느 시드든), 첫 시드의 사전 등록 기준 위반, 같은 시드 결과 불일치.
  // 첫 시드가 아닌 시드의 사전 등록 기준(한 시드 기준으로 등록된 것)은 참고로만 남긴다(D-248).
  const bad = failed.length > 0 || agg.errors.length > 0 || agg.perSeed.some((s, i) => s.ruleErrors > 0 || (i === 0 && s.preRegErrors > 0)) || repeat?.same === false;
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
