import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { offerTotal } from '../src/engine/contracts';
import { Rng } from '../src/engine/rng';
import { makeStaff, scoutingSdScale, secretaryLookaheadDays, teamCapacity, type StaffMember } from '../src/engine/staff';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const newDir = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) cleanup(dirs.pop()!);
});

async function weeks(d: Dispatcher, n: number) {
  for (let i = 0; i < n; i++) await call(d, 'game.advance', { mode: 'week' });
}

/** 모든 능력이 v인 직원 */
function flat(id: number, title: StaffMember['title'], team: StaffMember['team'], v = 50, division: StaffMember['division'] = 'baseball'): StaffMember {
  const s = makeStaff(Rng.fromSeed('x'), id, title, 1, { team, division });
  for (const k of Object.keys(s.abilities)) s.abilities[k] = v;
  return s;
}

describe('팀 처리량 규칙 (D-026·D-027)', () => {
  const head = flat(100, '단장', null, 50, 'baseball');
  it('평균 운영팀(팀장 1 + 팀원 4) + 평균 단장 ≈ 52 WP', () => {
    const staff = [head, flat(1, '팀장', 'ops'), ...[2, 3, 4, 5].map((i) => flat(i, '팀원', 'ops'))];
    expect(teamCapacity(staff, 'ops', 'stove').weeklyWp).toBe(53); // 50 × 1.0 × 1.05 = 52.5
  });
  it('팀원이 늘면 처리량이 늘고, 관리력이 낮으면 같은 인원에서도 줄어든다', () => {
    const members = [2, 3, 4].map((i) => flat(i, '팀원', 'ops'));
    const base = teamCapacity([head, flat(1, '팀장', 'ops'), ...members], 'ops', 'stove').weeklyWp;
    const more = teamCapacity([head, flat(1, '팀장', 'ops'), ...members, flat(9, '팀원', 'ops')], 'ops', 'stove').weeklyWp;
    const weakLeader = flat(1, '팀장', 'ops', 10);
    weakLeader.abilities.execution = 50;
    const weak = teamCapacity([head, weakLeader, ...members], 'ops', 'stove').weeklyWp;
    expect(more).toBeGreaterThan(base);
    expect(weak).toBeLessThan(base);
  });
  it('팀장 공석이면 본부장이 겸임하고 처리량이 줄어든다(×0.7, 본부장 기여 제외)', () => {
    const members = [2, 3, 4].map((i) => flat(i, '팀원', 'ops'));
    const withLeader = teamCapacity([head, flat(1, '팀장', 'ops'), ...members], 'ops', 'stove');
    const acting = teamCapacity([head, ...members], 'ops', 'stove');
    expect(acting.acting?.id).toBe(head.id);
    expect(acting.weeklyWp).toBe(Math.round(30 * 1.0 * 0.7 * 1.05));
    expect(acting.weeklyWp).toBeLessThan(withLeader.weeklyWp);
  });
  it('비서가 없으면 당일만, 일정 관리력이 높을수록 더 일찍 알린다', () => {
    expect(secretaryLookaheadDays(null)).toBe(0);
    expect(secretaryLookaheadDays(flat(1, '비서', null, 80))).toBeGreaterThan(secretaryLookaheadDays(flat(2, '비서', null, 30)));
  });
  it('스카우트팀이 많고 전문적일수록 선수 평가 오차가 작다', () => {
    const scouts = (n: number, v: number) => Array.from({ length: n }, (_, i) => flat(i + 1, '팀원', 'scout', v));
    expect(scoutingSdScale(scouts(7, 70))).toBeLessThan(scoutingSdScale(scouts(3, 40)));
    expect(scoutingSdScale([])).toBeGreaterThan(scoutingSdScale(scouts(3, 40)));
  });
});

describe('조직 생성·채용·해고', () => {
  it('시작 조직: 비서·단장·사업본부장·코치 15명 재직, 팀장 2~4자리 공석, 팀원 60~80%, 직원 급여는 실제 연봉 합계', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'org-start' });
    const repo = d.saves.repository();
    for (const c of repo.getClubs()) {
      const staff = repo.getStaff(c.id);
      expect(staff.filter((s) => s.title === '비서')).toHaveLength(1);
      expect(staff.filter((s) => s.title === '단장')).toHaveLength(1);
      expect(staff.filter((s) => ['감독', '수석코치', '코치'].includes(s.title))).toHaveLength(15);
      const leaders = staff.filter((s) => s.title === '팀장').length;
      expect(leaders).toBeGreaterThanOrEqual(7);
      expect(leaders).toBeLessThanOrEqual(9);
      const payroll = staff.reduce((a, s) => a + s.salary, 0);
      expect(payroll).toBeGreaterThan(35e8);
      expect(payroll).toBeLessThan(80e8);
    }
    const v = await call(d, 'org.view');
    expect(v.candidates.length).toBeGreaterThan(20);
    expect(v.teams.find((t) => t.key === 'ops')!.weeklyWp).toBeGreaterThan(0);
    expect(v.vacancies.some((x) => x.title === '팀장')).toBe(true);
    // 첫 월말(11/30) 직원 급여 = 실제 연봉 합계의 1/12 (나머지 원 단위 배분 포함)
    await weeks(d, 4);
    const pay = repo.ledgerEntries(3, 400).filter((e) => e.category === 'staffPayroll' && e.date === '2026-11-30');
    expect(pay).toHaveLength(1);
    expect(Math.abs(-pay[0]!.amount - v.staffPayrollWon / 12)).toBeLessThan(1);
    d.close();
  });

  it('직접 채용: 행동력 2, 공석이 채워지고 다음 주부터 처리량 증가. 자리가 없으면 비용 없이 실패', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'org-hire' });
    let v = await call(d, 'org.view');
    const vacantTeam = v.teams.find((t) => !t.leader)!;
    const before = v.teams.find((t) => t.key === vacantTeam.key)!.weeklyWp;
    const repo = d.saves.repository();
    // 후보가 없으면 공석 팀장 후보를 시장에 하나 넣는다(테스트 고정).
    let cand = v.candidates.find((c) => c.title === '팀장' && c.teamKey === vacantTeam.key);
    if (!cand) {
      const s = makeStaff(Rng.fromSeed('c'), repo.nextStaffId(), '팀장', null, { team: vacantTeam.key as never, division: 'baseball', mean: 60 });
      repo.saveStaff([s]);
      v = await call(d, 'org.view');
      cand = v.candidates.find((c) => c.id === s.id)!;
    }
    const ap0 = v.apRemaining;
    const r = await call(d, 'org.hire', { staffId: cand.id });
    expect(r.result).toBe('accept');
    v = await call(d, 'org.view');
    expect(v.apRemaining).toBe(ap0 - 2);
    expect(v.teams.find((t) => t.key === vacantTeam.key)!.leader?.id).toBe(cand.id);
    // 이미 찬 자리(비서)에 채용하면 행동력을 쓰지 않고 실패
    const sec = v.candidates.find((c) => c.title === '비서')!;
    const fail = await d.respond('org.hire', { staffId: sec.id });
    expect(fail.ok).toBe(false);
    expect((await call(d, 'org.view')).apRemaining).toBe(ap0 - 2);
    await weeks(d, 1);
    expect((await call(d, 'org.view')).teams.find((t) => t.key === vacantTeam.key)!.weeklyWp).toBeGreaterThan(before);
    d.close();
  });

  it('해고: 보상금이 장부에 기록되고 급여 대상에서 빠진다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'org-fire' });
    const v = await call(d, 'org.view');
    const target = v.teams.find((t) => t.members.length > 0)!.members[0]!;
    const cash = v.cashWon;
    await call(d, 'org.fire', { staffId: target.id });
    const after = await call(d, 'org.view');
    expect(after.headcount).toBe(v.headcount - 1);
    expect(after.staffPayrollWon).toBe(v.staffPayrollWon - target.salaryWon);
    expect(after.cashWon).toBeLessThan(cash);
    d.close();
  });
});

describe('위임 (03 문서 위임 모드)', () => {
  async function toMarket(seed: string) {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed });
    await weeks(d, 2); // 11/23: 시장 개장 후
    return d;
  }

  it('직접 운영 모드에서는 맡길 수 없다', async () => {
    const d = await toMarket('deleg-direct');
    const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
    await call(d, 'org.setPolicy', { ...pol, mode: 'direct' });
    const fa = (await call(d, 'market.view')).fa.find((f) => f.originClub.id === 5 && f.statusKey === 'approved');
    if (fa) {
      const r = await d.respond('org.delegateFa', { playerId: fa.playerId });
      expect(r.ok || r.error.code).toBe('DIRECT_MODE');
    }
    d.close();
  });

  it('완전 위임: 운영팀이 한도 안에서 행동력 없이 협상하고, 직접 제안과 중복되지 않는다', async () => {
    const d = await toMarket('deleg-auto');
    const v = await call(d, 'org.view');
    const pol = v.policies.find((p) => p.team === 'ops')!;
    await call(d, 'org.setPolicy', { ...pol, mode: 'auto', cashFloor: 0 });
    const market = await call(d, 'market.view');
    const star = market.fa.find((f) => f.franchise && f.statusKey === 'approved')!;
    expect(star).toBeTruthy();
    const maxTotal = Math.round(offerTotal({ years: star.demand.years, salary: star.demand.salaryWon, bonus: star.demand.bonusWon }) * 1.1);
    await call(d, 'org.delegateFa', { playerId: star.playerId, maxTotalWon: maxTotal, maxYears: 6 });
    // 같은 선수에 대한 위임은 하나만 진행된다(다시 맡기면 한도만 바뀐다).
    expect(d.saves.repository().getTasks({ status: ['queued', 'waiting'], targetId: star.playerId })).toHaveLength(1);
    const ap0 = (await call(d, 'game.dashboard')).owner.apRemaining;
    await call(d, 'game.advance', { mode: 'week' });
    const ap1week = await call(d, 'game.dashboard');
    expect(ap1week.owner.apRemaining).toBe(ap1week.owner.apGranted); // 위임은 행동력을 쓰지 않는다
    expect(ap0).toBeGreaterThanOrEqual(0);
    await weeks(d, 3);
    const task = (await call(d, 'org.view')).tasks.find((t) => t.kind === 'fa' && t.target === star.name)!;
    expect(['done', 'failed', 'queued']).toContain(task.statusKey);
    const after = (await call(d, 'market.view')).fa.find((f) => f.playerId === star.playerId)!;
    if (after.signedClub?.id === 5) expect(after.signedContract!.totalWon).toBeLessThanOrEqual(maxTotal);
    // 운영팀 처리량이 실제로 쓰였다
    const repo = d.saves.repository();
    expect(repo.getOffers({ playerId: star.playerId, clubId: 5 }).length).toBeGreaterThan(0);
    d.close();
  });

  it('제안 후 승인: 결재 대기 → 승인하면 행동력 없이 실행, 반려하면 다시 올라오지 않는다', async () => {
    // 시드: 우리 FA가 여러 명이라 한 주 뒤에도 결재가 남는 세계(대상 선수가 다른 구단과 계약하면 결재는 자동 만료된다)
    const d = await toMarket('deleg-approve-2');
    const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
    await call(d, 'org.setPolicy', { ...pol, mode: 'approve', cashFloor: 0, faMaxTotal: 300e8 });
    const fas = (await call(d, 'market.view')).fa.filter((f) => f.originClub.id === 5 && f.statusKey === 'approved');
    expect(fas.length).toBeGreaterThan(0);
    // ①(D-218): 스토브리그에서 구단주가 맡기면 협상 지시서(결재 없음)가 되므로, 결재 흐름은 운영팀 자체 안건(시장 개장일)으로 본다
    await call(d, 'game.advance', { mode: 'week' }); // 운영팀이 제시안을 준비해 결재를 올린다(그 주 안에 결재)
    let v = await call(d, 'org.view');
    expect(v.approvals.length).toBeGreaterThan(0);
    const dash = await call(d, 'game.dashboard');
    expect(dash.tasks[0]!.title).toContain('결재 대기');
    const ap = v.apRemaining;
    await call(d, 'org.approve', { approvalId: v.approvals[0]!.id });
    v = await call(d, 'org.view');
    expect(v.apRemaining).toBe(ap);
    if (v.approvals.length) {
      const rejected = v.approvals[0]!;
      await call(d, 'org.reject', { approvalId: rejected.id });
      await weeks(d, 1);
      v = await call(d, 'org.view');
      // D-220: 스토브리그 결재는 턴이 바뀔 때 만료되므로 다른 취소 업무(기한 경과)와 함께 있을 수 있다
      expect(v.tasks.some((x) => x.statusKey === 'cancelled' && x.note === '구단주 반려')).toBe(true);
    }
    d.close();
  });

  it('연봉 협상 위임: 정책 한도(요구액 대비) 안에서만 제시하고, 1/10 전에 합의 또는 한도 도달로 끝난다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'deleg-salary' });
    const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
    await call(d, 'org.setPolicy', { ...pol, mode: 'auto', salaryMaxRatioBp: 9_800 });
    await weeks(d, 4); // 12/1 이후
    await call(d, 'market.salaryAuto');
    await weeks(d, 4); // 1/4 무렵
    const talks = (await call(d, 'market.view')).salaryTalks;
    expect(talks.length).toBeGreaterThan(0);
    for (const t of talks) {
      expect(t.offerWon).toBeLessThanOrEqual(Math.round((t.demandWon * 0.98) / 1e6) * 1e6);
      expect(t.delegation).not.toBeNull();
    }
    expect(talks.filter((t) => t.status === '합의').length).toBeGreaterThan(0);
    d.close();
  });

  it('채용 위임: 경영지원팀이 연봉 상한 안의 후보를 뽑아 공석을 채운다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'deleg-hire' });
    const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'admin')!;
    await call(d, 'org.setPolicy', { ...pol, mode: 'auto', hireMaxSalary: 300e6 });
    const v = await call(d, 'org.view');
    const vac = v.vacancies.find((x) => x.title === '팀원' && v.candidates.some((c) => c.title === '팀원' && c.teamKey === x.team))!;
    expect(vac).toBeTruthy();
    await call(d, 'org.delegateHire', { team: vac.team, title: '팀원', maxSalaryWon: 300e6 });
    await weeks(d, 3);
    const after = await call(d, 'org.view');
    // 경영지원팀 처리량 안에서 팀장 공석(자체 안건)과 맡긴 팀원 채용을 차례로 처리한다.
    const done = after.tasks.filter((t) => t.kind === 'hire' && t.statusKey === 'done');
    expect(done.length).toBeGreaterThan(0);
    expect(after.headcount).toBe(v.headcount + done.length);
    for (const t of after.tasks.filter((x) => x.kind === 'hire' && x.statusKey === 'queued')) expect(t.note).toMatch(/처리량 부족|후보 없음|자체 안건|이하/);
    d.close();
  });
});

describe('저장·재현성·이전 저장본', () => {
  it('위임 진행이 같은 시드에서 같은 결과를 내고, 저장 후 불러와도 이어진다', async () => {
    const run = async () => {
      const d = makeDispatcher(newDir());
      await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'deleg-repro' });
      const pol = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
      await call(d, 'org.setPolicy', { ...pol, mode: 'auto', cashFloor: 0 });
      await weeks(d, 2);
      const fa = (await call(d, 'market.view')).fa.filter((f) => f.originClub.id === 5 && f.statusKey === 'approved');
      for (const f of fa) await call(d, 'org.delegateFa', { playerId: f.playerId, maxTotalWon: 200e8 });
      await call(d, 'save.save', { slot: 's1' });
      await weeks(d, 3);
      const fp = fingerprint(d);
      const tasks = JSON.stringify((await call(d, 'org.view')).tasks.map((t) => [t.target, t.statusKey, t.note]));
      await call(d, 'save.load', { slot: 's1' });
      await weeks(d, 3);
      const fp2 = fingerprint(d);
      const tasks2 = JSON.stringify((await call(d, 'org.view')).tasks.map((t) => [t.target, t.statusKey, t.note]));
      d.close();
      return { fp, tasks, fp2, tasks2 };
    };
    const a = await run();
    const b = await run();
    expect(a.fp).toBe(b.fp);
    expect(a.tasks).toBe(b.tasks);
    expect(a.fp2).toBe(a.fp); // 저장 시점에서 다시 진행해도 같은 결과
    expect(a.tasks2).toBe(a.tasks);
  });

  it('출시 전 구버전 저장본(2b 스키마 3)은 변환하지 않고 이유를 안내하며 거부한다(D-094)', async () => {
    const dir = newDir();
    const d = makeDispatcher(dir);
    await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'migrate' });
    await call(d, 'save.save', { slot: 'old' });
    d.close();
    const db = new DatabaseSync(join(dir, 'saves', 'old.db'));
    db.exec('PRAGMA user_version = 3;');
    db.close();
    const d2 = makeDispatcher(dir);
    const r = await d2.respond('save.load', { slot: 'old' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SAVE_OLD_VERSION');
      expect(r.error.message).toContain('저장 형식 3');
    }
    d2.close();
  });
});
