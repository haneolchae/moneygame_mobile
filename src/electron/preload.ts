// 프리로드: 화면에 노출하는 유일한 통로. 파일·DB 접근은 노출하지 않고, 허용된 요청 이름만 보낼 수 있다.
import { contextBridge, ipcRenderer } from 'electron';
import { REQUEST_NAMES, type ProgressEvent, type RequestName } from '../shared/protocol';

const api = {
  invoke(name: RequestName, payload?: unknown) {
    if (!REQUEST_NAMES.includes(name)) return Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: `허용되지 않은 요청: ${name}` } });
    return ipcRenderer.invoke('fo:invoke', name, payload);
  },
  onEvent(callback: (event: ProgressEvent) => void) {
    const handler = (_e: unknown, event: ProgressEvent) => callback(event);
    ipcRenderer.on('fo:event', handler);
    return () => {
      ipcRenderer.removeListener('fo:event', handler);
    };
  },
};

contextBridge.exposeInMainWorld('frontOffice', api);
