import { afterEach, describe, expect, it } from 'vitest';
import { scheduledEntries, broadcastLeagueTotal, inflate } from '../src/engine/finance';
import { CLUB_PROFILES, SEASON_2026_STANDINGS } from '../src/engine/clubs';
import { EOK } from '../src/engine/money';
import { seasonModeStart, stoveEvents } from '../src/engine/stove';
import { weekIdFor } from '../src/game/service';
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

describe('스토브리그 달력', () => {
  it('2026-11-08 기준 리그 일정 (D-061)', () => {
    const ev = Object.fromEntries(stoveEvents('2026-11-08').map((e) => [e.kind, e.date]));
    expect(ev.faNotice).toBe('2026-11-13');
    expect(ev.faApplyDeadline).toBe('2026-11-15');
    expect(ev.faApproval).toBe('2026-11-16');
    expect(ev.faMarketOpen).toBe('2026-11-17');
    expect(ev.reserveList).toBe('2026-11-30');
    expect(ev.arbitrationDeadline).toBe('2027-01-10');
    expect(seasonModeStart(2026)).toBe('2027-02-01');
  });
  it('첫 주는 11/8(일)~11/15, 이후는 월요일 시작', () => {
    expect(weekIdFor('2026-11-08')).toBe('2026-11-09');
    expect(weekIdFor('2026-11-15')).toBe('2026-11-09');
    expect(weekIdFor('2026-11-16')).toBe('2026-11-16');
  });
  it('2026 실제 순위 10개 구단 모두 144경기', () => {
    expect(SEASON_2026_STANDINGS).toHaveLength(10);
    for (const s of SEASON_2026_STANDINGS) expect(s.wins + s.losses + s.ties).toBe(144);
    expect(SEASON_2026_STANDINGS.find((s) => s.postseason === '한국시리즈 우승')?.clubId).toBe(7); // 레오즈(삼성)
  });
});

describe('정기 수입·지출 일정', () => {
  const club = CLUB_PROFILES[0]!;
  const base = { seasonYear: 2026, inflationBp: {}, club, salaries: [100_000_000, 30_000_000], releasedSalaries: [] as number[], homeGamesToday: 0, staffPayroll: 5_000_000_000 };
  it('월말에만 월 단위 항목이 기록된다', () => {
    expect(scheduledEntries({ ...base, date: '2026-11-15' })).toEqual([]);
    expect(scheduledEntries({ ...base, date: '2026-11-30' }).length).toBeGreaterThan(0);
  });
  it('선수 연봉은 2~11월에만, 12·1월에는 지급하지 않는다 (D-059)', () => {
    const has = (date: string) => scheduledEntries({ ...base, date }).some((e) => e.category === 'playerSalary');
    expect(has('2026-11-30')).toBe(true);
    expect(has('2026-12-31')).toBe(false);
    expect(has('2027-01-31')).toBe(false);
    const nov = scheduledEntries({ ...base, date: '2026-11-30' }).find((e) => e.category === 'playerSalary')!;
    expect(nov.amount).toBe(-(10_000_000 + 3_000_000));
  });
  it('1년치 월 단위 항목 합계는 연간 금액과 정확히 같다', () => {
    let support = 0;
    for (const d of ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']) {
      support += scheduledEntries({ ...base, date: d }).find((e) => e.category === 'parentSupport')?.amount ?? 0;
    }
    expect(support).toBe(club.parentSupport);
  });
  it('중계권료: 2026 총 800억, 매년 5%, 3년마다 재계약 인상', () => {
    expect(broadcastLeagueTotal(2026)).toBe(800 * EOK);
    expect(broadcastLeagueTotal(2027)).toBe(840 * EOK);
    expect(broadcastLeagueTotal(2030)).toBeGreaterThan(Math.round(broadcastLeagueTotal(2029) * 1.05));
  });
  it('물가 상승률은 기준 금액에 해마다 누적된다', () => {
    expect(inflate(100 * EOK, 2027, { '2027': 250 })).toBe(102.5 * EOK);
    expect(inflate(100 * EOK, 2026, { '2027': 250 })).toBe(100 * EOK);
  });
});

describe('스토브리그 진행', () => {
  it('새 게임은 2026-11-08 스토브리그, 1주 단위로만 진행', async () => {
    const d = makeDispatcher(newDir());
    const dash = await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'stove' });
    expect(dash.date).toBe('2026-11-08');
    expect(dash.phase).toBe('stove');
    expect(dash.standings[0]?.club.name).toBe('수원 매지션스');
    expect(dash.owner.apRemaining).toBe(6);
    expect(dash.owner.weekLabel).toBe('11/08~11/15');
    const bad = await d.respond('game.advance', { mode: 'day' });
    expect(bad.ok).toBe(false);
    const r = await call(d, 'game.advance', { mode: 'week' });
    expect(r.date).toBe('2026-11-16');
    expect(r.daysProcessed).toBe(8);
    const inbox = await call(d, 'game.inbox');
    expect(inbox.some((m) => m.title === 'FA 자격 선수 공시')).toBe(true);
    d.close();
  });

  it('간판 외야수가 FA 자격 선수로 지정된다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'fa' });
    const mine = await call(d, 'game.players', { scope: 'mine', group: 'hitters' });
    const star = mine.filter((p) => p.franchise);
    expect(star).toHaveLength(1);
    expect(['LF', 'CF', 'RF']).toContain(star[0]!.position);
    expect(star[0]!.faEligible).toBe(true);
    expect(star[0]!.contractYears).toBe(0);
    const all = await call(d, 'game.players', { scope: 'all', group: 'all' });
    for (const club of CLUB_PROFILES) {
      const n = all.filter((p) => p.club?.id === club.id && p.faEligible).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
    }
    d.close();
  });

  it('스토브리그 12주 뒤 2027-02-01 시즌 모드로 전환되고, 돈과 행동력이 맞다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'switch' });
    let weeks = 0;
    let last;
    do {
      last = await call(d, 'game.advance', { mode: 'week' });
      weeks++;
    } while ((await call(d, 'game.dashboard')).phase === 'stove' && weeks < 20);
    expect(weeks).toBe(12);
    expect(last.stoppedReason).toContain('시즌 모드');
    expect(last.autosaved).toBe(true);
    const dash = await call(d, 'game.dashboard');
    expect(dash.date).toBe('2027-02-01');
    expect(dash.phase).toBe('preseason');
    expect(dash.season).toBe(2027);
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    expect(meta.inflationBp['2027']).toBeGreaterThanOrEqual(150);
    expect(meta.inflationBp['2027']).toBeLessThanOrEqual(350);
    // 행동력은 주마다 한 번씩 지급: 첫 주 + 이후 12번의 월요일(2/1 포함)
    for (const w of ['2026-11-09', '2026-11-16', '2027-01-25', '2027-02-01']) expect(repo.getApWeek(w)?.granted).toBe(6);
    // 현금 = 기초 현금 + 장부 합계 (장부 외 변경 없음)
    const club = CLUB_PROFILES.find((c) => c.id === 1)!;
    const fin = await call(d, 'game.finance');
    const entries = repo.ledgerEntries(1, 10_000);
    expect(fin.cashWon).toBe(entries.reduce((a, e) => a + e.amount, 0));
    // 스토브리그 동안 선수 연봉은 11월분 한 번만 지급
    expect(entries.filter((e) => e.category === 'playerSalary')).toHaveLength(1);
    expect(entries.find((e) => e.category === 'startCash')?.amount).toBe(club.startCash);
    d.close();
  });

  it('스토브리그 중간에 저장·불러오기해도 중단 없이 진행한 결과와 같다', async () => {
    const straight = makeDispatcher(newDir());
    await call(straight, 'game.new', { clubId: 9, saveName: 't', seed: 'mid' });
    for (let i = 0; i < 13; i++) await call(straight, 'game.advance', { mode: 'week' });
    const dir = newDir();
    const a = makeDispatcher(dir);
    await call(a, 'game.new', { clubId: 9, saveName: 't', seed: 'mid' });
    for (let i = 0; i < 6; i++) await call(a, 'game.advance', { mode: 'week' });
    await call(a, 'save.save', { slot: 'mid' });
    a.close();
    const b = makeDispatcher(dir);
    await call(b, 'save.load', { slot: 'mid' });
    for (let i = 0; i < 7; i++) await call(b, 'game.advance', { mode: 'week' });
    expect(fingerprint(b)).toBe(fingerprint(straight));
    straight.close();
    b.close();
  });
});
