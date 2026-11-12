// ② 구단 스토리(27·27a, D-222·D-224·D-237). 사전 등록 기준 D-237 SR ①~⑥.
import { afterAll, describe, expect, it } from 'vitest';
import { STORIES, STORY_ERRORS, parseStories } from '../src/engine/events/story';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

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

describe('SR ① 스토리 정의 파일 규격', () => {
  it('모든 구단 스토리가 규격 검사를 통과한다', () => {
    expect(STORY_ERRORS).toEqual([]);
  });
  it('규격 위반(없는 변수·FLAG 효과·마지막 결말 조건)은 그 구단 스토리를 거부한다', () => {
    const bad = structuredClone(STORIES.map((a) => ({ ...a, chapters: a.chapters.map(({ card: _c, condNode: _n, ...ch }) => ch), endings: a.endings.map(({ condNode: _n, ...e }) => e), transition: a.transition.map(({ condNode: _n, ...t }) => t) })))[0]!;
    const r1 = parseStories([{ ...bad, chapters: bad.chapters.map((c, i) => (i === 0 ? { ...c, id: 'X-1', cond: 'player.age > 3' } : { ...c, id: `X-${i + 2}` })) }]);
    expect(r1.errors.join()).toContain('변수 player.age');
    const r2 = parseStories([{ ...bad, chapters: bad.chapters.map((c, i) => ({ ...c, id: `Y-${i}`, choices: i === 0 ? [{ ...c.choices[0]!, effects: [{ type: 'FLAG', name: 'x' }] }, ...c.choices.slice(1)] : c.choices })) }]);
    expect(r2.errors.join()).toContain('FLAG');
    const r3 = parseStories([{ ...bad, chapters: bad.chapters.map((c, i) => ({ ...c, id: `Z-${i}` })), endings: bad.endings.slice(0, -1) }]);
    expect(r3.errors.join()).toContain("마지막 결말은 조건 '1'");
  });
});

describe('SR ② 캠프 첫 주에 우리 구단 1막 첫 장이 우선 결정 카드로 온다', () => {
  for (const [clubId, first] of [[7, 'LEO-1-1'], [5, 'MAG-1-1'], [2, 'GRZ-1-1']] as const) {
    it(`구단 ${clubId}: ${first}`, async () => {
      const d = fresh();
      await call(d, 'game.new', { clubId, saveName: `s${clubId}`, seed: `story-camp-${clubId}`, start: 'camp' });
      const dash = await call(d, 'game.dashboard');
      expect(dash.date).toBe('2027-02-01');
      expect(dash.card?.cardId).toBe(first);
      expect(dash.card?.category).toBe('story');
      expect(dash.card?.text).toMatch(/^「/);
      // 위임할 수 없는 분류
      const del = await call(d, 'events.delegation');
      expect(del.find((x) => x.category === 'story')?.delegable).toBe(false);
      const meta = d.saves.repository().getMeta();
      expect(Object.keys(meta.stories ?? {}).length).toBe(STORIES.length);
      const choice = dash.card!.choices[0]!.id;
      await call(d, 'events.choose', { choiceId: choice });
      const st = d.saves.repository().getMeta().stories![String(clubId)]!;
      expect(st.done[first]?.choice).toBe(choice);
      expect(st.done[first]?.by).toBe('owner');
    }, 120_000);
  }
});

const svcOf = (d: unknown) => (d as { game(): import('../src/game/service').GameService }).game();

/** 시즌 끝까지 → 스토브리그 n턴(자동 실행: 카드는 기본 선택) */
async function runSeason(d: ReturnType<typeof makeDispatcher>, stoveTurns: number) {
  const repo = d.saves.repository();
  for (let i = 0; i < 6 && repo.getMeta().mode === 'season'; i++) await call(d, 'game.advance', { mode: 'untilSeasonEnd', autoCards: true });
  for (let i = 0; i < stoveTurns && repo.getMeta().mode === 'stove'; i++) await call(d, 'game.advance', { mode: 'turn', autoCards: true });
}

describe('SR ③ 같은 시드면 같은 분기, SR ④ AI 구단 스토리 진행', () => {
  it('같은 시드 두 번: 1시즌 마감 뒤 스토리 상태(장 선택·갈래·배역·모기업 신뢰)가 같다', async () => {
    const a = fresh();
    const b = fresh();
    await call(a, 'game.new', { clubId: 8, saveName: 'a', seed: 'story-same', start: 'camp' });
    await call(b, 'game.new', { clubId: 8, saveName: 'b', seed: 'story-same', start: 'camp' });
    await runSeason(a, 2);
    await runSeason(b, 2);
    const ma = a.saves.repository().getMeta();
    const mb = b.saves.repository().getMeta();
    expect(ma.mode).toBe('stove');
    expect(JSON.stringify(ma.stories)).toBe(JSON.stringify(mb.stories));
    expect(JSON.stringify(ma.chairman ?? {})).toBe(JSON.stringify(mb.chairman ?? {}));
    const stories = Object.values(ma.stories!);
    expect(stories.length).toBe(STORIES.length);
    // 모든 구단 2막 갈래가 정해졌고 1막 장이 처리(선택 또는 건너뜀)됐다
    for (const st of stories) {
      expect(st.branch).not.toBeNull();
      expect(st.seasons.length).toBe(1);
      const arc = STORIES.find((x) => x.arc === st.arc)!;
      for (const ch of arc.chapters.filter((c) => c.act === 1 && c.phase === 'season')) expect(st.done[ch.id]).toBeDefined();
    }
    // AI 구단은 운영 상태로 골랐다(우리 구단만 owner)
    const ai = stories.filter((st) => st.arc !== STORIES.find((x) => x.clubId === 8)!.arc);
    expect(ai.flatMap((st) => Object.values(st.done)).some((x) => x.by === 'ai')).toBe(true);
    expect(ai.flatMap((st) => Object.values(st.done)).every((x) => x.by !== 'owner')).toBe(true);
    // 우리 구단 스토리 카드: 시즌 4주 간격, 스토브리그 턴당 1장 이하
    const rows = a.saves.repository().getEventLog().filter((r) => r.category === 'story');
    expect(rows.length).toBeGreaterThan(0);
    const season = rows.filter((r) => r.date < ma.kDate).map((r) => r.week).sort((x, y) => x - y);
    for (let i = 1; i < season.length; i++) expect(season[i]! - season[i - 1]!).toBeGreaterThanOrEqual(4);
    const turnIds = rows.filter((r) => r.date > ma.kDate).map((r) => r.weekId);
    expect(new Set(turnIds).size).toBe(turnIds.length);
  }, 600_000);
});

describe('SR ⑤ 3시즌 뒤 결말·명예의 전당·업적, SR ⑥ 규칙 검사', () => {
  it('10개 구단 스토리가 3시즌 마감에 결말을 맞고 구단 서사에 남는다', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 3, saveName: 'end', seed: 'story-end', start: 'camp' });
    await runSeason(d, 4);
    await runSeason(d, 4);
    await runSeason(d, 1);
    const repo = d.saves.repository();
    const meta = repo.getMeta();
    expect(meta.mode).toBe('stove');
    for (const st of Object.values(meta.stories!)) {
      expect(st.ending).not.toBeNull();
      expect(st.seasons.length).toBeLessThanOrEqual(3);
      expect(st.pendingEffects.length).toBe(st.ending!.season === meta.season ? STORIES.find((a) => a.arc === st.arc)!.endings.find((e) => e.id === st.ending!.id)!.effects.length : 0);
    }
    const view = await call(d, 'story.view', { clubId: 3 });
    expect(view!.act).toBe(3);
    expect(view!.ending!.owner).toBe(true);
    expect(view!.league.every((l) => l.ending !== null)).toBe(true);
    // 우리 결말 편지, AI 결말 리그 소식
    const inbox = repo.getInbox(5000);
    expect(inbox.some((m) => m.sender === '구단 스토리' && m.title.startsWith('결말'))).toBe(true);
    expect(inbox.some((m) => m.sender === 'KBO 소식' && m.title.includes('이야기의 결말'))).toBe(true);
    // 업적 '구단 서사'(결말 뒤 첫 월요일)
    expect(repo.getAchievements().some((a) => a.key === 'M_story.1')).toBe(true);
    const { checkStories } = await import('../src/host/invariants');
    expect(checkStories(repo)).toEqual([]);
  }, 900_000);
});

describe('모기업 신뢰 → 모기업 지원금(D-237)', () => {
  it('신뢰 0·50·100 = 지원금 0.9·1·1.1배', async () => {
    const d = fresh();
    await call(d, 'game.new', { clubId: 7, saveName: 'ch', seed: 'story-chair', start: 'camp' });
    const svc = svcOf(d) as unknown as { supportAdjusted(m: unknown, c: { id: number; parentSupport: number }): { parentSupport: number } };
    const repo = d.saves.repository();
    const club = repo.getClubs().find((c) => c.id === 7)!;
    const at = (v: number | undefined) => {
      const m = repo.getMeta();
      return svc.supportAdjusted({ ...m, supportBp: {}, supportCutBp: {}, supportDeduction: {}, chairman: v === undefined ? {} : { '7': v } }, club).parentSupport;
    };
    expect(at(undefined)).toBe(club.parentSupport);
    expect(at(50)).toBe(club.parentSupport);
    expect(at(100)).toBe(Math.round(club.parentSupport * 1.1));
    expect(at(0)).toBe(Math.round(club.parentSupport * 0.9));
  }, 120_000);
});
