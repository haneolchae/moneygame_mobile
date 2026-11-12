// ③ 프롤로그(27b v0.2, D-223·D-224·D-238). 사전 등록 기준 D-238 PR ①~⑦.
import { afterAll, describe, expect, it } from 'vitest';
import { PROLOGUE, PROLOGUE_ERRORS, parsePrologue, prologueDate } from '../src/engine/events/prologue';
import raw from '../src/engine/data/prologue.json';
import type { GameService } from '../src/game/service';
import type { Dispatcher } from '../src/host/dispatcher';
import { call, cleanup, fingerprint, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const opened: Dispatcher[] = [];
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
const svc = (d: Dispatcher) => (d as unknown as { game(): GameService }).game();
const meta = (d: Dispatcher) => d.saves.repository().getMeta();
const CLUBS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 새 게임(2/1 캠프 시작, 첫 스토브리그 자동 실행) */
async function camp(clubId: number, seed: string) {
  const d = fresh();
  await call(d, 'game.new', { clubId, saveName: `p${clubId}`, seed, start: 'camp' });
  return d;
}

/** 대기 결정 카드가 있으면 기본 선택으로 답한다(구단주 선택과 같은 명령) */
async function answerCard(d: Dispatcher) {
  const dash = await call(d, 'game.dashboard');
  if (dash.card) await call(d, 'events.choose', { choiceId: dash.card.choices.find((c) => c.isDefault)?.id ?? dash.card.choices[0]!.id });
}

/** 장면을 모두 확인(P1은 주어진 답변) */
async function ackAll(d: Dispatcher, answerId = 'careful') {
  for (let i = 0; i < 20; i++) {
    const v = (await call(d, 'game.dashboard')).prologue;
    if (!v?.scene) return;
    await call(d, 'prologue.ack', { chapterId: v.scene.id, answerId: v.scene.answers ? answerId : undefined });
  }
}

describe('PR ① 프롤로그 정의 파일 규격', () => {
  it('정의 파일이 규격 검사를 통과하고 10개 구단 모두 장면이 있다', () => {
    expect(PROLOGUE_ERRORS).toEqual([]);
    expect(PROLOGUE).not.toBeNull();
    for (const id of CLUBS) expect(PROLOGUE!.clubs[String(id)]?.title).toBeTruthy();
    // 시즌편 9장(P1~P6, P11~P13) + 첫 겨울편 4장(W1~W4) + 부임 장면 3개
    expect(PROLOGUE!.chapters.filter((c) => c.part === 'season').map((c) => c.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P11', 'P12', 'P13']);
    expect(PROLOGUE!.chapters.filter((c) => c.part === 'winter').map((c) => c.id)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(PROLOGUE!.arrival.length).toBe(3);
  });
  it('규격 위반(모르는 미션·난수 효과 답변·없는 구단·모르는 자리표시자)은 거부한다', () => {
    const base = structuredClone(raw) as unknown as Record<string, unknown> & { chapters: Array<Record<string, unknown>>; answers: Array<Record<string, unknown>>; clubs: Record<string, unknown> };
    const bad1 = structuredClone(base);
    bad1.chapters[0]!.mission = 'fake';
    expect(parsePrologue(bad1, CLUBS).errors.join()).toContain('모르는 미션');
    const bad2 = structuredClone(base);
    bad2.answers[0]!.effects = [{ type: 'CASH', grade: 'small' }];
    expect(parsePrologue(bad2, CLUBS).errors.join()).toContain('회견 답변 효과');
    expect(parsePrologue(base, [...CLUBS, 11]).errors.join()).toContain('구단 11');
    const bad3 = structuredClone(base);
    bad3.chapters[1]!.lines = [['단장', '{secret}']];
    expect(parsePrologue(bad3, CLUBS).errors.join()).toContain('{secret}');
    expect(parsePrologue(bad3, CLUBS).def).toBeNull();
    const bad4 = structuredClone(base);
    delete bad4.chapters[0]!.default;
    expect(parsePrologue(bad4, CLUBS).errors.join()).toContain('기본 답변');
  });
});

describe('PR ② 처음 고른 구단은 2/1 캠프에서 구단별 시즌편을 받는다', () => {
  for (const clubId of [7, 3]) {
    it(`구단 ${clubId}: P1 장면·답변, 2/1 미션 6개, 다음 장 P11`, async () => {
      const d = await camp(clubId, `pro-start-${clubId}`);
      const dash = await call(d, 'game.dashboard');
      expect(dash.date).toBe('2027-02-01');
      const v = dash.prologue!;
      expect(v.kind).toBe('full');
      expect(v.part).toBe('season');
      expect(v.clubTitle).toBe(PROLOGUE!.clubs[String(clubId)]!.title);
      expect(v.scene?.id).toBe('P1');
      expect(v.scene?.answers?.length).toBe(4);
      expect(v.scene!.lines.some((l) => l.text === PROLOGUE!.clubs[String(clubId)]!.question)).toBe(true);
      expect(v.scene!.lines.every((l) => !/\{\w+\}/.test(l.text + l.speaker))).toBe(true);
      expect(v.missions.map((m) => m.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
      expect(v.missions.find((m) => m.id === 'P4')!.mission).toContain(d.saves.repository().getPlayer(meta(d).firstAgenda!.playerId)!.name);
      expect(v.next?.title).toBe('P11 개막 준비');
      // 시험용 스토브리그 시작(자동 실행 없음)에는 프롤로그가 없다
      const s = fresh();
      await call(s, 'game.new', { clubId, saveName: 'x', seed: `pro-stove-${clubId}`, start: 'stove' });
      expect((await call(s, 'game.dashboard')).prologue).toBeNull();
    }, 120_000);
  }
});

describe('PR ③ 미션은 실제 명령 결과로만 완료된다', () => {
  it('답변 효과·위임 정책·간판 외야수·조사·진행이 실제 명령 뒤에만 완료, 잘못된 조작은 거부', async () => {
    const d = await camp(5, 'pro-mission');
    const club = String(meta(d).userClubId);
    // 잘못된 조작: 지금 장면이 아닌 장, 답변 없는 P1
    expect((await d.respond('prologue.ack', { chapterId: 'P3' })).ok).toBe(false);
    expect((await d.respond('prologue.ack', { chapterId: 'P1' })).ok).toBe(false);
    const press0 = meta(d).press?.[club] ?? null;
    const fan0 = meta(d).fans?.[club]?.satisfaction ?? null;
    await call(d, 'prologue.ack', { chapterId: 'P1', answerId: 'evade' });
    // 회피: 언론 관계 −3, 팬 만족도 하락(결정 카드와 같은 효과 모델)
    expect(meta(d).press![club]!).toBe((press0 ?? 50) - 3);
    expect(meta(d).fans![club]!.satisfaction).toBeLessThan(fan0 ?? 100);
    let v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.missions.find((m) => m.id === 'P1')!.status).toBe('done');
    expect(v.scene?.id).toBe('P2');
    await call(d, 'prologue.ack', { chapterId: 'P2' });
    v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.missions.find((m) => m.id === 'P2')!.status).toBe('done');
    // P3: 장면만 봐서는 완료가 아니고, 위임 정책 저장(실제 명령) 뒤 완료
    await call(d, 'prologue.ack', { chapterId: 'P3' });
    expect((await call(d, 'game.dashboard')).prologue!.missions.find((m) => m.id === 'P3')!.status).toBe('active');
    const org = await call(d, 'org.view');
    await call(d, 'org.setPolicy', org.policies.find((p) => p.team === 'ops')!);
    expect((await call(d, 'game.dashboard')).prologue!.missions.find((m) => m.id === 'P3')!.status).toBe('done');
    // P6: 우리 선수 조사는 해당하지 않고, 다른 구단 선수 조사(행동력 1)가 완료
    const repo = d.saves.repository();
    const ours = repo.getPlayers().find((p) => p.clubId === meta(d).userClubId && !p.retired)!;
    await d.respond('player.scout', { playerId: ours.id });
    expect((await call(d, 'game.dashboard')).prologue!.missions.find((m) => m.id === 'P6')!.status).toBe('active');
    const other = repo.getPlayers().find((p) => p.clubId !== null && p.clubId !== meta(d).userClubId && !p.retired)!;
    await call(d, 'player.scout', { playerId: other.id });
    expect((await call(d, 'game.dashboard')).prologue!.missions.find((m) => m.id === 'P6')!.status).toBe('done');
    // P4: 간판 외야수 협상을 운영팀에 맡기는 실제 명령
    const fa = meta(d).firstAgenda!;
    await call(d, 'org.delegateFa', { playerId: fa.playerId });
    expect(repo.getTasks({ status: ['queued', 'waiting'], kind: 'fa' }).some((t) => t.targetId === fa.playerId)).toBe(true);
    expect((await call(d, 'game.dashboard')).prologue!.missions.find((m) => m.id === 'P4')!.status).toBe('done');
    // P5: 한 주 진행(결재 대기가 있으면 결재 1건)
    await call(d, 'game.advance', { mode: 'week' });
    const dash = await call(d, 'game.dashboard');
    if (dash.approvals.length) await call(d, 'org.approve', { approvalId: dash.approvals[0]!.id });
    v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.missions.find((m) => m.id === 'P5')!.status).toBe('done');
    expect(Object.values(meta(d).prologue!.chapters).every((c) => c.status === 'done')).toBe(true);
  }, 180_000);
});

describe('PR ④ 끝까지 하거나 건너뛰어도 결과가 실제 진행과 같다', () => {
  it('편 건너뛰기 = 장 건너뛰기 + 설명 끄기 = 같은 기본 선택을 직접 한 진행', async () => {
    const seed = 'pro-equal';
    const clubId = 10;
    // A: 2/1에 시즌편 전체 건너뛰기(요약 + 남은 미션 기본 처리)
    const a = await camp(clubId, seed);
    const r = await call(a, 'prologue.skip', { scope: 'part' });
    expect(r.summary.length).toBe(9);
    expect(r.summary.join('\n')).toContain('P4 첫 안건');
    expect(r.summary[0]).toContain('신중');
    expect(r.summary[3]).toContain('운영팀');
    expect((await call(a, 'game.dashboard')).prologue).toBeNull();
    // B: 설명 끄기 + 2/1에 시작한 장을 하나씩 건너뛰기
    const b = await camp(clubId, seed);
    await call(b, 'prologue.settings', { hints: false });
    const hb = (await call(b, 'game.dashboard')).prologue!;
    expect(hb.hints).toBe(false);
    expect(hb.scene?.id).toBe('P1');
    expect(hb.missions.every((m) => m.learn.length === 0 && m.targets.length === 0)).toBe(true);
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) await call(b, 'prologue.skip', { scope: 'chapter', chapterId: id });
    // 시작하지 않은 장은 건너뛸 수 없다
    expect((await b.respond('prologue.skip', { scope: 'chapter', chapterId: 'P11' })).ok).toBe(false);
    // C: 끝까지 진행 — 기본 답변으로 답하고, 운영팀에 맡기기를 직접 누르고, 장면을 모두 본다
    const c = await camp(clubId, seed);
    await ackAll(c, PROLOGUE!.answerDefault);
    await call(c, 'org.delegateFa', { playerId: meta(c).firstAgenda!.playerId });
    for (const d of [a, b, c]) {
      for (let w = 0; w < 4; w++) {
        await answerCard(d);
        await call(d, 'game.advance', { mode: 'week' });
      }
    }
    const pick = (d: Dispatcher) => {
      const m = meta(d);
      const club = String(m.userClubId);
      const fa = m.firstAgenda!;
      return { fp: fingerprint(d), fan: m.fans?.[club]?.satisfaction, press: m.press?.[club], agenda: fa.status, star: d.saves.repository().getPlayer(fa.playerId)!.clubId, events: d.saves.repository().getEventLog().map((e) => `${e.cardId}:${e.choiceId}`).join(',') };
    };
    const pa = pick(a);
    expect(pick(b)).toEqual(pa);
    expect(pick(c)).toEqual(pa);
  }, 300_000);
});

describe('PR ⑤ 개막 주 결정 카드·관전 미션(P12)', () => {
  it('새 게임 첫 시즌 개막 주에는 결정 카드가 반드시 오고, 카드 처리 + 관전으로 P12 완료', async () => {
    const d = await camp(8, 'pro-opening');
    await call(d, 'prologue.skip', { scope: 'chapter', chapterId: 'P1' });
    const opening = prologueDate('openingWeek', meta(d).season);
    for (let i = 0; i < 12 && meta(d).currentDate < opening; i++) {
      await answerCard(d);
      await call(d, 'game.advance', { mode: 'week' });
    }
    expect(meta(d).currentDate).toBe(opening);
    const s = svc(d);
    expect(s.prologue.guaranteedCardWeek(meta(d), opening)).toBe(true);
    // 개막 주 카드(스토리 장 또는 결정 카드)가 대기 중이거나 담당 팀이 처리했다
    const log = d.saves.repository().getEventLog({ season: meta(d).season }).filter((e) => e.weekId >= opening);
    expect(!!meta(d).eventState?.pendingCard || log.length > 0).toBe(true);
    let v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.missions.find((m) => m.id === 'P12')?.status).toBe('active');
    await answerCard(d);
    // 우리 경기가 있는 날까지 하루씩 → 경기 보기 → 그날 처리(관전 기록)
    for (let i = 0; i < 10 && !(await call(d, 'game.dashboard')).live.available; i++) await call(d, 'game.advance', { mode: 'day' });
    await call(d, 'live.start');
    await call(d, 'game.advance', { mode: 'day' });
    v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.missions.find((m) => m.id === 'P12')?.status).toBe('done');
    // 기한이 지난 앞 장은 기본 흐름(missed)으로 끝났고, 진행은 막히지 않았다
    expect(meta(d).prologue!.chapters.P11?.status).toBe('missed');
  }, 300_000);
});

describe('PR ⑥ 첫 겨울편과 완료 업적', () => {
  it('시즌편을 지나 첫 스토브리그 1턴에 첫 겨울편, 4턴 끝 뒤 업적 첫 겨울을 넘기다', async () => {
    const d = await camp(1, 'pro-winter');
    await ackAll(d);
    // 시즌 끝까지(카드는 위임 기본 선택)
    for (let i = 0; i < 4 && meta(d).mode === 'season'; i++) {
      await answerCard(d);
      const r = await call(d, 'game.advance', { mode: 'untilSeasonEnd' });
      if (r.stoppedReason?.includes('스토브리그')) break;
    }
    expect(meta(d).mode).toBe('stove');
    const st = meta(d).prologue!;
    expect(st.parts.season).toBe('done');
    expect(st.parts.winter).toBe('active');
    const v = (await call(d, 'game.dashboard')).prologue!;
    expect(v.part).toBe('winter');
    expect(v.scene?.id).toBe('W1');
    expect(v.missions.map((m) => m.id)).toEqual(['W1']);
    // 턴마다: 장면 확인 → 우리 FA 지시서(공시 뒤) → 메인 스폰서(제안이 열리면) → 3턴 다음 시즌 예산안 → 턴 진행
    const plan = (v: { year: number; ops: Array<{ kind: string; multiplier: number }>; caps: Array<{ kind: string; limitWon: number }> }) => ({ year: v.year, ops: Object.fromEntries(v.ops.map((o) => [o.kind, o.multiplier])) as { scouting: number; futures: number; teamOps: number }, caps: Object.fromEntries(v.caps.map((c) => [c.kind, c.limitWon])) as { payroll: number; facility: number; marketing: number; merch: number } });
    for (let i = 0; i < 8 && meta(d).mode === 'stove'; i++) {
      await ackAll(d);
      const off = Number(meta(d).kDate.slice(0, 4));
      const repo = d.saves.repository();
      const own = repo.getFa(off).find((e) => e.originClub === meta(d).userClubId && e.status === 'approved' && !repo.getTasks({ status: ['queued', 'waiting'], kind: 'fa' }).some((t) => t.targetId === e.playerId));
      if (own) await d.respond('org.delegateFa', { playerId: own.playerId });
      const sp = (await call(d, 'business.view')).sponsors;
      const main = sp.open ? sp.offers.find((o) => o.slot === 'main') : undefined;
      if (main && !(meta(d).sponsors?.[String(meta(d).userClubId)] ?? []).some((x) => x.season === off + 1 && x.slot === 'main')) await d.respond('business.signSponsor', { offerId: main.id });
      if (meta(d).stoveTurn?.index === 3) {
        const next = (await call(d, 'budget.view')).planning;
        if (next) await d.respond('budget.set', plan(next));
      }
      await call(d, 'game.advance', { mode: 'turn' });
    }
    let w = meta(d).prologue!.chapters;
    expect(meta(d).mode).toBe('season');
    w = meta(d).prologue!.chapters;
    expect(w.W2?.status).toBe('done');
    expect(Object.keys(w).filter((k) => k.startsWith('W')).sort()).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(meta(d).prologue!.ended?.reason).toBe('complete');
    expect((await call(d, 'game.dashboard')).prologue).toBeNull();
    // 업적은 월요일 판정: 2/1(월) 처리 뒤
    await answerCard(d);
    await call(d, 'game.advance', { mode: 'week' });
    expect(d.saves.repository().getAchievements().some((a) => a.key.startsWith('M_prologue'))).toBe(true);
    // 다시 보기: 본 장면(난수 없이 같은 대사)
    const h1 = await call(d, 'prologue.history');
    const h2 = await call(d, 'prologue.history');
    // 시즌을 한 번에 진행해 기한이 지난 P11~P13 장면은 보지 않았다(기한 지난 장면은 대기열에서 빠진다)
    expect(h1.entries.map((e) => e.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'W1', 'W2', 'W3', 'W4']);
    expect(meta(d).prologue!.chapters.P12?.status).toBe('missed');
    expect(h2).toEqual(h1);
    expect(h1.entries[0]!.answer).toContain('신중');
  }, 600_000);
});

describe('PR ⑦ 해임 뒤 두 번째 구단은 부임 장면 3개', () => {
  it('영입 제안 수락 → 부임 장면 A1~A3, 미션 없음, 다 보면 끝', async () => {
    const d = await camp(7, 'pro-arrival');
    await call(d, 'prologue.ack', { chapterId: 'P1', answerId: 'confident' });
    const repo = d.saves.repository();
    repo.updateMeta({ gameOver: { kind: 'dismissed', date: meta(d).currentDate, reason: '시험: 해임' }, ownerLevel: 3 });
    const career = await call(d, 'owner.career');
    const target = career.jobOffers[0]!.club.id;
    const dash = await call(d, 'owner.acceptJob', { clubId: target });
    const v = dash.prologue!;
    expect(v.kind).toBe('arrival');
    expect(v.missions).toEqual([]);
    expect(v.scene?.id).toBe('A1');
    expect(v.clubTitle).toBe(PROLOGUE!.clubs[String(target)]!.title);
    expect(meta(d).prologuePast?.[0]?.ended?.reason).toBe('clubChange');
    for (const id of ['A1', 'A2', 'A3']) await call(d, 'prologue.ack', { chapterId: id });
    expect((await call(d, 'game.dashboard')).prologue).toBeNull();
    expect(meta(d).prologue!.ended?.reason).toBe('complete');
    // 이전 구단의 P1 장면과 부임 장면을 다시 볼 수 있다
    const h = await call(d, 'prologue.history');
    expect(h.entries.map((e) => e.id)).toEqual(['P1', 'A1', 'A2', 'A3']);
    // 이전 구단 프롤로그의 개막 주 보장은 이어지지 않는다(구단이 바뀌었으므로 판정만 남음)
    expect(svc(d).prologue.guaranteedCardWeek(meta(d), '2000-01-03')).toBe(false);
  }, 180_000);
});
