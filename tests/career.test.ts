// 7b AI 선제안 트레이드·해임 뒤 이어하기(D-157·D-158): 수락 비용(행동력 1)·명령 식별자 중복 방지·거절 무비용·기한 만료·
// 상황이 바뀐 제안의 무비용 철회, 영입 제안 수 규칙, 이어하기 뒤 레벨 유지·초기화·이전 구단 운영 상태·규칙 검사·진행, 파산은 제안 없음
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/calendar';
import { TRADE } from '../src/engine/config';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkAiClubs } from '../src/host/invariants';
import type { TradeOffer } from '../src/game/ports';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const ap = (d: Dispatcher) => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);

describe('AI 선제안 트레이드·해임 뒤 이어하기 (7b)', () => {
  it('받은 제안: 수락 비용·중복 방지·거절·만료·철회', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'offer-7b' });
      const repo = d.saves.repository();
      let offers = (await call(d, 'trade.offers')).offers;
      for (let i = 0; i < 12 && offers.length === 0; i++) {
        await call(d, 'game.advance', { mode: 'week' });
        offers = (await call(d, 'trade.offers')).offers;
      }
      expect(offers.length).toBe(1);
      const o = offers[0]!;
      expect(o.give).toHaveLength(1);
      expect(o.get).toHaveLength(1);
      expect(o.get[0]!.ratings).toEqual({}); // 상대 선수는 추정 범위만
      expect(o.apCost).toBe(TRADE.sessionAp);
      expect((await call(d, 'game.dashboard')).tasks.some((t) => t.title.includes('받은 트레이드 제안'))).toBe(true);
      expect(checkAiClubs(repo)).toEqual([]);

      // 수락: 행동력 1, 양쪽 이적. 같은 명령 식별자를 다시 보내도 비용·이적이 두 번 일어나지 않는다
      const ap0 = await ap(d);
      const r = await call(d, 'trade.respondOffer', { offerId: o.id, accept: true, commandId: 'offer-accept-1' });
      expect(r.result).toBe('accept');
      expect(r.apCharged).toBe(TRADE.sessionAp);
      expect(await ap(d)).toBe(ap0 - TRADE.sessionAp);
      expect(repo.getPlayer(o.give[0]!.id)!.clubId).toBe(o.club.id);
      expect(repo.getPlayer(o.get[0]!.id)!.clubId).toBe(1);
      const again = await call(d, 'trade.respondOffer', { offerId: o.id, accept: true, commandId: 'offer-accept-1' });
      expect(again.result).toBe('accept');
      expect(await ap(d)).toBe(ap0 - TRADE.sessionAp);
      expect(r.view.offers).toHaveLength(0);
      expect((await d.respond('trade.respondOffer', { offerId: o.id, accept: true, commandId: 'offer-accept-2' })).ok).toBe(false);

      // 시험용 제안: 거절은 무료, 기한이 지난 제안은 받을 수 없음, 성립하지 않는 제안은 비용 없이 철회
      const meta = repo.getMeta();
      const today = meta.currentDate;
      const mine = repo.getPlayers().filter((p) => p.clubId === 1 && !p.retired && p.origin === 'domestic' && p.id !== o.get[0]!.id).sort((a, b) => a.salary - b.salary);
      const theirs = repo.getPlayers().filter((p) => p.clubId === 3 && !p.retired && p.origin === 'domestic').sort((a, b) => b.salary - a.salary);
      const cheap = mine.find((p) => p.isPitcher === theirs[0]!.isPitcher)!;
      const base = { clubId: 3, date: today, season: meta.season, period: 'stove' as const, audit: { give: 0, get: 0 } };
      const fake: TradeOffer[] = [
        { ...base, id: 101, expires: addDays(today, 6), status: 'open', pkg: { give: [cheap.id], get: [theirs[0]!.id], cashWon: 0 } },
        { ...base, id: 102, expires: addDays(today, -1), status: 'open', pkg: { give: [cheap.id], get: [theirs[1]!.id], cashWon: 0 } },
        { ...base, id: 103, expires: addDays(today, 6), status: 'open', pkg: { give: [cheap.id], get: [theirs[2]!.id], cashWon: 0 } },
      ];
      repo.updateMeta({ tradeOffers: [...(repo.getMeta().tradeOffers ?? []), ...fake] });
      const ap1 = await ap(d);
      expect((await call(d, 'trade.offers')).offers.map((x) => x.id).sort()).toEqual([101, 103]);
      const declined = await call(d, 'trade.respondOffer', { offerId: 103, accept: false, commandId: 'offer-decline-1' });
      expect(declined.result).toBe('reject');
      expect((await d.respond('trade.respondOffer', { offerId: 102, accept: true, commandId: 'offer-late-1' })).ok).toBe(false);
      // 최저 연봉 선수로 상대 최고 연봉 선수를 받는 안은 상대가 받아들이지 않는다 → 철회
      const withdrawn = await call(d, 'trade.respondOffer', { offerId: 101, accept: true, commandId: 'offer-withdrawn-1' });
      expect(withdrawn.result).toBe('reject');
      expect(withdrawn.message).toContain('거둬들였습니다');
      expect(await ap(d)).toBe(ap1);
      expect(repo.getPlayer(cheap.id)!.clubId).toBe(1);
      const status = new Map((repo.getMeta().tradeOffers ?? []).map((x) => [x.id, x.status]));
      expect([status.get(101), status.get(103)]).toEqual(['withdrawn', 'declined']);
    } finally {
      d.close();
      cleanup(dir);
    }
  });

  it('해임 뒤 영입 제안 수 규칙, 이어하기, 파산은 제안 없음', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'career-7b' });
      const repo = d.saves.repository();
      await call(d, 'game.advance', { mode: 'week' });
      expect((await call(d, 'owner.career')).jobOffers).toEqual([]);
      const date = repo.getMeta().currentDate;
      repo.updateMeta({ gameOver: { kind: 'bankrupt', date, reason: '시험: 파산' }, ownerLevel: 3 });
      expect((await call(d, 'owner.career')).jobOffers).toEqual([]);
      repo.updateMeta({ gameOver: { kind: 'dismissed', date, reason: '시험: 해임' }, ownerLevel: 1 });
      expect((await call(d, 'owner.career')).jobOffers).toHaveLength(0);
      repo.updateMeta({ ownerLevel: 2 });
      expect((await call(d, 'owner.career')).jobOffers).toHaveLength(1);
      repo.updateMeta({ ownerLevel: 3, ownerXp: 40, goalMisses: 3, restOrders: { '1': date }, draftBoard: [1, 2] });
      const cv = await call(d, 'owner.career');
      expect(cv.jobOffers).toHaveLength(2);
      // 기준 순위가 낮은 구단부터(첫 스토브리그는 2026 순위 10위·9위)
      expect(cv.jobOffers.map((o) => o.rank)).toEqual([10, 9]);
      expect(cv.tenures).toHaveLength(1);
      expect(cv.tenures[0]!.reason).toBe('시험: 해임');
      expect((await d.respond('game.advance', { mode: 'week' })).ok).toBe(false);

      const target = cv.jobOffers[0]!.club.id;
      const notOffered = [2, 3, 4, 5, 6, 7, 8, 9, 10].find((id) => !cv.jobOffers.some((o) => o.club.id === id))!;
      expect((await d.respond('owner.acceptJob', { clubId: notOffered })).ok).toBe(false);
      const cash = repo.cashBalance(target);
      const dash = await call(d, 'owner.acceptJob', { clubId: target });
      expect(dash.userClub.id).toBe(target);
      expect(dash.gameOver).toBeNull();
      expect(dash.owner.level).toBe(3);
      expect(dash.owner.xp).toBe(40);
      expect(dash.cashWon).toBe(cash);
      expect(dash.goal.misses).toBe(0);
      const meta = repo.getMeta();
      expect(meta.clubStance?.[String(target)]).toBeUndefined();
      expect(meta.clubStance?.['1']).toBeDefined();
      expect([meta.restOrders, meta.draftBoard, meta.tradeOffers]).toEqual([{}, [], []]);
      const after = await call(d, 'owner.career');
      expect(after.jobOffers).toEqual([]);
      expect(after.tenures.map((t) => [t.club.id, t.to])).toEqual([
        [1, date],
        [target, null],
      ]);
      // 새 구단으로 진행: 선수 목록은 새 구단, 이전 구단 선수는 추정 범위로만
      const mine = await call(d, 'game.players', { scope: 'mine', group: 'all', sortKey: 'name' });
      expect(mine.length).toBeGreaterThan(30);
      expect(mine.every((p) => p.club?.id === target && Object.keys(p.ratings).length > 0)).toBe(true);
      const old = await call(d, 'game.players', { scope: 1, group: 'all', sortKey: 'name' });
      expect(old.every((p) => Object.keys(p.ratings).length === 0)).toBe(true);
      await call(d, 'game.advance', { mode: 'week' });
      await call(d, 'game.advance', { mode: 'week' });
      expect(checkAiClubs(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
