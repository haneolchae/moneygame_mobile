// 화면 쪽 통신 클라이언트. 프리로드가 노출한 window.frontOffice만 사용한다.
import type { ApiResponse, ProgressEvent, RequestMap, RequestName } from '../shared/protocol';

interface Bridge {
  invoke(name: RequestName, payload?: unknown): Promise<ApiResponse<unknown>>;
  onEvent(cb: (e: ProgressEvent) => void): () => void;
}

declare global {
  interface Window {
    frontOffice?: Bridge;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function bridge(): Bridge {
  if (!window.frontOffice) throw new ApiError('NO_BRIDGE', '게임 엔진에 연결할 수 없습니다. 데스크톱 앱으로 실행하세요.');
  return window.frontOffice;
}

export async function api<K extends RequestName>(name: K, ...args: RequestMap[K]['payload'] extends void ? [] : [RequestMap[K]['payload']]): Promise<RequestMap[K]['result']> {
  const res = (await bridge().invoke(name, args[0])) as ApiResponse<RequestMap[K]['result']>;
  if (!res.ok) throw new ApiError(res.error.code, res.error.message);
  return res.result;
}

export function onProgress(cb: (e: ProgressEvent) => void): () => void {
  return window.frontOffice ? window.frontOffice.onEvent(cb) : () => {};
}
