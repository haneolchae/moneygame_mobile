// ① 진행 구조 전환(D-214~D-220, D-229, D-230): 2월 캠프 시작·첫 스토브리그 자동 실행·스토브리그 4턴. 사전 등록 기준 D-231(ST ①~⑥).
import { afterAll, describe, expect, it } from 'vitest';
import { stoveTurnOf, stoveTurns } from '../src/engine/stove';
import { apPeriodId } from '../src/game/week';
import { bonusCapOf, capPayroll } from '../src/engine/contracts';
import { postseasonMaxInnings, UNLIMITED_INNINGS } from '../src/game/postseason';
import type { PlayerTruth } from '../src/engine/types';
import { checkForeignQuota, checkRosterComposition, checkRosterLimits } from '../src/host/invariants';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const opened: Array<ReturnType<typeof makeDispatcher>> = [];
const fresh = () => {
  const dir = tempDir();
  dirs.push(dir);
  const d = makeDispatcher(dir);
  opened.push(d);
  return d;
};
afterAll(() => {
  opened.forEach((d) => d.close());
  dirs.forEach(cleanup);
});

describe('스토브리그 4턴 경계(D-216·D-229)', () => {
  it('2026-27 턴 날짜는 22 문서 예와 같다', () => {
    const t = stoveTurns('2026-11-08');
    expect(t.map((x) => `${x.start}~${x.end}`)).toEqual(['2026-11-09~2026-11-29', '2026-11-30~2026-12-20', '2026-12-21~2027-01-10', '2027-01-11~2027-01-31']);
    expect(stoveTurnOf('2026-11-08', '2026-11-08').index).toBe(1);
    expect(stoveTurnOf('2026-11-08', '2027-01-10').index).toBe(3);
  });
});

describe('새 게임 2월 1일 캠프 시작(D-214·D-215·D-230)', () => {
  it('자동 실행 뒤 캠프에서 보고서·첫 안건·행동력을 받는다', async () => {
    const d = fresh();
    const t0 = Date.now();
    await call(d, 'game.new', { clubId: 10, saveName: 'camp', seed: 'st-camp-a', start: 'camp' });
    const ms = Date.now() - t0;
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    expect(meta.currentDate).toBe('2027-02-01');
    expect(meta.mode).toBe('season');
    expect(meta.season).toBe(2027);
    expect(meta.autoRun ?? null).toBeNull();
    // D-230: 자동 실행 중 업적·경험치 없음
    expect(repo.getAchievements().length).toBe(0);
    expect(meta.ownerXp).toBe(0);
    // D-215: 지난겨울 보고서(실제 기록), 간판 외야수 첫 안건, 외국인 1자리 공석
    expect(meta.winterReport).toBeTruthy();
    expect(meta.winterReport!.foreignCount).toBeLessThanOrEqual(2);
    expect(meta.firstAgenda?.status).toBe('open');
    const star = repo.getPlayer(meta.firstAgenda!.playerId)!;
    expect(star.career.franchise).toBe(true);
    expect(repo.getFa(2026).find((e) => e.playerId === star.id)?.status).toBe('approved');
    // AI 구단은 간판 외야수에게 입찰하지 않았다
    expect(repo.getOffers({ playerId: star.id, kind: 'fa' }).filter((o) => o.clubId !== 10).length).toBe(0);
    // 첫 행동력 지급은 2027-02-01 주(스토브리그 자동 실행 중 지급 없음)
    expect(repo.apWeeks().filter((w) => w.granted > 0).map((w) => w.weekId)).toEqual(['2027-02-01']);
    console.log(`새 게임 생성 ${ms}ms`);
  }, 120_000);
});

/** 소속·FA 상태까지 포함한 비교값 */
function state(d: ReturnType<typeof makeDispatcher>): string {
  const repo = d.saves.repository();
  const players = repo.getPlayers().map((p) => `${p.id}:${p.clubId}:${p.salary}:${p.contractYears}:${p.retired ? 1 : 0}`).join(',');
  const fa = repo.getFa(2026).map((e) => `${e.playerId}:${e.status}:${e.signedClub}`).join(',');
  return `${fingerprint(d)}|${players}|${fa}`;
}

describe('ST ① 같은 시드면 자동 첫 스토브리그 결과가 같다, ② 규정 준수', () => {
  it('같은 시드 두 번 생성: 결과·보고서 동일, 모든 구단 40인·포지션 최소·외국인 보유 기준', async () => {
    const a = fresh();
    const b = fresh();
    await call(a, 'game.new', { clubId: 3, saveName: 'a', seed: 'st-same', start: 'camp' });
    await call(b, 'game.new', { clubId: 3, saveName: 'b', seed: 'st-same', start: 'camp' });
    expect(state(a)).toBe(state(b));
    expect(JSON.stringify(a.saves.repository().getMeta().winterReport)).toBe(JSON.stringify(b.saves.repository().getMeta().winterReport));
    const repo = a.saves.repository();
    expect([...checkRosterLimits(repo), ...checkRosterComposition(repo), ...checkForeignQuota(repo)]).toEqual([]);
  }, 180_000);
});

describe('ST ③ 압축 동등성: 모두 위임하면 4턴 진행과 주 단위 진행의 결과가 같다', () => {
  it('2026-11-08 스토브리그에서 시즌 모드까지', async () => {
    const t = fresh();
    const w = fresh();
    await call(t, 'game.new', { clubId: 5, saveName: 't', seed: 'st-eq', start: 'stove' });
    await call(w, 'game.new', { clubId: 5, saveName: 'w', seed: 'st-eq', start: 'stove' });
    let turns = 0;
    while ((await call(t, 'game.dashboard')).phase === 'stove') {
      await call(t, 'game.advance', { mode: 'turn', autoCards: true });
      turns++;
    }
    while ((await call(w, 'game.dashboard')).phase === 'stove') await call(w, 'game.advance', { mode: 'week', autoCards: true });
    expect(turns).toBe(4);
    expect(t.saves.repository().getMeta().currentDate).toBe('2027-02-01');
    expect(state(t)).toBe(state(w));
  }, 180_000);
});

describe('ST ④·⑤ 결정 없이 턴 진행만으로 캠프 도착, 턴당 멈춤 2회 이하', () => {
  it('구단주 화면 진행(카드 미응답·멈춤 그대로 계속)', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 1, saveName: 'n', seed: 'st-nodecide', start: 'stove' });
    const repo = d.saves.repository();
    const stopsByTurn = new Map<number, number>();
    let calls = 0;
    while ((await call(d, 'game.dashboard')).phase === 'stove' && calls < 40) {
      calls++;
      try {
        const r = await call(d, 'game.advance', { mode: 'turn', autoCards: false });
        const st = repo.getMeta().stoveTurn;
        if (st && r.stoppedReason && !/구간 보고|시즌 모드 시작/.test(r.stoppedReason)) stopsByTurn.set(st.index, (stopsByTurn.get(st.index) ?? 0) + 1);
      } catch (e) {
        // 필수 결정(중대 사건)은 구단주가 골라야 한다: 첫 선택지(기본)로 고르고 계속
        if (!String(e).includes('DECISION_PENDING')) throw e;
        const card = await call(d, 'game.dashboard');
        const view = card.card;
        await call(d, 'events.choose', { choiceId: view!.choices[0]!.id });
      }
    }
    expect(repo.getMeta().mode).toBe('season');
    expect(repo.getMeta().currentDate).toBe('2027-02-01');
    for (const [, n] of stopsByTurn) expect(n).toBeLessThanOrEqual(2);
    console.log('턴별 멈춤', JSON.stringify([...stopsByTurn]), '진행 호출', calls);
  }, 180_000);
});

describe('협상 지시서(D-218)·지시서 범위 밖 멈춤(D-219 ②)', () => {
  it('스토브리그 위임은 결재 없이 범위 안에서 협상하고, 한도에서 막히면 구간 진행이 멈춘다', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 5, saveName: 'dir', seed: 'deleg-approve-2', start: 'stove' });
    for (let i = 0; i < 2; i++) await call(d, 'game.advance', { mode: 'week', autoCards: true }); // 11/23 시장 개장 뒤
    const fas = (await call(d, 'market.view')).fa.filter((f) => f.originClub.id === 5 && f.statusKey === 'approved');
    expect(fas.length).toBeGreaterThan(0);
    // 요구 총액의 30%만 허용하는 지시서 → 한도에서 합의 실패
    for (const f of fas) await call(d, 'org.delegateFa', { playerId: f.playerId, maxTotalWon: Math.max(30_000_000, Math.round(f.demand.totalWon * 0.3)), maxYears: 1 });
    const repo = d.saves.repository();
    expect(repo.getTasks({ status: ['queued'] }).filter((t) => t.kind === 'fa').every((t) => t.params.directive === true)).toBe(true);
    let stop: string | null = null;
    for (let i = 0; i < 3 && !stop; i++) {
      const r = await call(d, 'game.advance', { mode: 'turn', autoCards: false });
      if (r.stoppedReason?.includes('지시서')) stop = r.stoppedReason;
    }
    expect(repo.getApprovals('pending').filter((a) => a.kind === 'fa')).toHaveLength(0);
    expect(stop).toContain('협상 지시서 범위 밖');
    expect(repo.getMeta().stoveTurn!.stops).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

describe('첫 안건 마감 뒤 시장 재개장(D-215·D-233)', () => {
  it('미계약 간판 외야수는 1군에서 빠져 있고, 마감 뒤 떠나도 1군·40인 규정이 지켜진다', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 1, saveName: 'fa', seed: 'verify-1', start: 'camp' });
    const repo = d.saves.repository();
    const id = repo.getMeta().firstAgenda!.playerId;
    expect(repo.getPlayer(id)!.level).toBe('2군');
    while (repo.getMeta().currentDate < '2027-02-16') await call(d, 'game.advance', { mode: 'week', autoCards: true });
    expect(['reopened', 'signed', 'gone']).toContain(repo.getMeta().firstAgenda!.status);
    expect([...checkRosterLimits(repo), ...checkRosterComposition(repo), ...checkForeignQuota(repo)]).toEqual([]);
  }, 180_000);
});

describe('결재 팝업 턴 단위(D-220)', () => {
  it('스토브리그 결재 대기는 턴이 바뀔 때까지 남아 턴 회의에서 처리할 수 있다', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 5, saveName: 'appr', seed: 'deleg-approve-2', start: 'stove' });
    const repo = d.saves.repository();
    while (repo.getMeta().currentDate < '2026-11-30') await call(d, 'game.advance', { mode: 'week', autoCards: true });
    // 1턴(11/9~11/29) 안에 올라온 운영팀 자체 안건 결재가 2턴 첫날(11/30, 턴 회의)까지 남는다
    const pending = repo.getApprovals('pending');
    expect(pending.some((a) => a.date < '2026-11-23')).toBe(true);
    await call(d, 'game.advance', { mode: 'turn', autoCards: true });
    expect(repo.getApprovals('pending').filter((a) => a.date < '2026-11-30')).toHaveLength(0);
  }, 180_000);
});

describe('MLB 관심 카드(D-228)·턴 회의 카드(D-220)', () => {
  it('동의하면 성사 확률로 MLB 진출(이적료) 또는 무산, 답하지 않은 카드는 기본 응답', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 4, saveName: 'mlb', seed: 'st-mlb', start: 'stove' });
    const repo = d.saves.repository();
    const star = repo.getPlayers().filter((p) => p.clubId === 4 && p.origin === 'domestic').sort((a, b) => b.salary - a.salary)[0]!;
    const meta = repo.getMeta();
    const pend = { cardId: 'MLB-01', playerId: star.id, week: 0, weekId: '2026-11-09', date: meta.currentDate, text: '시험' };
    repo.updateMeta({ eventState: { ...(meta.eventState ?? { flags: {}, queue: [], spawns: [], effects: [], pendingLines: [], lastCategory: null, last: { rank: null, fan: null, sellouts: 0, cash: null } }), stoveCards: [pend, { ...pend, cardId: 'CS-04', playerId: null }] } });
    const view = (await call(d, 'game.dashboard')).stove!;
    expect(view.cards.map((c) => c.cardId)).toEqual(['MLB-01', 'CS-04']);
    // 화면 응답에 히든 값·확률 숫자 없음(위험 등급만)
    expect(JSON.stringify(view.cards)).not.toMatch(/selfControl|0\.6/);
    await call(d, 'stove.chooseCard', { cardId: 'MLB-01', choiceId: 'agree' });
    await call(d, 'game.advance', { mode: 'turn', autoCards: false }).catch(() => null);
    const log = repo.getEventLog({ season: 2026 });
    expect(log.find((r) => r.cardId === 'MLB-01')?.by).toBe('owner');
    expect(log.find((r) => r.cardId === 'CS-04')?.by).toBe('delegate'); // 미응답 → 기본 응답
    const after = repo.getPlayer(star.id)!;
    const posted = (repo.getMeta().postings ?? []).find((x) => x.playerId === star.id);
    if (posted) {
      expect(after.clubId).toBeNull();
      expect(after.retired?.reason).toBe('MLB 진출');
      expect(repo.ledgerEntries(4, 100_000).some((e) => e.category === 'postingFee' && e.amount === posted.feeWon)).toBe(true);
    } else expect(log.find((r) => r.cardId === 'MLB-01')?.outcome).toContain('무산');
  }, 180_000);
});

describe('샐러리캡 산정(D-227)·포스트시즌 연장(D-225 (2))·외국인 규정(D-225 (5))', () => {
  it('계약금 연평균은 계약한 구단에 남아 있는 시즌만 들어간다', () => {
    const p = { id: 1, clubId: 3, origin: 'domestic', salary: 5e8, retired: undefined, bonusCap: bonusCapOf(12e8, 4, 3, 2027) } as unknown as PlayerTruth;
    expect(capPayroll([p], 3, 2027)).toBe(5e8 + 3e8);
    expect(capPayroll([p], 3, 2031)).toBe(5e8);
    expect(capPayroll([{ ...p, clubId: 6 }], 6, 2028)).toBe(5e8); // 트레이드 뒤 새 구단은 연봉만
  });
  it('시리즈 마지막 예정 경기만 무제한 이닝', () => {
    expect(postseasonMaxInnings('ks', 7)).toBe(UNLIMITED_INNINGS);
    expect(postseasonMaxInnings('ks', 6)).toBe(15);
    expect(postseasonMaxInnings('semi', 5)).toBe(UNLIMITED_INNINGS);
    expect(postseasonMaxInnings('wc', 2)).toBe(UNLIMITED_INNINGS);
    expect(postseasonMaxInnings('wc', 1)).toBe(15);
  });
});

describe('2h 검증 마무리: 캠프 → 시즌 → 시즌 마감 → 스토브리그 4턴 → 다음 캠프', () => {
  it('첫 시즌을 마치고 4턴 만에 2028 캠프에 도착한다(규정 위반 없음)', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 8, saveName: 'cycle', seed: 'st-cycle', start: 'camp' });
    const repo = d.saves.repository();
    for (let i = 0; i < 6 && repo.getMeta().mode === 'season'; i++) await call(d, 'game.advance', { mode: 'untilSeasonEnd', autoCards: true });
    const meta = repo.getMeta();
    expect(meta.mode).toBe('stove');
    expect(meta.season).toBe(2027);
    // 시즌 마감(2h): 신인 입단·아마추어 진급·다음 시즌 일정·AP 1턴 지급
    expect(repo.getPlayers().some((p) => p.draft?.year === 2027 && p.clubId !== null)).toBe(true);
    expect(repo.getApWeek(stoveTurnOf(meta.kDate, meta.currentDate).start)?.granted).toBeGreaterThanOrEqual(12);
    let turns = 0;
    while (repo.getMeta().mode === 'stove' && turns < 8) {
      await call(d, 'game.advance', { mode: 'turn', autoCards: true });
      turns++;
    }
    expect(turns).toBe(4);
    const after = repo.getMeta();
    expect(after.mode).toBe('season');
    expect(after.season).toBe(2028);
    expect(after.currentDate).toBe(stoveTurns(meta.kDate)[3]!.end.replace(/.*/, (e) => new Date(Date.parse(`${e}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)));
    expect([...checkRosterLimits(repo), ...checkRosterComposition(repo), ...checkForeignQuota(repo)]).toEqual([]);
    // 스토브리그 턴 브리핑이 턴마다 한 번
    expect(stoveTurns(meta.kDate).filter((t) => repo.getNews({ weekId: t.start }).length > 0)).toHaveLength(4);
  }, 600_000);
});

describe('행동력 턴 지급(D-217)·협상 세션 턴 단위(D-218)', () => {
  it('턴마다 주간 최대치 × 2, 저장·불러오기 반복에도 늘지 않는다', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 2, saveName: 'ap', seed: 'st-ap', start: 'stove' });
    const repo = () => d.saves.repository();
    const ap = () => repo().getApWeek(apPeriodId(repo().getMeta()));
    expect(ap()).toMatchObject({ weekId: '2026-11-09', granted: 12 });
    await call(d, 'game.advance', { mode: 'week', autoCards: true });
    expect(ap()?.weekId).toBe('2026-11-09');
    await call(d, 'save.save', { slot: 'ap1' });
    await call(d, 'save.load', { slot: 'ap1' });
    await call(d, 'save.load', { slot: 'ap1' });
    expect(repo().apWeeks().filter((w) => w.weekId === '2026-11-09')).toHaveLength(1);
    while (repo().getMeta().currentDate < '2026-11-30') await call(d, 'game.advance', { mode: 'week', autoCards: true });
    expect(ap()).toMatchObject({ weekId: '2026-11-30', granted: 12, used: 0 });
    // 주 단위 지급은 스토브리그에 없다
    expect(repo().apWeeks().filter((w) => w.weekId > '2026-11-09' && w.weekId < '2026-11-30')).toHaveLength(0);
  }, 180_000);
});
