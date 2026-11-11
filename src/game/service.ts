import { createSnapshot, currentRatings, snapshotRanges, SCOUTING, type ScoutingSnapshot } from '../engine/scouting';
// 게임 진행: 사용자 명령 검증·처리와 조회. 엔진 규칙을 호출하고 결과를 저장 계층에 반영한다.
import { addDays, ageOn, diffDays, mondayOf, weekday, type GameDate } from '../engine/calendar';
import { CLUB_PROFILES, SEASON_2026_STANDINGS } from '../engine/clubs';
import { STANCE_LABEL } from '../engine/aiClub';
import { AI_CLUB, LIVE, FOREIGN, HEALTH, INFLATION, LEAGUE, NEW_GAME, ROSTER_COMPOSITION, ROSTER_MOVE, RULES_VERSION, CONTRACT, TRADE, TRAINING } from '../engine/config';
import { compensationFor, foreignRenewalDemandUsd, offerTotal, wonToUsd, type ContractOffer } from '../engine/contracts';
import { CATEGORY_LABEL, FINANCE_BASE, NOT_YET_IMPLEMENTED, scheduledEntries, stadiumFee, type LedgerEntry } from '../engine/finance';
import { battingSideOf, countModelVersion, createGame, directiveError, mergeOwner, OwnerPause, runGame, simulateGame, type Directive, type GameResult, type GameState, type OffensePlay, type OwnerControl, type OwnerPoint, type OwnerPrePa } from '../engine/gamesim';
import { canPlay, type CountTactic } from '../engine/tactics';
import { leverage, winProbability, winTableVersion } from '../engine/winProb';
import { ratingBonus } from '../engine/manager';
import { NORMAL_ALIGNMENT } from '../engine/zone';
import { prepareTeam, type GamePlan } from '../engine/lineup';
import { rosterCounts } from '../engine/roster';
import { EOK } from '../engine/money';
import { observePlayer } from '../engine/observation';
import { weeklyAp, xpToNext } from '../engine/owner';
import { Rng, stableNormal, type RngState } from '../engine/rng';
import { seasonAdjustment } from '../engine/leagueCalibration';
import { NEUTRAL_ENVIRONMENT, nextEnvironmentDeviation } from '../engine/probability';
import { PROBABILITY_CONFIG } from '../engine/probabilityConfig';
import { generateSchedule, seasonKeyDates, validateSchedule } from '../engine/schedule';
import { battingRates, fipConstant, formatInnings, pitchingRates, type BattingTotals, type PitchingTotals } from '../engine/stats';
import { computeStandings } from '../engine/standings';
import { ABILITY_LABEL, TASK_WP, teamCapacity, teamDef, TEAMS, type StaffMember, type TeamKey } from '../engine/staff';
import { seasonModeStart, stoveEvents } from '../engine/stove';
import type { ClubId, ClubProfile, Fixture, PlayerTruth, TrainingIntensity } from '../engine/types';
import { clubHistory } from '../engine/data/history';
import { generateHistory } from '../engine/history';
import { asTruth, generateAmateurs } from '../engine/amateur';
import { assignFaCandidates, generateDomesticFreePool, generateOverseasPool, generateWorld } from '../engine/worldgen';
import { Achievements } from './achievements';
import { Market } from './market';
import { FormTracker } from './formTracker';
import { fieldingLine, Records } from './records';
import { Draft, draftDate, isSenior } from './draft';
import { CLOSE_RULES, SeasonClose } from './seasonClose';
import { exhibitionDates, RosterOps } from './rosterOps';
import { Growth } from './growth';
import { TrainingOps } from './training';
import { TradeOps } from './trade';
import { AiClubOps } from './aiClubs';
import { ManagerOps } from './managers';
import { MANAGER_KEYS, MANAGER_LABEL } from '../engine/manager';
import { CareerOps } from './career';
import { BusinessOps } from './business';
import { SponsorOps } from './sponsors';
import { MerchOps } from './merch';
import type { Sku, VendorKind } from '../engine/merch';
import type { CampaignKind, FacilityKind, TicketPolicy } from '../engine/business';
import { HealthOps } from './health';
import { DEV_LABEL, devSnapshot, VELOCITY } from '../engine/development';
import { Postseason, POSTSEASON_MAX_INNINGS, SERIES_LABEL } from './postseason';
import { DELEGABLE_TEAMS, directWpCost, ORG_AP, Organization } from './organization';
import { weekIdFor } from './week';
import {
  GameError,
  type BoxScoreView,
  type CalendarEventView,
  type ClubOption,
  type ClubRef,
  type ContractOfferView,
  type ForeignPlayerView,
  type FaRowView,
  type MarketView,
  type OfferResultView,
  type SalaryTalkView,
  type DashboardView,
  type FinanceView,
  type FixtureView,
  type InboxItemView,
  type NextGameView,
  type PlayerActionsView,
  type ClubView,
  type ClubNoteView,
  type RosterView,
  type GamePlanView,
  type PlayerActionView,
  type PlayerDetailView,
  type PlayerListItem,
  type PlayerQuery,
  type SeasonPhase,
  type StandingView,
  type TaskView,
  type DelegationPolicyView,
  type OrganizationView,
  type StaffView,
  type TeamView,
  type WorkTaskView,
  type PostseasonView,
  type DraftView,
  type ApprovalView,
  type TeamRecordsView,
  type TradePackageView,
  type TradePreviewView,
  type TradeResultView,
  type TradeOffersView,
  type TradeOfferResultView,
  type CareerView,
  type TradeView,
  type BusinessView,
  type LiveChoice,
  type LiveDecisionView,
  type LiveFeedItem,
  type LiveGameGameView,
  type LiveGameView,
} from '../shared/protocol';
import type { CalendarEvent, DayCommit, GameMeta, GameRepository, InboxMessage, StoredGame } from './ports';

export interface NewGameOptions {
  clubId: number;
  saveName: string;
  seed?: string;
  createdAt: string;
}

export interface AdvanceProgress {
  date: GameDate;
  daysProcessed: number;
  gamesPlayed: number;
}

export function clubOptions(): ClubOption[] {
  return CLUB_PROFILES.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    stadium: c.stadium,
    stadiumCapacity: c.stadiumCapacity,
    parentIndustry: c.parentIndustry,
    colors: c.colors,
    difficulty: c.difficulty,
    startCashWon: c.startCash,
    parentSupportWon: c.parentSupport,
    namingRightsWon: c.namingRights,
    marketSize: c.marketSize,
    loyalty: c.loyalty,
    strength: c.strength,
    lastSeason: lastSeasonText(c.id),
    ksTitles: (clubHistory(c.id)?.seasons.filter((x) => x.postseason === '한국시리즈 우승').length ?? 0) + (SEASON_2026_STANDINGS.find((x) => x.clubId === c.id)?.postseason === '한국시리즈 우승' ? 1 : 0),
    founded: clubHistory(c.id)?.firstSeason ?? null,
    primaryColor: c.primaryColor,
    secondaryColor: c.secondaryColor,
    shortName: c.shortName,
  }));
}

function lastSeasonText(clubId: number): string {
  const r = SEASON_2026_STANDINGS.find((x) => x.clubId === clubId);
  if (!r) return '';
  return `${r.rank}위 (${r.wins}승 ${r.losses}패 ${r.ties}무)${r.postseason ? ` · ${r.postseason}` : ''}`;
}

const TASK_STATUS_LABEL: Record<string, string> = { queued: '운영 중', waiting: '결재 대기', done: '완료', failed: '중단', cancelled: '취소' };

const won = (n: number) => `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억`;

export { weekIdFor };

function welcomeMessages(club: ClubProfile, players: PlayerTruth[], date: GameDate, staffPayroll: number): InboxMessage[] {
  const prev = SEASON_2026_STANDINGS.find((s) => s.clubId === club.id)!;
  const mine = players.filter((p) => p.clubId === club.id);
  const fa = mine.filter((p) => p.career.faEligible);
  const star = fa.find((p) => p.career.franchise);
  const payroll = mine.reduce((a, p) => a + p.salary, 0);
  const expectation = prev.rank <= 2 ? '우승' : prev.rank <= 5 ? '가을야구 그 이상' : prev.rank <= 8 ? '가을야구 복귀' : '반등의 기반 마련';
  const fixed = staffPayroll + stadiumFee(club) + FINANCE_BASE.generalAdmin + FINANCE_BASE.futuresOps + FINANCE_BASE.analysisScouting + FINANCE_BASE.teamOps + FINANCE_BASE.gameOps;
  const income = club.parentSupport + club.namingRights + FINANCE_BASE.broadcastLeagueTotal / 10 + FINANCE_BASE.kboShare;
  const owner = club.parentSupport > 0 ? '모기업 회장' : '투자자 대표';
  return [
    {
      date,
      kind: 'welcome',
      sender: owner,
      title: '취임을 축하합니다',
      body: `오늘 한국시리즈가 끝났습니다. ${club.name}은 2026 시즌을 ${prev.rank}위(${prev.wins}승 ${prev.losses}패 ${prev.ties}무)${prev.postseason ? `, ${prev.postseason}` : ''}로 마쳤습니다.\n2027 시즌에는 '${expectation}'을 기대합니다. 구체적인 목표는 1월 말 면담에서 함께 정하겠습니다.`,
    },
    {
      date,
      kind: 'report',
      sender: '단장',
      title: '선수단 현황 보고',
      body: `현재 보유 선수는 ${mine.length}명, 연봉 총액은 ${won(payroll)}입니다.\n이번 스토브리그에 FA 자격을 얻는 선수는 ${fa.length}명입니다: ${fa.map((p) => p.name).join(', ')}.\n${star ? `특히 간판 외야수 ${star.name} 선수의 거취가 가장 큰 현안입니다. FA 공시(11월 13일) 전에 면담해 보시길 권합니다.` : ''}`,
    },
    {
      date,
      kind: 'report',
      sender: '사업본부장',
      title: '재정 현황 보고',
      body: `현재 현금은 ${won(club.startCash)}입니다.\n정기 수입(모기업 지원·명명권·중계권료·KBO 배분금)은 연 약 ${won(income)}, 선수 연봉을 뺀 고정 지출은 연 약 ${won(fixed)}입니다. 선수 연봉은 2~11월에 나눠 지급합니다.\n입장·스폰서·굿즈 수입은 아직 집계 체계가 갖춰지지 않았습니다(다음 개발 단계).`,
    },
    {
      date,
      kind: 'task',
      sender: '비서',
      title: '스토브리그 안내',
      body: '스토브리그는 1주 단위로 진행합니다. 매주 이번 주 할 일과 리그 일정을 정리해 드리겠습니다.\n첫 주는 11월 8일(일)부터 15일(일)까지이고, 13일에 FA 자격 선수가 공시됩니다.\n화면 오른쪽 위의 [다음 주 진행]을 누르면 한 주가 지나갑니다.',
    },
  ];
}

/** 새 게임: 2026 한국시리즈 최종전 날(2026-11-08) 스토브리그에서 시작한다(D-061). */
export function createNewGame(repo: GameRepository, opts: NewGameOptions): void {
  const club = CLUB_PROFILES.find((c) => c.id === opts.clubId);
  if (!club) throw new GameError('INVALID_CLUB', '존재하지 않는 구단입니다.');
  const seed = opts.seed ?? `${opts.createdAt}-${opts.clubId}`;
  const worldRng = Rng.derive(seed, 'world');
  const players = generateWorld(worldRng, NEW_GAME.previousSeason);
  assignFaCandidates(Rng.derive(seed, 'fa-candidates'), players, opts.clubId);
  // 2026 시즌 계약 기준 연봉 스냅샷: 11월분 연봉은 이적과 관계없이 원래 구단이 지급한다.
  const salarySnapshot = Object.fromEntries(CLUB_PROFILES.map((c) => [String(c.id), players.filter((p) => p.clubId === c.id).map((p) => p.salary)]));
  players.push(...generateOverseasPool(Rng.derive(seed, 'overseas', NEW_GAME.previousSeason), NEW_GAME.previousSeason, players.length + 1));
  // 국내 미계약 선수 풀(D-098): 포지션 최소 인원 보충의 공급원
  players.push(...generateDomesticFreePool(Rng.derive(seed, 'free-pool', NEW_GAME.previousSeason), NEW_GAME.previousSeason, players.length + 1));
  const scheduleRng = Rng.derive(seed, 'schedule');
  const fixtures = generateSchedule(NEW_GAME.firstSeason, scheduleRng, 1);
  const problems = validateSchedule(fixtures, NEW_GAME.firstSeason);
  if (problems.length) throw new GameError('SCHEDULE_INVALID', `일정 생성 오류: ${problems.slice(0, 3).join(', ')}`);
  const kDate = NEW_GAME.startDate;
  const key = seasonKeyDates(NEW_GAME.firstSeason);
  const events: CalendarEvent[] = [
    ...stoveEvents(kDate),
    { date: key.opening, kind: 'opening', title: `${NEW_GAME.firstSeason} 정규시즌 개막`, body: '정규시즌이 개막합니다.' },
    { date: key.allStar, kind: 'allStar', title: '올스타전', body: '올스타전이 열립니다(기록 미반영).' },
    { date: key.regularSeasonEnd, kind: 'regularSeasonEnd', title: '정규시즌 종료', body: '정규시즌 마지막 날입니다.' },
  ];
  const ledger: LedgerEntry[] = CLUB_PROFILES.map((c) => ({ clubId: c.id, date: kDate, category: 'startCash', amount: c.startCash, memo: '게임 시작 시 보유 현금' }));
  const staff = Organization.generateAll(seed, CLUB_PROFILES.map((c) => c.id), NEW_GAME.previousSeason, kDate);
  const meta: GameMeta = {
    seed,
    season: NEW_GAME.previousSeason,
    mode: 'stove',
    currentDate: NEW_GAME.startDate,
    kDate,
    userClubId: opts.clubId,
    saveName: opts.saveName,
    createdAt: opts.createdAt,
    rulesVersion: RULES_VERSION,
    engineTables: { win: winTableVersion(), count: countModelVersion() },
    rngStreams: { world: worldRng.state(), schedule: scheduleRng.state(), business: Rng.derive(seed, 'business').state() },
    nextFixtureId: fixtures.length + 1,
    ownerLevel: 1,
    ownerXp: 0,
    inflationBp: {},
    salarySnapshot,
  };
  repo.initialize({
    meta,
    clubs: CLUB_PROFILES,
    players,
    fixtures,
    standings: SEASON_2026_STANDINGS,
    events,
    inbox: welcomeMessages(club, players, kDate, staff.filter((s) => s.clubId === club.id).reduce((a, s) => a + s.salary, 0)),
    ledger,
    apGrant: { weekId: weekIdFor(kDate), granted: weeklyAp(1), used: 0 },
    staff,
    history: generateHistory(seed, players, NEW_GAME.previousSeason),
    amateurs: generateAmateurs(seed, 1, NEW_GAME.firstSeason),
  });
}

export class GameService {
  private clubMap: Map<ClubId, ClubProfile>;
  readonly market: Market;
  readonly org: Organization;
  readonly achievements: Achievements;
  readonly records: Records;
  readonly postseason: Postseason;
  readonly draft: Draft;
  readonly seasonClose: SeasonClose;
  readonly rosterOps: RosterOps;
  readonly growth: Growth;
  readonly health: HealthOps;
  readonly training: TrainingOps;
  readonly trades: TradeOps;
  readonly aiClubs: AiClubOps;
  readonly managers: ManagerOps;
  readonly career: CareerOps;
  readonly business: BusinessOps;
  readonly sponsors: SponsorOps;
  readonly merch: MerchOps;
  /** 성적 혼합 표본(3b): 저장본에서 다시 만들 수 있는 메모리 캐시 */
  private readonly forms: FormTracker;
  private scouting = new Map<number, ScoutingSnapshot>();
  private ensureScouting(): void {
    const meta = this.meta();
    for (const p of this.repo.getPlayers()) if (!this.scouting.has(p.id)) {
      const snapshot = createSnapshot(meta.seed, meta.userClubId, p, meta.currentDate, '기초 자료', 1);
      this.repo.saveScouting(snapshot);
      this.scouting.set(p.id, snapshot);
    }
  }

  savePlayerNote(playerId: number, text: string, watched: boolean, updatedAt: string) {
    if (!this.repo.getPlayer(playerId)) throw new GameError('PLAYER_NOT_FOUND', '선수를 찾을 수 없습니다.');
    if (typeof text !== 'string' || text.length > 2000 || typeof watched !== 'boolean') throw new GameError('INVALID_NOTE', '메모는 2,000자 이내의 텍스트여야 합니다.');
    const note = { text, watched, updatedAt };
    this.repo.savePlayerNote(playerId, note);
    return note;
  }

  scoutPlayer(playerId: number): PlayerDetailView {
    const meta = this.meta();
    const p = this.repo.getPlayer(playerId);
    if (!p || p.retired) throw new GameError('PLAYER_NOT_FOUND', '조사할 수 있는 선수가 아닙니다.');
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임에서는 조사할 수 없습니다.');
    const previous = this.scouting.get(playerId)!;
    if (previous.confidence > 0 && diffDays(meta.currentDate, previous.date) < SCOUTING.cooldownDays) throw new GameError('DUPLICATE_EVIDENCE', '새 자료가 부족합니다. 다음 조사 가능일을 확인하세요.');
    const staff = this.repo.getStaff(meta.userClubId).filter(s => s.team === 'scout');
    if (staff.length === 0) throw new GameError('NO_SCOUT', '스카우트팀 직원이 필요합니다.');
    const observer = staff.find(s => s.title === '팀장') ?? staff[0]!;
    const snapshot = createSnapshot(meta.seed, meta.userClubId, p, meta.currentDate, observer.name, this.org.scoutingScale(meta), previous);
    this.repo.transaction(() => {
      this.repo.spendAp(weekIdFor(meta.currentDate), SCOUTING.ap);
      this.org.charge(meta, { kind: 'direct', weekId: weekIdFor(meta.currentDate) }, 'scout', SCOUTING.wp);
      this.repo.saveScouting(snapshot);
    });
    this.scouting.set(playerId, snapshot);
    return this.player(playerId);
  }

  constructor(private readonly repo: GameRepository) {
    this.forms = new FormTracker(repo);
    this.scouting = new Map(repo.getScouting(repo.getMeta().userClubId).map(s => [s.playerId, s]));
    this.clubMap = new Map(repo.getClubs().map((c) => [c.id, c]));
    this.market = new Market(repo, this.clubMap, (source, team, wp) => this.org.charge(this.meta(), source, team, wp), (id) => this.aiClubs.stance(id));
    this.org = new Organization(repo, this.market);
    this.achievements = new Achievements(repo);
    this.postseason = new Postseason(repo);
    this.draft = new Draft(repo);
    this.seasonClose = new SeasonClose(repo, this.draft);
    this.rosterOps = new RosterOps(repo, this.forms);
    this.growth = new Growth(repo);
    this.business = new BusinessOps(repo, this.clubMap);
    // 6a 시설 효과(D-141): 재활센터 → 메디컬 역량, 실내 훈련장 → 집중 훈련 효과
    // 4c-2b(D-172): 감독 컨디션 관리(경기 사이 피로)·육성(집중 훈련 효과)
    this.managers = new ManagerOps(repo, this.clubMap, this.seasonClose);
    this.health = new HealthOps(repo, this.rosterOps, (id) => Math.min(1, this.org.medicalQuality(id) + this.business.rehabBoost(id)), (id) => this.managers.conditionFactor(id));
    this.training = new TrainingOps(repo, this.org, (id) => this.business.trainingBoost(id) * this.managers.developmentFactor(id));
    this.sponsors = new SponsorOps(repo, this.clubMap, this.org, this.business);
    this.merch = new MerchOps(repo, this.clubMap, this.org, this.business);
    this.trades = new TradeOps(repo, this.org, this.rosterOps, (id) => this.aiClubs.stance(id));
    // 7a(D-155): AI 구단 운영 상태·긴축·AI 간 트레이드
    this.aiClubs = new AiClubOps(repo, this.clubMap, this.trades, () => this.stanceRanks());
    this.business.austere = (id) => this.aiClubs.stance(id) === 'austerity';
    this.career = new CareerOps(repo, this.clubMap, () => this.stanceRanks());
    this.records = new Records(repo, (id) => this.clubMap.get(id)?.shortName ?? `#${id}`);
    // 2b 저장본: 직원이 없으면 시드로 만든다. 이번 주 처리량이 없으면 지급한다.
    repo.transaction(() => {
      const meta = this.meta();
      this.org.ensureStaff(meta, [...this.clubMap.keys()]);
      this.org.ensureWeek(meta, weekIdFor(meta.currentDate));
      this.ensureScouting();
      this.aiClubs.ensure(meta);
      // 2c 저장본: 시작 이전 기록이 없으면 시드로 만든다(D-079).
      if (repo.countHistory() === 0) repo.insertHistory(generateHistory(meta.seed, repo.getPlayers(), NEW_GAME.previousSeason));
      // 2c 이전 저장본: 고교·대학 선수 풀이 없으면 시드로 만든다(D-084).
      if (repo.getAmateurs().length === 0) repo.saveAmateurs(generateAmateurs(meta.seed, 1, meta.mode === 'stove' ? meta.season + 1 : meta.season));
    });
  }

  meta(): GameMeta {
    return this.repo.getMeta();
  }

  /** 일정·기록에 쓰는 시즌 연도: 스토브리그에는 다가오는 시즌의 일정을 보여준다. */
  private scheduleSeason(meta: GameMeta): number {
    return meta.mode === 'stove' ? meta.season + 1 : meta.season;
  }

  phase(meta = this.meta()): SeasonPhase {
    if (meta.mode === 'stove') return 'stove';
    const key = seasonKeyDates(meta.season);
    if (diffDays(meta.currentDate, key.opening) < 0) return 'preseason';
    if (diffDays(meta.currentDate, key.regularSeasonEnd) <= 0) return 'regular';
    // 정규시즌 뒤: 한국시리즈가 끝나기 전까지 포스트시즌
    const ps = this.postseason.state(meta);
    return ps && ps.champion === null ? 'postseason' : 'seasonComplete';
  }

  phaseLabel(meta = this.meta()): string {
    const p = this.phase(meta);
    if (p === 'stove') return `${meta.season} 스토브리그`;
    if (p === 'preseason') return `${meta.season} 시즌 준비(스프링캠프)`;
    if (p === 'regular') return `${meta.season} 정규시즌`;
    if (p === 'postseason') return `${meta.season} 포스트시즌`;
    return `${meta.season} 시즌 종료`;
  }

  /** 하루 처리: 일정 사건 → 경기 → 정기 수입·지출 → 다음 날 준비(모드 전환·행동력 지급). 하나의 트랜잭션으로 반영된다. */
  advanceOneDay(): { gamesPlayed: number } {
    const meta = this.meta();
    const phase = this.phase(meta);
    if (meta.gameOver) throw new GameError('GAME_OVER', `${meta.gameOver.kind === 'dismissed' ? '해임' : '파산'}: ${meta.gameOver.reason}`);
    if (phase === 'seasonComplete') {
      throw new GameError('SEASON_COMPLETE', '시즌이 끝났습니다.');
    }
    const date = meta.currentDate;
    if (this.repo.isDayProcessed(date)) throw new GameError('DAY_ALREADY_PROCESSED', `${date}는 이미 처리된 날짜입니다.`);
    // 선수 시장 처리와 하루 결과는 하나의 트랜잭션으로 반영한다.
    try { return this.repo.transaction(() => this.processDay(meta, date)); }
    catch (error) {
      this.scouting = new Map(this.repo.getScouting(meta.userClubId).map(s => [s.playerId, s]));
      throw error;
    }
  }

  private processDay(meta: GameMeta, date: GameDate): { gamesPlayed: number } {
    const { inbox, market, ai, extraMeta } = this.dayPrelude(meta, date);
    // 2) 경기 (정규시즌)
    const results: GameResult[] = [];
    const inputs = this.gameInputs(meta, date);
    let livePoints: { games: number; points: number } | null = null;
    for (const f of inputs.fixtures) {
      // 4c-3(D-174): 우리 경기는 구단주 참여 기록을 쓰고(없는 결정은 감독 추천대로), 참여 지점 수를 센다
      const owner = this.ownerControl(meta, f.id, f.home, f.away, false);
      const r = simulateGame(...inputs.args(f, owner));
      if (owner) livePoints = { games: 1, points: r.ownerPoints };
      results.push(r);
    }
    if (livePoints || meta.liveGame) {
      const key = String(meta.season);
      const cur = meta.liveStats?.[key] ?? { games: 0, points: 0 };
      if (livePoints) extraMeta.liveStats = { ...(meta.liveStats ?? {}), [key]: { games: cur.games + 1, points: cur.points + livePoints.points } };
      extraMeta.liveGame = null;
    }
    return this.finishDay(meta, date, inbox, market, ai, extraMeta, results, inputs.fixtures);
  }

  /** 하루 처리의 경기 전 단계(일정 사건·시장·조직·운영 상태·성장·건강·개막·시범경기). 관전 미리보기도 같은 단계를 거친다 */
  private dayPrelude(meta: GameMeta, date: GameDate) {
    // 1) 일정 사건 → 리그 소식, 선수 시장(FA·연봉 협상·외국인·명단 정리)
    const inbox: InboxMessage[] = this.repo.getCalendarEvents(date, date).map((e) => ({ date, kind: 'news', sender: 'KBO 소식', title: e.title, body: this.eventBody(e, meta) }));
    const market = this.market.onDay(date, meta);
    inbox.push(...market.inbox);
    // 위임 업무 큐(운영팀·경영지원팀): 시장 처리(월요일 AI 제안) 뒤에 같은 도메인 로직으로 실행한다.
    inbox.push(...this.org.onDay(meta, date));
    // 7a(D-155): 매월 1일 운영 상태 재평가·긴급 지원, 월요일 AI 구단 간 트레이드(경기·급여 계산 전에 소속을 바꾼다)
    const ai = this.aiClubs.onDay(this.meta(), date);
    inbox.push(...ai.inbox);
    // 4a 성장·노화 월간 반영(D-123): 시즌 3~10월 1일, 그날 경기 전에 반영한다.
    inbox.push(...this.growth.monthly(meta, date, (players) => this.training.strengths(date, players)));
    // 4b-1 건강(D-126): 복귀·1군 건강 인원 확보·휴식 지시 정리·주간 건강 보고(경기 전)
    inbox.push(...this.health.beforeGames(meta, date));

    // 개막일: 그 시점 1군을 개막 엔트리로 알린다(2d, D-120).
    const opening = this.rosterOps.openingNotice(meta, date);
    if (opening) inbox.push(opening);
    // 시범경기(2d, D-120): 정규 기록·표본·피로·순위와 분리해 점수와 우리 선수 기록만 남긴다.
    const extraMeta: Partial<GameMeta> = {};
    const exhibition = this.rosterOps.playExhibition(meta, date, meta.leagueEnvironment?.[String(meta.season)] ?? NEUTRAL_ENVIRONMENT, this.health.unavailableOn(this.meta(), date, this.repo.getPlayers()));
    if (exhibition) {
      Object.assign(extraMeta, exhibition.update);
      inbox.push(...exhibition.inbox);
    }
    return { inbox, market, ai, extraMeta };
  }

  /** 그날 경기 입력(하루 처리와 관전 미리보기 공용): 경기마다 simulateGame 인자를 만든다 */
  private gameInputs(meta: GameMeta, date: GameDate) {
    const fixtures = meta.mode === 'season' ? this.repo.getFixturesOn(date) : [];
    const none = { fixtures, args: (_f: Fixture, _o?: OwnerControl): Parameters<typeof simulateGame> => { throw new Error('경기 없음'); } };
    if (fixtures.length === 0) return none;
    {
      const clubIds = fixtures.flatMap((f) => [f.home, f.away]);
      const active = this.repo.getActivePlayers(clubIds);
      const usage = this.repo.getRecentPitcherUsage(addDays(date, -6), date).map((u) => ({ ...u, daysAgo: diffDays(date, u.date) }));
      const lastStarters = this.repo.getLastStarters(meta.season);
      const env = meta.leagueEnvironment?.[String(meta.season)] ?? NEUTRAL_ENVIRONMENT;
      // 최근·과거 성적 표본(10a 4·7장): 그날 모든 경기에 전날까지의 기록으로 한 번에 고정한다.
      const forms = this.forms.formsFor(meta.season, date, active, env);
      // 우리 구단 수동 운영 계획(2d): 감독 자동 운영과 같은 경기 준비 로직이 읽는다.
      const userPlan = this.rosterOps.activePlan(meta);
      // 4b-1: 부상·휴식 선수 제외, 감독 자동 운영은 피로 높은 야수 휴식
      const out = this.health.unavailableOn(this.meta(), date, active);
      const tired = this.health.tiredOn(date, active);
      // 4c-2b(D-172): 감독 능력치·성향·신뢰도를 경기에 넘긴다
      const teamOf = (clubId: ClubId) => ({ ...prepareTeam(clubId, active.filter((p) => p.clubId === clubId), usage, lastStarters.get(clubId) ?? null, clubId === meta.userClubId ? userPlan : null, ROSTER_MOVE.rotationSize, { out, tired }), manager: this.managers.profileOf(clubId) });
      const args = (f: Fixture, owner?: OwnerControl): Parameters<typeof simulateGame> => {
        // 경기 난수는 (시드, 경기 ID)에서 파생한다. 처리 순서와 무관하게 같은 경기는 같은 결과를 낸다.
        const maxInnings = f.stage && f.stage !== 'regular' ? POSTSEASON_MAX_INNINGS : LEAGUE.regularSeasonMaxInnings;
        const postseason = !!f.stage && f.stage !== 'regular';
        return [f.id, teamOf(f.home), teamOf(f.away), Rng.derive(meta.seed, 'game', f.id), maxInnings, env, { forms, postseason, ...(owner ? { owner } : {}) }];
      };
      return { fixtures, args };
    }
  }

  /** 4c-3(D-174): 우리 경기의 구단주 참여 제어. 관전 기록이 그날 그 경기 것이면 기록된 지시를 돌려준다 */
  private ownerControl(meta: GameMeta, fixtureId: number, home: ClubId, away: ClubId, pause: boolean): OwnerControl | undefined {
    if (home !== meta.userClubId && away !== meta.userClubId) return undefined;
    const live = meta.liveGame && meta.liveGame.date === meta.currentDate && meta.liveGame.fixtureId === fixtureId ? meta.liveGame : null;
    return {
      clubId: meta.userClubId,
      enabled: meta.liveSettings?.participate ?? true,
      maxPerGame: LIVE.maxPerGame,
      prePa: (k) => live?.prePa[String(k)],
      count: (s, b, st) => live?.count[`${s}:${b}:${st}`],
      pauseWhenMissing: pause,
    };
  }

  private finishDay(meta: GameMeta, date: GameDate, inbox: InboxMessage[], market: ReturnType<Market['onDay']>, ai: { ledger: LedgerEntry[]; inbox: InboxMessage[] }, extraMeta: Partial<GameMeta>, results: GameResult[], fixtures: Fixture[]): { gamesPlayed: number } {
    // 4c-2b(D-163): 경기의 감독 결정으로 신뢰도·팀 기준선 갱신
    this.managers.afterGames(date, results);

    // 3) 정기 수입·지출 (모든 구단)
    const players = this.repo.getPlayers();
    const obligations = this.repo.getObligations().filter((o) => o.seasons.includes(meta.season));
    // 직원 급여는 월말에만 지급하므로 그날만 합계를 낸다.
    const staffPayroll = addDays(date, 1).slice(8, 10) === '01' ? this.org.payrollByClub() : new Map<ClubId, number>();
    const ledger: LedgerEntry[] = [...market.ledger, ...ai.ledger];
    // 6a(D-141): 정규시즌 홈경기 관중·입장수입·매점·관람료, 시설 공사 지급·완공·유지비·AI 투자
    ledger.push(...this.business.onGames(meta, date, fixtures, results));
    const biz = this.business.onDay(this.meta(), date);
    ledger.push(...biz.ledger);
    inbox.push(...biz.inbox);
    // 6c(D-149): 스토브리그 스폰서 제안 도착·AI 선택·기본 계약
    const sp = this.sponsors.onDay(this.meta(), date);
    ledger.push(...sp.ledger);
    inbox.push(...sp.inbox);
    // 6d(D-153): 굿즈 입고·판매(홈경기·온라인)·자동 재주문
    const mc = this.merch.onDay(this.meta(), date);
    ledger.push(...mc.ledger);
    inbox.push(...mc.inbox);
    for (const club of this.clubMap.values()) {
      ledger.push(
        ...scheduledEntries({
          date,
          seasonYear: meta.season,
          inflationBp: meta.inflationBp,
          club: this.supportAdjusted(meta, club),
          // 스토브리그 중(11월분)은 시즌 종료 시점 계약 기준으로 지급한다.
          salaries: meta.mode === 'stove' ? (meta.salarySnapshot[String(club.id)] ?? []) : players.filter((p) => p.clubId === club.id).map((p) => p.salary),
          releasedSalaries: obligations.filter((o) => o.clubId === club.id).map((o) => o.salary),
          homeGamesToday: results.filter((r) => r.home === club.id).length,
          staffPayroll: staffPayroll.get(club.id) ?? 0,
        }),
      );
    }

    // 4) 다음 날 준비: 시즌 모드 전환, 새 주 행동력
    const next = addDays(date, 1);
    const metaUpdate: Partial<GameMeta> = { ...extraMeta, currentDate: next };
    if (meta.mode === 'stove' && next === seasonModeStart(Number(meta.kDate.slice(0, 4)))) {
      const season = meta.season + 1;
      const business = new Rng(meta.rngStreams.business as RngState);
      const rate = INFLATION.minBp + business.int(0, INFLATION.maxBp - INFLATION.minBp);
      metaUpdate.mode = 'season';
      metaUpdate.season = season;
      metaUpdate.inflationBp = { ...meta.inflationBp, [String(season)]: rate };
      metaUpdate.rngStreams = { ...meta.rngStreams, business: business.state() };
      this.market.onSeasonStart();
      // 2d: 감독 추천 1군 = 개막 엔트리 초안, 이동 기록·시범경기 초기화, 수동 계획 보정(D-120)
      const camp = this.rosterOps.onSeasonStart(meta, season, next);
      // 4b-2: AI 구단 육성팀 집중 훈련 계획(D-128)
      this.training.planAi(meta, next);
      Object.assign(metaUpdate, camp.update);
      inbox.push(...camp.inbox);
      // 지난 시즌 상세 기록 압축(D-106): 새 시즌이 시작될 때 직전 시즌의 원시 기록을 시즌 합계로 바꾼다.
      this.repo.compressSeason(meta.season);
      // 성적 기본 목표: 시즌 모드 시작 때 예상 순위로 고정한다(02 문서).
      const expectedRank = this.seasonClose.expectedRank(meta, meta.userClubId, season);
      metaUpdate.seasonGoal = { season, expectedRank };
      // 시즌 리그 환경(D-100): 첫 시즌은 기준값, 이후 직전 시즌 편차에서 −5%p·0·+5%p(±10% 안, 비누적)
      const prevEnv = meta.leagueEnvironment?.[String(season - 1)];
      const envRng = Rng.derive(meta.seed, 'league-env', season);
      const deviation = prevEnv ? { runs: nextEnvironmentDeviation(prevEnv.runs, envRng.int(0, 2)), hr: nextEnvironmentDeviation(prevEnv.hr, envRng.int(0, 2)) } : { runs: 0, hr: 0 };
      // 시즌 리그 기준 재조정(D-103): 방금 짠 1군으로 모의 경기를 돌려 그 시즌 목표에 맞춘다(능력치는 바꾸지 않음).
      const active = new Map<ClubId, PlayerTruth[]>();
      for (const p of this.repo.getPlayers()) if (p.clubId !== null && p.level === '1군') active.set(p.clubId, [...(active.get(p.clubId) ?? []), p]);
      const env = seasonAdjustment(active, meta.seed, season, deviation);
      metaUpdate.leagueEnvironment = { ...(meta.leagueEnvironment ?? {}), [String(season)]: env };
      metaUpdate.engineTables = { win: winTableVersion(), count: countModelVersion() };
      const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
      const target = PROBABILITY_CONFIG.leagueTarget;
      inbox.push({ date: next, kind: 'news', sender: 'KBO 소식', title: `${season} 시즌 리그 환경: 득점 ${pct(env.runs)}, 홈런 ${pct(env.hr)}`, body: `올해 리그는 기준(경기당 득점 ${target.runsPerGame}, 타석당 홈런 ${target.hrPerPa}) 대비 득점 ${pct(env.runs)}, 홈런 ${pct(env.hr)} 수준의 환경으로 예상됩니다. 공인구·스트라이크 존 같은 리그 조건 변화를 요약한 값이며, 기준 대비 ±10%를 넘지 않습니다.\n올해 1군 선수 구성으로 리그 기준을 다시 맞췄습니다(보정 전 예상: 경기당 ${env.measuredRunsPerGame}득점, 타석당 홈런 ${env.measuredHrPerPa}).` });
      inbox.push({ date: next, kind: 'task', sender: '모기업', title: `${season} 시즌 목표: 정규시즌 ${expectedRank}위 이내`, body: `직전 시즌 순위와 전력 평가로 정한 예상 순위입니다. 달성하면 구단주 경험치를 받고, ${CLOSE_RULES.warnAfterMisses}시즌 연속 미달이면 지원 삭감 경고, ${CLOSE_RULES.dismissAfterMisses}시즌 연속이면 해임입니다.` });
      inbox.push({ date: next, kind: 'report', sender: '사업본부장', title: `${season} 시즌 물가 상승률 ${(rate / 100).toFixed(2)}%`, body: `올해 비용·가격·시세 기준값이 ${(rate / 100).toFixed(2)}% 올랐습니다. 이미 맺은 계약 금액은 바뀌지 않습니다.` });
    }
    const nextWeek = weekIdFor(next);
    const apGrant = weekday(next) === 1 && !this.repo.getApWeek(nextWeek) ? { weekId: nextWeek, granted: weeklyAp(meta.ownerLevel), used: 0 } : null;
    if (weekday(next) === 1) this.org.ensureWeek(meta, nextWeek, metaUpdate.mode ?? meta.mode);

    const commit: DayCommit = { results, ledger, inbox, apGrant, metaUpdate };
    this.repo.commitDay(date, commit);
    // 4b-1 부상 판정(D-126): 그날 경기 기록이 저장된 뒤 출전 선수마다 한 번
    this.repo.addInbox(this.health.afterGames(this.meta(), date, results));
    // 포스트시즌: 정규시즌 마지막 날 대진 확정, 이후 경기 결과로 시리즈 진행(같은 트랜잭션)
    if (meta.mode === 'season') {
      const now = this.meta();
      if (date === seasonKeyDates(meta.season).regularSeasonEnd && !this.postseason.state(now)) {
        const b = this.postseason.begin(now);
        const counts = this.repo.countFixtures(meta.season);
        const regularSeasons = { ...(now.regularSeasons ?? {}), [String(meta.season)]: { ...counts, endDate: date } };
        this.repo.updateMeta({ postseason: b.state, nextFixtureId: b.nextFixtureId, regularSeasons });
        this.repo.addInbox(b.inbox);
      } else if (results.length) {
        const u = this.postseason.onResults(now, date, results);
        if (u) {
          this.repo.updateMeta({ postseason: u.state, nextFixtureId: u.nextFixtureId });
          this.repo.addInbox(u.inbox);
        }
      }
    }
    // 신인 드래프트: 정규시즌 종료 다음 월요일(07 문서)
    if (meta.mode === 'season' && date === draftDate(meta.season)) {
      const now = this.meta();
      this.repo.addInbox(this.draft.run(now, date, now.draftBoard ?? [], this.org.scoutingScale(now)));
    }
    // 업적 판정은 같은 트랜잭션 안에서 기록한다(경험치는 그날 처리 뒤 메타에 반영).
    const fresh = this.meta();
    this.achievements.onDay({ ...meta, ownerLevel: fresh.ownerLevel, ownerXp: fresh.ownerXp, postseason: fresh.postseason }, date, results);
    // 한국시리즈가 끝난 날: 시즌 마감 → 스토브리그 (D-085)
    const after = this.meta();
    if (meta.mode === 'season' && after.postseason?.season === meta.season && after.postseason.finishedDate === date) {
      // 4a 연간 성장·노화(D-124): 시즌 마감 직전 1회
      this.repo.addInbox(this.growth.annual(after, date));
      // 6c 스폰서 시즌 마감 정산(D-149): 인센티브·의무 반환, 계약 종료
      this.repo.addInbox(this.sponsors.settleSeason(this.meta(), date));
      // 4c-2b(D-163·D-166): 감독 신뢰도 되돌림·AI 구단 감독 교체
      this.repo.addInbox(this.managers.closeSeason(this.meta(), date));
      this.seasonClose.close(after, date);
    }
    // 은퇴 설득 기한·파산 감시
    this.seasonClose.onDay(this.meta(), date);
    this.ensureScouting();
    return { gamesPlayed: results.length };
  }

  private eventBody(e: CalendarEvent, meta: GameMeta): string {
    if (e.kind !== 'faNotice') return e.body;
    const fa = this.repo.getPlayers().filter((p) => p.career.faEligible && p.clubId !== null);
    const mine = fa.filter((p) => p.clubId === meta.userClubId);
    const lines = [...this.clubMap.values()].map((c) => `· ${c.shortName}: ${fa.filter((p) => p.clubId === c.id).map((p) => p.name).join(', ') || '없음'}`);
    return `${e.body}\n우리 구단 대상: ${mine.map((p) => `${p.name}${p.career.franchise ? '(간판 외야수)' : ''}`).join(', ') || '없음'}\n${lines.join('\n')}\n선수들은 이틀 안에 FA 신청 여부를 정하고, FA 시장이 열리면 [계약·이적] 화면에서 협상할 수 있습니다.`;
  }

  /** 진행. 스토브리그는 1주 단위만(D-062). 시즌은 1일·1주·정규시즌 끝까지. */
  advance(mode: 'day' | 'week' | 'untilSeasonEnd', onProgress?: (p: AdvanceProgress) => void, shouldStop?: () => boolean) {
    const start = this.meta();
    if (start.mode === 'stove' && mode !== 'week') throw new GameError('STOVE_WEEKLY_ONLY', '스토브리그는 1주 단위로 진행합니다.');
    let daysProcessed = 0;
    let gamesPlayed = 0;
    let stoppedReason: string | null = null;
    const startWeek = weekIdFor(start.currentDate);
    const startPhase = this.phase();
    while (this.phase() !== 'seasonComplete') {
      const before = this.meta();
      const { gamesPlayed: g } = this.advanceOneDay();
      daysProcessed++;
      gamesPlayed += g;
      const after = this.meta();
      onProgress?.({ date: after.currentDate, daysProcessed, gamesPlayed });
      // 진행 중에 해임·파산이 확정되면 그날에서 멈추고 이유를 돌려준다(다음 진행 요청은 GAME_OVER로 거부)
      if (after.gameOver) {
        stoppedReason = `${after.gameOver.kind === 'dismissed' ? '해임' : '파산'}: ${after.gameOver.reason}`;
        break;
      }
      if (before.mode !== after.mode) {
        stoppedReason = after.mode === 'stove' ? `${before.season} 시즌 종료 — 스토브리그 시작` : '스토브리그 종료 — 시즌 모드 시작';
        break;
      }
      if (mode === 'untilSeasonEnd' && startPhase !== 'postseason' && this.phase() === 'postseason') {
        stoppedReason = `정규시즌 종료 (${seasonKeyDates(after.season).regularSeasonEnd}) — 포스트시즌 대진 확정`;
        break;
      }
      if (mode === 'day') break;
      if (mode === 'week' && weekday(after.currentDate) === 1 && weekIdFor(after.currentDate) !== startWeek) break;
      if (shouldStop?.()) {
        stoppedReason = '중단 요청';
        break;
      }
    }
    if (this.phase() === 'seasonComplete' && !stoppedReason) stoppedReason = `${this.meta().season} 시즌 종료 (한국시리즈 끝)`;
    return { daysProcessed, gamesPlayed, stoppedReason };
  }

  /** ASSUMPTION(D-056, 임시): 포스트시즌·스토브리그 없이 다음 시즌 정규시즌을 시작한다. 장기 데이터 검증용. 건너뛴 기간의 수입·지출은 처리되지 않는다. */
  startNextSeason(): void {
    const meta = this.meta();
    if (this.phase(meta) !== 'seasonComplete') throw new GameError('SEASON_NOT_COMPLETE', '한국시리즈가 끝난 뒤에만 다음 시즌을 시작할 수 있습니다.');
    const season = meta.season + 1;
    const scheduleRng = new Rng(meta.rngStreams.schedule as RngState);
    const fixtures = generateSchedule(season, scheduleRng, meta.nextFixtureId);
    const problems = validateSchedule(fixtures, season);
    if (problems.length) throw new GameError('SCHEDULE_INVALID', `일정 생성 오류: ${problems.slice(0, 3).join(', ')}`);
    const business = new Rng(meta.rngStreams.business as RngState);
    const rate = INFLATION.minBp + business.int(0, INFLATION.maxBp - INFLATION.minBp);
    this.repo.addFixtures(fixtures, {
      season,
      currentDate: seasonKeyDates(season).openingWeekMonday,
      rngStreams: { ...meta.rngStreams, schedule: scheduleRng.state(), business: business.state() },
      nextFixtureId: meta.nextFixtureId + fixtures.length,
      inflationBp: { ...meta.inflationBp, [String(season)]: rate },
    });
  }

  // ───────── 조회 (난수를 쓰지 않는다) ─────────

  private ref(id: ClubId): ClubRef {
    const c = this.clubMap.get(id);
    if (!c) throw new Error(`구단 없음: ${id}`);
    return { id: c.id, name: c.name, shortName: c.shortName, primaryColor: c.primaryColor, secondaryColor: c.secondaryColor };
  }

  standings(): StandingView[] {
    const meta = this.meta();
    const phase = this.phase(meta);
    if (phase === 'stove' || phase === 'preseason') {
      const season = phase === 'stove' ? meta.season : meta.season - 1;
      const rows = this.repo.getSeasonStandings(season);
      const top = rows[0];
      return rows.map((s) => ({
        rank: s.rank,
        club: this.ref(s.clubId),
        games: s.wins + s.losses + s.ties,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pct: s.wins + s.losses === 0 ? null : s.wins / (s.wins + s.losses),
        gamesBehind: top ? (top.wins - s.wins + (s.losses - top.losses)) / 2 : 0,
        runsFor: null,
        runsAgainst: null,
        last10: '',
        streak: '',
        postseason: s.postseason,
      }));
    }
    const rows = computeStandings([...this.clubMap.keys()], this.repo.getGames(meta.season));
    return rows.map((r) => ({ ...r, club: this.ref(r.clubId) }));
  }

  private standingsTitle(meta = this.meta()): string {
    const phase = this.phase(meta);
    if (phase === 'stove') return `${meta.season} 시즌 최종 순위`;
    if (phase === 'preseason') return `${meta.season - 1} 시즌 최종 순위`;
    return `${meta.season} 시즌 순위`;
  }

  private fixtureView(f: { id: number; date: string; home: number; away: number; stage?: string; gameInSeries?: number }, game?: StoredGame): FixtureView {
    const stageLabel = f.stage && f.stage !== 'regular' ? `${SERIES_LABEL[f.stage as keyof typeof SERIES_LABEL]} ${f.gameInSeries}차전` : undefined;
    return { fixtureId: f.id, date: f.date, home: this.ref(f.home), away: this.ref(f.away), played: Boolean(game), homeRuns: game?.homeRuns, awayRuns: game?.awayRuns, innings: game?.innings, stageLabel };
  }

  private postseasonView(meta: GameMeta): PostseasonView | null {
    const s = this.postseason.state(meta);
    if (!s) return null;
    const ref = (id: number | null) => (id === null ? null : this.ref(id));
    const mine = this.repo.getSeasonStandings(s.season).find((x) => x.clubId === meta.userClubId);
    const seed = s.seeds.indexOf(meta.userClubId);
    return {
      season: s.season,
      champion: ref(s.champion),
      userResult: mine?.postseason || (seed < 0 ? '포스트시즌 진출 실패' : `정규시즌 ${seed + 1}위로 진출`),
      series: s.series.map((x) => ({
        key: x.key,
        label: SERIES_LABEL[x.key],
        high: ref(x.high),
        low: ref(x.low),
        highWins: x.key === 'wc' ? Math.max(0, x.highWins - 1) : x.highWins,
        lowWins: x.lowWins,
        ties: x.ties,
        winsNeeded: x.winsNeeded,
        winner: ref(x.winner),
        dates: x.dates,
        note: x.key === 'wc' ? '4위 1승 안고 시작, 4위는 1승 또는 1무로 통과' : `${x.winsNeeded}선승`,
      })),
    };
  }

  schedule(clubId?: number, month?: string): FixtureView[] {
    const meta = this.meta();
    const season = this.scheduleSeason(meta);
    const games = new Map(this.repo.getGames(season).map((g) => [g.fixtureId, g]));
    return this.repo
      .getFixtures(season)
      .filter((f) => (clubId ? f.home === clubId || f.away === clubId : true) && (month ? f.date.startsWith(month) : true))
      .map((f) => this.fixtureView(f, games.get(f.id)));
  }

  private nextGame(meta: GameMeta, standings: StandingView[]): NextGameView | null {
    if (meta.mode !== 'season') return null;
    const fx = this.repo.getFixtures(meta.season).find((f) => !f.played && f.date >= meta.currentDate && (f.home === meta.userClubId || f.away === meta.userClubId));
    if (!fx) return null;
    const record = (id: number) => {
      const s = standings.find((r) => r.club.id === id);
      if (!s) return '';
      const prefix = this.phase(meta) === 'preseason' ? '지난 시즌 ' : '';
      return `${prefix}${s.wins}승 ${s.losses}패${s.ties ? ` ${s.ties}무` : ''}, ${s.rank}위`;
    };
    // 예상 선발: 감독 자동 운영과 같은 로테이션 규칙으로 계산한다(난수 미사용). 경기 당일까지의 등판은 반영하지 않은 예상치다.
    const usage = this.repo.getRecentPitcherUsage(addDays(fx.date, -6), meta.currentDate).map((u) => ({ ...u, daysAgo: diffDays(fx.date, u.date) }));
    const lastStarters = this.repo.getLastStarters(meta.season);
    const active = this.repo.getActivePlayers([fx.home, fx.away]);
    const unavailable = this.health.unavailableOn(meta, fx.date, active);
    const pit = this.repo.pitchingTotals(meta.season);
    const starterOf = (clubId: number) => {
      try {
        const s = prepareTeam(clubId, active.filter((p) => p.clubId === clubId), usage, lastStarters.get(clubId) ?? null, clubId === meta.userClubId ? this.rosterOps.activePlan(meta) : null, ROSTER_MOVE.rotationSize, { out: unavailable }).starter;
        const t = pit.get(s.id);
        const era = t && t.OUTS > 0 ? ((27 * t.ER) / t.OUTS).toFixed(2) : '—';
        return { id: s.id, name: s.name, throws: s.throws === 'L' ? '좌완' : '우완', line: `시즌 ${t?.W ?? 0}승 ${t?.L ?? 0}패 · ERA ${era}` };
      } catch {
        return null;
      }
    };
    return { fixture: this.fixtureView(fx), homeRecord: record(fx.home), awayRecord: record(fx.away), homeStarter: starterOf(fx.home), awayStarter: starterOf(fx.away) };
  }

  /** 정규시즌 마지막 날 기록한 시즌별 경기 수 중 가장 최근 것(포스트시즌·다음 시즌 일정과 무관) */
  private lastRegularSeason(meta: GameMeta): { season: number; played: number; total: number; endDate: GameDate } | null {
    const seasons = Object.keys(meta.regularSeasons ?? {}).map(Number).sort((a, b) => a - b);
    const last = seasons.at(-1);
    return last === undefined ? null : { season: last, ...meta.regularSeasons![String(last)]! };
  }

  private tasks(meta: GameMeta, unread: number): TaskView[] {
    const out: TaskView[] = [];
    if (unread > 0) out.push({ title: `받은 편지함 ${unread}건 확인`, detail: '보고와 리그 소식을 확인하세요.', due: null, level: '권장', target: 'inbox' });
    // 비서 일정 관리력에 따라 미리 알리는 기간이 달라진다. 비서가 없으면 당일 일정만 알린다(03 문서).
    const lookahead = this.org.lookaheadDays(meta);
    const soon = this.repo.getCalendarEvents(meta.currentDate, addDays(meta.currentDate, lookahead));
    for (const e of soon) {
      const level: TaskView['level'] = e.kind === 'reserveList' || e.kind === 'campRoster' ? '필수' : '정보';
      const over = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId).length - LEAGUE.rosterMax;
      const rosterNote = over > 0 ? `현재 ${over}명 초과입니다.` : '현재 40명 이하라 추가 조치는 필요 없습니다.';
      out.push({ title: e.title, detail: e.kind === 'reserveList' || e.kind === 'campRoster' ? `보유 선수를 40명 이하로 맞춰야 합니다. ${rosterNote}` : e.body, due: e.date, level, target: 'schedule' });
    }
    // 2d: 스프링캠프~개막 전날에는 개막 엔트리 확인을 권한다(D-120).
    if (meta.mode === 'season' && this.phase(meta) === 'preseason') {
      const opening = seasonKeyDates(meta.season).opening;
      out.push({ title: '개막 엔트리·경기 운영 확인', detail: `개막(${opening.slice(5).replace('-', '/')}) 때의 1군 ${LEAGUE.activeRoster}명이 개막 엔트리가 됩니다. 타순·로테이션은 감독 자동 운영 또는 수동 계획으로 정합니다(행동력 0).`, due: addDays(opening, -1), level: '권장', target: 'roster' });
    }
    if (meta.mode === 'stove') {
      const off = Number(meta.kDate.slice(0, 4));
      const players = this.repo.getPlayers();
      const roster = players.filter((p) => p.clubId === meta.userClubId);
      const fa = this.repo.getFa(off);
      const star = fa.find((e) => e.originClub === meta.userClubId && players.find((p) => p.id === e.playerId)?.career.franchise);
      const starP = star ? players.find((p) => p.id === star.playerId) : players.find((p) => p.career.franchise && p.clubId === meta.userClubId);
      // 마감일 있는 의무 안건(D-095): 어떤 위임 모드든 마감일까지 미처리면 운영팀 제안안을 자동 적용한다.
      const duty = this.repo.getTasks({ status: ['queued', 'waiting'], kind: 'roster' })[0];
      if (roster.length > LEAGUE.rosterMax && duty) {
        const plan = this.org.rosterProposal(meta);
        out.unshift({
          title: `선수단 ${roster.length}명 → 40명 이하로 정리 (의무)`,
          detail: `${String(duty.params.deadline)}까지 직접 방출하지 않으면 운영팀 제안안(${plan.names.join(', ')})을 자동 적용합니다. 운영팀: ${duty.note}`,
          due: String(duty.params.deadline),
          level: '필수',
          target: 'market',
        });
      }
      if (starP && (!star || star.status === 'eligible' || star.status === 'applied' || star.status === 'approved')) {
        const open = this.market.marketOpen(meta);
        const interest = star ? this.repo.getOffers({ playerId: star.playerId, status: 'pending', kind: 'fa' }).filter((o) => o.clubId !== meta.userClubId).length : 0;
        out.unshift({
          title: `간판 외야수 ${starP.name} 잔류 협상`,
          detail: open ? `FA 시장이 열렸습니다. 다른 구단 관심 ${interest}곳. 선수는 매주 일요일에 받은 제안 중 하나를 고릅니다.` : 'FA 자격을 얻었습니다. 시장 개장(11/17) 후 협상할 수 있습니다.',
          due: null,
          level: '권장',
          target: 'market',
        });
      }
      const talks = this.repo.getSalaryTalks(off).filter((t) => t.clubId === meta.userClubId && t.status === 'open');
      if (talks.length) out.push({ title: `연봉 협상 ${talks.length}명 진행 중`, detail: '1월 10일까지 합의하지 못하면 조정(중간값)으로 정해집니다. 운영팀 기준 일괄 합의도 가능합니다.', due: null, level: '권장', target: 'market' });
      const foreign = roster.filter((p) => p.origin !== 'domestic');
      const expiring = foreign.filter((p) => p.contractYears === 0).length;
      if (diffDays(meta.currentDate, `${off}-12-01`) >= 0 && (expiring > 0 || foreign.length < 4)) {
        out.push({ title: `외국인 선수 정리 (계약 만료 ${expiring}명, 빈자리 ${4 - foreign.length}명)`, detail: '재계약하거나 해외 선수를 영입하세요. 1월 31일까지 정하지 않으면 운영팀이 기본 처리합니다.', due: null, level: '권장', target: 'market' });
      }
    }
    // 시즌 마감·스토브리그 (D-085): 은퇴 설득 기한, 드래프트 지명 순위, 시즌 목표
    const pending = meta.retirementPending ?? [];
    if (pending.length) out.unshift({ title: `은퇴 고민 선수 ${pending.length}명 면담`, detail: `${pending[0]!.deadline}까지 설득하지 않으면 은퇴합니다(면담 행동력 1).`, due: pending[0]!.deadline, level: '필수', target: 'market' });
    if (meta.mode === 'season') {
      const dd = draftDate(meta.season);
      const days = diffDays(dd, meta.currentDate);
      if (days >= 0 && days <= 28) out.push({ title: `신인 드래프트 지명 순위 정하기 (${dd.slice(5).replace('-', '/')})`, detail: (meta.draftBoard ?? []).length ? `지명 순위 ${meta.draftBoard!.length}명 지정됨` : '지정하지 않으면 스카우트 평가 순으로 지명합니다.', due: dd, level: '권장', target: 'draft' });
      if (meta.seasonGoal?.season === meta.season) out.push({ title: `시즌 목표: 정규시즌 ${meta.seasonGoal.expectedRank}위 이내`, detail: `연속 미달 ${meta.goalMisses ?? 0}시즌${meta.rebuild && meta.season >= meta.rebuild.from && meta.season <= meta.rebuild.until ? ' (리빌딩 유예 중)' : ''} — 2시즌 연속 미달이면 경고, 3시즌 연속이면 해임`, due: null, level: '정보', target: 'standings' });
    }
    // 7b(D-157): 받은 트레이드 제안
    const openOffers = (meta.tradeOffers ?? []).filter((o) => o.status === 'open' && diffDays(meta.currentDate, o.expires) <= 0);
    if (openOffers.length) out.unshift({ title: `받은 트레이드 제안 ${openOffers.length}건`, detail: `${openOffers.map((o) => this.ref(o.clubId).shortName).join(', ')} — 기한 안에 수락하거나 거절하세요(거절 무료).`, due: openOffers[0]!.expires, level: '권장', target: 'market' });
    const vacancies = this.orgVacancies(meta);
    if (vacancies.length) out.push({ title: `조직 공석 ${vacancies.length}자리`, detail: vacancies.slice(0, 3).map((v) => v.label).join(', ') + ' — 공석인 팀은 본부장이 겸임해 처리량이 줄어듭니다.', due: null, level: '권장', target: 'org' });
    out.push({ title: '재정 확인', detail: '현금과 이번 시즌 수입·지출을 확인하세요.', due: null, level: '선택', target: 'finance' });
    // 결재 대기(위임 제안 후 승인)는 비서가 맨 앞에 올린다(이번 주 안에 결재하지 않으면 만료).
    const approvals = this.org.approvals();
    if (approvals.length) out.unshift({ title: `결재 대기 ${approvals.length}건`, detail: approvals.slice(0, 2).map((a) => a.summary).join(' / ') + (approvals.length > 2 ? ' …' : ''), due: null, level: '필수', target: 'org' });
    return out;
  }

  dashboard(extra: { unsavedDays: number; lastSavedAt: string | null }): DashboardView {
    const meta = this.meta();
    const phase = this.phase(meta);
    const standings = this.standings();
    const season = this.scheduleSeason(meta);
    const mine = this.schedule(meta.userClubId);
    const counts = this.repo.countFixtures(season);
    const weekId = weekIdFor(meta.currentDate);
    const ap = this.repo.getApWeek(weekId);
    const weekEnd = addDays(weekId, 6);
    const weekStart = meta.currentDate === NEW_GAME.startDate ? meta.currentDate : weekId;
    const inbox = this.repo.getInbox(300);
    const unread = inbox.filter((m) => !m.read).length;
    const key = seasonKeyDates(season);
    const keyPlayers = this.players({ scope: 'mine', group: 'hitters', level: '1군', sortKey: phase === 'regular' || phase === 'postseason' || phase === 'seasonComplete' ? 'OPS' : 'power', sortDesc: true }).slice(0, 6);
    return {
      saveName: meta.saveName,
      season: meta.season,
      date: meta.currentDate,
      phase,
      phaseLabel: this.phaseLabel(meta),
      userClub: this.ref(meta.userClubId),
      userRecord: standings.find((s) => s.club.id === meta.userClubId) ?? null,
      standings,
      standingsTitle: this.standingsTitle(meta),
      todayFixtures: meta.mode === 'season' ? this.schedule(undefined, meta.currentDate).filter((f) => f.date === meta.currentDate) : [],
      upcoming: mine.filter((f) => !f.played && f.date >= meta.currentDate).slice(0, 6),
      recent: mine.filter((f) => f.played).slice(-6).reverse(),
      nextGame: this.nextGame(meta, standings),
      regularSeasonEnd: key.regularSeasonEnd,
      openingDay: key.opening,
      gamesPlayedLeague: counts.played,
      gamesTotalLeague: counts.total,
      lastRegularSeason: this.lastRegularSeason(meta),
      owner: { level: meta.ownerLevel, xp: meta.ownerXp, xpToNext: xpToNext(meta.ownerLevel), apGranted: ap?.granted ?? 0, apRemaining: ap ? ap.granted - ap.used : 0, weekLabel: `${weekStart.slice(5).replace('-', '/')}~${weekEnd.slice(5).replace('-', '/')}` },
      cashWon: this.repo.cashBalance(meta.userClubId),
      rosterCount: this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId).length,
      unreadInbox: unread,
      tasks: this.tasks(meta, unread),
      pendingApprovals: this.org.approvals().length,
      approvals: this.approvalViews(),
      upcomingEvents: this.calendar(meta.currentDate, addDays(meta.currentDate, 45)),
      keyPlayers,
      canAdvanceDay: meta.mode === 'season' && phase !== 'seasonComplete' && !meta.gameOver,
      // 4c-3(D-174): 오늘 우리 경기가 있으면 경기 보기, 관전 중이면 돌아가기
      live: { available: !!this.todayUserFixture(meta) && !this.repo.isDayProcessed(meta.currentDate), active: !!meta.liveGame && meta.liveGame.date === meta.currentDate },
      gameOver: meta.gameOver ?? null,
      goal: { expectedRank: meta.seasonGoal?.season === meta.season ? meta.seasonGoal.expectedRank : null, misses: meta.goalMisses ?? 0, rebuild: meta.rebuild ? `${meta.rebuild.from}~${meta.rebuild.until} 리빌딩` : null },
      postseason: this.postseasonView(meta),
      ...extra,
    };
  }

  calendar(from: string, to: string): CalendarEventView[] {
    return this.repo.getCalendarEvents(from, to);
  }

  inbox(): InboxItemView[] {
    return this.repo.getInbox(200);
  }

  markInboxRead(id: number): void {
    this.repo.markInboxRead(id);
  }

  finance(): FinanceView {
    const meta = this.meta();
    const club = this.clubMap.get(meta.userClubId)!;
    const byCategory = this.repo.ledgerByCategory(meta.userClubId, meta.season).map((r) => ({ category: r.category, label: CATEGORY_LABEL[r.category] ?? r.category, amountWon: r.amount }));
    const operating = byCategory.filter((r) => r.category !== 'startCash');
    const rate = meta.inflationBp[String(meta.season)];
    return {
      clubName: club.name,
      cashWon: this.repo.cashBalance(meta.userClubId),
      seasonYear: meta.season,
      byCategory,
      seasonRevenueWon: operating.filter((r) => r.amountWon > 0).reduce((a, r) => a + r.amountWon, 0),
      seasonExpenseWon: operating.filter((r) => r.amountWon < 0).reduce((a, r) => a + r.amountWon, 0),
      recent: this.repo.ledgerEntries(meta.userClubId, 40).map((e) => ({ date: e.date, label: CATEGORY_LABEL[e.category] ?? e.category, memo: e.memo, amountWon: e.amount })),
      notImplemented: NOT_YET_IMPLEMENTED,
      inflationNote: rate === undefined ? '2026년 기준 금액(물가 지수 1.00)' : `${meta.season} 시즌 물가 상승률 ${(rate / 100).toFixed(2)}%`,
    };
  }

  // ───────── 선수 시장 (계약·이적) ─────────

  private scoutGrade(meta: GameMeta, p: PlayerTruth, scale = 1): number {
    const r = p.clubId === meta.userClubId ? currentRatings(p) : this.scouting.get(p.id)?.centers ?? {};
    const keys = p.isPitcher ? ['stuff', 'control', 'groundball'] : ['contact', 'eye', 'power'];
    const vals = keys.map((k) => r[k] ?? 50);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  marketView(): MarketView {
    const meta = this.meta();
    const m = this.market;
    const off = Number(meta.kDate.slice(0, 4));
    const scale = this.org.scoutingScale(meta);
    const delegation = this.delegationByPlayer();
    const players = this.repo.getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const contractYear = meta.mode === 'stove' ? meta.season + 1 : meta.season;
    const ov = (o: ContractOffer): ContractOfferView => ({ years: o.years, salaryWon: o.salary, bonusWon: o.bonus, totalWon: offerTotal(o) });
    const pendingAll = this.repo.getOffers({ status: 'pending', kind: 'fa' });
    const statusLabel: Record<string, string> = { eligible: 'FA 자격', applied: 'FA 신청', declined: '미신청(잔류)', approved: '협상 가능', signed: '계약 완료', unsigned: '미계약' };
    const fa: FaRowView[] = this.repo.getFa(off).map((e) => {
      const p = byId.get(e.playerId)!;
      const mine = this.repo.getOffers({ playerId: e.playerId, clubId: meta.userClubId, kind: 'fa' });
      const last = mine[mine.length - 1];
      return {
        playerId: p.id,
        name: p.name,
        position: p.position,
        isPitcher: p.isPitcher,
        age: contractYear - Number(p.birthDate.slice(0, 4)),
        scoutGrade: this.scoutGrade(meta, p, scale),
        originClub: this.ref(e.originClub),
        status: statusLabel[e.status] ?? e.status,
        statusKey: e.status,
        faGrade: e.grade,
        priorSalaryWon: e.priorSalary,
        demand: ov(e.demand),
        compensationWon: e.originClub === meta.userClubId || !e.grade ? 0 : compensationFor(e.grade, e.priorSalary),
        interest: pendingAll.filter((o) => o.playerId === e.playerId && o.clubId !== meta.userClubId).length,
        myOffer: last ? { status: last.status, response: last.response, offer: ov(last.offer) } : null,
        signedClub: e.signedClub ? this.ref(e.signedClub) : null,
        signedContract: e.contract ? ov(e.contract) : null,
        franchise: e.originClub === meta.userClubId && p.career.franchise,
        delegation: delegation.get(`fa:${p.id}`) ?? null,
      };
    });
    // 정렬: 우리 구단 FA(간판 우선) → 협상 가능 → 계약 완료·미계약 → 미신청, 같은 묶음 안에서는 직전 연봉 순
    const order: Record<string, number> = { approved: 1, applied: 1, eligible: 1, signed: 2, unsigned: 2, declined: 3 };
    fa.sort((a, b) => Number(b.franchise) - Number(a.franchise) || Number(b.originClub.id === meta.userClubId) - Number(a.originClub.id === meta.userClubId) || (order[a.statusKey] ?? 9) - (order[b.statusKey] ?? 9) || b.priorSalaryWon - a.priorSalaryWon);
    const talks: SalaryTalkView[] = this.repo
      .getSalaryTalks(off)
      .filter((t) => t.clubId === meta.userClubId)
      .map((t) => {
        const p = byId.get(t.playerId)!;
        const label = { open: '협상 중', agreed: '합의', arbitrated: '조정 결정' }[t.status];
        return { playerId: p.id, name: p.name, position: p.position, age: contractYear - Number(p.birthDate.slice(0, 4)), priorWon: t.priorSalary, demandWon: t.demand, offerWon: t.offer, status: label, finalWon: t.final, delegation: delegation.get(`salary:${p.id}`) ?? null };
      });
    const fv = (p: PlayerTruth, status: ForeignPlayerView['status']): ForeignPlayerView => ({
      playerId: p.id,
      name: p.name,
      origin: p.origin as 'foreign' | 'asia',
      position: p.position,
      isPitcher: p.isPitcher,
      age: contractYear - Number(p.birthDate.slice(0, 4)),
      scoutGrade: this.scoutGrade(meta, p, scale),
      salaryUsd: wonToUsd(p.salary),
      demandUsd: status === 'expiring' ? foreignRenewalDemandUsd(p) : wonToUsd(p.salary),
      contractYears: p.contractYears,
      renewals: p.career.foreignRenewals,
      status,
    });
    const mineForeign = players.filter((p) => p.clubId === meta.userClubId && p.origin !== 'domestic').map((p) => fv(p, p.contractYears === 0 && meta.mode === 'stove' ? 'expiring' : 'contracted'));
    const pool = players.filter((p) => p.clubId === null && p.origin !== 'domestic').map((p) => fv(p, 'pool')).sort((a, b) => b.scoutGrade - a.scoutGrade);
    const foreignMine = mineForeign.filter((p) => p.origin === 'foreign');
    const capUsd = FOREIGN.totalCapUsd + foreignMine.reduce((a, p) => a + p.renewals * FOREIGN.totalCapPerRenewalUsd, 0);
    const roster = players.filter((p) => p.clubId === meta.userClubId);
    const weekId = weekIdFor(meta.currentDate);
    const ap = this.repo.getApWeek(weekId);
    const obligations = this.repo.getObligations().filter((o) => o.clubId === meta.userClubId);
    const stage = m.stage(meta);
    const ops = this.org.policy('ops');
    const byIdAll = new Map(players.map((p) => [p.id, p]));
    return {
      retirementPending: (meta.retirementPending ?? []).map((x) => { const p = byIdAll.get(x.playerId); return { playerId: x.playerId, name: p?.name ?? '', age: p ? contractYear - Number(p.birthDate.slice(0, 4)) : 0, reason: x.reason, deadline: x.deadline }; }),
      ops: { mode: ops.mode, faMaxTotal: ops.faMaxTotal, faMaxYears: ops.faMaxYears },
      stage: stage.key,
      stageLabel: stage.label,
      marketOpen: m.marketOpen(meta) && meta.mode === 'stove',
      weeksSinceOpen: m.weeksSinceOpen(meta),
      cashWon: this.repo.cashBalance(meta.userClubId),
      payrollWon: m.payroll(meta.userClubId),
      capWon: m.cap(meta),
      rosterCount: roster.length,
      rosterMax: LEAGUE.rosterMax,
      apRemaining: ap ? ap.granted - ap.used : 0,
      obligationsWon: obligations.reduce((a, o) => a + o.salary * o.seasons.filter((s) => s >= contractYear).length, 0),
      fa,
      salaryTalks: talks,
      foreign: {
        mine: mineForeign,
        pool,
        totalUsd: foreignMine.reduce((a, p) => a + (p.status === 'expiring' ? 0 : p.salaryUsd), 0),
        capUsd,
        rules: [
          '외국인 3명 + 아시아쿼터 1명까지 보유, 모두 출전 가능',
          '외국인 3명이 모두 투수이거나 모두 야수일 수 없음',
          '신규 외국인 1인당 100만 달러 이하 (연봉·계약금·이적료·옵션 포함)',
          `외국인 3명 총액 400만 달러 + 재계약 연차당 10만 달러 (현재 상한 ${Math.round(capUsd / 10_000)}만 달러)`,
          '아시아쿼터 신규 20만 달러 이하, 재계약 시 최대 10만 달러 인상',
        ],
      },
      releasable: roster
        .filter((p) => !fa.some((f) => f.playerId === p.id && (f.statusKey === 'applied' || f.statusKey === 'approved')))
        .map((p) => ({ playerId: p.id, name: p.name, position: p.position, age: contractYear - Number(p.birthDate.slice(0, 4)), level: p.level, scoutGrade: this.scoutGrade(meta, p, scale), salaryWon: p.salary, contractYears: p.contractYears, origin: p.origin }))
        .sort((a, b) => a.scoutGrade - b.scoutGrade),
    };
  }

  faOffer(playerId: number, years: number, salaryWon: number, bonusWon: number): OfferResultView {
    const meta = this.meta();
    const r = this.market.faOffer(meta, this.direct(meta), playerId, { years, salary: salaryWon, bonus: bonusWon });
    return r.result === 'counter' ? { result: 'counter', message: r.message, counter: { years: r.counter.years, salaryWon: r.counter.salary, bonusWon: r.counter.bonus, totalWon: offerTotal(r.counter) } } : { result: r.result, message: r.message };
  }

  salaryOffer(playerId: number, offerWon: number): OfferResultView {
    const meta = this.meta();
    return this.market.salaryOffer(meta, this.direct(meta), playerId, offerWon);
  }

  /** 남은 연봉 협상을 운영팀에 맡긴다(정책 한도 안에서 매주 제시). */
  salaryAuto(): OfferResultView {
    return this.org.delegateSalary(this.meta());
  }

  foreignOffer(playerId: number, salaryUsd: number): OfferResultView {
    const meta = this.meta();
    return this.market.foreignOffer(meta, this.direct(meta), playerId, salaryUsd);
  }

  /** 5b 연장 계약(D-136) */
  extensionOffer(playerId: number, years: number, salaryWon: number, bonusWon: number): OfferResultView {
    const meta = this.meta();
    const r = this.market.extensionOffer(meta, this.direct(meta), playerId, { years, salary: salaryWon, bonus: bonusWon });
    return r.result === 'counter' ? { result: 'counter', message: r.message, counter: { years: r.counter.years, salaryWon: r.counter.salary, bonusWon: r.counter.bonus, totalWon: offerTotal(r.counter) } } : { result: r.result, message: r.message };
  }

  /** 5b 국내 무소속 선수 영입(D-136) */
  domesticOffer(playerId: number, salaryWon: number): OfferResultView {
    const meta = this.meta();
    return this.market.domesticOffer(meta, this.direct(meta), playerId, salaryWon);
  }

  /** 방출. 시즌 중 1군 선수를 내보내면 같은 트랜잭션에서 감독 추천으로 1군 26명을 다시 채운다(2d, D-120). */
  releasePlayer(playerId: number): OfferResultView {
    return this.repo.transaction(() => {
      const r = this.market.releasePlayer(this.meta(), playerId);
      const filled = this.rosterOps.fillActive(this.meta());
      return filled ? { ...r, message: `${r.message} ${filled}` } : r;
    });
  }

  // ───────── 조직·위임 (2c) ─────────

  private direct(meta: GameMeta) {
    return { kind: 'direct' as const, weekId: weekIdFor(meta.currentDate) };
  }

  /** 선수별 최근 위임 업무 상태 (계약·이적 화면 표시용) */
  private delegationByPlayer(): Map<string, { status: string; note: string }> {
    const out = new Map<string, { status: string; note: string }>();
    for (const t of this.repo.getTasks({})) if (t.kind !== 'hire') out.set(`${t.kind}:${t.targetId}`, { status: TASK_STATUS_LABEL[t.status] ?? t.status, note: t.note });
    return out;
  }

  private orgVacancies(meta: GameMeta): OrganizationView['vacancies'] {
    const staff = this.org.staff(meta.userClubId);
    const out: OrganizationView['vacancies'] = [];
    for (const t of TEAMS) {
      if (!staff.some((s) => s.title === '팀장' && s.team === t.key)) out.push({ team: t.key, title: '팀장', label: `${t.name} 팀장` });
    }
    for (const t of TEAMS) {
      const n = staff.filter((s) => s.title === '팀원' && s.team === t.key).length;
      if (n < t.defaultMembers) out.push({ team: t.key, title: '팀원', label: `${t.name} ${t.memberLabel} (${n}/${t.defaultMembers})` });
    }
    return out;
  }

  private staffView(meta: GameMeta, s: StaffMember): StaffView {
    const obs = this.org.observed(meta, s);
    const core = obs.filter((a) => a.key !== 'authority');
    return {
      id: s.id,
      name: s.name,
      age: ageOn(s.birthDate, meta.currentDate),
      title: s.title,
      teamKey: s.team,
      teamName: s.team ? teamDef(s.team).name : null,
      part: s.part,
      salaryWon: s.salary,
      contractYears: s.contractYears,
      abilities: obs.map((a) => ({ key: a.key, label: ABILITY_LABEL[a.key] ?? a.key, value: a.value })),
      overall: Math.round(core.reduce((a, x) => a + x.value, 0) / Math.max(1, core.length)),
    };
  }

  orgView(): OrganizationView {
    const meta = this.meta();
    const staff = this.org.staff(meta.userClubId);
    const weekId = weekIdFor(meta.currentDate);
    const wp = this.repo.getWp(weekId);
    const ap = this.repo.getApWeek(weekId);
    const sv = (s: StaffMember) => this.staffView(meta, s);
    const teams: TeamView[] = TEAMS.map((t) => {
      const cap = teamCapacity(staff, t.key, meta.mode);
      const w = wp.find((x) => x.team === t.key);
      const granted = w?.granted ?? cap.weeklyWp;
      const upkeep = w?.upkeep ?? cap.upkeep;
      const used = w?.used ?? Math.min(cap.weeklyWp, cap.upkeep);
      const pol = this.org.policy(t.key);
      return {
        key: t.key,
        name: t.name,
        division: t.division === 'baseball' ? '야구' : '사업',
        leader: cap.leader ? sv(cap.leader) : null,
        actingName: cap.acting ? `${cap.acting.name} ${cap.acting.title}` : null,
        members: cap.members.map(sv),
        memberLabel: t.memberLabel,
        defaultMembers: t.defaultMembers,
        maxMembers: t.defaultMembers * 2,
        weeklyWp: granted,
        upkeep,
        usedWp: used,
        remainingWp: granted - used,
        upkeepShort: granted < upkeep,
        delegable: DELEGABLE_TEAMS.includes(t.key),
        mode: pol.mode,
      };
    });
    const coaches = staff.filter((s) => ['감독', '수석코치', '코치'].includes(s.title));
    // 4c-2b(D-172 (7)): 우리 감독은 실제 능력치·성향·신뢰도·최근 결정
    const mgr = staff.find((s) => s.title === '감독');
    const managerCard = mgr
      ? {
          id: mgr.id,
          name: mgr.name,
          ratings: MANAGER_KEYS.map((k) => ({ key: k, label: MANAGER_LABEL[k], value: mgr.abilities[k] ?? 50 })),
          smallBall: mgr.manager?.smallBall ?? 50,
          quickHook: mgr.manager?.quickHook ?? 50,
          trust: Math.round(mgr.manager?.trust ?? 50),
          recent: [...(mgr.manager?.recent ?? [])].reverse().slice(0, 10).map((r) => ({ date: r.date, side: r.side === 'off' ? '공격' : '수비', kinds: r.kinds.join('·'), inning: r.inning, delta: r.delta, score: r.score })),
        }
      : null;
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const kindLabel: Record<string, string> = { fa: 'FA 협상', salary: '연봉 협상', hire: '채용', roster: '40인 명단 정리(의무)' };
    const tasks: WorkTaskView[] = this.repo
      .getTasks({})
      .reverse()
      .slice(0, 60)
      .map((t) => ({
        id: t.id,
        team: t.team,
        teamName: teamDef(t.team).name,
        kind: t.kind,
        kindLabel: kindLabel[t.kind] ?? t.kind,
        target: t.kind === 'hire' ? `${teamDef(t.params.team as TeamKey).name} ${String(t.params.title)}` : t.kind === 'roster' ? `우리 선수단 (마감 ${String(t.params.deadline)})` : (players.get(t.targetId)?.name ?? `#${t.targetId}`),
        status: TASK_STATUS_LABEL[t.status] ?? t.status,
        statusKey: t.status,
        created: t.created,
        updated: t.updated,
        note: t.note,
      }));
    const scale = this.org.scoutingScale(meta);
    const [y, mo] = [Number(meta.currentDate.slice(0, 4)), Number(meta.currentDate.slice(5, 7))];
    const nextMonth = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const candidates = this.repo
      .getStaff(null)
      .map(sv)
      .sort((a, b) => a.title.localeCompare(b.title, 'ko') || b.overall - a.overall);
    const secretary = staff.find((s) => s.title === '비서');
    return {
      weekLabel: `${weekId.slice(5).replace('-', '/')}~${addDays(weekId, 6).slice(5).replace('-', '/')}`,
      apRemaining: ap ? ap.granted - ap.used : 0,
      cashWon: this.repo.cashBalance(meta.userClubId),
      staffPayrollWon: staff.reduce((a, s) => a + s.salary, 0),
      headcount: staff.length,
      secretary: secretary ? sv(secretary) : null,
      executives: staff.filter((s) => s.title === '단장' || s.title === '사업본부장').map(sv),
      coaches: coaches.map(sv),
      manager: managerCard,
      coachSlots: this.org.coachSlots().map((slot) => {
        const c = coaches.find((s) => (slot.title === '코치' ? s.title === '코치' && s.part === slot.part : s.title === slot.title));
        return { part: slot.part, squad: slot.squad, coach: c ? sv(c) : null };
      }),
      teams,
      lookaheadDays: this.org.lookaheadDays(meta),
      scoutingNote: `선수 평가 오차 배율 ×${scale.toFixed(2)} — 스카우트팀 인원과 전문성이 높을수록 작아집니다.`,
      candidates,
      candidatesRefresh: nextMonth,
      policies: TEAMS.filter((t) => DELEGABLE_TEAMS.includes(t.key)).map((t) => this.org.policy(t.key)),
      tasks,
      approvals: this.approvalViews(),
      vacancies: this.orgVacancies(meta),
      apCosts: { hire: ORG_AP.hire, fire: ORG_AP.fire },
      owner: {
        crisisSince: meta.cashCrisisSince ?? null,
        emergencyAvailable: this.clubMap.get(meta.userClubId)!.parentSupport > 0 && meta.emergencyUsedSeason !== meta.season,
        rebuild: meta.rebuild ? `${meta.rebuild.from}~${meta.rebuild.until} 시즌` : null,
        canRebuild: meta.mode === 'stove' && (!meta.rebuild || meta.season + 1 - meta.rebuild.declaredSeason >= CLOSE_RULES.rebuildCooldown),
        rebuildAp: CLOSE_RULES.rebuildAp,
      },
    };
  }

  private approvalViews(): ApprovalView[] {
    const kindLabel: Record<string, string> = { fa: 'FA 협상', salary: '연봉 협상', hire: '채용', roster: '40인 명단 정리(의무)' };
    return this.org.approvals().map((a) => ({ id: a.id, kind: a.kind, teamName: teamDef(a.team).name, kindLabel: kindLabel[a.kind] ?? a.kind, date: a.date, summary: a.summary }));
  }

  /** 결재는 행동력을 쓰지 않는다(D-077). */
  decideMany(approvalIds: number[], approve: boolean): OfferResultView {
    return this.org.decideMany(this.meta(), approvalIds, approve);
  }

  // ───────── 4c-3 경기 관전·승부처 참여 (D-160·D-174) ─────────

  /** 오늘 우리 경기(정규시즌·포스트시즌). 없으면 null */
  private todayUserFixture(meta: GameMeta): Fixture | null {
    if (meta.mode !== 'season' || meta.gameOver) return null;
    return this.repo.getFixturesOn(meta.currentDate).find((f) => f.home === meta.userClubId || f.away === meta.userClubId) ?? null;
  }

  /**
   * 관전 미리보기: 그날 시작 상태에서 경기 전 단계를 거쳐 우리 경기를 기록된 지시로 다시 계산한다. 트랜잭션을 되돌려 저장하지 않는다.
   * 지시가 없는 참여 지점에서 멈춘다(OwnerPause).
   */
  private livePreview(): { g: GameState; pause: OwnerPoint | null; fixture: Fixture } {
    const meta = this.meta();
    const fixture = this.todayUserFixture(meta);
    if (!fixture || !meta.liveGame || meta.liveGame.date !== meta.currentDate || meta.liveGame.fixtureId !== fixture.id) throw new GameError('NOT_AVAILABLE', '관전 중인 경기가 없습니다.');
    let out: { g: GameState; pause: OwnerPoint | null; fixture: Fixture } | null = null;
    const ROLLBACK = new Error('live-preview-rollback');
    try {
      this.repo.transaction(() => {
        this.dayPrelude(meta, meta.currentDate);
        const inputs = this.gameInputs(meta, meta.currentDate);
        const g = createGame(...inputs.args(fixture, this.ownerControl(meta, fixture.id, fixture.home, fixture.away, true)));
        let pause: OwnerPoint | null = null;
        try {
          runGame(g);
        } catch (e) {
          if (e instanceof OwnerPause) pause = e.point;
          else throw e;
        }
        out = { g, pause, fixture };
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    } finally {
      // 되돌린 상태를 기억하는 캐시를 버린다
      this.scouting = new Map(this.repo.getScouting(meta.userClubId).map((s) => [s.playerId, s]));
      this.managers.reset();
      this.aiClubs.reset();
      this.business.reset();
    }
    return out!;
  }

  /** 경기 보기 시작: 오늘 우리 경기의 관전 기록을 만든다(이미 있으면 그대로) */
  liveStart(): LiveGameView {
    const meta = this.meta();
    const f = this.todayUserFixture(meta);
    if (!f) throw new GameError('NOT_AVAILABLE', '오늘은 우리 경기가 없습니다.');
    if (this.repo.isDayProcessed(meta.currentDate)) throw new GameError('NOT_AVAILABLE', '이미 처리된 날짜입니다.');
    if (!meta.liveGame || meta.liveGame.date !== meta.currentDate || meta.liveGame.fixtureId !== f.id) this.repo.updateMeta({ liveGame: { date: meta.currentDate, fixtureId: f.id, prePa: {}, count: {} } });
    return this.liveView();
  }

  liveView(): LiveGameView {
    const meta = this.meta();
    const f = this.todayUserFixture(meta);
    const active = !!f && !!meta.liveGame && meta.liveGame.date === meta.currentDate && meta.liveGame.fixtureId === f.id;
    if (!active) return { active: false, available: !!f, participate: meta.liveSettings?.participate ?? true, game: null };
    const { g, pause, fixture } = this.livePreview();
    return { active: true, available: true, participate: meta.liveSettings?.participate ?? true, game: this.liveGameView(meta, g, pause, fixture) };
  }

  /** 구단주 결정(행동력 0): 지금 멈춘 지점과 같은지, 규칙에 맞는지 확인하고 기록에 더한다(되돌릴 수 없음) */
  liveDecide(choice: LiveChoice): LiveGameView {
    const meta = this.meta();
    const { g, pause } = this.livePreview();
    if (!pause) throw new GameError('NOT_AVAILABLE', '지금은 결정할 지점이 아닙니다.');
    const live = meta.liveGame!;
    if (choice.kind === 'prePa') {
      if (pause.kind !== 'prePa' || choice.key !== pause.key) throw new GameError('NOT_AVAILABLE', '이미 지난 결정 지점입니다.');
      const o: OwnerPrePa =
        pause.role === 'def'
          ? // 대수비는 구단주 선택지가 아니므로 감독 추천을 그대로 쓴다(defensiveSubs 생략)
            { pitcherId: choice.pitcherId ?? null, ibb: choice.ibb === true, align: choice.align ?? NORMAL_ALIGNMENT }
          : { pinchHitter: choice.pinchHitter ?? null, pinchRunners: (choice.pinchRunners ?? []).map((r) => ({ base: r.base as 0 | 1 | 2, playerId: r.playerId })), play: (choice.play ?? 'none') as OffensePlay };
      const batSide = battingSideOf(g.half);
      const d = { kind: 'prePa' as const, side: batSide === 'home' ? ('away' as const) : ('home' as const), batSide, inning: g.inning, atInningStart: g.atHalfStart, key: pause.key };
      const err = directiveError(g, d, mergeOwner(pause.recommended, o, pause.role));
      if (err) throw new GameError('INVALID_DIRECTIVE', err);
      this.repo.updateMeta({ liveGame: { ...live, prePa: { ...live.prePa, [String(pause.key)]: o } } });
    } else {
      if (pause.kind !== 'count' || choice.paSeq !== pause.paSeq || choice.balls !== pause.balls || choice.strikes !== pause.strikes) throw new GameError('NOT_AVAILABLE', '이미 지난 결정 지점입니다.');
      const allowed: CountTactic[] = pause.role === 'off' ? ['none', 'take'] : ['none', 'pitchAround', 'attack'];
      if (!allowed.includes(choice.tactic as CountTactic)) throw new GameError('INVALID_DIRECTIVE', '이 지점에서 고를 수 없는 지시입니다.');
      this.repo.updateMeta({ liveGame: { ...live, count: { ...live.count, [`${pause.paSeq}:${pause.balls}:${pause.strikes}`]: choice.tactic as CountTactic } } });
    }
    return this.liveView();
  }

  /** 승부처 참여 설정(행동력 0). 끄면 관전만 한다 */
  liveSettings(participate: boolean): LiveGameView {
    this.repo.updateMeta({ liveSettings: { participate: participate === true } });
    return this.liveView();
  }

  private liveGameView(meta: GameMeta, g: GameState, pause: OwnerPoint | null, fixture: Fixture): LiveGameGameView {
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const name = (id: number | null) => (id === null ? '' : (players.get(id)?.name ?? `#${id}`));
    const userSide: 'home' | 'away' = fixture.home === meta.userClubId ? 'home' : 'away';
    const outcomeText: Record<string, string> = { '1B': '안타', '2B': '2루타', '3B': '3루타', HR: '홈런', BB: '볼넷', HBP: '몸에 맞는 공', K: '삼진', GO: '땅볼 아웃', FO: '뜬공 아웃', DP: '병살타', SF: '희생플라이', SH: '희생번트', ROE: '실책 출루', FC: '야수 선택' };
    const playText: Record<string, string> = { SB: '도루 성공', CS: '도루 실패', PO: '견제사', WP: '폭투', PB: '포일', BK: '보크' };
    const subText: Record<string, string> = { PH: '대타', PR: '대주자', DEF: '대수비' };
    const items: Array<LiveFeedItem & { order: number }> = [];
    const score = (h: number, a: number) => `${a}:${h}`;
    for (const s of g.subs) items.push({ order: s.seq * 4, seq: s.seq, inning: 0, half: 'T', kind: 'sub', text: `${subText[s.kind]} ${name(s.inId)} (← ${name(s.outId)})`, score: '', scoring: false });
    for (const p of g.plays) items.push({ order: p.seq * 4 + 1, seq: p.seq, inning: p.inning, half: p.half, kind: 'play', text: `${playText[p.kind]}${p.runnerId ? ` · ${name(p.runnerId)}` : ''}${p.outsOnPlay ? ' (아웃)' : ''}`, score: score(p.homeScore, p.awayScore), scoring: false });
    const lastPitcher = new Map<number, number>();
    let prevTotal = 0;
    for (const e of g.events) {
      const defClub = e.battingClub === fixture.home ? fixture.away : fixture.home;
      if (lastPitcher.has(defClub) && lastPitcher.get(defClub) !== e.pitcherId) items.push({ order: e.seq * 4 - 2, seq: e.seq, inning: e.inning, half: e.half, kind: 'pitcher', text: `투수 교체: ${name(e.pitcherId)}`, score: '', scoring: false });
      lastPitcher.set(defClub, e.pitcherId);
      const total = e.homeScore + e.awayScore;
      const pitches = e.pitchLog ? e.pitchLog.split('').map((c) => ({ B: '볼', S: '스트라이크', F: '파울', H: '몸에 맞음', X: '타격' })[c] ?? c).join(' · ') : undefined;
      items.push({ order: e.seq * 4 + 2, seq: e.seq, inning: e.inning, half: e.half, kind: 'pa', text: `${name(e.batterId)}: ${e.ibb ? '고의사구' : (outcomeText[e.outcome] ?? e.outcome)}${e.bb ? ` · ${name(e.bb.fielderId)}` : ''}${e.rbi ? ` (${e.rbi}타점)` : ''}`, score: score(e.homeScore, e.awayScore), scoring: total > prevTotal, ...(pitches ? { pitches } : {}) });
      prevTotal = total;
    }
    // 교체 항목의 이닝은 바로 뒤 항목에서 가져온다
    items.sort((a, b) => a.order - b.order);
    for (let i = items.length - 1; i >= 0; i--) if (items[i]!.inning === 0) Object.assign(items[i]!, { inning: items[i + 1]?.inning ?? g.inning, half: items[i + 1]?.half ?? g.half });
    const over = g.phase === 'over' && !pause;
    const us = g.score[userSide];
    const them = g.score[userSide === 'home' ? 'away' : 'home'];
    return {
      date: meta.currentDate,
      fixtureId: fixture.id,
      home: this.ref(fixture.home),
      away: this.ref(fixture.away),
      userSide,
      score: { ...g.score },
      lineScore: { home: [...g.lineScore.home], away: [...g.lineScore.away] },
      inning: g.inning,
      half: g.half,
      outs: g.outs,
      bases: [!!g.bases[0], !!g.bases[1], !!g.bases[2]],
      over,
      result: over ? (us > them ? '승리' : us < them ? '패배' : '무승부') : null,
      feed: items.map(({ order: _o, ...rest }) => rest),
      decision: pause ? this.liveDecisionView(meta, g, pause, userSide) : null,
      participation: { enabled: meta.liveSettings?.participate ?? true, used: g.ownerPoints, max: LIVE.maxPerGame },
    };
  }

  private liveDecisionView(meta: GameMeta, g: GameState, pause: OwnerPoint, userSide: 'home' | 'away'): LiveDecisionView {
    const batSide = battingSideOf(g.half);
    const defSide: 'home' | 'away' = batSide === 'home' ? 'away' : 'home';
    const bat = g.teams[batSide];
    const def = g.teams[defSide];
    const batterId = pause.kind === 'count' ? pause.batterId : bat.lineup[bat.orderIndex % 9]!.player.id;
    const pitcherId = pause.kind === 'count' ? pause.pitcherId : def.stint.pitcher.id;
    // 정보 경계(D-174 (4)): 선수 목록 응답은 우리 선수만 실제 능력치, 상대는 추정 범위
    const item = (id: number) => {
      const p = this.repo.getPlayer(id)!;
      return this.players({ scope: p.clubId ?? meta.userClubId, group: 'all', level: 'all', sortKey: 'name', sortDesc: false }).find((x) => x.id === id)!;
    };
    const diff = g.score.home - g.score.away;
    const wpHome = winProbability(g.inning, g.half, g.outs, (g.bases[0] ? 1 : 0) | (g.bases[1] ? 2 : 0) | (g.bases[2] ? 4 : 0), diff, false);
    const li = leverage(g.inning, g.half, g.outs, (g.bases[0] ? 1 : 0) | (g.bases[1] ? 2 : 0) | (g.bases[2] ? 4 : 0), diff, false);
    // 우리 선수 능력치에 더해지는 감독 보정(경기용, D-172). 선택지 문구의 능력치는 이미 보정이 들어간 경기용 값이다
    const prof = this.managers.profileOf(meta.userClubId);
    const sgn = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
    const managerNote = `감독 보정(경기 중): 타격 ${sgn(ratingBonus(prof, 'hitting'))} · 투수 ${sgn(ratingBonus(prof, 'pitching'))} · 수비·주루 ${sgn(ratingBonus(prof, 'fieldRun'))}`;
    const base = { key: pause.key, role: pause.role, managerNote, batter: item(batterId), pitcher: item(pitcherId), winProb: Math.round((userSide === 'home' ? wpHome : 1 - wpHome) * 1000) / 10, leverage: Math.round(li * 100) / 100 };
    const playLabel: Record<string, string> = { none: '강공(작전 없음)', steal2: '2루 도루', steal3: '3루 도루', hitAndRun: '히트앤드런', sacBunt: '희생번트', squeeze: '스퀴즈' };
    const tacticLabel: Record<string, string> = { none: '그대로', take: '기다려', pitchAround: '유인구', attack: '정면 승부' };
    if (pause.kind === 'count') {
      const tactics = pause.role === 'off' ? ['none', 'take'] : ['none', 'pitchAround', 'attack'];
      return {
        ...base,
        kind: 'count',
        paSeq: pause.paSeq,
        balls: pause.balls,
        strikes: pause.strikes,
        pitchLog: pause.log,
        title: `${pause.balls}볼 ${pause.strikes}스트라이크`,
        recommended: tacticLabel[pause.recommended] ?? pause.recommended,
        recommendation: { kind: 'count', paSeq: pause.paSeq, balls: pause.balls, strikes: pause.strikes, tactic: pause.recommended },
        tactics: tactics.map((t) => ({ key: t, label: tacticLabel[t]!, disabled: null })),
      };
    }
    const rec = pause.recommended;
    const own = g.teams[userSide];
    if (pause.role === 'def') {
      const pool = [...own.setup.bullpen, ...(own.setup.closer ? [own.setup.closer] : [])].filter((p) => !own.usedRelievers.has(p.id) && p.id !== own.stint.pitcher.id);
      const alignText = (a: Directive['align']) => [a.infield === 'in' ? '내야 전진' : a.infield === 'dp' ? '병살 대비' : '내야 기본', a.outfield === 'in' ? '외야 전진' : a.outfield === 'back' ? '외야 후진' : '외야 기본', ...(a.lines ? ['선상 수비'] : [])].join(' · ');
      return {
        ...base,
        kind: 'prePa',
        title: '수비 결정',
        recommended: [rec.pitcherId ? `투수 교체: ${this.repo.getPlayer(rec.pitcherId)?.name ?? ''}` : '투수 유지', ...(rec.ibb ? ['고의사구'] : []), alignText(rec.align)].join(' · '),
        recommendation: { kind: 'prePa', key: pause.key, pitcherId: rec.pitcherId, ibb: rec.ibb, align: rec.align },
        pitchers: [{ key: 'keep', label: `유지: ${own.stint.pitcher.name} (투구 ${own.stint.pitches})`, disabled: null }, ...pool.map((p) => ({ key: String(p.id), label: `${p.name} · 구위 ${Math.round(p.pitching?.stuff ?? 0)} · 제구 ${Math.round(p.pitching?.control ?? 0)}`, disabled: null }))],
        currentPitches: own.stint.pitches,
      };
    }
    const spot = own.lineup[own.orderIndex % 9]!;
    const benchPh = own.bench.filter((p) => !own.removed.has(p.id) && canPlay(p, spot.position));
    const runners = ([0, 1, 2] as const).filter((b) => g.bases[b] && own.lineup.some((s) => s.player.id === g.bases[b]!.id));
    const opp = pause.recommended;
    return {
      ...base,
      kind: 'prePa',
      title: '공격 결정',
      recommended: [rec.pinchHitter ? `대타: ${this.repo.getPlayer(rec.pinchHitter)?.name ?? ''}` : '타자 그대로', ...rec.pinchRunners.map((r) => `대주자: ${this.repo.getPlayer(r.playerId)?.name ?? ''}`), playLabel[rec.play] ?? rec.play].join(' · '),
      recommendation: { kind: 'prePa', key: pause.key, pinchHitter: rec.pinchHitter, pinchRunners: rec.pinchRunners.map((r) => ({ base: r.base, playerId: r.playerId })), play: rec.play },
      opponentIbb: opp.ibb,
      pinchHitters: [{ key: 'keep', label: `그대로: ${spot.player.name}`, disabled: null }, ...benchPh.map((p) => ({ key: String(p.id), label: `${p.name} · 컨택 ${Math.round(p.batting.contact)} · 장타 ${Math.round(p.batting.power)} · 선구 ${Math.round(p.batting.eye)}`, disabled: null }))],
      pinchRunners: runners.map((b) => ({ base: b, runner: this.repo.getPlayer(g.bases[b]!.id)?.name ?? '', options: own.bench.filter((p) => !own.removed.has(p.id)).map((p) => ({ key: String(p.id), label: `${p.name} · 주력 ${Math.round(p.batting.speed)}`, disabled: null })) })),
      plays: (['none', 'steal2', 'steal3', 'hitAndRun', 'sacBunt', 'squeeze'] as const).map((k) => {
        const d = { kind: 'prePa' as const, side: defSide, batSide, inning: g.inning, atInningStart: g.atHalfStart, key: pause.key };
        const err = opp.ibb && k !== 'none' ? '상대가 고의사구를 냅니다.' : directiveError(g, d, mergeOwner(rec, { play: k }, 'off'));
        return { key: k, label: playLabel[k]!, disabled: err };
      }),
    };
  }

  /** 운영 상태 기준 순위(D-155 (1)): 정규시즌 팀당 30경기 이상이면 현재 순위, 아니면 직전 시즌 최종 순위 */
  private stanceRanks(): Map<ClubId, number> {
    const meta = this.meta();
    const cur = this.standings();
    if (cur.length > 0 && cur.every((s) => s.games >= AI_CLUB.minGames)) return new Map(cur.map((s) => [s.club.id, s.rank]));
    const prior = this.repo.getSeasonStandings(meta.mode === 'stove' ? meta.season : meta.season - 1);
    const rows = prior.length ? prior : SEASON_2026_STANDINGS;
    return new Map(rows.map((s) => [s.clubId, s.rank]));
  }

  /** 우리 구단 모기업 지원금: 경고 삭감(bp)과 긴급 지원 차감을 반영한다(D-043). */
  private supportAdjusted(meta: GameMeta, club: ClubProfile): ClubProfile {
    const key = String(meta.season);
    // D-135 재협상 배수(모든 구단), 경고 삭감·긴급 지원 차감(우리 구단)
    const factor = meta.supportBp?.[key]?.[String(club.id)] ?? 10_000;
    const mine = club.id === meta.userClubId;
    const cut = mine ? (meta.supportCutBp?.[key] ?? 0) : 0;
    const deduction = mine ? (meta.supportDeduction?.[key] ?? 0) : (meta.aiSupportDeduction?.[key]?.[String(club.id)] ?? 0);
    if (factor === 10_000 && !cut && !deduction) return club;
    const base = Math.round((club.parentSupport * factor) / 10_000);
    return { ...club, parentSupport: Math.max(0, Math.round((base * (10_000 - cut)) / 10_000) - deduction) };
  }

  /** 신인 드래프트 보드와 결과 (07 문서) */
  draftView(): DraftView {
    const meta = this.meta();
    const year = meta.mode === 'stove' ? meta.season + 1 : meta.season;
    const date = draftDate(year);
    const scale = this.org.scoutingScale(meta);
    const board = meta.draftBoard ?? [];
    const pots = (a: { hidden: { potential: Record<string, number | undefined> } }) => {
      const v = Object.values(a.hidden.potential).filter((x): x is number => typeof x === 'number');
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 50;
    };
    const candidates = this.draft.board(meta, scale).map(({ a, value }) => {
      const obs = observePlayer(meta.seed, meta.userClubId, asTruth(a), scale);
      const keys = a.isPitcher ? ['stuff', 'control', 'groundball'] : ['contact', 'eye', 'power'];
      const last = a.seasons[a.seasons.length - 1];
      const t = last?.totals as unknown as Record<string, number> | undefined;
      const n = (k: string) => t?.[k] ?? 0;
      const potEst = pots(a) + stableNormal(meta.seed, 'draft-pot', meta.userClubId, a.id) * 6 * scale;
      return {
        id: a.id,
        name: a.name,
        level: a.level,
        school: a.school,
        grade: a.grade,
        position: a.position,
        isPitcher: a.isPitcher,
        age: year - Number(a.birthDate.slice(0, 4)),
        scoutGrade: Math.round(keys.reduce((s, k) => s + (obs[k] ?? 50), 0) / keys.length),
        scoutPotentialGrade: potEst >= 68 ? 'A' : potEst >= 60 ? 'B' : potEst >= 52 ? 'C' : 'D',
        honors: a.honors.map((h) => h.title),
        lastSeason: !t || !last ? '' : last.kind === 'bat' ? `${last.year} 타율 ${n('AB') ? (n('H') / n('AB')).toFixed(3).replace(/^0/, '') : '—'} ${n('HR')}홈런 ${n('H')}안타${last.SB ? ` ${last.SB}도루` : ''}` : `${last.year} ${n('W')}승 평균자책 ${n('OUTS') ? ((27 * n('ER')) / n('OUTS')).toFixed(2) : '—'} ${n('K')}탈삼진`,
        priority: board.indexOf(a.id) >= 0 ? board.indexOf(a.id) + 1 : null,
        value,
      };
    });
    const done = date <= meta.currentDate && meta.mode === 'season' && this.repo.isDayProcessed(date);
    const draftedAm = this.repo.getAmateurs().filter((a) => a.draft?.year === year);
    const draftedPro = this.repo.getPlayers().filter((p) => p.draft?.year === year);
    const picks = [
      ...draftedAm.filter((a) => a.status === 'drafted').map((a) => ({ round: a.draft!.round, pick: a.draft!.pick, club: this.ref(a.draft!.clubId), name: a.name, school: a.school, position: a.position, mine: a.draft!.clubId === meta.userClubId })),
      ...draftedPro.map((p) => ({ round: p.draft!.round, pick: p.draft!.pick, club: this.ref(p.clubId ?? meta.userClubId), name: p.name, school: p.draft!.school, position: p.position, mine: p.clubId === meta.userClubId })),
    ].sort((a, b) => a.pick - b.pick);
    const order = computeStandings([...this.clubMap.keys()], this.repo.getGames(year)).map((r) => r.clubId).reverse();
    return {
      year,
      date,
      done: done || picks.length > 0,
      candidates: candidates.map(({ value: _v, ...c }) => c),
      board,
      picks,
      myOrder: this.repo.getGames(year).length ? order.indexOf(meta.userClubId) + 1 : null,
    };
  }

  setDraftBoard(ids: number[]): DraftView {
    const meta = this.meta();
    const valid = new Set(this.repo.getAmateurs('active').filter(isSenior).map((a) => a.id));
    this.repo.updateMeta({ draftBoard: [...new Set(ids)].filter((id) => valid.has(id)).slice(0, 30) });
    void meta;
    return this.draftView();
  }

  persuadeRetirement(playerId: number): OfferResultView {
    const meta = this.meta();
    return this.seasonClose.persuade(meta, weekIdFor(meta.currentDate), playerId);
  }

  emergencySupport(): OfferResultView {
    const meta = this.meta();
    return this.seasonClose.emergency(meta, this.clubMap.get(meta.userClubId)!.parentSupport);
  }

  declareRebuild(): OfferResultView {
    const meta = this.meta();
    return this.seasonClose.declareRebuild(meta, weekIdFor(meta.currentDate));
  }

  /** 명예의 전당: 어느 구단이든 열람 (D-083) */
  hallOfFame(clubId: number): TeamRecordsView {
    const meta = this.meta();
    if (!this.clubMap.has(clubId)) throw new GameError('INVALID_CLUB', '존재하지 않는 구단입니다.');
    const v = this.records.teamRecords(meta, this.ref(clubId), clubId);
    return { ...v, owner: { level: meta.ownerLevel, xp: meta.ownerXp, xpToNext: xpToNext(meta.ownerLevel) } };
  }

  teamRecords(): TeamRecordsView {
    const meta = this.meta();
    const v = this.records.teamRecords(meta, this.ref(meta.userClubId));
    return { ...v, owner: { level: meta.ownerLevel, xp: meta.ownerXp, xpToNext: xpToNext(meta.ownerLevel) } };
  }

  hireStaff(staffId: number): OfferResultView {
    const meta = this.meta();
    return this.org.hire(meta, weekIdFor(meta.currentDate), staffId);
  }

  fireStaff(staffId: number): OfferResultView {
    const meta = this.meta();
    return this.org.fire(meta, weekIdFor(meta.currentDate), staffId);
  }

  setPolicy(p: DelegationPolicyView): OfferResultView {
    return this.org.setPolicy(this.meta(), { ...p, team: p.team as TeamKey });
  }

  delegateFa(playerId: number, maxTotalWon?: number, maxYears?: number): OfferResultView {
    return this.org.delegateFa(this.meta(), playerId, maxTotalWon, maxYears);
  }

  delegateSalary(playerId?: number): OfferResultView {
    return this.org.delegateSalary(this.meta(), playerId);
  }

  delegateHire(team: string, title: '팀장' | '팀원', maxSalaryWon?: number): OfferResultView {
    return this.org.delegateHire(this.meta(), team as TeamKey, title, maxSalaryWon);
  }

  cancelTask(taskId: number): OfferResultView {
    return this.org.cancelTask(this.meta(), taskId);
  }

  approve(approvalId: number): OfferResultView {
    return this.org.approve(this.meta(), approvalId);
  }

  reject(approvalId: number): OfferResultView {
    return this.org.reject(this.meta(), approvalId);
  }

  // ───────── 구단 선택·비교 (3e, D-121·D-122) ─────────

  private clubNote(meta: GameMeta, clubId: number): ClubNoteView {
    return meta.clubNotes?.[String(clubId)] ?? { text: '', rival: false, updatedAt: null };
  }

  saveClubNote(clubId: number, text: string, rival: boolean, updatedAt: string): ClubNoteView {
    if (!this.clubMap.has(clubId)) throw new GameError('INVALID_CLUB', '존재하지 않는 구단입니다.');
    if (typeof text !== 'string' || text.length > 2000 || typeof rival !== 'boolean') throw new GameError('INVALID_NOTE', '메모는 2,000자 이내의 텍스트여야 합니다.');
    const meta = this.meta();
    const note = { text, rival, updatedAt };
    this.repo.updateMeta({ clubNotes: { ...(meta.clubNotes ?? {}), [String(clubId)]: note } });
    return note;
  }

  /**
   * 전력 비교 묶음(D-122): 1군에서 묶음별 상위 선수를 골라 능력 평균을 낸다.
   * 우리 선수는 실제 능력, 타 구단 선수는 저장된 스카우트 추정 범위만 쓴다(실제 능력은 읽지 않는다).
   */
  private strengthGroups(meta: GameMeta, clubId: number) {
    const own = clubId === meta.userClubId;
    const players = this.repo.getPlayers().filter((p) => p.clubId === clubId && p.level === '1군');
    const HIT = ['contact', 'eye', 'power', 'def_fielding'];
    const groups: Array<{ key: string; label: string; n: number; pick: (p: PlayerTruth) => boolean; keys: string[] }> = [
      { key: 'C', label: '포수', n: 1, pick: (p) => !p.isPitcher && p.position === 'C', keys: HIT },
      { key: 'IF', label: '내야(1·2·3루·유격)', n: 4, pick: (p) => !p.isPitcher && ['1B', '2B', '3B', 'SS'].includes(p.position), keys: HIT },
      { key: 'OF', label: '외야', n: 3, pick: (p) => !p.isPitcher && ['LF', 'CF', 'RF'].includes(p.position), keys: HIT },
      { key: 'SP', label: '선발 5명', n: 5, pick: (p) => p.isPitcher && p.position === 'SP', keys: ['stuff', 'control', 'stamina'] },
      { key: 'RP', label: '불펜 6명', n: 6, pick: (p) => p.isPitcher && p.position !== 'SP', keys: ['stuff', 'control'] },
    ];
    const valueOf = (p: PlayerTruth, keys: string[]) => {
      if (own) {
        const r = currentRatings(p);
        const v = keys.reduce((a, k) => a + (r[k] ?? 0), 0) / keys.length;
        return { low: v, high: v, confidence: 100 };
      }
      const snap = this.scouting.get(p.id)!;
      const ranges = snapshotRanges(snap, meta.currentDate);
      const low = keys.reduce((a, k) => a + (ranges[k]?.low ?? 1), 0) / keys.length;
      const high = keys.reduce((a, k) => a + (ranges[k]?.high ?? 100), 0) / keys.length;
      return { low, high, confidence: snap.confidence };
    };
    return groups.map((g) => {
      const vals = players
        .filter(g.pick)
        .map((p) => valueOf(p, g.keys))
        .sort((a, b) => b.low + b.high - (a.low + a.high))
        .slice(0, g.n);
      const avg = (f: (v: { low: number; high: number; confidence: number }) => number) => (vals.length ? Math.round(vals.reduce((a, v) => a + f(v), 0) / vals.length) : 0);
      return { key: g.key, label: g.label, n: vals.length, low: avg((v) => v.low), high: avg((v) => v.high), confidence: avg((v) => v.confidence) };
    });
  }

  /** 구단 화면(3e): 공개 프로필·순위·팀 기록·최근 경기·선수단과 전력 비교. 조회만 하며 상태·난수를 바꾸지 않는다. */
  clubView(clubId: number): ClubView {
    const meta = this.meta();
    const club = this.clubMap.get(clubId);
    if (!club) throw new GameError('INVALID_CLUB', '존재하지 않는 구단입니다.');
    const mine = clubId === meta.userClubId;
    // 기록 기준 시즌: 시즌 모드는 현재 시즌, 스토브리그는 끝난 시즌
    const season = meta.season;
    const totals = this.repo.teamTotals(season);
    const team: ClubView['team'] = [];
    const t = totals.find((x) => x.clubId === clubId);
    if (t && t.bat.PA > 0) {
      const fipC = fipConstant(this.repo.leaguePitchingTotals(season));
      const rows = totals.map((x) => ({ id: x.clubId, b: battingRates(x.bat), p: pitchingRates(x.pit, fipC), hr: x.bat.HR, rf: x.runsFor, ra: x.runsAgainst }));
      const rankOf = (get: (r: (typeof rows)[number]) => number | null, higherBetter: boolean) => {
        const sorted = [...rows].sort((a, b) => ((get(b) ?? 0) - (get(a) ?? 0)) * (higherBetter ? 1 : -1));
        return sorted.findIndex((r) => r.id === clubId) + 1;
      };
      const me = rows.find((r) => r.id === clubId)!;
      const f3 = (v: number | null) => (v === null ? '—' : v.toFixed(3).replace(/^0/, ''));
      const f2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));
      team.push(
        { key: 'R', label: '득점', value: String(me.rf), rank: rankOf((r) => r.rf, true) },
        { key: 'RA', label: '실점', value: String(me.ra), rank: rankOf((r) => r.ra, false) },
        { key: 'AVG', label: '팀 타율', value: f3(me.b.AVG), rank: rankOf((r) => r.b.AVG, true) },
        { key: 'OPS', label: '팀 OPS', value: f3(me.b.OPS), rank: rankOf((r) => r.b.OPS, true) },
        { key: 'HR', label: '팀 홈런', value: String(me.hr), rank: rankOf((r) => r.hr, true) },
        { key: 'ERA', label: '팀 평균자책', value: f2(me.p.ERA), rank: rankOf((r) => r.p.ERA, false) },
        { key: 'WHIP', label: 'WHIP', value: f2(me.p.WHIP), rank: rankOf((r) => r.p.WHIP, false) },
      );
    }
    const recent = this.repo
      .getGames(season)
      .filter((g) => g.home === clubId || g.away === clubId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.fixtureId - a.fixtureId))
      .slice(0, 10)
      .map((g) => {
        const home = g.home === clubId;
        return { date: g.date, opponent: this.ref(home ? g.away : g.home).shortName, home, us: home ? g.homeRuns : g.awayRuns, them: home ? g.awayRuns : g.homeRuns };
      });
    const roster = this.players({ scope: clubId, group: 'all', sortKey: 'name' });
    let comparison: ClubView['comparison'] = null;
    if (!mine) {
      const ours = this.strengthGroups(meta, meta.userClubId);
      const theirs = this.strengthGroups(meta, clubId);
      comparison = theirs.map((g, i) => ({ key: g.key, label: g.label, n: g.n, ours: { low: ours[i]!.low, high: ours[i]!.high }, theirs: { low: g.low, high: g.high }, theirConfidence: g.confidence }));
    }
    return {
      club: this.ref(clubId),
      mine,
      season,
      profile: { city: club.city, stadium: club.stadium, stadiumCapacity: club.stadiumCapacity, parentIndustry: club.parentIndustry, loyalty: club.loyalty },
      stance: this.stanceView(clubId),
      standing: this.standings().find((s) => s.club.id === clubId) ?? null,
      team,
      recent,
      roster,
      payrollWon: roster.reduce((a, p) => a + p.salaryWon, 0),
      comparison,
      note: this.clubNote(meta, clubId),
    };
  }

  /** 운영 기조(공개 정보, D-155): AI 구단만. 매월 1일 평가 */
  private stanceView(clubId: ClubId): ClubView['stance'] {
    const s = this.aiClubs.state(clubId);
    return s ? { key: s.stance, label: STANCE_LABEL[s.stance], since: s.since } : null;
  }

  // ───────── 선수단 운영 (2d, D-119·D-120) ─────────

  /** 선수단 운영 화면: 1·2군, 재등록 제한, 경기 운영 계획·감독 추천, 시범경기 기록. 조회만 한다. */
  rosterView(): RosterView {
    const meta = this.meta();
    const ops = this.rosterOps;
    const players = this.players({ scope: 'mine', group: 'all', sortKey: 'name' });
    const active = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId && p.level === '1군');
    const c = rosterCounts(active);
    const lock = ops.editLock(meta);
    const reRegister: Record<string, string> = {};
    for (const p of players) {
      const d = ops.reRegisterDate(meta, p.id);
      if (d) reRegister[String(p.id)] = d;
    }
    const state = ops.planState(meta);
    let recommended: GamePlanView | null = null;
    try {
      recommended = ops.recommended(meta);
    } catch {
      recommended = null;
    }
    const ex = ops.exhibition(meta);
    const season = meta.mode === 'season' ? meta.season : meta.season + 1;
    const ours = (ex?.games ?? []).filter((g) => g.home === meta.userClubId || g.away === meta.userClubId).map((g) => {
      const home = g.home === meta.userClubId;
      return { date: g.date, opponent: this.ref(home ? g.away : g.home).shortName, home, us: home ? g.homeRuns : g.awayRuns, them: home ? g.awayRuns : g.homeRuns };
    });
    const names = new Map(players.map((p) => [p.id, p.name]));
    return {
      date: meta.currentDate,
      phase: this.phase(meta),
      openingDate: seasonKeyDates(season).opening,
      editable: lock === null,
      lockReason: lock,
      players,
      counts: { active: active.length, activePitchers: c.pitchers, activeHitters: c.hitters, activeCatchers: c.catchers, activeMax: LEAGUE.activeRoster },
      rules: [
        `1군 ${LEAGUE.activeRoster}명 유지: 올리는 선수와 내리는 선수를 함께 정해 한 번에 바꿉니다.`,
        `1군 투수 ${ROSTER_COMPOSITION.activeMinPitchers}명·야수 ${ROSTER_COMPOSITION.activeMinHitters}명·포수 ${ROSTER_MOVE.activeMinCatchers}명 이상`,
        `개막 뒤 2군으로 내린 선수는 ${ROSTER_MOVE.reRegisterDays}일 뒤 다시 등록 가능 (개막 전 캠프·시범경기 기간은 제한 없음)`,
        '명단·타순·로테이션 편집은 행동력을 쓰지 않습니다(D-119). 진행된 경기 결과는 바뀌지 않고 다음 경기부터 반영됩니다.',
      ],
      reRegister,
      mode: state.mode,
      plan: state.plan,
      recommended,
      planProblems: state.plan ? ops.problems(meta, state.plan) : [],
      exhibition: ex
        ? {
            dates: exhibitionDates(ex.season),
            record: { w: ours.filter((g) => g.us > g.them).length, l: ours.filter((g) => g.us < g.them).length, t: ours.filter((g) => g.us === g.them).length },
            games: ours,
            lines: ex.stats,
          }
        : null,
      moves: ops.moves(meta).map((m) => ({ date: m.date, playerId: m.playerId, name: names.get(m.playerId) ?? `#${m.playerId}`, to: m.to })).reverse(),
      training: this.training.rosterTable(meta),
    };
  }

  rosterMove(promote: number[], demote: number[]): { message: string; view: RosterView } {
    const message = this.rosterOps.move(this.meta(), promote ?? [], demote ?? []);
    return { message, view: this.rosterView() };
  }

  rosterSetPlan(mode: 'auto' | 'manual', plan?: GamePlanView): { message: string; view: RosterView } {
    if (mode !== 'auto' && mode !== 'manual') throw new GameError('INVALID', '운영 방식은 자동 또는 수동입니다.');
    const p: GamePlan | undefined = plan
      ? { lineup: (plan.lineup ?? []).map((s) => ({ playerId: Number(s.playerId), position: s.position as GamePlan['lineup'][number]['position'] })), rotation: (plan.rotation ?? []).map(Number), closer: plan.closer === null || plan.closer === undefined ? null : Number(plan.closer) }
      : undefined;
    const message = this.rosterOps.setPlan(this.meta(), mode, p);
    return { message, view: this.rosterView() };
  }

  restPlayer(playerId: number, days: number): OfferResultView {
    return { result: 'accept', message: this.health.rest(this.meta(), playerId, days) };
  }

  medicalCheck(playerId: number): OfferResultView {
    const meta = this.meta();
    return { result: 'accept', message: this.health.medicalCheck(meta, weekIdFor(meta.currentDate), playerId) };
  }

  /** 4b-2 집중 훈련 직접 지시(D-128) */
  trainPlayer(playerId: number, primary: string, secondary: string | null, intensity: TrainingIntensity): OfferResultView {
    const meta = this.meta();
    return { result: 'accept', message: this.training.set(meta, weekIdFor(meta.currentDate), playerId, { primary, secondary: secondary || null, intensity }) };
  }

  trainDelegate(playerId: number): OfferResultView {
    const meta = this.meta();
    return { result: 'accept', message: this.training.delegate(meta, weekIdFor(meta.currentDate), playerId) };
  }

  trainStop(playerId: number): OfferResultView {
    return { result: 'accept', message: this.training.stop(this.meta(), playerId) };
  }

  // ───────── 6a 관중·티켓·시설 (D-141) ─────────

  businessView(): BusinessView {
    const meta = this.meta();
    return { ...this.business.view(meta), sponsors: this.sponsors.view(meta), merch: this.merch.view(meta) };
  }

  chooseVendor(kind: VendorKind, brandId?: string): { message: string; view: BusinessView } {
    const meta = this.meta();
    const message = this.merch.chooseVendor(meta, weekIdFor(meta.currentDate), kind, brandId);
    return { message, view: this.businessView() };
  }

  orderMerch(sku: Sku, qty: number): { message: string; view: BusinessView } {
    const message = this.merch.order(this.meta(), sku, Number(qty));
    return { message, view: this.businessView() };
  }

  setMerchPolicy(auto: boolean, targetWeeks: number): { message: string; view: BusinessView } {
    const message = this.merch.setPolicy(this.meta(), auto, Number(targetWeeks));
    return { message, view: this.businessView() };
  }

  signSponsor(offerId: string): { message: string; view: BusinessView } {
    const meta = this.meta();
    let message = this.sponsors.sign(meta, weekIdFor(meta.currentDate), offerId);
    // 고가 티켓 금지 의무: 지금 고가 정책이면 보통으로 돌린다
    const now = this.meta();
    if (now.ticketPolicy === 'high' && this.sponsors.highPriceBlock(now)) {
      this.business.setPolicy(now, 'normal');
      message += ' 티켓 가격 정책을 보통으로 바꿨습니다.';
    }
    return { message, view: this.businessView() };
  }

  setTicketPolicy(policy: TicketPolicy): { message: string; view: BusinessView } {
    const block = policy === 'high' ? this.sponsors.highPriceBlock(this.meta()) : null;
    if (block) throw new GameError('SPONSOR_RULE', block);
    const message = this.business.setPolicy(this.meta(), policy);
    return { message, view: this.businessView() };
  }

  startFacility(kind: FacilityKind): { message: string; view: BusinessView } {
    const meta = this.meta();
    const message = this.business.start(meta, weekIdFor(meta.currentDate), kind);
    return { message, view: this.businessView() };
  }

  startCampaign(kind: CampaignKind): { message: string; view: BusinessView } {
    const meta = this.meta();
    const message = this.business.startCampaign(meta, weekIdFor(meta.currentDate), kind);
    return { message, view: this.businessView() };
  }

  cancelFacility(kind: FacilityKind): { message: string; view: BusinessView } {
    const message = this.business.cancel(this.meta(), kind);
    return { message, view: this.businessView() };
  }

  // ───────── 5a 트레이드 (D-130·D-131) ─────────

  private tradePkg(p: { give?: number[]; get?: number[]; cashWon?: number }): TradePackageView {
    return { give: Array.isArray(p.give) ? p.give.map(Number) : [], get: Array.isArray(p.get) ? p.get.map(Number) : [], cashWon: Number(p.cashWon ?? 0) };
  }

  private requireOtherClub(clubId: number): ClubProfile {
    const meta = this.meta();
    const club = this.clubMap.get(Number(clubId));
    if (!club || club.id === meta.userClubId) throw new GameError('NOT_AVAILABLE', '트레이드 상대 구단을 고르세요.');
    return club;
  }

  /** 협상 화면: 조회만(비용·상태 변화 없음). 상대 선수는 스카우트 추정 범위로만 */
  tradeView(clubId: number): TradeView {
    const club = this.requireOtherClub(clubId);
    const meta = this.meta();
    const s = this.trades.session(meta, club.id);
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const rows = (scope: 'mine' | number, owner: number) =>
      this.players({ scope, group: 'all', level: 'all', sortKey: 'name', sortDesc: false }).map((item) => {
        const reason = this.trades.tradableReason(meta, players.get(item.id) ?? null, owner);
        return { item, tradable: reason === null, reason };
      });
    const name = (id: number) => players.get(id)?.name ?? `#${id}`;
    const week = this.repo.getApWeek(weekIdFor(meta.currentDate));
    return {
      club: this.ref(club.id),
      date: meta.currentDate,
      windowReason: this.trades.windowReason(meta),
      session: { open: s.open, proposalsLeft: s.proposalsLeft, apCost: s.open ? 0 : TRADE.sessionAp },
      counter: s.counter,
      apRemaining: week ? week.granted - week.used : 0,
      cashWon: this.repo.cashBalance(meta.userClubId),
      limits: { maxPlayers: TRADE.maxPlayersPerSide, maxCashWon: TRADE.maxCashWon, proposalsPerSession: TRADE.proposalsPerSession },
      ours: rows('mine', meta.userClubId),
      theirs: rows(club.id, club.id),
      log: [...s.talk.log].reverse().slice(0, 12).map((l) => ({ date: l.date, kind: l.kind === 'proposal' ? '제안' : l.kind === 'offerAccepted' ? '받은 제안 수락' : '역제안 수락', result: l.result, message: l.message, give: l.pkg.give.map(name), get: l.pkg.get.map(name), cashWon: l.pkg.cashWon })),
      history: (meta.tradeHistory ?? []).filter((h) => h.clubB === club.id || h.clubA === club.id).reverse().map((h) => ({ date: h.date, sent: (h.clubA === meta.userClubId ? h.aToB : h.bToA).map(name), received: (h.clubA === meta.userClubId ? h.bToA : h.aToB).map(name), cashWon: h.clubA === meta.userClubId ? h.cashAtoB : -h.cashAtoB })),
    };
  }

  /** 받은 트레이드 제안(7b, D-157): 조회만. 상대 선수는 스카우트 추정 범위로만 */
  tradeOffersView(): TradeOffersView {
    const meta = this.meta();
    const open = (meta.tradeOffers ?? []).filter((o) => o.status === 'open' && diffDays(meta.currentDate, o.expires) <= 0);
    const week = this.repo.getApWeek(weekIdFor(meta.currentDate));
    const mine = open.length ? this.players({ scope: 'mine', group: 'all', level: 'all', sortKey: 'name', sortDesc: false }) : [];
    return {
      apRemaining: week ? week.granted - week.used : 0,
      offers: open.map((o) => {
        const theirs = this.players({ scope: o.clubId, group: 'all', level: 'all', sortKey: 'name', sortDesc: false });
        const s = this.aiClubs.state(o.clubId);
        return {
          id: o.id,
          club: this.ref(o.clubId),
          stance: s ? STANCE_LABEL[s.stance] : null,
          date: o.date,
          expires: o.expires,
          give: mine.filter((p) => o.pkg.give.includes(p.id)),
          get: theirs.filter((p) => o.pkg.get.includes(p.id)),
          apCost: this.trades.session(meta, o.clubId).open ? 0 : TRADE.sessionAp,
        };
      }),
    };
  }

  tradeRespondOffer(offerId: number, accept: boolean, commandId: string): TradeOfferResultView {
    const r = this.trades.respondOffer(this.meta(), Number(offerId), accept === true, commandId);
    return { result: r.result, message: r.message, apCharged: r.apCharged, view: this.tradeOffersView() };
  }

  /** 재임 기록과 해임 뒤 영입 제안(7b, D-157) */
  careerView(): CareerView {
    const meta = this.meta();
    const ranks = this.stanceRanks();
    const players = this.repo.getPlayers();
    return {
      level: meta.ownerLevel,
      tenures: this.career.summaries(meta).map((t) => ({ club: this.ref(t.clubId), from: t.from, to: t.to, reason: t.reason, seasons: t.seasons, titles: t.titles, postseasons: t.postseasons, startCashWon: t.startCashWon, endCashWon: t.endCashWon })),
      jobOffers: this.career.jobOffers(meta).map((id) => {
        const s = this.aiClubs.state(id);
        return { club: this.ref(id), rank: ranks.get(id) ?? null, stance: s ? STANCE_LABEL[s.stance] : null, payrollWon: players.filter((p) => p.clubId === id && !p.retired).reduce((a, p) => a + p.salary, 0), city: this.clubMap.get(id)!.city };
      }),
    };
  }

  /** 영입 제안 수락(행동력 0). 디스패처가 이 뒤에 서비스를 다시 만든다 */
  acceptJob(clubId: number): { message: string } {
    return this.repo.transaction(() => this.career.acceptJob(this.meta(), Number(clubId)));
  }

  /** 미리보기: 규칙 검사·인원·연봉 변화(무료, 상대 반응 없음) */
  tradePreview(clubId: number, pkg: TradePackageView): TradePreviewView {
    const club = this.requireOtherClub(clubId);
    const v = this.trades.validate(this.meta(), club.id, this.tradePkg(pkg));
    return { errors: v.errors, ours: v.preview.ours, theirs: v.preview.theirs };
  }

  tradePropose(clubId: number, pkg: TradePackageView, commandId: string): TradeResultView {
    const club = this.requireOtherClub(clubId);
    const r = this.trades.propose(this.meta(), club.id, this.tradePkg(pkg), commandId);
    return { ...r, view: this.tradeView(club.id) };
  }

  tradeAcceptCounter(clubId: number, commandId: string): TradeResultView {
    const club = this.requireOtherClub(clubId);
    const r = this.trades.acceptCounter(this.meta(), club.id, commandId);
    return { ...r, view: this.tradeView(club.id) };
  }

  /**
   * 선수 상세 행동 영역(3d, 18a·D-118). 조회만 하며 상태·난수를 바꾸지 않는다.
   * 가능 여부와 불가 사유는 실행 명령과 같은 대상 검증 함수(Market·Organization·SeasonClose)로 계산한다.
   * 영구적으로 맞지 않는 행동(타 구단 선수의 연봉 협상 등)은 목록에서 빼고, 일시 제한은 이유와 함께 비활성으로 보낸다.
   */
  playerActions(playerId: number): PlayerActionsView {
    const meta = this.meta();
    const p = this.repo.getPlayer(playerId);
    if (!p) throw new GameError('PLAYER_NOT_FOUND', '선수를 찾을 수 없습니다.');
    const mv = this.marketView();
    const own = p.clubId === meta.userClubId;
    const reasonOf = (check: () => unknown): string | null => {
      try {
        check();
        return null;
      } catch (e) {
        if (e instanceof GameError) return e.message;
        throw e;
      }
    };
    const apReason = (ap: number) => (mv.apRemaining < ap ? `행동력 ${ap} 필요 (이번 주 남은 행동력 ${mv.apRemaining})` : null);
    const won = (n: number) => `${(n / EOK).toFixed(2).replace(/\.?0+$/, '')}억`;
    const actions: PlayerActionView[] = [];
    const add = (a: Omit<PlayerActionView, 'enabled' | 'primary'>) => actions.push({ ...a, enabled: a.reason === null, primary: false });
    const badges: string[] = [];
    const tasks = this.repo
      .getTasks({ status: ['queued', 'waiting'], targetId: playerId })
      .filter((t): t is typeof t & { kind: 'fa' | 'salary' } => t.kind === 'fa' || t.kind === 'salary')
      .map((t) => ({ taskId: t.id, kind: t.kind, status: TASK_STATUS_LABEL[t.status] ?? t.status, note: t.note }));
    const modeLabel = { direct: '직접 운영', approve: '제안 후 승인', auto: '완전 위임' }[mv.ops.mode];

    // D-130·D-136 계약 세션: 이 선수와 그 주 첫 제안만 행동력 1, 같은 주 3회까지
    const cs = this.market.contractSession(meta, playerId);
    const sessionReason = cs.offersLeft <= 0 ? `이번 주 이 선수에게 제안 ${CONTRACT.offersPerSession}회를 모두 했습니다(다음 주 다시 행동력 1).` : apReason(cs.apCost);
    const sessionText = (wp: number) => (cs.open ? `구단주 직접 · 이번 주 협상 중(남은 제안 ${cs.offersLeft}회)` : `구단주 직접 · 이번 주 첫 제안 · 운영팀 처리량 ${directWpCost(wp)}`);

    const fa = p.retired ? null : (mv.fa.find((f) => f.playerId === playerId && (f.statusKey === 'applied' || f.statusKey === 'approved')) ?? null);
    if (fa) {
      badges.push(fa.status);
      add({
        key: 'faOffer',
        group: '계약·이적',
        label: fa.originClub.id === meta.userClubId ? 'FA 잔류 협상' : 'FA 영입 제안',
        reason: reasonOf(() => this.market.faTarget(meta, playerId)) ?? sessionReason ?? (mv.cashWon < fa.compensationWon ? `현금 부족: 보상금 ${won(fa.compensationWon)} 필요` : null),
        apCost: cs.apCost,
        executor: sessionText(TASK_WP.faRound),
        costNote: `계약금(입력값)${fa.compensationWon > 0 ? ` + 보상금 ${won(fa.compensationWon)}` : ''} 계약 시 즉시 지급, 연봉은 계약 기간 동안 지급`,
      });
      add({
        key: 'faDelegate',
        group: '계약·이적',
        label: tasks.some((t) => t.kind === 'fa') ? '위임 한도 변경' : '운영팀에 맡기기',
        reason: reasonOf(() => this.org.faDelegationTarget(meta, playerId)),
        apCost: 0,
        executor: `운영팀 ${modeLabel} · 1회 협상 처리량 ${TASK_WP.faRound}`,
        costNote: '정책의 총액·기간·현금 하한 안에서만 제안',
      });
    }

    const salary = own ? (mv.salaryTalks.find((t) => t.playerId === playerId) ?? null) : null;
    if (salary && salary.status === '협상 중') {
      badges.push('연봉 협상 대상');
      add({
        key: 'salaryOffer',
        group: '계약·이적',
        label: '연봉 제시',
        reason: reasonOf(() => this.market.salaryTarget(meta, playerId)) ?? sessionReason,
        apCost: cs.apCost,
        executor: sessionText(TASK_WP.salaryTalk),
        costNote: '합의하면 다음 시즌 연봉이 바뀜',
      });
      add({
        key: 'salaryDelegate',
        group: '계약·이적',
        label: '연봉 협상 맡기기',
        reason: reasonOf(() => this.org.salaryDelegationTarget(meta, playerId)),
        apCost: 0,
        executor: `운영팀 ${modeLabel} · 1회 제시 처리량 ${TASK_WP.salaryTalk}`,
        costNote: '정책의 연봉 협상 한도 안에서 매주 제시',
      });
    }

    const foreignCandidate = !p.retired && p.origin !== 'domestic' && (own ? p.contractYears === 0 : p.clubId === null);
    const foreign = foreignCandidate ? (mv.foreign.mine.find((f) => f.playerId === playerId) ?? mv.foreign.pool.find((f) => f.playerId === playerId) ?? null) : null;
    if (foreignCandidate) {
      badges.push(own ? '외국인 계약 만료' : '해외 영입 후보');
      const ruleReason = reasonOf(() => {
        const t = this.market.foreignTarget(meta, playerId);
        const errors = this.market.foreignRuleErrors(meta, t.p, t.renewal, t.demandUsd);
        if (errors.length) throw new GameError('FOREIGN_RULE', errors.join(' '));
      });
      add({
        key: 'foreignOffer',
        group: '계약·이적',
        label: own ? '외국인 재계약' : '외국인 영입 제안',
        reason: ruleReason ?? sessionReason,
        apCost: cs.apCost,
        executor: `${sessionText(TASK_WP.foreignContract)} (외국인 위임은 아직 없음)`,
        costNote: '1년 계약, 연봉은 달러 환산으로 지급',
      });
    }

    // 5b 연장 계약(D-136): 시즌 중 계약 마지막 해인 우리 국내 선수
    let extension: PlayerActionsView['extension'] = null;
    if (own && !p.retired && p.origin === 'domestic' && p.contractYears === 0 && meta.mode === 'season') {
      let reason: string | null = null;
      try {
        const t = this.market.extensionTarget(meta, playerId);
        extension = { demand: { years: t.demand.years, salaryWon: t.demand.salary, bonusWon: t.demand.bonus, totalWon: offerTotal(t.demand) } };
        badges.push('계약 마지막 해');
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
        reason = e.message;
      }
      add({ key: 'extensionOffer', group: '계약·이적', label: '연장 계약 제안', reason: reason ?? sessionReason, apCost: cs.apCost, executor: sessionText(TASK_WP.faRound), costNote: '계약금은 합의 즉시 지급, 새 연봉은 다음 시즌부터. 합의하면 이번 시즌 뒤 FA·연봉 협상 대상에서 빠짐' });
    }
    // 5b 국내 무소속 선수 영입(D-136)
    let domestic: PlayerActionsView['domestic'] = null;
    if (!p.retired && p.clubId === null && p.origin === 'domestic' && !fa) {
      let reason: string | null = null;
      try {
        domestic = { demandWon: this.market.domesticTarget(meta, playerId).demand };
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
        reason = e.message;
      }
      badges.push('국내 무소속');
      add({ key: 'domesticOffer', group: '계약·이적', label: '무소속 선수 영입', reason: reason ?? sessionReason, apCost: cs.apCost, executor: sessionText(TASK_WP.salaryTalk), costNote: '1년 계약, 2군 등록. 선수단 40명 이하' });
    }

    // 5a 트레이드 문의(D-131): 다른 구단 계약 선수 → 같은 협상 화면·세션을 연다(이동만, 비용은 실제 제안 때)
    if (!own && !p.retired && p.clubId !== null) {
      const s = this.trades.session(meta, p.clubId);
      add({
        key: 'tradeInquiry',
        group: '계약·이적',
        label: s.open ? '트레이드 협상 보기' : '트레이드 문의',
        reason: this.trades.windowReason(meta) ?? this.trades.tradableReason(meta, p, p.clubId),
        apCost: 0,
        executor: `구단주 직접 · 제안 때 ${s.open ? `이번 주 협상 중(남은 제안 ${s.proposalsLeft}회)` : `세션 행동력 ${TRADE.sessionAp} + 운영팀 처리량 ${directWpCost(TASK_WP.tradeRound)}`}`,
        costNote: '교환안 작성·미리보기는 무료. 상대 구단과 그 주 첫 제안 때 행동력 1, 같은 주 제안 3회까지',
      });
    }

    const pending = (meta.retirementPending ?? []).find((x) => x.playerId === playerId) ?? null;
    if (pending) {
      badges.push(`은퇴 고민 (설득 기한 ${pending.deadline.slice(5).replace('-', '/')})`);
      add({
        key: 'persuade',
        group: '면담',
        label: '은퇴 설득 면담',
        reason: reasonOf(() => this.seasonClose.persuadeTarget(meta, playerId)) ?? apReason(CLOSE_RULES.persuadeAp),
        apCost: CLOSE_RULES.persuadeAp,
        executor: '구단주 면담 · 즉시',
        costNote: null,
      });
    }

    // 4b-1 건강(D-126): 휴식 지시(행동력 0), 특별 검사(행동력 1)
    if (own && !p.retired) {
      add({ key: 'rest', group: '건강', label: '휴식 지시', reason: reasonOf(() => this.health.restTarget(meta, playerId, 1)), apCost: 0, executor: '감독·트레이너 · 오늘부터', costNote: '1~3일 경기 제외(피로 회복). 진행된 경기는 바뀌지 않음' });
      add({ key: 'medicalCheck', group: '건강', label: '특별 검사', reason: reasonOf(() => this.health.checkTarget(meta, playerId)) ?? apReason(HEALTH.checkAp), apCost: HEALTH.checkAp, executor: '컨디셔닝·메디컬팀 · 즉시', costNote: '부상 중이면 복귀 전망을 좁히고, 건강하면 부상 위험 등급을 보고' });
      if (p.health?.injury && diffDays(meta.currentDate, p.health.injury.returnDate) < 0) badges.push('부상');
      else if (meta.restOrders?.[String(playerId)] && diffDays(meta.currentDate, meta.restOrders[String(playerId)]!) <= 0) badges.push('휴식 중');
    }
    // 4b-2 집중 훈련(D-128): 새 지시·목표 변경 행동력 1, 강도 변경·중단 0, 육성팀에 맡기기 처리량 4
    let training: PlayerActionsView['training'] = null;
    if (own && !p.retired) {
      training = this.training.view(meta, p);
      const hurtNow = !!p.health?.injury && diffDays(meta.currentDate, p.health.injury.returnDate) < 0;
      add({
        key: 'train',
        group: '육성',
        label: training.plan ? '훈련 계획 변경' : '집중 훈련 지시',
        reason: hurtNow && !training.plan ? '부상 중: 복귀 뒤 새 훈련을 지시할 수 있습니다.' : training.plan ? null : apReason(TRAINING.directAp),
        apCost: TRAINING.directAp,
        executor: `구단주 직접 · 육성팀 처리량 ${directWpCost(TRAINING.planWp)} · 담당 ${training.coach.part} 코치`,
        costNote: '목표를 새로 정하거나 바꿀 때 행동력 1. 강도만 바꾸면 행동력 0. 월간 반영일에 지난 기간 비율만큼 효과',
      });
      add({
        key: 'trainDelegate',
        group: '육성',
        label: '육성팀에 맡기기',
        reason: reasonOf(() => this.training.delegateTarget(meta, playerId)) ?? (training.devWpLeft < TRAINING.planWp ? `육성팀 이번 주 처리량 부족(필요 ${TRAINING.planWp}, 남음 ${training.devWpLeft})` : null),
        apCost: 0,
        executor: `육성팀${training.delegateName ? `(${training.delegateName})` : ''} · 처리량 ${TRAINING.planWp}`,
        costNote: '육성팀이 목표를 고르고 강도는 보통. 판단 정확도는 육성팀 역량에 따름',
      });
      if (training.plan) add({ key: 'trainStop', group: '육성', label: '훈련 중단', reason: null, apCost: 0, executor: '구단주 직접 · 즉시', costNote: '기본 훈련(4a 성장)만 남음' });
      if (training.plan) badges.push(`집중 훈련: ${training.plan.primaryLabel}`);
    }
    let release: PlayerActionsView['release'] = null;
    if (own && !p.retired) {
      const remainingWon = p.salary * p.contractYears;
      release = {
        salaryWon: p.salary,
        contractYears: p.contractYears,
        remainingWon,
        rosterCount: mv.rosterCount,
        rosterMax: mv.rosterMax,
        note: meta.mode === 'stove' ? null : '시즌 중 방출은 현재 단순 방출입니다(웨이버 절차는 아직 구현되지 않음).',
      };
      add({
        key: 'release',
        group: '선수 정리',
        label: '방출',
        reason: reasonOf(() => this.market.releaseTarget(meta, playerId)),
        apCost: 0,
        executor: '구단주 직접 · 즉시',
        costNote: remainingWon > 0 ? `남은 계약 ${p.contractYears}년치 연봉 ${won(remainingWon)}을 원래 일정대로 계속 지급` : '남은 보장 연봉 없음',
      });
    }
    if (tasks.length) badges.push('위임 진행 중');

    // 주요 행동: 기한이 있는 설득 → 계약 협상 순. 방출은 추천하지 않는다(18a 4장).
    const order: PlayerActionView['key'][] = ['persuade', 'faOffer', 'salaryOffer', 'foreignOffer', 'extensionOffer', 'domesticOffer'];
    const primary = order.map((k) => actions.find((a) => a.key === k && a.enabled)).find(Boolean);
    if (primary) primary.primary = true;

    const usd = (wonAmount: number) => `${Math.round(wonToUsd(wonAmount) / 10_000)}만 달러`;
    const kindLabel: Record<string, string> = { fa: 'FA', salary: '연봉', foreign: '외국인' };
    const statusLabel: Record<string, string> = { accepted: '합의', rejected: '거절', countered: '역제안', withdrawn: '철회', pending: '대기', expired: '만료' };
    const history = this.repo
      .getOffers({ playerId, clubId: meta.userClubId })
      .slice(-6)
      .reverse()
      .map((o) => ({
        date: o.date,
        kind: kindLabel[o.kind] ?? o.kind,
        status: statusLabel[o.status] ?? o.status,
        text: `${o.kind === 'fa' ? `${o.offer.years}년 연봉 ${won(o.offer.salary)}·계약금 ${won(o.offer.bonus)}` : o.kind === 'foreign' ? usd(o.offer.salary) : `연봉 ${won(o.offer.salary)}`}${o.response ? ` — ${o.response}` : ''}`,
      }));

    return {
      playerId,
      clubId: p.clubId,
      date: meta.currentDate,
      apRemaining: mv.apRemaining,
      cashWon: mv.cashWon,
      badges,
      actions,
      fa,
      salary,
      foreign,
      release,
      persuade: pending ? { reason: pending.reason, deadline: pending.deadline } : null,
      extension,
      domestic,
      training,
      ops: mv.ops,
      tasks,
      history,
    };
  }

  private battingSummary(t: BattingTotals | undefined) {
    if (!t) return { G: 0, PA: 0, AVG: null, HR: 0, RBI: 0, OPS: null };
    const r = battingRates(t);
    return { G: t.G, PA: t.PA, AVG: r.AVG, HR: t.HR, RBI: t.RBI, OPS: r.OPS };
  }

  private pitchingSummary(t: PitchingTotals | undefined, fipC: number | null) {
    if (!t) return { G: 0, IP: 0, ERA: null, W: 0, L: 0, SV: 0, K: 0 };
    const r = pitchingRates(t, fipC);
    return { G: t.G, IP: t.OUTS / 3, ERA: r.ERA, W: t.W, L: t.L, SV: t.SV, K: t.K };
  }

  private listItem(p: PlayerTruth, meta: GameMeta, bat?: BattingTotals, pit?: PitchingTotals, fipC: number | null = null, scale = 1): PlayerListItem {
    return {
      id: p.id,
      name: p.name,
      club: p.clubId ? this.ref(p.clubId) : null,
      level: p.level,
      position: p.position,
      isPitcher: p.isPitcher,
      age: ageOn(p.birthDate, meta.currentDate),
      bats: p.bats,
      throws: p.throws,
      salaryWon: p.salary,
      ratings: p.clubId === meta.userClubId ? currentRatings(p) : {},
      ratingRanges: p.clubId === meta.userClubId ? {} : snapshotRanges(this.scouting.get(p.id)!, meta.currentDate),
      watched: this.repo.getPlayerNote(p.id).watched,
      stats: p.isPitcher ? this.pitchingSummary(pit, fipC) : this.battingSummary(bat),
      faEligible: p.career.faEligible,
      franchise: p.career.franchise && p.clubId === meta.userClubId,
      contractYears: p.contractYears,
      healthStatus: this.health.status(meta, p),
    };
  }

  players(q: PlayerQuery): PlayerListItem[] {
    const meta = this.meta();
    let list = this.repo.getPlayers();
    if (q.scope === 'mine') list = list.filter((p) => p.clubId === meta.userClubId);
    else if (typeof q.scope === 'number') list = list.filter((p) => p.clubId === q.scope);
    if (q.group === 'hitters') list = list.filter((p) => !p.isPitcher);
    if (q.group === 'pitchers') list = list.filter((p) => p.isPitcher);
    if (q.level && q.level !== 'all') list = list.filter((p) => p.level === q.level);
    if (q.search) list = list.filter((p) => p.name.includes(q.search!));
    const ids = list.map((p) => p.id);
    const bat = this.repo.battingTotals(meta.season, ids);
    const pit = this.repo.pitchingTotals(meta.season, ids);
    const fipC = fipConstant(this.repo.leaguePitchingTotals(meta.season));
    const scale = this.org.scoutingScale(meta);
    const items = list.map((p) => this.listItem(p, meta, bat.get(p.id), pit.get(p.id), fipC, scale));
    if (q.sortKey) {
      const key = q.sortKey;
      const get = (i: PlayerListItem): number | string => {
        if (key === 'name') return i.name;
        if (key === 'age') return i.age;
        if (key === 'salary') return i.salaryWon;
        if (key in i.ratings) return i.ratings[key] ?? -1;
        if (key in i.ratingRanges) { const r = i.ratingRanges[key]!; return (r.low + r.high) / 2; }
        const v = i.stats[key];
        return v === null || v === undefined ? -Infinity : v;
      };
      items.sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        const cmp = typeof va === 'string' ? va.localeCompare(String(vb), 'ko') : (va as number) - (vb as number);
        return (q.sortDesc ? -cmp : cmp) || a.id - b.id;
      });
    }
    return items;
  }

  player(playerId: number): PlayerDetailView {
    const meta = this.meta();
    const p = this.repo.getPlayer(playerId);
    if (!p) throw new GameError('PLAYER_NOT_FOUND', '선수를 찾을 수 없습니다.');
    const bat = this.repo.battingTotals(meta.season, [p.id]).get(p.id);
    const pit = this.repo.pitchingTotals(meta.season, [p.id]).get(p.id);
    const fipC = fipConstant(this.repo.leaguePitchingTotals(meta.season));
    const scale = this.org.scoutingScale(meta);
    const base = this.listItem(p, meta, bat, pit, fipC, scale);
    const own = p.clubId === meta.userClubId;
    const snapshot = this.scouting.get(p.id)!;
    const allRatings = own ? currentRatings(p) : {};
    const allRanges = own ? {} : snapshotRanges(snapshot, meta.currentDate);
    const neighbors = this.repo.getPlayers().filter(x => !x.retired && x.isPitcher === p.isPitcher && x.clubId === p.clubId).sort((a,b) => a.id - b.id);
    const index = neighbors.findIndex(x => x.id === p.id);
    const limit = p.isPitcher ? PROBABILITY_CONFIG.form.recentWindow.pitcherPa : PROBABILITY_CONFIG.form.recentWindow.batterPa;
    const sample = this.forms.sampleCount(meta.season, meta.currentDate, p.id, p.isPitcher);
    const record = this.records.playerRecord(meta, p);
    // 스프레이 차트: 이번 시즌 기록이 없으면 직전 시즌(압축된 시즌은 합계 표에서 읽는다, D-106)
    let spray: PlayerDetailView['spray'] = null;
    for (const season of [meta.season, meta.season - 1]) {
      if (season <= NEW_GAME.previousSeason) continue;
      const rows = this.repo.sprayTotals(season, p.id);
      if (rows.length === 0) continue;
      const types = (['GB', 'LD', 'FB'] as const).map((type) => ({ type, n: rows.filter((r) => r.type === type).reduce((a, r) => a + r.n, 0), h: rows.filter((r) => r.type === type).reduce((a, r) => a + r.h, 0) }));
      const zones = new Map<string, { zone: string; n: number; h: number; xbh: number }>();
      for (const r of rows) {
        const z = zones.get(r.zone) ?? { zone: r.zone, n: 0, h: 0, xbh: 0 };
        z.n += r.n;
        z.h += r.h;
        z.xbh += r.xbh;
        zones.set(r.zone, z);
      }
      spray = { season, balls: rows.reduce((a, r) => a + r.n, 0), zones: [...zones.values()], types };
      break;
    }
    const fielding: PlayerDetailView['fielding'] = [];
    for (let season = meta.season; season >= Math.max(NEW_GAME.firstSeason, meta.season - 3); season--) {
      const line = fieldingLine(season, this.repo.fieldingTotals(season, p.id));
      if (line.TC > 0) fielding.push(line);
    }
    return {
      ...base,
      scouting: { confidence: snapshot.confidence, date: snapshot.date, observer: snapshot.observer, stale: diffDays(meta.currentDate, snapshot.date) >= SCOUTING.staleDays, reports: snapshot.evidence.length - 1, nextDate: snapshot.confidence > 0 ? addDays(snapshot.date, SCOUTING.cooldownDays) : meta.currentDate, apCost: SCOUTING.ap },
      traits: snapshot.traits.length ? snapshot.traits : [{ label: '성향', text: '판단 유보 — 관찰 근거가 부족합니다.' }],
      pitches: (p.pitches ?? []).map((pitch, i) => ({ type: pitch.type, values: Object.fromEntries(Object.entries(allRatings).filter(([k]) => k.startsWith('pitch_' + i + '_')).map(([k,v]) => [k.split('_').slice(2).join('_'),v])), ranges: Object.fromEntries(Object.entries(allRanges).filter(([k]) => k.startsWith('pitch_' + i + '_')).map(([k,v]) => [k.split('_').slice(2).join('_'),v])) })),
      recentSample: { count: sample, limit, sufficient: sample >= limit },
      note: this.repo.getPlayerNote(p.id),
      previousId: neighbors[index - 1]?.id ?? null,
      nextId: neighbors[index + 1]?.id ?? null,
      birthDate: p.birthDate,
      proSeasons: p.career.proSeasons,
      faServiceYears: p.career.faServiceYears,
      battingStats: !p.isPitcher && bat ? { ...bat, ...battingRates(bat) } : null,
      pitchingStats: p.isPitcher && pit ? { ...pit, IP: pit.OUTS / 3, ...pitchingRates(pit, fipC) } : null,
      observationNote: own
        ? '현재 능력치는 실제값입니다. 히든 성향은 관찰에 따른 의견입니다.'
        : '스카우트 추정 범위입니다. 실제 능력을 반드시 포함하지는 않습니다.',
      exactRatings: own,
      record,
      spray,
      fielding,
      honors: p.honors ?? [],
      draftInfo: p.draft ? `${p.draft.year} 신인 드래프트 ${p.draft.round}라운드 ${p.draft.pick}순위 (${p.draft.school})` : null,
      retired: p.retired ? `${p.retired.season} 시즌 뒤 은퇴 (${p.retired.reason})` : null,
      health: this.health.view(meta, p, own),
      development: own && p.dev?.base ? this.developmentOf(p) : own ? { since: null, settled: false, changes: [] } : null,
    };
  }

  /** 우리 선수의 지난 결산 뒤 능력 변화(4a). 실제 능력 공개 규칙상 우리 선수에게만 쓴다. */
  private developmentOf(p: PlayerTruth): NonNullable<PlayerDetailView['development']> {
    const base = p.dev!.base!;
    const now = devSnapshot(p);
    const changes = Object.entries(now)
      .filter(([k]) => base[k] !== undefined)
      .map(([k, v]) => ({ key: k, label: DEV_LABEL[k] ?? k, delta: k === VELOCITY ? Math.round((v - base[k]!) * 10) / 10 : v - base[k]! }))
      .filter((c) => c.delta !== 0);
    return { since: p.dev!.baseDate ?? null, settled: p.dev!.season !== undefined, changes };
  }

  boxScore(fixtureId: number): BoxScoreView {
    const game = this.repo.getGame(fixtureId);
    if (!game) throw new GameError('GAME_NOT_PLAYED', '아직 치르지 않은 경기입니다.');
    const { pas, runs, plays } = this.repo.getGameEvents(fixtureId);
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const name = (id: number) => players.get(id)?.name ?? `#${id}`;
    const batting = { home: [] as BoxScoreView['batting']['home'], away: [] as BoxScoreView['batting']['away'] };
    const pitching = { home: [] as BoxScoreView['pitching']['home'], away: [] as BoxScoreView['pitching']['away'] };
    const hits = { home: 0, away: 0 };
    const sideOf = (clubId: number) => (clubId === game.home ? 'home' : 'away');
    const batLine = new Map<number, BoxScoreView['batting']['home'][number]>();
    const pitLine = new Map<number, BoxScoreView['pitching']['home'][number] & { outs: number }>();
    const isHit = (o: string) => o === '1B' || o === '2B' || o === '3B' || o === 'HR';
    const isAb = (o: string) => !['BB', 'HBP', 'SF', 'SH'].includes(o);
    for (const pa of pas) {
      const bSide = sideOf(pa.battingClub);
      const pSide = bSide === 'home' ? 'away' : 'home';
      let b = batLine.get(pa.batterId);
      if (!b) {
        b = { playerId: pa.batterId, name: name(pa.batterId), position: players.get(pa.batterId)?.position ?? '', PA: 0, AB: 0, R: 0, H: 0, RBI: 0, HR: 0, BB: 0, SO: 0, NP: 0 };
        batLine.set(pa.batterId, b);
        batting[bSide].push(b);
      }
      b.PA++;
      if (isAb(pa.outcome)) b.AB++;
      if (isHit(pa.outcome)) {
        b.H++;
        hits[bSide]++;
      }
      if (pa.outcome === 'HR') b.HR++;
      if (pa.outcome === 'BB') b.BB++;
      if (pa.outcome === 'K') b.SO++;
      b.RBI += pa.rbi;
      b.NP += pa.pitches;
      let p = pitLine.get(pa.pitcherId);
      if (!p) {
        const decision = game.winningPitcher === pa.pitcherId ? 'W' : game.losingPitcher === pa.pitcherId ? 'L' : game.savePitcher === pa.pitcherId ? 'S' : '';
        p = { playerId: pa.pitcherId, name: name(pa.pitcherId), IP: '0.0', H: 0, R: 0, ER: 0, BB: 0, K: 0, HR: 0, pitches: 0, decision, outs: 0 };
        pitLine.set(pa.pitcherId, p);
        pitching[pSide].push(p);
      }
      p.outs += pa.outsOnPlay;
      p.pitches += pa.pitches;
      if (isHit(pa.outcome)) p.H++;
      if (pa.outcome === 'BB') p.BB++;
      if (pa.outcome === 'K') p.K++;
      if (pa.outcome === 'HR') p.HR++;
    }
    for (const r of runs) {
      const b = batLine.get(r.runnerId);
      if (b) b.R++;
      const p = pitLine.get(r.pitcherId);
      if (p) {
        p.R++;
        if (r.earned) p.ER++;
      }
    }
    // 4c-2a: 주루 사건 아웃(도루 실패·견제사)은 그때 던진 투수의 아웃이다
    for (const pl of plays) {
      const p = pitLine.get(pl.pitcherId);
      if (p) p.outs += pl.outsOnPlay;
    }
    for (const p of pitLine.values()) p.IP = formatInnings(p.outs);
    const outcomeText: Record<string, string> = { '1B': '안타', '2B': '2루타', '3B': '3루타', HR: '홈런', BB: '볼넷', HBP: '몸에 맞는 공', K: '삼진', GO: '땅볼 아웃', FO: '뜬공 아웃', DP: '병살타', SF: '희생플라이', SH: '희생번트', ROE: '실책 출루', FC: '야수 선택' };
    // 인플레이 타구는 처리(또는 쫓아간) 수비수를 함께 보여 준다(10b §11 기록).
    const playByPlay = pas.map((pa) => ({ inning: pa.inning, half: pa.half, text: `${name(pa.batterId)}: ${outcomeText[pa.outcome] ?? pa.outcome}${pa.fielderId ? ` · ${name(pa.fielderId)}` : ''}${pa.rbi ? ` (${pa.rbi}타점)` : ''}` }));
    const stripOuts = (list: Array<BoxScoreView['pitching']['home'][number] & { outs?: number }>) => list.map(({ outs: _o, ...rest }) => rest);
    // 압축된 지난 시즌 경기는 최종 스코어·이닝별 점수만 남아 있다(D-106).
    const detailKept = pas.length > 0 || !this.repo.isCompressed(game.season);
    return {
      fixture: this.fixtureView({ id: game.fixtureId, date: game.date, home: game.home, away: game.away }, game),
      lineScore: game.lineScore,
      detailKept,
      hits: detailKept ? hits : null,
      batting,
      pitching: { home: stripOuts(pitching.home), away: stripOuts(pitching.away) },
      playByPlay,
    };
  }
}
