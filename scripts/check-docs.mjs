// 문서 정합성 검사. 코드가 기획 문서 패키지의 규칙과 기록에 맞는지 확인한다.
// 사용: node scripts/check-docs.mjs [--docs <문서 폴더>] [--tests <실제 테스트 수>] [--json <결과 파일>]
// 문서 폴더 기본값: ../baseball_management_docs_v0.1 (FO_DOCS_DIR로 바꿀 수 있다)
//
// 실패(errors): 결정 로그에 없는 결정 ID, 엔진·게임 계층의 비결정 난수/시간, 화면 데이터의 히든 값,
//               문서의 깨진 링크, 문서에 적힌 npm 명령이 package.json에 없음(reference 폴더 제외 전 문서),
//               06_progress.md 진행 표에서 완료(✅) 표시 차수의 결과 기록 누락, 실제 테스트 수 < 기록
// 경고(warnings): 결정 ID 없는 임시 가정, 미구현 흔적(TODO 등), 문서 지도 누락, 테스트 수와 문서 기록 불일치,
//               폐기된 결정 ID 참조
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const DOCS = resolve(ROOT, arg('docs', process.env.FO_DOCS_DIR ?? '../baseball_management_docs_v0.1'));
const ACTUAL_TESTS = arg('tests', null) === null ? null : Number(arg('tests', '0'));

const errors = [];
const warnings = [];
const assumptions = [];
let progress = [];

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const walk = (dir, re, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, re, acc);
    else if (re.test(name)) acc.push(p);
  }
  return acc;
};
const read = (p) => readFileSync(p, 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

if (!existsSync(DOCS)) {
  errors.push(`문서 폴더가 없습니다: ${DOCS} (--docs 또는 FO_DOCS_DIR로 지정)`);
  done();
}
const docPath = (name) => {
  // claude.md / CLAUDE.md 어느 쪽이든 찾는다
  const hit = readdirSync(DOCS).find((f) => f.toLowerCase() === name.toLowerCase());
  return hit ? join(DOCS, hit) : null;
};

const codeFiles = [...walk(join(ROOT, 'src'), /\.(ts|tsx)$/), ...walk(join(ROOT, 'tests'), /\.ts$/), ...walk(join(ROOT, 'scripts'), /\.(mjs|ts)$/)].filter(
  (f) => !f.endsWith(`${sep}check-docs.mjs`) && !f.endsWith(`${sep}verify.mjs`),
);
const srcFiles = codeFiles.filter((f) => rel(f).startsWith('src/'));

// ── 1. 결정 ID: 코드가 참조하는 D-### 가 결정 로그에 있는가 ──────────────────────
// D-226: 04_decisions.md는 현재 유효 결정(글머리표), 결정 표 원문은 04_decisions_log.md. 두 문서의 표 행을 모두 읽는다.
const decisionsPath = docPath('04_decisions.md');
const decisionsLogPath = docPath('04_decisions_log.md');
const decisions = new Map(); // id -> 상태 문자열
if (!decisionsPath) errors.push('04_decisions.md가 없습니다.');
else {
  const decisionText = [decisionsPath, decisionsLogPath].filter(Boolean).map(read).join('\n');
  for (const line of decisionText.split('\n')) {
    const m = line.match(/^\|\s*(D-\d{3})\s*\|/);
    if (m) {
      const cells = line.split('|').map((c) => c.trim());
      decisions.set(m[1], cells[cells.length - 3] ?? '');
    }
  }
  const refs = new Map(); // id -> [where]
  for (const f of codeFiles) {
    const t = read(f);
    for (const m of t.matchAll(/D-\d{3}/g)) {
      const list = refs.get(m[0]) ?? [];
      list.push(`${rel(f)}:${lineOf(t, m.index)}`);
      refs.set(m[0], list);
    }
  }
  for (const [id, where] of [...refs].sort()) {
    if (!decisions.has(id)) errors.push(`결정 로그에 없는 ${id}를 코드가 참조함 (${where.slice(0, 3).join(', ')}${where.length > 3 ? ` 외 ${where.length - 3}곳` : ''})`);
    else if (/^폐기/.test(decisions.get(id))) warnings.push(`폐기된 ${id}를 코드가 참조함 (${where[0]}). 대체 결정 ID로 바꾸세요.`);
  }
}

// ── 2. 임시 가정(ASSUMPTION) 목록 ───────────────────────────────────────────────
for (const f of srcFiles) {
  const lines = read(f).split('\n');
  lines.forEach((l, i) => {
    if (!/ASSUMPTION/.test(l) || /^\s*\/\/\s*-\s*ASSUMPTION:/.test(l)) return; // config 머리말의 설명 줄 제외
    const ids = [...new Set(l.match(/D-\d{3}/g) ?? [])];
    const text = l.replace(/^\s*(\/\*\*|\/\/|\*)\s*/, '').replace(/\*\/\s*$/, '').trim().slice(0, 140);
    assumptions.push({ where: `${rel(f)}:${i + 1}`, ids, text });
  });
}
const noId = assumptions.filter((a) => a.ids.length === 0);
if (noId.length) warnings.push(`결정 로그 ID가 없는 임시 가정 ${noId.length}건 (리포트의 '코드의 임시 가정' 참고)`);

// ── 3. 재현성: 엔진·게임 계층에서 저장되지 않는 난수·현재 시각 사용 금지 ─────────────
for (const f of srcFiles.filter((f) => /^src\/(engine|game)\//.test(rel(f)))) {
  const t = read(f);
  const pats = [
    [/Math\.random\s*\(/g, 'Math.random'],
    [/Date\.now\s*\(/g, 'Date.now'],
    [/new Date\s*\(\s*\)/g, 'new Date()'],
    [/performance\.now\s*\(/g, 'performance.now'],
    [/crypto\.(randomUUID|getRandomValues|randomBytes)/g, 'crypto 난수'],
  ];
  for (const [re, name] of pats) for (const m of t.matchAll(re)) errors.push(`${rel(f)}:${lineOf(t, m.index)} ${name} 사용. 저장되는 난수 상태·게임 날짜를 써야 함 (claude.md 공통 구현 계약)`);
}

// ── 4. 히든 값 노출: 통신 형식·화면에 실제 능력/히든 값이 들어가지 않는가 ───────────────
{
  const typesPath = join(ROOT, 'src/engine/types.ts');
  // EV-4(D-210 (1)): 히든 생활 요인 이름도 통신 형식·화면에 들어가면 안 된다
  const hiddenKeys = new Set(['hidden', 'selfControl', 'publicAwareness', 'warmth', 'humility', 'pastRecord']);
  if (existsSync(typesPath)) {
    const m = read(typesPath).match(/interface\s+HiddenAttributes\s*\{([\s\S]*?)\n\}/);
    if (m) for (const k of m[1].matchAll(/^\s*(\w+)\s*\??:/gm)) hiddenKeys.add(k[1]);
  }
  const keyAlt = [...hiddenKeys].join('|');
  for (const f of srcFiles.filter((f) => /^src\/(shared|ui)\//.test(rel(f)))) {
    const t = read(f);
    for (const m of t.matchAll(/\b(PlayerTruth|HiddenAttributes)\b/g)) errors.push(`${rel(f)}:${lineOf(t, m.index)} 화면·통신 계층이 ${m[1]} 타입을 참조함 (04 문서 데이터 경계)`);
    const re = new RegExp(`(?<![-\\w])(${keyAlt})\\s*\\??\\s*:(?!\\s*['"])|\\.(${keyAlt})\\b`, 'g');
    for (const m of t.matchAll(re)) {
      const ctx = t.slice(Math.max(0, m.index - 12), m.index);
      if (/aria-$|overflow:\s*$/.test(ctx)) continue;
      errors.push(`${rel(f)}:${lineOf(t, m.index)} 히든 항목 '${m[1] ?? m[2]}'이 화면·통신 계층에 있음 (04 문서: UI에 원시 잠재력을 넣고 숨기는 방식 금지)`);
    }
  }
}

// ── 5. 미구현·임시 흔적 ─────────────────────────────────────────────────────────
for (const f of srcFiles) {
  const t = read(f);
  for (const m of t.matchAll(/\b(TODO|FIXME|XXX|HACK)\b|임시 성공|미구현 응답|not implemented/gi))
    warnings.push(`${rel(f)}:${lineOf(t, m.index)} '${m[0]}' 흔적. 완료 보고 전에 정리하거나 결정 로그·남은 제약에 기록`);
}

// ── 6. 문서 내부 링크 ───────────────────────────────────────────────────────────
const mdFiles = walk(DOCS, /\.md$/i);
for (const f of mdFiles) {
  const t = read(f);
  for (const m of t.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    if (/^https?:/.test(m[1])) continue;
    let target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) {
      // 대소문자만 다른 파일(claude.md ↔ CLAUDE.md)은 Windows에서 열리므로 경고로만 둔다
      const alt = existsSync(dirname(target)) && readdirSync(dirname(target)).find((x) => x.toLowerCase() === target.split(sep).pop().toLowerCase());
      if (alt) continue;
      errors.push(`문서 링크 깨짐: ${relative(DOCS, f)}:${lineOf(t, m.index)} → ${m[1]}`);
    }
  }
}

// ── 7. 문서 지도: 02_features의 모든 문서가 claude.md에 있는가 ─────────────────────
const claudePath = docPath('claude.md');
if (!claudePath) errors.push('claude.md가 없습니다.');
else {
  const t = read(claudePath);
  for (const f of walk(join(DOCS, '02_features'), /\.md$/)) {
    const name = f.split(sep).pop();
    if (!t.includes(name)) warnings.push(`claude.md 문서 지도에 ${name}가 없음`);
  }
  for (const f of readdirSync(DOCS).filter((x) => /^\d\d_.*\.md$/.test(x))) if (!t.includes(f)) warnings.push(`claude.md에 최상위 문서 ${f} 언급이 없음`);
}

// ── 8. 문서에 적힌 npm 명령: reference(외부 원본 보관) 폴더를 뺀 모든 문서 ─────────────────
{
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  for (const f of mdFiles.filter((f) => !relative(DOCS, f).split(sep).includes('reference'))) {
    const t = read(f);
    for (const m of t.matchAll(/npm run ([\w:-]+)/g)) if (!pkg.scripts?.[m[1]]) errors.push(`${relative(DOCS, f)}:${lineOf(t, m.index)}의 'npm run ${m[1]}'가 package.json에 없음`);
  }
}

// ── 9. 06_progress: 진행 상황·결과 기록·테스트 수 ──────────────────────────────────
// 진행 기록은 03_development.md에서 06_progress.md로 옮겼다. 03에는 설계 지침만 남는다.
const progPath = docPath('06_progress.md');
if (!progPath) errors.push('06_progress.md가 없습니다.');
else {
  const t = read(progPath);
  // 진행 상황 표: | 2a ✅ | 묶음 | ... 형식
  for (const line of t.split('\n')) {
    const m = line.match(/^\|\s*(\d+[a-z]?)\s*(✅)?\s*\|\s*([^|]+?)\s*\|/);
    if (m && /[a-z]/.test(m[1])) progress.push({ order: m[1], name: m[3], done: Boolean(m[2]) });
  }
  if (!progress.length) errors.push('06_progress.md에서 진행 상황 표를 찾지 못함');
  // 오래된 결과 섹션은 06_progress_archive.md로 옮긴다(최근 3개만 06에 둔다, D-226). 결과 섹션은 두 문서 중 어디에 있어도 된다.
  const archivePath = docPath('06_progress_archive.md');
  const results = t + (archivePath ? `\n${read(archivePath)}` : '');
  for (const p of progress.filter((p) => p.done)) {
    const re = new RegExp(`^##\\s*${p.order}\\b.*결과`, 'm');
    if (!re.test(results)) errors.push(`${p.order}(${p.name})가 완료 표시인데 06_progress.md·06_progress_archive.md에 '## ${p.order} … 결과' 섹션이 없음`);
  }

  // 테스트 수: 문서에 마지막으로 기록된 'N개 통과'와 실제 비교. verify는 Vitest 실행 결과를 --tests로 넘긴다.
  const claims = [...t.matchAll(/자동 테스트\s*(\d+)개\s*통과/g)].map((m) => Number(m[1]));
  const actual = ACTUAL_TESTS ?? codeFiles.filter((f) => /\.test\.ts$/.test(f)).reduce((a, f) => a + countTests(read(f)), 0);
  if (claims.length) {
    const last = claims.at(-1);
    if (actual > last) warnings.push(`실제 테스트 ${actual}개 > 문서 기록 ${last}개. 이번 차수 결과가 06_progress.md에 아직 없을 수 있음`);
    if (actual < last) errors.push(`실제 테스트 ${actual}개 < 문서 기록 ${last}개. 테스트가 사라졌거나 문서가 과장됨`);
  }
}

/** 단독 실행 때의 테스트 수 추정: it()/test() 한 건, it.each([...])는 표의 행 수만큼 센다. */
function countTests(text) {
  let n = (text.match(/^\s*(it|test)\(/gm) ?? []).length;
  for (const m of text.matchAll(/^\s*(it|test)\.each\(\[/gm)) {
    let depth = 1;
    let rows = 0;
    let item = false;
    for (let i = m.index + m[0].length; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '[' || c === '(' || c === '{') {
        if (depth === 1 && !item) (item = true), rows++;
        depth++;
      } else if (c === ']' || c === ')' || c === '}') depth--;
      else if (depth === 1 && c === ',') item = false;
      else if (depth === 1 && !item && !/\s/.test(c)) (item = true), rows++;
    }
    n += rows;
  }
  return n;
}

done();

function done() {
  const result = { docs: DOCS, errors, warnings, assumptions, progress };
  const out = arg('json', null);
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
  for (const e of errors) console.error(`[실패] ${e}`);
  for (const w of warnings) console.log(`[경고] ${w}`);
  console.log(`문서 정합성: 실패 ${errors.length}건, 경고 ${warnings.length}건, 임시 가정 ${assumptions.length}건`);
  process.exit(errors.length ? 1 : 0);
}
