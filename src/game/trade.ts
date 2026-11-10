// 5a 트레이드(09·18b 문서, D-130·D-131): 거래 기간, 교환안 검증·미리보기, 세션 과금, AI 응답(수락·현금 역제안·거절),
// 양 구단 일괄 이적(소속·현금·1군 보충), 명령 식별자 중복 방지와 ActionLog.
// 검증 실패는 비용이 없고, 확정은 행동력·처리량·이적·장부·협상 기록·ActionLog를 한 트랜잭션으로 바꾼다.
import { addDays, ageOn, diffDays, type GameDate } from '../engine/calendar';
import { FOREIGN, LEAGUE, ROSTER_COMPOSITION, ROSTER_MOVE, TRADE as T } from '../engine/config';
import { rosterCounts } from '../engine/roster';
import { TASK_WP } from '../engine/staff';
import { clubMargin, decide, needOf, phaseOf, playerValue, ratingFor, type ValueContext } from '../engine/trade';
import type { ClubId, PlayerId, PlayerTruth } from '../engine/types';
import { overall } from '../engine/worldgen';
import { GameError } from '../shared/protocol';
import type { Organization } from './organization';
import type { ActionLogEntry, GameMeta, GameRepository, InboxMessage, TradePackage, TradeTalk } from './ports';
import type { RosterOps } from './rosterOps';
import { weekIdFor } from './week';

const EOK = 100_000_000;
const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);

export interface TradeEvaluation {
  /** AI가 받는 가치·주는 가치·필요 값(원). 화면 응답에 넣지 않는다 */
  G: number;
  L: number;
  decision: ReturnType<typeof decide>;
  reasons: string[];
}

export interface TradeResponse {
  result: 'accept' | 'counter' | 'reject';
  message: string;
  counter: TradePackage | null;
  apCharged: number;
}

export class TradeOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly org: Organization,
    private readonly roster: RosterOps,
    private readonly rankOf: (clubId: ClubId) => number | null,
  ) {}

  // ───────── 기간·대상 ─────────

  /** 거래할 수 없는 이유(없으면 null) */
  windowReason(meta: GameMeta): string | null {
    if (meta.gameOver) return '종료된 게임입니다.';
    const date = meta.currentDate;
    if (meta.mode === 'stove') {
      const open = addDays(meta.kDate, T.stoveOpenDaysAfterK);
      return diffDays(date, open) < 0 ? `스토브리그 트레이드는 ${open.slice(5).replace('-', '/')}(시즌 마감 단계 뒤)부터 할 수 있습니다.` : null;
    }
    if (meta.postseason?.season === meta.season) return '포스트시즌 중에는 트레이드할 수 없습니다.';
    const deadline = `${date.slice(0, 4)}-${T.deadlineMonthDay}`;
    return diffDays(date, deadline) > 0 ? `트레이드 마감(${T.deadlineMonthDay.replace('-', '/')})이 지났습니다. 스토브리그에 다시 열립니다.` : null;
  }

  private hurtDays(p: PlayerTruth, date: GameDate, own: boolean): number {
    const inj = p.health?.injury;
    if (!inj || diffDays(date, inj.returnDate) >= 0) return 0;
    // 다른 구단은 진단 추정 범위 가운데로 본다(실제 복귀일을 읽지 않음)
    if (own) return diffDays(inj.returnDate, date);
    const mid = addDays(inj.estimate.from, Math.round(diffDays(inj.estimate.to, inj.estimate.from) / 2));
    return Math.max(0, diffDays(mid, date));
  }

  /** 이 선수를 거래할 수 없는 이유 */
  tradableReason(meta: GameMeta, p: PlayerTruth | null, clubId: ClubId): string | null {
    if (!p || p.clubId !== clubId) return '해당 구단 소속 선수가 아닙니다.';
    if (p.retired) return '은퇴한 선수입니다.';
    if (p.career.faEligible && p.contractYears === 0 && meta.mode === 'stove') return 'FA 자격으로 계약이 끝난 선수입니다.';
    if ((meta.retirementPending ?? []).some((x) => x.playerId === p.id)) return '은퇴를 고민 중인 선수입니다.';
    if (meta.mode === 'stove' && this.repo.getSalaryTalks(meta.season).some((t) => t.playerId === p.id && t.status === 'open')) return '연봉 협상 중인 선수입니다.';
    return null;
  }

  // ───────── 검증·미리보기 ─────────

  private normalize(pkg: TradePackage): TradePackage {
    return { give: [...new Set((pkg.give ?? []).map(Number))].sort((a, b) => a - b), get: [...new Set((pkg.get ?? []).map(Number))].sort((a, b) => a - b), cashWon: Math.round(Number(pkg.cashWon ?? 0)) };
  }

  /** 거래 뒤 양쪽 선수단(1군 보충 전) */
  private after(players: PlayerTruth[], userClub: ClubId, clubId: ClubId, pkg: TradePackage) {
    const moved = (p: PlayerTruth): PlayerTruth => (pkg.give.includes(p.id) ? { ...p, clubId, level: '2군' } : pkg.get.includes(p.id) ? { ...p, clubId: userClub, level: '2군' } : p);
    const next = players.map(moved);
    return { ours: next.filter((p) => p.clubId === userClub && !p.retired), theirs: next.filter((p) => p.clubId === clubId && !p.retired) };
  }

  private rosterErrors(label: string, roster: PlayerTruth[]): string[] {
    const out: string[] = [];
    if (roster.length > LEAGUE.rosterMax) out.push(`${label} 선수단 ${roster.length}명 > ${LEAGUE.rosterMax}명`);
    const foreign = roster.filter((p) => p.origin === 'foreign').length;
    const asia = roster.filter((p) => p.origin === 'asia').length;
    if (foreign > FOREIGN.maxForeign) out.push(`${label} 외국인 ${foreign}명 > ${FOREIGN.maxForeign}명`);
    if (asia > FOREIGN.maxAsia) out.push(`${label} 아시아쿼터 ${asia}명 > ${FOREIGN.maxAsia}명`);
    const all = rosterCounts(roster);
    if (all.pitchers < ROSTER_COMPOSITION.minPitchers) out.push(`${label} 투수 ${all.pitchers}명 < ${ROSTER_COMPOSITION.minPitchers}명`);
    if (all.hitters < ROSTER_COMPOSITION.minHitters) out.push(`${label} 야수 ${all.hitters}명 < ${ROSTER_COMPOSITION.minHitters}명`);
    if (all.catchers < ROSTER_COMPOSITION.minCatchers) out.push(`${label} 포수 ${all.catchers}명 < ${ROSTER_COMPOSITION.minCatchers}명`);
    return out;
  }

  /** 교환안 검증(무료). 상대 반응은 계산하지 않는다 */
  validate(meta: GameMeta, clubId: ClubId, raw: TradePackage): { pkg: TradePackage; errors: string[]; preview: { ours: { before: number; after: number; salaryDelta: number }; theirs: { before: number; after: number } } } {
    const pkg = this.normalize(raw);
    const errors: string[] = [];
    const window = this.windowReason(meta);
    if (window) errors.push(window);
    if (clubId === meta.userClubId || !this.repo.getClubs().some((c) => c.id === clubId)) errors.push('상대 구단이 올바르지 않습니다.');
    if (pkg.give.length + pkg.get.length === 0) errors.push('주고받을 선수를 한 명 이상 고르세요.');
    if (pkg.give.length > T.maxPlayersPerSide || pkg.get.length > T.maxPlayersPerSide) errors.push(`한쪽에 최대 ${T.maxPlayersPerSide}명까지 넣을 수 있습니다.`);
    if (!Number.isFinite(pkg.cashWon) || Math.abs(pkg.cashWon) > T.maxCashWon) errors.push(`현금은 ${won(T.maxCashWon)}까지입니다.`);
    const players = this.repo.getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const id of pkg.give) {
      const r = this.tradableReason(meta, byId.get(id) ?? null, meta.userClubId);
      if (r) errors.push(`${byId.get(id)?.name ?? `#${id}`}: ${r}`);
    }
    for (const id of pkg.get) {
      const r = this.tradableReason(meta, byId.get(id) ?? null, clubId);
      if (r) errors.push(`${byId.get(id)?.name ?? `#${id}`}: ${r}`);
    }
    if (pkg.cashWon > 0 && this.repo.cashBalance(meta.userClubId) < pkg.cashWon) errors.push(`현금이 부족합니다(필요 ${won(pkg.cashWon)}).`);
    if (pkg.cashWon < 0 && this.repo.cashBalance(clubId) - T.aiCashReserveWon < -pkg.cashWon) errors.push('상대 구단이 그만한 현금을 낼 수 없습니다.');
    const ours0 = players.filter((p) => p.clubId === meta.userClubId && !p.retired);
    const theirs0 = players.filter((p) => p.clubId === clubId && !p.retired);
    const next = this.after(players, meta.userClubId, clubId, pkg);
    errors.push(...this.rosterErrors('우리', next.ours), ...this.rosterErrors('상대', next.theirs));
    const salary = (ids: number[]) => ids.reduce((a, id) => a + (byId.get(id)?.salary ?? 0), 0);
    return {
      pkg,
      errors,
      preview: { ours: { before: ours0.length, after: next.ours.length, salaryDelta: salary(pkg.get) - salary(pkg.give) }, theirs: { before: theirs0.length, after: next.theirs.length } },
    };
  }

  // ───────── AI 평가 ─────────

  /** 순위는 날짜마다 한 번만 계산한다(평가 반복 때 순위표 재계산 방지) */
  private rankCache: { date: string; ranks: Map<ClubId, number | null> } | null = null;
  private rank(date: string, clubId: ClubId): number | null {
    if (!this.rankCache || this.rankCache.date !== date) this.rankCache = { date, ranks: new Map() };
    if (!this.rankCache.ranks.has(clubId)) this.rankCache.ranks.set(clubId, this.rankOf(clubId));
    return this.rankCache.ranks.get(clubId)!;
  }

  private context(meta: GameMeta, evaluator: ClubId | null, roster: PlayerTruth[]): ValueContext {
    const date = meta.currentDate;
    const y = date.slice(0, 4);
    const start = `${y}-03-28`;
    const end = `${y}-10-01`;
    const share = meta.mode === 'season' ? Math.max(0.1, Math.min(1, diffDays(end, diffDays(date, start) > 0 ? date : start) / diffDays(end, start))) : 1;
    return {
      seed: meta.seed,
      season: meta.season,
      evaluatorClubId: evaluator,
      inSeason: meta.mode === 'season',
      seasonShare: share,
      phase: evaluator === null ? 'neutral' : phaseOf(this.rank(date, evaluator)),
      need: evaluator === null ? { pitcher: 1, hitter: 1, catcher: 1 } : needOf(roster),
    };
  }

  /** 실제 가치(검증용): 실제 현재 능력·중립 수요·중립 단계 */
  truthValue(meta: GameMeta, p: PlayerTruth): number {
    return playerValue(p, overall(p), ageOn(p.birthDate, meta.currentDate), this.context(meta, null, []), 'truth');
  }

  /** 상대 구단 AI 평가. 같은 날 같은 교환안이면 같은 결과 */
  evaluate(meta: GameMeta, clubId: ClubId, pkg: TradePackage): TradeEvaluation {
    const players = this.repo.getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const theirs = players.filter((p) => p.clubId === clubId && !p.retired);
    const ctx = this.context(meta, clubId, theirs);
    const date = meta.currentDate;
    const val = (id: number, role: 'get' | 'give') => {
      const p = byId.get(id)!;
      return playerValue(p, ratingFor(meta.seed, meta.season, clubId, p), ageOn(p.birthDate, date), ctx, role, this.hurtDays(p, date, p.clubId === clubId));
    };
    const G = pkg.give.reduce((a, id) => a + val(id, 'get'), 0) + Math.max(0, pkg.cashWon);
    const L = pkg.get.reduce((a, id) => a + val(id, 'give'), 0) + Math.max(0, -pkg.cashWon);
    const decision = decide(G, L, clubMargin(meta.seed, clubId, meta.season));
    const reasons: string[] = [];
    if (ctx.phase === 'contender') reasons.push('우승 경쟁 중이라 당장 쓸 전력을 중요하게 봅니다.');
    if (ctx.phase === 'rebuild') reasons.push('리빌딩 중이라 젊은 선수와 미래 가치를 중요하게 봅니다.');
    const needLabel = [ctx.need.pitcher > 1 ? '투수' : '', ctx.need.hitter > 1 ? '야수' : '', ctx.need.catcher > 1 ? '포수' : ''].filter(Boolean);
    if (needLabel.length) reasons.push(`${needLabel.join('·')} 보강이 필요합니다.`);
    const surplus = [ctx.need.pitcher < 1 ? '투수' : '', ctx.need.hitter < 1 ? '야수' : ''].filter(Boolean);
    if (surplus.length) reasons.push(`${surplus.join('·')}는 이미 넉넉합니다.`);
    if (pkg.get.some((id) => byId.get(id)?.career.franchise)) reasons.push('간판 선수는 쉽게 내줄 수 없습니다.');
    if (pkg.give.some((id) => (byId.get(id)?.health?.injury && this.hurtDays(byId.get(id)!, date, false) > 0))) reasons.push('부상 중인 선수는 결장 기간만큼 낮게 봅니다.');
    return { G, L, decision, reasons };
  }

  // ───────── 세션·명령 ─────────

  private talk(meta: GameMeta, clubId: ClubId): TradeTalk {
    const t = meta.tradeTalks?.[String(clubId)];
    return t && t.season === meta.season ? t : { clubId, season: meta.season, weeksPaid: [], log: [], counter: null };
  }

  /** 이번 주 세션 상태 */
  session(meta: GameMeta, clubId: ClubId) {
    const weekId = weekIdFor(meta.currentDate);
    const t = this.talk(meta, clubId);
    const used = t.log.filter((l) => l.weekId === weekId && l.kind === 'proposal').length;
    return { weekId, open: t.weeksPaid.includes(weekId), proposalsLeft: Math.max(0, T.proposalsPerSession - used), counter: t.counter && t.counter.weekId === weekId ? t.counter.pkg : null, talk: t };
  }

  private logged(meta: GameMeta, commandId: string): ActionLogEntry | null {
    if (!commandId) return null;
    return (meta.actionLog ?? []).find((e) => e.commandId === commandId) ?? null;
  }

  private appendLog(entry: ActionLogEntry) {
    const meta = this.repo.getMeta();
    this.repo.updateMeta({ actionLog: [...(meta.actionLog ?? []), entry].slice(-T.actionLogMax) });
  }

  private saveTalk(t: TradeTalk) {
    const meta = this.repo.getMeta();
    const talks = Object.fromEntries(Object.entries(meta.tradeTalks ?? {}).filter(([, v]) => v.season === meta.season));
    this.repo.updateMeta({ tradeTalks: { ...talks, [String(t.clubId)]: t } });
  }

  private requireCommandId(commandId: string) {
    if (typeof commandId !== 'string' || commandId.length < 6 || commandId.length > 80) throw new GameError('INVALID', '명령 식별자가 필요합니다.');
  }

  /** 제안: 세션이 없으면 행동력 1 + 운영팀 처리량 5로 연다. 세션당 제안 3회 */
  propose(meta: GameMeta, clubId: ClubId, raw: TradePackage, commandId: string): TradeResponse {
    this.requireCommandId(commandId);
    const prior = this.logged(meta, commandId);
    if (prior) return { result: prior.result === 'error' ? 'reject' : prior.result, message: prior.message, counter: this.session(meta, clubId).counter, apCharged: 0 };
    const v = this.validate(meta, clubId, raw);
    if (v.errors.length) throw new GameError('TRADE_INVALID', v.errors.join(' '));
    const s = this.session(meta, clubId);
    if (s.proposalsLeft <= 0) throw new GameError('TRADE_LIMIT', `이번 주 이 구단과의 제안 ${T.proposalsPerSession}회를 모두 썼습니다. 다음 주에 다시 협상할 수 있습니다(행동력 1).`);
    const pkg = v.pkg;
    const last = s.talk.log.filter((l) => l.weekId === s.weekId && l.kind === 'proposal').at(-1);
    if (last && JSON.stringify(last.pkg) === JSON.stringify(pkg) && last.date === meta.currentDate) throw new GameError('DUPLICATE_OFFER', '같은 날 같은 교환안을 이미 제안했습니다.');
    const ev = this.evaluate(meta, clubId, pkg);
    return this.repo.transaction(() => {
      let ap = 0;
      const t = s.talk;
      if (!s.open) {
        try {
          this.repo.spendAp(s.weekId, T.sessionAp);
        } catch {
          throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다(트레이드 협상 시작 행동력 1).');
        }
        this.org.charge(meta, { kind: 'direct', weekId: s.weekId }, 'ops', TASK_WP.tradeRound);
        t.weeksPaid = [...t.weeksPaid, s.weekId];
        ap = T.sessionAp;
      }
      const club = this.repo.getClubs().find((c) => c.id === clubId)!;
      let res: TradeResponse;
      if (ev.decision.kind === 'accept') {
        const msg = this.execute(meta, clubId, pkg);
        res = { result: 'accept', message: `${club.shortName} 수락: ${msg}`, counter: null, apCharged: ap };
        t.counter = null;
      } else if (ev.decision.kind === 'counter' && this.counterFeasible(meta, clubId, pkg, ev.decision.cashNeeded)) {
        const counter = { ...pkg, cashWon: pkg.cashWon + ev.decision.cashNeeded };
        t.counter = { pkg: counter, weekId: s.weekId };
        const cashText = counter.cashWon > 0 ? `우리가 현금 ${won(counter.cashWon)}` : counter.cashWon < 0 ? `상대가 현금 ${won(-counter.cashWon)}` : '현금 없이';
        res = { result: 'counter', message: `${club.shortName} 역제안: 같은 선수 구성에 ${cashText}이면 받겠습니다. ${ev.reasons.join(' ')}`.trim(), counter, apCharged: ap };
      } else {
        t.counter = null;
        res = { result: 'reject', message: `${club.shortName} 거절: ${ev.L > ev.G ? '내주는 쪽 가치가 받는 쪽보다 큽니다.' : '이 조건으로는 거래할 이유가 부족합니다.'} ${ev.reasons.join(' ')}`.trim(), counter: null, apCharged: ap };
      }
      t.log = [...t.log, { date: meta.currentDate, weekId: s.weekId, kind: 'proposal', pkg, result: res.result, message: res.message }];
      this.saveTalk(t);
      this.appendLog({ commandId, command: 'trade.propose', target: `club:${clubId}`, date: meta.currentDate, ap, talkClubId: clubId, result: res.result, message: res.message });
      return res;
    });
  }

  private counterFeasible(meta: GameMeta, clubId: ClubId, pkg: TradePackage, extra: number): boolean {
    const cash = pkg.cashWon + extra;
    if (Math.abs(cash) > T.maxCashWon) return false;
    if (cash > 0 && this.repo.cashBalance(meta.userClubId) < cash) return false;
    return clubId > 0;
  }

  /** 역제안 수락: 같은 주 세션 안에서 추가 행동력 없음. 확정 때 다시 검증한다 */
  acceptCounter(meta: GameMeta, clubId: ClubId, commandId: string): TradeResponse {
    this.requireCommandId(commandId);
    const prior = this.logged(meta, commandId);
    if (prior) return { result: prior.result === 'error' ? 'reject' : prior.result, message: prior.message, counter: null, apCharged: 0 };
    const s = this.session(meta, clubId);
    if (!s.counter) throw new GameError('NOT_AVAILABLE', '이번 주에 받을 수 있는 역제안이 없습니다(역제안은 그 주 안에서만 유효).');
    const v = this.validate(meta, clubId, s.counter);
    if (v.errors.length) throw new GameError('TRADE_INVALID', v.errors.join(' '));
    // 역제안 뒤 상황이 바뀌었으면(부상·이적 등) 다시 평가한다
    const ev = this.evaluate(meta, clubId, v.pkg);
    if (ev.decision.kind !== 'accept') throw new GameError('TRADE_CHANGED', '상황이 바뀌어 상대가 역제안을 거둬들였습니다. 다시 제안하세요.');
    return this.repo.transaction(() => {
      const club = this.repo.getClubs().find((c) => c.id === clubId)!;
      const msg = this.execute(meta, clubId, v.pkg);
      const t = s.talk;
      t.counter = null;
      const res: TradeResponse = { result: 'accept', message: `${club.shortName} 역제안 수락으로 성사: ${msg}`, counter: null, apCharged: 0 };
      t.log = [...t.log, { date: meta.currentDate, weekId: s.weekId, kind: 'counterAccepted', pkg: v.pkg, result: 'accept', message: res.message }];
      this.saveTalk(t);
      this.appendLog({ commandId, command: 'trade.acceptCounter', target: `club:${clubId}`, date: meta.currentDate, ap: 0, talkClubId: clubId, result: 'accept', message: res.message });
      return res;
    });
  }

  // ───────── 실행 ─────────

  /** 양 구단 일괄 이적. 호출자가 트랜잭션을 연다. 우리 구단 기준 문장을 돌려준다 */
  execute(meta: GameMeta, clubId: ClubId, pkg: TradePackage): string {
    const players = this.repo.getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const userClub = meta.userClubId;
    const lostOurs = pkg.give.map((id) => byId.get(id)!).filter((p) => p.level === '1군');
    const lostTheirs = pkg.get.map((id) => byId.get(id)!).filter((p) => p.level === '1군');
    const moved: PlayerTruth[] = [];
    for (const id of pkg.give) {
      const p = byId.get(id)!;
      p.clubId = clubId;
      p.level = '2군';
      delete p.training;
      moved.push(p);
    }
    for (const id of pkg.get) {
      const p = byId.get(id)!;
      p.clubId = userClub;
      p.level = '2군';
      delete p.training;
      moved.push(p);
    }
    this.repo.savePlayers(moved);
    // 휴식 지시 정리(떠난 우리 선수)
    const orders = { ...(meta.restOrders ?? {}) };
    for (const id of pkg.give) delete orders[String(id)];
    const club = this.repo.getClubs().find((c) => c.id === clubId)!;
    const userShort = this.repo.getClubs().find((c) => c.id === userClub)!.shortName;
    const date = meta.currentDate;
    if (pkg.cashWon !== 0) {
      const memo = `트레이드 현금 ${userShort} → ${club.shortName}`;
      this.repo.addLedger([
        { clubId: userClub, date, category: 'tradeCash', amount: -pkg.cashWon, memo },
        { clubId, date, category: 'tradeCash', amount: pkg.cashWon, memo },
      ]);
    }
    const current = this.repo.getMeta();
    this.repo.updateMeta({
      restOrders: orders,
      tradeHistory: [...(current.tradeHistory ?? []), { date, season: meta.season, clubA: userClub, clubB: clubId, aToB: pkg.give, bToA: pkg.get, cashAtoB: pkg.cashWon }],
    });
    const fills = [...this.refill(this.repo.getMeta(), userClub, lostOurs), ...this.refill(this.repo.getMeta(), clubId, lostTheirs)];
    const names = (ids: number[]) => ids.map((id) => byId.get(id)!.name).join(', ') || '없음';
    const cash = pkg.cashWon > 0 ? ` · 현금 ${won(pkg.cashWon)} 지급` : pkg.cashWon < 0 ? ` · 현금 ${won(-pkg.cashWon)} 받음` : '';
    const text = `보냄 ${names(pkg.give)} / 받음 ${names(pkg.get)}${cash}`;
    const inbox: InboxMessage[] = [
      { date, kind: 'report', sender: '운영팀', title: `트레이드 성사: ${club.shortName}`, body: `${text}\n받은 선수는 2군으로 등록했습니다.${fills.length ? `\n1군 보충: ${fills.join(', ')}` : ''}\n선수단 운영에서 1·2군을 조정할 수 있습니다.` },
    ];
    this.repo.addInbox(inbox);
    return text;
  }

  /** 1군 26명 보충: 빠진 1군 선수와 같은 쪽 건강한 최고 선수(우리 구단은 재등록 제한·포수 최소 인원) */
  private refill(meta: GameMeta, clubId: ClubId, lost: PlayerTruth[]): string[] {
    const players = this.repo.getPlayers();
    const mine = players.filter((p) => p.clubId === clubId && !p.retired);
    const active = () => mine.filter((p) => p.level === '1군');
    const isUser = clubId === meta.userClubId;
    const date = meta.currentDate;
    const healthy = (p: PlayerTruth) => !(p.health?.injury && diffDays(date, p.health.injury.returnDate) < 0);
    const promote: PlayerTruth[] = [];
    const queue = [...lost];
    while (active().length + promote.length < LEAGUE.activeRoster) {
      const side = queue.shift();
      const cur = [...active(), ...promote];
      const needC = !isUser ? false : cur.filter((p) => !p.isPitcher && p.position === 'C').length < ROSTER_MOVE.activeMinCatchers;
      const pool = mine.filter((p) => p.level !== '1군' && !promote.includes(p) && healthy(p) && !(isUser && this.roster.reRegisterDate(meta, p.id)));
      const pick = (pred: (p: PlayerTruth) => boolean) => pool.filter(pred).sort((a, b) => overall(b) - overall(a) || a.id - b.id)[0];
      const c = rosterCounts(cur);
      const wantPitcher = c.pitchers < ROSTER_COMPOSITION.activeMinPitchers ? true : c.hitters < ROSTER_COMPOSITION.activeMinHitters ? false : side ? side.isPitcher : null;
      const chosen = (needC ? pick((p) => !p.isPitcher && p.position === 'C') : undefined) ?? (wantPitcher === null ? pick(() => true) : pick((p) => p.isPitcher === wantPitcher)) ?? pick(() => true);
      if (!chosen) break;
      promote.push(chosen);
    }
    if (promote.length === 0) return [];
    if (isUser) this.roster.forceMoves(meta, players, promote, []);
    else {
      for (const p of promote) p.level = '1군';
      this.repo.savePlayers(promote);
    }
    return isUser ? promote.map((p) => p.name) : [];
  }
}
