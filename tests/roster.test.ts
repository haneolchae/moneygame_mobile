// 마감일 있는 의무 안건: 40인 초과 정리 (D-095)
import { afterEach, describe, expect, it } from 'vitest';
import { LEAGUE } from '../src/engine/config';
import { GameService } from '../src/game/service';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkRosterLimits } from '../src/host/invariants';
import type { DelegationModeView } from '../src/shared/protocol';
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

const CLUB = 6;

/**
 * 새 게임 → 운영팀 모드 설정 → 11/16까지 진행 → 해외 풀 선수를 강제로 넣어 우리 선수단을 over명 초과로 만든다(테스트용 조작).
 * 스토브리그는 1주 단위로만 진행한다: 11/16 주에 안건 생성(마감 11/30, 준비 기간 전), 11/23 주에 운영팀이 처리한다.
 */
async function overRoster(mode: DelegationModeView, over: number, seed: string): Promise<Dispatcher> {
  const d = makeDispatcher(newDir());
  await call(d, 'game.new', { clubId: CLUB, saveName: 't', seed });
  const ops = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
  await call(d, 'org.setPolicy', { ...ops, mode });
  await call(d, 'game.advance', { mode: 'week' }); // → 11/16(월)
  const repo = d.saves.repository();
  const pool = repo.getPlayers().filter((p) => p.clubId === null && p.origin === 'foreign');
  const need = LEAGUE.rosterMax + over - repo.getPlayers().filter((p) => p.clubId === CLUB).length;
  repo.savePlayers(pool.slice(0, need).map((p) => ({ ...p, clubId: CLUB, origin: 'domestic' as const })));
  return d;
}

const rosterOf = (d: Dispatcher) => d.saves.repository().getPlayers().filter((p) => p.clubId === CLUB).length;
const inboxTitles = (d: Dispatcher) => d.saves.repository().getInbox(500).map((m) => m.title);

describe('40인 초과 의무 안건 (D-095)', () => {
  it('완전 위임: 운영팀이 마감 전 기간에 가치 낮은 순으로 정리하고 통보한다. AI 구단과 같은 정리 규칙을 쓴다', async () => {
    const d = await overRoster('auto', 4, 'duty-auto');
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    // 운영팀 제안안 = AI 구단 명단 정리와 같은 Market.trimPlan 결과
    expect(new GameService(repo).org.rosterProposal(meta).ids).toHaveLength(4);
    await call(d, 'game.advance', { mode: 'week' }); // 11/16~22: 안건만 생성(마감 14일 전)
    expect(rosterOf(d)).toBeGreaterThan(LEAGUE.rosterMax);
    expect(repo.getTasks({ kind: 'roster' })[0]!.note).toContain('7일 전부터');
    // 11/23 처리 직전의 운영팀 제안안이 그대로 실행된다.
    const expected = new GameService(repo).org.rosterProposal(repo.getMeta()).ids;
    await call(d, 'game.advance', { mode: 'week' }); // 11/23 처리: 마감 7일 전이라 실행
    expect(rosterOf(d)).toBeLessThanOrEqual(LEAGUE.rosterMax);
    for (const id of expected) expect(repo.getPlayers().find((p) => p.id === id)!.clubId).toBeNull();
    expect(inboxTitles(d).some((t) => t.startsWith(`위임 처리: 40인 명단 정리 (${expected.length}명 방출)`))).toBe(true);
    expect(repo.getTasks({ kind: 'roster' })[0]!.status).toBe('done');
    // 보류 명단 마감일(11/30) 하루를 처리한 직후 모든 구단(AI 포함)이 40명 이하
    new GameService(repo).advanceOneDay();
    expect(repo.getMeta().currentDate).toBe('2026-12-01');
    expect(checkRosterLimits(repo)).toEqual([]);
    d.close();
  });

  it('제안 후 승인: 정리안이 결재로 올라오고, 승인하면 실행 시점 초과 인원만큼 방출한다', async () => {
    const d = await overRoster('approve', 4, 'duty-approve');
    await call(d, 'game.advance', { mode: 'week' });
    await call(d, 'game.advance', { mode: 'week' }); // 11/23 상정 → 11/30(마감일, 아직 처리 전)
    expect(rosterOf(d)).toBeGreaterThan(LEAGUE.rosterMax); // 승인 전에는 방출하지 않는다
    const dash = await call(d, 'game.dashboard');
    const a = dash.approvals.find((x) => x.kind === 'roster')!;
    expect(a.summary).toContain('명 방출안');
    expect(a.summary).toContain('2026-11-30');
    const r = await call(d, 'org.approve', { approvalId: a.id });
    expect(r.result).toBe('accept');
    expect(rosterOf(d)).toBe(LEAGUE.rosterMax);
    expect(d.saves.repository().getTasks({ kind: 'roster' })[0]!.status).toBe('done');
    d.close();
  });

  it('반려해도 안건은 남고, 마감일까지 미처리면 운영팀 제안안을 자동 적용하고 구단주에게 알린다', async () => {
    const d = await overRoster('approve', 4, 'duty-reject');
    await call(d, 'game.advance', { mode: 'week' });
    await call(d, 'game.advance', { mode: 'week' }); // → 11/30(마감일, 아직 처리 전)
    const a = (await call(d, 'game.dashboard')).approvals.find((x) => x.kind === 'roster')!;
    const rej = await call(d, 'org.reject', { approvalId: a.id });
    expect(rej.message).toContain('자동 적용');
    const task = d.saves.repository().getTasks({ kind: 'roster' })[0]!;
    expect(task.status).toBe('queued');
    expect(task.params.hold).toBe(true); // 반려 뒤에는 다시 상정하지 않는다
    const cancel = await d.respond('org.cancelTask', { taskId: task.id });
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.error.code).toBe('OBLIGATION');
    const before = rosterOf(d);
    expect(before).toBeGreaterThan(LEAGUE.rosterMax);
    const repo = d.saves.repository();
    new GameService(repo).advanceOneDay(); // 11/30 처리: 마감 자동 적용
    expect(rosterOf(d)).toBe(LEAGUE.rosterMax);
    expect(inboxTitles(d).some((t) => t.startsWith(`마감 자동 적용: 40인 명단 정리 (${before - LEAGUE.rosterMax}명 방출)`))).toBe(true);
    expect(checkRosterLimits(repo)).toEqual([]);
    d.close();
  });
});
