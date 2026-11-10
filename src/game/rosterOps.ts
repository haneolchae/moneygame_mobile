// 2d 개막 준비·수동 로스터 (09·10·01 문서, D-119·D-120)
// 1·2군 교체, 사용자 경기 운영 계획(타순·로테이션·마무리), 시범경기, 개막 엔트리 확정.
// 명단 편집은 행동력을 쓰지 않는다(D-119). 실행 명령과 화면 조회는 같은 검증 함수를 쓴다.
import { addDays, diffDays, weekday, type GameDate } from '../engine/calendar';
import { EXHIBITION, LEAGUE, ROSTER_COMPOSITION, ROSTER_MOVE } from '../engine/config';
import { simulateGame, type GameResult } from '../engine/gamesim';
import { planProblems, prepareTeam, recommendPlan, repairPlan, type GamePlan } from '../engine/lineup';
import { NEUTRAL_ENVIRONMENT } from '../engine/probability';
import { Rng } from '../engine/rng';
import { rosterCounts } from '../engine/roster';
import { seasonKeyDates } from '../engine/schedule';
import type { ClubId, PlayerId, PlayerTruth } from '../engine/types';
import { overall } from '../engine/worldgen';
import { GameError } from '../shared/protocol';
import type { FormTracker } from './formTracker';
import type { ExhibitionLine, ExhibitionState, GameMeta, GameRepository, InboxMessage, RosterMove, UserPlanState } from './ports';

const emptyLine = (): ExhibitionLine => ({ G: 0, PA: 0, AB: 0, H: 0, HR: 0, BB: 0, SO: 0, RBI: 0, GP: 0, OUTS: 0, HA: 0, ER: 0, BBA: 0, K: 0 });

/** 그 시즌 시범경기 날짜(월요일 제외) */
export function exhibitionDates(season: number): GameDate[] {
  const opening = seasonKeyDates(season).opening;
  const out: GameDate[] = [];
  for (let d = addDays(opening, -EXHIBITION.startDaysBeforeOpening); diffDays(d, addDays(opening, -EXHIBITION.endDaysBeforeOpening)) <= 0; d = addDays(d, 1)) {
    if (weekday(d) !== 1) out.push(d);
  }
  return out;
}

/** 순환 대진(원형 방식): 하루 5경기, 10개 구단이 모두 한 경기씩. 날짜 순번으로 라운드·홈을 바꾼다. */
export function exhibitionPairs(clubIds: ClubId[], dayIndex: number): Array<[ClubId, ClubId]> {
  const t = [...clubIds].sort((a, b) => a - b);
  const n = t.length;
  const round = dayIndex % (n - 1);
  const rest = t.slice(1);
  const rotated = [...rest.slice(rest.length - round), ...rest.slice(0, rest.length - round)];
  const a = [t[0]!, ...rotated];
  const pairs: Array<[ClubId, ClubId]> = [];
  for (let i = 0; i < n / 2; i++) {
    const x = a[i]!;
    const y = a[n - 1 - i]!;
    pairs.push(dayIndex % 2 === 0 ? [x, y] : [y, x]);
  }
  return pairs;
}

export class RosterOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly forms: FormTracker,
  ) {}

  private mine(meta: GameMeta): PlayerTruth[] {
    return this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId);
  }

  planState(meta: GameMeta): UserPlanState {
    return meta.userPlan ?? { mode: 'auto', plan: null };
  }

  moves(meta: GameMeta): RosterMove[] {
    return meta.rosterMoves ?? [];
  }

  exhibition(meta: GameMeta): ExhibitionState | null {
    const x = meta.exhibition;
    return x && x.season === meta.season ? x : null;
  }

  /** 경기 준비에 쓸 우리 구단 계획(수동일 때만) */
  activePlan(meta: GameMeta): GamePlan | null {
    const s = this.planState(meta);
    return s.mode === 'manual' ? s.plan : null;
  }

  /** 편성 가능 시기: 시즌 모드(스프링캠프 2/1 ~ 한국시리즈). 스토브리그에는 2/1에 1군을 다시 짜므로 막는다(D-120). */
  editLock(meta: GameMeta): string | null {
    return meta.mode === 'season' ? null : `1·2군 편성은 스프링캠프(${seasonKeyDates(meta.season + 1).opening.slice(0, 4)}-02-01)부터 할 수 있습니다. 2/1에 감독 추천 1군으로 캠프 명단을 짭니다.`;
  }

  /** 다시 1군에 등록할 수 있는 날짜(제한 없으면 null): 개막 뒤 말소한 날 + 10일(D-120) */
  reRegisterDate(meta: GameMeta, playerId: PlayerId): GameDate | null {
    const opening = seasonKeyDates(meta.season).opening;
    const last = this.moves(meta).filter((m) => m.playerId === playerId && m.to === '2군' && diffDays(m.date, opening) >= 0).at(-1);
    if (!last) return null;
    const free = addDays(last.date, ROSTER_MOVE.reRegisterDays);
    return diffDays(meta.currentDate, free) < 0 ? free : null;
  }

  /** 1·2군 교체 검증(실행·화면 공용). 통과하면 교체 뒤 우리 구단 선수 목록을 돌려준다. */
  checkMove(meta: GameMeta, promote: PlayerId[], demote: PlayerId[]): PlayerTruth[] {
    const lock = this.editLock(meta);
    if (lock) throw new GameError('ROSTER_LOCKED', lock);
    if (promote.length === 0 && demote.length === 0) throw new GameError('INVALID', '바꿀 선수를 고르세요.');
    if (new Set([...promote, ...demote]).size !== promote.length + demote.length) throw new GameError('INVALID', '같은 선수를 올리고 내릴 수 없습니다.');
    const mine = this.mine(meta).map((p) => ({ ...p }));
    const byId = new Map(mine.map((p) => [p.id, p]));
    for (const id of promote) {
      const p = byId.get(id);
      if (!p) throw new GameError('NOT_AVAILABLE', '우리 구단 선수가 아닙니다.');
      if (p.level === '1군') throw new GameError('INVALID', `${p.name}은 이미 1군입니다.`);
      if (p.health?.injury && diffDays(meta.currentDate, p.health.injury.returnDate) < 0) throw new GameError('INJURED', `${p.name}은 부상 중이라 1군에 등록할 수 없습니다(복귀 추정 ${p.health.injury.estimate.from.slice(5).replace('-', '/')}~${p.health.injury.estimate.to.slice(5).replace('-', '/')}).`);
      const until = this.reRegisterDate(meta, id);
      if (until) throw new GameError('RE_REGISTER', `${p.name}은 1군 말소 뒤 ${ROSTER_MOVE.reRegisterDays}일이 지나야 다시 등록할 수 있습니다(${until.slice(5).replace('-', '/')}부터).`);
      p.level = '1군';
    }
    for (const id of demote) {
      const p = byId.get(id);
      if (!p) throw new GameError('NOT_AVAILABLE', '우리 구단 선수가 아닙니다.');
      if (p.level !== '1군') throw new GameError('INVALID', `${p.name}은 1군이 아닙니다.`);
      p.level = '2군';
    }
    const active = mine.filter((p) => p.level === '1군');
    const before = rosterCounts(this.mine(meta).filter((p) => p.level === '1군'));
    // 최소 인원은 '이번 변경으로 더 나빠지는 경우'만 막는다. 부상 등으로 이미 모자란 상태에서 관계없는 교체까지 막지 않는다.
    const worse = (after: number, prev: number, min: number) => after < min && after < prev;
    if (active.length !== LEAGUE.activeRoster) throw new GameError('ROSTER_RULE', `1군은 ${LEAGUE.activeRoster}명이어야 합니다(변경 뒤 ${active.length}명). 올리는 선수와 내리는 선수 수를 맞추세요.`);
    const c = rosterCounts(active);
    if (worse(c.pitchers, before.pitchers, ROSTER_COMPOSITION.activeMinPitchers)) throw new GameError('ROSTER_RULE', `1군 투수는 ${ROSTER_COMPOSITION.activeMinPitchers}명 이상이어야 합니다(변경 뒤 ${c.pitchers}명).`);
    if (worse(c.hitters, before.hitters, ROSTER_COMPOSITION.activeMinHitters)) throw new GameError('ROSTER_RULE', `1군 야수는 ${ROSTER_COMPOSITION.activeMinHitters}명 이상이어야 합니다(변경 뒤 ${c.hitters}명).`);
    if (worse(c.catchers, before.catchers, ROSTER_MOVE.activeMinCatchers)) throw new GameError('ROSTER_RULE', `1군 포수는 ${ROSTER_MOVE.activeMinCatchers}명 이상이어야 합니다(변경 뒤 ${c.catchers}명).`);
    return mine;
  }

  /** 1·2군 교체 확정: 선수 등급·이동 기록·계획 보정을 한 트랜잭션으로 반영한다. 행동력 0(D-119). */
  move(meta: GameMeta, promote: PlayerId[], demote: PlayerId[]): string {
    const after = this.checkMove(meta, promote, demote);
    return this.repo.transaction(() => {
      const changed = this.repo.getPlayers().filter((p) => promote.includes(p.id) || demote.includes(p.id));
      for (const p of changed) p.level = promote.includes(p.id) ? '1군' : '2군';
      this.repo.savePlayers(changed);
      const log: RosterMove[] = [...promote.map((id) => ({ date: meta.currentDate, playerId: id, to: '1군' as const })), ...demote.map((id) => ({ date: meta.currentDate, playerId: id, to: '2군' as const }))];
      this.repo.updateMeta({ rosterMoves: [...this.moves(meta), ...log] });
      const fixed = this.repairUserPlan(meta, after.filter((p) => p.level === '1군'));
      const names = (ids: PlayerId[]) => ids.map((id) => after.find((p) => p.id === id)?.name).join(', ');
      return [promote.length ? `1군 등록: ${names(promote)}` : '', demote.length ? `2군 말소: ${names(demote)}` : '', fixed].filter(Boolean).join(' · ');
    });
  }

  /**
   * 부상 처리용 강제 교체(4b-1, D-126): 사용자 교체 검증(최소 인원 등)은 건너뛰지만 이동 기록과 계획 보정은 같게 한다.
   * 우리 구단 선수만 이동 기록을 남긴다(재등록 10일 판정용).
   */
  forceMoves(meta: GameMeta, players: PlayerTruth[], promote: PlayerTruth[], demote: PlayerTruth[]): string {
    for (const p of promote) p.level = '1군';
    for (const p of demote) p.level = '2군';
    this.repo.savePlayers([...promote, ...demote]);
    const mine = (p: PlayerTruth) => p.clubId === meta.userClubId;
    const log: RosterMove[] = [...promote.filter(mine).map((p) => ({ date: meta.currentDate, playerId: p.id, to: '1군' as const })), ...demote.filter(mine).map((p) => ({ date: meta.currentDate, playerId: p.id, to: '2군' as const }))];
    if (log.length === 0) return '';
    const current = this.repo.getMeta();
    this.repo.updateMeta({ rosterMoves: [...this.moves(current), ...log] });
    return this.repairUserPlan(this.repo.getMeta(), players.filter((p) => p.clubId === meta.userClubId && p.level === '1군'));
  }

  /** 시즌 중 1군 선수가 빠져 26명이 안 되면(방출 등) 감독 추천으로 2군에서 채운다. 재등록 제한은 지킨다. */
  fillActive(meta: GameMeta): string {
    const mine = this.mine(meta);
    const active = mine.filter((p) => p.level === '1군');
    const need = LEAGUE.activeRoster - active.length;
    if (meta.mode !== 'season' || need <= 0) return '';
    const c = rosterCounts(active);
    const wantPitcher = c.pitchers < ROSTER_COMPOSITION.activeMinPitchers ? true : c.hitters < ROSTER_COMPOSITION.activeMinHitters ? false : null;
    const pool = mine
      .filter((p) => p.level === '2군' && !this.reRegisterDate(meta, p.id) && !(p.health?.injury && diffDays(meta.currentDate, p.health.injury.returnDate) < 0) && (wantPitcher === null || p.isPitcher === wantPitcher))
      .sort((a, b) => overall(b) - overall(a) || a.id - b.id)
      .slice(0, need);
    if (pool.length === 0) return '';
    for (const p of pool) p.level = '1군';
    this.repo.savePlayers(pool);
    this.repo.updateMeta({ rosterMoves: [...this.moves(meta), ...pool.map((p) => ({ date: meta.currentDate, playerId: p.id, to: '1군' as const }))] });
    const fixed = this.repairUserPlan(this.repo.getMeta(), this.mine(meta).filter((p) => p.level === '1군'));
    return `빈 1군 자리에 ${pool.map((p) => p.name).join(', ')} 등록(감독 추천)${fixed ? ` · ${fixed}` : ''}`;
  }

  /** 수동 계획에서 1군이 아닌 선수를 감독 추천으로 바꾼다. 바꾼 내용을 문장으로 돌려준다. */
  private repairUserPlan(meta: GameMeta, active: PlayerTruth[]): string {
    const s = this.planState(meta);
    if (s.mode !== 'manual' || !s.plan) return '';
    const r = repairPlan(s.plan, active, ROSTER_MOVE.rotationSize);
    if (r.changes.length === 0) return '';
    this.repo.updateMeta({ userPlan: { mode: 'manual', plan: r.plan } });
    return `운영 계획 보정 — ${r.changes.join(', ')}`;
  }

  recommended(meta: GameMeta): GamePlan {
    return recommendPlan(this.mine(meta).filter((p) => p.level === '1군'), ROSTER_MOVE.rotationSize);
  }

  problems(meta: GameMeta, plan: GamePlan): string[] {
    return planProblems(plan, this.mine(meta).filter((p) => p.level === '1군'), ROSTER_MOVE.rotationSize);
  }

  /** 운영 방식·계획 저장. 수동은 검증을 통과해야 저장한다. 행동력 0(D-119). */
  setPlan(meta: GameMeta, mode: 'auto' | 'manual', plan?: GamePlan): string {
    const lock = this.editLock(meta);
    if (lock) throw new GameError('ROSTER_LOCKED', lock);
    if (mode === 'auto') {
      this.repo.updateMeta({ userPlan: { mode: 'auto', plan: this.planState(meta).plan } });
      return '감독 자동 운영으로 바꿨습니다. 저장한 계획은 남겨 두며 다시 수동으로 바꾸면 쓸 수 있습니다.';
    }
    const p = plan ?? this.planState(meta).plan ?? this.recommended(meta);
    const errs = this.problems(meta, p);
    if (errs.length) throw new GameError('PLAN_INVALID', errs.join(' '));
    this.repo.updateMeta({ userPlan: { mode: 'manual', plan: p } });
    return '경기 운영 계획을 저장했습니다. 다음 경기부터 이 타순·로테이션·마무리로 나갑니다.';
  }

  // ───────── 시즌 흐름 (하루 처리 트랜잭션 안에서 호출) ─────────

  /** 2/1 시즌 모드 시작: 이동 기록·시범경기 초기화, 수동 계획은 새 1군에 맞춰 보정 */
  onSeasonStart(meta: GameMeta, season: number, date: GameDate): { update: Partial<GameMeta>; inbox: InboxMessage[] } {
    const active = this.mine(meta).filter((p) => p.level === '1군');
    const s = this.planState(meta);
    const update: Partial<GameMeta> = { rosterMoves: [], exhibition: { season, games: [], stats: {}, lastStarters: {} } satisfies ExhibitionState };
    let planNote = '경기 운영은 감독 자동 운영입니다.';
    if (s.mode === 'manual' && s.plan) {
      const r = repairPlan(s.plan, active, ROSTER_MOVE.rotationSize);
      update.userPlan = { mode: 'manual', plan: r.plan };
      planNote = r.changes.length ? `수동 운영 계획을 새 1군에 맞춰 보정했습니다(${r.changes.join(', ')}).` : '수동 운영 계획을 그대로 씁니다.';
    }
    const k = seasonKeyDates(season);
    const ex = exhibitionDates(season);
    const md = (d: GameDate) => d.slice(5).replace('-', '/');
    return {
      update,
      inbox: [
        {
          date,
          kind: 'task',
          sender: '감독',
          title: `스프링캠프 시작 · 개막 엔트리 초안 (개막 ${md(k.opening)})`,
          body: `감독 추천으로 1군 ${LEAGUE.activeRoster}명을 짰습니다. 개막 전날까지 [선수단 운영]에서 1·2군과 타순·로테이션을 바꿀 수 있고, 개막일의 1군이 개막 엔트리가 됩니다(행동력 0).\n시범경기: ${md(ex[0]!)}~${md(ex[ex.length - 1]!)} (기록은 정규시즌에 넣지 않음)\n${planNote}`,
        },
      ],
    };
  }

  /** 개막일: 그 시점 1군을 개막 엔트리로 알린다. */
  openingNotice(meta: GameMeta, date: GameDate): InboxMessage | null {
    if (meta.mode !== 'season' || date !== seasonKeyDates(meta.season).opening) return null;
    const active = this.mine(meta).filter((p) => p.level === '1군');
    const c = rosterCounts(active);
    return {
      date,
      kind: 'news',
      sender: '감독',
      title: `${meta.season} 개막 엔트리 확정 (1군 ${active.length}명)`,
      body: `투수 ${c.pitchers}명 · 야수 ${c.hitters}명(포수 ${c.catchers}명). 경기 운영: ${this.planState(meta).mode === 'manual' ? '구단주 수동 계획' : '감독 자동 운영'}.\n오늘부터 1군에서 말소한 선수는 ${ROSTER_MOVE.reRegisterDays}일 뒤에 다시 등록할 수 있습니다.`,
    };
  }

  /** 시범경기 하루: 같은 경기 엔진, 저장 시드 파생 난수. 점수와 우리 선수 기록만 meta에 남긴다(D-120). */
  playExhibition(meta: GameMeta, date: GameDate, env = NEUTRAL_ENVIRONMENT, out: ReadonlySet<PlayerId> = new Set()): { update: Partial<GameMeta>; inbox: InboxMessage[]; games: number } | null {
    if (meta.mode !== 'season') return null;
    const dates = exhibitionDates(meta.season);
    const dayIndex = dates.indexOf(date);
    if (dayIndex < 0) return null;
    const state: ExhibitionState = this.exhibition(meta) ?? { season: meta.season, games: [], stats: {}, lastStarters: {} };
    if (state.games.some((g) => g.date === date)) return null;
    const clubIds = this.repo.getClubs().map((c) => c.id);
    const active = this.repo.getActivePlayers(clubIds);
    const forms = this.forms.formsFor(meta.season, date, active, env);
    const userPlan = this.activePlan(meta);
    const results: GameResult[] = [];
    exhibitionPairs(clubIds, dayIndex).forEach(([home, away], i) => {
      const gameId = -(meta.season * 1000 + dayIndex * 10 + i + 1);
      const team = (clubId: ClubId) => prepareTeam(clubId, active.filter((p) => p.clubId === clubId), [], state.lastStarters[String(clubId)] ?? null, clubId === meta.userClubId ? userPlan : null, ROSTER_MOVE.rotationSize, { out });
      const r = simulateGame(gameId, team(home), team(away), Rng.derive(meta.seed, 'exhibition', meta.season, dayIndex, i), EXHIBITION.maxInnings, env, { forms, postseason: false });
      results.push(r);
      state.lastStarters[String(home)] = r.starters.home;
      state.lastStarters[String(away)] = r.starters.away;
      state.games.push({ date, home, away, homeRuns: r.homeRuns, awayRuns: r.awayRuns });
    });
    // 우리 선수 기록 누적
    const mine = new Set(this.mine(meta).map((p) => p.id));
    const line = (id: PlayerId) => (state.stats[String(id)] ??= emptyLine());
    for (const r of results) {
      if (r.home !== meta.userClubId && r.away !== meta.userClubId) continue;
      const batted = new Set<PlayerId>();
      const pitched = new Set<PlayerId>();
      for (const e of r.events) {
        if (mine.has(e.batterId)) {
          const l = line(e.batterId);
          batted.add(e.batterId);
          l.PA++;
          if (!['BB', 'HBP', 'SF'].includes(e.outcome)) l.AB++;
          if (['1B', '2B', '3B', 'HR'].includes(e.outcome)) l.H++;
          if (e.outcome === 'HR') l.HR++;
          if (e.outcome === 'BB') l.BB++;
          if (e.outcome === 'K') l.SO++;
          l.RBI += e.rbi;
        }
        if (mine.has(e.pitcherId)) {
          const l = line(e.pitcherId);
          pitched.add(e.pitcherId);
          l.OUTS += e.outsOnPlay;
          if (['1B', '2B', '3B', 'HR'].includes(e.outcome)) l.HA++;
          if (e.outcome === 'BB') l.BBA++;
          if (e.outcome === 'K') l.K++;
        }
      }
      for (const run of r.runs) if (mine.has(run.pitcherId) && run.earned) line(run.pitcherId).ER++;
      for (const id of batted) line(id).G++;
      for (const id of pitched) line(id).GP++;
    }
    const inbox: InboxMessage[] = [];
    if (dayIndex === dates.length - 1) {
      const ours = state.games.filter((g) => g.home === meta.userClubId || g.away === meta.userClubId);
      const res = ours.map((g) => {
        const us = g.home === meta.userClubId ? g.homeRuns : g.awayRuns;
        const them = g.home === meta.userClubId ? g.awayRuns : g.homeRuns;
        return us > them ? 'W' : us < them ? 'L' : 'T';
      });
      inbox.push({
        date,
        kind: 'report',
        sender: '감독',
        title: `시범경기 종료: ${res.filter((x) => x === 'W').length}승 ${res.filter((x) => x === 'L').length}패 ${res.filter((x) => x === 'T').length}무`,
        body: `선수별 시범경기 기록은 [선수단 운영]에서 볼 수 있습니다(정규시즌 기록에는 넣지 않음). 개막 전날까지 1군 명단을 조정하세요.`,
      });
    }
    return { update: { exhibition: state }, inbox, games: results.length };
  }
}
