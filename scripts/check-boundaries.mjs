// 계층 경계 검사. 각 계층이 허용된 대상만 import하는지 확인한다.
// engine: 순수 규칙. React·Electron·Steam·SQLite·Node 내장 모듈에 의존하지 않는다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'src';
const rules = {
  engine: { layers: ['engine'], packages: [] },
  game: { layers: ['engine', 'game', 'shared'], packages: [] },
  persistence: { layers: ['engine', 'game', 'persistence'], packages: ['node:sqlite', 'node:fs', 'node:path', 'node:os'] },
  shared: { layers: ['shared'], packages: [] },
  platform: { layers: ['platform'], packages: ['node:fs', 'node:path', 'steamworks-ffi-node'] },
  host: { layers: ['engine', 'game', 'persistence', 'shared', 'platform', 'host'], packages: ['node:worker_threads', 'node:path', 'node:fs', 'node:perf_hooks'] },
  electron: { layers: ['shared', 'platform', 'electron'], packages: ['electron', 'node:path', 'node:worker_threads', 'node:perf_hooks', 'node:fs'] },
  ui: { layers: ['shared', 'ui'], packages: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'] },
  cli: { layers: ['engine', 'game', 'persistence', 'shared', 'host', 'cli'], packages: ['node:fs', 'node:path', 'node:os', 'node:perf_hooks'] },
};

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
};
walk(ROOT);

const errors = [];
for (const file of files) {
  const layer = relative(ROOT, file).split(sep)[0];
  const rule = rules[layer];
  if (!rule) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.')) {
      const target = relative(ROOT, join(file, '..', spec)).split(sep)[0];
      if (!rule.layers.includes(target)) errors.push(`${file}: '${layer}' 계층이 '${target}'을 import함 (${spec})`);
    } else if (!rule.packages.includes(spec)) {
      errors.push(`${file}: '${layer}' 계층이 허용되지 않은 패키지 '${spec}'를 import함`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`계층 경계 검사 통과 (${files.length}개 파일)`);
