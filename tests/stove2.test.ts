import { afterEach, describe, expect, it } from 'vitest';
import { EOK } from '../src/engine/money';
import { BANKRUPTCY } from '../src/game/seasonClose';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const newDir = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function toSeason(d: Dispatcher) {
  while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
}

describe('두 번째 스토브리그 (D-084·D-085)', () => {
  it('드래프트(지명 순위 반영) → 한국시리즈 → 시즌 마감: 신인 입단·FA 재판정·학년 진급·다음 시즌 일정', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'stove2' });
    const repo = d.saves.repository();
    expect(repo.getAmateurs('active')).toHaveLength(750);
    await toSeason(d);
    expect(repo.getMeta().seasonGoal?.season).toBe(2027);
    // 지명 순위: 스카우트 보드 맨 아래 후보를 1순위로 올린다.
    const before = await call(d, 'draft.view');
    const want = before.candidates[before.candidates.length - 1]!;
    await call(d, 'draft.setBoard', { ids: [want.id] });
    expect((await call(d, 'draft.view')).board).toEqual([want.id]);
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 정규시즌 끝
    await call(d, 'game.advance', { mode: 'day' }); // 드래프트일(다음 월요일)까지 진행
    while (!(await call(d, 'draft.view')).done) await call(d, 'game.advance', { mode: 'day' });
    const dv = await call(d, 'draft.view');
    expect(dv.picks).toHaveLength(50);
    const mine = dv.picks.filter((p) => p.mine);
    expect(mine).toHaveLength(5);
    expect(mine[0]!.name).toBe(want.name);
    // 상위 10% 아마추어 업적이 그해 성적으로 붙는다.
    const drafted = repo.getAmateurs('drafted');
    expect(drafted.some((a) => a.honors.some((h) => h.year === 2027))).toBe(true);
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 포스트시즌 → 시즌 마감
    const meta = repo.getMeta();
    expect(meta.mode).toBe('stove');
    const rookies = repo.getPlayers().filter((p) => p.draft?.year === 2027);
    expect(rookies).toHaveLength(50);
    expect(rookies.filter((p) => p.clubId === 7)).toHaveLength(5);
    expect(rookies.every((p) => p.contractYears === 1 && p.level === '2군')).toBe(true);
    const bonus = repo.ledgerEntries(7, 400).filter((e) => e.memo.includes('신인 계약금'));
    expect(bonus).toHaveLength(5);
    // FA 재판정: 자격 연수 8년 이상·계약 만료 선수만
    const fa = repo.getPlayers().filter((p) => p.clubId !== null && p.career.faEligible);
    expect(fa.length).toBeGreaterThan(0);
    expect(fa.every((p) => p.contractYears === 0 && p.career.faServiceYears >= 8 && p.origin === 'domestic')).toBe(true);
    // 학년도 넘김: 새 1학년이 들어와 풀 규모가 유지된다.
    expect(repo.getAmateurs('active').filter((a) => a.level === '고교' && a.grade === 1)).toHaveLength(150);
    expect(repo.countFixtures(2028).total).toBe(720);
    // 미지명 졸업자 FA 등록(D-099): 지명되지 않은 졸업자 중 기준 이상이 소속 없는 국내 선수로 등록되고,
    // 1년 동안 계약하지 못한 무소속 선수(새 게임의 미계약 선수 풀 포함)는 은퇴한다.
    const free = repo.getPlayers().filter((p) => p.clubId === null && p.origin === 'domestic' && !p.retired);
    expect(free.length).toBeGreaterThan(20);
    expect(free.every((p) => p.contractYears === 0 && p.draft === undefined)).toBe(true);
    const graduates = new Set(repo.getAmateurs('gone').filter((a) => !a.draft).map((a) => a.name));
    // 무소속 선수는 이번 미지명 졸업자이거나, 풀이 모자라 이번 시즌 보충한 독립리그·재야 선수(D-111)뿐이다(이전 미계약 선수는 은퇴).
    const grads = free.filter((p) => graduates.has(p.name));
    const extra = free.filter((p) => !graduates.has(p.name));
    if (extra.length) expect(repo.getInbox(500).some((m) => m.title === `독립리그·재야 선수 ${extra.length}명 FA 시장 등록`)).toBe(true);
    expect(repo.getPlayers().some((p) => p.retired?.reason === '미계약')).toBe(true);
    expect(repo.getInbox(500).some((m) => m.title === '2027 미지명 선수 FA 등록 ' + grads.length + '명')).toBe(true);
    // 우리 구단 신인 선수 정보에 아마추어 업적·드래프트 정보가 보인다.
    const r0 = rookies.find((p) => p.clubId === 7)!;
    const pv = await call(d, 'game.player', { playerId: r0.id });
    expect(pv.draftInfo).toContain('2027 신인 드래프트');
    d.close();
  }, 120_000);

  it('은퇴 고민 선수: 설득(행동력 1)하면 남고, 기한이 지나면 은퇴한다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'retire' });
    const repo = d.saves.repository();
    const roster = repo.getPlayers().filter((p) => p.clubId === 7 && p.origin === 'domestic');
    const deadline = '2026-11-15';
    repo.updateMeta({ retirementPending: [{ playerId: roster[0]!.id, reason: '자연 은퇴(나이)', deadline }, { playerId: roster[1]!.id, reason: '기량 하락', deadline }] });
    const mv = await call(d, 'market.view');
    expect(mv.retirementPending).toHaveLength(2);
    const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
    await call(d, 'roster.persuade', { playerId: roster[0]!.id });
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap - 1);
    await call(d, 'game.advance', { mode: 'week' });
    expect(repo.getPlayer(roster[0]!.id)!.clubId).toBe(7);
    const gone = repo.getPlayer(roster[1]!.id)!;
    expect(gone.clubId).toBeNull();
    expect(gone.retired?.reason).toBe('기량 하락');
    expect((await call(d, 'game.player', { playerId: gone.id })).retired).toContain('은퇴');
    d.close();
  });

  it('자금 위기 30일 미회복이면 파산(게임 종료), 긴급 지원은 시즌당 1회이고 다음 시즌 지원금에서 차감된다', async () => {
    const run = async (useEmergency: boolean) => {
      const d = makeDispatcher(newDir());
      await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'bankrupt' });
      const repo = d.saves.repository();
      repo.addLedger([{ clubId: 7, date: '2026-11-08', category: 'startCash', amount: -(repo.cashBalance(7) + 50 * EOK), memo: '테스트: 현금 고갈' }]);
      await call(d, 'game.advance', { mode: 'week' });
      expect(repo.getMeta().cashCrisisSince).toBe('2026-11-08');
      if (useEmergency) {
        const r = await call(d, 'owner.emergency');
        expect(r.message).toContain('긴급 지원');
        expect((await d.respond('owner.emergency', undefined)).ok).toBe(false);
        expect(repo.getMeta().supportDeduction?.['2027']).toBeGreaterThan(0);
      }
      for (let i = 0; i < 5; i++) {
        const r = await d.respond('game.advance', { mode: 'week' });
        if (!r.ok) break;
      }
      const out = repo.getMeta().gameOver;
      d.close();
      return out;
    };
    // 사업 수입 구현 전에는 판정 보류(기본값). 판정 로직은 켜서 확인한다.
    expect(await run(false)).toBeUndefined();
    BANKRUPTCY.enforced = true;
    try {
      expect((await run(false))?.kind).toBe('bankrupt');
      expect(await run(true)).toBeUndefined();
    } finally {
      BANKRUPTCY.enforced = false;
    }
  });

  it('성적 기본 목표 3시즌 연속 미달이면 시즌 마감 때 해임되고 진행이 막힌다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'dismiss' });
    const repo = d.saves.repository();
    await toSeason(d);
    repo.updateMeta({ goalMisses: 2, seasonGoal: { season: 2027, expectedRank: 0 } }); // 이번 시즌 미달이 확정되도록
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
    const meta = repo.getMeta();
    expect(meta.gameOver?.kind).toBe('dismissed');
    const blocked = await d.respond('game.advance', { mode: 'week' });
    expect(blocked.ok ? '' : blocked.error.code).toBe('GAME_OVER');
    expect((await call(d, 'game.dashboard')).gameOver?.kind).toBe('dismissed');
    d.close();
  }, 120_000);
});

describe('스토브리그 달력', () => {
  it('캠프 명단 확정은 언제나 시즌 모드 시작 전날 이전이다(2월 1일이 월요일이 아닌 해 포함)', async () => {
    const { stoveEvents, seasonModeStart } = await import('../src/engine/stove');
    for (const k of ['2026-11-08', '2027-10-19', '2028-10-22', '2030-10-27']) {
      const ev = stoveEvents(k);
      const camp = ev.find((e) => e.kind === 'campRoster')!.date;
      expect(camp < seasonModeStart(Number(k.slice(0, 4)))).toBe(true);
    }
  });
});
