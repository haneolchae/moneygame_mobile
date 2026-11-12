// 7c 반복 조작 점검: 같은 명령을 두 번 누르거나(더블 클릭), 같은 요청을 다시 보내거나, 같은 commandId로 재전송해도
// 비용(행동력·현금·처리량)과 효과가 두 번 적용되지 않는다. 검증 실패는 비용 없음, 같은 날짜는 두 번 처리하지 않는다(공통 구현 계약).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allStarDates } from '../src/engine/allStar';
import { addDays } from '../src/engine/calendar';
import { ALLSTAR, FACILITY, MARKETING, SPONSOR, TRADE, TRAINING } from '../src/engine/config';
import { ORG_AP } from '../src/game/organization';
import { SCOUTING } from '../src/engine/scoutingConfig';
import { Rng } from '../src/engine/rng';
import { makeStaff } from '../src/engine/staff';
import type { PlayerTruth } from '../src/engine/types';
import type { GameMeta, TradeOffer } from '../src/game/ports';
import type { TradeOps } from '../src/game/trade';
import type { Dispatcher } from '../src/host/dispatcher';
import type { BudgetView, RequestMap, RequestName } from '../src/shared/protocol';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const CLUB = 5;
type Svc = { trades: TradeOps; meta: () => GameMeta };
const svc = (d: Dispatcher) => (d as unknown as { game(): Svc }).game();
const repoOf = (d: Dispatcher) => d.saves.repository();
const ap = async (d: Dispatcher) => (await call(d, 'game.dashboard')).owner.apRemaining;
const cash = (d: Dispatcher) => repoOf(d).cashBalance(CLUB);
/** 비용·효과 관찰값: 행동력, 현금, 장부 건수, 난수 상태 */
async function snap(d: Dispatcher) {
  const repo = repoOf(d);
  return { ap: await ap(d), cash: cash(d), ledger: repo.ledgerEntries(CLUB, 100000).length, rng: JSON.stringify(repo.getMeta().rngStreams) };
}
/** 실패해야 하는 재요청: 오류 코드를 돌려준다 */
async function fails<K extends RequestName>(d: Dispatcher, name: K, payload: RequestMap[K]['payload']): Promise<string> {
  const r = await d.respond(name, payload);
  if (r.ok) throw new Error(`${name}: 두 번째 요청이 성공했습니다(중복 적용)`);
  return r.error.code;
}
async function until(d: Dispatcher, date: string, onDay?: (d: Dispatcher) => Promise<void>) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    if (onDay) await onDay(d);
    await call(d, 'game.advance', { mode: dash.phase === 'stove' || addDays(dash.date, 7) <= date ? 'week' : 'day' });
  }
}
const plan = (v: BudgetView['current']) => ({
  year: v.year,
  ops: Object.fromEntries(v.ops.map((o) => [o.kind, o.multiplier])) as { scouting: number; futures: number; teamOps: number },
  caps: Object.fromEntries(v.caps.map((c) => [c.kind, c.limitWon])) as { payroll: number; facility: number; marketing: number; merch: number },
});

// 한 게임을 이어서 쓴다(시험 순서대로 실행): 스토브리그 1턴 → 2턴 → 턴 회의 카드 → 2/2 시즌 → 올스타 투표
describe('반복 조작 점검 (7c) — 스토브리그 시작 한 게임', () => {
  const dir = tempDir();
  const d = makeDispatcher(dir);
  beforeAll(async () => {
    await call(d, 'game.new', { clubId: CLUB, saveName: 't', seed: 'repeat-7c' });
  }, 180_000);
  afterAll(() => {
    d.close();
    cleanup(dir);
  });

  it('스토브리그 1턴: 채용·유치 신청·운영회의·예산안·조사·훈련·트레이드 commandId·FA 같은 조건', async () => {
    const repo = repoOf(d);

    // ── org.hire: 같은 후보 두 번 → 행동력 2 한 번, 두 번째는 시장에 없는 후보(무비용)
    let org = await call(d, 'org.view');
    const vacant = org.teams.filter((t) => !t.leader).map((t) => t.key);
    let cand = org.candidates.find((c) => c.title === '팀장' && c.teamKey !== null && vacant.includes(c.teamKey));
    if (!cand) {
      const s = makeStaff(Rng.fromSeed('rep'), repo.nextStaffId(), '팀장', null, { team: vacant[0] as never, division: 'baseball', mean: 60 });
      repo.saveStaff([s]);
      org = await call(d, 'org.view');
      cand = org.candidates.find((c) => c.id === s.id)!;
    }
    let s0 = await snap(d);
    await call(d, 'org.hire', { staffId: cand.id });
    let s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - ORG_AP.hire);
    expect(await fails(d, 'org.hire', { staffId: cand.id })).toBe('NOT_AVAILABLE');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getStaff(CLUB).filter((x) => x.id === cand!.id)).toHaveLength(1);

    // ── allStar.apply: 같은 시즌 두 번 → 행동력 한 번
    s0 = await snap(d);
    await call(d, 'allStar.apply', {});
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - ALLSTAR.applyAp);
    expect(await fails(d, 'allStar.apply', {})).toBe('INVALID');
    expect(await snap(d)).toEqual(s1);

    // ── meeting.convene: 같은 주 두 번 → 행동력 1 한 번, 회의 기록 1건
    s0 = await snap(d);
    await call(d, 'meeting.convene', undefined);
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - 1);
    expect(await fails(d, 'meeting.convene', undefined)).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getMeta().meetings!.filter((m) => m.date === '2026-11-08')).toHaveLength(1);

    // ── budget.set: 같은 주 같은 다음 시즌 예산안 두 번 → 행동력 1 한 번(두 번째 apCharged 0), 결과는 같은 예산안
    const next = (await call(d, 'budget.view')).planning!;
    const p = plan(next);
    s0 = await snap(d);
    const paid0 = (repo.getMeta().budgetPlanWeeks ?? []).length;
    const b1 = await call(d, 'budget.set', p);
    const b2 = await call(d, 'budget.set', p);
    expect([b1.apCharged, b2.apCharged]).toEqual([1, 0]);
    expect(await ap(d)).toBe(s0.ap - 1);
    expect(repo.getMeta().budgetPlanWeeks!.length).toBe(paid0 + 1);
    expect(b2.view.planning).toEqual(b1.view.planning);

    // ── player.scout: 28일 안에 두 번 → 행동력 1 한 번, 관측 기록 1건. 한 주 뒤에도(28일 안) 무비용 거부
    const other = repo.getPlayers().find((x) => x.clubId === 3 && !x.retired)!;
    s0 = await snap(d);
    await call(d, 'player.scout', { playerId: other.id });
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - SCOUTING.ap);
    const scoutRows = () => repo.getScouting(CLUB).filter((x) => x.playerId === other.id);
    const scoutRow = JSON.stringify(scoutRows());
    expect(await fails(d, 'player.scout', { playerId: other.id })).toBe('DUPLICATE_EVIDENCE');
    expect(await snap(d)).toEqual(s1);
    expect(JSON.stringify(scoutRows())).toBe(scoutRow);

    // ── player.train: 같은 계획 두 번 → 행동력 1 한 번, 시작일 그대로
    const own = repo.getPlayers().find((x) => x.clubId === CLUB && !x.isPitcher && !x.retired && !x.health?.injury)!;
    const req = { playerId: own.id, primary: 'power', secondary: 'contact', intensity: 'normal' as const };
    s0 = await snap(d);
    await call(d, 'player.train', req);
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - TRAINING.directAp);
    const plan1 = JSON.stringify(repo.getPlayer(own.id)!.training);
    expect(await fails(d, 'player.train', req)).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);
    expect(JSON.stringify(repo.getPlayer(own.id)!.training)).toBe(plan1);

    // ── 트레이드(거래 기간 11/13~)
    await until(d, '2026-11-16');
    // 한 주 뒤(아직 28일 안) 같은 선수 재조사도 무비용 거부
    s0 = await snap(d);
    expect(await fails(d, 'player.scout', { playerId: other.id })).toBe('DUPLICATE_EVIDENCE');
    expect(await snap(d)).toEqual(s0);
    expect(SCOUTING.cooldownDays).toBeGreaterThan(8);

    const s = svc(d);
    const meta = s.meta();
    const tradable = (x: PlayerTruth, c: number) => s.trades.tradableReason(meta, x, c) === null;
    const players = repo.getPlayers();
    const ours = players.filter((x) => x.clubId === CLUB && tradable(x, CLUB));
    const used = new Set<number>();
    const find = (club: number, kind: string) => {
      const theirs = players.filter((x) => x.clubId === club && tradable(x, club));
      for (const a of ours) for (const b of theirs) {
        if (used.has(a.id) || used.has(b.id)) continue;
        const pkg = { give: [a.id], get: [b.id], cashWon: 0 };
        if (s.trades.evaluate(meta, club, pkg).decision.kind !== kind) continue;
        if (s.trades.validate(meta, club, pkg).errors.length) continue;
        used.add(a.id).add(b.id);
        return pkg;
      }
      return null;
    };
    const rejectPkg = find(6, 'reject')!;
    const counterPkg = find(6, 'counter');
    let offerClub = 0;
    let offerPkg: { give: number[]; get: number[]; cashWon: number } | null = null;
    for (const c of [7, 8, 9, 10, 1, 2, 3, 4]) {
      offerPkg = find(c, 'accept');
      if (offerPkg) {
        offerClub = c;
        break;
      }
    }
    expect(rejectPkg).toBeTruthy();
    const history = () => (svc(d).meta().tradeHistory ?? []).length;
    const logCount = (id: string) => (svc(d).meta().actionLog ?? []).filter((e) => e.commandId === id).length;

    // trade.propose 같은 commandId 두 번: 같은 결과, 행동력 1 한 번, 제안 횟수 1회만 소모
    s0 = await snap(d);
    const r1 = await call(d, 'trade.propose', { clubId: 6, ...rejectPkg, commandId: 'rep-propose-1' });
    const r2 = await call(d, 'trade.propose', { clubId: 6, ...rejectPkg, commandId: 'rep-propose-1' });
    expect(r1.apCharged).toBe(TRADE.sessionAp);
    expect(r2).toMatchObject({ result: r1.result, message: r1.message, apCharged: 0 });
    expect(r2.view.session.proposalsLeft).toBe(TRADE.proposalsPerSession - 1);
    expect(await ap(d)).toBe(s0.ap - TRADE.sessionAp);
    expect(logCount('rep-propose-1')).toBe(1);
    // 같은 날 같은 교환안을 새 commandId로: 무비용 거부(D-118과 같은 규칙)
    s1 = await snap(d);
    expect(await fails(d, 'trade.propose', { clubId: 6, ...rejectPkg, commandId: 'rep-propose-2' })).toBe('DUPLICATE_OFFER');
    expect(await snap(d)).toEqual(s1);

    // 더블 클릭(동시 두 요청, 같은 commandId) → 한 번만 처리
    if (counterPkg) {
      const [c1, c2] = await Promise.all([
        d.respond('trade.propose', { clubId: 6, ...counterPkg, commandId: 'rep-counter-1' }),
        d.respond('trade.propose', { clubId: 6, ...counterPkg, commandId: 'rep-counter-1' }),
      ]);
      expect(c1.ok && c2.ok).toBe(true);
      if (c1.ok && c2.ok) {
        expect(c1.result.result).toBe('counter');
        expect(c2.result.message).toBe(c1.result.message);
        expect(c2.result.view.session.proposalsLeft).toBe(TRADE.proposalsPerSession - 2);
      }
      expect(logCount('rep-counter-1')).toBe(1);
      // trade.acceptCounter 같은 commandId 두 번: 이적·현금 한 번
      const h0 = history();
      s0 = await snap(d);
      const a1 = await call(d, 'trade.acceptCounter', { clubId: 6, commandId: 'rep-accept-1' });
      const s2 = await snap(d);
      const a2 = await call(d, 'trade.acceptCounter', { clubId: 6, commandId: 'rep-accept-1' });
      expect(a1.result).toBe('accept');
      expect(a2).toMatchObject({ result: 'accept', message: a1.message, apCharged: 0 });
      expect(s2.ap).toBe(s0.ap);
      expect(await snap(d)).toEqual(s2);
      expect(history()).toBe(h0 + 1);
      expect(repo.getPlayer(counterPkg.give[0]!)!.clubId).toBe(6);
      expect(repo.getPlayer(counterPkg.get[0]!)!.clubId).toBe(CLUB);
      // 새 commandId로 다시 수락: 역제안이 없으니 무비용 거부
      expect(await fails(d, 'trade.acceptCounter', { clubId: 6, commandId: 'rep-accept-2' })).toBe('NOT_AVAILABLE');
      expect(await snap(d)).toEqual(s2);
    } else console.log('[7c] 역제안 교환안이 없어 acceptCounter 반복은 건너뜀');

    // trade.respondOffer 같은 commandId 두 번: 받은 제안(시험 준비로 넣은 수락 가능 안) 수락 → 세션 행동력·이적 한 번
    if (offerPkg) {
      const m = svc(d).meta();
      const offer: TradeOffer = { id: 9001, clubId: offerClub, date: m.currentDate, expires: addDays(m.currentDate, 6), season: m.season, period: 'stove', pkg: offerPkg, status: 'open', audit: { give: 0, get: 0 } };
      repo.updateMeta({ tradeOffers: [...(m.tradeOffers ?? []), offer] });
      const h0 = history();
      s0 = await snap(d);
      const o1 = await call(d, 'trade.respondOffer', { offerId: 9001, accept: true, commandId: 'rep-offer-1' });
      const s2 = await snap(d);
      const o2 = await call(d, 'trade.respondOffer', { offerId: 9001, accept: true, commandId: 'rep-offer-1' });
      expect(o1.result).toBe('accept');
      expect(o1.apCharged).toBe(TRADE.sessionAp);
      expect(o2).toMatchObject({ result: 'accept', message: o1.message, apCharged: 0 });
      expect(s2.ap).toBe(s0.ap - TRADE.sessionAp);
      expect(await snap(d)).toEqual(s2);
      expect(history()).toBe(h0 + 1);
      expect(repo.getPlayer(offerPkg.get[0]!)!.clubId).toBe(CLUB);
      expect(logCount('rep-offer-1')).toBe(1);
      // 같은 제안을 새 commandId로: 이미 처리한 제안이라 무비용 거부
      expect(await fails(d, 'trade.respondOffer', { offerId: 9001, accept: true, commandId: 'rep-offer-2' })).toBe('NOT_AVAILABLE');
      expect(await snap(d)).toEqual(s2);
    } else console.log('[7c] 수락 가능한 교환안이 없어 respondOffer 반복은 건너뜀');

    // ── market.faOffer: 같은 날 같은 조건 두 번 → 행동력 1 한 번, 제안 기록 1건(D-118)
    await until(d, '2026-11-22');
    const target = (await call(d, 'market.view')).fa.find((f) => f.statusKey === 'approved' && f.originClub.id !== CLUB)!;
    expect(target).toBeTruthy();
    const low = { playerId: target.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 };
    s0 = await snap(d);
    const f1 = await call(d, 'market.faOffer', low);
    expect(f1.result).not.toBe('accept');
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - 1);
    expect(await fails(d, 'market.faOffer', low)).toBe('DUPLICATE_OFFER');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getOffers({ playerId: target.playerId, clubId: CLUB, kind: 'fa' }).filter((o) => o.date === s.meta().currentDate)).toHaveLength(1);
  });

  it('스토브리그 2턴: 연봉 같은 조건, 스폰서 더블 클릭, 시설·캠페인 같은 종류 두 번', async () => {
    await until(d, '2026-12-08');
    const repo = repoOf(d);

    // ── market.salaryOffer: 같은 날 같은 금액 두 번 → 행동력 1 한 번, 제안 기록 1건(D-118)
    const talk = (await call(d, 'market.view')).salaryTalks.find((t) => t.status === '협상 중')!;
    expect(talk).toBeTruthy();
    const offer = { playerId: talk.playerId, offerWon: Math.round(talk.demandWon * 0.5) };
    let s0 = await snap(d);
    expect((await call(d, 'market.salaryOffer', offer)).result).toBe('reject');
    let s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - 1);
    expect(await fails(d, 'market.salaryOffer', offer)).toBe('DUPLICATE_OFFER');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getOffers({ playerId: talk.playerId, clubId: CLUB, kind: 'salary' })).toHaveLength(1);

    // ── business.signSponsor: 같은 제안 더블 클릭(동시 두 요청) → 하나만 체결, 행동력 2·보장액 한 번
    const v0 = (await call(d, 'business.view')).sponsors;
    expect(v0.open).toBe(true);
    const main = v0.offers.find((o) => o.slot === 'main' && o.signReason === null)!;
    s0 = await snap(d);
    const both = await Promise.all([d.respond('business.signSponsor', { offerId: main.id }), d.respond('business.signSponsor', { offerId: main.id })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - SPONSOR.signAp);
    expect(s1.cash).toBe(s0.cash + main.guaranteedWon);
    expect(s1.ledger).toBe(s0.ledger + 1);
    // 다시 보내도(순차 재전송) 무비용 거부
    expect(await fails(d, 'business.signSponsor', { offerId: main.id })).not.toBe('INTERNAL');
    expect(await snap(d)).toEqual(s1);
    expect((await call(d, 'business.view')).sponsors.contracts).toHaveLength(1);

    // ── business.startFacility: 같은 시설 두 번 → 행동력 3 한 번, 공사 1건
    s0 = await snap(d);
    await call(d, 'business.startFacility', { kind: 'training' });
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - FACILITY.startAp);
    expect(await fails(d, 'business.startFacility', { kind: 'training' })).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getMeta().facilities![String(CLUB)]!.projects.filter((p) => p.kind === 'training')).toHaveLength(1);

    // ── business.startCampaign: 같은 주 같은 캠페인 두 번 → 행동력 2·비용 한 번
    const cost = (await call(d, 'business.view')).campaigns.find((c) => c.kind === 'family')!.costWon;
    s0 = await snap(d);
    await call(d, 'business.startCampaign', { kind: 'family' });
    s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - MARKETING.campaignAp);
    expect(s1.cash).toBe(s0.cash - cost);
    expect(await fails(d, 'business.startCampaign', { kind: 'family' })).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);
    expect(repo.getMeta().campaigns![String(CLUB)]!.filter((c) => c.kind === 'family')).toHaveLength(1);

    // ── business.chooseVendor: 다음 시즌 굿즈 업체 두 번 → 두 번째는 무비용 거부(업체·후원금 한 번)
    s0 = await snap(d);
    await call(d, 'business.chooseVendor', { kind: 'standard' });
    s1 = await snap(d);
    const vendor = JSON.stringify(repo.getMeta().merch![String(CLUB)]);
    expect(await fails(d, 'business.chooseVendor', { kind: 'standard' })).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);
    expect(JSON.stringify(repo.getMeta().merch![String(CLUB)])).toBe(vendor);
    expect(s1.ap).toBeLessThanOrEqual(s0.ap);
  });

  it('턴 회의 결정 카드: 같은 카드 두 번 고르면 한 번만 처리(행동력 0, 효과·기록 한 번)', async () => {
    let tested = false;
    await until(d, '2027-02-01', async (dd) => {
      const dash = await call(dd, 'game.dashboard');
      const card = dash.stove?.cards[0];
      if (tested || !card) return;
      const repo = repoOf(dd);
      const log0 = repo.getEventLog().length;
      const choiceId = card.choices[0]!.id;
      const s0 = await snap(dd);
      await call(dd, 'stove.chooseCard', { cardId: card.cardId, choiceId });
      const s1 = await snap(dd);
      expect(s1.ap).toBe(s0.ap);
      const meta1 = JSON.stringify(repo.getMeta().eventState);
      expect(await fails(dd, 'stove.chooseCard', { cardId: card.cardId, choiceId })).toBe('NOT_AVAILABLE');
      expect(await snap(dd)).toEqual(s1);
      expect(JSON.stringify(repo.getMeta().eventState)).toBe(meta1);
      expect(repo.getEventLog().length).toBe(log0 + 1);
      tested = true;
    });
    expect(tested).toBe(true);
  });

  it('시즌(2/2): 굿즈 수동 발주는 요청마다 한 건씩 정확히 청구, 저장·불러오기 뒤 같은 날을 다시 처리하지 않는다', async () => {
    await until(d, '2027-02-02');
    let repo = repoOf(d);

    // ── business.orderMerch: 멱등 키가 없는 명령(행동력 0) — 요청 한 번 = 발주 한 건, 금액은 발주마다 정확히 한 번
    const sku = (await call(d, 'business.view')).merch.skus.find((x) => x.sku === 'cap')!;
    const s0 = await snap(d);
    await call(d, 'business.orderMerch', { sku: 'cap', qty: sku.minOrder });
    const s1 = await snap(d);
    await call(d, 'business.orderMerch', { sku: 'cap', qty: sku.minOrder });
    const s2 = await snap(d);
    const each = s0.cash - s1.cash;
    expect(each).toBeGreaterThan(0);
    expect(s1.cash - s2.cash).toBe(each);
    expect([s1.ap, s2.ap]).toEqual([s0.ap, s0.ap]);
    expect([s1.ledger, s2.ledger]).toEqual([s0.ledger + 1, s0.ledger + 2]);
    expect((await call(d, 'business.view')).merch.skus.find((x) => x.sku === 'cap')!.onOrder).toBe(sku.onOrder + 2 * sku.minOrder);

    // ── save.load 뒤 game.advance: 같은 날을 두 번 처리하지 않고, 저장하지 않은 진행과 같은 결과
    await call(d, 'save.save', { slot: 'rep' });
    const saved = (await call(d, 'game.dashboard')).date;
    await call(d, 'game.advance', { mode: 'week' });
    const fpA = fingerprint(d);
    const dateA = (await call(d, 'game.dashboard')).date;
    const loaded = await call(d, 'save.load', { slot: 'rep' });
    expect(loaded.date).toBe(saved);
    repo = repoOf(d);
    expect(repo.isDayProcessed(addDays(saved, -1))).toBe(true);
    expect(repo.isDayProcessed(saved)).toBe(false);
    await call(d, 'game.advance', { mode: 'week' });
    expect((await call(d, 'game.dashboard')).date).toBe(dateA);
    expect(fingerprint(d)).toBe(fpA);
    // 동시에 두 번 진행해도 날짜가 겹치지 않는다(경기 기록 고유)
    await Promise.all([d.respond('game.advance', { mode: 'day', autoCards: true }), d.respond('game.advance', { mode: 'day', autoCards: true })]);
    expect((await call(d, 'game.dashboard')).date).toBe(addDays(dateA, 2));
    const games = repo.getGames(svc(d).meta().season);
    expect(new Set(games.map((g) => g.fixtureId)).size).toBe(games.length);
  });

  it('올스타 투표 캠페인: 두 번 → 행동력 2·비용 한 번', async () => {
    await until(d, allStarDates(2027).voteStart);
    const s0 = await snap(d);
    const c = await call(d, 'allStar.campaign', {});
    const s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap - ALLSTAR.campaignAp);
    expect(s1.cash).toBe(s0.cash - c.view.campaign.costWon);
    expect(await fails(d, 'allStar.campaign', {})).toBe('INVALID');
    expect(await snap(d)).toEqual(s1);
  });

  it('경기 관전: live.start 두 번은 같은 관전 기록, 같은 승부처 결정 두 번은 한 번만 기록, 확정한 날은 다시 열 수 없다', async () => {
    let tested = false;
    for (let i = 0; i < 20 && !tested; i++) {
      const dash = await call(d, 'game.dashboard');
      if (dash.live.available) {
        const v1 = await call(d, 'live.start', undefined);
        const rec1 = JSON.stringify(svc(d).meta().liveGame);
        const v2 = await call(d, 'live.start', undefined);
        expect(JSON.stringify(svc(d).meta().liveGame)).toBe(rec1);
        expect(v2).toEqual(v1);
        const dec = v1.game?.decision;
        if (dec) {
          const s0 = await snap(d);
          await call(d, 'live.decide', { choice: dec.recommendation });
          const rec2 = svc(d).meta().liveGame!;
          const n = Object.keys(rec2.prePa).length + Object.keys(rec2.count).length;
          expect(n).toBe(1);
          expect(await fails(d, 'live.decide', { choice: dec.recommendation })).toBe('NOT_AVAILABLE');
          const rec3 = svc(d).meta().liveGame!;
          expect(Object.keys(rec3.prePa).length + Object.keys(rec3.count).length).toBe(n);
          expect(await snap(d)).toEqual(s0); // 결정은 행동력 0, 확정 전에는 장부·난수 변화 없음
          tested = true;
        }
        const date = dash.date;
        await call(d, 'game.advance', { mode: 'day' }); // 관전 경기 확정
        // 확정한 날짜로 되돌아갈 수 없고(이미 처리), 오늘 다시 열기는 새 날짜 기준
        expect(repoOf(d).isDayProcessed(date)).toBe(true);
        expect(svc(d).meta().liveGame?.date ?? null).not.toBe(date);
      } else await call(d, 'game.advance', { mode: 'day' });
    }
    expect(tested).toBe(true);
  });
});

describe('반복 조작 점검 (7c) — 2/1 캠프 시작(결정 카드·프롤로그·구단주 행동)', () => {
  const dir = tempDir();
  const d = makeDispatcher(dir);
  // 2/1 시작은 첫 스토브리그 자동 실행을 포함해 부하가 큰 기계에서 기본 훅 제한(10초)을 넘을 수 있다
  beforeAll(async () => {
    await call(d, 'game.new', { clubId: CLUB, saveName: 't', seed: 'repeat-7c', start: 'camp' });
  }, 180_000);
  afterAll(() => {
    d.close();
    cleanup(dir);
  });

  it('events.choose: 같은 대기 카드를 더블 클릭(동시 두 요청)·재전송해도 한 번만 처리', async () => {
    const repo = repoOf(d);
    const card = (await call(d, 'game.dashboard')).card;
    expect(card).toBeTruthy();
    const choiceId = card!.choices.find((c) => c.isDefault)?.id ?? card!.choices[0]!.id;
    const log0 = repo.getEventLog().length;
    const s0 = await snap(d);
    const both = await Promise.all([d.respond('events.choose', { choiceId }), d.respond('events.choose', { choiceId })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const bad = both.find((r) => !r.ok);
    expect(bad && !bad.ok ? bad.error.code : '').toBe('NOT_AVAILABLE');
    const s1 = await snap(d);
    expect(s1.ap).toBe(s0.ap);
    expect(repo.getEventLog().length).toBe(log0 + 1);
    const state = JSON.stringify(repo.getMeta().eventState);
    expect(await fails(d, 'events.choose', { choiceId })).toBe('NOT_AVAILABLE');
    expect(await snap(d)).toEqual(s1);
    expect(JSON.stringify(repo.getMeta().eventState)).toBe(state);
    expect((await call(d, 'game.dashboard')).card).toBeNull();
  });

  it('prologue.ack·prologue.skip: 같은 장을 두 번 보내도 답변 효과·기본 처리는 한 번', async () => {
    const repo = repoOf(d);
    const club = String(CLUB);
    const pro = () => JSON.stringify(repo.getMeta().prologue);
    expect((await call(d, 'game.dashboard')).prologue?.scene?.id).toBe('P1');
    const press0 = repo.getMeta().press?.[club] ?? 50;
    await call(d, 'prologue.ack', { chapterId: 'P1', answerId: 'evade' });
    const press1 = repo.getMeta().press![club]!;
    expect(press1).toBe(press0 - 3);
    const s1 = await snap(d);
    const st1 = pro();
    expect(await fails(d, 'prologue.ack', { chapterId: 'P1', answerId: 'evade' })).toBe('NOT_AVAILABLE');
    expect(repo.getMeta().press![club]).toBe(press1);
    expect(await snap(d)).toEqual(s1);
    expect(pro()).toBe(st1);

    // 장 건너뛰기 두 번: 두 번째는 건너뛸 장이 없음(무비용)
    await call(d, 'prologue.skip', { scope: 'chapter', chapterId: 'P2' });
    const st2 = pro();
    const s2 = await snap(d);
    expect(await fails(d, 'prologue.skip', { scope: 'chapter', chapterId: 'P2' })).toBe('NOT_AVAILABLE');
    expect(pro()).toBe(st2);
    expect(await snap(d)).toEqual(s2);

    // 편 건너뛰기 두 번: 남은 미션 기본 처리는 한 번, 두 번째는 건너뛸 편이 없음
    const r = await call(d, 'prologue.skip', { scope: 'part' });
    expect(r.summary.length).toBeGreaterThan(0);
    const st3 = pro();
    const s3 = await snap(d);
    expect(await fails(d, 'prologue.skip', { scope: 'part' })).toBe('NOT_AVAILABLE');
    expect(pro()).toBe(st3);
    expect(await snap(d)).toEqual(s3);
  });

  it('owner.emergency·roster.persuade·player.medicalCheck·player.trainDelegate 두 번 → 지원금·행동력·처리량 한 번', async () => {
    const repo = repoOf(d);
    // 긴급 지원: 시즌 1회
    const e1 = await d.respond('owner.emergency', undefined as never);
    if (e1.ok) {
      const s1 = await snap(d);
      expect(await fails(d, 'owner.emergency', undefined as never)).toBe('NOT_AVAILABLE');
      expect(await snap(d)).toEqual(s1);
      expect(repo.ledgerEntries(CLUB, 100000).filter((x) => x.category === 'parentSupport' && x.memo.includes('긴급'))).toHaveLength(1);
    } else console.log(`[7c] 긴급 지원 첫 요청이 거부되어 반복 점검 생략: ${e1.error.message}`);

    // 은퇴 설득: 시험 준비로 고민 선수를 넣고 두 번 설득
    const p = repo.getPlayers().find((x) => x.clubId === CLUB && !x.retired && !x.isPitcher)!;
    repo.updateMeta({ retirementPending: [{ playerId: p.id, reason: '기량 하락', deadline: '2027-02-28' }] });
    let s0 = await snap(d);
    await call(d, 'roster.persuade', { playerId: p.id });
    let s1 = await snap(d);
    expect(s1.ap).toBeLessThan(s0.ap);
    expect(await fails(d, 'roster.persuade', { playerId: p.id })).toBe('NOT_AVAILABLE');
    expect(await snap(d)).toEqual(s1);

    // 특별 검사: 재검사 대기 기간 안에는 무비용 거부
    s0 = await snap(d);
    await call(d, 'player.medicalCheck', { playerId: p.id });
    s1 = await snap(d);
    expect(s1.ap).toBeLessThan(s0.ap);
    expect(await fails(d, 'player.medicalCheck', { playerId: p.id })).toBe('DUPLICATE');
    expect(await snap(d)).toEqual(s1);

    // 훈련 위임: 같은 날 두 번 → 육성팀 처리량 한 번, 두 번째는 같은 계획이라 무비용 거부
    const devWp = async () => (await call(d, 'org.view')).teams.find((t) => t.key === 'dev')!.usedWp;
    const q = repo.getPlayers().find((x) => x.clubId === CLUB && !x.retired && !x.training && x.id !== p.id && !x.health?.injury)!;
    const wp0 = await devWp();
    await call(d, 'player.trainDelegate', { playerId: q.id });
    const wp1 = await devWp();
    expect(wp1).toBeGreaterThan(wp0);
    const plan1 = JSON.stringify(repo.getPlayer(q.id)!.training);
    s1 = await snap(d);
    expect(await fails(d, 'player.trainDelegate', { playerId: q.id })).toBe('DUPLICATE');
    expect(await devWp()).toBe(wp1);
    expect(JSON.stringify(repo.getPlayer(q.id)!.training)).toBe(plan1);
    expect(await snap(d)).toEqual(s1);
  });
});

describe('반복 조작 점검 (7c) — 결재·리빌딩(스토브리그)', () => {
  it('org.approve 같은 안건 두 번·org.decideMany 같은 id 중복 → 실행 한 번, owner.rebuild 두 번 → 행동력 한 번', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      // tests/org.test.ts '제안 후 승인'과 같은 세계: 시장 개장 뒤 운영팀이 결재를 올린다
      await call(d, 'game.new', { clubId: CLUB, saveName: 't', seed: 'deleg-approve-2' });
      const repo = repoOf(d);
      // 리빌딩 선언: 스토브리그 한 번
      let s0 = await snap(d);
      await call(d, 'owner.rebuild', undefined as never);
      let s1 = await snap(d);
      expect(s1.ap).toBeLessThan(s0.ap);
      expect(await fails(d, 'owner.rebuild', undefined as never)).toBe('NOT_AVAILABLE');
      expect(await snap(d)).toEqual(s1);

      for (let i = 0; i < 2; i++) await call(d, 'game.advance', { mode: 'week' });
      const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
      await call(d, 'org.setPolicy', { ...pol, mode: 'approve', cashFloor: 0, faMaxTotal: 300e8 });
      await call(d, 'game.advance', { mode: 'week' });
      const v = await call(d, 'org.view');
      expect(v.approvals.length).toBeGreaterThan(0);
      const first = v.approvals[0]!;
      const task0 = JSON.stringify(repo.getTasks({}));
      s0 = await snap(d);
      const both = await Promise.all([d.respond('org.approve', { approvalId: first.id }), d.respond('org.approve', { approvalId: first.id })]);
      expect(both.filter((r) => r.ok)).toHaveLength(1);
      s1 = await snap(d);
      expect(s1.ap).toBe(s0.ap);
      expect(JSON.stringify(repo.getTasks({}))).not.toBe(task0);
      const tasks1 = JSON.stringify(repo.getTasks({}));
      expect(await fails(d, 'org.approve', { approvalId: first.id })).toBe('NOT_AVAILABLE');
      expect(await snap(d)).toEqual(s1);
      expect(JSON.stringify(repo.getTasks({}))).toBe(tasks1);
      expect(repo.getApprovals('approved').filter((a) => a.id === first.id)).toHaveLength(1);

      // 일괄 결재에 같은 안건을 두 번 넣어도 한 번만 실행(나머지는 실패로 보고)
      const rest = (await call(d, 'org.view')).approvals;
      if (rest.length) {
        const id = rest[0]!.id;
        const r = await call(d, 'org.decideMany', { approvalIds: [id, id, first.id], approve: true });
        expect(r.message).toMatch(/^승인 1\/3건/);
        expect(repo.getApprovals('approved').filter((a) => a.id === id)).toHaveLength(1);
      } else console.log('[7c] 남은 결재가 없어 decideMany 중복 id 점검 생략');
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
