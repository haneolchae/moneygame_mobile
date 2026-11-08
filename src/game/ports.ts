// 게임 진행 계층이 저장 계층에 요구하는 기능. SQLite 구현은 persistence에 있다.
// 이 인터페이스 덕분에 게임 진행 로직은 저장 방식(SQLite 드라이버 등)을 모른다.
import type { GameDate } from '../engine/calendar';
import type { ContractOffer, FaGrade } from '../engine/contracts';
import type { LedgerCategory, LedgerEntry } from '../engine/finance';
import type { GameResult } from '../engine/gamesim';
import type { PitcherUsage } from '../engine/lineup';
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
  kind: 'fa' | 'foreign';
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

export type WorkKind = 'fa' | 'salary' | 'hire';
export type WorkStatus = 'queued' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface WorkTask {
  id: number;
  team: TeamKey;
  kind: WorkKind;
  /** fa·salary: 선수 ID, hire: 0 */
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

export interface GameRepository {
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
  getLastStarters(season: number): Map<ClubId, PlayerId>;
  isDayProcessed(date: GameDate): boolean;
  /** 하루 처리 결과를 원자적으로 반영한다. 같은 날짜를 두 번 처리하면 오류. */
  commitDay(date: GameDate, commit: DayCommit): void;
  /** 기본은 정규시즌 경기. 'postseason'이면 포스트시즌 경기 */
  getGames(season: number, stage?: 'regular' | 'postseason'): StoredGame[];
  getGame(fixtureId: FixtureId): StoredGame | null;
  getGameEvents(fixtureId: FixtureId): { pas: StoredPa[]; runs: StoredRun[] };
  battingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, BattingTotals>;
  pitchingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, PitchingTotals>;
  leaguePitchingTotals(season: number): PitchingTotals;
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
