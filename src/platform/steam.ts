// Steam 연결 (플랫폼 계층). 게임 규칙은 이 파일을 모른다.
// 실제 연결은 steamworks-ffi-node를 쓴다. Steamworks SDK 재배포 파일(steamworks_sdk/)과 App ID가 있어야 동작한다.
// 둘 중 하나라도 없거나 Steam 클라이언트가 꺼져 있으면 모의 구현으로 동작하고, 상태에 이유를 남긴다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SteamStatus {
  mode: 'real' | 'mock';
  initialized: boolean;
  detail: string;
}

export interface SteamAdapter {
  status(): SteamStatus;
  unlockAchievement(id: string): boolean;
  /** 클라우드 동기화 대상 폴더 안내. Steam Auto-Cloud는 앱 설정으로 지정하므로 여기서는 기록만 한다. */
  cloudSaveDirectory(): string | null;
  shutdown(): void;
}

export class MockSteamAdapter implements SteamAdapter {
  readonly unlocked: string[] = [];
  constructor(
    private readonly reason: string,
    private readonly savesDir: string | null = null,
  ) {}
  status(): SteamStatus {
    return { mode: 'mock', initialized: false, detail: this.reason };
  }
  unlockAchievement(id: string): boolean {
    if (!this.unlocked.includes(id)) this.unlocked.push(id);
    return true;
  }
  cloudSaveDirectory(): string | null {
    return this.savesDir;
  }
  shutdown(): void {}
}

interface SteamworksModule {
  default?: unknown;
  [key: string]: unknown;
}

function readAppId(appRoot: string): number | null {
  const env = process.env.STEAM_APP_ID;
  if (env && /^\d+$/.test(env)) return Number(env);
  const file = join(appRoot, 'steam_appid.txt');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8').trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return null;
}

/** 실제 Steam 연결을 시도하고, 안 되면 이유와 함께 모의 구현을 돌려준다. */
export async function createSteamAdapter(appRoot: string, savesDir: string): Promise<SteamAdapter> {
  const appId = readAppId(appRoot);
  if (appId === null) return new MockSteamAdapter('App ID가 없습니다 (steam_appid.txt 또는 STEAM_APP_ID). 모의 구현으로 동작합니다.', savesDir);
  if (!existsSync(join(appRoot, 'steamworks_sdk'))) {
    return new MockSteamAdapter('Steamworks SDK 재배포 파일(steamworks_sdk/)이 없습니다. Steamworks 파트너 계정에서 받아야 합니다.', savesDir);
  }
  try {
    const mod = (await import('steamworks-ffi-node')) as SteamworksModule;
    const SteamClass = (mod.default ?? mod.SteamworksSDK ?? mod.Steamworks) as { getInstance?: () => unknown } | undefined;
    const steam = (SteamClass?.getInstance?.() ?? SteamClass) as {
      init?: (opts: { appId: number }) => boolean;
      achievements?: { unlockAchievement?: (id: string) => Promise<boolean> | boolean };
      shutdown?: () => void;
    };
    if (!steam?.init) return new MockSteamAdapter('steamworks-ffi-node API를 찾지 못했습니다. 라이브러리 버전을 확인하세요.', savesDir);
    const ok = steam.init({ appId });
    if (!ok) return new MockSteamAdapter('Steam 초기화 실패: Steam 클라이언트 실행 여부와 App ID를 확인하세요.', savesDir);
    return {
      status: () => ({ mode: 'real', initialized: true, detail: `Steam 연결됨 (App ID ${appId})` }),
      unlockAchievement: (id) => {
        void steam.achievements?.unlockAchievement?.(id);
        return true;
      },
      cloudSaveDirectory: () => savesDir,
      shutdown: () => steam.shutdown?.(),
    };
  } catch (e) {
    return new MockSteamAdapter(`Steam 라이브러리 로드 실패: ${(e as Error).message}`, savesDir);
  }
}
