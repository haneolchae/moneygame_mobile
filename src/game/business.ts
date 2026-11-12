// 6a 관중·티켓·시설 투자(13·14·16 문서, D-141): 홈경기 관중과 입장·매점 수입, 구장 관람료, 가격 정책,
// 시설 공사(착수·지급·완공·취소)와 유지비, AI 구단 투자, 시설 효과. 모든 구단이 같은 규칙을 쓴다.
import { addDays, diffDays, weekday, type GameDate } from '../engine/calendar';
import { ATTENDANCE, EVENTS, FACILITY, MARKETING } from '../engine/config';
import { demandBoost, demandWith, fanTargetBoost, satisfactionBoost, weekNumber } from './events';
import type { EventState } from './ports';
import { blendedPct, CAMPAIGN_KINDS, campaignBoost, FACILITY_KINDS, gate, newFacilities, nextSatisfaction, planProject, rehabBoost, scoutingBoost, startSatisfaction, trainingBoost, unpaid, type Campaign, type CampaignKind, type ClubFacilities, type FacilityKind, type FacilityProject, type FanState, type TicketPolicy } from '../engine/business';
import { inflate, type LedgerEntry } from '../engine/finance';
import type { GameResult } from '../engine/gamesim';
import { EOK } from '../engine/money';
import type { ClubId, ClubProfile, Fixture } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { AttendanceTotals, GameMeta, GameRepository, InboxMessage } from './ports';
import { NO_GUARD, type BudgetGuard } from './budget';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);
const md = (d: GameDate) => d.slice(5).replace('-', '/');
const emptyTotals = (): AttendanceTotals => ({ games: 0, total: 0, max: 0, sellouts: 0, ticketWon: 0, w: 0, l: 0 });

export class BusinessOps {
  private priorCache: { season: number; pct: Map<ClubId, number> } | null = null;
  /** 그날 정규시즌 홈경기 관중(구단별). 굿즈 수요가 같은 날 읽는다(6d) */
  gateToday = new Map<ClubId, number>();
  /** 6e(D-177): 우리 구단 재량 지출 한도. 서비스가 연결한다 */
  budget: BudgetGuard = NO_GUARD;
  /** EV-2: 카드 기간 효과(서비스가 연결) */
  eventState: () => EventState | undefined = () => undefined;
  /** 7a(D-155): 재정 긴축 구단은 캠페인·시설 투자를 하지 않는다. 서비스가 연결한다 */
  austere: (clubId: ClubId) => boolean = () => false;

  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
  ) {}

  /** 그 시즌 물가 지수(2026 = 1) */
  inflation(meta: GameMeta, season = meta.season): number {
    return inflate(EOK, season, meta.inflationBp) / EOK;
  }

  facilitiesOf(meta: GameMeta, clubId: ClubId): ClubFacilities {
    const f = meta.facilities?.[String(clubId)];
    return f ? { levels: { ...f.levels }, projects: f.projects.map((p) => ({ ...p, payments: p.payments.map((x) => ({ ...x })) })) } : newFacilities();
  }

  private saveFacilities(clubId: ClubId, f: ClubFacilities) {
    const cur = this.repo.getMeta();
    this.repo.updateMeta({ facilities: { ...(cur.facilities ?? {}), [String(clubId)]: f } });
    this.facilityCache = null;
  }

  /** 되돌린 트랜잭션 뒤 캐시를 버린다(4c-3 관전 미리보기) */
  reset(): void {
    this.facilityCache = null;
  }

  // 시설 효과(완공 단계만)
  // 시설 효과는 선수마다 조회되므로 시설 항목만 읽어 기억해 둔다(메타 전체 해석 방지). 시설을 저장하거나 하루가 시작되면 버린다.
  private facilityCache: Record<string, ClubFacilities> | null = null;
  private facilities(): Record<string, ClubFacilities> {
    return (this.facilityCache ??= this.repo.getMetaValue<Record<string, ClubFacilities>>('facilities') ?? {});
  }
  trainingBoost = (clubId: ClubId) => trainingBoost(this.facilities()[String(clubId)]);
  rehabBoost = (clubId: ClubId) => rehabBoost(this.facilities()[String(clubId)]);
  scoutingBoost = (clubId: ClubId) => scoutingBoost(this.facilities()[String(clubId)]);

  // ───────── 6b 팬 만족도·캠페인 (D-147) ─────────

  fanOf(meta: GameMeta, clubId: ClubId): FanState {
    return meta.fans?.[String(clubId)] ?? { satisfaction: startSatisfaction(this.clubs.get(clubId)!.loyalty) };
  }

  /** 그날 효과가 있는 캠페인 */
  activeCampaigns(meta: GameMeta, clubId: ClubId, date: GameDate): Campaign[] {
    return (meta.campaigns?.[String(clubId)] ?? []).filter((c) => diffDays(date, c.start) >= 0 && diffDays(date, c.end) <= 0);
  }

  private newCampaign(meta: GameMeta, kind: CampaignKind, date: GameDate): Campaign {
    const def = MARKETING.campaigns[kind];
    return { kind, start: date, end: addDays(date, def.weeks * 7 - 1), costWon: Math.round((def.costWon * this.inflation(meta)) / 1_000_000) * 1_000_000 };
  }

  /** 매주 월요일(시즌 중): 모든 구단 만족도 갱신, 끝난 캠페인 정리, AI 캠페인, 우리 구단 팬 반발·해임 판정 */
  private weeklyFans(meta: GameMeta, date: GameDate): { ledger: LedgerEntry[]; inbox: InboxMessage[] } {
    const ledger: LedgerEntry[] = [];
    const inbox: InboxMessage[] = [];
    const season = meta.attendance?.[String(meta.season)] ?? {};
    const prior = this.priorPct(meta.season);
    const fans: Record<string, FanState> = {};
    const campaigns: Record<string, Campaign[]> = {};
    // 6c: 시즌별 실행 캠페인 수(스폰서 의무 정산용)
    const counts: Record<string, number> = { ...(meta.campaignCounts?.[String(meta.season)] ?? {}) };
    let gameOver: GameMeta['gameOver'] | undefined;
    for (const club of this.clubs.values()) {
      const id = String(club.id);
      const mine = club.id === meta.userClubId;
      let list = (meta.campaigns?.[id] ?? []).filter((c) => diffDays(date, c.end) <= 0);
      // AI 구단: 진행 캠페인이 없고 현금 여유가 있으면 가족 프로모션·온라인 콘텐츠(D-147 (5))
      if (!mine && list.length === 0 && !this.austere(club.id) && this.repo.cashBalance(club.id) >= club.startCash * MARKETING.aiCashFloor) {
        list = MARKETING.aiKinds.map((k) => this.newCampaign(meta, k as CampaignKind, date));
        for (const c of list) ledger.push({ clubId: club.id, date, category: 'marketing', amount: -c.costWon, memo: MARKETING.campaigns[c.kind].label });
        counts[id] = (counts[id] ?? 0) + list.length;
      }
      campaigns[id] = list;
      const t = season[id];
      const pct = blendedPct(t?.w ?? 0, t?.l ?? 0, prior.get(club.id) ?? 0.5);
      const cur = this.fanOf(meta, club.id);
      const active = list.filter((c) => diffDays(date, c.start) >= 0);
      // EV-2(D-205 (4)): 카드 팬 목표 가산은 캠페인 가산과 합쳐 같은 상한
      const rawBoost = active.reduce((a, c) => a + MARKETING.campaigns[c.kind].satisfaction, 0) + fanTargetBoost(this.eventState(), weekNumber(date), club.id);
      const next: FanState = { satisfaction: nextSatisfaction(cur.satisfaction, pct, club.loyalty, satisfactionBoost(rawBoost, 0)), ...(cur.lowSince ? { lowSince: cur.lowSince } : {}) };
      if (mine && !meta.gameOver) {
        if (next.satisfaction < MARKETING.backlashBelow && !next.lowSince) {
          next.lowSince = date;
          inbox.push({ date, kind: 'task', sender: '홍보팀', title: `팬 반발: 만족도 ${next.satisfaction}`, body: `팬 만족도가 ${MARKETING.backlashBelow} 아래로 떨어져 팬 반발 상태입니다. 관중이 20% 줄고, ${MARKETING.dismissWeeks}주 안에 ${MARKETING.recoverAt} 이상으로 회복하지 못하면 해임됩니다. 성적을 올리거나 [사업·시설]에서 캠페인을 실행하세요.` });
        } else if (next.lowSince && next.satisfaction >= MARKETING.recoverAt) {
          delete next.lowSince;
          inbox.push({ date, kind: 'report', sender: '홍보팀', title: `팬 반발 해소: 만족도 ${next.satisfaction}`, body: '팬 만족도가 회복돼 해임 위험이 사라졌습니다.' });
        } else if (next.lowSince && diffDays(date, next.lowSince) >= MARKETING.dismissWeeks * 7) {
          gameOver = { kind: 'dismissed', date, reason: `팬 만족도가 ${MARKETING.dismissWeeks}주 동안 ${MARKETING.recoverAt} 이상으로 회복되지 않아 모기업이 경영 책임을 물었습니다.` };
          inbox.push({ date, kind: 'task', sender: '모기업', title: '해임 통보', body: `${gameOver.reason}\n재임 기록은 명예의 전당에 남습니다.` });
        }
      } else if (!mine) delete next.lowSince;
      fans[id] = next;
    }
    this.repo.updateMeta({ fans, campaigns, campaignCounts: { ...(meta.campaignCounts ?? {}), [String(meta.season)]: counts }, ...(gameOver ? { gameOver } : {}) });
    return { ledger, inbox };
  }

  /** 캠페인 착수 검증(무료) */
  campaignTarget(meta: GameMeta, kind: CampaignKind): Campaign {
    if (!CAMPAIGN_KINDS.includes(kind)) throw new GameError('INVALID', '없는 캠페인입니다.');
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if ((meta.campaigns?.[String(meta.userClubId)] ?? []).some((c) => c.kind === kind && diffDays(meta.currentDate, c.end) <= 0)) throw new GameError('DUPLICATE', '같은 캠페인이 이미 진행 중입니다.');
    const c = this.newCampaign(meta, kind, meta.currentDate);
    if (this.repo.cashBalance(meta.userClubId) < c.costWon) throw new GameError('CASH_SHORT', `현금이 부족합니다. 캠페인 비용 ${won(c.costWon)}.`);
    const over = this.budget.spendError(meta, 'marketing', c.costWon);
    if (over) throw new GameError('BUDGET_OVER', over);
    return c;
  }

  /** 캠페인 착수: 행동력 2, 비용은 바로 지급 */
  startCampaign(meta: GameMeta, weekId: string, kind: CampaignKind): string {
    const c = this.campaignTarget(meta, kind);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, MARKETING.campaignAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(캠페인 행동력 ${MARKETING.campaignAp}).`);
      }
      const cur = this.repo.getMeta();
      const id = String(meta.userClubId);
      const sk = String(meta.season);
      this.repo.updateMeta({
        campaigns: { ...(cur.campaigns ?? {}), [id]: [...(cur.campaigns?.[id] ?? []).filter((x) => diffDays(meta.currentDate, x.end) <= 0), c] },
        campaignCounts: { ...(cur.campaignCounts ?? {}), [sk]: { ...(cur.campaignCounts?.[sk] ?? {}), [id]: (cur.campaignCounts?.[sk]?.[id] ?? 0) + 1 } },
      });
      this.repo.addLedger([{ clubId: meta.userClubId, date: meta.currentDate, category: 'marketing', amount: -c.costWon, memo: MARKETING.campaigns[kind].label }]);
      return `${MARKETING.campaigns[kind].label} 캠페인을 시작했습니다. 비용 ${won(c.costWon)}, ${md(c.start)}~${md(c.end)}.`;
    });
  }

  private priorPct(season: number): Map<ClubId, number> {
    if (this.priorCache?.season !== season) {
      const pct = new Map<ClubId, number>();
      for (const s of this.repo.getSeasonStandings(season - 1)) pct.set(s.clubId, s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0.5);
      this.priorCache = { season, pct };
    }
    return this.priorCache.pct;
  }

  /** 그날 정규시즌 홈경기의 관중·입장수입·매점·관람료. 집계(meta.attendance)와 승패를 갱신하고 장부 항목을 돌려준다 */
  onGames(meta: GameMeta, date: GameDate, fixtures: Fixture[], results: GameResult[]): LedgerEntry[] {
    this.gateToday = new Map();
    const regular = new Set(fixtures.filter((f) => !f.stage || f.stage === 'regular').map((f) => f.id));
    const games = results.filter((r) => regular.has(r.fixtureId));
    if (games.length === 0) return [];
    const key = String(meta.season);
    const season: Record<string, AttendanceTotals> = Object.fromEntries(Object.entries(meta.attendance?.[key] ?? {}).map(([k, v]) => [k, { ...v }]));
    const totals = (id: ClubId) => (season[String(id)] ??= emptyTotals());
    const prior = this.priorPct(meta.season);
    const inflation = this.inflation(meta);
    const out: LedgerEntry[] = [];
    for (const r of games) {
      const home = this.clubs.get(r.home)!;
      const away = this.clubs.get(r.away)!;
      const t = totals(r.home);
      const g = gate(
        { seed: meta.seed, fixtureId: r.fixtureId, home, away, weekday: weekday(date), wins: t.w, losses: t.l, priorPct: prior.get(r.home) ?? 0.5, policy: r.home === meta.userClubId ? (meta.ticketPolicy ?? 'normal') : 'normal', stadiumLevel: meta.facilities?.[String(r.home)]?.levels.stadium ?? 1, satisfaction: this.fanOf(meta, r.home).satisfaction, campaignDemand: demandWith(campaignBoost(this.activeCampaigns(meta, r.home, date)).demand, demandBoost(this.eventState(), weekNumber(date), r.home)) },
        inflation,
      );
      this.gateToday.set(r.home, (this.gateToday.get(r.home) ?? 0) + g.attendance);
      t.games += 1;
      t.total += g.attendance;
      t.max = Math.max(t.max, g.attendance);
      if (g.attendance >= home.stadiumCapacity) t.sellouts += 1;
      t.ticketWon += g.ticketWon;
      const memo = `${away.shortName}전 관중 ${g.attendance.toLocaleString('ko-KR')}명`;
      out.push({ clubId: r.home, date, category: 'ticketRevenue', amount: g.ticketWon, memo }, { clubId: r.home, date, category: 'concessions', amount: g.concessionWon, memo }, { clubId: r.home, date, category: 'stadiumGateFee', amount: -g.gateFeeWon, memo });
    }
    // 승패는 그날 관중 계산 뒤에 반영한다(전날까지의 성적으로 수요를 정함)
    for (const r of games) {
      if (r.outcome === 'tie') continue;
      totals(r.outcome === 'home' ? r.home : r.away).w += 1;
      totals(r.outcome === 'home' ? r.away : r.home).l += 1;
    }
    this.repo.updateMeta({ attendance: { ...(meta.attendance ?? {}), [key]: season } });
    return out;
  }

  /** 매일: 공사 지급·완공, 월말 유지비, 월요일 AI 구단 투자 */
  onDay(meta: GameMeta, date: GameDate): { ledger: LedgerEntry[]; inbox: InboxMessage[] } {
    const ledger: LedgerEntry[] = [];
    const inbox: InboxMessage[] = [];
    const inflation = this.inflation(meta);
    this.facilityCache = null;
    const monthEnd = addDays(date, 1).slice(8, 10) === '01';
    const all: Record<string, ClubFacilities> = {};
    let changed = false;
    for (const club of this.clubs.values()) {
      const f = this.facilitiesOf(meta, club.id);
      const mine = club.id === meta.userClubId;
      for (const p of [...f.projects]) {
        for (const pay of p.payments) {
          if (pay.paid || diffDays(date, pay.date) < 0) continue;
          pay.paid = true;
          changed = true;
          ledger.push({ clubId: club.id, date, category: 'facilityConstruction', amount: -pay.amountWon, memo: `${FACILITY.kinds[p.kind].label} ${p.toLevel}단계 공사비` });
        }
        if (diffDays(date, p.end) >= 0) {
          f.levels[p.kind] = p.toLevel;
          f.projects = f.projects.filter((x) => x !== p);
          changed = true;
          if (mine) inbox.push({ date, kind: 'report', sender: '구장시설팀', title: `완공: ${FACILITY.kinds[p.kind].label} ${p.toLevel}단계`, body: `${FACILITY.kinds[p.kind].label}이(가) ${p.toLevel}단계가 됐습니다. 오늘부터 효과가 적용됩니다: ${FACILITY.kinds[p.kind].effect}.\n유지비는 연 ${won(Math.round(FACILITY.upkeepPerLevelWon * p.toLevel * inflation))}입니다.` });
        }
      }
      if (monthEnd) {
        const levels = FACILITY_KINDS.reduce((a, k) => a + f.levels[k], 0);
        ledger.push({ clubId: club.id, date, category: 'facilityUpkeep', amount: -Math.round((FACILITY.upkeepPerLevelWon * levels * inflation) / 12), memo: `시설 유지비(단계 합 ${levels})` });
      }
      // AI 구단: 월요일, 여유 현금이 있으면 가장 낮은 단계 시설부터(D-141 (6))
      if (!mine && weekday(date) === 1 && !this.austere(club.id)) {
        const pick = this.investCandidate(meta, club.id, f, inflation, date);
        if (pick) {
          f.projects.push(pick);
          changed = true;
        }
      }
      all[String(club.id)] = f;
    }
    if (changed) this.repo.updateMeta({ facilities: all });
    this.facilityCache = null;
    if (meta.mode === 'season' && weekday(date) === 1) {
      const w = this.weeklyFans(meta, date);
      ledger.push(...w.ledger);
      inbox.push(...w.inbox);
    }
    return { ledger, inbox };
  }

  /** AI 투자 규칙(D-247): 현금 − (진행 공사 남은 지급 + 새 공사비 × aiCommitShare) ≥ 시작 현금 × 0.9. 완공금 몫은 공사 기간의 수입으로 낸다 */
  private investCandidate(meta: GameMeta, clubId: ClubId, f: ClubFacilities, inflation: number, date: GameDate): FacilityProject | null {
    const kind = FACILITY_KINDS.filter((k) => f.levels[k] < FACILITY.maxLevel && !f.projects.some((p) => p.kind === k)).sort((a, b) => f.levels[a] - f.levels[b] || FACILITY_KINDS.indexOf(a) - FACILITY_KINDS.indexOf(b))[0];
    if (!kind) return null;
    const project = planProject(kind, f.levels[kind] + 1, date, inflation);
    const committed = f.projects.reduce((a, p) => a + unpaid(p), 0);
    const floor = this.clubs.get(clubId)!.startCash * FACILITY.aiCashFloor;
    return this.repo.cashBalance(clubId) - committed - Math.round(project.costWon * FACILITY.aiCommitShare) >= floor ? project : null;
  }

  // ───────── 구단주 명령 ─────────

  /** 착수 검증(무료): 실패하면 사유를 던진다 */
  startTarget(meta: GameMeta, kind: FacilityKind): FacilityProject {
    if (!FACILITY_KINDS.includes(kind)) throw new GameError('INVALID', '없는 시설입니다.');
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    const f = this.facilitiesOf(meta, meta.userClubId);
    if (f.levels[kind] >= FACILITY.maxLevel) throw new GameError('NOT_AVAILABLE', '이미 최고 단계입니다.');
    if (f.projects.some((p) => p.kind === kind)) throw new GameError('DUPLICATE', '이 시설은 이미 공사 중입니다.');
    const project = planProject(kind, f.levels[kind] + 1, meta.currentDate, this.inflation(meta));
    if (this.repo.cashBalance(meta.userClubId) < project.payments[0]!.amountWon) throw new GameError('CASH_SHORT', `현금이 부족합니다. 착공 때 ${won(project.payments[0]!.amountWon)}을 지급합니다.`);
    const over = this.budget.spendError(meta, 'facility', this.budget.inYear(meta, project.payments));
    if (over) throw new GameError('BUDGET_OVER', over);
    return project;
  }

  /** 착수: 행동력 3. 공사비는 착공·중간·완공일에 지급한다 */
  start(meta: GameMeta, weekId: string, kind: FacilityKind): string {
    const project = this.startTarget(meta, kind);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, FACILITY.startAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(시설 착수 행동력 ${FACILITY.startAp}).`);
      }
      const f = this.facilitiesOf(this.repo.getMeta(), meta.userClubId);
      f.projects.push(project);
      this.saveFacilities(meta.userClubId, f);
      const k = FACILITY.kinds[kind];
      return `${k.label} ${project.toLevel}단계 공사를 착수했습니다. 공사비 ${won(project.costWon)}${k.needsApproval ? `, 지자체 승인 뒤 ${md(project.start)} 착공` : `, ${md(project.start)} 착공`}, ${md(project.end)} 완공 예정.`;
    });
  }

  /** 취소: 착공 전은 무비용, 착공 뒤는 지급분 손실·남은 지급 해제 */
  cancel(meta: GameMeta, kind: FacilityKind): string {
    const f = this.facilitiesOf(meta, meta.userClubId);
    const p = f.projects.find((x) => x.kind === kind);
    if (!p) throw new GameError('NOT_AVAILABLE', '진행 중인 공사가 없습니다.');
    f.projects = f.projects.filter((x) => x !== p);
    this.saveFacilities(meta.userClubId, f);
    const paid = p.costWon - unpaid(p);
    return paid > 0 ? `${FACILITY.kinds[kind].label} 공사를 취소했습니다. 이미 지급한 ${won(paid)}은 돌아오지 않고, 남은 ${won(unpaid(p))} 지급은 해제됩니다.` : `${FACILITY.kinds[kind].label} 공사를 착공 전에 취소했습니다(비용 없음).`;
  }

  setPolicy(meta: GameMeta, policy: TicketPolicy): string {
    if (!(policy in ATTENDANCE.policy)) throw new GameError('INVALID', '가격 정책은 저가·보통·고가 중 하나입니다.');
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    this.repo.updateMeta({ ticketPolicy: policy });
    return `티켓 가격을 ${ATTENDANCE.policy[policy].label}로 정했습니다. 다음 홈경기부터 적용됩니다.`;
  }

  /** 화면용: 우리 구단 관중·가격 정책·시설 */
  view(meta: GameMeta) {
    const club = this.clubs.get(meta.userClubId)!;
    const inflation = this.inflation(meta);
    const f = this.facilitiesOf(meta, club.id);
    const policy = meta.ticketPolicy ?? 'normal';
    const seasons = Object.entries(meta.attendance ?? {})
      .map(([season, byClub]) => {
        const t = byClub[String(club.id)];
        const league = Object.entries(byClub).reduce((a, [id, v]) => ({ total: a.total + v.total, seats: a.seats + v.games * (this.clubs.get(Number(id))?.stadiumCapacity ?? 0) }), { total: 0, seats: 0 });
        return t && t.games > 0 ? { season: Number(season), games: t.games, total: t.total, average: Math.round(t.total / t.games), occupancy: t.total / (t.games * club.stadiumCapacity), sellouts: t.sellouts, ticketWon: t.ticketWon, leagueOccupancy: league.seats > 0 ? league.total / league.seats : null } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.season - a.season);
    let reason: string | null = null;
    const facilities = FACILITY_KINDS.map((kind) => {
      const k = FACILITY.kinds[kind];
      const p = f.projects.find((x) => x.kind === kind) ?? null;
      const level = f.levels[kind];
      let next: { level: number; costWon: number; weeks: number; firstPaymentWon: number; startDate: string; endDate: string } | null = null;
      reason = null;
      if (level < FACILITY.maxLevel && !p) {
        const plan = planProject(kind, level + 1, meta.currentDate, inflation);
        next = { level: level + 1, costWon: plan.costWon, weeks: FACILITY.weeks[level + 1]!, firstPaymentWon: plan.payments[0]!.amountWon, startDate: plan.start, endDate: plan.end };
        try {
          this.startTarget(meta, kind);
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
          reason = e.message;
        }
      } else reason = p ? '공사 중' : '최고 단계';
      return {
        kind,
        label: k.label,
        effect: k.effect,
        needsApproval: k.needsApproval,
        level,
        maxLevel: FACILITY.maxLevel,
        upkeepWon: Math.round(FACILITY.upkeepPerLevelWon * level * inflation),
        next,
        startReason: reason,
        project: p ? { toLevel: p.toLevel, costWon: p.costWon, paidWon: p.costWon - unpaid(p), start: p.start, end: p.end, started: diffDays(meta.currentDate, p.start) >= 0, payments: p.payments.map((x) => ({ date: x.date, amountWon: x.amountWon, paid: x.paid })) } : null,
      };
    });
    return {
      date: meta.currentDate,
      club: { name: club.name, capacity: club.stadiumCapacity },
      cashWon: this.repo.cashBalance(club.id),
      startCashWon: club.startCash,
      committedWon: f.projects.reduce((a, p) => a + unpaid(p), 0),
      startAp: FACILITY.startAp,
      ticket: {
        policy,
        priceWon: Math.round(ATTENDANCE.ticketPriceWon * inflation * ATTENDANCE.policy[policy].price),
        options: (Object.keys(ATTENDANCE.policy) as TicketPolicy[]).map((key) => ({ key, label: ATTENDANCE.policy[key].label, priceWon: Math.round(ATTENDANCE.ticketPriceWon * inflation * ATTENDANCE.policy[key].price), demand: ATTENDANCE.policy[key].demand })),
      },
      seasons,
      facilities,
      fans: (() => {
        const fan = this.fanOf(meta, club.id);
        return { satisfaction: fan.satisfaction, backlash: fan.satisfaction < MARKETING.backlashBelow, lowSince: fan.lowSince ?? null, dismissDate: fan.lowSince ? addDays(fan.lowSince, MARKETING.dismissWeeks * 7) : null, recoverAt: MARKETING.recoverAt, press: meta.press?.[String(club.id)] ?? EVENTS.pressStart };
      })(),
      campaignAp: MARKETING.campaignAp,
      campaigns: CAMPAIGN_KINDS.map((kind) => {
        const def = MARKETING.campaigns[kind];
        const active = (meta.campaigns?.[String(club.id)] ?? []).find((c) => c.kind === kind && diffDays(meta.currentDate, c.end) <= 0) ?? null;
        let startReason: string | null = null;
        try {
          this.campaignTarget(meta, kind);
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
          startReason = e.message;
        }
        return { kind, label: def.label, weeks: def.weeks, costWon: Math.round((def.costWon * inflation) / 1_000_000) * 1_000_000, demandPct: Math.round(def.demand * 100), satisfaction: def.satisfaction, active: active ? { start: active.start, end: active.end } : null, startReason };
      }),
    };
  }
}
