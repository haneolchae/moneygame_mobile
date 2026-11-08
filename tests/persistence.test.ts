import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInvariants } from '../src/host/invariants';
import { inspectSaveFile, SaveManager } from '../src/persistence/saves';
import { migrate, readSchemaVersion, type Migration } from '../src/persistence/schema';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const newDir = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

describe('재현성과 저장', () => {
  it('같은 시드와 같은 진행은 같은 결과', async () => {
    const a = makeDispatcher(newDir());
    const b = makeDispatcher(newDir());
    for (const d of [a, b]) {
      await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'repro' });
      await call(d, 'game.advance', { mode: 'week' });
      await call(d, 'game.advance', { mode: 'week' });
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
    a.close();
    b.close();
  });

  it('저장 후 불러와 이어서 진행해도 중단 없이 진행한 결과와 같다 (난수 상태 포함)', async () => {
    const straight = makeDispatcher(newDir());
    await call(straight, 'game.new', { clubId: 4, saveName: 't', seed: 'resume' });
    for (let i = 0; i < 4; i++) await call(straight, 'game.advance', { mode: 'week' });

    const dir = newDir();
    const first = makeDispatcher(dir);
    await call(first, 'game.new', { clubId: 4, saveName: 't', seed: 'resume' });
    await call(first, 'game.advance', { mode: 'week' });
    await call(first, 'game.advance', { mode: 'week' });
    await call(first, 'save.save', { slot: 'slot1' });
    await call(first, 'game.advance', { mode: 'week' }); // 저장 뒤 진행은 버려진다
    first.close();

    const second = makeDispatcher(dir); // 앱 재시작
    await call(second, 'save.load', { slot: 'slot1' });
    await call(second, 'game.advance', { mode: 'week' });
    await call(second, 'game.advance', { mode: 'week' });
    expect(fingerprint(second)).toBe(fingerprint(straight));
    straight.close();
    second.close();
  });

  it('저장 없이 강제 종료돼도 마지막 확정 날짜까지 세션이 남는다', async () => {
    const dir = newDir();
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 1, saveName: '세션', seed: 'crash' });
    await call(d, 'game.advance', { mode: 'week' });
    const before = await call(d, 'game.dashboard');
    // close()를 부르지 않고 연결을 버린다 (강제 종료 흉내). WAL에 확정된 트랜잭션은 남는다.
    const d2 = makeDispatcher(dir);
    const status = await call(d2, 'app.status');
    expect(status.recoverableSession?.date).toBe(before.date);
    const resumed = await call(d2, 'save.resumeSession');
    expect(resumed.date).toBe(before.date);
    expect(resumed.gamesPlayedLeague).toBe(before.gamesPlayedLeague);
    d.close();
    d2.close();
  });

  it('같은 날짜는 두 번 처리되지 않는다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 2, saveName: 't', seed: 'once' });
    await call(d, 'game.advance', { mode: 'week' });
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    const cash = repo.cashBalance(meta.userClubId);
    expect(() => repo.commitDay('2026-11-08', { results: [], ledger: [{ clubId: meta.userClubId, date: '2026-11-08', category: 'generalAdmin', amount: -1, memo: 'dup' }], inbox: [], apGrant: null, metaUpdate: {} })).toThrow();
    expect(repo.cashBalance(meta.userClubId)).toBe(cash);
    expect(repo.getMeta().currentDate).toBe(meta.currentDate);
    d.close();
  });

  it('백업 회전과 손상 저장본 복구', async () => {
    const dir = newDir();
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 6, saveName: '백업', seed: 'bak' });
    await call(d, 'save.save', { slot: 'main' });
    await call(d, 'game.advance', { mode: 'week' });
    await call(d, 'save.save', { slot: 'main' });
    await call(d, 'game.advance', { mode: 'week' });
    await call(d, 'save.save', { slot: 'main' });
    const slots = await call(d, 'save.list');
    const main = slots.find((s) => s.slot === 'main')!;
    expect(main.status).toBe('ok');
    expect(main.backups.map((b) => b.index)).toEqual([1, 2]);
    d.close();

    // 저장본을 손상시킨다
    writeFileSync(join(dir, 'saves', 'main.db'), 'not a database');
    const d2 = makeDispatcher(dir);
    const after = await call(d2, 'save.list');
    expect(after.find((s) => s.slot === 'main')!.status).toBe('corrupt');
    const bad = await d2.respond('save.load', { slot: 'main' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('SAVE_CORRUPT');
    // 직전 정상 백업으로 복구
    const restored = await call(d2, 'save.load', { slot: 'main', backupIndex: 1 });
    expect(restored.saveName).toBe('백업');
    d2.close();
  });

  it('더 새로운 버전의 저장본은 거부하고, 구버전은 사본에서 변환한다', async () => {
    const dir = newDir();
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 7, saveName: '버전', seed: 'ver' });
    await call(d, 'save.save', { slot: 'v' });
    d.close();
    const path = join(dir, 'saves', 'v.db');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    const info = inspectSaveFile(path);
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.code).toBe('NEWER_VERSION');

    // 변환 단계 실행 확인 (가상의 1→2 변환)
    const db2 = new DatabaseSync(path);
    db2.exec('PRAGMA user_version = 1');
    const step: Migration = { from: 1, to: 2, description: '테스트 열 추가', up: (x) => x.exec('ALTER TABLE players ADD COLUMN test_col INTEGER') };
    expect(migrate(db2, [step], 2)).toEqual([2]);
    expect(readSchemaVersion(db2)).toBe(2);
    db2.close();
  });

  it('저장 작업 폴더의 임시 파일은 저장 폴더(클라우드 동기화 대상)에 남지 않는다', async () => {
    const dir = newDir();
    const sm = new SaveManager(dir);
    expect(existsSync(sm.tmpDir)).toBe(true);
    expect(sm.tmpDir).not.toContain(join('saves', ''));
  });
});

describe('시즌 전체 일관성', () => {
  it('정규시즌 144경기를 모두 치른 뒤 규칙 위반이 없다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 8, saveName: '시즌', seed: 'season' });
    while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
    const r = await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
    expect(r.phase).toBe('postseason');
    const dash = await call(d, 'game.dashboard');
    expect(dash.gamesPlayedLeague).toBe(720);
    const standings = await call(d, 'game.standings');
    for (const s of standings) expect(s.games).toBe(144);
    expect(checkInvariants(d.saves.repository(), dash.season)).toEqual([]);
    // 박스스코어 합계와 시즌 합계 일치 (05 문서 완료 기준)
    const hitters = await call(d, 'game.players', { scope: 'all', group: 'hitters' });
    const pitchers = await call(d, 'game.players', { scope: 'all', group: 'pitchers' });
    const totalHr = hitters.reduce((a, h) => a + Number(h.stats.HR ?? 0), 0);
    const repo = d.saves.repository();
    const league = repo.leaguePitchingTotals(dash.season);
    expect(totalHr).toBe(league.HR);
    expect(pitchers.reduce((a, p) => a + Number(p.stats.W ?? 0), 0)).toBe(standings.reduce((a, s) => a + s.wins, 0));
    d.close();
  });
});
