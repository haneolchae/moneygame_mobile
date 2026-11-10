// 3d 선수 상세 행동 영역(18a·D-118): 상태별 행동 목록, 조회 무비용, 같은 날 같은 조건 재제안 무비용 거부
import { afterEach, describe, expect, it } from 'vitest';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function weeks(d: Dispatcher, n: number) {
  for (let i = 0; i < n; i++) await call(d, 'game.advance', { mode: 'week' });
}
const keys = (v: { actions: Array<{ key: string }> }) => v.actions.map((a) => a.key).sort();

describe('선수 상세 행동 (3d)', () => {
  it('상태별 행동 목록·조회 무비용·재제안 차단·연봉/설득 연결', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'actions' });
    const repo = d.saves.repository();
    const players = repo.getPlayers();
    const ownDomestic = players.find((p) => p.clubId === 5 && p.origin === 'domestic' && !p.career.faEligible)!;
    const otherContracted = players.find((p) => p.clubId === 3 && p.origin === 'domestic' && !p.career.faEligible)!;
    const foreignPool = players.find((p) => p.clubId === null && p.origin === 'foreign')!;

    // 우리 일반 선수: 건강(휴식·검사, 4b-1)과 선수 정리(방출). 타 구단 계약 선수: 계약·정리 행동 없음. 해외 풀: 외국인 영입.
    expect(keys(await call(d, 'player.actions', { playerId: ownDomestic.id }))).toEqual(['medicalCheck', 'release', 'rest']);
    expect(keys(await call(d, 'player.actions', { playerId: otherContracted.id }))).toEqual([]);
    const fv = await call(d, 'player.actions', { playerId: foreignPool.id });
    expect(keys(fv)).toEqual(['foreignOffer']);
    expect(fv.foreign?.demandUsd).toBeGreaterThan(0);

    await weeks(d, 2); // FA 시장 개장
    const mv = await call(d, 'market.view');
    const target = mv.fa.find((f) => f.statusKey === 'approved' && f.originClub.id !== 5)!;
    const before = { ap: (await call(d, 'game.dashboard')).owner.apRemaining, cash: repo.cashBalance(5), rng: JSON.stringify(repo.getMeta().rngStreams) };
    const av = await call(d, 'player.actions', { playerId: target.playerId });
    await call(d, 'player.actions', { playerId: target.playerId });
    expect(av.actions.find((a) => a.key === 'faOffer')).toMatchObject({ enabled: true, apCost: 1, primary: true });
    expect(av.actions.find((a) => a.key === 'faDelegate')?.enabled).toBe(mv.ops.mode !== 'direct');
    // 조회만으로 행동력·현금·난수 상태가 변하지 않는다
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(before.ap);
    expect(repo.cashBalance(5)).toBe(before.cash);
    expect(JSON.stringify(repo.getMeta().rngStreams)).toBe(before.rng);

    // 낮은 조건 제안 → 행동력 1. 같은 날 같은 조건 재제안 → 무비용 거부(D-118). 조건을 바꾸면 다시 제안 가능.
    const low = { playerId: target.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 };
    const first = await call(d, 'market.faOffer', low);
    expect(first.result).not.toBe('accept');
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(before.ap - 1);
    const dup = await d.respond('market.faOffer', low);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('DUPLICATE_OFFER');
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(before.ap - 1);
    expect((await call(d, 'player.actions', { playerId: target.playerId })).history[0]?.kind).toBe('FA');

    // 은퇴 고민 선수: 설득 면담이 주요 행동으로 나타나고 실행하면 목록에서 사라진다.
    repo.updateMeta({ retirementPending: [{ playerId: ownDomestic.id, reason: '기량 하락', deadline: '2026-12-31' }] });
    const pv = await call(d, 'player.actions', { playerId: ownDomestic.id });
    expect(pv.actions.find((a) => a.key === 'persuade')).toMatchObject({ enabled: true, primary: true });
    await call(d, 'roster.persuade', { playerId: ownDomestic.id });
    expect(keys(await call(d, 'player.actions', { playerId: ownDomestic.id }))).toEqual(['medicalCheck', 'release', 'rest']);

    await weeks(d, 2); // 12월 연봉 협상
    const talk = (await call(d, 'market.view')).salaryTalks.find((t) => t.status === '협상 중')!;
    const sv = await call(d, 'player.actions', { playerId: talk.playerId });
    expect(keys(sv)).toEqual(['medicalCheck', 'release', 'rest', 'salaryDelegate', 'salaryOffer']);
    const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
    const offer = { playerId: talk.playerId, offerWon: Math.round(talk.demandWon * 0.5) };
    expect((await call(d, 'market.salaryOffer', offer)).result).toBe('reject');
    const dup2 = await d.respond('market.salaryOffer', offer);
    expect(dup2.ok).toBe(false);
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap - 1);
    expect((await call(d, 'player.actions', { playerId: talk.playerId })).history[0]).toMatchObject({ kind: '연봉', status: '거절' });
    d.close();
  });
});
