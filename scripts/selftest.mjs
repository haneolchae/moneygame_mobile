// 실제 Electron 앱을 자체 점검 모드로 실행한다(창 숨김). 워커·SQLite·IPC·화면 응답성·저장/불러오기를 확인하고 결과를 출력한다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const dataDir = mkdtempSync(join(tmpdir(), 'fo-selftest-'));
const reportPath = join(dataDir, 'report.json');
const r = spawnSync(electronPath, ['.', '--selftest'], {
  stdio: 'inherit',
  // VS Code 확장 등에서 상속된 ELECTRON_RUN_AS_NODE가 있으면 Electron이 Node로만 실행되므로 지운다.
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), FO_DATA_DIR: dataDir, FO_SELFTEST_REPORT: reportPath },
  timeout: 300_000,
});
let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  console.error('자체 점검 결과 파일이 없습니다. 종료 코드:', r.status, r.error?.message ?? '');
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
// verify.mjs가 결과를 읽을 수 있게 사본을 남긴다
if (process.env.FO_VERIFY_SELFTEST_OUT) writeFileSync(process.env.FO_VERIFY_SELFTEST_OUT, JSON.stringify(report, null, 2));
rmSync(dataDir, { recursive: true, force: true });
process.exit(report.error ? 1 : 0);
