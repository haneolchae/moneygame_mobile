// 개발 검증. 오류 검사(타입·경계·테스트·빌드·실제 Electron·장기 실행)와
// 문서 정합성 검사를 단계(stage)별로 돌리고 verify-reports/에 리포트를 남긴다.
//
// 사용:  verify.bat <차수> [--stage dev|phase|milestone] [--seasons N] [--seed verify-1]
//        node scripts/verify.mjs --label 2c --stage milestone
//   --label   개발 차수 이름(리포트 파일 이름과 제목에 쓴다)
//   --stage   dev       작업 중 확인: 타입·경계·바뀐 파일 관련 테스트(vitest --changed)
//             phase     차수 종료 검증(기본값): 타입·경계·전체 테스트·빌드·실제 Electron 자체 점검·장기 실행 2시즌·문서·저장소
//             milestone 최종 마일스톤 검증: phase + 장기 실행 10시즌. 모든 기능 차수가 끝난 뒤 한 번(D-143)
//   --quick   --stage dev와 같다(기존 명령 호환)
//   --seasons 장기 실행 시즌 수(지정하면 단계 기본값보다 우선)
//
// 판정: FAIL이 하나라도 있으면 종료 코드 1. WARN은 통과지만 리포트에 사유를 남긴다.
// 기준값은 아래 BUDGET, 단계별 검사 항목은 STAGES에 모아 두었다. 근거는 06_progress.md '첫 개발 단계 검증 결과'와 03_development.md '성능과 운영 제안'.
// dev 단계 리포트는 latest-dev.md에만 남겨 차수 종료 리포트(latest.md)를 덮어쓰지 않는다.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
process.chdir(ROOT);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

/** 단계별 검사 항목. 단계를 바꾸면 근거를 결정 로그에 남긴다. */
const STAGES = {
  dev: { name: '작업 중 확인', changedTestsOnly: true, build: false, selftest: false, sim: false, seasons: 0, docs: false, git: false },
  phase: { name: '차수 종료 검증', changedTestsOnly: false, build: true, selftest: true, sim: true, seasons: 2, docs: true, git: true },
  milestone: { name: '최종 마일스톤 검증', changedTestsOnly: false, build: true, selftest: true, sim: true, seasons: 10, docs: true, git: true },
};

const LABEL = arg('label', 'unlabeled');
const STAGE_ID = flag('quick') ? 'dev' : arg('stage', 'phase');
if (!STAGES[STAGE_ID]) {
  console.error(`알 수 없는 단계: ${STAGE_ID} (dev | phase | milestone)`);
  process.exit(1);
}
const STAGE = STAGES[STAGE_ID];
const SEASONS = Number(arg('seasons', String(STAGE.seasons)));
const SEED = arg('seed', 'verify-1');

/** 판정 기준. 실패(fail)는 규칙·데이터 오류, 경고(warn)는 성능·밸런스 이상 신호다. */
const BUDGET = {
  // 장기 실행 (cli/simulate)
  invariantErrors: { fail: 0 }, // 규칙 위반 0건
  seasonSimSec: { warn: 7, fail: 15 }, // 시즌 720경기 진행 시간 (D-144: 5→7초, 원래 목표 5초는 성능 개선 차수 9a에서 회복)
  listQueryMs: { warn: 200, fail: 1000 }, // 리그 전체 선수 목록 정렬
  boxScoreMs: { warn: 50, fail: 500 },
  saveMs: { warn: 2000, fail: 10000 }, // 10시즌 누적 저장 (현재 약 1.5초)
  loadMs: { warn: 2000, fail: 10000 },
  runsPerGame: { min: 6, max: 12 }, // 양 팀 합계 경기당 득점 (가상 리그 밸런스 범위)
  hrPerPa: { min: 0.015, max: 0.035 },
  campStart: '2027-02-01', // ①(D-214·D-231): 새 게임은 첫 스토브리그 자동 실행 뒤 2027-02-01 캠프에서 시작(예전 '첫 스토브리그 12주' 대체)
  newGameMs: { warn: 10000 }, // D-215 새 게임 생성 예산 10초(판정은 9a, 그 전까지 경고만)
  stoveTurns: 4, // D-216 두 번째 이후 스토브리그 4턴
  stallAdvances: { fail: 10 }, // 0일 진행이 연속 이 횟수면 장기 실행을 즉시 실패로 끝낸다 (D-096 초기안)
  leagueTargetPct: { warn: 0.08 }, // 시즌 리그 목표(득점·홈런, 기준값 × (1 + 시즌 편차)) 대비 차이의 '전체 시즌 평균'이 이 비율을 넘으면 경고 (D-100, 평균 판정은 D-145)
  // Electron 자체 점검
  rendererLagMs: { warn: 50, fail: 250 }, // 화면 타이머 최대 지연
  mainLoopMs: { warn: 100, fail: 500 }, // 메인 프로세스 이벤트 루프 최대 지연
};

const stamp = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
})();
const REPORT_DIR = join(ROOT, 'verify-reports');
const LOG_DIR = join(REPORT_DIR, 'logs', `${stamp}_${LABEL}`);
mkdirSync(LOG_DIR, { recursive: true });

// VS Code 확장 등에서 상속된 ELECTRON_RUN_AS_NODE는 Electron 앱 실행을 깨뜨리므로 지운다(README).
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));

/** @type {Array<{id:string,name:string,status:'PASS'|'FAIL'|'WARN'|'SKIP',sec:number,summary:string,details:string[],log?:string}>} */
const steps = [];

function run(id, command, { timeoutMs = 600_000, env = cleanEnv } = {}) {
  const t0 = Date.now();
  const r = spawnSync(command, { shell: true, encoding: 'utf8', env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}${r.error ? `\n[error] ${r.error.message}` : ''}`;
  const log = join(LOG_DIR, `${id}.log`);
  writeFileSync(log, `$ ${command}\n\n${out}`);
  return { code: r.status ?? 1, out, sec: +((Date.now() - t0) / 1000).toFixed(1), log, timedOut: r.error?.code === 'ETIMEDOUT' };
}

function record(id, name, status, sec, summary, details = [], log) {
  steps.push({ id, name, status, sec, summary, details, log: log ? log.replace(ROOT + (process.platform === 'win32' ? '\\' : '/'), '') : undefined });
  const mark = { PASS: '통과', FAIL: '실패', WARN: '경고', SKIP: '건너뜀' }[status];
  console.log(`[${mark}] ${name} (${sec}s) ${summary}`);
  for (const d of details.slice(0, 10)) console.log(`        - ${d}`);
}

const tailLines = (text, n = 15) => text.trim().split(/\r?\n/).slice(-n);
const worst = (...s) => (s.includes('FAIL') ? 'FAIL' : s.includes('WARN') ? 'WARN' : 'PASS');
const judge = (value, b) => (b.fail !== undefined && value > b.fail ? 'FAIL' : b.warn !== undefined && value > b.warn ? 'WARN' : 'PASS');

console.log(`\n=== 프런트 오피스 검증: ${LABEL} (${STAGE.name}) ===\n`);

// 1. 환경
{
  const details = [];
  let status = 'PASS';
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  details.push(`Node ${process.versions.node}, ${process.platform}/${process.arch}`);
  if (nodeMajor < 22) {
    status = 'FAIL';
    details.push('Node 22 이상이 필요합니다(node:sqlite).');
  }
  if (!existsSync('node_modules')) {
    status = 'FAIL';
    details.push('node_modules가 없습니다. npm install을 먼저 실행하세요.');
  }
  record('env', '실행 환경', status, 0, status === 'PASS' ? '준비됨' : '실행할 수 없는 환경', details);
  if (status === 'FAIL') finish();
}

// 2. 타입 검사
{
  const r = run('typecheck', 'npm run typecheck');
  const errs = r.out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
  record('typecheck', '타입 검사', r.code === 0 ? 'PASS' : 'FAIL', r.sec, r.code === 0 ? '오류 0건' : errs.length ? `오류 ${errs.length}건` : '실행 실패', errs.length ? errs.slice(0, 10) : r.code === 0 ? [] : tailLines(r.out), r.log);
}

// 3. 계층 경계
{
  const r = run('boundaries', 'npm run check:boundaries');
  record('boundaries', '계층 경계 검사', r.code === 0 ? 'PASS' : 'FAIL', r.sec, tailLines(r.out, 1)[0] ?? '', r.code === 0 ? [] : tailLines(r.out, 10), r.log);
}

// 4. 자동 테스트
let testCount = null;
{
  const json = join(LOG_DIR, 'vitest.json');
  // dev 단계는 git 기준 바뀐 파일과 관련된 테스트만 돌린다(vitest --changed).
  const changed = STAGE.changedTestsOnly ? ' --changed --passWithNoTests' : '';
  const r = run('test', `npx vitest run${changed} --reporter=default --reporter=json --outputFile.json="${json}"`);
  let summary = r.code === 0 ? '통과' : '실패';
  const details = [];
  try {
    const v = JSON.parse(readFileSync(json, 'utf8'));
    testCount = v.numTotalTests;
    summary = `${v.numPassedTests}/${v.numTotalTests}개 통과` + (v.numFailedTests ? `, 실패 ${v.numFailedTests}` : '') + (v.numPendingTests ? `, 보류 ${v.numPendingTests}` : '');
    for (const f of v.testResults ?? []) for (const a of f.assertionResults ?? []) if (a.status === 'failed') details.push(`${a.fullName}: ${(a.failureMessages?.[0] ?? '').split('\n')[0]}`);
    if (v.numPendingTests) details.push('건너뛴(skip/todo) 테스트가 있습니다. 차수 종료 전에 정리하세요.');
  } catch {
    details.push(...tailLines(r.out));
  }
  const status = r.code !== 0 ? 'FAIL' : details.length ? 'WARN' : 'PASS';
  record('test', STAGE.changedTestsOnly ? '자동 테스트(바뀐 파일 관련)' : '자동 테스트', status, r.sec, summary, details, r.log);
  // 바뀐 파일 관련 테스트 수는 전체 수가 아니므로 문서 정합성의 테스트 수 비교에 넘기지 않는다.
  if (STAGE.changedTestsOnly) testCount = null;
}

// 5~7. 빌드 · Electron 자체 점검 · 장기 실행
if (!STAGE.build) {
  record('build', '빌드', 'SKIP', 0, `${STAGE.name}에서는 생략`);
  record('selftest', '실제 Electron 자체 점검', 'SKIP', 0, `${STAGE.name}에서는 생략`);
  record('sim', '장기 실행', 'SKIP', 0, `${STAGE.name}에서는 생략`);
} else {
  const b = run('build', 'npm run build');
  record('build', '빌드', b.code === 0 ? 'PASS' : 'FAIL', b.sec, b.code === 0 ? '완료' : '실패', b.code === 0 ? [] : tailLines(b.out), b.log);

  if (b.code !== 0) {
    record('selftest', '실제 Electron 자체 점검', 'SKIP', 0, '빌드 실패');
    record('sim', `장기 실행 ${SEASONS}시즌`, 'SKIP', 0, '빌드 실패');
  } else {
    if (!STAGE.selftest) {
      record('selftest', '실제 Electron 자체 점검', 'SKIP', 0, `${STAGE.name}에서는 생략`);
    } else {
      // 자체 점검
      const out = join(LOG_DIR, 'selftest.json');
      const s = run('selftest', 'node scripts/selftest.mjs', { timeoutMs: 360_000, env: { ...cleanEnv, FO_VERIFY_SELFTEST_OUT: out } });
      let rep = null;
      try {
        rep = JSON.parse(readFileSync(out, 'utf8'));
      } catch {}
      if (!rep) {
        record('selftest', '실제 Electron 자체 점검', 'FAIL', s.sec, s.timedOut ? '시간 초과' : '결과 없음', tailLines(s.out), s.log);
      } else {
        const checks = [];
        const st = [];
        if (rep.error) st.push('FAIL'), checks.push(`오류: ${rep.error}`);
        if (rep.reloadMatches !== true) st.push('FAIL'), checks.push('저장 후 불러온 상태가 진행 상태와 다름');
        const [gp, gt] = String(rep.gamesPlayed ?? '0/1').split('/').map(Number);
        if (gp !== gt) st.push('FAIL'), checks.push(`정규시즌 미완료 ${rep.gamesPlayed}`);
        if (rep.startDate !== BUDGET.campStart || rep.stoveWeeks !== 0) st.push('FAIL'), checks.push(`새 게임 시작일 ${rep.startDate} ≠ ${BUDGET.campStart} (스토브리그 진행 ${rep.stoveWeeks}회)`);
        if ((rep.newGameMs ?? 0) > BUDGET.newGameMs.warn) st.push('WARN'), checks.push(`새 게임 생성 ${rep.newGameMs}ms > ${BUDGET.newGameMs.warn}ms`);
        const lag = judge(rep.rendererMaxTimerLagMs ?? 0, BUDGET.rendererLagMs);
        if (lag !== 'PASS') st.push(lag), checks.push(`화면 최대 지연 ${rep.rendererMaxTimerLagMs}ms (경고 ${BUDGET.rendererLagMs.warn}ms)`);
        const ml = judge(rep.mainProcessEventLoopMaxDelayMs ?? 0, BUDGET.mainLoopMs);
        if (ml !== 'PASS') st.push(ml), checks.push(`메인 프로세스 최대 지연 ${rep.mainProcessEventLoopMaxDelayMs}ms`);
        const summary = `새 게임(첫 스토브리그 자동 실행) ${rep.newGameMs}ms → ${rep.startDate}, 시즌 ${rep.gamesPlayed} ${rep.seasonAdvanceMs}ms, 화면 지연 ${rep.rendererMaxTimerLagMs}ms, 저장 ${rep.saveMs}ms·불러오기 ${rep.loadMs}ms, Steam ${rep.steam?.mode ?? '?'}`;
        record('selftest', '실제 Electron 자체 점검', worst(...st), s.sec, summary, checks, s.log);
      }
    }

    // 장기 실행 (빌드 산출물을 그대로 Electron의 Node 모드로 실행)
    const simOut = join(LOG_DIR, 'sim.json');
    const m = run('sim', `node scripts/run-electron-node.mjs dist/cli/simulate.js --seasons ${SEASONS} --seed ${SEED} --max-stall ${BUDGET.stallAdvances.fail} --out "${simOut}"`, { timeoutMs: 1_800_000, env: process.env });
    let sim = null;
    try {
      sim = JSON.parse(readFileSync(simOut, 'utf8'));
    } catch {}
    // 진행 정체: simulate가 '{"stalled":true,...}' 한 줄을 남기고 종료 코드 2로 끝난다.
    const stallLine = m.out.split(/\r?\n/).find((l) => l.startsWith('{"stalled":true'));
    if (!sim && stallLine) {
      const st = JSON.parse(stallLine);
      record('sim', `장기 실행 ${SEASONS}시즌`, 'FAIL', m.sec, `진행 정체: 0일 진행 ${st.consecutiveZeroDayAdvances}회 연속 (${st.date}, ${st.phase})`, [`멈춘 이유: ${st.reason ?? '알 수 없음'}`, ...tailLines(m.out, 8)], m.log);
    } else if (!sim) {
      record('sim', `장기 실행 ${SEASONS}시즌`, 'FAIL', m.sec, m.timedOut ? '시간 초과' : '결과 없음', tailLines(m.out), m.log);
    } else {
      const st = [];
      const checks = [];
      const runsDev = [];
      const hrDev = [];
      if (sim.startDate !== BUDGET.campStart || sim.stoveWeeks !== 0) st.push('FAIL'), checks.push(`새 게임 시작일 ${sim.startDate} ≠ ${BUDGET.campStart}`);
      if ((sim.newGameMs ?? 0) > BUDGET.newGameMs.warn) st.push('WARN'), checks.push(`새 게임 생성 ${sim.newGameMs}ms > ${BUDGET.newGameMs.warn}ms`);
      for (const [s, n] of Object.entries(sim.stoveTurnsBySeason ?? {})) if (n !== BUDGET.stoveTurns) st.push('FAIL'), checks.push(`${s}시즌 앞 스토브리그 ${n}턴 ≠ ${BUDGET.stoveTurns}턴`);
      if ((sim.rows ?? []).length !== SEASONS) st.push('FAIL'), checks.push(`완료 시즌 ${(sim.rows ?? []).length}/${SEASONS}`);
      for (const r of sim.rows ?? []) {
        const tag = `${r.season}시즌`;
        if (r.invariantErrors > BUDGET.invariantErrors.fail) st.push('FAIL'), checks.push(`${tag} 규칙 위반 ${r.invariantErrors}건: ${(r.firstErrors ?? []).join(' / ')}`);
        const [a, b2] = String(r.games).split('/').map(Number);
        if (a !== b2) st.push('FAIL'), checks.push(`${tag} 경기 미완료 ${r.games}`);
        const pairs = [
          ['seasonSimSec', r.simSec, '시즌 진행', 's'],
          ['listQueryMs', Math.max(r.hitterListMs, r.pitcherListMs), '선수 목록 정렬', 'ms'],
          ['boxScoreMs', r.boxScoreMs, '박스스코어', 'ms'],
          ['saveMs', r.saveMs, '저장', 'ms'],
        ];
        for (const [k, v, label, unit] of pairs) {
          const j = judge(v, BUDGET[k]);
          if (j !== 'PASS') st.push(j), checks.push(`${tag} ${label} ${v}${unit} (경고 ${BUDGET[k].warn}${unit})`);
        }
        if (r.runsPerGame < BUDGET.runsPerGame.min || r.runsPerGame > BUDGET.runsPerGame.max) st.push('WARN'), checks.push(`${tag} 경기당 득점 ${r.runsPerGame} (범위 ${BUDGET.runsPerGame.min}~${BUDGET.runsPerGame.max})`);
        if (r.leagueHRperPA !== null && (r.leagueHRperPA < BUDGET.hrPerPa.min || r.leagueHRperPA > BUDGET.hrPerPa.max)) st.push('WARN'), checks.push(`${tag} 타석당 홈런 ${r.leagueHRperPA}`);
        // 시즌 목표 대비 차이는 시즌마다 모아 두고, 아래에서 전체 시즌 평균으로 판정한다(시즌별 편차는 설계에 포함).
        if (r.targetRunsPerGame) runsDev.push(r.runsPerGame / r.targetRunsPerGame - 1);
        if (r.targetHrPerPa && r.leagueHRperPA !== null) hrDev.push(r.leagueHRperPA / r.targetHrPerPa - 1);
      }
      const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
      for (const [xs, label] of [[runsDev, '경기당 득점'], [hrDev, '타석당 홈런']]) {
        if (!xs.length) continue;
        const d = mean(xs);
        if (Math.abs(d) > BUDGET.leagueTargetPct.warn) st.push('WARN'), checks.push(`${label}: 시즌 목표 대비 ${xs.length}시즌 평균 ${(100 * d).toFixed(1)}% (경고 ±${100 * BUDGET.leagueTargetPct.warn}%)`);
      }
      const lj = judge(sim.loadMs ?? 0, BUDGET.loadMs);
      if (lj !== 'PASS') st.push(lj), checks.push(`불러오기 ${sim.loadMs}ms`);
      const last = sim.rows?.at(-1) ?? {};
      const cash = (sim.rows ?? []).map((r) => r.cashWon);
      const cashNote = cash.length ? `현금 ${Math.round(cash[0] / 1e8)}억 → ${Math.round(cash.at(-1) / 1e8)}억` : '';
      const totalInv = (sim.rows ?? []).reduce((a, r) => a + r.invariantErrors, 0);
      const summary = `${(sim.rows ?? []).length}시즌, 규칙 위반 ${totalInv}건, 마지막 시즌 저장 ${last.saveMs}ms·저장본 ${last.saveFileMB}MB, 불러오기 ${sim.loadMs}ms, ${cashNote}`;
      record('sim', `장기 실행 ${SEASONS}시즌 (시드 ${SEED})`, worst(...st), m.sec, summary, checks, m.log);
    }
  }
}

// 8. 문서 정합성
if (!STAGE.docs) record('docs', '문서 정합성', 'SKIP', 0, `${STAGE.name}에서는 생략`);
else {
  const out = join(LOG_DIR, 'docs.json');
  const r = run('docs', `node scripts/check-docs.mjs --json "${out}"${testCount !== null ? ` --tests ${testCount}` : ''}`);
  let res = null;
  try {
    res = JSON.parse(readFileSync(out, 'utf8'));
  } catch {}
  if (!res) record('docs', '문서 정합성', 'FAIL', r.sec, '검사 실행 실패', tailLines(r.out), r.log);
  else {
    const details = [...res.errors.map((e) => `[실패] ${e}`), ...res.warnings.map((w) => `[경고] ${w}`)];
    record('docs', '문서 정합성', res.errors.length ? 'FAIL' : res.warnings.length ? 'WARN' : 'PASS', r.sec, `실패 ${res.errors.length}건, 경고 ${res.warnings.length}건, 임시 가정 ${res.assumptions.length}건`, details, r.log);
    steps.at(-1).assumptions = res.assumptions;
    steps.at(-1).progress = res.progress;
  }
}

// 9. 변경 상태 (정보)
if (STAGE.git) {
  const r = run('git', 'git status --porcelain');
  const lines = r.out.split(/\r?\n/).filter((l) => /^[ MADRCU?!]{2} /.test(l));
  const head = run('git-head', 'git rev-parse --short HEAD');
  const commit = head.code === 0 ? head.out.trim().split(/\r?\n/)[0] : '커밋 없음';
  // 커밋 전 검증이 정상 흐름이므로 커밋되지 않은 변경은 경고가 아닌 정보로 남긴다.
  record('git', '저장소 상태', 'PASS', 0, `HEAD ${commit}, 커밋되지 않은 변경 ${lines.length}개`, lines.length ? ['검증을 통과한 상태로 커밋하세요.'] : []);
}

finish();

function finish() {
  const overall = worst(...steps.map((s) => s.status));
  const word = { PASS: '통과', WARN: '조건부 통과(경고 있음)', FAIL: '실패' }[overall];
  const md = [];
  md.push(`# 검증 리포트: ${LABEL}`, '');
  md.push(`- 일시: ${new Date().toLocaleString('ko-KR')}`);
  md.push(`- 단계: ${STAGE.name} (--stage ${STAGE_ID})${STAGE.sim ? `, 장기 실행 ${SEASONS}시즌, 시드 ${SEED}` : ''}${STAGE_ID === 'dev' ? ' — 차수 종료 검증 아님' : ''}`);
  md.push(`- 환경: Node ${process.versions.node}, ${process.platform}/${process.arch}`);
  md.push(`- **종합 판정: ${word}**`, '');
  md.push('| 단계 | 판정 | 시간(초) | 요약 |', '| --- | --- | --- | --- |');
  for (const s of steps) md.push(`| ${s.name} | ${s.status} | ${s.sec} | ${String(s.summary).replace(/\|/g, '/')} |`);
  md.push('');
  const withDetails = steps.filter((s) => s.details.length);
  if (withDetails.length) {
    md.push('## 상세', '');
    for (const s of withDetails) {
      md.push(`### ${s.name} (${s.status})`, '');
      for (const d of s.details) md.push(`- ${d}`);
      if (s.log) md.push('', `로그: \`${s.log}\``);
      md.push('');
    }
  }
  const docs = steps.find((s) => s.id === 'docs');
  if (docs?.progress?.length) {
    md.push('## 문서상 개발 진행 (06_progress.md)', '', '| 순서 | 묶음 | 상태 |', '| --- | --- | --- |');
    for (const p of docs.progress) md.push(`| ${p.order} | ${p.name} | ${p.done ? '완료 표시' : '미완료'} |`);
    md.push('');
  }
  if (docs?.assumptions?.length) {
    md.push('## 코드의 임시 가정 (ASSUMPTION)', '', '결정 로그 ID가 없는 항목은 04_decisions.md에 기록해야 한다.', '');
    for (const a of docs.assumptions) md.push(`- \`${a.where}\` ${a.ids.length ? `(${a.ids.join(', ')})` : '**(결정 ID 없음)**'} ${a.text}`);
    md.push('');
  }
  md.push('## 판정 기준', '', '기준값은 `scripts/verify.mjs`의 BUDGET에 있다. 기준을 바꾸면 근거를 결정 로그에 남긴다.', '');
  const text = md.join('\n');
  // dev 단계는 차수 종료 리포트(latest.md)를 덮어쓰지 않는다.
  const file = STAGE_ID === 'dev' ? join(REPORT_DIR, 'latest-dev.md') : join(REPORT_DIR, `${stamp}_${LABEL}_${STAGE_ID}.md`);
  writeFileSync(file, text);
  if (STAGE_ID !== 'dev') copyFileSync(file, join(REPORT_DIR, 'latest.md'));
  console.log(`\n종합 판정: ${word}`);
  console.log(`리포트: ${file}`);
  process.exit(overall === 'FAIL' ? 1 : 0);
}
