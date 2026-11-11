// 6e 예산 배분·특별 운영회의(D-177·D-178): ① 기본 배수의 운영비 장부가 6e 전과 같다 ② 한도를 넘는 지출은 직접·위임 모두 비용 없이 거부
// ③ 운영비 배수 효과 ④ 특별 운영회의(주 1회·행동력 1, 보고 수치 = 원장·명단, 회의 없는 주에는 이번 예산 수정 불가)
import { describe, expect, it } from 'vitest';
import { defaultPlan, medicalBonus, scoutingFactor, trainingFactor } from '../src/engine/budget';
import { scheduledEntries, type FinanceContext } from '../src/engine/finance';
import { clubById } from '../src/engine/clubs';
import type { Dispatcher } from '../src/host/dispatcher';
import type { BudgetView } from '../src/shared/protocol';
import { checkBudget } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const ctx = (ops?: FinanceContext['ops']): FinanceContext => ({ date: '2027-04-30', seasonYear: 2027, inflationBp: { '2027': 250 }, club: clubById(1), salaries: [1e8, 2e8], releasedSalaries: [], staffPayroll: 50e8, homeGamesToday: 1, ...(ops ? { ops } : {}) });

describe('예산 배분·특별 운영회의 (6e)', () => {
  it('① 기본 배수 장부 = 6e 전, ③ 운영비 배수 효과', () => {
    expect(scheduledEntries(ctx({ scouting: 1, futures: 1, teamOps: 1 }))).toEqual(scheduledEntries(ctx()));
    const amt = (ops: FinanceContext['ops'], c: string) => scheduledEntries(ctx(ops)).find((e) => e.category === c)!.amount;
    expect(amt({ scouting: 1, futures: 2, teamOps: 1 }, 'futuresOps') / amt(undefined, 'futuresOps')).toBeCloseTo(2, 3);
    expect(amt({ scouting: 0.5, futures: 1, teamOps: 1 }, 'analysisScouting') / amt(undefined, 'analysisScouting')).toBeCloseTo(0.5, 3);
    expect(scoutingFactor(2)).toBeCloseTo(0.94);
    expect(scoutingFactor(0.5)).toBeCloseTo(1.06);
    expect(trainingFactor(2)).toBeCloseTo(1.06);
    expect(medicalBonus(2)).toBeCloseTo(0.04);
    expect(medicalBonus(0.5)).toBeCloseTo(-0.04);
    expect(medicalBonus(1)).toBe(0);
  });

  it('② 한도 거부(직접·위임, 비용 없음), ③ 예산안이 효과로 연결, ④ 특별 운영회의', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'budget-6e' });
      const repo = d.saves.repository();
      const svc = (d as unknown as { game(): { budget: { trainingFactor(id: number): number; medicalBonus(id: number): number }; org: { scoutingScale(m: unknown): number }; market: { domesticOffer(m: unknown, s: unknown, id: number, w: number): unknown } } }).game();
      const ap = async () => (await call(d, 'game.dashboard')).owner.apRemaining;
      const cash = () => repo.cashBalance(1);
      const v0 = await call(d, 'budget.view');
      const year = v0.current.year;
      const plan = (v: BudgetView['current']) => ({ year: v.year, ops: Object.fromEntries(v.ops.map((o) => [o.kind, o.multiplier])) as { scouting: number; futures: number; teamOps: number }, caps: Object.fromEntries(v.caps.map((c) => [c.kind, c.limitWon])) as { payroll: number; facility: number; marketing: number; merch: number } });

      // ④ 회의 없이 이번 예산 연도 수정은 거부(비용 없음)
      const ap0 = await ap();
      const r0 = await d.respond('budget.set', { ...plan(v0.current), caps: { ...plan(v0.current).caps, marketing: 0 } });
      expect(r0.ok ? '' : r0.error.code).toBe('MEETING_REQUIRED');
      expect(await ap()).toBe(ap0);

      // ④ 특별 운영회의: 행동력 1, 같은 주 두 번째는 거부. 보고 수치 = 원장·명단
      const m = await call(d, 'meeting.convene');
      expect(await ap()).toBe(ap0 - 1);
      const again = await d.respond('meeting.convene', undefined);
      expect(again.ok ? '' : again.error.code).toBe('DUPLICATE');
      expect(await ap()).toBe(ap0 - 1);
      const rep = m.view.meeting.latest!;
      expect(rep.cashWon).toBe(cash());
      expect(rep.payrollWon).toBe(repo.getPlayers().filter((p) => p.clubId === 1 && !p.retired).reduce((a, p) => a + p.salary, 0));
      const spent = (c: string) => 0 - (repo.ledgerByCategory(1, year).find((r) => r.category === c)?.amount ?? 0);
      expect(rep.execution.find((x) => x.cap === 'marketing')!.used).toBe(spent('marketing'));
      expect(rep.items.length).toBeGreaterThanOrEqual(6);

      // 회의 뒤 이번 예산 수정(무료): 캠페인·시설 한도 0, 스카우트·2군·선수단 배수 2
      const ap1 = await ap();
      const scale0 = svc.org.scoutingScale(repo.getMeta());
      const set = await call(d, 'budget.set', { year, ops: { scouting: 2, futures: 2, teamOps: 0.5 }, caps: { ...plan(v0.current).caps, marketing: 0, facility: 0 } });
      expect(set.apCharged).toBe(0);
      expect(await ap()).toBe(ap1);
      // ③ 효과 연결
      expect(svc.org.scoutingScale(repo.getMeta()) / scale0).toBeCloseTo(0.94, 5);
      expect(svc.budget.trainingFactor(1)).toBeCloseTo(1.06);
      expect(svc.budget.medicalBonus(1)).toBeCloseTo(-0.04);

      // ② 직접 실행 거부: 캠페인·시설(비용 없음)
      const cash1 = cash();
      for (const [name, payload] of [
        ['business.startCampaign', { kind: 'local' }],
        ['business.startFacility', { kind: 'training' }],
      ] as const) {
        const r = await d.respond(name, payload as never);
        expect(r.ok ? '' : r.error.code).toBe('BUDGET_OVER');
      }
      expect(await ap()).toBe(ap1);
      expect(cash()).toBe(cash1);

      // 다음 시즌 예산안(스토브리그): 그 주 첫 확정 행동력 1, 같은 주 수정 무료. 연봉 한도를 아주 낮게
      const next = (await call(d, 'budget.view')).planning!;
      const p1 = await call(d, 'budget.set', { ...plan(next), caps: { ...plan(next).caps, payroll: 100_000_000 } });
      expect(p1.apCharged).toBe(1);
      const p2 = await call(d, 'budget.set', { ...plan(next), caps: { ...plan(next).caps, payroll: 100_000_000 }, ops: { scouting: 1, futures: 1.5, teamOps: 1 } });
      expect(p2.apCharged).toBe(0);
      expect(await ap()).toBe(ap1 - 1);

      // ② 연봉 한도: 거래 기간(11/13~)이 열린 뒤, 위임 경로(같은 도메인 함수)도 비용 없이 거부. 트레이드는 연봉이 느는 안을 거부
      await call(d, 'game.advance', { mode: 'week' });
      const p3 = await call(d, 'budget.set', { ...plan(next), caps: { ...plan(next).caps, payroll: 100_000_000 } });
      expect(p3.apCharged).toBe(1);
      // 시험 준비: 우리 선수 한 명을 명단에서 빼 40명 이하로 만든다(무소속 영입의 명단 조건을 비켜 연봉 한도만 보이게)
      const spare = repo.getPlayers().find((p) => p.clubId === 1 && p.level === '2군' && !p.isPitcher)!;
      repo.savePlayers([{ ...spare, clubId: null }]);
      const free = repo.getPlayers().find((p) => p.clubId === null && !p.retired && p.origin === 'domestic' && p.id !== spare.id && !(repo.getFa(repo.getMeta().season).some((e) => e.playerId === p.id)))!;
      const ap2 = await ap();
      const before = cash();
      expect(() => svc.market.domesticOffer(repo.getMeta(), { kind: 'delegated' }, free.id, 50_000_000)).toThrow(/연봉 총액 한도/);
      const theirs = repo.getPlayers().filter((p) => p.clubId === 2 && !p.retired).sort((a, b) => b.salary - a.salary)[0]!;
      const tr = await d.respond('trade.propose', { clubId: 2, commandId: 'budget-trade-1', give: [], get: [theirs.id], cashWon: 0 });
      expect(tr.ok ? '' : tr.error.message).toMatch(/연봉 총액 한도/);
      expect(cash()).toBe(before);
      expect(await ap()).toBe(ap2);
      expect(repo.getPlayer(free.id)!.clubId).toBeNull();
      expect(defaultPlan(2027, 1, 'x').caps.payroll).toBeGreaterThan(150e8);
      expect(checkBudget(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 120_000);
});

export type { Dispatcher };
