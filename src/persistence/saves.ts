// 세이브 관리 (20 문서, 03_development 저장 안정성).
//
// 파일 구성 (baseDir 아래)
//   session/current.db   진행 중인 게임. WAL 모드 + synchronous=FULL. 매일 처리는 트랜잭션으로 반영돼 강제 종료에도 마지막 확정 날짜까지 보존된다.
//   saves/<slot>.db      완성된 저장본만 둔다. 클라우드 동기화 대상 폴더. (작업 중 파일은 절대 두지 않는다)
//   saves/<slot>.bak1.db, .bak2.db …  이전 정상 저장본
//   tmp/                 저장본을 만드는 작업 폴더 (동기화 대상 아님)
//
// 저장 절차: 실행 중인 DB를 단순 복사하지 않는다.
//   1) VACUUM INTO로 tmp에 일관된 사본 생성 (SQLite가 읽기 트랜잭션 안에서 만든 스냅샷)
//   2) 사본을 열어 무결성 검사(quick_check)와 필수 메타 확인
//   3) 기존 저장본을 백업으로 한 칸씩 밀고, 사본을 저장본 이름으로 교체(rename)
// 불러오기: 저장본을 검사한 뒤 세션 사본으로 복제하고, 필요하면 사본에서 버전 변환을 한다. 저장본 원본은 바꾸지 않는다.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SAVE } from '../engine/config';
import { SqliteGameRepository } from './repository';
import { createSchema, migrate, MIGRATIONS, readSchemaVersion, SCHEMA_VERSION, type Migration } from './schema';

export interface SlotMeta {
  slot: string;
  name: string;
  season: number;
  date: string;
  clubId: number;
  savedAt: string;
  schemaVersion: number;
  sizeBytes: number;
}

export interface SlotListing extends SlotMeta {
  status: 'ok' | 'corrupt' | 'newerVersion';
  message?: string;
  backups: Array<{ index: number; savedAt: string; date: string }>;
}

export class SaveError extends Error {
  constructor(
    public readonly code: 'CORRUPT' | 'NEWER_VERSION' | 'NOT_FOUND' | 'NO_SESSION' | 'WRITE_FAILED' | 'INVALID_SLOT',
    message: string,
  ) {
    super(message);
  }
}

const SLOT_PATTERN = /^[a-z0-9_-]{1,40}$/;
const sqlPath = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "''");

function openDb(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

/** 파일 무결성과 필수 메타를 확인한다. 실패하면 이유를 돌려준다. */
export function inspectSaveFile(path: string): { ok: true; meta: Omit<SlotMeta, 'slot' | 'sizeBytes'> } | { ok: false; code: 'CORRUPT' | 'NEWER_VERSION'; message: string } {
  let db: DatabaseSync | null = null;
  try {
    db = openDb(path, true);
    const check = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    if (!check || check.quick_check !== 'ok') return { ok: false, code: 'CORRUPT', message: `무결성 검사 실패: ${check?.quick_check ?? '응답 없음'}` };
    const version = readSchemaVersion(db);
    if (version > SCHEMA_VERSION) return { ok: false, code: 'NEWER_VERSION', message: `더 새로운 버전(${version})에서 만든 저장본입니다. 게임을 업데이트하세요.` };
    const get = (key: string) => {
      const row = db!.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined;
      if (!row?.value) throw new Error(`필수 정보 없음: ${key}`);
      return JSON.parse(row.value);
    };
    return {
      ok: true,
      meta: { name: get('saveName'), season: get('season'), date: get('currentDate'), clubId: get('userClubId'), savedAt: get('savedAt'), schemaVersion: version },
    };
  } catch (e) {
    return { ok: false, code: 'CORRUPT', message: `저장본을 읽을 수 없습니다: ${(e as Error).message}` };
  } finally {
    db?.close();
  }
}

export class SaveManager {
  readonly sessionDir: string;
  readonly savesDir: string;
  readonly tmpDir: string;
  private session: DatabaseSync | null = null;
  private repo: SqliteGameRepository | null = null;

  constructor(
    readonly baseDir: string,
    private readonly migrations: Migration[] = MIGRATIONS,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.sessionDir = join(baseDir, 'session');
    this.savesDir = join(baseDir, 'saves');
    this.tmpDir = join(baseDir, 'tmp');
    for (const d of [this.sessionDir, this.savesDir, this.tmpDir]) mkdirSync(d, { recursive: true });
  }

  get sessionPath(): string {
    return join(this.sessionDir, 'current.db');
  }

  private slotPath(slot: string, backup = 0): string {
    if (!SLOT_PATTERN.test(slot)) throw new SaveError('INVALID_SLOT', `잘못된 저장 슬롯 이름: ${slot}`);
    return join(this.savesDir, backup === 0 ? `${slot}.db` : `${slot}.bak${backup}.db`);
  }

  private removeDbFiles(path: string): void {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
  }

  hasSession(): boolean {
    return this.session !== null;
  }

  repository(): SqliteGameRepository {
    if (!this.repo) throw new SaveError('NO_SESSION', '진행 중인 게임이 없습니다.');
    return this.repo;
  }

  /** 새 게임용 빈 세션을 만든다. 기존 세션은 버린다. */
  createSession(): SqliteGameRepository {
    this.closeSession();
    this.removeDbFiles(this.sessionPath);
    this.session = openDb(this.sessionPath);
    createSchema(this.session);
    this.repo = new SqliteGameRepository(this.session);
    this.repo.setMetaValue('unsavedDays', 0);
    this.repo.setMetaValue('lastSavedAt', null);
    return this.repo;
  }

  /** 앱 시작 시: 이전에 종료된 세션이 남아 있으면 이어서 열 수 있는지 확인한다. */
  inspectRecoverableSession(): { name: string; date: string; clubId: number } | null {
    if (!existsSync(this.sessionPath)) return null;
    try {
      const db = openDb(this.sessionPath); // WAL을 반영하기 위해 쓰기 모드로 연다
      try {
        const check = db.prepare('PRAGMA quick_check').get() as { quick_check?: string };
        if (check.quick_check !== 'ok') return null;
        const get = (k: string) => JSON.parse(String((db.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string }).value));
        return { name: get('saveName'), date: get('currentDate'), clubId: get('userClubId') };
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  resumeSession(): SqliteGameRepository {
    if (this.repo) return this.repo;
    if (!this.inspectRecoverableSession()) throw new SaveError('NO_SESSION', '이어서 할 세션이 없습니다.');
    this.session = openDb(this.sessionPath);
    migrate(this.session, this.migrations);
    this.repo = new SqliteGameRepository(this.session);
    return this.repo;
  }

  closeSession(): void {
    if (this.session) {
      try {
        this.session.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        // 종료 중 체크포인트 실패는 다음 실행 때 WAL로 복구된다.
      }
      this.session.close();
    }
    this.session = null;
    this.repo = null;
  }

  /** 하루 진행 후 호출: 저장되지 않은 날짜 수를 센다. 자동 저장 시점이면 true. */
  noteDaysAdvanced(days: number): boolean {
    const repo = this.repository();
    const unsaved = (repo.getMetaValue<number>('unsavedDays') ?? 0) + days;
    repo.setMetaValue('unsavedDays', unsaved);
    const sinceAuto = (repo.getMetaValue<number>('daysSinceAutosave') ?? 0) + days;
    repo.setMetaValue('daysSinceAutosave', sinceAuto);
    return sinceAuto >= SAVE.autosaveEveryDays;
  }

  /** 현재 세션을 슬롯에 저장한다. 실패하면 기존 저장본은 그대로 남는다. */
  save(slot: string, kind: 'manual' | 'auto' = 'manual'): SlotMeta {
    if (!this.session || !this.repo) throw new SaveError('NO_SESSION', '저장할 게임이 없습니다.');
    const target = this.slotPath(slot);
    const savedAt = this.now();
    const tmp = join(this.tmpDir, `${slot}.${Date.now()}.db`);
    this.removeDbFiles(tmp);
    try {
      // 저장 시각은 사본에도 들어가도록 먼저 기록한다.
      this.repo.setMetaValue('savedAt', savedAt);
      this.session.exec(`VACUUM INTO '${sqlPath(tmp)}'`);
      const inspected = inspectSaveFile(tmp);
      if (!inspected.ok) throw new SaveError('WRITE_FAILED', `저장본 검증 실패: ${inspected.message}`);
      const keep = kind === 'auto' ? SAVE.autosaveBackupsKept : SAVE.manualBackupsKept;
      // 백업 회전: 가장 오래된 백업 삭제 → 한 칸씩 밀기 → 현재 저장본을 bak1로
      rmSync(this.slotPath(slot, keep), { force: true });
      for (let i = keep - 1; i >= 1; i--) {
        if (existsSync(this.slotPath(slot, i))) renameSync(this.slotPath(slot, i), this.slotPath(slot, i + 1));
      }
      if (existsSync(target)) renameSync(target, this.slotPath(slot, 1));
      renameSync(tmp, target);
      this.repo.setMetaValue('lastSavedAt', savedAt);
      this.repo.setMetaValue('daysSinceAutosave', 0);
      if (kind === 'manual') this.repo.setMetaValue('unsavedDays', 0);
      return { slot, ...inspected.meta, sizeBytes: statSync(target).size };
    } catch (e) {
      this.removeDbFiles(tmp);
      if (e instanceof SaveError) throw e;
      throw new SaveError('WRITE_FAILED', `저장하지 못했습니다: ${(e as Error).message}. 기존 저장본은 그대로 남아 있습니다.`);
    }
  }

  /** 저장본(또는 그 백업)을 불러와 세션으로 만든다. */
  load(slot: string, backupIndex = 0): SqliteGameRepository {
    const source = this.slotPath(slot, backupIndex);
    if (!existsSync(source)) throw new SaveError('NOT_FOUND', '저장본이 없습니다.');
    const inspected = inspectSaveFile(source);
    if (!inspected.ok) throw new SaveError(inspected.code, inspected.message);
    const staging = join(this.tmpDir, `load.${Date.now()}.db`);
    this.removeDbFiles(staging);
    const src = openDb(source, true);
    try {
      src.exec(`VACUUM INTO '${sqlPath(staging)}'`);
    } finally {
      src.close();
    }
    // 버전 변환은 사본에서 한다. 실패하면 세션을 바꾸지 않는다.
    const stagingDb = openDb(staging);
    try {
      migrate(stagingDb, this.migrations);
    } catch (e) {
      stagingDb.close();
      this.removeDbFiles(staging);
      throw new SaveError('CORRUPT', `저장본 변환 실패: ${(e as Error).message}`);
    }
    stagingDb.close();
    this.closeSession();
    this.removeDbFiles(this.sessionPath);
    renameSync(staging, this.sessionPath);
    this.removeDbFiles(staging);
    this.session = openDb(this.sessionPath);
    this.repo = new SqliteGameRepository(this.session);
    this.repo.setMetaValue('unsavedDays', 0);
    this.repo.setMetaValue('daysSinceAutosave', 0);
    return this.repo;
  }

  list(): SlotListing[] {
    const slots = new Set<string>();
    for (const f of readdirSync(this.savesDir)) {
      const m = /^([a-z0-9_-]+?)(?:\.bak\d+)?\.db$/.exec(f);
      if (m?.[1]) slots.add(m[1]);
    }
    const out: SlotListing[] = [];
    for (const slot of [...slots].sort()) {
      const path = this.slotPath(slot);
      const backups: SlotListing['backups'] = [];
      for (let i = 1; i <= Math.max(SAVE.autosaveBackupsKept, SAVE.manualBackupsKept); i++) {
        const bp = this.slotPath(slot, i);
        if (!existsSync(bp)) continue;
        const info = inspectSaveFile(bp);
        if (info.ok) backups.push({ index: i, savedAt: info.meta.savedAt, date: info.meta.date });
      }
      if (!existsSync(path)) {
        out.push({ slot, name: slot, season: 0, date: '', clubId: 0, savedAt: '', schemaVersion: 0, sizeBytes: 0, status: 'corrupt', message: '저장본이 없고 백업만 있습니다.', backups });
        continue;
      }
      const info = inspectSaveFile(path);
      const sizeBytes = statSync(path).size;
      if (info.ok) out.push({ slot, ...info.meta, sizeBytes, status: 'ok', backups });
      else out.push({ slot, name: slot, season: 0, date: '', clubId: 0, savedAt: '', schemaVersion: 0, sizeBytes, status: info.code === 'NEWER_VERSION' ? 'newerVersion' : 'corrupt', message: info.message, backups });
    }
    return out;
  }
}
