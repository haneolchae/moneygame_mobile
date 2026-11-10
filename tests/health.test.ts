// 4b-1 건강(D-126·D-127): 부상 판정 재현성·기간 경계, 부상자 출전 0건, 1군 26명 유지, 휴식 지시 반영, 특별 검사 비용·주기, 정보 공개 경계
import { describe, expect, it } from 'vitest';
import { HEALTH } from '../src/engine/config';
import { injuredOn, rollInjury } from '../src/engine/health';
import type { PlayerTruth } from '../src/engine/types';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkHealthPlay } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('건강 (4b-1)', () => {
  it('부상 판정: 같은 입력은 같은 결과, 출전 불가 기간 경계, 중증도 분포', () => {
    const p = { id: 7, isPitcher: false, hidden: { durability: 50 } } as unknown as PlayerTruth;
    const rolls = Array.from({ length: 20000 }, (_, i) => rollInjury('h', `2027-04-${String((i % 28) + 1).padStart(2, '0')}`, { ...p, id: i }, 40, 28, 0.5, true));
    expect(rollInjury('h', '2027-04-01', p, 40, 28, 0.5, true)).toEqual(rollInjury('h', '2027-04-01', p, 40, 28, 0.5, true));
    const hits = rolls.filter((x) => x !== null);
    // 기본 0.005 × (1 + 40/50) × 내구성 계수 1.0 = 0.9% 근처
    expect(hits.length / rolls.length).toBeGreaterThan(0.007);
    expect(hits.length / rolls.length).toBeLessThan(0.011);
    expect(hits.filter((x) => x!.severity === '경미').length / hits.length).toBeGreaterThan(0.4);
    const inj = hits[0]!;
    expect(injuredOn(inj, inj.date)).toBe(false); // 발생 당일 경기는 이미 치름
    expect(injuredOn(inj, inj.returnDate)).toBe(false); // 복귀일부터 출전 가능
    expect(inj.estimate.from <= inj.estimate.to).toBe(true);
  });

  it('부상자 출전 0건·1군 26명·휴식 지시·특별 검사·정보 경계', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 6, saveName: 't', seed: 'health-4b1' });
      const repo = d.saves.repository();
      await until(d, '2027-05-10');
      const players = repo.getPlayers();
      expect(players.filter((p) => p.health?.injury || p.health?.history.length).length).toBeGreaterThan(5);
      expect(checkHealthPlay(repo, 2027)).toEqual([]);
      for (const c of repo.getClubs()) expect(players.filter((p) => p.clubId === c.id && p.level === '1군')).toHaveLength(26);

      // 휴식 지시: 행동력 0, 다음 경기에 나서지 않는다
      const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
      const target = players.find((p) => p.clubId === 6 && p.level === '1군' && !p.isPitcher && p.position !== 'C' && !p.health?.injury)!;
      await call(d, 'player.rest', { playerId: target.id, days: 2 });
      expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap);
      const today = (await call(d, 'game.dashboard')).date;
      await call(d, 'game.advance', { mode: 'day' });
      const games = repo.getGames(2027).filter((g) => g.date === today && (g.home === 6 || g.away === 6));
      for (const g of games) expect(repo.getGameEvents(g.fixtureId).pas.some((pa) => pa.batterId === target.id)).toBe(false);

      // 특별 검사: 행동력 1, 같은 선수 7일 안 재검사 거부(무비용)
      const ap2 = (await call(d, 'game.dashboard')).owner.apRemaining;
      const r = await call(d, 'player.medicalCheck', { playerId: target.id });
      expect(r.message).toContain('검사');
      expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap2 - HEALTH.checkAp);
      expect((await d.respond('player.medicalCheck', { playerId: target.id })).ok).toBe(false);
      expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap2 - HEALTH.checkAp);

      // 정보 경계: 다른 구단 부상 선수는 부상 여부만
      const otherHurt = repo.getPlayers().find((p) => p.clubId !== 6 && p.clubId !== null && p.health?.injury);
      if (otherHurt) {
        const v = await call(d, 'game.player', { playerId: otherHurt.id });
        expect(v.health.injury).toBeNull();
        expect(JSON.stringify(v)).not.toContain('returnDate');
      }
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
