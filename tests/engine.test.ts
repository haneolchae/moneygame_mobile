import { describe, expect, it } from 'vitest';
import { LEAGUE } from '../src/engine/config';
import { paProbabilities, simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { applyRate, growBy, prorate, splitEvenly } from '../src/engine/money';
import { Rng } from '../src/engine/rng';
import { generateSchedule, validateSchedule } from '../src/engine/schedule';
import { generateWorld } from '../src/engine/worldgen';

describe('금액 규칙', () => {
  it('비율 계산은 원 단위 사사오입', () => {
    expect(applyRate(1_000_000_000, 250)).toBe(25_000_000);
    expect(applyRate(1, 5000)).toBe(1); // 0.5원 → 1원
    expect(applyRate(-1, 5000)).toBe(-1); // 음수도 대칭
    expect(applyRate(3, 3333)).toBe(1); // 0.9999 → 1
    expect(growBy(80_000_000_000, 500)).toBe(84_000_000_000); // 중계권 5% 인상
  });
  it('큰 금액의 곱셈도 정확하다 (BigInt 중간 계산)', () => {
    expect(applyRate(9_000_000_000_000_000, 1)).toBe(900_000_000_000);
    expect(prorate(14_400_000_000, 1, 144)).toBe(100_000_000);
  });
  it('분할 지급 합계는 원금과 같다', () => {
    const parts = splitEvenly(1_000_000_001, 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_000_001);
    expect(parts).toEqual([333_333_334, 333_333_334, 333_333_333]);
  });
  it('정수가 아닌 금액은 거부한다', () => {
    expect(() => applyRate(1.5, 100)).toThrow();
  });
});

describe('난수', () => {
  it('같은 상태에서 같은 수열', () => {
    const a = Rng.fromSeed('x');
    const b = new Rng(a.state());
    expect(Array.from({ length: 5 }, () => a.nextUint32())).toEqual(Array.from({ length: 5 }, () => b.nextUint32()));
  });
});

describe('정규시즌 일정', () => {
  it.each([
    ['seed-a', 2026],
    ['seed-b', 2027],
    ['seed-c', 2028],
    ['seed-d', 2031],
  ])('%s / %i 시즌 일정이 모든 규칙을 만족한다', (seed, season) => {
    const fixtures = generateSchedule(season, Rng.fromSeed(seed), 1);
    expect(validateSchedule(fixtures, season)).toEqual([]);
    expect(fixtures).toHaveLength((LEAGUE.clubs * LEAGUE.gamesPerSeason) / 2);
  });
  it('2026 개막은 3월 28일(토), 올스타 주에는 2경기', () => {
    const fixtures = generateSchedule(2026, Rng.fromSeed('k'), 1);
    expect(fixtures[0]!.date).toBe('2026-03-28');
    const allStarWeek = fixtures.filter((f) => f.date >= '2026-07-06' && f.date <= '2026-07-12');
    expect(new Set(allStarWeek.map((f) => f.date))).toEqual(new Set(['2026-07-07', '2026-07-08']));
  });
});

describe('경기 시뮬레이션', () => {
  const players = generateWorld(Rng.fromSeed('world'), 2026);
  const team = (clubId: number) => prepareTeam(clubId, players.filter((p) => p.clubId === clubId && p.level === '1군'), [], null);

  it('타석 결과 확률의 합은 1', () => {
    const t = team(1);
    for (const spot of t.lineup) {
      const sum = Object.values(paProbabilities(spot.player, t.starter, t.defense)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('200경기에서 득점·아웃·승패 기록이 서로 맞는다', () => {
    let totalRuns = 0;
    let totalPa = 0;
    for (let i = 0; i < 200; i++) {
      const home = (i % 10) + 1;
      const away = ((i + 3) % 10) + 1;
      const r = simulateGame(i + 1, team(home), team(away), Rng.derive('g', i), LEAGUE.regularSeasonMaxInnings);
      const homeRuns = r.runs.filter((x) => x.battingClub === home).length;
      const awayRuns = r.runs.filter((x) => x.battingClub === away).length;
      expect(homeRuns).toBe(r.homeRuns);
      expect(awayRuns).toBe(r.awayRuns);
      // 원정 공격은 매 이닝 3아웃
      const awayOuts = r.events.filter((e) => e.half === 'T').reduce((a, e) => a + e.outsOnPlay, 0);
      expect(awayOuts).toBe(r.innings * 3);
      expect(r.innings).toBeLessThanOrEqual(LEAGUE.regularSeasonMaxInnings);
      if (r.outcome === 'tie') expect(r.innings).toBe(LEAGUE.regularSeasonMaxInnings);
      else {
        expect(r.winningPitcher).not.toBeNull();
        expect(r.losingPitcher).not.toBeNull();
      }
      expect(r.events.reduce((a, e) => a + e.rbi, 0)).toBeLessThanOrEqual(r.runs.length);
      totalRuns += r.homeRuns + r.awayRuns;
      totalPa += r.events.length;
    }
    // 가상 리그 목표 범위(경기당 양 팀 합계 약 7~12점, 타석 약 70~85)
    expect(totalRuns / 200).toBeGreaterThan(6);
    expect(totalRuns / 200).toBeLessThan(13);
    expect(totalPa / 200).toBeGreaterThan(65);
    expect(totalPa / 200).toBeLessThan(90);
  });

  it('같은 입력과 난수 상태면 같은 경기', () => {
    const a = simulateGame(1, team(2), team(3), Rng.derive('same', 1), 11);
    const b = simulateGame(1, team(2), team(3), Rng.derive('same', 1), 11);
    expect(a).toEqual(b);
  });
});
