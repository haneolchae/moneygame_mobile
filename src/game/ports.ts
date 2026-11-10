import type { ScoutingSnapshot } from '../engine/scouting';
// 게임 진행 계층이 저장 계층에 요구하는 기능. SQLite 구현은 persistence에 있다.
// 이 인터페이스 덕분에 게임 진행 로직은 저장 방식(SQLite 드라이버 등)을 모른다.
import type { GameDate } from '../engine/calendar';
import type { ClubFacilities, TicketPolicy } from '../engine/business';
import type { ContractOffer, FaGrade } from '../engine/contracts';
import type { LedgerCategory, LedgerEntry } from '../engine/finance';
import type { GameResult } from '../engine/gamesim';
import type { GamePlan, PitcherUsage } from '../engine/lineup';
import type { RngState } from '../engine/rng';
import type { Amateur } from '../engine/amateur';
import type { HistoryLine } from '../engine/history';
import type { PostseasonState } from './postseason';
import type { StaffMember, TeamKey } from '../engine/staff';
import type { BattingTotals, PitchingTotals } from '../engine/stats';
import type { GameScore } from '../engine/standings';
import type { ClubId, ClubProfile, Fixture, FixtureId, PlayerId, PlayerTruth, SeasonStanding } from '../engine/types';

export type GameMode = 'stove' | 'season';

export interface GameMeta {
  seed: string;
  /** 현재 시즌 연도. 스토브리그 동안은 끝난 시즌 연도, 2월 시즌 모드 시작 때 1 증가한다. */
  season: number;
  mode: GameMode;
  currentDate: GameDate;
  /** 이번 스토브리그의 기준일(한국시리즈 최종전) */
  kDate: GameDate;
  userClubId: ClubId;
  saveName: string;
  createdAt: string;
  rulesVersion: number;
  rngStreams: Record<string, RngState>;
  nextFixtureId: number;
  ownerLevel: number;
  ownerXp: number;
  /** 시즌 연도별 물가 상승률(bp) */
  inflationBp: Record<string, number>;
  /** 시즌 종료 시점 구단별 선수 연봉(스토브리그 중 11월분 지급용) */
  salarySnapshot: Record<string, number[]>;
  /** 이번 시즌 포스트시즌 대진·진행 (정규시즌 종료 후) */
  postseason?: PostseasonState;
  /** 시즌 성적 기본 목표(예상 순위 이내, 02 문서) */
  seasonGoal?: { season: number; expectedRank: number };
  /** 성적 기본 목표 연속 미달 횟수 */
  goalMisses?: number;
  /** 시즌별 모기업 지원 삭감(bp)·차감(원) */
  supportCutBp?: Record<string, number>;
  supportDeduction?: Record<string, number>;
  rebuild?: { declaredSeason: number; from: number; until: number };
  /** 해임·파산 */
  gameOver?: { kind: 'dismissed' | 'bankrupt'; date: GameDate; reason: string };
  cashCrisisSince?: GameDate | null;
  emergencyUsedSeason?: number;
  /** 우리 구단 은퇴 고민 선수(설득 기한) */
  retirementPending?: Array<{ playerId: PlayerId; reason: string; deadline: GameDate }>;
  /** 우리 구단 드래프트 지명 우선순위 */
  draftBoard?: number[];
  /** 시즌별 정규시즌 경기 수: 정규시즌 마지막 날 기록하고 이후 바꾸지 않는다(포스트시즌·다음 시즌 일정과 무관) */
  regularSeasons?: Record<string, { played: number; total: number; endDate: GameDate }>;
  /** 시즌별 리그 환경(득점·홈런 목표의 기준값 대비 편차, D-100). 시즌 모드 시작 때 정한다 */
  leagueEnvironment?: Record<string, { runs: number; hr: number; runsAdj?: number; hrAdj?: number; measuredRunsPerGame?: number; measuredHrPerPa?: number }>;
  /** 우리 구단 경기 운영(2d, D-120): 감독 자동 또는 수동 계획 */
  userPlan?: UserPlanState;
  /** 이번 시즌 우리 구단 1·2군 이동 기록(재등록 제한 판정·규칙 검사용, 2/1에 비움) */
  rosterMoves?: RosterMove[];
  /** 이번 시즌 시범경기 점수·우리 선수 기록(정규 기록과 별도, D-120) */
  exhibition?: ExhibitionState;
  /** 우리 선수 휴식 지시(4b-1): 선수 ID → 마지막 휴식일(포함) */
  restOrders?: Record<string, GameDate>;
  /** 구단 메모·라이벌 표시(3e, D-122): 구단 ID → 메모 */
  clubNotes?: Record<string, { text: string; rival: boolean; updatedAt: string | null }>;
  /** 5a 트레이드 협상(D-131): 상대 구단 ID → 이번 시즌 협상 */
  tradeTalks?: Record<string, TradeTalk>;
  /** 성사된 트레이드 */
  tradeHistory?: TradeRecord[];
  /** 확정 명령 기록(D-131, 최근 300건). 같은 명령 식별자 재전송은 저장된 결과를 돌려준다 */
  actionLog?: ActionLogEntry[];
  /** D-135 모기업 지원금 재협상 배수: 시즌 → 구단 ID → bp */
  supportBp?: Record<string, Record<string, number>>;
  /** 6a 관중 집계(D-141): 시즌 → 구단 ID → 홈경기·관중·수입·승패 */
  attendance?: Record<string, Record<string, AttendanceTotals>>;
  /** 우리 구단 티켓 가격 정책 */
  ticketPolicy?: TicketPolicy;
  /** 구단 시설 단계·공사: 구단 ID → 시설 */
  facilities?: Record<string, ClubFacilities>;
  /** D-136 계약 세션: 선수 ID → 이번 주 세션(주·제안 횟수) */
  contractSessions?: Record<string, { weekId: string; count: number }>;
}

/** 트레이드 교환안: cashWon > 0이면 우리가 상대에게, < 0이면 상대가 우리에게 낸다 */
export interface TradePackage {
  give: PlayerId[];
  get: PlayerId[];
  cashWon: number;
}

export interface TradeLogEntry {
  date: GameDate;
  weekId: string;
  kind: 'proposal' | 'counterAccepted';
  pkg: TradePackage;
  result: 'accept' | 'counter' | 'reject';
  message: string;
}

export interface TradeTalk {
  clubId: ClubId;
  season: number;
  /** 행동력을 낸 주 */
  weeksPaid: string[];
  log: TradeLogEntry[];
  /** 상대 역제안(그 주 안에서만 유효) */
  counter: { pkg: TradePackage; weekId: string } | null;
}

export interface TradeRecord {
  date: GameDate;
  season: number;
  clubA: ClubId;
  clubB: ClubId;
  /** clubA → clubB 선수, clubB → clubA 선수, clubA가 낸 현금(음수면 받음) */
  aToB: PlayerId[];
  bToA: PlayerId[];
  cashAtoB: number;
}

export interface ActionLogEntry {
  commandId: string;
  command: string;
  target: string;
  date: GameDate;
  ap: number;
  talkClubId: ClubId | null;
  result: 'accept' | 'counter' | 'reject' | 'error';
  message: string;
}

export interface AttendanceTotals {
  games: number;
  total: number;
  max: number;
  sellouts: number;
  ticketWon: number;
  w: number;
  l: number;
}

export interface UserPlanState {
  mode: 'auto' | 'manual';
  plan: GamePlan | null;
}

export type RosterMove = { date: GameDate; playerId: PlayerId; to: '1군' | '2군' };

export interface ExhibitionLine {
  G: number;
  PA: number;
  AB: number;
  H: number;
  HR: number;
  BB: number;
  SO: number;
  RBI: number;
  /** 투수: 등판·아웃·피안타·자책·볼넷·삼진 */
  GP: number;
  OUTS: number;
  HA: number;
  ER: number;
  BBA: number;
  K: number;
}

export interface ExhibitionState {
  season: number;
  games: Array<{ date: GameDate; home: ClubId; away: ClubId; homeRuns: number; awayRuns: number }>;
  /** 우리 구단 선수 시범경기 기록 */
  stats: Record<string, ExhibitionLine>;
  lastStarters: Record<string, PlayerId>;
}

export interface StoredGame extends GameScore {
  fixtureId: FixtureId;
  season: number;
  date: GameDate;
  innings: number;
  homeStarter: PlayerId;
  awayStarter: PlayerId;
  winningPitcher: PlayerId | null;
  losingPitcher: PlayerId | null;
  savePitcher: PlayerId | null;
  lineScore: { home: number[]; away: number[] };
}

export interface StoredPa {
  seq: number;
  inning: number;
  half: 'T' | 'B';
  battingClub: ClubId;
  batterId: PlayerId;
  pitcherId: PlayerId;
  outcome: string;
  rbi: number;
  outsOnPlay: number;
  pitches: number;
  /** 인플레이 타구(10b §11): 구역 ID, 유형, 질(0~2), 처리 수비수 */
  bbZone?: string;
  bbType?: string;
  bbQuality?: number;
  fielderId?: PlayerId;
}

/** 수비 기록 한 건(자살·보살·실책) */
export interface StoredFielding {
  seq: number;
  clubId: ClubId;
  playerId: PlayerId;
  kind: 'PO' | 'A' | 'E';
}

export interface StoredRun {
  seq: number;
  runnerId: PlayerId;
  pitcherId: PlayerId;
  earned: boolean;
  battingClub: ClubId;
}

export interface InboxMessage {
  id?: number;
  date: GameDate;
  kind: 'news' | 'report' | 'task' | 'welcome';
  sender: string;
  title: string;
  body: string;
  read?: boolean;
}

export interface CalendarEvent {
  date: GameDate;
  kind: string;
  title: string;
  body: string;
}

export interface ApWeek {
  weekId: string;
  granted: number;
  used: number;
}

/** 하루 처리 결과. 하나의 트랜잭션으로 반영된다. */
export interface DayCommit {
  results: GameResult[];
  ledger: LedgerEntry[];
  inbox: InboxMessage[];
  apGrant: ApWeek | null;
  metaUpdate: Partial<GameMeta>;
}

export interface InitialWorld {
  meta: GameMeta;
  clubs: readonly ClubProfile[];
  players: PlayerTruth[];
  fixtures: Fixture[];
  standings: readonly SeasonStanding[];
  events: CalendarEvent[];
  inbox: InboxMessage[];
  ledger: LedgerEntry[];
  apGrant: ApWeek;
  staff: StaffMember[];
  history: HistoryLine[];
  amateurs: Amateur[];
}

export type FaStatus = 'eligible' | 'applied' | 'declined' | 'approved' | 'signed' | 'unsigned';

export interface FaEntry {
  playerId: PlayerId;
  offseason: number;
  originClub: ClubId;
  status: FaStatus;
  grade: FaGrade | null;
  priorSalary: number;
  demand: ContractOffer;
  signedClub: ClubId | null;
  signedDate: GameDate | null;
  contract: ContractOffer | null;
}

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'withdrawn' | 'expired';

export interface OfferRow {
  id: number;
  playerId: PlayerId;
  clubId: ClubId;
  /** salary·foreign은 구단 직접·위임 제안 기록(3d, D-118). 같은 날 같은 조건 재제안 차단과 결과 이력에 쓴다. */
  kind: 'fa' | 'foreign' | 'salary' | 'extension' | 'domestic';
  date: GameDate;
  offer: ContractOffer;
  status: OfferStatus;
  response: string;
}

export interface Obligation {
  id?: number;
  clubId: ClubId;
  playerId: PlayerId;
  salary: number;
  seasons: number[];
  memo: string;
}

export interface SalaryTalk {
  playerId: PlayerId;
  offseason: number;
  clubId: ClubId;
  priorSalary: number;
  demand: number;
  offer: number;
  status: 'open' | 'agreed' | 'arbitrated';
  final: number | null;
}

export interface WpWeek {
  weekId: string;
  team: TeamKey;
  granted: number;
  upkeep: number;
  used: number;
}

export type DelegationMode = 'direct' | 'approve' | 'auto';

/** 팀 위임 정책 (03 문서 위임 모드). 금액은 원, 비율은 bp */
export interface DelegationPolicy {
  team: TeamKey;
  mode: DelegationMode;
  /** FA 계약 1건 총액 상한 */
  faMaxTotal: number;
  faMaxYears: number;
  /** 연봉 협상: 선수 요구액 대비 최대 제시 비율 */
  salaryMaxRatioBp: number;
  /** 위임 실행 후에도 남아야 하는 현금 */
  cashFloor: number;
  /** 위임 채용 1명 연봉 상한 */
  hireMaxSalary: number;
}

/** roster: 40인 초과 정리 같은 마감일 있는 의무 안건(D-095) */
export type WorkKind = 'fa' | 'salary' | 'hire' | 'roster';
export type WorkStatus = 'queued' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface WorkTask {
  id: number;
  team: TeamKey;
  kind: WorkKind;
  /** fa·salary: 선수 ID, hire·roster: 0 */
  targetId: number;
  params: Record<string, unknown>;
  status: WorkStatus;
  created: GameDate;
  updated: GameDate;
  note: string;
}

export interface ApprovalRequest {
  id: number;
  taskId: number;
  team: TeamKey;
  kind: WorkKind;
  date: GameDate;
  summary: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface AchievementRow {
  key: string;
  /** 시즌 반복 업적은 시즌 연도, 1회 업적은 0 */
  season: number;
  date: GameDate;
  detail: string;
  xp: number;
}

/** 구단별 시즌 합계(원시 기록) */
export interface TeamSeasonTotals {
  clubId: ClubId;
  bat: BattingTotals;
  pit: PitchingTotals;
  runsFor: number;
  runsAgainst: number;
}

export interface PlayerNote { text: string; watched: boolean; updatedAt: string | null }
export interface GameRepository {
  getScouting(clubId: number): ScoutingSnapshot[];
  saveScouting(snapshot: ScoutingSnapshot): void;
  getPlayerNote(playerId: number): PlayerNote;
  savePlayerNote(playerId: number, note: PlayerNote): void;
  /** 여러 쓰기를 하나의 변경으로 묶는다. 중첩 호출은 바깥 트랜잭션에 합쳐진다. */
  transaction<T>(fn: () => T): T;
  savePlayers(players: PlayerTruth[]): void;
  getFa(offseason: number): FaEntry[];
  saveFa(entries: FaEntry[]): void;
  insertOffer(o: Omit<OfferRow, 'id'>): number;
  updateOffer(id: number, patch: Partial<Pick<OfferRow, 'status' | 'response'>>): void;
  getOffers(filter: { playerId?: PlayerId; clubId?: ClubId; status?: OfferStatus; kind?: OfferRow['kind'] }): OfferRow[];
  addObligation(o: Obligation): void;
  getObligations(): Obligation[];
  getSalaryTalks(offseason: number): SalaryTalk[];
  saveSalaryTalks(rows: SalaryTalk[]): void;
  /** 이번 주 행동력 사용. 부족하면 오류 */
  spendAp(weekId: string, amount: number): void;
  addLedger(entries: LedgerEntry[]): void;
  addInbox(messages: InboxMessage[]): void;
  /** clubId: 숫자면 그 구단, null이면 채용 시장 후보, 생략하면 전체 */
  getAmateurs(status?: Amateur['status']): Amateur[];
  saveAmateurs(list: Amateur[]): void;
  nextAmateurId(): number;
  getHistory(filter: { playerIds?: PlayerId[]; season?: number }): HistoryLine[];
  insertHistory(lines: HistoryLine[]): void;
  countHistory(): number;
  /** 원시 기록에서 구단별 팀 타격·투구 합계 */
  teamTotals(season: number): TeamSeasonTotals[];
  getAchievements(): AchievementRow[];
  insertAchievement(a: AchievementRow): void;
  /** 구단주 레벨·경험치 갱신 */
  updateMeta(partial: Partial<GameMeta>): void;
  getStaff(clubId?: ClubId | null): StaffMember[];
  saveStaff(staff: StaffMember[]): void;
  deleteStaff(ids: number[]): void;
  nextStaffId(): number;
  getWp(weekId: string): WpWeek[];
  insertWp(rows: WpWeek[]): void;
  /** 이번 주 팀 처리량 사용. 부족하면 오류. force: 구단주 직접 행동은 큐 최우선이라 부족해도 차감한다(D-028) */
  spendWp(weekId: string, team: TeamKey, amount: number, force?: boolean): void;
  getPolicies(): DelegationPolicy[];
  savePolicy(p: DelegationPolicy): void;
  getTasks(filter?: { status?: WorkStatus[]; kind?: WorkKind; targetId?: number }): WorkTask[];
  insertTask(t: Omit<WorkTask, 'id'>): number;
  updateTask(id: number, patch: Partial<Pick<WorkTask, 'status' | 'params' | 'note' | 'updated'>>): void;
  getApprovals(status?: ApprovalRequest['status']): ApprovalRequest[];
  insertApproval(a: Omit<ApprovalRequest, 'id'>): number;
  updateApproval(id: number, status: ApprovalRequest['status']): void;
  initialize(world: InitialWorld): void;
  getMeta(): GameMeta;
  getClubs(): ClubProfile[];
  getPlayers(): PlayerTruth[];
  getActivePlayers(clubIds: ClubId[]): PlayerTruth[];
  getPlayer(id: PlayerId): PlayerTruth | null;
  getFixturesOn(date: GameDate): Fixture[];
  getFixtures(season: number): Array<Fixture & { played: boolean }>;
  addFixtures(fixtures: Fixture[], meta: Partial<GameMeta>): void;
  countFixtures(season: number): { total: number; played: number };
  getRecentPitcherUsage(fromDate: GameDate, toDateExclusive: GameDate): Array<PitcherUsage & { date: GameDate }>;
  /** 기간 안에 타석에 선 야수와 날짜(피로 계산용, 4b-1) */
  getRecentBatterGames(fromDate: GameDate, toDateExclusive: GameDate): Array<{ date: GameDate; batterId: PlayerId }>;
  getLastStarters(season: number): Map<ClubId, PlayerId>;
  isDayProcessed(date: GameDate): boolean;
  /** 하루 처리 결과를 원자적으로 반영한다. 같은 날짜를 두 번 처리하면 오류. */
  commitDay(date: GameDate, commit: DayCommit): void;
  /** 기본은 정규시즌 경기. 'postseason'이면 포스트시즌 경기 */
  getGames(season: number, stage?: 'regular' | 'postseason'): StoredGame[];
  getGame(fixtureId: FixtureId): StoredGame | null;
  getGameEvents(fixtureId: FixtureId): { pas: StoredPa[]; runs: StoredRun[]; fielding: StoredFielding[] };
  battingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, BattingTotals>;
  pitchingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, PitchingTotals>;
  leaguePitchingTotals(season: number): PitchingTotals;
  /** 지난 시즌 상세 기록 압축(D-106): 원시 타석·득점·수비 기록을 시즌 합계로 바꾼다 */
  compressSeason(season: number): void;
  isCompressed(season: number): boolean;
  /** 스프레이 차트 합계(타자·구역·타구 유형) */
  sprayTotals(season: number, playerId: PlayerId): Array<{ zone: string; type: string; n: number; h: number; xbh: number }>;
  /** 수비 합계(자살·보살·실책) */
  fieldingTotals(season: number, playerId: PlayerId): { PO: number; A: number; E: number };
  /** 구단 소속으로 쌓은 선수별 수비 합계(정규시즌) */
  fieldingByClub(season: number, clubId: ClubId): Map<PlayerId, { PO: number; A: number; E: number }>;
  /** 성적 혼합(3b)용 정규시즌 타석 결과: after < date < before, 날짜·경기·순번 순 */
  formRows(season: number, after: GameDate | null, before: GameDate): Array<{ batterId: PlayerId; pitcherId: PlayerId; date: GameDate; outcome: string }>;
  getSeasonStandings(season: number): SeasonStanding[];
  /** 시즌 최종 순위 기록(같은 시즌·구단은 덮어쓴다) */
  saveSeasonStandings(rows: SeasonStanding[]): void;
  getCalendarEvents(fromDate: GameDate, toDate: GameDate): CalendarEvent[];
  addCalendarEvents(events: CalendarEvent[]): void;
  getInbox(limit: number): Array<InboxMessage & { id: number; read: boolean }>;
  markInboxRead(id: number): void;
  getApWeek(weekId: string): ApWeek | null;
  cashBalance(clubId: ClubId): number;
  ledgerByCategory(clubId: ClubId, season: number): Array<{ category: LedgerCategory; amount: number }>;
  ledgerEntries(clubId: ClubId, limit: number): Array<LedgerEntry & { id: number; season: number }>;
}
