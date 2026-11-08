// Electron 메인 프로세스: 창, 게임 워커, Steam 연결, 화면 통신(IPC)을 관리한다.
// 게임 규칙과 DB는 워커 스레드에 있고, 메인은 요청을 전달만 한다.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { createSteamAdapter, MockSteamAdapter, type SteamAdapter } from '../platform/steam';
import { REQUEST_NAMES, type ApiResponse, type PlatformStatus, type ProgressEvent, type RequestName } from '../shared/protocol';

const SELFTEST = process.argv.includes('--selftest');
const dataDir = process.env.FO_DATA_DIR ?? join(app.getPath('userData'), 'game-data');

let win: BrowserWindow | null = null;
let steam: SteamAdapter = new MockSteamAdapter('초기화 전');

class GameWorker {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (r: ApiResponse<unknown>) => void>();

  constructor(private readonly onEvent: (e: ProgressEvent) => void) {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(join(__dirname, '../host/worker.js'), { workerData: { baseDir: dataDir, platform: platformStatus() } });
    w.on('message', (msg: { kind: 'response'; id: number; response: ApiResponse<unknown> } | { kind: 'event'; event: ProgressEvent }) => {
      if (msg.kind === 'event') this.onEvent(msg.event);
      else {
        this.pending.get(msg.id)?.(msg.response);
        this.pending.delete(msg.id);
      }
    });
    w.on('error', (err) => {
      for (const resolve of this.pending.values()) resolve({ ok: false, error: { code: 'WORKER_CRASHED', message: `게임 처리 중 오류: ${err.message}. 마지막으로 확정된 날짜까지는 보존됩니다.` } });
      this.pending.clear();
      this.worker = this.spawn(); // 워커를 다시 띄운다. 세션 DB는 마지막 확정 상태에서 이어진다.
    });
    return w;
  }

  request(name: string, payload: unknown): Promise<ApiResponse<unknown>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, name, payload });
    });
  }

  setPlatform(p: PlatformStatus) {
    this.worker.postMessage({ kind: 'platform', platform: p });
  }

  async close() {
    await this.request('__close', null);
    await this.worker.terminate();
  }
}

function platformStatus(): PlatformStatus {
  return { steam: steam.status(), appVersion: app.getVersion() };
}

let worker: GameWorker;

function createWindow(show: boolean): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show,
    title: '프런트 오피스',
    backgroundColor: '#11151c',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  w.removeMenu();
  // 외부 탐색·새 창 차단. 외부 링크는 기본 브라우저로 연다.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

ipcMain.handle('fo:invoke', async (event, name: RequestName, payload: unknown) => {
  if (!win || event.sender !== win.webContents) return { ok: false, error: { code: 'FORBIDDEN', message: '허용되지 않은 호출자' } };
  if (!REQUEST_NAMES.includes(name)) return { ok: false, error: { code: 'FORBIDDEN', message: `허용되지 않은 요청: ${String(name)}` } };
  return worker.request(name, payload);
});

async function runSelfTest() {
  // 실제 Electron 런타임에서 워커·SQLite·IPC·화면 응답성을 확인한다. 결과는 JSON으로 남긴다.
  const report: Record<string, unknown> = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, dataDir };
  const call = async (name: string, payload?: unknown) => {
    const r = await worker.request(name, payload);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.result as Record<string, unknown>;
  };
  await new Promise<void>((resolve) => win!.webContents.once('did-finish-load', () => resolve()));
  // 화면 스레드 응답성 측정: 16ms 간격 타이머의 최대 지연을 기록한다.
  await win!.webContents.executeJavaScript(`window.__lag = { max: 0, last: performance.now() }; setInterval(() => { const n = performance.now(); window.__lag.max = Math.max(window.__lag.max, n - window.__lag.last - 16); window.__lag.last = n; }, 16); true`);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const t0 = Date.now();
  await call('game.new', { clubId: 5, saveName: '자체 점검', seed: 'selftest-seed' });
  report.newGameMs = Date.now() - t0;
  // 스토브리그를 1주씩 지나 시즌 모드로 간 뒤 정규시즌을 끝까지 진행한다.
  const tStove = Date.now();
  let stoveWeeks = 0;
  while ((await call('game.dashboard')).phase === 'stove') {
    await call('game.advance', { mode: 'week' });
    stoveWeeks++;
  }
  report.stoveWeeks = stoveWeeks;
  report.stoveMs = Date.now() - tStove;
  const t1 = Date.now();
  const adv = await call('game.advance', { mode: 'untilSeasonEnd' });
  report.seasonAdvanceMs = Date.now() - t1;
  report.advance = adv;
  const tPs = Date.now();
  const ps = await call('game.advance', { mode: 'untilSeasonEnd' });
  report.postseasonMs = Date.now() - tPs;
  report.postseason = ps.stoppedReason;
  loop.disable();
  report.mainProcessEventLoopMaxDelayMs = Math.round(loop.max / 1e6);
  report.rendererMaxTimerLagMs = Math.round(await win!.webContents.executeJavaScript('window.__lag.max'));
  const dash = await call('game.dashboard');
  report.dateAfterSeason = dash.date;
  report.gamesPlayed = `${dash.gamesPlayedLeague}/${dash.gamesTotalLeague}`;
  const t2 = Date.now();
  await call('save.save', { slot: 'selftest' });
  report.saveMs = Date.now() - t2;
  // 워커를 완전히 내렸다가 다시 띄운 뒤 불러와서 같은 상태인지 확인한다(앱 재시작과 같은 효과).
  await worker.close();
  worker = new GameWorker(() => {});
  const t3 = Date.now();
  const loaded = await call('save.load', { slot: 'selftest' });
  report.loadMs = Date.now() - t3;
  report.reloadMatches = loaded.date === dash.date && loaded.gamesPlayedLeague === dash.gamesPlayedLeague;
  const t4 = Date.now();
  const players = (await call('game.players', { scope: 'all', group: 'hitters', sortKey: 'OPS', sortDesc: true })) as unknown as unknown[];
  report.playerListMs = Date.now() - t4;
  report.playerListCount = players.length;
  report.steam = steam.status();
  writeFileSync(process.env.FO_SELFTEST_REPORT ?? join(dataDir, 'selftest-report.json'), JSON.stringify(report, null, 2));
}

/** 개발용: 주요 화면을 자동으로 눌러 보며 캡처한다 (--screenshots <폴더>). */
async function runScreenshots(outDir: string) {
  const w = win!;
  await new Promise<void>((resolve) => w.webContents.once('did-finish-load', () => resolve()));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const click = (text: string) =>
    w.webContents.executeJavaScript(
      `(() => { const el = [...document.querySelectorAll('button, tr')].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`,
    );
  w.webContents.on('console-message', (e) => writeFileSync(join(outDir, 'console.log'), `${e.level} ${e.message}
`, { flag: 'a' }));
  const shot = async (name: string) => {
    await wait(600);
    // 숨김 창은 그리기가 늦어질 수 있어 캡처 전에 다시 그리게 한다.
    w.webContents.invalidate();
    await wait(150);
    const img = await w.webContents.capturePage();
    writeFileSync(join(outDir, `${name}.png`), img.toPNG());
  };
  const nextWeek = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await click('다음 주 진행');
      await wait(700);
      await click('나중에'); // 주 시작 결재 팝업
    }
  };
  await shot('01-start');
  await click('새 게임');
  await shot('02-new-game');
  await click('대구 레오즈');
  await click('이 구단으로 시작');
  await wait(900);
  await shot('03-dashboard-stove');
  await click('받은 편지함');
  await click('선수단 현황 보고');
  await shot('04-inbox');
  await click('다음 주 진행');
  await wait(700);
  await click('나중에');
  await click('다음 주 진행');
  await wait(900);
  await shot('05a-approval-popup');
  await click('나중에');
  await click('구단 현황');
  await shot('05-dashboard-week3');
  await click('선수단');
  await wait(1500);
  for (let i = 0; i < 15; i++) {
    const ok = await w.webContents.executeJavaScript("(() => { const tr = [...document.querySelectorAll('tbody tr.clickable')].find((e) => e.textContent.includes('간판')); if (tr) tr.click(); return !!tr; })()");
    if (ok) break;
    await wait(300);
  }
  await wait(800);
  await shot('05b-player-detail');
  await click('팀 기록');
  await shot('05c-team-stats');
  await click('명예의 전당');
  await wait(600);
  await shot('05d-hof-timeline');
  await click('레전드');
  await shot('05e-hof-legends');
  await click('계약·이적');
  await wait(400);
  await shot('06-fa-market');
  await w.webContents.executeJavaScript("(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '제안'); if (b) b.click(); return !!b; })()");
  await shot('07-offer-form');
  await nextWeek(2);
  await click('계약·이적');
  await wait(400);
  await click('연봉 협상');
  await shot('08-salary-talks');
  await click('외국인');
  await shot('08b-foreign');
  await click('재정');
  await shot('08c-finance');
  await click('조직·위임');
  await wait(400);
  await shot('08d-org');
  await click('운영팀');
  await shot('08e-org-team');
  await click('채용 시장');
  await shot('08f-org-hire');
  await click('위임·결재');
  await shot('08g-org-delegation');
  await nextWeek(8);
  await click('구단 현황');
  await shot('09-dashboard-preseason');
  await nextWeek(9);
  await click('구단 현황');
  await shot('10-dashboard-regular');
  await click('리그 순위');
  await shot('11-standings');
  await click('신인 드래프트');
  await wait(800);
  await shot('11a-draft-board');
  await click('팀 기록');
  await shot('11b-team-season');
  await click('업적');
  await shot('11c-achievements');
  await click('재정');
  await shot('12-finance-season');
  await click('정규시즌 끝까지');
  await wait(6000);
  await click('나중에');
  await click('리그 순위');
  await shot('13-postseason-bracket');
  await click('포스트시즌 끝까지');
  await wait(4000);
  await click('나중에');
  await click('구단 현황');
  await shot('14-second-stove');
  await click('신인 드래프트');
  await wait(800);
  await shot('14b-draft-results');
  await click('계약·이적');
  await wait(500);
  await click('선수단 정리');
  await shot('14c-retirement');
  await click('명예의 전당');
  await wait(600);
  await click('구단주 달성');
  await shot('15-hof-mine');
  await click('구단 역사');
  await shot('16-hof-history');
}

app.whenReady().then(async () => {
  steam = await createSteamAdapter(app.getAppPath(), join(dataDir, 'saves'));
  worker = new GameWorker((event) => win?.webContents.send('fo:event', event));
  worker.setPlatform(platformStatus());
  const shotsIndex = process.argv.indexOf('--screenshots');
  win = createWindow(!SELFTEST && shotsIndex < 0);
  if (shotsIndex >= 0) {
    await runScreenshots(process.argv[shotsIndex + 1] ?? dataDir);
    await worker.close();
    app.exit(0);
    return;
  }
  if (SELFTEST) {
    try {
      await runSelfTest();
    } catch (e) {
      writeFileSync(process.env.FO_SELFTEST_REPORT ?? join(dataDir, 'selftest-report.json'), JSON.stringify({ error: (e as Error).message }, null, 2));
    }
    await worker.close();
    app.exit(0);
  }
});

app.on('window-all-closed', async () => {
  await worker?.close();
  steam.shutdown();
  app.quit();
});
