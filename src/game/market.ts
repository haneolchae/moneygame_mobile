// 선수 시장: FA·연봉 협상·외국인 계약·방출 (08·09·22 문서, D-031·D-042·D-045·D-046·D-048·D-075).
// 날짜 처리(onDay)는 하루 처리 트랜잭션 안에서 호출되고, 사용자 명령은 각각 하나의 트랜잭션으로 반영된다.
import { addDays, diffDays, weekday, type GameDate } from '../engine/calendar';
import type { ClubStance } from '../engine/aiClub';
import { SEASON_2026_STANDINGS } from '../engine/clubs';
import { ALLSTAR, CONTRACT, FOREIGN, LEAGUE, usdToWon, WORLDGEN, wonToUsd } from '../engine/config';
import {
  acceptThreshold,
  aiOffer,
  assignGrades,
  clubEstimate,
  compensationFor,
  faDemand,
  publicOverall,
  foreignRenewalDemandUsd,
  offerScore,
  offerTotal,
  respondToOffer,
  salaryAccepts,
  salaryCap,
  bonusCapOf,
  capPayroll,
  salaryDemand,
  FA_RULES,
  validateForeign,
  type ContractOffer,
  type OfferContext,
} from '../engine/contracts';
import type { LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { TASK_WP, type TeamKey } from '../engine/staff';
import { inGroup, needFirst, neededGroup, pickRemovals } from '../engine/roster';
import { stoveEvents } from '../engine/stove';
import type { ClubId, ClubProfile, PlayerTruth } from '../engine/types';
import { Rng } from '../engine/rng';
import { assignActiveRoster, domesticSalary, FA_SERVICE_YEARS_REQUIRED, generateDomesticFreePool, overall } from '../engine/worldgen';
import { dealWindowReason } from './trade';
import { apPeriodId, weekIdFor } from './week';
import { GameError } from '../shared/protocol';
import type { FaEntry, GameMeta, GameRepository, InboxMessage, OfferRow, SalaryTalk } from './ports';
import { NO_GUARD, type BudgetGuard } from './budget';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);
const describe = (o: ContractOffer) => `${o.years}년 총액 ${won(offerTotal(o))} (계약금 ${won(o.bonus)}, 연봉 ${won(o.salary)})`;
const round1m = (n: number) => Math.max(0, Math.round(n / 1_000_000) * 1_000_000);

export interface MarketDayOutput {
  inbox: InboxMessage[];
  ledger: LedgerEntry[];
}

export interface StoveDates {
  faNotice: GameDate;
  faMarketOpen: GameDate;
  reserveList: GameDate;
  salaryTalksOpen: GameDate;
  arbitration: GameDate;
  campRoster: GameDate;
}

export function stoveDates(kDate: GameDate): StoveDates {
  const ev = Object.fromEntries(stoveEvents(kDate).map((e) => [e.kind, e.date])) as Record<string, GameDate>;
  return {
    faNotice: ev.faNotice!,
    faMarketOpen: ev.faMarketOpen!,
    reserveList: ev.reserveList!,
    salaryTalksOpen: ev.salaryTalks!,
    arbitration: ev.arbitrationDeadline!,
    campRoster: ev.campRoster!,
  };
}

/** 명령 출처. 직접 행동과 위임 실행은 같은 도메인 로직을 쓰고 비용 출처만 다르다(claude.md 공통 구현 계약). */
export type ActionSource = { kind: 'direct'; weekId: string } | { kind: 'delegated' };

/** 6e: 연봉 한도 검사 결과를 비용 없이 거부로 바꾼다 */
const payrollGuard = (msg: string | null) => {
  if (msg) throw new GameError('BUDGET_OVER', msg);
};

/** 팀 처리량 차감. 직접 행동은 50%(초과 허용), 위임은 준비 단계에서 이미 100%를 차감한다. */
export type WpCharge = (source: ActionSource, team: TeamKey, fullCost: number) => void;

export class Market {
  /** 6e(D-177): 우리 구단 연봉 총액 한도. 서비스가 연결한다 */
  budget: BudgetGuard = NO_GUARD;
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly chargeWp: WpCharge = () => {},
    /** 7a(D-155): AI 구단 운영 상태(매월 1일 평가) */
    private readonly stanceOf: (clubId: ClubId) => ClubStance | null = () => null,
  ) {}

  private offseason(meta: GameMeta) {
    return Number(meta.kDate.slice(0, 4));
  }

  /** 계약이 적용되는 다음 시즌 연도 */
  private contractYear(meta: GameMeta) {
    return meta.mode === 'stove' ? meta.season + 1 : meta.season;
  }

  private rank(clubId: ClubId) {
    // 가장 최근 시즌 최종 순위(첫 스토브리그는 실제 2026 순위)
    const season = this.repo.getMeta().season;
    const stored = this.repo.getSeasonStandings(season).find((s) => s.clubId === clubId) ?? SEASON_2026_STANDINGS.find((s) => s.clubId === clubId);
    return stored?.rank ?? 5;
  }

  // D-155 (3): FA 입찰 성향은 운영 상태로 정한다(계수는 그대로)
  private contender(club: ClubProfile) {
    return this.stanceOf(club.id) === 'contend';
  }

  private rebuilding(club: ClubProfile) {
    const s = this.stanceOf(club.id);
    return s === 'rebuild' || s === 'austerity';
  }

  weeksSinceOpen(meta: GameMeta, date: GameDate = meta.currentDate): number {
    const open = stoveDates(meta.kDate).faMarketOpen;
    return Math.max(0, Math.floor(diffDays(date, open) / 7));
  }

  marketOpen(meta: GameMeta, date: GameDate = meta.currentDate): boolean {
    return diffDays(date, stoveDates(meta.kDate).faMarketOpen) >= 0;
  }

  private players(): PlayerTruth[] {
    return this.repo.getPlayers();
  }

  private club(id: ClubId): ClubProfile {
    const c = this.clubs.get(id);
    if (!c) throw new Error(`구단 없음: ${id}`);
    return c;
  }

  // ───────── 날짜 처리 ─────────

  onDay(date: GameDate, meta: GameMeta): MarketDayOutput {
    const out: MarketDayOutput = { inbox: [], ledger: [] };
    if (meta.mode !== 'stove') {
      this.firstAgendaDeadline(meta, date, out);
      return out;
    }
    const d = stoveDates(meta.kDate);
    // D-225 (5): 공시·신청 → 시장 개장 2단계. 공시일에 명단·신청 여부·보상 등급이 함께 정해진다.
    if (date === d.faNotice) {
      this.createFaList(meta);
      this.decideApplications(meta, date, out);
      this.approveFa(meta, date, out);
    }
    if (this.marketOpen(meta, date)) {
      if (weekday(date) === 1) this.aiFaOffers(meta, date);
      if (weekday(date) === 0) this.resolveFaWeek(meta, date, out);
    }
    if (date === d.reserveList) this.aiPruneRosters(meta, date, out);
    if (date === d.salaryTalksOpen) this.openSalaryTalks(meta, date, out);
    if (diffDays(date, d.salaryTalksOpen) >= 0 && date.slice(5, 7) === '12' && weekday(date) === 1) this.aiForeignMoves(meta, date, out);
    if (date === d.arbitration) this.arbitrate(meta, date, out);
    if (date === d.campRoster) this.campDefaults(meta, date, out);
    return out;
  }

  private createFaList(meta: GameMeta): void {
    const off = this.offseason(meta);
    const year = this.contractYear(meta);
    const entries: FaEntry[] = this.players()
      // 은퇴했거나 은퇴를 고민 중인(설득 기한 안) 선수는 FA로 공시하지 않는다. 설득되면 원소속 구단과 연봉 협상으로 남는다.
      .filter((p) => p.clubId !== null && p.career.faEligible && !p.retired && !(meta.retirementPending ?? []).some((x) => x.playerId === p.id))
      .map((p) => ({ playerId: p.id, offseason: off, originClub: p.clubId!, status: 'eligible', grade: null, priorSalary: p.salary, demand: faDemand(meta.seed, p, year), signedClub: null, signedDate: null, contract: null }));
    this.repo.saveFa(entries);
  }

  private decideApplications(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const fa = this.repo.getFa(this.offseason(meta));
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const declined: string[] = [];
    for (const e of fa) {
      if (e.status !== 'eligible') continue;
      const p = byId.get(e.playerId)!;
      // 신청 여부: 시장 가치가 높을수록, 나이가 적을수록 신청한다. 간판 선수는 반드시 신청한다(첫 안건).
      const age = this.contractYear(meta) - Number(p.birthDate.slice(0, 4));
      const will = p.career.franchise || overall(p) - (age >= 34 ? 6 : 0) >= 44;
      e.status = will ? 'applied' : 'declined';
      if (!will) declined.push(`${p.name}(${this.club(e.originClub).shortName})`);
    }
    this.repo.saveFa(fa);
    out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: 'FA 신청 결과', body: `신청 ${fa.filter((e) => e.status === 'applied').length}명, 미신청 ${declined.length}명.${declined.length ? `\n미신청(원소속 구단과 연봉 협상): ${declined.join(', ')}` : ''}` });
  }

  private approveFa(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const fa = this.repo.getFa(this.offseason(meta));
    const applied = fa.filter((e) => e.status === 'applied');
    const grades = assignGrades(applied.map((e) => ({ id: e.playerId, salary: e.priorSalary })));
    for (const e of applied) {
      e.status = 'approved';
      e.grade = grades.get(e.playerId) ?? 'C';
    }
    this.repo.saveFa(fa);
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const lines = applied.map((e) => `· ${byId.get(e.playerId)?.name} (${this.club(e.originClub).shortName}, ${e.grade}등급, 직전 연봉 ${won(e.priorSalary)})`);
    out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `FA 신청 선수 ${applied.length}명`, body: `${stoveDates(meta.kDate).faMarketOpen.slice(5).replace('-', '/')} 시장이 열리면 모든 구단과 교섭할 수 있습니다. 원소속 구단이 아닌 구단이 영입하면 등급별 보상금(A 300%, B 200%, C 150%)을 원소속 구단에 냅니다.\n${lines.join('\n')}` });
  }

  private offerContext(meta: GameMeta, p: PlayerTruth, e: FaEntry, clubId: ClubId): OfferContext {
    return { seed: meta.seed, player: p, demand: e.demand, club: this.club(clubId), isFormerClub: e.originClub === clubId };
  }

  private aiFaOffers(meta: GameMeta, date: GameDate): void {
    const off = this.offseason(meta);
    const year = this.contractYear(meta);
    const retired = new Set(this.players().filter((p) => p.retired).map((p) => p.id));
    const fa = this.repo.getFa(off).filter((e) => e.status === 'approved' && !retired.has(e.playerId));
    if (fa.length === 0) return;
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const pending = this.repo.getOffers({ status: 'pending', kind: 'fa' });
    for (const club of this.clubs.values()) {
      if (club.id === meta.userClubId) continue;
      const mine = pending.filter((o) => o.clubId === club.id);
      if (mine.length >= 3) continue;
      let cash = this.repo.cashBalance(club.id) - mine.reduce((a, o) => a + o.offer.bonus, 0);
      const candidates = fa
        .map((e) => ({ e, p: byId.get(e.playerId)!, est: clubEstimate(meta.seed, club.id, byId.get(e.playerId)!) }))
        // D-155 (2): 재정 긴축 구단은 자기 FA 재계약만 한다
        .filter(({ e }) => this.stanceOf(club.id) !== 'austerity' || e.originClub === club.id)
        // D-215 시작 예외: 첫 스토브리그 자동 실행·첫 안건 마감 전에는 간판 외야수를 AI 입찰에서 뺀다
        .filter(({ e }) => !this.startException(meta, e.playerId))
        .filter(({ e, est }) => !mine.some((o) => o.playerId === e.playerId) && (est >= 54 || (e.originClub === club.id && est >= 48)))
        .sort((a, b) => b.est - a.est || a.e.playerId - b.e.playerId);
      const roster = this.players().filter((p) => p.clubId === club.id);
      let made = 0;
      for (const { e, p } of needFirst(roster, candidates, (x) => x.p)) {
        if (made >= FA_RULES.aiMaxOffersPerWeek || mine.length + made >= 3) break;
        const offer = aiOffer(meta.seed, club, p, e.demand, year, this.contender(club), this.rebuilding(club));
        const comp = e.originClub === club.id ? 0 : compensationFor(e.grade ?? 'C', e.priorSalary);
        if (cash - offer.bonus - comp < FA_RULES.aiCashReserve) continue;
        this.repo.insertOffer({ playerId: p.id, clubId: club.id, kind: 'fa', date, offer, status: 'pending', response: '' });
        cash -= offer.bonus + comp;
        made++;
      }
    }
  }

  /** D-215 시작 예외(첫 안건 간판 외야수): 자동 실행 중이거나 첫 안건 마감 전 */
  startException(meta: GameMeta, playerId: number): boolean {
    return meta.autoRun?.franchiseId === playerId || (meta.firstAgenda?.playerId === playerId && meta.firstAgenda.status === 'open');
  }

  /**
   * D-219 ① 경쟁 구단의 최종 제안: 이날(일요일 결정일) 우리 FA가 다른 구단 제안을 받아들일 상황이면 알린다.
   * resolveFaWeek와 같은 계산으로 조회만 하고 상태를 바꾸지 않는다.
   */
  rivalThreats(meta: GameMeta, date: GameDate): Array<{ playerId: number; name: string; club: string }> {
    if (meta.mode !== 'stove' || weekday(date) !== 0 || !this.marketOpen(meta, date)) return [];
    const year = this.contractYear(meta);
    const weeks = this.weeksSinceOpen(meta, date);
    const out: Array<{ playerId: number; name: string; club: string }> = [];
    for (const e of this.repo.getFa(this.offseason(meta))) {
      if (e.status !== 'approved' || e.originClub !== meta.userClubId) continue;
      const offers = this.repo.getOffers({ playerId: e.playerId, status: 'pending', kind: 'fa' });
      if (!offers.some((o) => o.clubId !== meta.userClubId)) continue;
      const p = this.repo.getPlayer(e.playerId);
      if (!p || p.retired) continue;
      const best = offers.map((o) => ({ o, s: offerScore(o.offer, this.offerContext(meta, p, e, o.clubId), year) })).sort((a, b) => b.s - a.s || a.o.id - b.o.id)[0]!;
      if (best.o.clubId !== meta.userClubId && best.s >= acceptThreshold(meta.seed, p, weeks)) out.push({ playerId: p.id, name: p.name, club: this.club(best.o.clubId).shortName });
    }
    return out;
  }

  /**
   * D-215 첫 안건: 간판 외야수 잔류 협상 마감(2월 2주 일요일) 다음 날, 미계약이면 시장에 다시 연다.
   * AI 구단이 같은 규칙으로 한 번 제안하고 선수가 가장 좋은 제안을 고른다. 아무도 제안하지 않으면 국내 무소속 선수가 된다.
   */
  private firstAgendaDeadline(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const a = meta.firstAgenda;
    if (!a || a.status !== 'open' || diffDays(date, a.deadline) <= 0) return;
    const e = this.repo.getFa(this.offseason(meta)).find((x) => x.playerId === a.playerId);
    const p = this.repo.getPlayer(a.playerId);
    if (!e || !p || e.status !== 'approved') {
      this.repo.updateMeta({ firstAgenda: { ...a, status: e?.signedClub === meta.userClubId ? 'signed' : 'gone' } });
      return;
    }
    this.repo.updateMeta({ firstAgenda: { ...a, status: 'reopened' } });
    const now = this.repo.getMeta();
    this.aiFaOffers(now, date);
    // 시즌 중이라 40인이 찬 구단의 제안은 받지 않는다(보유 한도 D-016)
    const room = (id: ClubId) => this.players().filter((x) => x.clubId === id).length < LEAGUE.rosterMax;
    const offers = this.repo.getOffers({ playerId: p.id, status: 'pending', kind: 'fa' }).filter((o) => o.clubId !== meta.userClubId && room(o.clubId));
    const year = this.contractYear(meta);
    const best = offers.map((o) => ({ o, s: offerScore(o.offer, this.offerContext(now, p, e, o.clubId), year) })).sort((x, y) => y.s - x.s || x.o.id - y.o.id)[0];
    if (best) {
      this.signFa(now, date, e, p, best.o.clubId, best.o.offer, out);
      this.repo.updateOffer(best.o.id, { status: 'accepted', response: '계약 합의' });
      for (const o of offers.filter((x) => x !== best.o)) this.repo.updateOffer(o.id, { status: 'rejected', response: '다른 구단과 계약' });
    } else {
      e.status = 'unsigned';
      this.repo.saveFa([e]);
      p.clubId = null;
      p.contractYears = 0;
      p.career.franchise = false;
      this.repo.savePlayers([p]);
      out.inbox.push({ date, kind: 'report', sender: '단장', title: `${p.name} 선수가 무소속이 됐습니다`, body: '잔류 협상 마감까지 계약하지 못했고 다른 구단의 제안도 없었습니다. 국내 무소속 선수로 남아 1년 계약으로 다시 영입할 수 있습니다.' });
    }
    // 시즌 중에는 FA 시장이 없으므로 이 선수 외의 AI 제안은 거둔다
    for (const o of this.repo.getOffers({ status: 'pending', kind: 'fa' }).filter((x) => x.playerId !== p.id)) this.repo.updateOffer(o.id, { status: 'withdrawn', response: '시즌 중 시장 없음' });
  }

  /** 일요일: FA 선수가 받은 제안 중 가장 매력적인 제안이 기준을 넘으면 계약한다. */
  private resolveFaWeek(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const off = this.offseason(meta);
    const year = this.contractYear(meta);
    const fa = this.repo.getFa(off);
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const weeks = this.weeksSinceOpen(meta, date);
    for (const e of fa) {
      if (e.status !== 'approved') continue;
      const offers = this.repo.getOffers({ playerId: e.playerId, status: 'pending', kind: 'fa' });
      if (offers.length === 0) continue;
      const p = byId.get(e.playerId)!;
      const scored = offers.map((o) => ({ o, s: offerScore(o.offer, this.offerContext(meta, p, e, o.clubId), year) })).sort((a, b) => b.s - a.s || a.o.id - b.o.id);
      const best = scored[0]!;
      if (best.s >= acceptThreshold(meta.seed, p, weeks)) {
        this.signFa(meta, date, e, p, best.o.clubId, best.o.offer, out);
        this.repo.updateOffer(best.o.id, { status: 'accepted', response: '계약 합의' });
        for (const { o } of scored.slice(1)) this.repo.updateOffer(o.id, { status: 'rejected', response: '다른 구단과 계약' });
      }
    }
  }

  private signFa(meta: GameMeta, date: GameDate, e: FaEntry, p: PlayerTruth, clubId: ClubId, offer: ContractOffer, out: MarketDayOutput): void {
    const origin = this.club(e.originClub);
    const dest = this.club(clubId);
    const moved = e.originClub !== clubId;
    p.clubId = clubId;
    p.salary = offer.salary;
    p.contractYears = offer.years;
    p.bonusCap = bonusCapOf(offer.bonus, offer.years, clubId, this.contractYear(meta));
    p.career.faEligible = false;
    p.career.lastFaSeason = this.contractYear(meta);
    if (moved) p.career.franchise = false;
    p.level = '2군';
    this.repo.savePlayers([p]);
    e.status = 'signed';
    e.signedClub = clubId;
    e.signedDate = date;
    e.contract = offer;
    this.repo.saveFa([e]);
    out.ledger.push({ clubId, date, category: 'signingBonus', amount: -offer.bonus, memo: `${p.name} FA 계약금` });
    let compText = '';
    if (moved) {
      const comp = compensationFor(e.grade ?? 'C', e.priorSalary);
      out.ledger.push({ clubId, date, category: 'faCompensation', amount: -comp, memo: `${p.name} FA 보상금 → ${origin.shortName}` });
      out.ledger.push({ clubId: origin.id, date, category: 'faCompensation', amount: comp, memo: `${p.name} FA 보상금 ← ${dest.shortName}` });
      compText = ` 원소속 ${origin.shortName}에 보상금 ${won(comp)}.`;
    }
    out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `FA ${p.name}, ${dest.shortName}와 계약`, body: `${p.name}(${e.grade}등급)이 ${dest.name}와 ${describe(offer)}에 계약했습니다.${moved ? '' : ' 원소속 구단 잔류입니다.'}${compText}` });
    if (e.originClub === meta.userClubId && moved) {
      out.inbox.push({ date, kind: 'report', sender: '단장', title: `${p.name} 선수가 떠났습니다`, body: `${p.name} 선수가 ${dest.name}와 계약했습니다. 보상금 ${won(compensationFor(e.grade ?? 'C', e.priorSalary))}을 받습니다.${p.career.franchise || e.priorSalary > 0 ? '' : ''}` });
    }
  }

  private release(meta: GameMeta, date: GameDate, p: PlayerTruth, reason: string): string {
    const clubId = p.clubId!;
    const year = this.contractYear(meta);
    let text = '';
    if (p.contractYears > 0) {
      const seasons = Array.from({ length: p.contractYears }, (_, i) => year + i);
      this.repo.addObligation({ clubId, playerId: p.id, salary: p.salary, seasons, memo: `${p.name} 방출 잔여 연봉` });
      text = ` 남은 계약 ${p.contractYears}년치 연봉(연 ${won(p.salary)})은 원래 일정대로 계속 지급합니다.`;
    }
    p.clubId = null;
    p.level = '2군';
    p.contractYears = 0;
    p.career.franchise = false;
    this.repo.savePlayers([p]);
    return `${p.name} ${reason}.${text}`;
  }

  /**
   * 40인 초과 정리안(D-095): 계약이 끝난 선수 먼저, 그다음 구단 자체 평가가 낮은 국내 선수 순으로 초과 인원만큼 고른다.
   * AI 구단 명단 정리와 우리 운영팀 제안안이 같은 규칙을 쓴다. FA 시장에 나간 선수는 방출할 수 없어 뺀다.
   * 포지션 최소 인원(D-098) 아래로 내려가는 방출은 건너뛴다.
   */
  trimPlan(meta: GameMeta, clubId: ClubId): PlayerTruth[] {
    const roster = this.players().filter((p) => p.clubId === clubId);
    const excess = roster.length - LEAGUE.rosterMax;
    if (excess <= 0) return [];
    const onMarket = new Set(this.repo.getFa(this.offseason(meta)).filter((e) => e.status === 'applied' || e.status === 'approved').map((e) => e.playerId));
    const ordered = roster
      .filter((p) => p.origin === 'domestic' && !onMarket.has(p.id))
      .sort((a, b) => (a.contractYears === 0 ? 0 : 1) - (b.contractYears === 0 ? 0 : 1) || clubEstimate(meta.seed, clubId, a) - clubEstimate(meta.seed, clubId, b) || a.id - b.id);
    return pickRemovals(roster, ordered, excess);
  }

  /**
   * 포지션 최소 인원 보충(D-098): 모자란 쪽(포수 → 부족이 큰 쪽)을 소속 없는 국내 선수 중 구단 평가가 높은 순으로 최저 연봉 1년 계약한다.
   * 40명을 넘기면 이어지는 명단 정리(trimPlan)가 남는 쪽에서 정리한다. AI 구단과 우리 운영팀(완전 위임)이 같이 쓴다.
   */
  fillRosterNeeds(meta: GameMeta, clubId: ClubId): string[] {
    const notes: string[] = [];
    const free = this.players().filter((p) => p.clubId === null && p.origin === 'domestic' && !p.retired);
    for (let guard = 0; guard < LEAGUE.rosterMax; guard++) {
      const roster = this.players().filter((p) => p.clubId === clubId);
      const g = neededGroup(roster);
      if (!g) break;
      const pick = free
        .filter((p) => p.clubId === null && inGroup(p, g))
        .sort((a, b) => clubEstimate(meta.seed, clubId, b) - clubEstimate(meta.seed, clubId, a) || a.id - b.id)[0];
      if (!pick) {
        // 시장에 없으면 독립리그·재야 선수 한 명을 바로 데려온다(D-111). 같은 생성 규칙·능력 보정, 저장 시드에서 파생.
        const id = Math.max(0, ...this.players().map((p) => p.id)) + 1;
        const counts = { pitchers: g === 'P' ? 1 : 0, catchers: g === 'C' ? 1 : 0, otherHitters: g === 'H' ? 1 : 0 };
        const [walkOn] = generateDomesticFreePool(Rng.derive(meta.seed, 'walk-on', meta.season, clubId, guard), meta.season, id, counts);
        if (!walkOn) break;
        walkOn.clubId = clubId;
        walkOn.contractYears = 1;
        this.repo.savePlayers([walkOn]);
        notes.push(`${this.club(clubId).shortName}: ${walkOn.name}(${walkOn.position}) 독립리그에서 영입 — 시장에 ${g === 'P' ? '투수' : g === 'C' ? '포수' : '야수'}가 없어 포지션 최소 인원 보충`);
        continue;
      }
      pick.clubId = clubId;
      pick.level = '2군';
      pick.salary = WORLDGEN.minSalary;
      pick.contractYears = 1;
      this.repo.savePlayers([pick]);
      notes.push(`${this.club(clubId).shortName}: ${pick.name}(${pick.position}) 영입 — 포지션 최소 인원 보충`);
    }
    return notes;
  }

  /** 명단 정리 방출(D-095): 정리안의 선수를 방출하고 진행 중인 연봉 협상을 닫는다. 결과 문장 목록을 돌려준다. */
  releaseForRoster(meta: GameMeta, date: GameDate, clubId: ClubId, playerIds: number[]): string[] {
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const notes: string[] = [];
    for (const id of playerIds) {
      const p = byId.get(id);
      if (!p || p.clubId !== clubId) continue;
      notes.push(this.release(meta, date, p, '방출'));
      const talks = this.repo.getSalaryTalks(this.offseason(meta)).filter((t) => t.playerId === id && t.status === 'open');
      for (const t of talks) t.status = 'agreed';
      if (talks.length) this.repo.saveSalaryTalks(talks);
    }
    return notes;
  }

  /** AI 구단 명단 정리. 우리 구단은 운영팀 의무 안건으로 따로 처리한다(D-095, Organization). */
  private aiPruneRosters(meta: GameMeta, date: GameDate, out: MarketDayOutput, title = '보류선수 명단 확정'): void {
    const notes: string[] = [];
    for (const club of this.clubs.values()) {
      if (club.id === meta.userClubId) continue;
      const plan = this.trimPlan(meta, club.id);
      for (const line of this.releaseForRoster(meta, date, club.id, plan.map((p) => p.id))) notes.push(`${club.shortName}: ${line}`);
    }
    out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title, body: notes.length ? `명단 정리로 방출된 선수:\n${notes.join('\n')}` : '모든 구단이 40명 이하로 보류 명단을 확정했습니다.' });
  }

  private openSalaryTalks(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const off = this.offseason(meta);
    const year = this.contractYear(meta);
    const fa = new Map(this.repo.getFa(off).map((e) => [e.playerId, e]));
    const talks: SalaryTalk[] = [];
    const updated: PlayerTruth[] = [];
    // 8e-2(D-190 (6)): 직전 시즌 올스타 선정 선수는 요구액 가산
    const allStars = new Set(this.repo.getAllStar(year - 1)?.picks.map((x) => x.playerId) ?? []);
    for (const p of this.players()) {
      if (p.clubId === null || p.origin !== 'domestic' || p.contractYears !== 0) continue;
      const e = fa.get(p.id);
      if (e && e.status !== 'declined') continue; // FA 시장에 나간 선수는 제외
      const base = salaryDemand(meta.seed, p, year);
      const demand = allStars.has(p.id) ? round1m(base * (1 + ALLSTAR.salaryBonus)) : base;
      if (p.clubId === meta.userClubId) {
        talks.push({ playerId: p.id, offseason: off, clubId: p.clubId, priorSalary: p.salary, demand, offer: round1m(demand * 0.95), status: 'open', final: null });
      } else {
        // AI 구단은 고과 기준으로 바로 합의한다.
        const final = round1m(demand * 0.98);
        talks.push({ playerId: p.id, offseason: off, clubId: p.clubId, priorSalary: p.salary, demand, offer: final, status: 'agreed', final });
        p.salary = Math.max(final, 30_000_000);
        p.contractYears = 1;
        updated.push(p);
      }
    }
    this.repo.saveSalaryTalks(talks);
    this.repo.savePlayers(updated);
    const mine = talks.filter((t) => t.clubId === meta.userClubId);
    out.inbox.push({
      date,
      kind: 'task',
      sender: '운영팀',
      title: `연봉 협상 대상 ${mine.length}명`,
      body: `보류 선수 ${mine.length}명과 2027 연봉 협상을 시작합니다. 운영팀이 요구액의 95% 수준으로 첫 제시안을 만들어 두었습니다.\n[계약·이적 > 연봉 협상]에서 금액을 조정할 수 있습니다. 1월 10일까지 합의하지 못하면 조정 신청으로 구단 제시액과 선수 요구액의 중간값으로 정해집니다.`,
    });
  }

  private arbitrate(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const talks = this.repo.getSalaryTalks(this.offseason(meta));
    const byId = new Map(this.players().map((p) => [p.id, p]));
    const changed: PlayerTruth[] = [];
    let n = 0;
    for (const t of talks) {
      if (t.status !== 'open') continue;
      const p = byId.get(t.playerId);
      t.status = 'arbitrated';
      t.final = round1m((t.offer + t.demand) / 2);
      if (p && p.clubId === t.clubId) {
        p.salary = Math.max(t.final, 30_000_000);
        p.contractYears = 1;
        changed.push(p);
      }
      if (t.clubId === meta.userClubId) n++;
    }
    this.repo.saveSalaryTalks(talks);
    this.repo.savePlayers(changed);
    if (n > 0) out.inbox.push({ date, kind: 'report', sender: '운영팀', title: `연봉조정 ${n}명`, body: `합의하지 못한 ${n}명의 연봉이 조정 신청으로 정해졌습니다(구단 제시액과 요구액의 중간값).` });
  }

  private foreignOf(clubId: ClubId) {
    return this.players().filter((p) => p.clubId === clubId && p.origin !== 'domestic');
  }

  private foreignCheck(roster: PlayerTruth[], changes: Map<number, { salaryUsd: number; isNew: boolean; renewals: number }>) {
    return validateForeign(
      roster.map((p) => {
        const c = changes.get(p.id);
        return { origin: p.origin, isPitcher: p.isPitcher, salaryUsd: c?.salaryUsd ?? wonToUsd(p.salary), renewals: c?.renewals ?? p.career.foreignRenewals, isNew: c?.isNew ?? false, priorUsd: wonToUsd(p.salary) };
      }),
    );
  }

  /** 외국인 계약 확정 (재계약·신규) */
  private signForeign(clubId: ClubId, p: PlayerTruth, salaryUsd: number, renewal: boolean): void {
    p.clubId = clubId;
    p.salary = usdToWon(salaryUsd);
    p.contractYears = 1;
    p.level = '2군';
    if (renewal) p.career.foreignRenewals += 1;
    this.repo.savePlayers([p]);
  }

  /** AI 구단의 외국인 정리(12월 매주 월요일): 기대 이하 선수는 내보내고, 빈자리는 해외 풀에서 채운다. */
  private aiForeignMoves(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const moves: string[] = [];
    for (const club of this.clubs.values()) {
      if (club.id === meta.userClubId) continue;
      for (const p of this.foreignOf(club.id).filter((x) => x.contractYears === 0)) {
        const keep = clubEstimate(meta.seed, club.id, p) >= (p.origin === 'asia' ? 50 : 56);
        const demand = foreignRenewalDemandUsd(p);
        const roster = this.foreignOf(club.id);
        if (keep && this.foreignCheck(roster, new Map([[p.id, { salaryUsd: demand, isNew: false, renewals: p.career.foreignRenewals + 1 }]])).length === 0) {
          this.signForeign(club.id, p, demand, true);
          moves.push(`${club.shortName}: ${p.name} 재계약`);
        } else {
          p.clubId = null;
          p.contractYears = 0;
          this.repo.savePlayers([p]);
          moves.push(`${club.shortName}: ${p.name} 재계약 포기`);
        }
      }
      this.fillForeign(meta, club.id, moves);
    }
    if (moves.length) out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: '외국인 선수 계약 소식', body: moves.join('\n') });
  }

  /** 빈 외국인·아시아쿼터 자리를 해외 풀에서 채운다(구단 평가 순, 규정 안에서). */
  private fillForeign(meta: GameMeta, clubId: ClubId, notes: string[], leaveOpen = 0): void {
    const isUser = clubId === meta.userClubId;
    for (const origin of ['foreign', 'asia'] as const) {
      const max = origin === 'foreign' ? FOREIGN.maxForeign - leaveOpen : FOREIGN.maxAsia;
      let guard = 0;
      while (this.foreignOf(clubId).filter((p) => p.origin === origin).length < max && guard++ < 5) {
        // 사용자 구단은 40명을 넘기지 않는 범위에서만 기본 처리한다. AI 구단은 영입 뒤 명단을 다시 정리한다.
        if (isUser && this.players().filter((p) => p.clubId === clubId).length >= LEAGUE.rosterMax) {
          notes.push('선수단이 40명이라 빈 외국인 자리를 채우지 못했습니다. 방출 후 직접 영입하세요.');
          break;
        }
        const pool = this.players()
          .filter((p) => p.clubId === null && p.origin === origin && p.career.foreignRenewals === 0 && p.contractYears === 0)
          .sort((a, b) => clubEstimate(meta.seed, clubId, b) - clubEstimate(meta.seed, clubId, a) || a.id - b.id);
        const roster = this.foreignOf(clubId);
        const pick = needFirst(this.players().filter((p) => p.clubId === clubId), pool, (p) => p).find((p) => this.foreignCheck([...roster, p], new Map([[p.id, { salaryUsd: wonToUsd(p.salary), isNew: true, renewals: 0 }]])).length === 0);
        if (!pick) break;
        this.signForeign(clubId, pick, wonToUsd(pick.salary), false);
        notes.push(`${this.club(clubId).shortName}: ${pick.name} 신규 영입 (${Math.round(wonToUsd(pick.salary) / 10_000)}만 달러)`);
      }
    }
  }

  /** 1/31 캠프 명단 확정: 사용자 구단의 남은 일을 운영팀이 기본 처리한다(22 문서). */
  private campDefaults(meta: GameMeta, date: GameDate, out: MarketDayOutput): void {
    const notes: string[] = [];
    for (const p of this.foreignOf(meta.userClubId).filter((x) => x.contractYears === 0)) {
      const demand = foreignRenewalDemandUsd(p);
      if (this.foreignCheck(this.foreignOf(meta.userClubId), new Map([[p.id, { salaryUsd: demand, isNew: false, renewals: p.career.foreignRenewals + 1 }]])).length === 0) {
        this.signForeign(meta.userClubId, p, demand, true);
        notes.push(`${p.name} 재계약 (${Math.round(demand / 10_000)}만 달러)`);
      } else {
        p.clubId = null;
        this.repo.savePlayers([p]);
        notes.push(`${p.name} 재계약 불가(규정 초과)로 결별`);
      }
    }
    // D-215: 자동 실행에서는 외국인 1자리를 비워 둔다(아시아쿼터는 채운다)
    this.fillForeign(meta, meta.userClubId, notes, meta.autoRun?.foreignVacancy ? 1 : 0);
    // AI 구단도 빈자리를 채운 뒤, 캠프 명단(40명 이하)에 맞춰 다시 정리한다.
    const filled: string[] = [];
    for (const club of this.clubs.values()) {
      if (club.id === meta.userClubId) continue;
      this.fillForeign(meta, club.id, []);
      filled.push(...this.fillRosterNeeds(meta, club.id));
    }
    if (filled.length) out.inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: '포지션 보강 영입', body: filled.join('\n') });
    this.aiPruneRosters(meta, date, out, '캠프 명단 확정');
    const fa = this.repo.getFa(this.offseason(meta));
    // D-215: 자동 실행의 간판 외야수는 첫 안건(2월 2주 말 마감)으로 협상 가능 상태를 유지한다
    for (const e of fa) if (e.status === 'approved' && meta.autoRun?.franchiseId !== e.playerId) e.status = 'unsigned';
    this.repo.saveFa(fa);
    if (notes.length) out.inbox.push({ date, kind: 'report', sender: '운영팀', title: '외국인 선수 기본 처리', body: `캠프 명단 확정에 맞춰 운영팀이 처리했습니다.\n${notes.join('\n')}` });
  }

  /** 시즌 모드 시작: 계약 연수를 한 해 줄이고, 구단별 1군을 다시 짠다. */
  onSeasonStart(): void {
    const all = this.players();
    for (const p of all) if (p.clubId !== null && p.contractYears > 0) p.contractYears -= 1;
    // 연장 계약(D-136): 새 연봉을 새 시즌 시작에 적용
    for (const p of all) if (p.nextContract) {
      if (p.clubId !== null && !p.retired) p.salary = p.nextContract.salary;
      delete p.nextContract;
    }
    // D-233: 첫 안건의 미계약 간판 외야수는 계약 전까지 1군 편성에서 뺀다(떠나도 1군 인원이 비지 않게)
    const exception = this.repo.getMeta().autoRun?.franchiseId ?? null;
    for (const p of all) if (p.id === exception) p.level = '2군';
    for (const club of this.clubs.values()) assignActiveRoster(all.filter((p) => p.clubId === club.id && p.id !== exception));
    this.repo.savePlayers(all);
  }

  // ───────── 사용자 명령 ─────────

  private spendAp(weekId: string, amount: number) {
    try {
      this.repo.spendAp(weekId, amount);
    } catch {
      throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다. 다음 주에 다시 시도하거나 담당 팀에 맡기세요.');
    }
  }

  /** D-130·D-136 계약 세션: 이번 주 이 선수와 열린 세션과 남은 제안 수 */
  contractSession(meta: GameMeta, playerId: number): { open: boolean; offersLeft: number; apCost: number } {
    // D-218: 스토브리그 협상 세션은 턴 단위
    const weekId = apPeriodId(meta);
    const s = meta.contractSessions?.[String(playerId)];
    const open = !!s && s.weekId === weekId;
    return { open, offersLeft: open ? Math.max(0, CONTRACT.offersPerSession - s!.count) : CONTRACT.offersPerSession, apCost: open ? 0 : 1 };
  }

  /**
   * 직접 행동(세션 과금): 이 선수와 그 주 첫 제안 때만 행동력 1 + 운영팀 처리량 50%, 같은 주 3회까지 추가 비용 없음.
   * 위임 실행: 추가 비용 없음(준비 때 처리량 100% 차감). 호출자의 트랜잭션 안에서 부른다.
   */
  private pay(meta: GameMeta, source: ActionSource, playerId: number, wp: number) {
    if (source.kind !== 'direct') {
      this.chargeWp(source, 'ops', wp);
      return;
    }
    const s = this.contractSession(meta, playerId);
    if (s.open && s.offersLeft <= 0) throw new GameError('CONTRACT_LIMIT', `이번 주 이 선수에게 제안 ${CONTRACT.offersPerSession}회를 모두 했습니다. 다음 주에 다시 협상할 수 있습니다(행동력 1).`);
    if (!s.open) {
      this.spendAp(source.weekId, 1);
      this.chargeWp(source, 'ops', wp);
    }
    const current = this.repo.getMeta();
    const weekId = apPeriodId(meta);
    const kept = Object.fromEntries(Object.entries(current.contractSessions ?? {}).filter(([, v]) => v.weekId === weekId));
    const prev = kept[String(playerId)];
    this.repo.updateMeta({ contractSessions: { ...kept, [String(playerId)]: { weekId, count: (prev?.count ?? 0) + 1 } } });
  }

  /** 구단주가 직접 협상하면 같은 선수의 위임 업무를 멈춰 중복 실행을 막는다(03 문서). 실제 행동이 확정될 때만 호출한다. */
  private takeOver(meta: GameMeta, source: ActionSource, playerId: number) {
    if (source.kind !== 'direct') return;
    const tasks = this.repo.getTasks({ status: ['queued', 'waiting'], targetId: playerId }).filter((t) => t.kind === 'fa' || t.kind === 'salary');
    for (const t of tasks) {
      this.repo.updateTask(t.id, { status: 'cancelled', note: '구단주 직접 협상으로 전환', updated: meta.currentDate });
      for (const a of this.repo.getApprovals('pending').filter((x) => x.taskId === t.id)) this.repo.updateApproval(a.id, 'expired');
    }
  }

  // ───────── 대상 검증: 실행 명령과 선수 행동 조회(player.actions)가 같은 함수를 쓴다(D-118) ─────────

  /** FA 제안 대상: 승인된 FA이고 시장이 열려 있어야 한다. */
  faTarget(meta: GameMeta, playerId: number): FaEntry {
    const e = this.repo.getFa(this.offseason(meta)).find((x) => x.playerId === playerId);
    if (!e || e.status !== 'approved') throw new GameError('NOT_AVAILABLE', '지금 협상할 수 있는 FA 선수가 아닙니다.');
    if (this.players().find((p) => p.id === playerId)?.retired) throw new GameError('NOT_AVAILABLE', '은퇴한 선수입니다.');
    if (!this.marketOpen(meta)) throw new GameError('MARKET_CLOSED', `FA 시장이 아직 열리지 않았습니다. (${stoveDates(meta.kDate).faMarketOpen.slice(5).replace('-', '/')} 개장)`);
    return e;
  }

  /** 연봉 협상 대상: 우리 구단의 협상 중인 보류 선수 */
  salaryTarget(meta: GameMeta, playerId: number): SalaryTalk {
    const t = this.repo.getSalaryTalks(this.offseason(meta)).find((x) => x.playerId === playerId && x.clubId === meta.userClubId);
    if (!t || t.status !== 'open') throw new GameError('NOT_AVAILABLE', '협상 중인 연봉 대상이 아닙니다.');
    return t;
  }

  /** 외국인 계약 대상: 우리 계약 만료 외국인(재계약) 또는 해외 풀 선수(신규), 스토브리그에만 */
  foreignTarget(meta: GameMeta, playerId: number): { p: PlayerTruth; renewal: boolean; demandUsd: number } {
    const p = this.players().find((x) => x.id === playerId);
    if (!p || p.origin === 'domestic') throw new GameError('NOT_AVAILABLE', '외국인 선수가 아닙니다.');
    if (meta.mode !== 'stove') throw new GameError('NOT_AVAILABLE', '외국인 계약은 스토브리그에 합니다. (시즌 중 교체는 다음 단계)');
    const renewal = p.clubId === meta.userClubId;
    if (renewal && p.contractYears !== 0) throw new GameError('NOT_AVAILABLE', '이미 계약 중인 선수입니다.');
    if (!renewal && p.clubId !== null) throw new GameError('NOT_AVAILABLE', '다른 구단 소속 선수입니다.');
    return { p, renewal, demandUsd: renewal ? foreignRenewalDemandUsd(p) : wonToUsd(p.salary) };
  }

  /** 외국인 보유·금액 규정 위반 사유(없으면 빈 배열) */
  foreignRuleErrors(meta: GameMeta, p: PlayerTruth, renewal: boolean, salaryUsd: number): string[] {
    const roster = this.foreignOf(meta.userClubId);
    const after = renewal ? roster : [...roster, p];
    return this.foreignCheck(after, new Map([[p.id, { salaryUsd, isNew: !renewal, renewals: renewal ? p.career.foreignRenewals + 1 : 0 }]]));
  }

  /** 방출 대상: 우리 선수이고 FA 시장에 나가 있지 않아야 한다. */
  releaseTarget(meta: GameMeta, playerId: number): PlayerTruth {
    const p = this.players().find((x) => x.id === playerId);
    if (!p || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수가 아닙니다.');
    const e = this.repo.getFa(this.offseason(meta)).find((x) => x.playerId === playerId);
    if (e && (e.status === 'applied' || e.status === 'approved')) throw new GameError('NOT_AVAILABLE', 'FA 시장에 나간 선수는 방출할 수 없습니다.');
    return p;
  }

  /**
   * 같은 날 같은 선수에게 같은 조건을 다시 보내면 비용 없이 거부한다(D-118).
   * 같은 날의 같은 조건은 결과가 시드로 정해져 있어 다시 보내도 행동력만 쓰기 때문이다.
   */
  assertNewOffer(meta: GameMeta, playerId: number, kind: OfferRow['kind'], offer: ContractOffer): void {
    const same = this.repo
      .getOffers({ playerId, clubId: meta.userClubId, kind })
      .some((o) => o.date === meta.currentDate && o.offer.years === offer.years && o.offer.salary === offer.salary && o.offer.bonus === offer.bonus);
    if (same) throw new GameError('DUPLICATE_OFFER', '오늘 같은 조건으로 이미 제안했습니다. 조건을 바꾸거나 다음 날 다시 제안하세요. (행동력은 쓰지 않았습니다)');
  }

  faOffer(meta: GameMeta, source: ActionSource, playerId: number, offer: ContractOffer) {
    if (offer.years < 1 || offer.years > 6 || offer.salary < 30_000_000 || offer.bonus < 0) throw new GameError('INVALID_OFFER', '기간은 1~6년, 연봉은 3,000만 원 이상이어야 합니다.');
    const e = this.faTarget(meta, playerId);
    if (source.kind === 'direct') this.assertNewOffer(meta, playerId, 'fa', offer);
    const comp = e.originClub === meta.userClubId ? 0 : compensationFor(e.grade ?? 'C', e.priorSalary);
    const cash = this.repo.cashBalance(meta.userClubId);
    if (cash < offer.bonus + comp) throw new GameError('CASH_SHORT', `현금이 부족합니다. 계약금 ${won(offer.bonus)}${comp ? ` + 보상금 ${won(comp)}` : ''}이 필요합니다.`);
    const p = this.players().find((x) => x.id === playerId)!;
    payrollGuard(this.budget.payrollError(meta, offer.salary - (p.clubId === meta.userClubId ? p.salary : 0)));
    const year = this.contractYear(meta);
    return this.repo.transaction(() => {
      this.pay(meta, source, playerId, TASK_WP.faRound);
      this.takeOver(meta, source, playerId);
      const ctx = this.offerContext(meta, p, e, meta.userClubId);
      const others = this.repo.getOffers({ playerId, status: 'pending', kind: 'fa' }).filter((o) => o.clubId !== meta.userClubId);
      const bestOther = Math.max(0, ...others.map((o) => offerScore(o.offer, this.offerContext(meta, p, e, o.clubId), year)));
      const res = respondToOffer(offer, ctx, year, this.weeksSinceOpen(meta), bestOther);
      for (const o of this.repo.getOffers({ playerId, clubId: meta.userClubId, status: 'pending' })) this.repo.updateOffer(o.id, { status: 'withdrawn' });
      if (res.kind === 'accept') {
        const id = this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'fa', date: meta.currentDate, offer, status: 'accepted', response: '계약 합의' });
        const out: MarketDayOutput = { inbox: [], ledger: [] };
        this.signFa(meta, meta.currentDate, e, p, meta.userClubId, offer, out);
        for (const o of others) this.repo.updateOffer(o.id, { status: 'rejected', response: '다른 구단과 계약' });
        this.repo.addLedger(out.ledger);
        this.repo.addInbox(out.inbox);
        return { result: 'accept' as const, message: `${p.name} 선수가 제안을 받아들였습니다. ${describe(offer)}`, offerId: id };
      }
      this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'fa', date: meta.currentDate, offer, status: res.kind === 'counter' ? 'countered' : 'rejected', response: res.kind === 'counter' ? `${res.message} 역제안: ${describe(res.counter)}` : res.message });
      return res.kind === 'counter' ? { result: 'counter' as const, message: res.message, counter: res.counter } : { result: 'reject' as const, message: res.message };
    });
  }

  salaryOffer(meta: GameMeta, source: ActionSource, playerId: number, amount: number) {
    const t = this.salaryTarget(meta, playerId);
    if (amount < 30_000_000) throw new GameError('INVALID_OFFER', '최저 연봉(3,000만 원) 이상이어야 합니다.');
    const record: ContractOffer = { years: 1, salary: round1m(amount), bonus: 0 };
    if (source.kind === 'direct') this.assertNewOffer(meta, playerId, 'salary', record);
    const p = this.players().find((x) => x.id === playerId)!;
    return this.repo.transaction(() => {
      this.pay(meta, source, playerId, TASK_WP.salaryTalk);
      this.takeOver(meta, source, playerId);
      t.offer = record.salary;
      if (salaryAccepts(meta.seed, p, t.offer, t.demand)) {
        t.status = 'agreed';
        t.final = t.offer;
        p.salary = t.offer;
        p.contractYears = 1;
        this.repo.savePlayers([p]);
        this.repo.saveSalaryTalks([t]);
        const message = `${p.name} 선수와 ${won(t.offer)}에 합의했습니다.`;
        this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'salary', date: meta.currentDate, offer: record, status: 'accepted', response: message });
        return { result: 'accept' as const, message };
      }
      this.repo.saveSalaryTalks([t]);
      const message = `${p.name} 선수가 아직 만족하지 않습니다. (요구액 ${won(t.demand)})`;
      this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'salary', date: meta.currentDate, offer: record, status: 'rejected', response: message });
      return { result: 'reject' as const, message };
    });
  }

  foreignOffer(meta: GameMeta, source: ActionSource, playerId: number, salaryUsd: number) {
    const { p, renewal, demandUsd: demand } = this.foreignTarget(meta, playerId);
    const errors = this.foreignRuleErrors(meta, p, renewal, salaryUsd);
    if (errors.length) throw new GameError('FOREIGN_RULE', errors.join(' '));
    const record: ContractOffer = { years: 1, salary: usdToWon(salaryUsd), bonus: 0 };
    if (source.kind === 'direct') this.assertNewOffer(meta, playerId, 'foreign', record);
    payrollGuard(this.budget.payrollError(meta, record.salary - (p.clubId === meta.userClubId ? p.salary : 0)));
    return this.repo.transaction(() => {
      this.pay(meta, source, playerId, TASK_WP.foreignContract);
      if (salaryUsd >= demand) {
        this.signForeign(meta.userClubId, p, salaryUsd, renewal);
        const message = `${p.name} 선수와 ${Math.round(salaryUsd / 10_000)}만 달러에 계약했습니다.`;
        this.repo.addInbox([{ date: meta.currentDate, kind: 'news', sender: 'KBO 소식', title: `${this.club(meta.userClubId).shortName}, ${p.name} ${renewal ? '재계약' : '영입'}`, body: message }]);
        this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'foreign', date: meta.currentDate, offer: record, status: 'accepted', response: message });
        return { result: 'accept' as const, message };
      }
      const message = `${p.name} 선수 측은 ${Math.round(demand / 10_000)}만 달러를 원합니다.`;
      this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'foreign', date: meta.currentDate, offer: record, status: 'rejected', response: message });
      return { result: 'reject' as const, message };
    });
  }

  // ───────── 5b 연장 계약·국내 무소속 영입 (D-136) ─────────

  /** 연장 계약 대상: 시즌 중, 계약 마지막 해인 우리 국내 선수 */
  extensionTarget(meta: GameMeta, playerId: number): { p: PlayerTruth; demand: ContractOffer } {
    const p = this.players().find((x) => x.id === playerId);
    if (!p || p.clubId !== meta.userClubId || p.retired) throw new GameError('NOT_AVAILABLE', '우리 구단 선수가 아닙니다.');
    if (p.origin !== 'domestic') throw new GameError('NOT_AVAILABLE', '외국인 선수는 재계약 절차를 따릅니다.');
    if (meta.mode !== 'season') throw new GameError('NOT_AVAILABLE', '연장 계약은 시즌 중(2월~)에 합니다. 스토브리그에는 FA·연봉 협상을 씁니다.');
    if (p.contractYears !== 0) throw new GameError('NOT_AVAILABLE', `계약이 ${p.contractYears}년 더 남았습니다. 마지막 해에 연장할 수 있습니다.`);
    if (p.nextContract) throw new GameError('NOT_AVAILABLE', '이미 연장 계약을 맺었습니다.');
    const age = meta.season - Number(p.birthDate.slice(0, 4));
    if (age > CONTRACT.extensionMaxAge) throw new GameError('NOT_AVAILABLE', `${CONTRACT.extensionMaxAge}세가 넘은 선수는 연장 계약 대신 시즌 뒤 재계약합니다.`);
    const year = meta.season + 1;
    const base = faDemand(meta.seed, p, year);
    const near = p.career.faServiceYears + 1 >= FA_SERVICE_YEARS_REQUIRED;
    const k = near ? CONTRACT.extensionNearFa : CONTRACT.extensionFar;
    const demand = { years: Math.min(CONTRACT.extensionMaxYears, base.years), salary: Math.max(WORLDGEN.minSalary, round1m(base.salary * k)), bonus: round1m(base.bonus * k) };
    return { p, demand };
  }

  extensionOffer(meta: GameMeta, source: ActionSource, playerId: number, offer: ContractOffer) {
    if (offer.years < 1 || offer.years > CONTRACT.extensionMaxYears || offer.salary < WORLDGEN.minSalary || offer.bonus < 0) throw new GameError('INVALID_OFFER', `기간은 1~${CONTRACT.extensionMaxYears}년, 연봉은 최저 연봉 이상이어야 합니다.`);
    const { p, demand } = this.extensionTarget(meta, playerId);
    if (source.kind === 'direct') this.assertNewOffer(meta, playerId, 'extension', offer);
    if (this.repo.cashBalance(meta.userClubId) < offer.bonus) throw new GameError('CASH_SHORT', `현금이 부족합니다. 계약금 ${won(offer.bonus)}이 필요합니다.`);
    // 연장 계약 연봉은 다음 시즌부터: 지금 연봉과의 차이만큼 연봉 한도로 본다
    payrollGuard(this.budget.payrollError(meta, offer.salary - p.salary));
    const year = meta.season + 1;
    return this.repo.transaction(() => {
      this.pay(meta, source, playerId, TASK_WP.faRound);
      const ctx: OfferContext = { seed: meta.seed, player: p, demand, club: this.club(meta.userClubId), isFormerClub: true };
      const res = respondToOffer(offer, ctx, year, 0, 0);
      if (res.kind === 'accept') {
        p.contractYears = offer.years;
        p.nextContract = { salary: offer.salary, startSeason: meta.season + 1 };
        p.bonusCap = bonusCapOf(offer.bonus, offer.years, meta.userClubId, meta.season + 1);
        this.repo.savePlayers([p]);
        if (offer.bonus > 0) this.repo.addLedger([{ clubId: meta.userClubId, date: meta.currentDate, category: 'signingBonus', amount: -offer.bonus, memo: `${p.name} 연장 계약금` }]);
        const message = `${p.name} 선수와 연장 계약에 합의했습니다. ${describe(offer)} (새 연봉은 ${meta.season + 1} 시즌부터)`;
        this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'extension', date: meta.currentDate, offer, status: 'accepted', response: message });
        this.repo.addInbox([{ date: meta.currentDate, kind: 'news', sender: 'KBO 소식', title: `${this.club(meta.userClubId).shortName}, ${p.name} 연장 계약`, body: message }]);
        return { result: 'accept' as const, message };
      }
      this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'extension', date: meta.currentDate, offer, status: res.kind === 'counter' ? 'countered' : 'rejected', response: res.kind === 'counter' ? `${res.message} 역제안: ${describe(res.counter)}` : res.message });
      return res.kind === 'counter' ? { result: 'counter' as const, message: res.message, counter: res.counter } : { result: 'reject' as const, message: res.message };
    });
  }

  /** 국내 무소속 선수 영입 대상: 소속 없는 국내 선수(FA 시장 협상 중이 아님), 거래 기간 안 */
  domesticTarget(meta: GameMeta, playerId: number): { p: PlayerTruth; demand: number } {
    const p = this.players().find((x) => x.id === playerId);
    if (!p || p.clubId !== null || p.retired || p.origin !== 'domestic') throw new GameError('NOT_AVAILABLE', '소속 없는 국내 선수가 아닙니다.');
    const e = this.repo.getFa(this.offseason(meta)).find((x) => x.playerId === playerId);
    if (e && (e.status === 'applied' || e.status === 'approved')) throw new GameError('NOT_AVAILABLE', 'FA 시장에 나온 선수는 FA 협상으로 영입합니다.');
    const window = dealWindowReason(meta, '무소속 선수 영입');
    if (window) throw new GameError('NOT_AVAILABLE', window);
    if (this.players().filter((x) => x.clubId === meta.userClubId).length >= LEAGUE.rosterMax) throw new GameError('ROSTER_FULL', `선수단이 ${LEAGUE.rosterMax}명입니다. 먼저 자리를 비우세요.`);
    const age = meta.season - Number(p.birthDate.slice(0, 4));
    const demand = Math.max(WORLDGEN.minSalary, round1m(domesticSalary(publicOverall(meta.seed, p), age, p.career.proSeasons) * CONTRACT.domesticDemandShare));
    return { p, demand };
  }

  domesticOffer(meta: GameMeta, source: ActionSource, playerId: number, salary: number) {
    if (!(salary >= WORLDGEN.minSalary)) throw new GameError('INVALID_OFFER', '최저 연봉 이상이어야 합니다.');
    const { p, demand } = this.domesticTarget(meta, playerId);
    const record: ContractOffer = { years: 1, salary: round1m(salary), bonus: 0 };
    if (source.kind === 'direct') this.assertNewOffer(meta, playerId, 'domestic', record);
    payrollGuard(this.budget.payrollError(meta, record.salary));
    return this.repo.transaction(() => {
      this.pay(meta, source, playerId, TASK_WP.salaryTalk);
      if (record.salary >= demand) {
        p.clubId = meta.userClubId;
        p.level = '2군';
        p.salary = record.salary;
        // 스토브리그 계약은 다음 시즌 1년(2/1에 1 → 0), 시즌 중 계약은 올해만
        p.contractYears = meta.mode === 'stove' ? 1 : 0;
        delete p.training;
        this.repo.savePlayers([p]);
        const message = `${p.name} 선수와 1년 ${won(record.salary)}에 계약했습니다(2군 등록).`;
        this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'domestic', date: meta.currentDate, offer: record, status: 'accepted', response: message });
        this.repo.addInbox([{ date: meta.currentDate, kind: 'news', sender: 'KBO 소식', title: `${this.club(meta.userClubId).shortName}, ${p.name} 영입`, body: message }]);
        return { result: 'accept' as const, message };
      }
      const message = `${p.name} 선수 측은 ${won(demand)} 이상을 원합니다.`;
      this.repo.insertOffer({ playerId, clubId: meta.userClubId, kind: 'domestic', date: meta.currentDate, offer: record, status: 'rejected', response: message });
      return { result: 'reject' as const, message };
    });
  }

  /** EV-4(D-210 (7)) 사건 계약 해지: 기존 방출 규칙(잔여 연봉 의무), 행동력 없음 */
  releaseForCase(meta: GameMeta, date: GameDate, playerId: number, reason: string): string {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.clubId === null) return '';
    return this.release(meta, date, p, reason);
  }

  releasePlayer(meta: GameMeta, playerId: number) {
    const p = this.releaseTarget(meta, playerId);
    return this.repo.transaction(() => {
      const msg = this.release(meta, meta.currentDate, p, '방출');
      const talks = this.repo.getSalaryTalks(this.offseason(meta)).filter((t) => t.playerId === playerId);
      for (const t of talks) t.status = 'agreed';
      this.repo.saveSalaryTalks(talks);
      this.repo.addInbox([{ date: meta.currentDate, kind: 'news', sender: 'KBO 소식', title: `${this.club(meta.userClubId).shortName}, ${p.name} 방출`, body: msg }]);
      return { result: 'accept' as const, message: msg };
    });
  }

  /** 샐러리캡 산정액(D-227): 국내 선수 연봉 합 + 계약금 연평균. 시즌 기본값은 계약이 적용되는 시즌 */
  payroll(clubId: ClubId, season: number = this.contractYear(this.repo.getMeta())): number {
    return capPayroll(this.players(), clubId, season);
  }

  cap(meta: GameMeta): number {
    return salaryCap(this.contractYear(meta));
  }

  /** 다음 주 행동력 주 ID와 별개로, 화면에 보여줄 시장 단계 */
  stage(meta: GameMeta): { key: string; label: string } {
    if (meta.mode !== 'stove') return { key: 'season', label: '시즌 중 (미계약 FA만 계약 가능)' };
    const d = stoveDates(meta.kDate);
    const t = meta.currentDate;
    if (diffDays(t, d.faNotice) < 0) return { key: 'beforeNotice', label: `FA 공시 전 (${d.faNotice.slice(5).replace('-', '/')} 공시)` };
    if (diffDays(t, d.faMarketOpen) < 0) return { key: 'approved', label: `FA 신청 완료 (${d.faMarketOpen.slice(5).replace('-', '/')} 시장 개장)` };
    if (diffDays(t, d.campRoster) <= 0) return { key: 'open', label: `FA 시장 ${this.weeksSinceOpen(meta) + 1}주 차` };
    return { key: 'closed', label: '스토브리그 마감' };
  }

  /** 스토브리그에서 넘어가면 안 되는 상태: 보류 명단(11/30)·캠프 명단(1/31) 전 40명 초과 */
  nextDay(date: GameDate) {
    return addDays(date, 1);
  }
}
