// 4c-2b 감독 능력치·성향·신뢰도(D-172·D-173): 신뢰도 배율의 방향, 경기용 사본(저장 능력치 불변)·장타 반올림 기대값,
// 경기 뒤 신뢰도·최근 결정 갱신, 시즌 마감 AI 감독 교체, 정보 경계(조직 화면의 감독은 우리 감독뿐)
import { describe, expect, it } from 'vitest';
import { MANAGER } from '../src/engine/config';
import { managedPlayer, NEUTRAL_MANAGER, ratingBonus, regressTrust, trustScaled, type ManagerProfile } from '../src/engine/manager';
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/worldgen';
import { checkManagers } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const strong: ManagerProfile = { ...NEUTRAL_MANAGER, ratings: { ...NEUTRAL_MANAGER.ratings, hitting: 80, pitching: 20 } };

describe('감독 능력치·신뢰도 (4c-2b)', () => {
  it('신뢰도가 높으면 좋은 보정은 커지고 나쁜 보정은 작아진다', () => {
    expect(trustScaled(1, 100)).toBeCloseTo(1.1);
    expect(trustScaled(1, 0)).toBeCloseTo(0.9);
    expect(trustScaled(-1, 100)).toBeCloseTo(-0.9);
    expect(trustScaled(-1, 0)).toBeCloseTo(-1.1);
    expect(ratingBonus(strong, 'hitting')).toBeCloseTo(0.6 * MANAGER.K);
    expect(ratingBonus(strong, 'pitching')).toBeCloseTo(-0.6 * MANAGER.K);
    expect(regressTrust(80)).toBe(65);
  });

  it('경기용 사본: 저장 능력치는 그대로, 장타 확률 반올림의 기대값은 보정과 같다', () => {
    const p = generateWorld(Rng.fromSeed('mgr-world'), 2026).find((x) => !x.isPitcher)!;
    const before = JSON.stringify(p);
    const copies = Array.from({ length: 4000 }, (_, i) => managedPlayer(p, strong, Rng.fromKeys(1, 2, i, 3).next()));
    expect(JSON.stringify(p)).toBe(before);
    expect(copies.every((c) => Number.isInteger(c.batting.power))).toBe(true);
    const mean = copies.reduce((a, c) => a + c.batting.power, 0) / copies.length;
    expect(Math.abs(mean - (p.batting.power + ratingBonus(strong, 'hitting')))).toBeLessThan(0.02);
    expect(copies[0]!.batting.contact).toBeCloseTo(p.batting.contact + ratingBonus(strong, 'hitting'));
    expect(managedPlayer(p, NEUTRAL_MANAGER)).toBe(p);
  });

  it('경기 뒤 신뢰도·최근 결정 갱신, 시즌 마감 AI 감독 교체, 조직 화면 정보 경계', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'mgr-4c2b' });
      const repo = d.saves.repository();
      while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
      // 개막(3월 말) 뒤 정규시즌 경기가 쌓일 때까지
      for (let i = 0; i < 20 && (await call(d, 'game.dashboard')).date < '2027-04-15'; i++) await call(d, 'game.advance', { mode: 'week' });
      const managers = repo.getStaff().filter((s) => s.title === '감독' && s.clubId !== null);
      expect(managers).toHaveLength(10);
      expect(managers.some((m) => (m.manager?.recent.length ?? 0) > 0)).toBe(true);
      expect(managers.some((m) => m.manager!.trust !== 50)).toBe(true);
      expect(checkManagers(repo)).toEqual([]);
      // 조직 화면: 감독 카드는 우리 감독(실제 능력치), 다른 구단 감독 정보는 없다
      const org = await call(d, 'org.view');
      const mine = repo.getStaff(1).find((s) => s.title === '감독')!;
      expect(org.manager?.id).toBe(mine.id);
      expect(org.manager!.ratings.map((r) => r.value)).toEqual(['hitting', 'pitching', 'fieldRun', 'tactics', 'authority', 'leadership', 'condition', 'development'].map((k) => mine.abilities[k]));
      const other = managers.find((m) => m.clubId === 2)!;
      expect(JSON.stringify(org)).not.toContain(`"id":${other.id},`);
      // 시즌 마감: 신뢰도 30 미만 AI 감독은 교체, 우리 감독은 그대로(되돌림만)
      const ai = managers.find((m) => m.clubId === 3)!;
      ai.manager = { ...ai.manager!, trust: 20 };
      const user = repo.getStaff(1).find((s) => s.title === '감독')!;
      user.manager = { ...user.manager!, trust: 90 };
      repo.saveStaff([ai, user]);
      const service = (d as unknown as { game(): { managers: { closeSeason: (m: unknown, date: string) => Array<{ title: string }> } } }).game();
      const inbox = service.managers.closeSeason(repo.getMeta(), repo.getMeta().currentDate);
      expect(inbox.some((m) => m.title.includes('감독 교체'))).toBe(true);
      const now3 = repo.getStaff(3).find((s) => s.title === '감독')!;
      expect(now3.id).not.toBe(ai.id);
      expect(now3.manager!.trust).toBe(50);
      expect(repo.getStaff(1).find((s) => s.title === '감독')!.manager!.trust).toBe(70);
      expect(checkManagers(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
