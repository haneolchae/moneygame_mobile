// 9b-1 시즌 진행 성능 측정: 저장 슬롯을 불러와 정규시즌 끝까지 진행하고 시간과 결과 지문(표별 해시)을 낸다.
// 같은 기계에서 두 빌드를 번갈아 돌려 비율로 비교하고(D-242 (3)), 지문으로 같은 시드 결과가 같은지 본다.
// 사용: npm run bench:season -- --dir <sim --keep-dir 폴더> --slot pre2028 [--runs 3] [--out <json 경로>]
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Dispatcher } from '../src/host/dispatcher';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

/** 저장 시각처럼 실행마다 다른 meta 키(결과가 아님) */
const VOLATILE = new Set(['savedAt', 'lastSavedAt']);

/** 표마다 모든 행을 열 순서대로 정렬해 해시한다(rowid 순서·저장 시각 차이는 보지 않는다) */
function digest(file: string): Record<string, string> {
  const db = new DatabaseSync(file, { readOnly: true });
  const out: Record<string, string> = {};
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  // meta는 키마다 따로 본다(어느 상태가 달라졌는지 보이게)
  for (const r of db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>) if (!VOLATILE.has(r.key)) out[`meta.${r.key}`] = createHash('sha256').update(String(r.value)).digest('hex').slice(0, 12);
  for (const t of tables.filter((x) => x !== 'meta')) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all().map((r) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    rows.sort();
    const h = createHash('sha256');
    for (const r of rows) h.update(r).update('\n');
    out[t] = `${rows.length}:${h.digest('hex').slice(0, 12)}`;
  }
  db.close();
  return out;
}

async function main() {
  const src = arg('dir', '');
  const slot = arg('slot', '');
  const runs = Number(arg('runs', '1'));
  if (!src || !slot) throw new Error('--dir 와 --slot 이 필요합니다');
  const results: Array<{ ms: number; days: number; games: number; digest: Record<string, string> }> = [];
  for (let i = 0; i < runs; i++) {
    // 원본 폴더를 건드리지 않게 복사본에서 돌린다
    const base = mkdtempSync(join(tmpdir(), 'fo-bench-'));
    cpSync(join(src, 'saves', `${slot}.db`), join(base, 'saves', `${slot}.db`), { recursive: true });
    const d = new Dispatcher({ baseDir: base, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: 'bench' }, appVersion: 'bench' }) });
    const call = async <T>(name: string, payload?: unknown): Promise<T> => {
      const r = await d.respond(name as never, payload as never);
      if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
      return r.result as T;
    };
    await call('save.load', { slot });
    const t0 = performance.now();
    const r = await call<{ daysProcessed: number; gamesPlayed: number }>('game.advance', { mode: 'untilSeasonEnd', autoCards: true });
    const ms = Math.round(performance.now() - t0);
    await call('save.save', { slot: 'bench-out' });
    d.close();
    const dg = digest(join(base, 'saves', 'bench-out.db'));
    results.push({ ms, days: r.daysProcessed, games: r.gamesPlayed, digest: dg });
    console.log(JSON.stringify({ run: i + 1, slot, ms, days: r.daysProcessed, games: r.gamesPlayed, digest: createHash('sha256').update(JSON.stringify(dg)).digest('hex').slice(0, 12) }));
    rmSync(base, { recursive: true, force: true });
  }
  const out = arg('out', '');
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
