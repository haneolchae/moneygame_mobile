// 9b-1 스폰서 보장액 지급 방식(D-236 (2), 세부 초기안 D-243): 일시불은 체결일 전액, 월별은 계약 시즌 3~10월 월말 균등 분할,
// 혼합은 체결일 선지급 + 나머지 월별. 장부(재정 화면 최근 항목)에 그 날짜로 들어오고, 시즌 마감 때 남은 몫을 받는다.
import { describe, expect, it } from 'vitest';
import { BRANDS } from '../src/engine/brands';
import { SPONSOR } from '../src/engine/config';
import { expectedPaid, generateOffers, paidOf, paymentFactor, paymentPlan, type SponsorContract } from '../src/engine/sponsors';
import { CLUB_PROFILES } from '../src/engine/clubs';
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

const base = { id: 'x', slot: 'sub', brand: 'B', industry: '금융', tier: '중', style: 'balanced', season: 2027, incentive: { kind: 'postseason', bonusWon: 0 }, obligation: 'none', signed: '2027-01-10', by: 'owner' } as const;

describe('스폰서 보장액 지급 방식 (9b-1)', () => {
  it('지급 계획: 합계 = 보장액, 월별 8회, 혼합 선지급 50%, 날짜별 받을 금액', () => {
    const g = 1_234_567_000;
    expect(paymentPlan({ guaranteedWon: g, payment: 'lump' })).toEqual({ upfrontWon: g, monthly: [] });
    expect(paymentPlan({ guaranteedWon: g })).toEqual({ upfrontWon: g, monthly: [] }); // 옛 기록은 일시불
    const m = paymentPlan({ guaranteedWon: g, payment: 'monthly' });
    expect(m.upfrontWon).toBe(0);
    expect(m.monthly.map((x) => x.month)).toEqual(SPONSOR.payment.months);
    expect(m.monthly.reduce((a, x) => a + x.amountWon, 0)).toBe(g);
    const x = paymentPlan({ guaranteedWon: g, payment: 'mixed' });
    expect(x.upfrontWon).toBe(617_000_000);
    expect(x.upfrontWon + x.monthly.reduce((a, y) => a + y.amountWon, 0)).toBe(g);
    const c: SponsorContract = { ...base, guaranteedWon: g, payment: 'mixed' };
    expect(expectedPaid(c, '2027-03-31')).toBe(x.upfrontWon); // 3월 말일은 아직 처리 전
    expect(expectedPaid(c, '2027-04-01')).toBe(x.upfrontWon + x.monthly[0]!.amountWon);
    expect(expectedPaid(c, '2027-11-01')).toBe(g);
    expect(paidOf({ ...c })).toBe(g); // paidWon 없는 옛 기록은 전액 받은 것으로 본다
    // 브랜드 리스트: 스폰서 브랜드마다 지급 방식이 있고 세 방식이 모두 쓰인다
    const sp = BRANDS.filter((b) => b.roles.includes('sponsor'));
    expect(sp.every((b) => b.payment)).toBe(true);
    expect(new Set(sp.map((b) => b.payment))).toEqual(new Set(['lump', 'monthly', 'mixed']));
  });

  it('지급 방식별 금액 배율(D-246): 일시불 0.90~1.00, 월별 1.00~1.20, 혼합 0.95~1.10, 1% 단위·결정적', () => {
    const ranges = { lump: [0.9, 1.0], monthly: [1.0, 1.2], mixed: [0.95, 1.1] } as const;
    for (const [kind, [lo, hi]] of Object.entries(ranges) as Array<[keyof typeof ranges, readonly [number, number]]>) {
      const fs = Array.from({ length: 400 }, (_, i) => paymentFactor('pay-seed', `2028-${i % 10}-sub-${i}`, kind));
      expect(Math.min(...fs)).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...fs)).toBeLessThanOrEqual(hi);
      expect(Math.min(...fs)).toBeCloseTo(lo, 2);
      expect(Math.max(...fs)).toBeCloseTo(hi, 2);
      expect(fs.every((f) => Math.abs(f * 100 - Math.round(f * 100)) < 1e-9)).toBe(true);
    }
    expect(paymentFactor('s', 'x', 'monthly')).toBe(paymentFactor('s', 'x', 'monthly'));
    // 제안의 지급 방식은 브랜드 리스트 값, 같은 시드면 같은 제안
    const club = CLUB_PROFILES[0]!;
    const a = generateOffers('pay-seed', 2028, club, 1, 0, 1);
    expect(generateOffers('pay-seed', 2028, club, 1, 0, 1)).toEqual(a);
    for (const o of a) expect(o.payment).toBe(BRANDS.find((b) => b.name === o.brand)!.payment);
  });

  it('체결일·월말 장부 반영, 재정 화면 최근 항목, 시즌 마감 잔여분, 규칙 검사', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'sponsor-pay-9b1' });
      const repo = d.saves.repository();
      const svc = (d as unknown as { service: { sponsors: SponsorOps; meta: () => GameMeta } }).service;
      await until(d, '2026-12-08');
      // 지급 방식을 정해 둔다: 메인은 월별, 서브는 혼합·일시불을 번갈아(1/31 기본 계약이 이 제안에서 고른다)
      let sub = 0;
      const offers = svc.meta().sponsorOffers!.map((o) => ({ ...o, payment: o.slot === 'main' ? ('monthly' as const) : sub++ % 2 === 0 ? ('mixed' as const) : ('lump' as const) }));
      repo.updateMeta({ sponsorOffers: offers });
      const main = offers.find((o) => o.slot === 'main')!;

      // 월별 메인 체결: 행동력 2, 체결일에는 장부·현금 변화 없음
      const cash0 = repo.cashBalance(1);
      const ledger0 = repo.ledgerEntries(1, 1000).length;
      const r = await call(d, 'business.signSponsor', { offerId: main.id });
      expect(repo.cashBalance(1)).toBe(cash0);
      expect(repo.ledgerEntries(1, 1000).length).toBe(ledger0);
      expect(r.message).toContain('월별');
      const row = r.view.sponsors.contracts.find((c) => c.id === main.id)!;
      expect(row.payment).toContain('월별');
      expect(row.paidWon).toBe(0);

      // 1/31 기본 계약: 혼합은 그날 선지급, 일시불은 그날 전액
      await until(d, '2027-02-02');
      const mine = svc.meta().sponsors!['1']!;
      const entries = () => repo.ledgerEntries(1, 5000).filter((e) => e.category === 'sponsorship');
      for (const c of mine.filter((x) => x.by === 'team')) {
        const plan = paymentPlan(c);
        const got = entries().filter((e) => e.memo.startsWith(c.brand) && e.date === c.signed);
        expect(got.map((e) => e.amount)).toEqual([plan.upfrontWon]);
        expect(c.paidWon).toBe(plan.upfrontWon);
      }
      expect(mine.some((c) => c.payment === 'mixed')).toBe(true);
      expect(checkBusiness(repo)).toEqual([]);

      // 3월 말일: 월별·혼합 계약의 3월분이 그날 장부에, 일시불은 추가 없음. 재정 화면 최근 항목에 보인다
      await until(d, '2027-04-01');
      for (const c of svc.meta().sponsors!['1']!) {
        const plan = paymentPlan(c);
        const march = entries().filter((e) => e.memo.startsWith(c.brand) && e.date === '2027-03-31');
        expect(march.map((e) => e.amount)).toEqual(plan.monthly.length ? [plan.monthly[0]!.amountWon] : []);
        expect(c.paidWon).toBe(expectedPaid(c, '2027-04-01'));
      }
      const fin = await call(d, 'game.finance');
      expect(fin.recent.some((e) => e.date === '2027-03-31' && e.memo.includes(main.brand) && e.memo.includes('3월분'))).toBe(true);
      // AI 구단도 같은 규칙(브랜드별 지급 방식)
      expect(checkBusiness(repo)).toEqual([]);

      // 시즌 마감 정산: 못 받은 월별 몫은 계약 종료 때 한꺼번에 → 계약마다 받은 보장액 합 = 보장액
      const before = svc.meta().sponsors!['1']!;
      const rest = before.reduce((a, c) => a + c.guaranteedWon - paidOf(c), 0);
      expect(rest).toBeGreaterThan(0);
      svc.sponsors.settleSeason(svc.meta(), '2027-04-01');
      for (const c of before) {
        const sum = entries()
          .filter((e) => e.memo.startsWith(c.brand) && (e.memo.includes('보장액')))
          .reduce((a, e) => a + e.amount, 0);
        expect(sum).toBe(c.guaranteedWon);
      }
      expect(svc.meta().sponsors!['1']).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 240_000);
});
