// 게임 워커 (Node worker_threads). DB 연결과 시뮬레이션을 화면·메인 프로세스와 다른 스레드에서 돌린다.
import { parentPort, workerData } from 'node:worker_threads';
import type { PlatformStatus, RequestName } from '../shared/protocol';
import { Dispatcher } from './dispatcher';

interface WorkerInit {
  baseDir: string;
  platform: PlatformStatus;
}

interface WorkerRequest {
  id: number;
  name: RequestName | '__close';
  payload: unknown;
}

const init = workerData as WorkerInit;
let platform = init.platform;
const dispatcher = new Dispatcher({
  baseDir: init.baseDir,
  platform: () => platform,
  onEvent: (event) => parentPort?.postMessage({ kind: 'event', event }),
});

parentPort?.on('message', async (msg: WorkerRequest | { kind: 'platform'; platform: PlatformStatus }) => {
  if ('kind' in msg) {
    platform = msg.platform;
    return;
  }
  if (msg.name === '__close') {
    dispatcher.close();
    parentPort?.postMessage({ kind: 'response', id: msg.id, response: { ok: true, result: null } });
    return;
  }
  const response = await dispatcher.respond(msg.name, msg.payload as never);
  parentPort?.postMessage({ kind: 'response', id: msg.id, response });
});
