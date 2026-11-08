// 게임 진행: 사용자 명령 검증·처리와 조회. 엔진 규칙을 호출하고 결과를 저장 계층에 반영한다.
import { addDays, ageOn, diffDays, mondayOf, weekday, type GameDate } from '../engine/calendar';
import { CLUB_PROFILES, SEASON_2026_STANDINGS } from '../engine/clubs';
import { FOREIGN, INFLATION, LEAGUE, NEW_GAME, RULES_VERSION } from '../engine/config';
import { compensationFor, foreignRenewalDemandUsd, offerTotal, wonToUsd, type ContractOffer } from '../engine/contracts';
import { CATEGORY_LABEL, FINANCE_BASE, NOT_YET_IMPLEMENTED, scheduledEntries, stadiumFee, type LedgerEntry } from '../engine/finance';
import { simulateGame, type GameResult } from '../engine/gamesim';
import { prepareTeam } from '../engine/lineup';
import { EOK } from '../engine/money';
import { observePlayer } from '../engine/observation';
import { weeklyAp, xpToNext } from '../engine/owner';
import { Rng, stableNormal, type RngState } from '../engine/rng';
import { generateSchedule, seasonKeyDates, validateSchedule } from '../engine/schedule';
import { battingRates, fipConstant, formatInnings, pitchingRates, type BattingTotals, type PitchingTotals } from '../engine/stats';
import { computeStandings } from '../engine/standings';
import { ABILITY_LABEL, teamCapacity, teamDef, TEAMS, type StaffMember, type TeamKey } from '../engine/staff';
import { seasonModeStart, stoveEvents } from '../engine/stove';
import type { ClubId, ClubProfile, PlayerTruth } from '../engine/types';
import { clubHistory } from '../engine/data/history';
import { generateHistory } from '../engine/history';
import { asTruth, generateAmateurs } from '../engine/amateur';
import { assignFaCandidates, generateOverseasPool, generateWorld } from '../engine/worldgen';
import { Achievements } from './achievements';
import { Market } from './market';
import { Records } from './records';
import { Draft, draftDate, isSenior } from './draft';
import { CLOSE_RULES, SeasonClose } from './seasonClose';
import { Postseason, POSTSEASON_MAX_INNINGS, SERIES_LABEL } from './postseason';
import { DELEGABLE_TEAMS, ORG_AP, Organization } from './organization';
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

  constructor(private readonly repo: GameRepository) {
    this.clubMap = new Map(repo.getClubs().map((c) => [c.id, c]));
    this.market = new Market(repo, this.clubMap, (source, team, wp) => this.org.charge(this.meta(), source, team, wp));
    this.org = new Organization(repo, this.market);
    this.achievements = new Achievements(repo);
    this.postseason = new Postseason(repo);
    this.draft = new Draft(repo);
    this.seasonClose = new SeasonClose(repo, this.draft);
    this.records = new Records(repo, (id) => this.clubMap.get(id)?.shortName ?? `#${id}`);
    // 2b 저장본: 직원이 없으면 시드로 만든다. 이번 주 처리량이 없으면 지급한다.
    repo.transaction(() => {
      const meta = this.meta();
      this.org.ensureStaff(meta, [...this.clubMap.keys()]);
      this.org.ensureWeek(meta, weekIdFor(meta.currentDate));
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
    const blocking = this.market.blockingIssue(meta, date);
    if (blocking) throw new GameError('ROSTER_OVER_LIMIT', blocking);
    // 선수 시장 처리와 하루 결과는 하나의 트랜잭션으로 반영한다.
    return this.repo.transaction(() => this.processDay(meta, date));
  }

  private processDay(meta: GameMeta, date: GameDate): { gamesPlayed: number } {
    // 1) 일정 사건 → 리그 소식, 선수 시장(FA·연봉 협상·외국인·명단 정리)
    const inbox: InboxMessage[] = this.repo.getCalendarEvents(date, date).map((e) => ({ date, kind: 'news', sender: 'KBO 소식', title: e.title, body: this.eventBody(e, meta) }));
    const market = this.market.onDay(date, meta);
    inbox.push(...market.inbox);
    // 위임 업무 큐(운영팀·경영지원팀): 시장 처리(월요일 AI 제안) 뒤에 같은 도메인 로직으로 실행한다.
    inbox.push(...this.org.onDay(meta, date));

    // 2) 경기 (정규시즌)
    const results: GameResult[] = [];
    const fixtures = meta.mode === 'season' ? this.repo.getFixturesOn(date) : [];
    if (fixtures.length > 0) {
      const clubIds = fixtures.flatMap((f) => [f.home, f.away]);
      const active = this.repo.getActivePlayers(clubIds);
      const usage = this.repo.getRecentPitcherUsage(addDays(date, -6), date).map((u) => ({ ...u, daysAgo: diffDays(date, u.date) }));
      const lastStarters = this.repo.getLastStarters(meta.season);
      for (const f of fixtures) {
        const teamOf = (clubId: ClubId) => prepareTeam(clubId, active.filter((p) => p.clubId === clubId), usage, lastStarters.get(clubId) ?? null);
        // 경기 난수는 (시드, 경기 ID)에서 파생한다. 처리 순서와 무관하게 같은 경기는 같은 결과를 낸다.
        const maxInnings = f.stage && f.stage !== 'regular' ? POSTSEASON_MAX_INNINGS : LEAGUE.regularSeasonMaxInnings;
        results.push(simulateGame(f.id, teamOf(f.home), teamOf(f.away), Rng.derive(meta.seed, 'game', f.id), maxInnings));
      }
    }

    // 3) 정기 수입·지출 (모든 구단)
    const players = this.repo.getPlayers();
    const obligations = this.repo.getObligations().filter((o) => o.seasons.includes(meta.season));
    // 직원 급여는 월말에만 지급하므로 그날만 합계를 낸다.
    const staffPayroll = addDays(date, 1).slice(8, 10) === '01' ? this.org.payrollByClub() : new Map<ClubId, number>();
    const ledger: LedgerEntry[] = [...market.ledger];
    for (const club of this.clubMap.values()) {
      ledger.push(
        ...scheduledEntries({
          date,
          seasonYear: meta.season,
          inflationBp: meta.inflationBp,
          club: club.id === meta.userClubId ? this.supportAdjusted(meta, club) : club,
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
    const metaUpdate: Partial<GameMeta> = { currentDate: next };
    if (meta.mode === 'stove' && next === seasonModeStart(Number(meta.kDate.slice(0, 4)))) {
      const season = meta.season + 1;
      const business = new Rng(meta.rngStreams.business as RngState);
      const rate = INFLATION.minBp + business.int(0, INFLATION.maxBp - INFLATION.minBp);
      metaUpdate.mode = 'season';
      metaUpdate.season = season;
      metaUpdate.inflationBp = { ...meta.inflationBp, [String(season)]: rate };
      metaUpdate.rngStreams = { ...meta.rngStreams, business: business.state() };
      this.market.onSeasonStart();
      // 성적 기본 목표: 시즌 모드 시작 때 예상 순위로 고정한다(02 문서).
      const expectedRank = this.seasonClose.expectedRank(meta, meta.userClubId, season);
      metaUpdate.seasonGoal = { season, expectedRank };
      inbox.push({ date: next, kind: 'task', sender: '모기업', title: `${season} 시즌 목표: 정규시즌 ${expectedRank}위 이내`, body: `직전 시즌 순위와 전력 평가로 정한 예상 순위입니다. 달성하면 구단주 경험치를 받고, ${CLOSE_RULES.warnAfterMisses}시즌 연속 미달이면 지원 삭감 경고, ${CLOSE_RULES.dismissAfterMisses}시즌 연속이면 해임입니다.` });
      inbox.push({ date: next, kind: 'report', sender: '사업본부장', title: `${season} 시즌 물가 상승률 ${(rate / 100).toFixed(2)}%`, body: `올해 비용·가격·시세 기준값이 ${(rate / 100).toFixed(2)}% 올랐습니다. 이미 맺은 계약 금액은 바뀌지 않습니다.` });
    }
    const nextWeek = weekIdFor(next);
    const apGrant = weekday(next) === 1 && !this.repo.getApWeek(nextWeek) ? { weekId: nextWeek, granted: weeklyAp(meta.ownerLevel), used: 0 } : null;
    if (weekday(next) === 1) this.org.ensureWeek(meta, nextWeek, metaUpdate.mode ?? meta.mode);

    const commit: DayCommit = { results, ledger, inbox, apGrant, metaUpdate };
    this.repo.commitDay(date, commit);
    // 포스트시즌: 정규시즌 마지막 날 대진 확정, 이후 경기 결과로 시리즈 진행(같은 트랜잭션)
    if (meta.mode === 'season') {
      const now = this.meta();
      if (date === seasonKeyDates(meta.season).regularSeasonEnd && !this.postseason.state(now)) {
        const b = this.postseason.begin(now);
        this.repo.updateMeta({ postseason: b.state, nextFixtureId: b.nextFixtureId });
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
    if (meta.mode === 'season' && after.postseason?.season === meta.season && after.postseason.finishedDate === date) this.seasonClose.close(after, date);
    // 은퇴 설득 기한·파산 감시
    this.seasonClose.onDay(this.meta(), date);
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
      const blocking = this.market.blockingIssue(before, before.currentDate);
      if (blocking) {
        stoppedReason = blocking;
        break;
      }
      const { gamesPlayed: g } = this.advanceOneDay();
      daysProcessed++;
      gamesPlayed += g;
      const after = this.meta();
      onProgress?.({ date: after.currentDate, daysProcessed, gamesPlayed });
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

  /** ASSUMPTION(임시): 포스트시즌·스토브리그 없이 다음 시즌 정규시즌을 시작한다. 장기 데이터 검증용. 건너뛴 기간의 수입·지출은 처리되지 않는다. */
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
    const pit = this.repo.pitchingTotals(meta.season);
    const starterOf = (clubId: number) => {
      try {
        const s = prepareTeam(clubId, active.filter((p) => p.clubId === clubId), usage, lastStarters.get(clubId) ?? null).starter;
        const t = pit.get(s.id);
        const era = t && t.OUTS > 0 ? ((27 * t.ER) / t.OUTS).toFixed(2) : '—';
        return { id: s.id, name: s.name, throws: s.throws === 'L' ? '좌완' : '우완', line: `시즌 ${t?.W ?? 0}승 ${t?.L ?? 0}패 · ERA ${era}` };
      } catch {
        return null;
      }
    };
    return { fixture: this.fixtureView(fx), homeRecord: record(fx.home), awayRecord: record(fx.away), homeStarter: starterOf(fx.home), awayStarter: starterOf(fx.away) };
  }

  private tasks(meta: GameMeta, unread: number): TaskView[] {
    const out: TaskView[] = [];
    if (unread > 0) out.push({ title: `받은 편지함 ${unread}건 확인`, detail: '보고와 리그 소식을 확인하세요.', due: null, level: '권장', target: 'inbox' });
    // 비서 일정 관리력에 따라 미리 알리는 기간이 달라진다. 비서가 없으면 당일 일정만 알린다(03 문서).
    const lookahead = this.org.lookaheadDays(meta);
    const soon = this.repo.getCalendarEvents(meta.currentDate, addDays(meta.currentDate, lookahead));
    for (const e of soon) {
      const level: TaskView['level'] = e.kind === 'reserveList' || e.kind === 'campRoster' ? '필수' : '정보';
      out.push({ title: e.title, detail: e.kind === 'reserveList' ? '보유 선수를 40명 이하로 맞춰야 합니다. 현재 40명이라 추가 조치는 필요 없습니다.' : e.body, due: e.date, level, target: 'schedule' });
    }
    if (meta.mode === 'stove') {
      const off = Number(meta.kDate.slice(0, 4));
      const players = this.repo.getPlayers();
      const roster = players.filter((p) => p.clubId === meta.userClubId);
      const fa = this.repo.getFa(off);
      const star = fa.find((e) => e.originClub === meta.userClubId && players.find((p) => p.id === e.playerId)?.career.franchise);
      const starP = star ? players.find((p) => p.id === star.playerId) : players.find((p) => p.career.franchise && p.clubId === meta.userClubId);
      if (roster.length > LEAGUE.rosterMax) out.unshift({ title: `선수단 ${roster.length}명 → 40명 이하로 정리`, detail: '보류 명단(11/30)·캠프 명단(1/31) 전에 방출할 선수를 정해야 진행할 수 있습니다.', due: null, level: '필수', target: 'market' });
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

  private grade20to80(meta: GameMeta, p: PlayerTruth, scale = 1): number {
    const r = observePlayer(meta.seed, meta.userClubId, p, scale);
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
        grade20to80: this.grade20to80(meta, p, scale),
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
      grade20to80: this.grade20to80(meta, p, scale),
      salaryUsd: wonToUsd(p.salary),
      demandUsd: status === 'expiring' ? foreignRenewalDemandUsd(p) : wonToUsd(p.salary),
      contractYears: p.contractYears,
      renewals: p.career.foreignRenewals,
      status,
    });
    const mineForeign = players.filter((p) => p.clubId === meta.userClubId && p.origin !== 'domestic').map((p) => fv(p, p.contractYears === 0 && meta.mode === 'stove' ? 'expiring' : 'contracted'));
    const pool = players.filter((p) => p.clubId === null && p.origin !== 'domestic').map((p) => fv(p, 'pool')).sort((a, b) => b.grade20to80 - a.grade20to80);
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
        .map((p) => ({ playerId: p.id, name: p.name, position: p.position, age: contractYear - Number(p.birthDate.slice(0, 4)), level: p.level, grade20to80: this.grade20to80(meta, p, scale), salaryWon: p.salary, contractYears: p.contractYears, origin: p.origin }))
        .sort((a, b) => a.grade20to80 - b.grade20to80),
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

  releasePlayer(playerId: number): OfferResultView {
    return this.market.releasePlayer(this.meta(), playerId);
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
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const kindLabel: Record<string, string> = { fa: 'FA 협상', salary: '연봉 협상', hire: '채용' };
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
        target: t.kind === 'hire' ? `${teamDef(t.params.team as TeamKey).name} ${String(t.params.title)}` : (players.get(t.targetId)?.name ?? `#${t.targetId}`),
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
    const kindLabel: Record<string, string> = { fa: 'FA 협상', salary: '연봉 협상', hire: '채용' };
    return this.org.approvals().map((a) => ({ id: a.id, kind: a.kind, teamName: teamDef(a.team).name, kindLabel: kindLabel[a.kind] ?? a.kind, date: a.date, summary: a.summary }));
  }

  /** 결재는 행동력을 쓰지 않는다(D-077). */
  decideMany(approvalIds: number[], approve: boolean): OfferResultView {
    return this.org.decideMany(this.meta(), approvalIds, approve);
  }

  /** 우리 구단 모기업 지원금: 경고 삭감(bp)과 긴급 지원 차감을 반영한다(D-043). */
  private supportAdjusted(meta: GameMeta, club: ClubProfile): ClubProfile {
    const key = String(meta.season);
    const cut = meta.supportCutBp?.[key] ?? 0;
    const deduction = meta.supportDeduction?.[key] ?? 0;
    if (!cut && !deduction) return club;
    return { ...club, parentSupport: Math.max(0, Math.round((club.parentSupport * (10_000 - cut)) / 10_000) - deduction) };
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
        grade20to80: Math.round(keys.reduce((s, k) => s + (obs[k] ?? 50), 0) / keys.length),
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
      ratings: observePlayer(meta.seed, meta.userClubId, p, scale),
      stats: p.isPitcher ? this.pitchingSummary(pit, fipC) : this.battingSummary(bat),
      faEligible: p.career.faEligible,
      franchise: p.career.franchise && p.clubId === meta.userClubId,
      contractYears: p.contractYears,
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
    const scoutText = `스카우트팀 평가 오차 배율 ×${scale.toFixed(2)} (낮을수록 정확).`;
    const record = this.records.playerRecord(meta, p);
    return {
      ...base,
      birthDate: p.birthDate,
      proSeasons: p.career.proSeasons,
      faServiceYears: p.career.faServiceYears,
      battingStats: !p.isPitcher && bat ? { ...bat, ...battingRates(bat) } : null,
      pitchingStats: p.isPitcher && pit ? { ...pit, IP: pit.OUTS / 3, ...pitchingRates(pit, fipC) } : null,
      observationNote: own
        ? '우리 구단 선수라 현재 능력치를 정확히 보여줍니다. 잠재력·성장·성향은 육성팀 관찰로 추정합니다(다음 단계).'
        : `타 구단 선수라 평가 오차가 큽니다. 실제 능력과 다를 수 있습니다. ${scoutText}`,
      exactRatings: own,
      record,
      honors: p.honors ?? [],
      draftInfo: p.draft ? `${p.draft.year} 신인 드래프트 ${p.draft.round}라운드 ${p.draft.pick}순위 (${p.draft.school})` : null,
      retired: p.retired ? `${p.retired.season} 시즌 뒤 은퇴 (${p.retired.reason})` : null,
    };
  }

  boxScore(fixtureId: number): BoxScoreView {
    const game = this.repo.getGame(fixtureId);
    if (!game) throw new GameError('GAME_NOT_PLAYED', '아직 치르지 않은 경기입니다.');
    const { pas, runs } = this.repo.getGameEvents(fixtureId);
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const name = (id: number) => players.get(id)?.name ?? `#${id}`;
    const batting = { home: [] as BoxScoreView['batting']['home'], away: [] as BoxScoreView['batting']['away'] };
    const pitching = { home: [] as BoxScoreView['pitching']['home'], away: [] as BoxScoreView['pitching']['away'] };
    const hits = { home: 0, away: 0 };
    const sideOf = (clubId: number) => (clubId === game.home ? 'home' : 'away');
    const batLine = new Map<number, BoxScoreView['batting']['home'][number]>();
    const pitLine = new Map<number, BoxScoreView['pitching']['home'][number] & { outs: number }>();
    const isHit = (o: string) => o === '1B' || o === '2B' || o === '3B' || o === 'HR';
    const isAb = (o: string) => !['BB', 'HBP', 'SF'].includes(o);
    for (const pa of pas) {
      const bSide = sideOf(pa.battingClub);
      const pSide = bSide === 'home' ? 'away' : 'home';
      let b = batLine.get(pa.batterId);
      if (!b) {
        b = { playerId: pa.batterId, name: name(pa.batterId), position: players.get(pa.batterId)?.position ?? '', PA: 0, AB: 0, R: 0, H: 0, RBI: 0, HR: 0, BB: 0, SO: 0 };
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
    for (const p of pitLine.values()) p.IP = formatInnings(p.outs);
    const outcomeText: Record<string, string> = { '1B': '안타', '2B': '2루타', '3B': '3루타', HR: '홈런', BB: '볼넷', HBP: '몸에 맞는 공', K: '삼진', GO: '땅볼 아웃', FO: '뜬공 아웃', DP: '병살타', SF: '희생플라이', ROE: '실책 출루' };
    const playByPlay = pas.map((pa) => ({ inning: pa.inning, half: pa.half, text: `${name(pa.batterId)}: ${outcomeText[pa.outcome] ?? pa.outcome}${pa.rbi ? ` (${pa.rbi}타점)` : ''}` }));
    const stripOuts = (list: Array<BoxScoreView['pitching']['home'][number] & { outs?: number }>) => list.map(({ outs: _o, ...rest }) => rest);
    return {
      fixture: this.fixtureView({ id: game.fixtureId, date: game.date, home: game.home, away: game.away }, game),
      lineScore: game.lineScore,
      hits,
      batting,
      pitching: { home: stripOuts(pitching.home), away: stripOuts(pitching.away) },
      playByPlay,
    };
  }
}
