// Electron 실행 파일을 Node 모드로 실행한다. 실제 앱과 같은 런타임(Node·SQLite 버전)에서 CLI를 검증할 때 쓴다.
import { spawnSync } from 'node:child_process';
import electronPath from 'electron';

const result = spawnSync(electronPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
