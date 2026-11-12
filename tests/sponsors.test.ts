// 6c 스폰서(D-149·D-150): 정산 규칙·업종 독점·슬롯 한도, 체결 비용(행동력 2)·보장액 수령·중복 무비용 거부,
// 고가 티켓 금지 의무, AI 선택, 1/31 기본 계약, 시즌 마감 정산과 계약 종료
import { describe, expect, it } from 'vitest';
import { SPONSOR } from '../src/engine/config';
import { paidOf, paymentPlan, settle, slotReason, type SponsorContract } from '../src/engine/sponsors';
import type { SponsorOps } from '../src/game/sponsors';
import type { GameMeta } from '../src/game/ports';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkBusiness } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

const contract = (over: Partial<SponsorContract>): SponsorContract => ({ id: 'x', slot: 'sub', brand: 'B', industry: '금융', tier: '중', style: 'balanced', season: 2027, guaranteedWon: 1_000_000_000, incentive: { kind: 'postseason', bonusWon: 250_000_000 }, obligation: 'none', signed: '2026-12-08', by: 'owner', ...over });
const facts = { postseason: false, rank: 5, occupancy: 0.7, satisfaction: 50, campaigns: 0 };

describe('스폰서 (6c)', () => {
  it('정산: 인센티브 조건·캠페인 의무 반환, 업종 독점·슬롯 한도', () => {
    expect(settle(contract({}), facts)).toEqual({ incentiveWon: 0, refundWon: 0 });
    expect(settle(contract({}), { ...facts, postseason: true }).incentiveWon).toBe(250_000_000);
    expect(settle(contract({ incentive: { kind: 'top3', bonusWon: 1 } }), { ...facts, rank: 3 }).incentiveWon).toBe(1);
    expect(settle(contract({ incentive: { kind: 'occupancy', bonusWon: 1 } }), { ...facts, occupancy: SPONSOR.occupancyGoal }).incentiveWon).toBe(1);
    expect(settle(contract({ obligation: 'campaigns' }), { ...facts, campaigns: 1 }).refundWon).toBe(200_000_000);
    expect(settle(contract({ obligation: 'campaigns' }), { ...facts, campaigns: 2 }).refundWon).toBe(0);
    const have = [contract({ id: 'a' }), contract({ id: 'b', industry: '통신' }), contract({ id: 'c', industry: '식품' })];
    expect(slotReason(have, contract({ id: 'd', industry: '금융' }))).toContain('업종');
    expect(slotReason(have, contract({ id: 'e', industry: '게임' }))).toContain('서브');
    expect(slotReason(have, contract({ id: 'f', industry: '게임', slot: 'main' }))).toBeNull();
    expect(slotReason(have, contract({ id: 'g', industry: '금융', season: 2028 }))).toBeNull(); // 다른 시즌은 별개
  });

  it('체결 비용·중복 거부·고가 금지, AI 선택·기본 계약, 시즌 마감 정산', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'sponsor-6c' });
      const repo = d.saves.repository();
      const svc = (d as unknown as { service: { sponsors: SponsorOps; meta: () => GameMeta } }).service;
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);
      expect((await call(d, 'business.view')).sponsors.open).toBe(false);
      await until(d, '2026-12-08');
      const v0 = (await call(d, 'business.view')).sponsors;
      expect(v0.open).toBe(true);
      expect(v0.offers.filter((o) => o.slot === 'main')).toHaveLength(SPONSOR.mainOffers);
      expect(v0.offers.filter((o) => o.slot === 'sub')).toHaveLength(SPONSOR.subOffers);

      // 메인 체결: 행동력 2, 체결일 몫 수령(9b-1 지급 방식: 일시불 전액·혼합 선지급·월별 0). 같은 제안·두 번째 메인은 무비용 거부
      const main = v0.offers.find((o) => o.slot === 'main')!;
      const [ap0, cash0] = [await ap(), repo.cashBalance(1)];
      const r = await call(d, 'business.signSponsor', { offerId: main.id });
      expect(await ap()).toBe(ap0 - SPONSOR.signAp);
      const upfront = paymentPlan(svc.meta().sponsorOffers!.find((o) => o.id === main.id)!).upfrontWon;
      expect(repo.cashBalance(1)).toBe(cash0 + upfront);
      expect(r.view.sponsors.contracts).toHaveLength(1);
      const other = v0.offers.find((o) => o.slot === 'main' && o.id !== main.id)!;
      for (const id of [main.id, other.id]) expect((await d.respond('business.signSponsor', { offerId: id })).ok).toBe(false);
      const sameIndustry = r.view.sponsors.offers.find((o) => o.slot === 'sub' && o.industry === main.industry);
      if (sameIndustry) expect(sameIndustry.signReason).toContain('업종');
      expect(await ap()).toBe(ap0 - SPONSOR.signAp);
      expect(repo.cashBalance(1)).toBe(cash0 + upfront);

      // 고가 티켓 금지 의무가 있는 계약이면 고가 정책을 고를 수 없다
      const meta0 = svc.meta();
      repo.updateMeta({ sponsors: { ...meta0.sponsors, '1': [{ ...meta0.sponsors!['1']![0]!, obligation: 'noHighPrice' }] } });
      expect((await d.respond('business.setTicketPolicy', { policy: 'high' })).ok).toBe(false);
      expect((await d.respond('business.setTicketPolicy', { policy: 'low' })).ok).toBe(true);

      // 12/14 AI 선택, 1/31 기본 계약(보장액 90%), 제안 정리
      await until(d, '2027-02-02');
      const meta1 = svc.meta();
      for (const c of repo.getClubs()) if (c.id !== 1) expect(meta1.sponsors![String(c.id)]!.length).toBe(SPONSOR.mainSlots + SPONSOR.subSlots);
      const mine = meta1.sponsors!['1']!;
      expect(mine.filter((c) => c.slot === 'main')).toHaveLength(1);
      expect(mine.some((c) => c.by === 'team')).toBe(true);
      expect(meta1.sponsorOffers).toEqual([]);
      expect((await call(d, 'business.view')).sponsors.open).toBe(false);
      expect(checkBusiness(repo)).toEqual([]);

      // 시즌 마감 정산: 인센티브·반환이 장부와 시즌 합계에 들어가고 그 시즌 계약이 끝난다. 못 받은 월별 몫은 이때 받는다(9b-1)
      const guaranteed = mine.reduce((a, c) => a + c.guaranteedWon, 0);
      const unpaid = mine.reduce((a, c) => a + c.guaranteedWon - paidOf(c), 0);
      expect(meta1.sponsorTotals!['2027']!['1']).toBe(guaranteed);
      const cash1 = repo.cashBalance(1);
      svc.sponsors.settleSeason(svc.meta(), '2027-10-30');
      const meta2 = svc.meta();
      expect(meta2.sponsors!['1']).toEqual([]);
      expect(repo.cashBalance(1) - cash1).toBe(meta2.sponsorTotals!['2027']!['1']! - guaranteed + unpaid);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
