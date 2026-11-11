// 7a AI 구단 운영 상태·재정 긴축·AI 구단 간 트레이드(19·09 문서, D-155).
// 운영 상태는 매월 1일에만 바뀐다. AI 간 거래는 사용자 거래와 같은 평가 함수·수락 조건·선수단 검사를 쓰고
// 히든 값과 난수 흐름을 쓰지 않는다(같은 날 같은 상태면 같은 결과).
import { addDays, ageOn, diffDays, weekday, type GameDate } from '../engine/calendar';
import { assessStance, emergencySupport, STANCE_LABEL, type ClubStance } from '../engine/aiClub';
import { AI_CLUB as A, TRADE as T } from '../engine/config';
import type { LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import type { ClubId, ClubProfile, PlayerTruth } from '../engine/types';
import type { GameMeta, GameRepository, InboxMessage, StanceState, TradeOffer } from './ports';
import type { TradeOps } from './trade';
import { weekIdFor } from './week';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);

/** 거래 기록의 기간 구분: 스토브리그와 시즌을 따로 센다 */
export const tradePeriod = (meta: GameMeta): 'stove' | 'season' => (meta.mode === 'stove' ? 'stove' : 'season');

export class AiClubOps {
  private cache: Record<string, StanceState> | null = null;

  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly trades: TradeOps,
    /** 기준 순위(D-155 (1)): 팀당 30경기 이상이면 현재 순위, 아니면 직전 시즌 최종 순위 */
    private readonly ranks: () => Map<ClubId, number>,
  ) {}

  private all(): Record<string, StanceState> {
    return (this.cache ??= this.repo.getMetaValue<Record<string, StanceState>>('clubStance') ?? {});
  }

  /** AI 구단의 운영 상태. 우리 구단과 아직 평가하지 않은 구단은 null */
  stance(clubId: ClubId): ClubStance | null {
    return this.all()[String(clubId)]?.stance ?? null;
  }

  state(clubId: ClubId): StanceState | null {
    return this.all()[String(clubId)] ?? null;
  }

  /** 운영 상태가 없는 저장본·새 게임: 지금 기준으로 한 번 평가해 저장한다(긴급 지원 없음) */
  ensure(meta: GameMeta): void {
    this.cache = null;
    const cur = this.all();
    const ai = [...this.clubs.values()].filter((c) => c.id !== meta.userClubId);
    if (ai.every((c) => cur[String(c.id)])) return;
    const ranks = this.ranks();
    const next = { ...cur };
    for (const c of ai) {
      if (next[String(c.id)]) continue;
      next[String(c.id)] = { stance: assessStance(undefined, ranks.get(c.id) ?? 5, this.repo.cashBalance(c.id)), since: meta.currentDate, assessed: meta.currentDate };
    }
    this.repo.updateMeta({ clubStance: next });
    this.cache = null;
  }

  /** 매일: 매월 1일 운영 상태 재평가(긴축 진입·긴급 지원), 월요일 AI 구단 간 트레이드 */
  onDay(meta: GameMeta, date: GameDate): { ledger: LedgerEntry[]; inbox: InboxMessage[] } {
    this.cache = null;
    const ledger: LedgerEntry[] = [];
    const inbox: InboxMessage[] = [];
    if (date.slice(8, 10) === '01') this.reassess(meta, date, ledger, inbox);
    if (weekday(date) === 1) inbox.push(...this.weeklyTrade(this.repo.getMeta(), date));
    // 7b(D-157): 기한이 지난 받은 제안 정리, 월요일 AI 선제안
    this.expireOffers(date);
    if (weekday(date) === 1) inbox.push(...this.weeklyOffer(this.repo.getMeta(), date));
    return { ledger, inbox };
  }

  private reassess(meta: GameMeta, date: GameDate, ledger: LedgerEntry[], inbox: InboxMessage[]): void {
    const ranks = this.ranks();
    const cur = this.all();
    const next: Record<string, StanceState> = {};
    const log = [...(meta.stanceLog ?? [])];
    const deduction = { ...(meta.aiSupportDeduction ?? {}) };
    const key = String(meta.season + 1);
    for (const club of this.clubs.values()) {
      if (club.id === meta.userClubId) continue;
      const id = String(club.id);
      const prev = cur[id];
      const cash = this.repo.cashBalance(club.id);
      const stance = assessStance(prev?.stance, ranks.get(club.id) ?? 5, cash);
      next[id] = { stance, since: prev && prev.stance === stance ? prev.since : date, assessed: date };
      if (prev && prev.stance !== stance) log.push({ date, clubId: club.id, from: prev.stance, to: stance });
      // 긴축 구단의 현금이 0 미만이면 모기업 긴급 지원(다음 시즌 지원금에서 차감)
      const support = stance === 'austerity' ? emergencySupport(cash) : 0;
      if (support > 0) {
        ledger.push({ clubId: club.id, date, category: 'parentSupport', amount: support, memo: '모기업 긴급 지원(재정 긴축, 다음 시즌 지원금에서 차감)' });
        deduction[key] = { ...(deduction[key] ?? {}), [id]: (deduction[key]?.[id] ?? 0) + support };
      }
      if (stance === 'austerity' && prev?.stance !== 'austerity') {
        inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${club.shortName}, 재정 긴축 돌입`, body: `${club.name}이(가) 현금 부족으로 재정 긴축에 들어갔습니다. 모기업 긴급 지원 ${won(support)}을 받았고, 당분간 FA 영입·시설 투자·마케팅을 줄입니다.` });
      }
    }
    this.repo.updateMeta({ clubStance: next, stanceLog: log.slice(-A.stanceLogMax), aiSupportDeduction: deduction });
    this.cache = null;
  }

  // ───────── AI 선제안 트레이드(7b, D-157) ─────────

  private expireOffers(date: GameDate): void {
    // 매일 부르므로 메타 전체를 해석하지 않고 제안 항목만 읽는다
    const offers = this.repo.getMetaValue<TradeOffer[]>('tradeOffers') ?? [];
    if (!offers.some((o) => o.status === 'open' && diffDays(date, o.expires) > 0)) return;
    this.repo.updateMeta({ tradeOffers: offers.map((o) => (o.status === 'open' && diffDays(date, o.expires) > 0 ? { ...o, status: 'expired' as const } : o)) });
  }

  /**
   * 월요일: 우승 경쟁 구단은 우리 베테랑을 요구하고 자기 젊은 선수를 내놓는다. 리빌딩·긴축 구단은 그 반대.
   * 제안 구단이 자기 수락 조건을 통과하는 안 중 여유가 가장 작은 1건만 보낸다(양쪽 가치가 모두 0보다 큰 안만).
   */
  private weeklyOffer(meta: GameMeta, date: GameDate): InboxMessage[] {
    if (meta.gameOver || this.trades.windowReason(meta)) return [];
    const O = A.offer;
    const offers = meta.tradeOffers ?? [];
    const period = tradePeriod(meta);
    const weekId = weekIdFor(date);
    if (offers.some((o) => weekIdFor(o.date) === weekId)) return [];
    if (offers.filter((o) => o.status === 'open').length >= O.maxOpen) return [];
    if (offers.filter((o) => o.season === meta.season && o.period === period).length >= O.maxPerPeriod) return [];
    // D-159: 시즌 중에는 4~8월에만, 한 달에 1건
    if (period === 'season') {
      const month = Number(date.slice(5, 7));
      if (month < O.seasonFromMonth || month > O.seasonToMonth) return [];
      if (offers.filter((o) => o.period === 'season' && o.date.slice(0, 7) === date.slice(0, 7)).length >= O.seasonPerMonth) return [];
    }
    const user = meta.userClubId;
    const players = this.repo.getPlayers();
    const rosterOf = (id: ClubId) => players.filter((p) => p.clubId === id && !p.retired);
    const age = (p: PlayerTruth) => ageOn(p.birthDate, date);
    const veteran = (p: PlayerTruth) => age(p) >= A.trade.veteranMinAge;
    const prospect = (p: PlayerTruth) => age(p) <= A.trade.prospectMaxAge && p.origin === 'domestic';
    const ours = rosterOf(user);
    let best: { clubId: ClubId; give: number; get: number; surplus: number } | null = null;
    for (const club of [...this.clubs.values()].sort((a, b) => a.id - b.id)) {
      if (club.id === user) continue;
      const stance = this.stance(club.id);
      if (stance !== 'contend' && stance !== 'rebuild' && stance !== 'austerity') continue;
      if (offers.some((o) => o.clubId === club.id && diffDays(date, o.date) < O.clubGapDays)) continue;
      const buying = stance === 'contend';
      const pick = (list: PlayerTruth[], owner: ClubId, n: number) =>
        list
          .map((p) => ({ p, r: this.trades.rating(meta, club.id, p) }))
          .sort((x, y) => y.r - x.r || x.p.id - y.p.id)
          .map((x) => x.p)
          .reduce<PlayerTruth[]>((acc, p) => (acc.length < n && this.trades.tradableReason(meta, p, owner) === null ? [...acc, p] : acc), []);
      const theirs = rosterOf(club.id);
      const wanted = pick(ours.filter(buying ? veteran : prospect), user, buying ? A.trade.veteranCandidates : A.trade.prospectCandidates);
      const offered = pick(theirs.filter(buying ? prospect : veteran), club.id, buying ? A.trade.prospectCandidates : A.trade.veteranCandidates);
      for (const w of wanted) {
        for (const g of offered) {
          if (this.trades.swapErrors(players, user, club.id, [w.id], [g.id]).length) continue;
          const ev = this.trades.evaluate(meta, club.id, { give: [w.id], get: [g.id], cashWon: 0 }, players);
          if (ev.decision.kind !== 'accept' || ev.G <= 0 || ev.L <= 0) continue;
          const surplus = ev.G - ev.decision.required;
          if (!best || surplus < best.surplus) best = { clubId: club.id, give: w.id, get: g.id, surplus };
        }
      }
    }
    if (!best) return [];
    const byId = new Map(players.map((p) => [p.id, p]));
    const club = this.clubs.get(best.clubId)!;
    const give = byId.get(best.give)!;
    const get = byId.get(best.get)!;
    const expires = addDays(date, O.validDays - 1);
    const id = offers.reduce((a, o) => Math.max(a, o.id), 0) + 1;
    this.repo.updateMeta({
      tradeOffers: [
        ...offers,
        { id, clubId: club.id, date, expires, season: meta.season, period, pkg: { give: [give.id], get: [get.id], cashWon: 0 }, status: 'open', audit: { give: this.trades.truthValue(meta, give), get: this.trades.truthValue(meta, get) } },
      ],
    });
    const label = (p: PlayerTruth) => `${p.name}(${p.isPitcher ? '투수' : p.position}, ${age(p)}세)`;
    return [
      {
        date,
        kind: 'task',
        sender: club.shortName,
        title: `트레이드 제안: ${club.shortName}`,
        body: `${club.name}(${STANCE_LABEL[this.stance(club.id)!]})이(가) 트레이드를 제안했습니다.\n우리가 보냄: ${label(give)}\n우리가 받음: ${label(get)}\n${expires.slice(5).replace('-', '/')}까지 [계약·이적] 화면에서 수락하거나 거절할 수 있습니다. 수락은 그 주 협상 비용(행동력 1, 이미 협상 중이면 무료), 거절은 무료입니다.`,
      },
    ];
  }

  // ───────── AI 구단 간 트레이드 ─────────

  private dealCount(meta: GameMeta, clubId: ClubId): number {
    const period = tradePeriod(meta);
    return (meta.tradeHistory ?? []).filter((h) => h.ai && h.season === meta.season && h.period === period && (h.clubA === clubId || h.clubB === clubId)).length;
  }

  /** 월요일: 구매 구단(우승 경쟁) × 판매 구단(리빌딩·긴축) 1:1 교환안 중 양쪽이 수락하는 최선 1건 */
  private weeklyTrade(meta: GameMeta, date: GameDate): InboxMessage[] {
    if (this.trades.windowReason(meta)) return [];
    const weekId = weekIdFor(date);
    if ((meta.tradeHistory ?? []).some((h) => h.ai && weekIdFor(h.date) === weekId)) return [];
    const ai = [...this.clubs.values()].filter((c) => c.id !== meta.userClubId && this.dealCount(meta, c.id) < A.trade.maxPerClubPeriod).sort((a, b) => a.id - b.id);
    const buyers = ai.filter((c) => this.stance(c.id) === 'contend');
    const sellers = ai.filter((c) => this.stance(c.id) === 'rebuild' || this.stance(c.id) === 'austerity');
    if (buyers.length === 0 || sellers.length === 0) return [];
    const players = this.repo.getPlayers();
    const rosterOf = (id: ClubId) => players.filter((p) => p.clubId === id && !p.retired);
    const age = (p: PlayerTruth) => ageOn(p.birthDate, date);
    const tradable = (p: PlayerTruth, clubId: ClubId) => this.trades.tradableReason(meta, p, clubId) === null;
    let best: { buyer: ClubId; seller: ClubId; veteran: number; prospect: number; cash: number; score: number } | null = null;
    for (const b of buyers) {
      const prospects = rosterOf(b.id).filter((p) => age(p) <= A.trade.prospectMaxAge && p.origin === 'domestic');
      for (const s of sellers) {
        // 후보 좁히기: 판매 구단은 구매 구단이 보는 능력이 높은 베테랑, 구매 구단은 판매 구단이 보는 능력이 높은 젊은 선수
        const veterans = rosterOf(s.id)
          .filter((p) => age(p) >= A.trade.veteranMinAge)
          .map((p) => ({ p, r: this.trades.rating(meta, b.id, p) }))
          .sort((x, y) => y.r - x.r || x.p.id - y.p.id)
          .reduce<Array<{ p: PlayerTruth; r: number }>>((acc, x) => (acc.length < A.trade.veteranCandidates && tradable(x.p, s.id) ? [...acc, x] : acc), []);
        const young = prospects
          .map((p) => ({ p, r: this.trades.rating(meta, s.id, p) }))
          .sort((x, y) => y.r - x.r || x.p.id - y.p.id)
          .reduce<Array<{ p: PlayerTruth; r: number }>>((acc, x) => (acc.length < A.trade.prospectCandidates && tradable(x.p, b.id) ? [...acc, x] : acc), []);
        for (const v of veterans) {
          for (const y of young) {
            if (this.trades.swapErrors(players, b.id, s.id, [y.p.id], [v.p.id]).length) continue;
            const tryCash = (cash: number) => {
              // 구매 구단: 베테랑을 받고 젊은 선수(와 현금)를 준다. 판매 구단은 그 반대
              const eb = this.trades.evaluate(meta, b.id, { give: [v.p.id], get: [y.p.id], cashWon: -cash }, players);
              const es = this.trades.evaluate(meta, s.id, { give: [y.p.id], get: [v.p.id], cashWon: cash }, players);
              return { eb, es };
            };
            let cash = 0;
            let { eb, es } = tryCash(0);
            if (eb.decision.kind === 'accept' && es.decision.kind === 'counter') {
              cash = es.decision.cashNeeded;
              if (cash > T.maxCashWon || this.repo.cashBalance(b.id) - T.aiCashReserveWon < cash) continue;
              ({ eb, es } = tryCash(cash));
            }
            if (eb.decision.kind !== 'accept' || es.decision.kind !== 'accept') continue;
            const score = eb.G - eb.decision.required + (es.G - es.decision.required);
            if (!best || score > best.score) best = { buyer: b.id, seller: s.id, veteran: v.p.id, prospect: y.p.id, cash, score };
          }
        }
      }
    }
    if (!best) return [];
    const buyer = this.clubs.get(best.buyer)!;
    const seller = this.clubs.get(best.seller)!;
    const byId = new Map(players.map((p) => [p.id, p]));
    const label = (id: number) => {
      const p = byId.get(id)!;
      return `${p.name}(${p.isPitcher ? '투수' : p.position}, ${age(p)}세)`;
    };
    const text = `${buyer.shortName} → ${seller.shortName}: ${label(best.prospect)}${best.cash > 0 ? ` + 현금 ${won(best.cash)}` : ''}\n${seller.shortName} → ${buyer.shortName}: ${label(best.veteran)}`;
    this.trades.executeBetween(meta, best.buyer, best.seller, [best.prospect], [best.veteran], best.cash, true);
    return [{ date, kind: 'news', sender: 'KBO 소식', title: `트레이드: ${buyer.shortName} ↔ ${seller.shortName}`, body: `${text}\n${buyer.shortName}은(는) ${STANCE_LABEL[this.stance(best.buyer)!]}, ${seller.shortName}은(는) ${STANCE_LABEL[this.stance(best.seller)!]} 기조입니다.` }];
  }
}
