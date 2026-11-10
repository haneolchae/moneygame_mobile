// 6a 관중·티켓·시설(D-141·D-142): 점유율 범위·가격 정책, 착수 비용(행동력 3)·검증 실패 무비용, 지급 합계 = 공사비,
// 완공 뒤에만 효과, 홈경기 관중 ≤ 좌석 수와 입장수입 장부, 가격 정책이 다음 홈경기 가격에 반영
import { describe, expect, it } from 'vitest';
import { campaignBoost, fanDemand, gate, nextSatisfaction, occupancy, planProject, type AttendanceInput } from '../src/engine/business';
import { CLUB_PROFILES } from '../src/engine/clubs';
import { ATTENDANCE, FACILITY, MARKETING } from '../src/engine/config';
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

describe('관중·티켓·시설 (6a)', () => {
  it('점유율 0.2~1.0, 관중 ≤ 좌석 수, 고가는 수요↓·가격↑, 공사 지급 합계 = 공사비', () => {
    const [home, away] = [CLUB_PROFILES[0]!, CLUB_PROFILES[1]!];
    const base: AttendanceInput = { seed: 's', fixtureId: 1, home, away, weekday: 6, wins: 0, losses: 0, priorPct: 0.5, policy: 'normal', stadiumLevel: 1 };
    for (let i = 0; i < 500; i++) {
      const o = occupancy({ ...base, fixtureId: i, weekday: i % 7, wins: i % 30, losses: (i * 7) % 30, stadiumLevel: 1 + (i % 5) });
      expect(o).toBeGreaterThanOrEqual(ATTENDANCE.minOccupancy);
      expect(o).toBeLessThanOrEqual(1);
    }
    const hot = gate({ ...base, wins: 60, losses: 10, stadiumLevel: 5, policy: 'low' }, 1.3);
    expect(hot.attendance).toBeLessThanOrEqual(home.stadiumCapacity);
    const tuesday = { ...base, weekday: 2 };
    const [n, h] = [gate(tuesday, 1), gate({ ...tuesday, policy: 'high' }, 1)];
    expect(h.attendance).toBeLessThan(n.attendance);
    expect(h.ticketWon / h.attendance).toBeGreaterThan(n.ticketWon / n.attendance);
    expect(gate(tuesday, 1)).toEqual(n); // 같은 경기는 같은 관중
    const p = planProject('stadium', 3, '2027-02-01', 1.02);
    expect(p.payments.reduce((a, x) => a + x.amountWon, 0)).toBe(p.costWon);
    expect(p.start).toBe('2027-03-01'); // 지자체 승인 4주
  });

  it('시설 착수·취소·완공 효과, 홈경기 관중·입장수입·가격 정책', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'biz-6a' });
      const repo = d.saves.repository();
      const svc = (d as unknown as { service: { business: { trainingBoost: (id: number) => number } } }).service;
      await until(d, '2027-02-02');
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);
      const v0 = await call(d, 'business.view');
      expect(v0.facilities.map((f) => f.level)).toEqual([1, 1, 1, 1]);

      // 착수: 행동력 3, 같은 시설 중복은 무비용 거부, 착공 전 취소는 무비용
      const ap0 = await ap();
      const cash0 = repo.cashBalance(1);
      const r = await call(d, 'business.startFacility', { kind: 'training' });
      expect(await ap()).toBe(ap0 - FACILITY.startAp);
      expect((await d.respond('business.startFacility', { kind: 'training' })).ok).toBe(false);
      expect(await ap()).toBe(ap0 - FACILITY.startAp);
      const proj = r.view.facilities.find((f) => f.kind === 'training')!.project!;
      await call(d, 'business.startFacility', { kind: 'stadium' });
      expect((await call(d, 'business.cancelFacility', { kind: 'stadium' })).message).toContain('비용 없음');
      expect(repo.cashBalance(1)).toBe(cash0); // 아직 지급 전
      expect(svc.business.trainingBoost(1)).toBe(1); // 완공 전 효과 없음

      // 가격 정책: 행동력 0, 다음 홈경기부터 가격 반영
      const apP = await ap();
      const pv = await call(d, 'business.setTicketPolicy', { policy: 'low' }); // 고가는 스폰서 의무로 막힐 수 있어(6c) 저가로 확인
      expect(await ap()).toBe(apP);
      expect(pv.view.ticket.priceWon).toBeLessThan(v0.ticket.priceWon);

      await until(d, proj.end > '2027-04-20' ? addDay(proj.end) : '2027-04-21');
      const ledger = repo.ledgerEntries(1, 100000);
      const paid = ledger.filter((e) => e.category === 'facilityConstruction').reduce((a, e) => a - e.amount, 0);
      expect(paid).toBe(proj.costWon);
      expect(svc.business.trainingBoost(1)).toBeCloseTo(1 + FACILITY.trainingPerLevel, 9);
      const v1 = await call(d, 'business.view');
      expect(v1.facilities.find((f) => f.kind === 'training')).toMatchObject({ level: 2, project: null });

      // 홈경기: 관중 ≤ 좌석 수, 입장수입·매점·관람료 장부, 바꾼 정책 가격
      const s = v1.seasons[0]!;
      expect(s.games).toBeGreaterThan(3);
      expect(s.average).toBeLessThanOrEqual(v1.club.capacity);
      const tickets = ledger.filter((e) => e.category === 'ticketRevenue');
      expect(tickets).toHaveLength(s.games);
      expect(tickets.reduce((a, e) => a + e.amount, 0)).toBe(s.ticketWon);
      expect(s.ticketWon / s.total).toBeCloseTo(v1.ticket.priceWon, 0);
      const fee = ledger.filter((e) => e.category === 'stadiumGateFee').reduce((a, e) => a - e.amount, 0);
      expect(fee).toBeGreaterThan(s.ticketWon * 0.0999);
      expect(fee).toBeLessThan(s.ticketWon * 0.1001);
      expect(ledger.some((e) => e.category === 'concessions' && e.amount > 0)).toBe(true);
      expect(ledger.some((e) => e.category === 'facilityUpkeep' && e.amount < 0)).toBe(true);
      // 모든 구단의 홈경기가 집계되고 리그 평균 점유율은 우리 구단 값과 따로 계산된다
      const att = repo.getMeta().attendance!['2027']!;
      expect(Object.values(att).filter((t) => t.games > 0)).toHaveLength(10);
      expect(s.leagueOccupancy).not.toBeNull();
      expect(Math.abs(s.leagueOccupancy! - s.occupancy)).toBeGreaterThan(0.0001);
      expect(checkBusiness(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});

describe('팬 만족도·캠페인 (6b)', () => {
  it('만족도 수요 배수·주간 이동·캠페인 합계 상한', () => {
    expect(fanDemand(50)).toBe(1);
    expect(fanDemand(100)).toBeCloseTo(1 + MARKETING.demandSlope, 9);
    expect(fanDemand(19.9)).toBe(MARKETING.backlashDemand);
    expect(nextSatisfaction(50, 0.6, '보통', 0)).toBe(51); // 목표 60으로 차이의 10%
    expect(nextSatisfaction(50, 0.0, '보통', 0)).toBeGreaterThanOrEqual(0);
    const all = (['family', 'local', 'online', 'fanEvent'] as const).map((kind) => ({ kind, start: '2027-04-01', end: '2027-04-30', costWon: 1 }));
    expect(campaignBoost(all)).toEqual({ demand: 0.06, satisfaction: MARKETING.maxSatisfactionBoost });
  });

  it('캠페인 착수 비용·중복 거부, AI 캠페인, 팬 반발 경고·회복·해임', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'fans-6b' });
      const repo = d.saves.repository();
      await until(d, '2027-04-05'); // 월요일: 주 단위 진행이 월요일 처리(주간 팬 갱신)부터 시작
      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);
      const v0 = await call(d, 'business.view');
      expect(Object.values(repo.getMeta().fans!)).toHaveLength(10);
      expect(checkBusiness(repo)).toEqual([]);
      // AI 구단은 시즌 첫 월요일에 캠페인을 실행한다. 우리 구단은 자동 실행 없음
      const aiRuns = Object.entries(repo.getMeta().campaigns!).filter(([id, list]) => id !== '1' && list.map((c) => c.kind).sort().join() === 'family,online');
      expect(aiRuns.length).toBeGreaterThan(0); // 현금 여유(시작 현금 × 0.9 이상)가 있는 구단만
      expect(repo.getMeta().campaigns!['1'] ?? []).toHaveLength(0);

      const [ap0, cash0] = [await ap(), repo.cashBalance(1)];
      const cost = v0.campaigns.find((c) => c.kind === 'family')!.costWon;
      const r = await call(d, 'business.startCampaign', { kind: 'family' });
      expect(await ap()).toBe(ap0 - MARKETING.campaignAp);
      expect(repo.cashBalance(1)).toBe(cash0 - cost);
      expect(r.view.campaigns.find((c) => c.kind === 'family')!.active).not.toBeNull();
      expect((await d.respond('business.startCampaign', { kind: 'family' })).ok).toBe(false);
      expect(await ap()).toBe(ap0 - MARKETING.campaignAp);
      expect(repo.cashBalance(1)).toBe(cash0 - cost);

      // 팬 반발: 20 미만이면 경고와 시작일 기록, 25 이상 회복하면 해제, 8주 미회복이면 해임
      const setFan = (f: { satisfaction: number; lowSince?: string }) => repo.updateMeta({ fans: { ...repo.getMeta().fans!, '1': f } });
      setFan({ satisfaction: 8 });
      await call(d, 'game.advance', { mode: 'week' });
      const low = repo.getMeta().fans!['1']!;
      expect(low.satisfaction).toBeLessThan(MARKETING.backlashBelow);
      expect(low.lowSince).toBeDefined();
      expect((await call(d, 'business.view')).fans).toMatchObject({ backlash: true });
      setFan({ satisfaction: 60, lowSince: low.lowSince! });
      await call(d, 'game.advance', { mode: 'week' });
      expect(repo.getMeta().fans!['1']!.lowSince).toBeUndefined();
      expect(repo.getMeta().gameOver).toBeUndefined();
      setFan({ satisfaction: 5, lowSince: '2027-02-01' });
      const end = await call(d, 'game.advance', { mode: 'week' });
      expect(end.stoppedReason).toContain('해임'); // 그날에서 멈추고 이유를 알린다
      expect(repo.getMeta().gameOver).toMatchObject({ kind: 'dismissed' });
      expect((await d.respond('game.advance', { mode: 'week' })).ok).toBe(false);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});

function addDay(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
