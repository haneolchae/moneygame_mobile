// Electron 메인·프리로드, 게임 워커, 헤드리스 CLI를 번들한다. 화면은 vite가 따로 빌드한다.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
  // node:sqlite 같은 내장 모듈은 esbuild가 자동으로 외부 처리한다.
  external: ['electron', 'steamworks-ffi-node'],
};

await Promise.all([
  build({ ...common, entryPoints: ['src/electron/main.ts'], outfile: 'dist/electron/main.js' }),
  build({ ...common, entryPoints: ['src/electron/preload.ts'], outfile: 'dist/electron/preload.js' }),
  build({ ...common, entryPoints: ['src/host/worker.ts'], outfile: 'dist/host/worker.js' }),
  build({ ...common, entryPoints: ['src/cli/simulate.ts'], outfile: 'dist/cli/simulate.js' }),
]);
console.log('build: main, preload, worker, cli 완료');
