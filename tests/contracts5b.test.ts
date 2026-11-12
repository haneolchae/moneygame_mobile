// 5b(D-135·D-136·D-137): 모기업 지원금 재협상 배수, 계약 세션 과금(첫 제안만 행동력 1·3회 상한·다른 선수는 새 세션),
// 연장 계약(새 연봉은 다음 시즌 시작부터·계약 연수 연장으로 FA 자격 없음), 국내 무소속 선수 영입
import { describe, expect, it } from 'vitest';
import { CONTRACT } from '../src/engine/config';
import { supportFactorBp } from '../src/engine/finance';
import type { Dispatcher } from '../src/host/dispatcher';
import type { Market } from '../src/game/market';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const EOK = 100_000_000;
const market = (d: Dispatcher) => (d as unknown as { service: { market: Market } }).service.market;

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('계약 확장·재무 (5b)', () => {
  it('지원금 재협상 배수: 적정 범위 유지, 넉넉하면 삭감(하한 0.4), 부족하면 증액(상한 1.2)', () => {
    expect(supportFactorBp(300 * EOK, 300 * EOK)).toBe(10_000);
    expect(supportFactorBp(450 * EOK, 300 * EOK)).toBe(7_000); // R 1.5 → 1 − 1.0 × 0.3 (D-139)
    expect(supportFactorBp(600 * EOK, 300 * EOK)).toBe(2_000); // R 2.0 → 1 − 1.0 × 0.8 = 0.2 (하한 0.2, D-242)
    expect(supportFactorBp(1500 * EOK, 300 * EOK)).toBe(2_000);
    expect(supportFactorBp(150 * EOK, 300 * EOK)).toBe(11_500); // R 0.5 → 1 + 0.5 × 0.3
    expect(supportFactorBp(-100 * EOK, 300 * EOK)).toBe(12_000);
  });

  it('세션 과금·연장 계약·국내 무소속 영입', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'contracts-5b' });
      const repo = d.saves.repository();
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);

      // ⑥ FA 시장: 같은 선수 첫 제안만 행동력 1, 3회 상한(무비용 거부), 다른 선수는 새 세션
      await until(d, '2026-11-17');
      const fa = (await call(d, 'market.view')).fa.filter((f) => f.statusKey === 'approved' && f.originClub.id !== 1);
      const [a, b] = [fa[0]!, fa[1]!];
      const ap0 = await ap();
      for (let i = 0; i < CONTRACT.offersPerSession; i++) {
        const r = await call(d, 'market.faOffer', { playerId: a.playerId, years: 1, salaryWon: 30_000_000 + i * 1_000_000, bonusWon: 0 });
        expect(r.result).not.toBe('accept');
        expect(await ap()).toBe(ap0 - 1);
      }
      const over = await d.respond('market.faOffer', { playerId: a.playerId, years: 1, salaryWon: 40_000_000, bonusWon: 0 });
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.error.code).toBe('CONTRACT_LIMIT');
      expect(await ap()).toBe(ap0 - 1);
      await call(d, 'market.faOffer', { playerId: b.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 });
      expect(await ap()).toBe(ap0 - 2);
      expect((await call(d, 'player.actions', { playerId: a.playerId })).actions.find((x) => x.key === 'faOffer')).toMatchObject({ apCost: 0, enabled: false });

      // ⑤ 연장 계약: 시즌 중 계약 마지막 해 선수, 새 연봉은 다음 시즌 시작부터
      await until(d, '2027-02-02');
      const meta = (d as unknown as { service: { meta: () => { season: number } } }).service.meta();
      const target = repo.getPlayers().find((p) => p.clubId === 1 && p.origin === 'domestic' && p.contractYears === 0 && meta.season - Number(p.birthDate.slice(0, 4)) <= 32)!;
      const av = await call(d, 'player.actions', { playerId: target.id });
      expect(av.actions.find((x) => x.key === 'extensionOffer')?.enabled).toBe(true);
      const dem = av.extension!.demand;
      const oldSalary = target.salary;
      const cash0 = repo.cashBalance(1);
      const offer = { playerId: target.id, years: dem.years, salaryWon: Math.round(dem.salaryWon * 1.1), bonusWon: Math.round(dem.bonusWon * 1.1) };
      const r = await call(d, 'market.extensionOffer', offer);
      expect(r.result).toBe('accept');
      const after = repo.getPlayer(target.id)!;
      expect(after.contractYears).toBe(dem.years); // 마지막 해(0) → 연장 연수: 시즌 마감 FA 자격 조건(남은 연수 0)에서 빠진다
      expect(after.salary).toBe(oldSalary);
      expect(after.nextContract).toEqual({ salary: offer.salaryWon, startSeason: meta.season + 1 });
      expect(repo.cashBalance(1)).toBe(cash0 - offer.bonusWon);
      market(d).onSeasonStart();
      expect(repo.getPlayer(target.id)!.salary).toBe(offer.salaryWon);
      expect(repo.getPlayer(target.id)!.nextContract).toBeUndefined();
      expect((await d.respond('market.extensionOffer', offer)).ok).toBe(false); // 이미 계약이 남았다

      // 국내 무소속 선수: 요구 미만 거절, 요구 이상 계약(2군), 같은 선수 세션은 행동력 1번
      const svcMeta = () => (d as unknown as { service: { meta: () => Parameters<Market['domesticTarget']>[0] } }).service.meta();
      const eligible = (id: number) => {
        try {
          market(d).domesticTarget(svcMeta(), id);
          return true;
        } catch {
          return false;
        }
      };
      const roster = repo.getPlayers().filter((p) => p.clubId === 1).length;
      if (roster >= 40) {
        const cut = repo.getPlayers().find((p) => p.clubId === 1 && p.level === '2군' && p.contractYears === 0)!;
        await call(d, 'market.release', { playerId: cut.id });
      }
      const free = repo.getPlayers().find((p) => p.clubId === null && !p.retired && p.origin === 'domestic' && eligible(p.id))!;
      const dv = await call(d, 'player.actions', { playerId: free.id });
      expect(dv.actions.find((x) => x.key === 'domesticOffer')?.enabled).toBe(true);
      const ap1 = await ap();
      expect((await call(d, 'market.domesticOffer', { playerId: free.id, salaryWon: dv.domestic!.demandWon - 1_000_000 })).result).toBe('reject');
      expect((await call(d, 'market.domesticOffer', { playerId: free.id, salaryWon: dv.domestic!.demandWon })).result).toBe('accept');
      expect(await ap()).toBe(ap1 - 1);
      expect(repo.getPlayer(free.id)).toMatchObject({ clubId: 1, level: '2군', salary: dv.domestic!.demandWon });
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
