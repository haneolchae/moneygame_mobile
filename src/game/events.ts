// EV-1 이벤트 엔진·턴 브리핑(D-192·D-193·D-203, 26·26a). 주 시작 처리: 만료 → 지연 결과 → 브리핑 → 결정 카드.
// 카드 화면(EV-3) 전에는 담당 팀이 위임 기본 선택지로 처리하고 결과는 다음 브리핑 결과 회수 줄로 알린다.
import { allStarDates } from '../engine/allStar';
import { startSatisfaction } from '../engine/business';
import { addDays, ageOn, diffDays, type GameDate } from '../engine/calendar';
import { EVENTS as E, MARKETING, TRADE } from '../engine/config';
import { CARDS, CATEGORY_LABEL, CONNECTED, passesLimits, pickCandidate, TEAM_LABEL, type CardEffect, type Candidate, type CardPhase, type LoadedCard } from '../engine/events/cards';
import { isTrue, type ExprValue } from '../engine/events/expr';
import { FINANCE_BASE, inflate, stadiumFee, type LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { Rng, type RngState } from '../engine/rng';
import { seasonKeyDates } from '../engine/schedule';
import type { ClubId, ClubProfile, PlayerId, PlayerTruth } from '../engine/types';
import { overall } from '../engine/worldgen';
import type { EventLogRow, EventState, GameMeta, GameRepository, NewsRow } from './ports';
import { weekIdFor } from './week';

const md = (d: GameDate) => d.slice(5).replace('-', '/');
const eok = (n: number) => `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억`;
const round1m = (n: number) => Math.round(n / 1_000_000) * 1_000_000;
/** 절대 주 번호(쿨다운 계산용) */
export const weekNumber = (date: GameDate) => Math.floor(diffDays(date, '2000-01-03') / 7);
export const newEventState = (): EventState => ({ flags: {}, queue: [], spawns: [], effects: [], pendingLines: [], lastCategory: null, last: { rank: null, fan: null, sellouts: 0, cash: null } });

// ───────── EV-2 기간 효과 조회(다른 모델이 읽는다, D-205) ─────────
type Eff = NonNullable<EventState['effects']>[number];
const activeEffects = (s: EventState | undefined, week: number, type: string): Eff[] => (s?.effects ?? []).filter((e) => e.type === type && e.untilWeek > week);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 선수별 컨디션 로짓: 점 합(±5 상한) × 0.01 */
export function conditionLogits(s: EventState | undefined, week: number): Map<PlayerId, number> {
  const pts = new Map<PlayerId, number>();
  for (const e of activeEffects(s, week, 'COND')) if (e.playerId !== null) pts.set(e.playerId, (pts.get(e.playerId) ?? 0) + e.value);
  return new Map([...pts].filter(([, v]) => v !== 0).map(([id, v]) => [id, clamp(v, -E.condMax, E.condMax) * E.condLogitPerPoint]));
}
/** 선수 출전 1회 부상 확률 배율(효과끼리 곱) */
export const injuryMultiplier = (s: EventState | undefined, week: number, playerId: PlayerId) => activeEffects(s, week, 'INJ_RISK').filter((e) => e.playerId === playerId).reduce((a, e) => a * e.value, 1);
/** 구단 팬 만족도 목표 가산 합 */
export const fanTargetBoost = (s: EventState | undefined, week: number, clubId: ClubId) => activeEffects(s, week, 'FAN_TARGET').filter((e) => e.clubId === clubId).reduce((a, e) => a + e.value, 0);
/** 구단 관중 수요 가산(배율 − 1 의 합) */
export const demandBoost = (s: EventState | undefined, week: number, clubId: ClubId) => activeEffects(s, week, 'DEMAND').filter((e) => e.clubId === clubId).reduce((a, e) => a + (e.value - 1), 0);
/** 구단 굿즈 수요 배율(곱, 0.7~1.3) */
export const merchMultiplier = (s: EventState | undefined, week: number, clubId: ClubId) => clamp(activeEffects(s, week, 'MERCH').filter((e) => e.clubId === clubId).reduce((a, e) => a * e.value, 1), E.merchMin, E.merchMax);
/** 집중 훈련 효과 배율(대상 선수 또는 구단 1군 전원, 0.9~1.1) */
export function growthMultiplier(s: EventState | undefined, week: number, p: PlayerTruth): number {
  const list = activeEffects(s, week, 'GROWTH').filter((e) => e.playerId === p.id || (e.playerId === null && e.clubId === p.clubId && p.level === '1군'));
  return list.length ? clamp(list.reduce((a, e) => a * e.value, 1), E.growthMin, E.growthMax) : 1;
}
/** 팬 만족도 목표 가산: 캠페인 가산(상한 전 합)과 카드 가산을 합쳐 기존 상한 */
export const satisfactionBoost = (campaignRaw: number, eventTarget: number) => Math.min(MARKETING.maxSatisfactionBoost, campaignRaw + eventTarget);
/** 관중 수요 가산: 캠페인과 카드 가산 합을 하한·상한으로 */
export const demandWith = (campaign: number, event: number) => clamp(campaign + event, E.demandMin, MARKETING.maxDemandBoost);
/** 사건 여론 완화(D-198): 팬 만족도 하락 × (1.2 − 0.4 × 언론 관계/100) × (1 − 0.2 × 홍보팀 역량) */
export const fanDropFactor = (press: number, prQuality: number) => (1.2 - (0.4 * press) / 100) * (1 - E.prRelief * prQuality);

export interface EventDeps {
  rankOf: () => Map<ClubId, number>;
  fatigue: (date: GameDate, players: PlayerTruth[]) => Map<PlayerId, number>;
  /** 감독 신뢰도 ±(출처 기록) */
  adjustTrust: (clubId: ClubId, delta: number, date: GameDate, source: string) => void;
  /** 홍보팀 역량 0~1 */
  prQuality: (clubId: ClubId) => number;
}

export interface ApplyCtx {
  meta: GameMeta;
  date: GameDate;
  clubId: ClubId;
  playerId: PlayerId | null;
  rng: Rng;
  week: number;
  cardId: string;
  state: EventState;
}

export class EventOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly deps: EventDeps,
  ) {}

  /** 카드 비용 기준 예산(D-202 (2)): 직전 장부 시즌 총지출, 첫 시즌은 시작 조건 예상 총지출 */
  baseBudget(meta: GameMeta, clubId = meta.userClubId): number {
    const prev = meta.season - 1;
    if (prev >= 2027) {
      const spent = -this.repo.ledgerByCategory(clubId, prev).filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0);
      if (spent > 0) return spent;
    }
    const club = this.clubs.get(clubId)!;
    const payroll = this.repo.getPlayers().filter((p) => p.clubId === clubId).reduce((a, p) => a + p.salary, 0);
    const fixed = FINANCE_BASE.staffPayroll + FINANCE_BASE.generalAdmin + FINANCE_BASE.futuresOps + FINANCE_BASE.analysisScouting + FINANCE_BASE.teamOps + FINANCE_BASE.gameOps + stadiumFee(club);
    return payroll + Math.round(inflate(fixed, meta.season, meta.inflationBp));
  }

  // ───────── 효과 적용(D-203 (6)) ─────────

  /** 효과를 적용하고 결과 문장 조각을 돌려준다. 연결 전 효과는 들어오지 않는다(비활성 카드는 추첨하지 않음) */
  applyEffects(effects: readonly CardEffect[], c: ApplyCtx): string[] {
    const out: string[] = [];
    let fanDrop = 0;
    for (const e of effects) {
      if (!CONNECTED.has(e.type)) throw new Error(`연결 전 효과: ${e.type}`);
      if (e.type === 'CASH') {
        let amount = e.won ?? 0;
        if (e.grade) {
          const [lo, hi] = E.costBp[e.grade]!;
          amount = -Math.max(1_000_000, round1m((this.baseBudget(c.meta, c.clubId) * c.rng.int(lo, hi)) / 10_000));
        }
        const entry: LedgerEntry = { clubId: c.clubId, date: c.date, category: 'event', amount, memo: `이벤트 ${c.cardId}` };
        this.repo.addLedger([entry]);
        out.push(`${amount < 0 ? '지출' : '수입'} ${eok(Math.abs(amount))}`);
      } else if (e.type === 'FAN_NOW') {
        const meta = this.repo.getMeta();
        const key = String(c.clubId);
        const cur = meta.fans?.[key] ?? { satisfaction: startSatisfaction(this.clubs.get(c.clubId)!.loyalty) };
        let d = e.value ?? 0;
        // 사건 여론 완화(D-205 (4)) 뒤 한 사건이 팬 만족도를 12 넘게 깎지 않는다(D-198)
        if (d < 0) d *= fanDropFactor(meta.press?.[key] ?? E.pressStart, this.deps.prQuality(c.clubId));
        if (d < 0) {
          d = Math.max(d, -(E.fanDropCap - fanDrop));
          fanDrop += -d;
        }
        const next = Math.max(0, Math.min(100, Math.round((cur.satisfaction + d) * 10) / 10));
        this.repo.updateMeta({ fans: { ...(meta.fans ?? {}), [key]: { ...cur, satisfaction: next } } });
        out.push(`팬 만족도 ${d >= 0 ? '▲' : '▼'}`);
      } else if (e.type === 'REST') {
        if (c.playerId === null) continue;
        const meta = this.repo.getMeta();
        const until = addDays(c.date, (e.days ?? 1) - 1);
        this.repo.updateMeta({ restOrders: { ...(meta.restOrders ?? {}), [String(c.playerId)]: until } });
        out.push(`${md(c.date)}~${md(until)} 휴식`);
      } else if (e.type === 'TRUST') {
        this.deps.adjustTrust(c.clubId, e.value ?? 0, c.date, `구단 사건 ${c.cardId}`);
        out.push(`감독 신뢰도 ${(e.value ?? 0) >= 0 ? '▲' : '▼'}`);
      } else if (e.type === 'FLAG') {
        c.state.flags[e.name!] = { value: e.value ?? 1, expiresWeek: e.weeks ? c.week + e.weeks : null };
      } else if (e.type === 'SPAWN') {
        c.state.spawns.push({ week: c.week + (e.weeks ?? 1), cardId: e.card!, playerId: c.playerId });
      } else if (e.type === 'MOOD' || e.type === 'CLUBHOUSE') {
        // 선수단 분위기 = 우리 1군 전원 기분 ±n/2(D-202 (1))
        const ids = e.type === 'CLUBHOUSE' || e.who === 'club' ? this.repo.getPlayers().filter((p) => p.clubId === c.clubId && p.level === '1군').map((p) => p.id) : c.playerId !== null ? [c.playerId] : [];
        const d = e.type === 'CLUBHOUSE' ? Math.round((e.value ?? 0) / 2) : (e.value ?? 0);
        this.changeMood(ids, d);
        out.push(`${e.type === 'CLUBHOUSE' ? '선수단 분위기' : '기분'} ${d >= 0 ? '▲' : '▼'}`);
      } else if (e.type === 'PRESS') {
        const meta = this.repo.getMeta();
        const key = String(c.clubId);
        this.repo.updateMeta({ press: { ...(meta.press ?? {}), [key]: clamp((meta.press?.[key] ?? E.pressStart) + (e.value ?? 0), 0, 100) } });
        out.push(`언론 관계 ${(e.value ?? 0) >= 0 ? '▲' : '▼'}`);
      } else if (e.type === 'COND' || e.type === 'INJ_RISK') {
        if (c.playerId === null) continue;
        (c.state.effects ??= []).push({ type: e.type, clubId: c.clubId, playerId: c.playerId, value: e.value ?? 0, untilWeek: c.week + (e.weeks ?? 1) });
        out.push(e.type === 'COND' ? `컨디션 ${(e.value ?? 0) >= 0 ? '▲' : '▼'}(${e.weeks}주)` : `부상 위험 ▲(${e.weeks}주)`);
      } else if (e.type === 'DEMAND' || e.type === 'MERCH' || e.type === 'FAN_TARGET') {
        (c.state.effects ??= []).push({ type: e.type, clubId: c.clubId, playerId: null, value: e.value ?? 0, untilWeek: c.week + (e.weeks ?? 1) });
        const up = e.type === 'FAN_TARGET' ? (e.value ?? 0) >= 0 : (e.value ?? 1) >= 1;
        out.push(`${e.type === 'DEMAND' ? '관중 수요' : e.type === 'MERCH' ? '굿즈 수요' : '팬 만족도 목표'} ${up ? '▲' : '▼'}(${e.weeks}주)`);
      } else if (e.type === 'RECUR') {
        // 반복 수입·지출: 지금 한 번, 이후 주 시작마다 남은 횟수만큼
        const amount = this.recurAmount(c, e.won, e.grade);
        this.repo.addLedger([{ clubId: c.clubId, date: c.date, category: 'event', amount, memo: `이벤트 ${c.cardId}(반복)` }]);
        if ((e.weeks ?? 1) > 1) (c.state.effects ??= []).push({ type: 'RECUR', clubId: c.clubId, playerId: null, value: 0, untilWeek: c.week + (e.weeks ?? 1), left: (e.weeks ?? 1) - 1, won: amount });
        out.push(`매주 ${amount < 0 ? '지출' : '수입'} ${eok(Math.abs(amount))}(${e.weeks}주)`);
      } else if (e.type === 'GROWTH') {
        const end = weekNumber(addDays(seasonKeyDates(c.meta.season).regularSeasonEnd, 40));
        (c.state.effects ??= []).push({ type: 'GROWTH', clubId: c.clubId, playerId: e.who === 'club' ? null : c.playerId, value: e.value ?? 1, untilWeek: end });
        out.push(`훈련 효과 ${(e.value ?? 1) >= 1 ? '▲' : '▼'}(시즌)`);
      }
    }
    return out;
  }

  private recurAmount(c: ApplyCtx, won: number | undefined, grade: string | undefined): number {
    if (won !== undefined) return won;
    const [lo, hi] = E.costBp[grade ?? 'small']!;
    return -Math.max(1_000_000, round1m((this.baseBudget(c.meta, c.clubId) * c.rng.int(lo, hi)) / 10_000));
  }

  /** 기분 ±(0~100). 50이면 값을 지운다 */
  private changeMood(ids: PlayerId[], delta: number): void {
    if (!ids.length || delta === 0) return;
    const set = new Set(ids);
    const changed = this.repo.getPlayers().filter((p) => set.has(p.id));
    for (const p of changed) {
      const v = clamp(Math.round(((p.mood ?? 50) + delta) * 10) / 10, 0, 100);
      if (v === 50) delete p.mood;
      else p.mood = v;
    }
    this.repo.savePlayers(changed);
  }

  /** 주 시작 정리(D-205): 기간 효과 만료, 반복 수입·지출, 기분 20%·언론 관계 5% 회복 */
  private weeklyUpkeep(meta: GameMeta, date: GameDate, week: number, state: EventState): string[] {
    const lines: string[] = [];
    const keep: Eff[] = [];
    for (const e of state.effects ?? []) {
      if (e.type === 'RECUR' && (e.left ?? 0) > 0) {
        this.repo.addLedger([{ clubId: e.clubId, date, category: 'event', amount: e.won ?? 0, memo: '이벤트(반복)' }]);
        e.left = (e.left ?? 0) - 1;
        if (e.left > 0) keep.push(e);
        continue;
      }
      if (e.untilWeek > week) keep.push(e);
    }
    state.effects = keep;
    const moody = this.repo.getPlayers().filter((p) => p.mood !== undefined);
    for (const p of moody) {
      const v = Math.round((50 + (p.mood! - 50) * (1 - E.moodRecover)) * 10) / 10;
      if (Math.abs(v - 50) < 0.5) delete p.mood;
      else p.mood = v;
    }
    if (moody.length) this.repo.savePlayers(moody);
    if (meta.press && Object.keys(meta.press).length) {
      const press = Object.fromEntries(Object.entries(meta.press).map(([k, v]) => [k, Math.round((E.pressStart + (v - E.pressStart) * (1 - E.pressRecover)) * 10) / 10]));
      this.repo.updateMeta({ press });
    }
    return lines;
  }

  // ───────── 조건 변수 ─────────

  private phaseOf(season: number, date: GameDate): CardPhase {
    const k = seasonKeyDates(season);
    return date < k.opening ? 'preseason' : date <= k.regularSeasonEnd ? 'regular' : 'postseason';
  }

  /** 우리 구단 현재 연승(+)·연패(−): 정규시즌 경기 결과 순 */
  private streak(season: number, club: ClubId): number {
    const games = this.repo.getGames(season, 'regular').filter((g) => g.home === club || g.away === club).sort((a, b) => (a.date === b.date ? a.fixtureId - b.fixtureId : a.date < b.date ? -1 : 1));
    let s = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      const g = games[i]!;
      const mine = g.home === club ? g.homeRuns : g.awayRuns;
      const opp = g.home === club ? g.awayRuns : g.homeRuns;
      if (mine === opp) break;
      const r = mine > opp ? 1 : -1;
      if (s !== 0 && Math.sign(s) !== r) break;
      s += r;
    }
    return s;
  }

  /** 주전: 구단 선수 중 능력 순 타자 9명·투수 6명(ASSUMPTION(D-203): 출전 기록 대신 공개 능력 순) */
  private starters(players: PlayerTruth[]): Set<PlayerId> {
    const by = (list: PlayerTruth[], n: number) => [...list].sort((a, b) => overall(b) - overall(a) || a.id - b.id).slice(0, n).map((p) => p.id);
    return new Set([...by(players.filter((p) => !p.isPitcher), E.starterHitters), ...by(players.filter((p) => p.isPitcher), E.starterPitchers)]);
  }

  // ───────── 주 시작 처리 ─────────

  /** 시즌 모드 월요일(일요일 처리 끝)에 한 번: 만료 → 지연 결과 → 브리핑 → 결정 카드 */
  weekStart(meta: GameMeta, monday: GameDate): void {
    if (meta.mode !== 'season') return;
    const weekId = weekIdFor(monday);
    if (this.repo.getNews({ weekId }).length) return;
    const season = meta.season;
    const club = meta.userClubId;
    const week = weekNumber(monday);
    const state: EventState = structuredClone(meta.eventState ?? newEventState());
    const rng = new Rng((meta.rngStreams.event as RngState | undefined) ?? Rng.derive(meta.seed, 'event').state());
    // 1) 만료
    for (const [k, f] of Object.entries(state.flags)) if (f.expiresWeek !== null && f.expiresWeek <= week) delete state.flags[k];
    // 1-2) 기간 효과·반복 지출·기분·언론 관계(EV-2)
    this.weeklyUpkeep(meta, monday, week, state);
    // 2) 지연 결과
    const results = [...state.pendingLines];
    state.pendingLines = [];
    const due = state.queue.filter((q) => q.week <= week);
    state.queue = state.queue.filter((q) => q.week > week);
    for (const q of due) {
      const parts = this.applyEffects(q.effects, { meta, date: monday, clubId: club, playerId: q.playerId, rng, week, cardId: q.cardId, state });
      results.push(`${q.text}${parts.length ? ` (${parts.join(', ')})` : ''}`);
    }
    // 3) 브리핑
    const fresh = this.repo.getMeta();
    const lines = this.briefingLines(fresh, monday, state, results);
    this.repo.addNews(lines.map((l, i) => ({ weekId, season, date: monday, seq: i, kind: l.kind, text: l.text })));
    // 4) 결정 카드(그 주 1장)
    const card = this.drawCard(fresh, monday, week, state, rng);
    if (card) this.resolveDelegated(fresh, monday, week, weekId, card.card, card.playerId, state, rng);
    this.repo.updateMeta({ eventState: state, rngStreams: { ...this.repo.getMeta().rngStreams, event: rng.state() } });
  }

  private drawCard(meta: GameMeta, date: GameDate, week: number, state: EventState, rng: Rng): { card: LoadedCard; playerId: PlayerId | null } | null {
    const season = meta.season;
    const club = meta.userClubId;
    const phase = this.phaseOf(season, date);
    const history = this.repo.getEventLog().map((h) => ({ cardId: h.cardId, playerId: h.playerId, week: h.week, season: h.season }));
    const players = this.repo.getPlayers().filter((p) => p.clubId === club && !p.retired);
    let fatigue: Map<PlayerId, number> | null = null;
    let starters: Set<PlayerId> | null = null;
    const rank = this.deps.rankOf().get(club) ?? null;
    const fan = meta.fans?.[String(club)]?.satisfaction ?? startSatisfaction(this.clubs.get(club)!.loyalty);
    const k = seasonKeyDates(season);
    const clubVars: Record<string, ExprValue> = {
      'club.rank': rank ?? 0,
      'club.streak': this.streak(season, club),
      'club.fan': fan,
      'club.cashEok': this.repo.cashBalance(club) / EOK,
      'club.week': Math.max(0, Math.floor(diffDays(date, k.openingWeekMonday) / 7) + 1),
      'season.half': date <= allStarDates(season).game ? 1 : 2,
    };
    const flagVar = (n: string) => (n.startsWith('flag.') ? (state.flags[n.slice(5)]?.value ?? 0) : undefined);
    const playerVars = (p: PlayerTruth): Record<string, ExprValue> => {
      fatigue ??= this.deps.fatigue(date, players);
      starters ??= this.starters(players);
      const inj = p.health?.injury;
      return {
        'player.injuryDays': inj && diffDays(date, inj.returnDate) < 0 ? diffDays(inj.returnDate, date) : 0,
        'player.starter': starters.has(p.id) ? 1 : 0,
        'player.age': ageOn(p.birthDate, date),
        'player.fatigue': fatigue.get(p.id) ?? 0,
        'player.pitcher': p.isPitcher ? 1 : 0,
        'player.active': p.level === '1군' && !(inj && diffDays(date, inj.returnDate) < 0) ? 1 : 0,
      };
    };
    const cands: Array<Candidate & { loaded: LoadedCard }> = [];
    const due = state.spawns.filter((s) => s.week <= week);
    state.spawns = state.spawns.filter((s) => s.week > week);
    for (const s of due) {
      const c = CARDS.find((x) => x.id === s.cardId && !x.inactive);
      if (c) cands.push({ card: c, playerId: s.playerId, spawned: true, loaded: c });
    }
    for (const c of CARDS) {
      if (c.inactive || !c.phases.includes(phase)) continue;
      if (c.target === 'club') {
        const vars = (n: string) => clubVars[n] ?? flagVar(n);
        const cand = { card: c, playerId: null };
        if (isTrue(c.cond, vars) && passesLimits(cand, history, week, season)) cands.push({ ...cand, loaded: c });
      } else {
        for (const p of players) {
          const pv = playerVars(p);
          const vars = (n: string) => pv[n] ?? clubVars[n] ?? flagVar(n);
          const cand = { card: c, playerId: p.id };
          if (isTrue(c.cond, vars) && passesLimits(cand, history, week, season)) cands.push({ ...cand, loaded: c });
        }
      }
    }
    const { pick } = pickCandidate(cands, rng, state.lastCategory);
    if (!pick) return null;
    const chosen = cands.find((c) => c === pick)!;
    return { card: chosen.loaded, playerId: chosen.playerId };
  }

  /** 담당 팀이 위임 기본 선택지로 처리(D-199·D-203 (5)). 확률 결과는 지금 정하고 다음 주에 적용·공개 */
  private resolveDelegated(meta: GameMeta, date: GameDate, week: number, weekId: GameDate, card: LoadedCard, playerId: PlayerId | null, state: EventState, rng: Rng): void {
    const choice = card.choices.find((c) => c.id === card.delegateDefault)!;
    const p = playerId !== null ? this.repo.getPlayer(playerId) : null;
    const text = card.texts[rng.int(0, card.texts.length - 1)]!.replace(/\{player\}/g, p?.name ?? '').replace(/\{club\}/g, this.clubs.get(meta.userClubId)!.shortName);
    const parts = this.applyEffects(choice.effects, { meta, date, clubId: meta.userClubId, playerId, rng, week, cardId: card.id, state });
    let outcome: string | null = null;
    if (choice.outcomes?.length) {
      let r = rng.next();
      const hit = choice.outcomes.find((o) => (r -= Math.max(E.outcomeMin, Math.min(E.outcomeMax, o.p))) < 0);
      if (hit) {
        outcome = hit.text;
        state.queue.push({ week: week + 1, cardId: card.id, playerId, effects: hit.effects, text: hit.text });
      } else if (choice.elseText) {
        outcome = choice.elseText;
        state.queue.push({ week: week + 1, cardId: card.id, playerId, effects: [], text: choice.elseText });
      }
    }
    const who = card.delegateTeam ? TEAM_LABEL[card.delegateTeam]! : '구단 운영진';
    state.pendingLines.push(`[${CATEGORY_LABEL[card.category]}] ${text} → ${who}: ${choice.text}${parts.length ? ` (${parts.join(', ')})` : ''}`);
    state.lastCategory = card.category;
    const row: EventLogRow = { season: meta.season, weekId, week, date, cardId: card.id, category: card.category, playerId, choiceId: choice.id, by: 'delegate', outcome, text: `${text} → ${choice.text}` };
    this.repo.addEventLog(row);
  }

  // ───────── 턴 브리핑(D-192·D-203 (8)) ─────────

  briefingLines(meta: GameMeta, monday: GameDate, state: EventState, results: string[]): Array<{ kind: string; text: string }> {
    const season = meta.season;
    const club = meta.userClubId;
    const from = addDays(monday, -7);
    const to = addDays(monday, -1);
    const inRange = (d: GameDate) => d >= from && d <= to;
    const warn: string[] = [];
    const good: string[] = [];
    const league: string[] = [];
    // 경기
    const games = [...this.repo.getGames(season, 'regular'), ...this.repo.getGames(season, 'postseason')].filter((g) => inRange(g.date) && (g.home === club || g.away === club));
    let w = 0, l = 0, t = 0;
    for (const g of games) {
      const mine = g.home === club ? g.homeRuns : g.awayRuns;
      const opp = g.home === club ? g.awayRuns : g.homeRuns;
      if (mine > opp) w++;
      else if (mine < opp) l++;
      else t++;
    }
    const rank = this.deps.rankOf().get(club) ?? null;
    const k = seasonKeyDates(season);
    const regular = to >= k.opening;
    const rankText = rank !== null && regular ? ` · ${rank}위${state.last.rank !== null && state.last.rank !== rank ? `(${state.last.rank > rank ? '▲' : '▼'}${Math.abs(state.last.rank - rank)})` : ''}` : '';
    const gameLine = games.length ? `지난주 ${w}승 ${l}패${t ? ` ${t}무` : ''}${rankText}` : `지난주 경기 없음${monday < k.opening ? ` (정규시즌 개막 ${md(k.opening)})` : ''}${rankText}`;
    const streak = this.streak(season, club);
    if (streak <= -E.lossStreakWarn) warn.push(`${-streak}연패 중`);
    // 재정
    const money = this.repo.ledgerRange(club, from, to);
    const cash = this.repo.cashBalance(club);
    if (cash < 0 && (state.last.cash === null || state.last.cash >= 0)) warn.push(`현금 적자 전환: 잔액 ${eok(cash)}`);
    const moneyLine = `수입 ${eok(money.income)} · 지출 ${eok(-money.expense)} · 잔액 ${eok(cash)}`;
    // 팬
    const fanState = meta.fans?.[String(club)];
    const fan = fanState?.satisfaction ?? startSatisfaction(this.clubs.get(club)!.loyalty);
    if (fanState?.lowSince) warn.push(`팬 반발 중(만족도 ${Math.round(fan)})`);
    else if (state.last.fan !== null && state.last.fan - fan >= E.fanDropWarn) warn.push(`팬 만족도 급락: ${Math.round(state.last.fan)} → ${Math.round(fan)}`);
    // 건강(기존 주간 건강 보고)
    const mine = this.repo.getPlayers().filter((p) => p.clubId === club && !p.retired);
    const hurt = mine.filter((p) => p.health?.injury && diffDays(monday, p.health.injury.returnDate) < 0);
    const starters = this.starters(mine);
    for (const p of hurt) if (inRange(p.health!.injury!.date) && starters.has(p.id)) warn.push(`주전 부상: ${p.name}(${p.health!.injury!.part} ${p.health!.injury!.severity}, 복귀 추정 ${md(p.health!.injury!.estimate.from)}~${md(p.health!.injury!.estimate.to)})`);
    const fat = this.deps.fatigue(monday, mine.filter((p) => p.level === '1군'));
    const tired = mine.filter((p) => (fat.get(p.id) ?? 0) >= E.tiredFatigue).sort((a, b) => (fat.get(b.id) ?? 0) - (fat.get(a.id) ?? 0));
    const healthLine = `부상 ${hurt.length}명${hurt.length ? `(${hurt.slice(0, 3).map((p) => `${p.name} ~${md(p.health!.injury!.estimate.to)}`).join(', ')}${hurt.length > 3 ? ` 외 ${hurt.length - 3}명` : ''})` : ''} · 고피로 1군 ${tired.length}명${tired.length ? `(${tired.slice(0, 3).map((p) => p.name).join(', ')})` : ''}`;
    // 성과: 우리 수상·업적·매진
    const awards = this.repo.getAwards({ clubId: club, season }).filter((a) => inRange(a.date));
    if (awards.length) good.push(`우리 구단 수상 ${awards.length}건: ${awards.slice(0, 3).map((a) => (a.playerId !== null ? (this.repo.getPlayer(a.playerId)?.name ?? '') : '구단')).join(', ')}${awards.length > 3 ? ' 외' : ''}`);
    const ach = this.repo.getAchievements().filter((a) => inRange(a.date));
    if (ach.length) good.push(`업적 ${ach.length}개 달성: ${ach.slice(0, 2).map((a) => a.detail).join(' · ')}`);
    const sellouts = meta.attendance?.[String(season)]?.[String(club)]?.sellouts ?? 0;
    const newSellouts = sellouts - (state.last.sellouts > sellouts ? 0 : state.last.sellouts);
    if (newSellouts > 0 && sellouts > 0) good.push(`홈경기 매진 ${newSellouts}경기`);
    // 리그: AI 구단 트레이드, 다음 주 일정
    for (const tr of (meta.tradeHistory ?? []).filter((x) => x.ai && inRange(x.date))) league.push(`트레이드: ${this.clubs.get(tr.clubA)?.shortName} ↔ ${this.clubs.get(tr.clubB)?.shortName} (${tr.aToB.length}:${tr.bToA.length})`);
    const next = this.nextWeekGames(monday, club);
    if (next.length) league.push(`이번 주 일정: ${next.length}경기 (${next.join(', ')})`);
    const nextSunday = addDays(monday, 6);
    const as = allStarDates(season);
    if (as.game >= monday && as.game <= nextSunday) league.push(`이번 주 올스타전 ${md(as.game)}`);
    const deadline = `${season}-${TRADE.deadlineMonthDay}`;
    if (deadline >= monday && deadline <= nextSunday) league.push(`트레이드 마감 ${md(deadline)}`);
    if (k.regularSeasonEnd >= monday && k.regularSeasonEnd <= nextSunday) league.push(`정규시즌 마지막 날 ${md(k.regularSeasonEnd)}`);
    // 비교 기준 갱신
    state.last = { rank, fan, sellouts, cash };
    // 조립: 경고 → 성과 → 경기 → 재정 → 건강 → 결과 회수 → 리그, 상한 15줄(리그 줄부터 접음)
    const fixed = [...warn.map((x) => ({ kind: 'warn', text: x })), ...good.map((x) => ({ kind: 'good', text: x })), { kind: 'game', text: gameLine }, { kind: 'money', text: moneyLine }, { kind: 'health', text: healthLine }, ...results.map((x) => ({ kind: 'result', text: x }))];
    const room = Math.max(0, E.briefingMax - fixed.length);
    const lg = league.length > room ? [...league.slice(0, Math.max(0, room - 1)), `리그 소식 외 ${league.length - Math.max(0, room - 1)}건`] : league;
    return [...fixed, ...lg.map((x) => ({ kind: 'league', text: x }))];
  }

  private nextWeekGames(monday: GameDate, club: ClubId): string[] {
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      for (const f of this.repo.getFixturesOn(d)) if (f.home === club || f.away === club) out.push(`${md(d)} ${f.home === club ? '홈' : '원정'} ${this.clubs.get(f.home === club ? f.away : f.home)?.shortName ?? ''}`);
    }
    return out.slice(0, 7);
  }

  // ───────── 조회 ─────────

  /** D2 시즌 이벤트 리포트(26a D2, 참고 수치) */
  report(season: number, clubId: ClubId): { cards: number; byCategory: Record<string, number>; byChoice: Record<string, number>; briefings: number; eventCashWon: number; expenseWon: number } {
    const rows = this.repo.getEventLog({ season });
    const byCategory: Record<string, number> = {};
    const byChoice: Record<string, number> = {};
    for (const r of rows) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      byChoice[`${r.cardId}:${r.choiceId}`] = (byChoice[`${r.cardId}:${r.choiceId}`] ?? 0) + 1;
    }
    const ledger = this.repo.ledgerByCategory(clubId, season);
    return {
      cards: rows.length,
      byCategory,
      byChoice,
      briefings: new Set(this.repo.getNews({ season }).map((n) => n.weekId)).size,
      eventCashWon: ledger.find((r) => r.category === 'event')?.amount ?? 0,
      expenseWon: -ledger.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0),
    };
  }
}
