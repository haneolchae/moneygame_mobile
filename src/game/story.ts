// ② 구단 스토리 진행(27·27a, D-222·D-224·D-237). 10개 구단이 모두 같은 스토리를 진행한다.
// 우리 구단 장은 우선 결정 카드(위임 불가, 그 주 1장을 차지)로, AI 구단 장은 운영 상태로 고르고 결과는 스토리 기록에 남긴다.
// 1시즌 마감 때 2막 분기, 결말 판정 시즌 마감 때 결말(일부 결말은 조건을 채우면 바로). 난수는 별도 스트림(story)만 쓴다.
import { ageOn, diffDays, type GameDate } from '../engine/calendar';
import { EVENTS as E, STORY } from '../engine/config';
import type { CardEffect, LoadedCard } from '../engine/events/cards';
import { isTrue, type ExprValue } from '../engine/events/expr';
import { arcOf, pickCast, STORIES, storyChapter, type LoadedArc, type StoryChapterDef } from '../engine/events/story';
import { EOK } from '../engine/money';
import { Rng, type RngState } from '../engine/rng';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import { stoveTurnOf } from '../engine/stove';
import type { ClubId, ClubProfile, PlayerId, PlayerTruth } from '../engine/types';
import { overall } from '../engine/worldgen';
import type { ClubStoryState, EventState, GameMeta, GameRepository, InboxMessage, StorySeasonRow } from './ports';

type Chapter = LoadedArc['chapters'][number];

/** AI 구단에 적용하지 않는 효과(선수 계약·징계·부상 처리는 우리 구단 결정에만, ASSUMPTION(D-237)) */
const AI_SKIP = new Set(['CONTRACT', 'SUSPEND', 'REST', 'HEAL', 'INJ_RISK', 'SPONSOR_CUT', 'DIRECTIVE', 'FLAG', 'SPAWN']);

export interface StoryDeps {
  rankOf: () => Map<ClubId, number>;
  stance: (clubId: ClubId) => string;
  managerName: (clubId: ClubId) => string;
  /** EventOps.applyEffects(같은 효과 모델) */
  apply: (effects: readonly CardEffect[], ctx: { meta: GameMeta; date: GameDate; clubId: ClubId; playerId: PlayerId | null; rng: Rng; week: number; cardId: string; state: EventState }) => string[];
}

export interface StoryCardPick {
  card: LoadedCard;
  playerId: PlayerId | null;
  text: string;
}

const weekNo = (date: GameDate) => Math.floor(diffDays(date, '2000-01-03') / 7);

export class StoryOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly deps: StoryDeps,
  ) {}

  private rng(meta: GameMeta): Rng {
    return new Rng((meta.rngStreams.story as RngState | undefined) ?? Rng.derive(meta.seed, 'story').state());
  }

  private save(stories: Record<string, ClubStoryState>, rng?: Rng): void {
    const m = this.repo.getMeta();
    this.repo.updateMeta(rng ? { stories, rngStreams: { ...m.rngStreams, story: rng.state() } } : { stories });
  }

  /** 시즌 모드에서 처음 부를 때 10개 구단 스토리를 시작한다(캠프 첫 주, D-222). 새 시즌 첫 주에는 시즌 시작 현금·결말 효과를 반영한다 */
  ensure(meta: GameMeta, date: GameDate, state: EventState): Record<string, ClubStoryState> {
    if (meta.mode !== 'season') return meta.stories ?? {};
    const stories: Record<string, ClubStoryState> = structuredClone(meta.stories ?? {});
    let players: PlayerTruth[] | null = null;
    let changed = false;
    for (const arc of STORIES) {
      const key = String(arc.clubId);
      if (!this.clubs.has(arc.clubId)) continue;
      if (!stories[key]) {
        const franchise = arc.clubId === meta.userClubId ? (meta.firstAgenda?.playerId ?? meta.autoRun?.franchiseId ?? null) : null;
        players ??= this.repo.getPlayers();
        const cast = pickCast(players, arc.clubId, date, franchise) as Record<string, PlayerId>;
        const homeIds = players.filter((p) => p.clubId === arc.clubId && !p.retired && ageOn(p.birthDate, date) <= STORY.homegrownAge).map((p) => p.id);
        stories[key] = { arc: arc.arc, startSeason: meta.season, branch: null, done: {}, flags: {}, cast, homeIds, seasons: [], cashStart: this.repo.cashBalance(arc.clubId), cashSeason: meta.season, lastCardWeek: null, lastTurnKey: null, ending: null, pendingEffects: [] };
        changed = true;
        continue;
      }
      const st = stories[key]!;
      if (st.cashSeason !== meta.season) {
        st.cashSeason = meta.season;
        st.cashStart = this.repo.cashBalance(arc.clubId);
        // 결말 효과(D-237 (4)): 결말을 본 다음 시즌 시작에 적용(시즌 기간 효과가 그 시즌 내내 가도록)
        if (st.pendingEffects.length) {
          const rng = this.rng(meta);
          const effects = arc.clubId === meta.userClubId ? st.pendingEffects : st.pendingEffects.filter((e) => !AI_SKIP.has(e.type));
          this.deps.apply(effects, { meta, date, clubId: arc.clubId, playerId: null, rng, week: weekNo(date), cardId: `STORY-${st.arc}-END`, state });
          st.pendingEffects = [];
          this.repo.updateMeta({ rngStreams: { ...this.repo.getMeta().rngStreams, story: rng.state() } });
        }
        changed = true;
      }
    }
    if (changed) this.save(stories);
    return stories;
  }

  /** 스토리 시즌 번호: 시즌 모드는 진행 중 시즌, 스토브리그는 막 끝난 시즌(= 오프시즌 번호) */
  storySeason(meta: GameMeta, st: ClubStoryState): number {
    return meta.season - st.startSeason + 1;
  }

  // ───────── 조건 변수 ─────────

  vars(meta: GameMeta, st: ClubStoryState, clubId: ClubId, date: GameDate): (n: string) => ExprValue | undefined {
    const rows = st.seasons;
    const last = rows[rows.length - 1];
    const streak = (f: (r: StorySeasonRow) => boolean) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0 && f(rows[i]!); i--) n++;
      return n;
    };
    const ps = meta.postseason?.season === meta.season && meta.mode === 'season' ? meta.postseason : null;
    const k = seasonKeyDates(meta.season);
    let starters: Set<PlayerId> | null = null;
    const memo: Record<string, ExprValue> = {};
    const base: Record<string, () => ExprValue> = {
      'story.season': () => meta.mode === 'season' ? this.storySeason(meta, st) : rows.length,
      'story.titles': () => rows.filter((r) => r.champion).length,
      'story.ksFinals': () => rows.filter((r) => r.ks).length,
      'story.ksLosses': () => rows.filter((r) => r.ks && !r.champion).length,
      'story.postseasons': () => rows.filter((r) => r.ps).length,
      'story.lowSeasons': () => rows.filter((r) => r.rank >= STORY.lowRank).length,
      'story.profits': () => rows.filter((r) => r.profit).length,
      'story.lastRank': () => last?.rank ?? 0,
      'story.lastPs': () => last?.ps ? 1 : 0,
      'story.lastKs': () => last?.ks ? 1 : 0,
      'story.lastChampion': () => last?.champion ? 1 : 0,
      'story.psStreak': () => streak((r) => r.ps),
      'story.ksLossStreak': () => streak((r) => r.ks && !r.champion),
      'story.missStreak': () => streak((r) => !r.ps),
      'story.lowStreak': () => streak((r) => r.rank >= STORY.lowRank),
      'story.homegrown': () => last?.homegrown ?? 0,
      'story.ageDrop': () => rows.length >= 2 ? Math.round((rows[0]!.avgAge - last!.avgAge) * 10) / 10 : 0,
      'story.effRank': () => last?.effRank ?? 0,
      'story.inPs': () => ps?.seeds.includes(clubId) ? 1 : 0,
      'story.inKs': () => ps?.series.some((s) => s.key === 'ks' && (s.high === clubId || s.low === clubId)) ? 1 : 0,
      'story.chairman': () => meta.chairman?.[String(clubId)] ?? STORY.chairmanStart,
      'story.branch': () => st.branch ?? '',
      'club.rank': () => this.deps.rankOf().get(clubId) ?? 0,
      'club.fan': () => meta.fans?.[String(clubId)]?.satisfaction ?? 50,
      'club.cashEok': () => this.repo.cashBalance(clubId) / EOK,
      'club.stadiumLevel': () => meta.facilities?.[String(clubId)]?.levels.stadium ?? 1,
      'club.week': () => meta.mode === 'season' ? Math.max(0, Math.floor(diffDays(date, k.openingWeekMonday) / 7) + 1) : 0,
      'club.turn': () => meta.mode === 'stove' ? stoveTurnOf(meta.kDate, date).index : 0,
    };
    return (n: string) => {
      if (n in base) return (memo[n] ??= base[n]!());
      if (n.startsWith('story.flag.')) return st.flags[n.slice(11)] ?? 0;
      const m = /^cast\.([A-Za-z0-9]+)(?:\.(starter|first))?$/.exec(n);
      if (m) {
        const p = this.castPlayer(st, m[1]!, clubId);
        if (!p) return 0;
        if (m[2] === 'first') return p.level === '1군' ? 1 : 0;
        if (m[2] === 'starter') return (starters ??= this.starters(clubId)).has(p.id) ? 1 : 0;
        return 1;
      }
      return undefined;
    };
  }

  /** 배역 선수(그 구단에 남아 있을 때만) */
  private castPlayer(st: ClubStoryState, role: string, clubId: ClubId): PlayerTruth | null {
    const id = st.cast[role];
    if (id === undefined) return null;
    const p = this.repo.getPlayer(id);
    // 간판 외야수(첫 안건)는 미계약(무소속) 동안에도 배역을 유지한다
    return p && !p.retired && (p.clubId === clubId || (role === 'franchise' && p.clubId === null)) ? p : null;
  }

  /** 주전(능력 순 타자 9·투수 6, 결정 카드와 같은 기준) */
  private starters(clubId: ClubId): Set<PlayerId> {
    const mine = this.repo.getPlayers().filter((p) => p.clubId === clubId && !p.retired);
    const by = (list: PlayerTruth[], n: number) => [...list].sort((a, b) => overall(b) - overall(a) || a.id - b.id).slice(0, n).map((p) => p.id);
    return new Set([...by(mine.filter((p) => !p.isPitcher), E.starterHitters), ...by(mine.filter((p) => p.isPitcher), E.starterPitchers)]);
  }

  // ───────── 장 시기 ─────────

  /** 장 시기 판정: open = 지금 낼 수 있음, wait = 아직, closed = 지나감(건너뜀) */
  private timing(meta: GameMeta, st: ClubStoryState, ch: StoryChapterDef, date: GameDate): 'open' | 'wait' | 'closed' {
    if (ch.branch && st.branch === null) return 'wait';
    if (ch.branch && ch.branch !== st.branch) return 'closed';
    const n = this.storySeason(meta, st);
    if (ch.phase === 'season') {
      if (meta.mode === 'stove') return n >= ch.season! ? 'closed' : 'wait';
      if (n < ch.season!) return 'wait';
      if (n > ch.season!) return 'closed';
      const md = date.slice(5);
      return md < ch.from! ? 'wait' : md > ch.to! ? 'closed' : 'open';
    }
    // 스토브리그 장: 스토리 시즌 offseason 마감 뒤 턴 구간
    if (meta.mode === 'season') return n > ch.offseason! ? 'closed' : 'wait';
    if (n < ch.offseason!) return 'wait';
    if (n > ch.offseason!) return 'closed';
    const t = stoveTurnOf(meta.kDate, date).index;
    return t < ch.turns![0] ? 'wait' : t > ch.turns![1] ? 'closed' : 'open';
  }

  /** 지금 낼 장(순서대로 첫 장). 시기를 놓쳤거나 배역이 떠난 장은 건너뜀으로 기록한다 */
  private due(meta: GameMeta, st: ClubStoryState, arc: LoadedArc, date: GameDate, isUser: boolean): Chapter | null {
    if (st.ending) return null;
    const vars = this.vars(meta, st, arc.clubId, date);
    for (const ch of arc.chapters) {
      if (st.done[ch.id]) continue;
      const t = this.timing(meta, st, ch, date);
      if (t === 'closed' || (t === 'open' && ch.role !== 'club' && !this.castPlayer(st, ch.role, arc.clubId))) {
        st.done[ch.id] = { choice: null, by: 'skip', date, clubOwner: isUser };
        continue;
      }
      if (t === 'wait') continue;
      if (ch.condNode && !isTrue(ch.condNode, vars)) continue;
      return ch;
    }
    return null;
  }

  private fill(meta: GameMeta, ch: Chapter, clubId: ClubId, st: ClubStoryState, rng: Rng): { text: string; playerId: PlayerId | null } {
    const p = ch.role === 'club' ? null : this.castPlayer(st, ch.role, clubId);
    const t = ch.texts[rng.int(0, ch.texts.length - 1)]!;
    const text = t
      .replace(/\{player\}/g, p?.name ?? '')
      .replace(/\{club\}/g, this.clubs.get(clubId)?.shortName ?? '')
      .replace(/\{manager\}/g, this.deps.managerName(clubId) || '감독')
      .replace(/\{cash\}/g, `${Math.round(this.repo.cashBalance(clubId) / EOK)}억`);
    return { text: `「${ch.title}」 ${text}`, playerId: p?.id ?? null };
  }

  // ───────── 주 시작·턴 시작 ─────────

  /**
   * 시즌 주 시작: AI 구단 장 진행, 우리 구단 장이 있으면 카드로 돌려준다(그 주 결정 카드 1장을 차지, 시즌 간격 seasonGapWeeks).
   * canCard = 대기 결정 카드가 없을 때만 우리 장을 낸다.
   */
  onWeek(meta: GameMeta, monday: GameDate, week: number, state: EventState, canCard: boolean): StoryCardPick | null {
    const stories = this.ensure(meta, monday, state);
    if (!Object.keys(stories).length) return null;
    const fresh = this.repo.getMeta();
    const next = structuredClone(stories);
    const rng = this.rng(fresh);
    let pick: StoryCardPick | null = null;
    for (const arc of STORIES) {
      const st = next[String(arc.clubId)];
      if (!st || st.ending) continue;
      if (st.lastCardWeek !== null && week - st.lastCardWeek < STORY.seasonGapWeeks) continue;
      const isUser = arc.clubId === fresh.userClubId;
      if (isUser && !canCard) continue;
      const ch = this.due(fresh, st, arc, monday, isUser);
      if (!ch) continue;
      st.lastCardWeek = week;
      if (isUser) {
        const f = this.fill(fresh, ch, arc.clubId, st, rng);
        pick = { card: ch.card, playerId: f.playerId, text: f.text };
      } else this.aiChoose(fresh, monday, week, arc, st, ch, state, rng);
    }
    this.save(next, rng);
    return pick;
  }

  /** 스토브리그 턴 첫날: AI 구단 장 진행, 우리 장은 턴 회의 카드 1장(D-220 3장 안) */
  onStoveTurn(meta: GameMeta, turnStart: GameDate, week: number, state: EventState): StoryCardPick | null {
    if (!meta.stories) return null;
    const next = structuredClone(meta.stories);
    const rng = this.rng(meta);
    const key = `${meta.kDate.slice(0, 4)}-${stoveTurnOf(meta.kDate, turnStart).index}`;
    let pick: StoryCardPick | null = null;
    for (const arc of STORIES) {
      const st = next[String(arc.clubId)];
      if (!st || st.ending || st.lastTurnKey === key) continue;
      const isUser = arc.clubId === meta.userClubId;
      const ch = this.due(meta, st, arc, turnStart, isUser);
      if (!ch) continue;
      st.lastTurnKey = key;
      if (isUser) {
        const f = this.fill(meta, ch, arc.clubId, st, rng);
        pick = { card: ch.card, playerId: f.playerId, text: f.text };
      } else this.aiChoose(meta, turnStart, week, arc, st, ch, state, rng);
    }
    this.save(next, rng);
    return pick;
  }

  /** AI 구단 선택: 운영 상태별 선택지(없으면 기본), 효과는 구단 단위만 그 자리에서 적용(확률 결과 포함) */
  private aiChoose(meta: GameMeta, date: GameDate, week: number, arc: LoadedArc, st: ClubStoryState, ch: Chapter, state: EventState, rng: Rng): void {
    const stance = this.deps.stance(arc.clubId) as keyof NonNullable<StoryChapterDef['ai']>;
    const choiceId = ch.ai?.[stance] ?? ch.default;
    const choice = ch.choices.find((c) => c.id === choiceId)!;
    const p = ch.role === 'club' ? null : this.castPlayer(st, ch.role, arc.clubId);
    const ctx = { meta, date, clubId: arc.clubId, playerId: p?.id ?? null, rng, week, cardId: ch.id, state };
    this.deps.apply(choice.effects.filter((e) => !AI_SKIP.has(e.type)), ctx);
    if (choice.outcomes?.length) {
      let r = rng.next();
      const hit = choice.outcomes.filter((o) => !o.cond).find((o) => (r -= Math.max(E.outcomeMin, Math.min(E.outcomeMax, o.p))) < 0);
      if (hit) this.deps.apply(hit.effects.filter((e) => !AI_SKIP.has(e.type)), ctx);
    }
    Object.assign(st.flags, choice.flags ?? {});
    st.done[ch.id] = { choice: choice.id, by: 'ai', date, clubOwner: false };
  }

  /** 우리 구단이 스토리 카드를 골랐다(구단주·자동 실행 기본 응답 공용) */
  chosen(clubId: ClubId, chapterId: string, choiceId: string, date: GameDate): void {
    const found = storyChapter(chapterId);
    const meta = this.repo.getMeta();
    const st = meta.stories?.[String(clubId)];
    if (!found || !st || st.arc !== found.arc.arc) return;
    const next = structuredClone(meta.stories!);
    const s = next[String(clubId)]!;
    const choice = found.chapter.choices.find((c) => c.id === choiceId);
    Object.assign(s.flags, choice?.flags ?? {});
    s.done[chapterId] = { choice: choiceId, by: 'owner', date, clubOwner: true };
    this.save(next);
  }

  // ───────── 시즌 마감: 성적 요약 → 분기·결말 ─────────

  /** 한국시리즈가 끝난 날(시즌 마감 직후). 모든 구단 성적 요약을 원시 기록에서 한 번 집계하고 분기·결말을 정한다 */
  close(meta: GameMeta, date: GameDate): InboxMessage[] {
    if (!meta.stories) return [];
    const season = meta.season;
    const inbox: InboxMessage[] = [];
    const next = structuredClone(meta.stories);
    if (Object.values(next).every((st) => st.seasons.some((r) => r.season === season))) return [];
    const clubIds = [...this.clubs.keys()];
    const table = computeStandings(clubIds, this.repo.getGames(season, 'regular'));
    const ps = meta.postseason?.season === season ? meta.postseason : null;
    const ks = ps?.series.find((s) => s.key === 'ks');
    const players = this.repo.getPlayers();
    // 승리당 국내 선수 연봉 순위(1 = 가장 효율적)
    const payroll = (id: ClubId) => players.filter((p) => p.clubId === id && !p.retired && p.origin === 'domestic').reduce((a, p) => a + p.salary, 0);
    const eff = clubIds.map((id) => ({ id, v: payroll(id) / Math.max(1, table.find((r) => r.clubId === id)?.wins ?? 1) })).sort((a, b) => a.v - b.v || a.id - b.id);
    for (const arc of STORIES) {
      const key = String(arc.clubId);
      const st = next[key];
      if (!st || st.seasons.some((r) => r.season === season)) continue;
      const row = table.find((r) => r.clubId === arc.clubId);
      const first = players.filter((p) => p.clubId === arc.clubId && !p.retired && p.level === '1군');
      const starters = this.starters(arc.clubId);
      const home = new Set(st.homeIds);
      st.seasons.push({
        season,
        rank: row?.rank ?? 10,
        ps: !!ps?.seeds.includes(arc.clubId),
        ks: !!ks && (ks.high === arc.clubId || ks.low === arc.clubId),
        champion: ps?.champion === arc.clubId,
        profit: this.repo.cashBalance(arc.clubId) >= st.cashStart,
        homegrown: players.filter((p) => starters.has(p.id) && (home.has(p.id) || p.draft?.clubId === arc.clubId)).length,
        avgAge: first.length ? Math.round((first.reduce((a, p) => a + ageOn(p.birthDate, date), 0) / first.length) * 10) / 10 : 0,
        effRank: eff.findIndex((x) => x.id === arc.clubId) + 1,
      });
      if (st.ending) continue;
      const isUser = arc.clubId === meta.userClubId;
      const club = this.clubs.get(arc.clubId)!;
      const n = st.seasons.length;
      const vars = this.vars({ ...meta, mode: 'stove' }, st, arc.clubId, date);
      // 2막 분기(1시즌 마감)
      if (st.branch === null) {
        const t = arc.transition.find((x) => isTrue(x.condNode, vars)) ?? arc.transition[arc.transition.length - 1]!;
        st.branch = t.branch;
        if (isUser) inbox.push({ date, kind: 'report', sender: '구단 스토리', title: `「${arc.title}」 2막 시작`, body: `${t.text}\n2막은 이번 스토브리그 1턴부터 이어집니다.` });
      }
      // 결말: 조건을 채운 조기 결말, 결말 판정 시즌이면 첫 결말(마지막은 항상)
      const varsAfter = this.vars({ ...meta, mode: 'stove' }, st, arc.clubId, date);
      const ending = arc.endings.find((e) => e.early && isTrue(e.condNode, varsAfter)) ?? (n >= STORY.endingSeason ? arc.endings.find((e) => isTrue(e.condNode, varsAfter))! : null);
      if (!ending) continue;
      const epilogue = ending.epilogue.replace(/{manager}/g, this.deps.managerName(arc.clubId) || '감독').replace(/{club}/g, club.shortName);
      st.ending = { id: ending.id, title: ending.title, kind: ending.kind, season, date, epilogue, next: ending.next ?? null, owner: isUser };
      st.pendingEffects = ending.effects;
      const body = `${epilogue}\n\n${club.shortName}의 이야기 「${arc.title}」가 '${ending.title}' 결말로 끝났습니다(${n}시즌).${ending.next ? `\n다음 과제: ${ending.next}` : ''}\n결말 효과는 다음 시즌 시작에 반영됩니다. 명예의 전당 '구단 서사'에 남습니다.`;
      inbox.push(isUser ? { date, kind: 'report', sender: '구단 스토리', title: `결말: ${ending.title}`, body } : { date, kind: 'news', sender: 'KBO 소식', title: `${club.shortName} 이야기의 결말: ${ending.title}`, body });
    }
    this.save(next);
    return inbox;
  }

  /** 배역 선수 ID(그 구단에 남아 있을 때만) */
  castOf(clubId: ClubId, role: string): PlayerId | null {
    const st = this.repo.getMetaValue<Record<string, ClubStoryState>>('stories')?.[String(clubId)];
    return st ? (this.castPlayer(st, role, clubId)?.id ?? null) : null;
  }

  /** 우리 구단 아닌 구단의 지난 장(리그 소식·화면 기록용) */
  arcOf(clubId: ClubId) {
    return arcOf(clubId);
  }
}
