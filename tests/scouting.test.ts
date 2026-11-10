import { afterEach, expect, it } from 'vitest';
import { currentRatings, createSnapshot, snapshotRanges } from '../src/engine/scouting';
import { Rng } from '../src/engine/rng';
import { seasonKeyDates } from '../src/engine/schedule';
import { weekIdFor } from '../src/game/week';
import { generateWorld } from '../src/engine/worldgen';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanup(dirs.pop()!); });
async function setup() {
  const dir = tempDir(); dirs.push(dir);
  const d = makeDispatcher(dir);
  await call(d, 'game.new', { clubId: 3, seed: 'scouting-3c', saveName: '3c' });
  return d;
}
it('타 구단 수치·구속·구종·숙련도는 범위만, 우리 선수는 실제값, 히든은 문구만 전송한다', async () => {
  const d = await setup();
  try {
    const repo = d.saves.repository();
    for (const own of [true, false]) for (const pitcher of [true, false]) {
      const p = repo.getPlayers().find(p => (p.clubId === 3) === own && p.isPitcher === pitcher)!;
      const v = await call(d, 'game.player', { playerId: p.id });
      expect(v.exactRatings).toBe(own);
      expect(v.ratings).toEqual(own ? currentRatings(p) : {});
      expect(Object.keys(v.ratingRanges).length > 0).toBe(!own);
      expect(JSON.stringify(v)).not.toMatch(/"(hidden|potential|pressureSensitivity|growthRate|consistency)":/);
      if (!own && pitcher) { expect(v.ratingRanges.velocityAvg).toBeDefined(); expect(v.pitches[0]!.values).toEqual({}); }
      expect(v.traits[0]!.text).toContain('판단 유보');
    }
    const list = await call(d, 'game.players', { scope: 'all', group: 'hitters', sortKey: 'contact' });
    expect(list.filter(p => p.club?.id !== 3).every(p => Object.keys(p.ratings).length === 0)).toBe(true);
  } finally { d.close(); }
});
it('조회·담당자 변경·저장 재개는 평가와 난수를 바꾸지 않고 조사는 1회만 비용을 낸다', async () => {
  const d = await setup();
  try {
    const repo = d.saves.repository();
    const p = repo.getPlayers().find(p => p.clubId === 4)!;
    const before = await call(d, 'game.player', { playerId: p.id });
    const fp = fingerprint(d);
    for (let i = 0; i < 4; i++) expect(await call(d, 'game.player', { playerId: p.id })).toEqual(before);
    expect(fingerprint(d)).toBe(fp);
    const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
    const report = await call(d, 'player.scout', { playerId: p.id });
    expect(report.scouting.confidence).toBeGreaterThan(0);
    expect(report.ratingRanges.stuff!.high - report.ratingRanges.stuff!.low).toBeLessThan(before.ratingRanges.stuff!.high - before.ratingRanges.stuff!.low);
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap - 1);
    const duplicate = await d.respond('player.scout', { playerId: p.id });
    expect(duplicate.ok).toBe(false);
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap - 1);
    await call(d, 'save.save', { slot: 'scout' });
    await call(d, 'save.load', { slot: 'scout' });
    expect(await call(d, 'game.player', { playerId: p.id })).toEqual(report);
  } finally { d.close(); }
});
it('메모 2,000자·관심 등록은 저장/백업/세이브별로 유지하고 잘못된 입력은 변경하지 않는다', async () => {
  const d = await setup();
  try {
    const id = d.saves.repository().getPlayers()[0]!.id;
    const payload = { playerId: id, text: '<script>메모</script>' + '가'.repeat(1981), watched: true };
    const note = await call(d, 'player.note', payload);
    expect(note.text.length).toBe(2000);
    await call(d, 'save.save', { slot: 'notes' });
    await call(d, 'player.note', { ...payload, text: '변경', watched: false });
    await call(d, 'save.save', { slot: 'notes' });
    await call(d, 'save.load', { slot: 'notes', backupIndex: 1 });
    expect((await call(d, 'game.player', { playerId: id })).note).toEqual(note);
    expect((await d.respond('player.note', { ...payload, text: '가'.repeat(2001) })).ok).toBe(false);
    expect((await call(d, 'game.player', { playerId: id })).note).toEqual(note);
    await call(d, 'game.new', { clubId: 3, seed: 'scouting-3c', saveName: '새 세이브' });
    expect((await call(d, 'game.player', { playerId: id })).note.text).toBe('');
  } finally { d.close(); }
});
it('조사 신뢰도·노후화·성향 경계와 우수 스카우트 평균 오차를 확인한다', () => {
  const world = generateWorld(Rng.fromSeed('scout-quality'), 2026);
  let lowError = 0, highError = 0;
  for (const p of world.filter(p => !p.isPitcher).slice(0,100)) {
    const base = createSnapshot('test', 99, p, '2027-01-01', '기초', 1);
    const low = createSnapshot('test', 99, p, '2027-02-01', '초급', 1.4, base);
    let high = createSnapshot('test', 99, p, '2027-02-01', '숙련', 0.6, base);
    high = createSnapshot('test', 99, p, '2027-03-01', '숙련', 0.6, high);
    lowError += Math.abs(low.centers.contact! - p.batting.contact);
    highError += Math.abs(high.centers.contact! - p.batting.contact);
    expect(high.traits.length).toBeGreaterThan(0);
    const fresh = snapshotRanges(high, '2027-03-01').contact!;
    const stale = snapshotRanges(high, '2028-03-01').contact!;
    expect(stale.high - stale.low).toBeGreaterThanOrEqual(fresh.high - fresh.low);
    expect(high.confidence).toBeLessThanOrEqual(100);
  }
  expect(highError).toBeLessThan(lowError);
  expect(highError).toBeGreaterThan(0);
});
it('비용 부족 조사 실패는 AP·WP·관측을 원자적으로 보존한다', async () => {
  const d = await setup();
  try {
    const repo = d.saves.repository(), meta = repo.getMeta();
    const id = repo.getPlayers().find(p => p.clubId === 4)!.id;
    const week = weekIdFor(meta.currentDate);
    const ap = repo.getApWeek(week)!;
    repo.spendAp(week, ap.granted - ap.used);
    const before = repo.getScouting(meta.userClubId);
    const wp = repo.getWp(week);
    expect((await d.respond('player.scout', { playerId: id })).ok).toBe(false);
    expect(repo.getScouting(meta.userClubId)).toEqual(before);
    expect(repo.getWp(week)).toEqual(wp);
  } finally { d.close(); }
});
it('상세 조회·메모와 저장 재개 뒤 같은 경기·성적 혼합 결과를 재현한다', async () => {
  const d = await setup();
  try {
    const repo = d.saves.repository();
    // 준비 단계를 생략하고 세 경기일만 실행해 저장 재현 경계를 검사한다.
    repo.updateMeta({ mode: 'season', season: 2027, currentDate: seasonKeyDates(2027).opening });
    await call(d, 'game.advance', { mode: 'day' });
    await call(d, 'save.save', { slot: 'replay' });
    const id = repo.getPlayers().find(p => p.clubId === 3)!.id;
    for (let i = 0; i < 3; i++) await call(d, 'game.advance', { mode: 'day' });
    const expected = fingerprint(d);
    const expectedGames = d.saves.repository().getGames(2027).map(g => d.saves.repository().getGameEvents(g.fixtureId));
    await call(d, 'save.load', { slot: 'replay' });
    await call(d, 'game.player', { playerId: id });
    await call(d, 'player.note', { playerId: id, text: '기록 확인', watched: true });
    for (let i = 0; i < 3; i++) await call(d, 'game.advance', { mode: 'day' });
    expect(fingerprint(d)).toBe(expected);
    expect(d.saves.repository().getGames(2027).map(g => d.saves.repository().getGameEvents(g.fixtureId))).toEqual(expectedGames);
  } finally { d.close(); }
});
