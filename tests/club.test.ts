// 3e 구단 선택·비교(D-121·D-122): 타 구단 정보 경계(추정 범위만), 전력 비교, 우리 구단 허브, 팀 기록·최근 경기,
// 구단 메모·라이벌 저장, 조회 무비용
import { afterEach, describe, expect, it } from 'vitest';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('구단 선택·비교 (3e)', () => {
  it('타 구단은 추정 범위만, 전력 비교·팀 기록·최근 경기, 우리 구단 허브, 구단 메모·라이벌, 조회 무비용', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'club-3e' });
    await until(d, '2027-04-05');
    const repo = d.saves.repository();
    const before = { ap: (await call(d, 'game.dashboard')).owner.apRemaining, rng: JSON.stringify(repo.getMeta().rngStreams) };

    const other = await call(d, 'club.view', { clubId: 9 });
    expect(other.mine).toBe(false);
    // 정보 경계: 타 구단 선수는 실제 능력 없이 추정 범위만
    expect(other.roster.length).toBeGreaterThan(30);
    for (const p of other.roster) {
      expect(p.ratings).toEqual({});
      expect(Object.keys(p.ratingRanges).length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(other)).not.toMatch(/"hidden"|potential/);
    // 전력 비교 5묶음: 우리는 실제(하한=상한), 상대는 범위
    expect(other.comparison!.map((g) => g.key)).toEqual(['C', 'IF', 'OF', 'SP', 'RP']);
    for (const g of other.comparison!) {
      expect(g.n).toBeGreaterThan(0);
      expect(g.ours.low).toBe(g.ours.high);
      expect(g.theirs.low).toBeLessThanOrEqual(g.theirs.high);
    }
    // 공개 팀 기록과 10개 구단 중 순위, 최근 경기
    expect(other.team.find((r) => r.key === 'OPS')!.rank).toBeGreaterThanOrEqual(1);
    expect(other.team.every((r) => r.rank >= 1 && r.rank <= 10)).toBe(true);
    expect(other.recent.length).toBeGreaterThan(0);
    expect(other.standing?.club.id).toBe(9);

    // 우리 구단: 비교 없음, 실제 능력
    const mine = await call(d, 'club.view', { clubId: 4 });
    expect(mine.mine).toBe(true);
    expect(mine.comparison).toBeNull();
    expect(Object.keys(mine.roster[0]!.ratings).length).toBeGreaterThan(0);

    // 구단 메모·라이벌: 저장 후 다시 열어도 유지, 잘못된 입력 거부
    await call(d, 'club.note', { clubId: 9, text: '불펜이 약함', rival: true });
    const again = await call(d, 'club.view', { clubId: 9 });
    expect(again.note).toMatchObject({ text: '불펜이 약함', rival: true });
    expect((await d.respond('club.note', { clubId: 9, text: 'x'.repeat(2001), rival: false })).ok).toBe(false);
    expect((await d.respond('club.view', { clubId: 99 })).ok).toBe(false);

    // 조회·메모는 행동력·난수를 쓰지 않는다
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(before.ap);
    expect(JSON.stringify(repo.getMeta().rngStreams)).toBe(before.rng);
    d.close();
  });
});
