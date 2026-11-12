import { afterEach, describe, expect, it } from 'vitest';
import { assignGrades, compensationFor, validateForeign } from '../src/engine/contracts';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';
import type { Dispatcher } from '../src/host/dispatcher';

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

describe('계약 규칙', () => {
  it('FA 등급: 직전 연봉 상위 30% A, 30~60% B, 나머지 C', () => {
    const g = assignGrades(Array.from({ length: 10 }, (_, i) => ({ id: i + 1, salary: (10 - i) * 1e8 })));
    expect([...g.values()].filter((x) => x === 'A')).toHaveLength(3);
    expect([...g.values()].filter((x) => x === 'B')).toHaveLength(3);
    expect(g.get(1)).toBe('A');
    expect(g.get(10)).toBe('C');
    expect(compensationFor('A', 5e8)).toBe(15e8);
    expect(compensationFor('C', 2e8)).toBe(3e8);
  });
  it('외국인 구성 검증 (D-046·D-048)', () => {
    const p = (isPitcher: boolean, salaryUsd = 900_000, isNew = false, renewals = 0) => ({ origin: 'foreign' as const, isPitcher, salaryUsd, renewals, isNew });
    expect(validateForeign([p(true), p(true), p(false)])).toEqual([]);
    expect(validateForeign([p(true), p(true), p(true)]).join()).toContain('모두 투수');
    expect(validateForeign([p(true, 1_100_000, true)]).join()).toContain('100만 달러');
    // D-225 (5): 총액·재계약 증액 상한 없음
    expect(validateForeign([p(true, 1_500_000), p(true, 1_500_000), p(false, 1_500_000)])).toEqual([]);
    expect(validateForeign([{ origin: 'asia', isPitcher: true, salaryUsd: 250_000, renewals: 0, isNew: true }]).join()).toContain('20만');
    expect(validateForeign([{ origin: 'asia', isPitcher: true, salaryUsd: 250_000, renewals: 1, isNew: false, priorUsd: 200_000 }]).join()).toContain('20만');
  });
});

describe('스토브리그 선수 시장', () => {
  it('세계 생성: 구단마다 40명(국내 36 + 외국인 3 + 아시아쿼터 1), 해외 풀 존재', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 2, saveName: 't', seed: 'world' });
    const players = d.saves.repository().getPlayers();
    for (const c of d.saves.repository().getClubs()) {
      const r = players.filter((p) => p.clubId === c.id);
      expect(r).toHaveLength(40);
      expect(r.filter((p) => p.origin === 'foreign')).toHaveLength(3);
      expect(r.filter((p) => p.origin === 'asia')).toHaveLength(1);
      expect(r.filter((p) => p.level === '1군')).toHaveLength(26);
    }
    expect(players.filter((p) => p.clubId === null && p.origin !== 'domestic').length).toBeGreaterThan(20);
    d.close();
  });

  it('FA 공시 → 신청 → 승인(등급) → 시장 개장, 시장 전에는 제안 불가', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 5, saveName: 't', seed: 'fa-flow' });
    let v = await call(d, 'market.view');
    expect(v.fa).toHaveLength(0);
    await weeks(d, 1); // → 11/16 (공시·신청 마감 지남)
    v = await call(d, 'market.view');
    expect(v.fa.length).toBeGreaterThan(0);
    const star = v.fa.find((f) => f.franchise)!;
    // D-225 (5): 공시·신청 → 시장 개장 2단계. 공시일에 신청·등급이 함께 정해진다
    expect(star.statusKey).toBe('approved');
    expect(star.faGrade).not.toBeNull();
    const early = await d.respond('market.faOffer', { playerId: star.playerId, years: 4, salaryWon: 5e8, bonusWon: 10e8 });
    expect(early.ok).toBe(false);
    await weeks(d, 1); // → 11/23 (승인·개장 지남)
    v = await call(d, 'market.view');
    const approved = v.fa.filter((f) => f.statusKey === 'approved' || f.statusKey === 'signed');
    expect(approved.length).toBeGreaterThan(0);
    expect(approved.every((f) => f.faGrade !== null)).toBe(true);
    d.close();
  });

  it('간판 FA에게 요구 조건 이상을 제안하면 바로 계약하고, 계약금이 장부에 반영된다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'sign-star' });
    await call(d, 'game.advance', { mode: 'week' });
    // 시장 개장(11/17) 직후 화요일까지 진행할 수 없으므로(1주 단위), 2주차 초(11/16)에 승인됨 → 11/17 개장 전. 다음 주로 넘긴다.
    await call(d, 'game.advance', { mode: 'week' });
    let v = await call(d, 'market.view');
    const star = v.fa.find((f) => f.franchise)!;
    if (star.statusKey === 'signed') return; // 첫 일요일(11/22)에 이미 다른 구단과 계약했을 수 있다
    const cashBefore = v.cashWon;
    const apBefore = v.apRemaining;
    const generous = { years: star.demand.years, salaryWon: Math.round(star.demand.salaryWon * 1.3), bonusWon: Math.round(star.demand.bonusWon * 1.3) };
    const r = await call(d, 'market.faOffer', { playerId: star.playerId, ...generous });
    expect(r.result).toBe('accept');
    v = await call(d, 'market.view');
    expect(v.apRemaining).toBe(apBefore - 1);
    expect(v.cashWon).toBe(cashBefore - generous.bonusWon);
    const p = d.saves.repository().getPlayer(star.playerId)!;
    expect(p.clubId).toBe(7);
    expect(p.contractYears).toBe(generous.years);
    expect(v.fa.find((f) => f.playerId === star.playerId)!.statusKey).toBe('signed');
    d.close();
  });

  it('턱없이 낮은 제안은 거절되고 비용은 행동력만 든다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'low-offer' });
    await weeks(d, 2);
    const v = await call(d, 'market.view');
    const target = v.fa.find((f) => f.statusKey === 'approved')!;
    const r = await call(d, 'market.faOffer', { playerId: target.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 });
    expect(r.result).toBe('reject');
    const after = await call(d, 'market.view');
    expect(after.cashWon).toBe(v.cashWon);
    expect(after.apRemaining).toBe(v.apRemaining - 1);
    d.close();
  });

  it('다른 구단 FA를 영입하면 원소속 구단에 보상금이 간다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'comp' });
    await weeks(d, 2);
    const v = await call(d, 'market.view');
    // 현금으로 감당할 수 있는 가장 싼 다른 구단 FA
    const target = v.fa.filter((f) => f.statusKey === 'approved' && f.originClub.id !== 7).sort((a, b) => a.demand.totalWon + a.compensationWon - (b.demand.totalWon + b.compensationWon))[0];
    if (!target) return;
    const repo = d.saves.repository();
    const originCash = repo.cashBalance(target.originClub.id);
    const r = await call(d, 'market.faOffer', { playerId: target.playerId, years: target.demand.years, salaryWon: Math.round(target.demand.salaryWon * 1.4), bonusWon: Math.round(target.demand.bonusWon * 1.4) });
    expect(r.result).toBe('accept');
    expect(repo.cashBalance(target.originClub.id)).toBe(originCash + target.compensationWon);
    d.close();
  });

  it('현금이 부족하면 제안할 수 없다 (계약금 + 보상금)', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 3, saveName: 't', seed: 'cash-short' });
    await weeks(d, 2);
    const v0 = await call(d, 'market.view');
    // 계약금 + 보상금을 낼 수 없도록 현금을 줄인다(테스트용 장부 조작)
    const target = v0.fa.find((f) => f.statusKey === 'approved' && f.demand.bonusWon + f.compensationWon > 0)!;
    const need = target.demand.bonusWon + target.compensationWon;
    d.saves.repository().addLedger([{ clubId: 3, date: '2026-11-22', category: 'generalAdmin', amount: -(v0.cashWon - need + 1), memo: '테스트: 현금 부족 만들기' }]);
    const v = await call(d, 'market.view');
    expect(v.cashWon).toBeLessThan(need);
    const r = await d.respond('market.faOffer', { playerId: target.playerId, years: target.demand.years, salaryWon: target.demand.salaryWon, bonusWon: target.demand.bonusWon });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CASH_SHORT');
    expect((await call(d, 'market.view')).apRemaining).toBe(v.apRemaining);
    d.close();
  });

  it('행동력이 없으면 제안할 수 없다', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'ap' });
    await weeks(d, 2);
    const v = await call(d, 'market.view');
    // 세션 과금(D-130·D-136): 선수별 그 주 첫 제안만 행동력 1이므로, 서로 다른 선수에게 한 번씩 제안해 행동력을 소진한다.
    const targets = v.fa.filter((f) => f.statusKey === 'approved');
    // D-217: 스토브리그 행동력은 턴마다 주간 최대치 × 2. FA 대상보다 많으면 선수 조사(행동력 1)로 먼저 줄인다
    const own = (await call(d, 'game.players', { scope: 'mine', group: 'all' })).map((p) => p.id);
    let left = v.apRemaining;
    for (let i = 0; left >= targets.length && i < own.length; i++, left--) await call(d, 'player.scout', { playerId: own[i]! });
    expect(targets.length).toBeGreaterThan(left);
    for (let i = 0; i < left; i++) await call(d, 'market.faOffer', { playerId: targets[i]!.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 });
    const r = await d.respond('market.faOffer', { playerId: targets[left]!.playerId, years: 1, salaryWon: 30_000_000, bonusWon: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AP_SHORT');
    d.close();
  });

  it('40명 초과(직접 운영): 진행은 멈추지 않고 비서 할 일로 올라오며, 직접 방출하면 안건이 끝난다. 남은 계약 연봉은 계속 지급된다 (D-095)', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 6, saveName: 't', seed: 'roster' });
    const ops = (await call(d, 'org.view')).policies.find((p) => p.team === 'ops')!;
    await call(d, 'org.setPolicy', { ...ops, mode: 'direct' });
    await weeks(d, 2);
    const repo = d.saves.repository();
    // 해외 풀 선수를 강제로 넣어 41명을 만든다 (규정 검사를 우회하는 테스트용 조작)
    const pool = repo.getPlayers().filter((p) => p.clubId === null && p.origin === 'foreign');
    // 우리 FA가 다른 구단으로 떠나면 자연히 줄어들 수 있어 넉넉히 넘긴다.
    const need = 44 - repo.getPlayers().filter((p) => p.clubId === 6).length;
    repo.savePlayers(pool.slice(0, need).map((p) => ({ ...p, clubId: 6, origin: 'domestic' as const })));
    const r = await call(d, 'game.advance', { mode: 'week' }); // 11/23 → 11/30(월), 차단 없이 진행
    expect(r.daysProcessed).toBe(7);
    expect((await call(d, 'game.dashboard')).date).toBe('2026-11-30');
    const todo = (await call(d, 'game.dashboard')).tasks.find((x) => x.title.includes('40명 이하로 정리'))!;
    expect(todo.level).toBe('필수');
    expect(todo.due).toBe('2026-11-30');
    expect(todo.detail).toContain('자동 적용');
    expect(repo.getTasks({ kind: 'roster' })[0]!.status).toBe('queued'); // 직접 운영: 운영팀이 먼저 방출하지 않는다
    // 구단주가 직접 방출해 40명으로 맞춘다. 남은 계약 연봉은 계속 지급된다.
    const v = await call(d, 'market.view');
    const withYears = v.releasable.find((p) => p.contractYears > 0 && p.origin === 'domestic')!;
    const rel = await call(d, 'market.release', { playerId: withYears.playerId });
    expect(rel.result).toBe('accept');
    expect(repo.getObligations().some((o) => o.playerId === withYears.playerId && o.seasons[0] === 2027)).toBe(true);
    const extra = repo.getPlayers().filter((p) => p.clubId === 6).length - 40;
    for (const p of (await call(d, 'market.view')).releasable.filter((x) => x.origin === 'domestic' && x.playerId !== withYears.playerId).slice(0, extra)) await call(d, 'market.release', { playerId: p.playerId });
    expect(repo.getPlayers().filter((p) => p.clubId === 6)).toHaveLength(40);
    const r2 = await call(d, 'game.advance', { mode: 'week' });
    expect(r2.daysProcessed).toBe(7);
    expect(repo.getTasks({ kind: 'roster' })[0]!.status).toBe('done');
    expect(repo.getInbox(500).some((m) => m.title.startsWith('마감 자동 적용'))).toBe(false);
    d.close();
  });

  it('연봉 협상: 12/1 시작, 1/10까지 합의 못 하면 중간값 조정. 시즌 시작 시 계약 연수 감소·1군 재구성', async () => {
    const d = makeDispatcher(newDir());
    await call(d, 'game.new', { clubId: 8, saveName: 't', seed: 'salary' });
    await weeks(d, 4); // → 12/7
    let v = await call(d, 'market.view');
    expect(v.salaryTalks.length).toBeGreaterThan(5);
    const t = v.salaryTalks[0]!;
    const res = await call(d, 'market.salaryOffer', { playerId: t.playerId, offerWon: t.demandWon });
    expect(res.result).toBe('accept');
    await weeks(d, 5); // → 1/11
    v = await call(d, 'market.view');
    expect(v.salaryTalks.every((x) => x.status !== '협상 중')).toBe(true);
    const arbitrated = v.salaryTalks.find((x) => x.status === '조정 결정');
    if (arbitrated) expect(arbitrated.finalWon).toBe(Math.round((arbitrated.offerWon + arbitrated.demandWon) / 2 / 1e6) * 1e6);
    while ((await call(d, 'game.dashboard')).phase === 'stove') await call(d, 'game.advance', { mode: 'week' });
    const repo = d.saves.repository();
    for (const c of repo.getClubs()) {
      const r = repo.getPlayers().filter((p) => p.clubId === c.id);
      expect(r.length).toBeLessThanOrEqual(40);
      expect(r.filter((p) => p.level === '1군')).toHaveLength(26);
      expect(r.filter((p) => p.origin === 'foreign').length).toBeLessThanOrEqual(3);
      expect(r.filter((p) => p.origin === 'asia').length).toBeLessThanOrEqual(1);
    }
    // 1년 계약으로 합의한 선수는 시즌 시작 후 0(이번 시즌으로 만료)
    expect(repo.getPlayer(t.playerId)!.contractYears).toBe(0);
    d.close();
  });

  it('같은 시드·같은 행동이면 시장 결과도 같다', async () => {
    const run = async () => {
      const d = makeDispatcher(newDir());
      await call(d, 'game.new', { clubId: 10, saveName: 't', seed: 'market-repro' });
      await weeks(d, 6);
      const fa = d.saves.repository().getFa(2026).map((e) => `${e.playerId}:${e.status}:${e.signedClub}:${JSON.stringify(e.contract)}`).join('|');
      const fp = fingerprint(d);
      d.close();
      return fa + fp;
    };
    expect(await run()).toBe(await run());
  });
});
