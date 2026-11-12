import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../src/host/dispatcher';
import type { RequestMap, RequestName } from '../src/shared/protocol';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fo-test-'));
}

export function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

let clock = 0;
export function makeDispatcher(dir: string): Dispatcher {
  return new Dispatcher({
    baseDir: dir,
    platform: () => ({ steam: { mode: 'mock', initialized: false, detail: 'test' }, appVersion: 'test' }),
    now: () => new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString(),
  });
}

export async function call<K extends RequestName>(d: Dispatcher, name: K, payload?: RequestMap[K]['payload']): Promise<RequestMap[K]['result']> {
  // EV-3(D-207 (2)): 시험은 화면 없는 자동 실행이라 대기 결정 카드를 위임 기본 선택지로 처리한다
  let p = name === 'game.advance' && payload && (payload as { autoCards?: boolean }).autoCards === undefined ? { ...(payload as object), autoCards: true } : payload;
  // ①(D-214): 새 게임 기본은 2/1 캠프 시작(첫 스토브리그 자동 실행). 기존 시험은 스토브리그 기능을 보려고 2026-11-08 스토브리그에서 시작한다.
  if (name === 'game.new' && payload && (payload as { start?: string }).start === undefined) p = { ...(payload as object), start: 'stove' } as typeof p;
  const r = await d.respond(name, p as RequestMap[K]['payload']);
  if (!r.ok) throw new Error(`${name}: [${r.error.code}] ${r.error.message}`);
  return r.result;
}

/** 경기 결과 전체를 문자열로 요약한다. 두 실행이 같은 결과를 냈는지 비교할 때 쓴다. */
export function fingerprint(d: Dispatcher): string {
  const repo = d.saves.repository();
  const meta = repo.getMeta();
  const games = [...repo.getGames(meta.season - 1), ...repo.getGames(meta.season), ...repo.getGames(meta.season + 1)];
  const parts = games.map((g) => {
    const ev = repo.getGameEvents(g.fixtureId);
    const pitches = ev.pas.reduce((a, p) => a + p.pitches, 0);
    return `${g.fixtureId}:${g.homeRuns}-${g.awayRuns}:${g.innings}:${g.winningPitcher}:${g.savePitcher}:${ev.pas.length}:${pitches}`;
  });
  const cash = repo.getClubs().map((c) => repo.cashBalance(c.id)).join(',');
  return `${meta.currentDate}|${meta.mode}|${meta.season}|${JSON.stringify(meta.rngStreams)}|${JSON.stringify(meta.inflationBp)}|${cash}|${parts.join(',')}`;
}
