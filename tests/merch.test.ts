// 6d 굿즈·브랜드 리스트(D-152·D-153·D-154): 리스트 규격 검사, 입고 전 판매 없음·이동평균 원가·재고 한도 판매·재주문 수량,
// 제작업체 선택(행동력 2·후원금), 자동 재주문과 판매 장부, 수동 발주 지급·공급 기간, 최소 발주량 무비용 거부
import { describe, expect, it } from 'vitest';
import { BRAND_ERRORS, BRANDS, parseBrands } from '../src/engine/brands';
import { MERCH } from '../src/engine/config';
import { newMerch, receive, reorderQty, sell, unitCost } from '../src/engine/merch';
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

describe('굿즈·브랜드 리스트 (6d)', () => {
  it('브랜드 리스트 규격: 현재 파일 오류 0건, 잘못된 항목은 건너뛰고 오류로 남긴다', () => {
    expect(BRAND_ERRORS).toEqual([]);
    expect(BRANDS.length).toBeGreaterThanOrEqual(16);
    const ok = { id: 'a-1', name: '가', category: 'general', industry: '금융', awareness: '상', audience: '전 연령', roles: ['sponsor'] };
    const r = parseBrands([ok, { ...ok }, { ...ok, id: 'B' }, { ...ok, id: 'c', awareness: '최상' }, { ...ok, id: 'd', roles: [] }, { ...ok, id: 'e', traits: { incentives: ['win'] } }, { ...ok, id: 'f', traits: { style: { performance: 2 }, obligations: ['none'], note: '성과형' } }]);
    expect(r.brands.map((b) => b.id)).toEqual(['a-1', 'f']);
    expect(r.errors).toHaveLength(5);
    expect(parseBrands({}).errors).toHaveLength(1);
  });

  it('입고·이동평균 원가·재고 한도 판매·재주문 수량', () => {
    const s = newMerch(2027);
    s.orders.push({ sku: 'cap', qty: 100, unitCostWon: 10_000, arrive: '2027-03-10' });
    expect(sell(s, 'cap', 50, 35_000, 2027)).toBe(0); // 입고 전에는 팔 수 없다
    expect(receive(s, '2027-03-09', 2027).cap).toBe(0);
    expect(receive(s, '2027-03-10', 2027).cap).toBe(100);
    s.orders.push({ sku: 'cap', qty: 100, unitCostWon: 20_000, arrive: '2027-03-11' });
    receive(s, '2027-03-11', 2027);
    expect(s.stock.cap).toEqual({ qty: 200, avgCostWon: 15_000 });
    expect(sell(s, 'cap', 500, 35_000, 2027)).toBe(200 * 35_000); // 재고까지만
    expect(s.stock.cap.qty).toBe(0);
    expect(s.totals['2027']!.cap).toMatchObject({ sold: 200, cogsWon: 200 * 15_000, received: 200 });
    // 재주문: 최근 평균 100개/주 × 4주 − 재고 0 − 입고 예정 150 = 250
    s.recent = [{ uniform: 0, cap: 100, cheer: 0 }];
    s.orders.push({ sku: 'cap', qty: 150, unitCostWon: 1, arrive: '2027-04-01' });
    expect(reorderQty(s, 'cap', 100)).toBe(250);
    s.orders.push({ sku: 'cap', qty: 400, unitCostWon: 1, arrive: '2027-04-01' });
    expect(reorderQty(s, 'cap', 100)).toBe(0);
  });

  it('제작업체 선택·자동 재주문·판매 장부·수동 발주', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'merch-6d' });
      const repo = d.saves.repository();
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);
      await until(d, '2026-12-08');
      const v0 = (await call(d, 'business.view')).merch;
      expect(v0.vendorOpen).toBe(true);
      const partner = v0.vendorOptions.find((o) => o.kind === 'brand')!;
      const [ap0, cash0] = [await ap(), repo.cashBalance(1)];
      const r = await call(d, 'business.chooseVendor', { kind: 'brand', brandId: partner.brandId! });
      expect(await ap()).toBe(ap0 - MERCH.vendorAp);
      expect(repo.cashBalance(1)).toBe(cash0 + partner.feeWon);
      expect(r.view.merch.nextVendor).toContain('스포츠 브랜드');
      expect((await d.respond('business.chooseVendor', { kind: 'standard' })).ok).toBe(false);
      expect(await ap()).toBe(ap0 - MERCH.vendorAp);

      await until(d, '2027-04-20');
      const m = (await call(d, 'business.view')).merch;
      expect(m.vendor).toBe(partner.label);
      expect(m.skus.every((x) => x.sold > 0)).toBe(true); // 개막 전 자동 발주가 입고돼 팔렸다
      const ledger = repo.ledgerEntries(1, 100000);
      expect(ledger.filter((e) => e.category === 'merchSales').reduce((a, e) => a + e.amount, 0)).toBe(m.skus.reduce((a, x) => a + x.revenueWon, 0));
      expect(ledger.some((e) => e.category === 'merchOrder' && e.amount < 0)).toBe(true);
      const uni = m.skus.find((x) => x.sku === 'uniform')!;
      expect(uni.unitCostWon).toBe(unitCost('uniform', 'brand', uni.priceWon / MERCH.skus.uniform.priceWon));

      // 수동 발주: 행동력 0, 지급은 지금, 입고는 공급 기간 뒤. 최소 발주량 미만은 무비용 거부
      const [ap1, cash1] = [await ap(), repo.cashBalance(1)];
      expect((await d.respond('business.orderMerch', { sku: 'uniform', qty: uni.minOrder - 1 })).ok).toBe(false);
      const o = await call(d, 'business.orderMerch', { sku: 'uniform', qty: 300 });
      expect(await ap()).toBe(ap1);
      expect(repo.cashBalance(1)).toBe(cash1 - 300 * uni.unitCostWon);
      const after = o.view.merch.skus.find((x) => x.sku === 'uniform')!;
      expect(after.stock).toBe(uni.stock);
      expect(after.onOrder).toBe(uni.onOrder + 300);
      expect((await call(d, 'business.setMerchPolicy', { auto: false, targetWeeks: 6 })).view.merch).toMatchObject({ auto: false, targetWeeks: 6 });
      expect(checkBusiness(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
