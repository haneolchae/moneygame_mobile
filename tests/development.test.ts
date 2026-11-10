// 4a 성장·노화 엔진(D-123·D-124): 사전 등록 기준 ① 나이 곡선, 월 상한, 같은 기간 중복 반영 없음, 잠재 상한
import { describe, expect, it } from 'vitest';
import { DEVELOPMENT } from '../src/engine/config';
import { applyAnnual, applyMonthly, coreAverage, devSnapshot } from '../src/engine/development';
import type { PlayerTruth } from '../src/engine/types';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkDevelopment } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

function hitter(): PlayerTruth {
  return {
    id: 1, name: '평균', birthDate: '2000-01-01', bats: 'R', throws: 'R', isPitcher: false, origin: 'domestic', position: 'SS', clubId: 1, level: '1군',
    salary: 1e8, contractYears: 1,
    career: {} as PlayerTruth['career'],
    batting: { contact: 45, power: 45, eye: 45, baserunning: 50, speed: 52, bunt: 40, mental: 50, stamina: 50 },
    pitching: null,
    defense: { range: 48, fielding: 48, armStrength: 50, armAccuracy: 50 },
    positions: { SS: 80 },
    hidden: {
      potential: { contact: 62, eye: 62, power: 62, speed: 56, range: 60, fielding: 60 },
      growthRate: 50, peakAge: 28, declineRate: 50, workEthic: 50, coachability: 50, adaptability: 50, consistency: 50, durability: 50,
      recoveryTendency: 50, pressureSensitivity: 50, leadership: 50, competitiveness: 50, contractPreference: '금액',
    },
  };
}

describe('성장·노화 (4a)', () => {
  it('사전 등록 ①: 정점 26~31세, 35세는 정점보다 3~12 낮음 · 월 1점 상한 · 잠재 상한 · 같은 기간 재반영 없음', () => {
    const p = hitter();
    const byAge = new Map<number, number>();
    for (let age = 20; age <= 40; age++) {
      const year = 2020 + age;
      for (const m of DEVELOPMENT.monthlyMonths) {
        const before = devSnapshot(p);
        const date = `${year}-${String(m).padStart(2, '0')}-01`;
        applyMonthly(p, 'dev-test', date, age);
        const after = devSnapshot(p);
        for (const k of Object.keys(before)) expect(Math.abs(after[k]! - before[k]!)).toBeLessThanOrEqual(DEVELOPMENT.monthlyCap);
        expect(applyMonthly(p, 'dev-test', date, age)).toEqual({}); // 같은 달 재반영 없음
      }
      applyAnnual(p, 'dev-test', year, `${year}-10-31`, age);
      expect(applyAnnual(p, 'dev-test', year, `${year}-10-31`, age)).toEqual({}); // 같은 시즌 재반영 없음
      for (const [k, pot] of Object.entries(p.hidden.potential)) expect(devSnapshot(p)[k]!).toBeLessThanOrEqual(Math.max(pot!, 45));
      byAge.set(age, coreAverage(p));
    }
    const peak = [...byAge.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(peak[0]).toBeGreaterThanOrEqual(26);
    expect(peak[0]).toBeLessThanOrEqual(31);
    const drop = peak[1] - byAge.get(35)!;
    expect(drop).toBeGreaterThanOrEqual(3);
    expect(drop).toBeLessThanOrEqual(12);
  });
});


async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('성장·노화 게임 반영 (4a)', () => {
  it('3/1 월간 반영 1회·우리 선수만 변화 공개·시즌 마감 연간 반영 1회·월 상한 규칙 검사', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'dev-4a' });
      const repo = d.saves.repository();
      await until(d, '2027-03-02');
      const active = repo.getPlayers().filter((p) => !p.retired);
      expect(active.every((p) => p.dev?.month === '2027-03')).toBe(true);
      expect(repo.getInbox(500).some((m) => m.title.startsWith('3월 성장 보고'))).toBe(true);
      const own = active.find((p) => p.clubId === 3)!;
      const other = active.find((p) => p.clubId === 5)!;
      expect((await call(d, 'game.player', { playerId: own.id })).development).not.toBeNull();
      expect((await call(d, 'game.player', { playerId: other.id })).development).toBeNull();
      expect(checkDevelopment(repo)).toEqual([]);
      // 정규시즌·포스트시즌 끝 → 시즌 마감 때 연간 반영 1회
      await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
      await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
      const after = repo.getPlayers().filter((p) => !p.retired && p.dev);
      expect(after.length).toBeGreaterThan(300);
      expect(after.every((p) => p.dev!.season === 2027)).toBe(true);
      expect(repo.getInbox(500).some((m) => m.title.includes('시즌 결산 성장·노화'))).toBe(true);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
