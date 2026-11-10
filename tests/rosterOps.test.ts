// 2d 개막 준비·수동 로스터(D-119·D-120): 편성 시기, 1군 26명·최소 인원, 계획 검증·보정, 시범경기 분리,
// 수동 계획의 경기 반영, 재등록 10일, 시즌 중 방출 뒤 1군 보충, 행동력 0
import { afterEach, describe, expect, it } from 'vitest';
import { seasonKeyDates } from '../src/engine/schedule';
import { exhibitionDates } from '../src/game/rosterOps';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkUserRoster } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
  throw new Error('날짜에 닿지 못함');
}
const err = async (d: Dispatcher, name: 'roster.move' | 'roster.setPlan', payload: never) => {
  const r = await d.respond(name, payload);
  return r.ok ? 'OK' : r.error.code;
};

describe('선수단 운영 (2d)', () => {
  it('캠프부터 편성·규칙 검증·계획 보정·시범경기 분리·경기 반영·재등록 제한·방출 보충', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'roster-2d' });
    const repo = d.saves.repository();

    // 스토브리그에는 편성 불가(2/1에 1군을 다시 짬)
    let v = await call(d, 'roster.view');
    expect(v.editable).toBe(false);
    expect(await err(d, 'roster.move', { promote: [], demote: [] } as never)).toBe('ROSTER_LOCKED');

    await until(d, '2027-02-02');
    v = await call(d, 'roster.view');
    expect(v.editable).toBe(true);
    expect(v.counts.active).toBe(26);
    const ap = (await call(d, 'game.dashboard')).owner.apRemaining;
    const act = v.players.filter((p) => p.level === '1군');
    const minor = v.players.filter((p) => p.level !== '1군');
    const actH = act.filter((p) => !p.isPitcher && p.position !== 'C');
    const minH = minor.filter((p) => !p.isPitcher && p.position !== 'C');
    // 26명이 아니게 되는 변경·투수 최소 인원 미달은 거부(상태 불변)
    expect(await err(d, 'roster.move', { promote: [minH[0]!.id], demote: [] } as never)).toBe('ROSTER_RULE');
    const actP = act.filter((p) => p.isPitcher);
    expect(await err(d, 'roster.move', { promote: minH.slice(0, 2).map((p) => p.id), demote: actP.slice(0, 2).map((p) => p.id) } as never)).toBe(actP.length - 2 < 12 ? 'ROSTER_RULE' : 'OK');
    v = await call(d, 'roster.view');

    // 수동 계획: 잘못된 계획 거부, 추천안 저장, 계획에 있는 타자를 내리면 그 자리만 보정
    const rec = v.recommended!;
    const bad = { ...rec, lineup: rec.lineup.map((s, i) => (i === 1 ? { ...s, position: rec.lineup[0]!.position } : s)) };
    expect(await err(d, 'roster.setPlan', { mode: 'manual', plan: bad } as never)).toBe('PLAN_INVALID');
    await call(d, 'roster.setPlan', { mode: 'manual', plan: rec });
    const dh = rec.lineup.find((s) => s.position === 'DH')!.playerId;
    const up = v.players.find((p) => p.level !== '1군' && !p.isPitcher && p.position !== 'C')!;
    const moved = await call(d, 'roster.move', { promote: [up.id], demote: [dh] });
    expect(moved.message).toContain('운영 계획 보정');
    expect(moved.view.planProblems).toEqual([]);
    expect(moved.view.plan!.lineup.some((s) => s.playerId === dh)).toBe(false);
    expect((await call(d, 'game.dashboard')).owner.apRemaining).toBe(ap); // 행동력 0(D-119)

    // 시범경기: 날짜마다 5경기, 정규 경기 기록·타격 집계에는 없음
    const season = 2027;
    const ex = exhibitionDates(season);
    await until(d, seasonKeyDates(season).opening);
    v = await call(d, 'roster.view');
    expect(repo.getMeta().exhibition!.games).toHaveLength(ex.length * 5);
    expect(v.exhibition!.games.length).toBe(ex.length);
    expect(repo.getGames(season)).toHaveLength(0);
    expect(repo.battingTotals(season).size).toBe(0);

    // 개막전: 수동 계획 타순대로 타석에 선다
    await until(d, '2027-03-29');
    const plan = (await call(d, 'roster.view')).plan!;
    const game = repo.getGames(season).find((g) => g.home === 7 || g.away === 7)!;
    const order = repo.getGameEvents(game.fixtureId).pas.filter((p) => p.battingClub === 7).slice(0, 9).map((p) => p.batterId);
    expect(order).toEqual(plan.lineup.map((s) => s.playerId));

    // 개막 뒤 말소 선수는 10일 안에 다시 못 올린다
    v = await call(d, 'roster.view');
    const a = v.players.find((p) => p.level === '1군' && !p.isPitcher && p.position !== 'C')!;
    const b = v.players.find((p) => p.level !== '1군' && !p.isPitcher && p.position !== 'C' && !v.reRegister[String(p.id)])!;
    await call(d, 'roster.move', { promote: [b.id], demote: [a.id] });
    expect(await err(d, 'roster.move', { promote: [a.id], demote: [b.id] } as never)).toBe('RE_REGISTER');
    expect((await call(d, 'roster.view')).reRegister[String(a.id)]).toBeDefined();

    // 시즌 중 1군 선수 방출 → 같은 처리에서 1군 26명 보충
    const victim = (await call(d, 'roster.view')).players.find((p) => p.level === '1군' && p.isPitcher)!;
    const rel = await call(d, 'market.release', { playerId: victim.id });
    expect(rel.message).toContain('1군');
    expect((await call(d, 'roster.view')).counts.active).toBe(26);
    expect(checkUserRoster(repo, season)).toEqual([]);
    d.close();
  });
});
