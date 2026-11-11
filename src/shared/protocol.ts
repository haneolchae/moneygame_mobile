// 화면 ↔ 게임 통신 형식. 화면은 이 파일의 타입만 안다.
// 표시용 데이터(View)에는 실제 능력·히든 값을 넣지 않는다(04 문서 데이터 경계). 평가는 관찰값(능력치 1~100 척도, D-086)만 담는다.

export interface ClubOption {
  id: number;
  name: string;
  city: string;
  stadium: string;
  stadiumCapacity: number;
  parentIndustry: string;
  colors: string;
  difficulty: string;
  startCashWon: number;
  parentSupportWon: number;
  namingRightsWon: number;
  marketSize: number;
  loyalty: string;
  strength: string;
  lastSeason: string;
  /** 창단 이후 한국시리즈 우승(2026 포함, 실제 기록) */
  ksTitles: number;
  founded: number | null;
  primaryColor: string;
  secondaryColor: string;
  shortName: string;
}

export interface ClubRef {
  id: number;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface StandingView {
  rank: number;
  club: ClubRef;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number | null;
  gamesBehind: number;
  /** 직전 시즌 요약 순위에는 득실점이 없어 null */
  runsFor: number | null;
  runsAgainst: number | null;
  last10: string;
  streak: string;
  postseason?: string;
}

export interface OwnerView {
  level: number;
  xp: number;
  xpToNext: number;
  apGranted: number;
  apRemaining: number;
  weekLabel: string;
}

export interface CalendarEventView {
  date: string;
  kind: string;
  title: string;
  body: string;
}

export interface TaskView {
  title: string;
  detail: string;
  due: string | null;
  level: '필수' | '권장' | '선택' | '정보';
  target: 'inbox' | 'players' | 'finance' | 'schedule' | 'standings' | 'market' | 'org' | 'draft' | 'roster' | null;
}

export interface NextGameView {
  fixture: FixtureView;
  homeRecord: string;
  awayRecord: string;
  homeStarter: { id: number; name: string; throws: string; line: string } | null;
  awayStarter: { id: number; name: string; throws: string; line: string } | null;
}

export interface InboxItemView {
  id: number;
  date: string;
  kind: string;
  sender: string;
  title: string;
  body: string;
  read: boolean;
}

export interface FinanceView {
  clubName: string;
  cashWon: number;
  seasonYear: number;
  byCategory: Array<{ category: string; label: string; amountWon: number }>;
  seasonRevenueWon: number;
  seasonExpenseWon: number;
  recent: Array<{ date: string; label: string; memo: string; amountWon: number }>;
  notImplemented: string[];
  inflationNote: string;
}

export interface FixtureView {
  fixtureId: number;
  date: string;
  home: ClubRef;
  away: ClubRef;
  played: boolean;
  homeRuns?: number;
  awayRuns?: number;
  innings?: number;
  /** 포스트시즌 경기면 '준플레이오프 2차전' 같은 표시 */
  stageLabel?: string;
}

/** stove: 스토브리그, preseason: 시즌 모드 개막 전(캠프), regular: 정규시즌, regularComplete: 정규시즌 종료 */
export type SeasonPhase = 'stove' | 'preseason' | 'regular' | 'postseason' | 'seasonComplete';

export interface DashboardView {
  saveName: string;
  season: number;
  date: string;
  phase: SeasonPhase;
  phaseLabel: string;
  userClub: ClubRef;
  userRecord: StandingView | null;
  /** 스토브리그·개막 전에는 직전 시즌 최종 순위, 정규시즌에는 현재 순위 */
  standings: StandingView[];
  standingsTitle: string;
  todayFixtures: FixtureView[];
  upcoming: FixtureView[];
  recent: FixtureView[];
  nextGame: NextGameView | null;
  regularSeasonEnd: string;
  openingDay: string;
  gamesPlayedLeague: number;
  gamesTotalLeague: number;
  /** 정규시즌 마지막 날 기록한 가장 최근 시즌의 경기 수. 포스트시즌·다음 시즌 일정이 생겨도 바뀌지 않는다 */
  lastRegularSeason: { season: number; played: number; total: number; endDate: string } | null;
  unsavedDays: number;
  lastSavedAt: string | null;
  owner: OwnerView;
  cashWon: number;
  rosterCount: number;
  unreadInbox: number;
  tasks: TaskView[];
  /** 해임·파산(게임 종료) */
  gameOver: { kind: string; date: string; reason: string } | null;
  /** 4c-3 경기 보기 가능·관전 중 */
  live: { available: boolean; active: boolean };
  /** 시즌 성적 기본 목표와 연속 미달 */
  goal: { expectedRank: number | null; misses: number; rebuild: string | null };
  /** 포스트시즌 대진과 진행 상황(정규시즌 종료 후) */
  postseason: PostseasonView | null;
  /** 결재 대기 건수(위임 제안 후 승인) */
  pendingApprovals: number;
  /** 결재 대기 안건(주 시작 팝업용) */
  approvals: ApprovalView[];
  upcomingEvents: CalendarEventView[];
  keyPlayers: PlayerListItem[];
  canAdvanceDay: boolean;
}

export type StatValue = number | null;

export interface PlayerListItem {
  id: number;
  name: string;
  /** 4b-1: 부상·휴식 상태(다른 구단 선수도 부상 여부는 공개) */
  healthStatus: string | null;
  club: ClubRef | null;
  level: string;
  position: string;
  isPitcher: boolean;
  age: number;
  bats: string;
  throws: string;
  salaryWon: number;
  /** 우리 선수 실제값만. 타 구단·시장 선수는 빈 객체이며 ratingRanges만 전달한다. */
  ratings: Record<string, number>;
  ratingRanges: Record<string, { low: number; high: number }>;
  watched: boolean;
  stats: Record<string, StatValue>;
  /** 이번 스토브리그 FA 자격 선수 */
  faEligible: boolean;
  /** 우리 구단 간판 선수 (첫 안건) */
  franchise: boolean;
  /** 현재 시즌 이후 남은 계약 연수 */
  contractYears: number;
}

/** 스프레이 차트(정규시즌, 홈런 제외 인플레이 타구). 구역 ID는 10b의 S{1~7}-{IN|SH|DP|WL}·FO-{L|C|R}, 필드 기준(좌타자 거울상 반영 뒤) */
export interface SprayView {
  season: number;
  balls: number;
  zones: Array<{ zone: string; n: number; h: number; xbh: number }>;
  types: Array<{ type: 'GB' | 'LD' | 'FB'; n: number; h: number }>;
}

/** 수비 기록 한 줄: 기회(TC) = 자살 + 보살 + 실책, 수비율 = (자살 + 보살) / 기회 */
export interface FieldingLineView {
  season: number;
  PO: number;
  A: number;
  E: number;
  TC: number;
  FPCT: number | null;
}

export interface PlayerNoteView { text: string; watched: boolean; updatedAt: string | null }
export interface PlayerHealthView {
  injured: boolean;
  /** 우리 선수만: 부위·중증도·발생일·진단 추정 복귀 범위(실제 복귀일은 보내지 않음) */
  injury: { part: string; severity: string; date: string; estimateFrom: string; estimateTo: string } | null;
  /** 우리 선수만: 최근 7일 출전 기록으로 계산한 피로(0~100) */
  fatigue: number | null;
  restUntil: string | null;
  lastCheck: string | null;
  history: Array<{ date: string; returnDate: string; part: string; severity: string }>;
}

export interface PlayerDetailView extends PlayerListItem {
  /** 4b-1 건강. 다른 구단 선수는 부상 여부만 */
  health: PlayerHealthView;
  /** 우리 선수만: 지난 성장·노화 결산 뒤 실제 능력 변화(4a). 다른 구단 선수는 null */
  development: { since: string | null; settled: boolean; changes: Array<{ key: string; label: string; delta: number }> } | null;
  scouting: { confidence: number; date: string; observer: string; stale: boolean; reports: number; nextDate: string; apCost: number };
  traits: Array<{ label: string; text: string }>;
  pitches: Array<{ type: string; values: Record<string, number>; ranges: Record<string, { low: number; high: number }> }>;
  recentSample: { count: number; sufficient: boolean; limit: number };
  note: PlayerNoteView;
  previousId: number | null;
  nextId: number | null;
  birthDate: string;
  proSeasons: number;
  faServiceYears: number;
  battingStats: Record<string, StatValue> | null;
  pitchingStats: Record<string, StatValue> | null;
  observationNote: string;
  /** 아마추어 개인 업적·드래프트 정보 */
  honors: string[];
  /** 8a 리그 수상 이력(시즌·상) */
  awards: Array<{ season: number; title: string }>;
  draftInfo: string | null;
  retired: string | null;
  /** 우리 구단 선수: 현재 능력치를 오차 없이 표시(D-078) */
  exactRatings: boolean;
  /** 통산·직전 3개 시즌·현재 시즌 기록(D-079) */
  record: PlayerRecordView;
  /** 최근 기록이 있는 시즌의 스프레이 차트(없으면 null) */
  spray: SprayView | null;
  /** 현재 시즌과 직전 3개 시즌 수비 기록(기록 있는 시즌만) */
  fielding: FieldingLineView[];
}

export interface PostseasonSeriesView {
  key: string;
  label: string;
  high: ClubRef | null;
  low: ClubRef | null;
  highWins: number;
  lowWins: number;
  ties: number;
  winsNeeded: number;
  winner: ClubRef | null;
  dates: string[];
  note: string;
}

export interface PostseasonView {
  season: number;
  series: PostseasonSeriesView[];
  champion: ClubRef | null;
  userResult: string;
}

export interface DraftCandidateView {
  id: number;
  name: string;
  level: string;
  school: string;
  grade: number;
  position: string;
  isPitcher: boolean;
  age: number;
  /** 스카우트 평가(현재 능력, 1~100) */
  scoutGrade: number;
  /** 스카우트가 추정한 잠재력 등급 A~D (실제 잠재력 값이 아니라 우리 스카우트 관측에 오차를 더한 평가) */
  scoutPotentialGrade: string;
  honors: string[];
  lastSeason: string;
  /** 우리 지명 순위(없으면 null) */
  priority: number | null;
}

export interface DraftView {
  year: number;
  date: string;
  done: boolean;
  candidates: DraftCandidateView[];
  board: number[];
  picks: Array<{ round: number; pick: number; club: ClubRef; name: string; school: string; position: string; mine: boolean }>;
  myOrder: number | null;
}

/** 한 줄 기록. values의 키는 kind에 따라 타격(G PA AB H 2B 3B HR RBI R BB SO AVG OBP SLG OPS) 또는 투구(G GS W L SV IP ERA WHIP K BB HR K/9 BB/9) */
export interface StatLineView {
  label: string;
  season: number | null;
  club: string | null;
  /** 게임 시작 이전 생성 기록 */
  preGame: boolean;
  values: Record<string, number | string | null>;
}

export interface PlayerRecordView {
  kind: 'bat' | 'pit';
  columns: string[];
  current: StatLineView | null;
  recent: StatLineView[];
  career: StatLineView | null;
}

export interface TeamStatItem {
  key: string;
  label: string;
  value: string;
  /** 리그 10개 구단 중 순위(1 = 가장 좋음) */
  rank: number | null;
}

export interface TeamHistoryRow {
  season: number;
  rank: number | null;
  wins: number;
  losses: number;
  ties: number;
  postseason: string;
  preGame: boolean;
  /** real: 실제 KBO 기록(~2025), start: 2026 실제 순위 + 시작 이전 생성 기록, game: 게임 안 기록 */
  source: 'real' | 'start' | 'game';
  /** 구단주 취임 이후 우리 구단이 이룬 시즌 */
  mine: boolean;
  /** 8a 그 시즌 리그 수상 수(월간 제외) */
  awards: number;
  AVG: string;
  OPS: string;
  HR: number | null;
  runs: number | null;
  ERA: string;
  runsAllowed: number | null;
}

export interface AchievementView {
  key: string;
  title: string;
  category: string;
  description: string;
  xp: number;
  repeat: boolean;
  achieved: Array<{ season: number; date: string; detail: string; xp: number }>;
}

export interface TeamRecordsView {
  club: ClubRef;
  statsSeason: number;
  statsLabel: string;
  batting: TeamStatItem[];
  pitching: TeamStatItem[];
  /** statsSeason 정규시즌 선수별 수비 기록(이 구단 소속으로 쌓은 것) */
  fielding: Array<FieldingLineView & { playerId: number; name: string; position: string }>;
  history: TeamHistoryRow[];
  records: Array<{ label: string; holder: string; value: string; season: number; preGame: boolean; source: 'real' | 'start' | 'game'; mine: boolean }>;
  /** 연표: 창단·우승·준우승·정규시즌 1위 */
  timeline: Array<{ year: number; label: string; mine: boolean }>;
  isUserClub: boolean;
  /** 첫 시즌(전신 구단 포함) */
  founded: number | null;
  titles: { ks: number[]; regularFirst: number[] };
  /** 구단 레전드(실제 통산 기록, 가상 이름) */
  legends: Array<{ name: string; position: string; isPitcher: boolean; years: string; retiredNumber: number | null; career: Record<string, string> }>;
  achievements: AchievementView[];
  owner: { level: number; xp: number; xpToNext: number };
}

export interface BoxBatterLine {
  playerId: number;
  name: string;
  position: string;
  PA: number;
  AB: number;
  R: number;
  H: number;
  RBI: number;
  HR: number;
  BB: number;
  SO: number;
  /** 4c-1: 이 경기에서 본 투구 수(타석별 투구 수 합) */
  NP: number;
}

export interface BoxPitcherLine {
  playerId: number;
  name: string;
  IP: string;
  H: number;
  R: number;
  ER: number;
  BB: number;
  K: number;
  HR: number;
  pitches: number;
  decision: 'W' | 'L' | 'S' | '';
}

export interface BoxScoreView {
  fixture: FixtureView;
  lineScore: { home: number[]; away: number[] };
  /** false면 지난 시즌 경기라 최종 스코어·이닝별 점수만 보관(D-106) */
  detailKept: boolean;
  hits: { home: number; away: number } | null;
  batting: { home: BoxBatterLine[]; away: BoxBatterLine[] };
  pitching: { home: BoxPitcherLine[]; away: BoxPitcherLine[] };
  playByPlay: Array<{ inning: number; half: 'T' | 'B'; text: string }>;
}

export interface AdvanceResult {
  daysProcessed: number;
  gamesPlayed: number;
  date: string;
  phase: SeasonPhase;
  stoppedReason: string | null;
  autosaved: boolean;
  elapsedMs: number;
}

export interface SaveSlotInfo {
  slot: string;
  name: string;
  season: number;
  date: string;
  clubName: string;
  savedAt: string;
  schemaVersion: number;
  sizeBytes: number;
  backups: Array<{ index: number; savedAt: string; date: string }>;
  status: 'ok' | 'corrupt' | 'newerVersion' | 'oldVersion';
  message?: string;
}

export interface AppStatus {
  hasActiveGame: boolean;
  recoverableSession: { saveName: string; date: string; clubName: string } | null;
  platform: PlatformStatus;
}

export interface PlatformStatus {
  steam: { mode: 'real' | 'mock'; initialized: boolean; detail: string };
  appVersion: string;
}

export interface ContractOfferView {
  years: number;
  salaryWon: number;
  bonusWon: number;
  totalWon: number;
}

export interface FaRowView {
  playerId: number;
  name: string;
  position: string;
  isPitcher: boolean;
  age: number;
  /** 우리 스카우트 평가 평균(1~100) */
  scoutGrade: number;
  originClub: ClubRef;
  status: string;
  statusKey: string;
  faGrade: string | null;
  priorSalaryWon: number;
  demand: ContractOfferView;
  /** 우리가 영입하면 원소속 구단에 낼 보상금 (우리 선수면 0) */
  compensationWon: number;
  /** 알려진 다른 구단의 관심 수(이번 주 진행 중인 제안) */
  interest: number;
  myOffer: { status: string; response: string; offer: ContractOfferView } | null;
  signedClub: ClubRef | null;
  signedContract: ContractOfferView | null;
  franchise: boolean;
  /** 운영팀 위임 진행 상황 */
  delegation: { status: string; note: string } | null;
}

export interface SalaryTalkView {
  playerId: number;
  name: string;
  position: string;
  age: number;
  priorWon: number;
  demandWon: number;
  offerWon: number;
  status: string;
  finalWon: number | null;
  delegation: { status: string; note: string } | null;
}

export interface ForeignPlayerView {
  playerId: number;
  name: string;
  origin: 'foreign' | 'asia';
  position: string;
  isPitcher: boolean;
  age: number;
  scoutGrade: number;
  salaryUsd: number;
  /** 재계약·영입에 필요한 금액(달러) */
  demandUsd: number;
  contractYears: number;
  renewals: number;
  status: 'contracted' | 'expiring' | 'pool';
}

export interface MarketView {
  /** 우리 구단 은퇴 고민 선수(설득 기한) */
  retirementPending: Array<{ playerId: number; name: string; age: number; reason: string; deadline: string }>;
  /** 운영팀 위임 모드와 기본 한도 */
  ops: { mode: DelegationModeView; faMaxTotal: number; faMaxYears: number };
  stage: string;
  stageLabel: string;
  marketOpen: boolean;
  weeksSinceOpen: number;
  cashWon: number;
  payrollWon: number;
  capWon: number;
  rosterCount: number;
  rosterMax: number;
  apRemaining: number;
  obligationsWon: number;
  fa: FaRowView[];
  salaryTalks: SalaryTalkView[];
  foreign: { mine: ForeignPlayerView[]; pool: ForeignPlayerView[]; totalUsd: number; capUsd: number; rules: string[] };
  releasable: Array<{ playerId: number; name: string; position: string; age: number; level: string; scoutGrade: number; salaryWon: number; contractYears: number; origin: string }>;
}

export interface OfferResultView {
  result: 'accept' | 'counter' | 'reject';
  message: string;
  counter?: ContractOfferView;
}

// ───────── 구단 선택·비교 (3e, 18b·D-121·D-122) ─────────

export interface ClubNoteView {
  text: string;
  rival: boolean;
  updatedAt: string | null;
}

/** 전력 비교 한 묶음: 우리 선수는 실제 능력(하한=상한), 타 구단은 스카우트 추정 범위 평균 */
export interface ClubStrengthView {
  key: string;
  label: string;
  /** 비교에 쓴 선수 수 */
  n: number;
  ours: { low: number; high: number };
  theirs: { low: number; high: number };
  /** 타 구단 선수 평균 관측 신뢰도(0~100) */
  theirConfidence: number;
}

export interface ClubView {
  club: ClubRef;
  mine: boolean;
  season: number;
  profile: { city: string; stadium: string; stadiumCapacity: number; parentIndustry: string; loyalty: string };
  /** 7a 운영 기조(AI 구단, 매월 1일 평가). 우리 구단은 null */
  stance: { key: string; label: string; since: string } | null;
  standing: StandingView | null;
  /** 팀 시즌 기록(공개). rank는 10개 구단 중 순위(1=가장 좋음) */
  team: Array<{ key: string; label: string; value: string; rank: number }>;
  recent: Array<{ date: string; opponent: string; home: boolean; us: number; them: number }>;
  /** 선수단(타 구단은 능력 대신 추정 범위만) */
  roster: PlayerListItem[];
  payrollWon: number;
  comparison: ClubStrengthView[] | null;
  note: ClubNoteView;
}

// ───────── 선수단 운영: 1·2군·경기 운영 계획·시범경기 (2d, D-119·D-120) ─────────

export interface GamePlanView {
  /** 타순 1~9번: 선수와 수비 위치(C·1B·2B·3B·SS·LF·CF·RF·DH) */
  lineup: Array<{ playerId: number; position: string }>;
  /** 선발 로테이션 순서 */
  rotation: number[];
  /** 마무리(null이면 감독 판단) */
  closer: number | null;
}

export interface ExhibitionLineView {
  G: number; PA: number; AB: number; H: number; HR: number; BB: number; SO: number; RBI: number;
  GP: number; OUTS: number; HA: number; ER: number; BBA: number; K: number;
}

export interface RosterView {
  date: string;
  phase: SeasonPhase;
  openingDate: string;
  /** 편성 가능 여부와 불가 사유(스토브리그 등) */
  editable: boolean;
  lockReason: string | null;
  /** 우리 구단 선수 전원(우리 선수라 실제 능력 공개) */
  players: PlayerListItem[];
  counts: { active: number; activePitchers: number; activeHitters: number; activeCatchers: number; activeMax: number };
  rules: string[];
  /** 재등록 제한 중인 선수: 선수 ID → 다시 등록할 수 있는 날짜 */
  reRegister: Record<string, string>;
  mode: 'auto' | 'manual';
  plan: GamePlanView | null;
  /** 지금 1군 기준 감독 추천안(구성 불가면 null) */
  recommended: GamePlanView | null;
  /** 저장된 계획이 지금 1군과 맞지 않는 이유 */
  planProblems: string[];
  exhibition: {
    dates: string[];
    record: { w: number; l: number; t: number };
    games: Array<{ date: string; opponent: string; home: boolean; us: number; them: number }>;
    lines: Record<string, ExhibitionLineView>;
  } | null;
  moves: Array<{ date: string; playerId: number; name: string; to: '1군' | '2군' }>;
  /** 4b-2 집중 훈련 계획 표와 코치별 담당 인원(D-128) */
  training: TrainingTableView;
}

// ───────── 6a 관중·티켓·시설 (13·14·16·D-141) ─────────

export type TicketPolicyView = 'low' | 'normal' | 'high';
export type FacilityKindView = 'stadium' | 'training' | 'rehab' | 'scouting';
export type CampaignKindView = 'family' | 'local' | 'online' | 'fanEvent';

export interface SponsorRowView {
  id: string;
  slot: 'main' | 'sub';
  brand: string;
  industry: string;
  tier: string;
  style: string;
  season: number;
  guaranteedWon: number;
  incentiveWon: number;
  incentive: string;
  obligation: string;
}

export interface BusinessView {
  date: string;
  club: { name: string; capacity: number };
  cashWon: number;
  startCashWon: number;
  /** 진행 중 공사의 남은 지급 합계 */
  committedWon: number;
  startAp: number;
  ticket: { policy: TicketPolicyView; priceWon: number; options: Array<{ key: TicketPolicyView; label: string; priceWon: number; demand: number }> };
  seasons: Array<{ season: number; games: number; total: number; average: number; occupancy: number; sellouts: number; ticketWon: number; leagueOccupancy: number | null }>;
  /** 6b 팬 만족도(0~100). 20 미만은 팬 반발, dismissDate까지 recoverAt 이상으로 회복하지 못하면 해임 */
  fans: { satisfaction: number; backlash: boolean; lowSince: string | null; dismissDate: string | null; recoverAt: number };
  campaignAp: number;
  /** 6d 굿즈: 제작업체, 상품군별 재고·발주·판매, 자동 재주문 정책 */
  merch: {
    vendor: string;
    vendorSeason: number;
    nextVendor: string | null;
    vendorAp: number;
    vendorOpen: boolean;
    vendorOptions: Array<{ kind: 'budget' | 'standard' | 'brand'; brandId: string | null; label: string; costPct: number; demandNote: string; leadWeeks: number; feeWon: number; reason: string | null }>;
    auto: boolean;
    autoAvailable: boolean;
    targetWeeks: number;
    targetWeeksRange: [number, number];
    canOrder: boolean;
    skus: Array<{ sku: 'uniform' | 'cap' | 'cheer'; label: string; priceWon: number; unitCostWon: number; minOrder: number; stock: number; avgCostWon: number; onOrder: number; nextArrival: string | null; sold: number; revenueWon: number; cogsWon: number; lastWeekSold: number }>;
    inventoryWon: number;
    season: number;
  };
  /** 6c 스폰서: 계약과 이번 스토브리그 제안 */
  sponsors: {
    signAp: number;
    open: boolean;
    note: string;
    contracts: Array<SponsorRowView & { by: string }>;
    offers: Array<SponsorRowView & { signReason: string | null }>;
  };
  campaigns: Array<{ kind: CampaignKindView; label: string; weeks: number; costWon: number; demandPct: number; satisfaction: number; active: { start: string; end: string } | null; startReason: string | null }>;
  facilities: Array<{
    kind: FacilityKindView;
    label: string;
    effect: string;
    needsApproval: boolean;
    level: number;
    maxLevel: number;
    upkeepWon: number;
    next: { level: number; costWon: number; weeks: number; firstPaymentWon: number; startDate: string; endDate: string } | null;
    /** 지금 착수할 수 없는 이유 */
    startReason: string | null;
    project: { toLevel: number; costWon: number; paidWon: number; start: string; end: string; started: boolean; payments: Array<{ date: string; amountWon: number; paid: boolean }> } | null;
  }>;
}

// ───────── 5a 트레이드 (09·18b·D-131) ─────────

/** cashWon > 0이면 우리가 상대에게, < 0이면 상대가 우리에게 낸다 */
export interface TradePackageView {
  give: number[];
  get: number[];
  cashWon: number;
}

export interface TradePlayerView {
  /** 우리 선수는 실제 능력, 상대 선수는 스카우트 추정 범위(기존 목록 규칙) */
  item: PlayerListItem;
  tradable: boolean;
  reason: string | null;
}

export interface TradeView {
  club: ClubRef;
  date: string;
  windowReason: string | null;
  /** 이번 주 세션: 열려 있으면 추가 행동력 없음 */
  session: { open: boolean; proposalsLeft: number; apCost: number };
  counter: TradePackageView | null;
  apRemaining: number;
  cashWon: number;
  limits: { maxPlayers: number; maxCashWon: number; proposalsPerSession: number };
  ours: TradePlayerView[];
  theirs: TradePlayerView[];
  log: Array<{ date: string; kind: string; result: string; message: string; give: string[]; get: string[]; cashWon: number }>;
  history: Array<{ date: string; sent: string[]; received: string[]; cashWon: number }>;
}

export interface TradePreviewView {
  errors: string[];
  ours: { before: number; after: number; salaryDelta: number };
  theirs: { before: number; after: number };
}

export interface TradeResultView {
  result: 'accept' | 'counter' | 'reject';
  message: string;
  counter: TradePackageView | null;
  apCharged: number;
  view: TradeView;
}
// ───────── 8a 리그 시상 (D-180) ─────────

export interface AwardItemView {
  season: number;
  award: string;
  slot: string;
  title: string;
  /** KBO 시상식·한국시리즈·골든글러브 시상식·월간 시상 */
  group: string;
  playerId: number | null;
  name: string;
  club: ClubRef | null;
  date: string;
  detail: string;
  /** 우리 구단 수상(구단주 달성) */
  mine: boolean;
}

export interface AwardsView {
  seasons: number[];
  season: number | null;
  items: AwardItemView[];
}

// ───────── 6e 예산 배분·특별 운영회의 (D-176·D-177) ─────────

export interface BudgetPlanView {
  year: number;
  setBy: 'owner' | 'auto';
  /** 운영비 배수(장부 금액과 효과) */
  ops: Array<{ kind: 'scouting' | 'futures' | 'teamOps'; label: string; multiplier: number; annualWon: number; effect: string }>;
  /** 재량 지출 한도와 집행·예약액(연봉은 현재 총액) */
  caps: Array<{ kind: 'payroll' | 'facility' | 'marketing' | 'merch'; label: string; limitWon: number; usedWon: number }>;
  editable: boolean;
  editNote: string;
}

export interface MeetingView {
  weekId: string;
  date: string;
  cashWon: number;
  fixedInWon: number;
  fixedOutWon: number;
  payrollWon: number;
  payrollLimitWon: number;
  execution: Array<{ cap: string; label: string; limit: number; used: number }>;
  items: Array<{ who: string; text: string }>;
}

export interface BudgetView {
  current: BudgetPlanView;
  /** 스토브리그의 다음 시즌 예산안 */
  planning: BudgetPlanView | null;
  meeting: { heldThisWeek: boolean; ap: number; latest: MeetingView | null };
  limits: { minMultiplier: number; maxMultiplier: number; step: number; capStepWon: number };
}

export interface BudgetPlanInput {
  year: number;
  ops: { scouting: number; futures: number; teamOps: number };
  caps: { payroll: number; facility: number; marketing: number; merch: number };
}

// ───────── 4c-3 경기 관전·승부처 참여 (D-160·D-174) ─────────

export interface LiveFeedItem {
  seq: number;
  inning: number;
  half: 'T' | 'B';
  kind: 'pa' | 'play' | 'sub' | 'pitcher';
  text: string;
  /** 원정:홈 점수(그 사건 뒤) */
  score: string;
  scoring: boolean;
  /** 승부처 타석의 투구 순서(화면용) */
  pitches?: string;
}

export interface LiveOption {
  key: string;
  label: string;
  /** 고를 수 없는 이유 */
  disabled: string | null;
}

export type LiveChoice =
  | { kind: 'prePa'; key: number; pitcherId?: number | null; ibb?: boolean; align?: { infield: 'normal' | 'in' | 'dp'; outfield: 'normal' | 'in' | 'back'; lines: boolean }; pinchHitter?: number | null; pinchRunners?: Array<{ base: number; playerId: number }>; play?: string }
  | { kind: 'count'; paSeq: number; balls: number; strikes: number; tactic: string };

export interface LiveDecisionView {
  kind: 'prePa' | 'count';
  key: number;
  role: 'off' | 'def';
  title: string;
  /** 타자·투수(우리 선수는 실제 능력치, 상대는 추정 범위) */
  batter: PlayerListItem;
  pitcher: PlayerListItem;
  /** 우리 쪽 승리 확률(%, 공개 상황 표), 레버리지 */
  winProb: number;
  leverage: number;
  /** 감독 추천(문구와 그대로 보낼 지시) */
  recommended: string;
  /** 우리 선수에 더해지는 감독 보정 문구 */
  managerNote: string;
  recommendation: LiveChoice;
  paSeq?: number;
  balls?: number;
  strikes?: number;
  pitchLog?: string;
  tactics?: LiveOption[];
  pitchers?: LiveOption[];
  currentPitches?: number;
  pinchHitters?: LiveOption[];
  pinchRunners?: Array<{ base: number; runner: string; options: LiveOption[] }>;
  plays?: LiveOption[];
  opponentIbb?: boolean;
}

export interface LiveGameGameView {
  date: string;
  fixtureId: number;
  home: ClubRef;
  away: ClubRef;
  userSide: 'home' | 'away';
  score: { home: number; away: number };
  lineScore: { home: number[]; away: number[] };
  inning: number;
  half: 'T' | 'B';
  outs: number;
  bases: boolean[];
  over: boolean;
  result: string | null;
  feed: LiveFeedItem[];
  decision: LiveDecisionView | null;
  participation: { enabled: boolean; used: number; max: number };
}

export interface LiveGameView {
  active: boolean;
  available: boolean;
  participate: boolean;
  game: LiveGameGameView | null;
}

/** 7b(D-157) 받은 트레이드 제안. 상대 선수는 스카우트 추정 범위로만 */
export interface TradeOfferView {
  id: number;
  club: ClubRef;
  stance: string | null;
  date: string;
  expires: string;
  give: PlayerListItem[];
  get: PlayerListItem[];
  /** 수락 때 낼 행동력(그 주 그 구단과 세션이 열려 있으면 0) */
  apCost: number;
}

export interface TradeOffersView {
  offers: TradeOfferView[];
  apRemaining: number;
}

export interface TradeOfferResultView {
  result: 'accept' | 'counter' | 'reject';
  message: string;
  apCharged: number;
  view: TradeOffersView;
}

/** 7b(D-157) 재임 기록과 해임 뒤 영입 제안 */
export interface TenureView {
  club: ClubRef;
  from: string;
  to: string | null;
  reason: string | null;
  seasons: Array<{ season: number; rank: number; wins: number; losses: number; ties: number; postseason: string }>;
  titles: number;
  postseasons: number;
  startCashWon: number;
  endCashWon: number;
}

export interface CareerView {
  level: number;
  tenures: TenureView[];
  jobOffers: Array<{ club: ClubRef; rank: number | null; stance: string | null; payrollWon: number; city: string }>;
}

// ───────── 4b-2 집중 훈련 (11·D-128) ─────────

export type TrainingIntensityView = 'low' | 'normal' | 'high';

export interface TrainingView {
  plan: { primary: string; primaryLabel: string; secondary: string | null; secondaryLabel: string | null; intensity: TrainingIntensityView; intensityLabel: string; since: string; source: string } | null;
  /** 이 선수에게 지정할 수 있는 목표 능력 */
  keys: Array<{ key: string; label: string }>;
  /** 주 목표 담당 코치(평판 지도력)·담당 인원·한도 */
  coach: { part: string; name: string | null; coaching: number | null; load: number; capacity: number };
  /** 주 목표 연간 성장 예상 증가율(%) 범위(보통 강도 기준): 선수 코칭 수용도를 모르므로 범위로만 */
  expected: { growthPctLow: number; growthPctHigh: number };
  intensities: Array<{ key: TrainingIntensityView; label: string; effect: number; injury: number }>;
  devWpLeft: number;
  delegateName: string | null;
}

export interface TrainingTableView {
  rows: Array<{ playerId: number; name: string; level: string; primaryLabel: string; secondaryLabel: string | null; intensityLabel: string; since: string; source: string; coachPart: string; coachName: string | null; injured: boolean }>;
  loads: Array<{ part: string; name: string | null; load: number; capacity: number }>;
}

// ───────── 선수 상세 행동 영역 (3d, 18a·D-118) ─────────

export type PlayerActionKey = 'faOffer' | 'faDelegate' | 'salaryOffer' | 'salaryDelegate' | 'foreignOffer' | 'release' | 'persuade' | 'rest' | 'medicalCheck' | 'train' | 'trainDelegate' | 'trainStop' | 'tradeInquiry' | 'extensionOffer' | 'domesticOffer';

/** 선수 상세에 보여줄 행동 하나. 가능 여부·비용·불가 사유는 게임 로직이 실행 명령과 같은 검증으로 계산한다. */
export interface PlayerActionView {
  key: PlayerActionKey;
  group: '계약·이적' | '면담' | '육성' | '건강' | '선수 정리';
  label: string;
  enabled: boolean;
  /** 지금 실행할 수 없는 이유와 해제 조건 */
  reason: string | null;
  apCost: number;
  /** 실행 주체·처리량 안내 (예: '운영팀 처리량 5') */
  executor: string;
  /** 구단 지출 안내(계약금·보상금·잔여 연봉 등). 없으면 null */
  costNote: string | null;
  primary: boolean;
}

export interface PlayerActionsView {
  playerId: number;
  /** 선수 소속 구단(트레이드 문의 이동용) */
  clubId: number | null;
  date: string;
  apRemaining: number;
  cashWon: number;
  /** 실제 데이터가 있는 상태만 (FA 협상 가능, 연봉 협상 대상, 은퇴 고민, 위임 진행 중 등) */
  badges: string[];
  actions: PlayerActionView[];
  fa: FaRowView | null;
  salary: SalaryTalkView | null;
  foreign: ForeignPlayerView | null;
  release: { salaryWon: number; contractYears: number; remainingWon: number; rosterCount: number; rosterMax: number; note: string | null } | null;
  persuade: { reason: string; deadline: string } | null;
  /** 5b: 연장 계약 요구(계약 마지막 해 우리 국내 선수, 시즌 중) */
  extension: { demand: ContractOfferView } | null;
  /** 5b: 국내 무소속 선수 요구 연봉 */
  domestic: { demandWon: number } | null;
  /** 우리 선수만: 집중 훈련 계획·담당 코치·예상 효과(4b-2) */
  training: TrainingView | null;
  ops: { mode: DelegationModeView; faMaxTotal: number; faMaxYears: number };
  /** 이 선수의 진행 중 위임 업무 */
  tasks: Array<{ taskId: number; kind: 'fa' | 'salary'; status: string; note: string }>;
  /** 우리 구단의 최근 제안 기록(직접·위임) */
  history: Array<{ date: string; kind: string; status: string; text: string }>;
}

export type PlayerScope = 'mine' | 'all' | number;

export interface PlayerQuery {
  scope: PlayerScope;
  group: 'all' | 'hitters' | 'pitchers';
  level?: '1군' | '2군' | 'all';
  search?: string;
  sortKey?: string;
  sortDesc?: boolean;
}


// ───────── 조직·위임 (2c) ─────────

export type DelegationModeView = 'direct' | 'approve' | 'auto';

export interface StaffView {
  id: number;
  name: string;
  age: number;
  title: string;
  teamKey: string | null;
  teamName: string | null;
  part: string | null;
  salaryWon: number;
  contractYears: number;
  /** 구단이 아는 평판(20~80). 실제 능력은 숨김 */
  abilities: Array<{ key: string; label: string; value: number }>;
  overall: number;
}

export interface TeamView {
  key: string;
  name: string;
  division: '야구' | '사업';
  leader: StaffView | null;
  /** 팀장 공석일 때 겸임 중인 본부장 이름 */
  actingName: string | null;
  members: StaffView[];
  memberLabel: string;
  defaultMembers: number;
  maxMembers: number;
  weeklyWp: number;
  upkeep: number;
  usedWp: number;
  remainingWp: number;
  upkeepShort: boolean;
  delegable: boolean;
  mode: DelegationModeView;
}

export interface DelegationPolicyView {
  team: string;
  mode: DelegationModeView;
  faMaxTotal: number;
  faMaxYears: number;
  salaryMaxRatioBp: number;
  cashFloor: number;
  hireMaxSalary: number;
}

export interface WorkTaskView {
  id: number;
  team: string;
  teamName: string;
  kind: 'fa' | 'salary' | 'hire' | 'roster';
  kindLabel: string;
  target: string;
  status: string;
  statusKey: string;
  created: string;
  updated: string;
  note: string;
}

export interface ApprovalView {
  id: number;
  kind: 'fa' | 'salary' | 'hire' | 'roster';
  teamName: string;
  kindLabel: string;
  date: string;
  summary: string;
}

export interface OrganizationView {
  weekLabel: string;
  apRemaining: number;
  cashWon: number;
  staffPayrollWon: number;
  headcount: number;
  secretary: StaffView | null;
  executives: StaffView[];
  coaches: StaffView[];
  /** 4c-2b 우리 감독(실제 능력치·성향·신뢰도·최근 결정 10건) */
  manager: {
    id: number;
    name: string;
    ratings: Array<{ key: string; label: string; value: number }>;
    smallBall: number;
    quickHook: number;
    trust: number;
    recent: Array<{ date: string; side: string; kinds: string; inning: number; delta: number; score: number }>;
  } | null;
  coachSlots: Array<{ part: string; squad: string; coach: StaffView | null }>;
  teams: TeamView[];
  lookaheadDays: number;
  scoutingNote: string;
  candidates: StaffView[];
  candidatesRefresh: string;
  policies: DelegationPolicyView[];
  tasks: WorkTaskView[];
  approvals: ApprovalView[];
  vacancies: Array<{ team: string; title: '팀장' | '팀원'; label: string }>;
  apCosts: { hire: number; fire: number };
  /** 구단주 결정: 모기업 긴급 지원, 리빌딩 선언 */
  owner: { crisisSince: string | null; emergencyAvailable: boolean; rebuild: string | null; canRebuild: boolean; rebuildAp: number };
}

/** 요청 이름 → 입력·출력 형식. 화면이 보낼 수 있는 요청은 이것뿐이다. */
export interface RequestMap {
  'app.status': { payload: void; result: AppStatus };
  'game.clubOptions': { payload: void; result: ClubOption[] };
  'game.new': { payload: { clubId: number; saveName: string; seed?: string }; result: DashboardView };
  'game.dashboard': { payload: void; result: DashboardView };
  'game.advance': { payload: { mode: 'day' | 'week' | 'untilSeasonEnd' }; result: AdvanceResult };
  'game.players': { payload: PlayerQuery; result: PlayerListItem[] };
  'game.player': { payload: { playerId: number }; result: PlayerDetailView };
  'player.note': { payload: { playerId: number; text: string; watched: boolean }; result: PlayerNoteView };
  'player.scout': { payload: { playerId: number }; result: PlayerDetailView };
  'player.actions': { payload: { playerId: number }; result: PlayerActionsView };
  'player.rest': { payload: { playerId: number; days: number }; result: OfferResultView };
  'player.medicalCheck': { payload: { playerId: number }; result: OfferResultView };
  'player.train': { payload: { playerId: number; primary: string; secondary: string | null; intensity: TrainingIntensityView }; result: OfferResultView };
  'player.trainDelegate': { payload: { playerId: number }; result: OfferResultView };
  'player.trainStop': { payload: { playerId: number }; result: OfferResultView };
  'club.view': { payload: { clubId: number }; result: ClubView };
  'club.note': { payload: { clubId: number; text: string; rival: boolean }; result: ClubNoteView };
  'business.view': { payload: undefined; result: BusinessView };
  'business.setTicketPolicy': { payload: { policy: TicketPolicyView }; result: { message: string; view: BusinessView } };
  'business.startFacility': { payload: { kind: FacilityKindView }; result: { message: string; view: BusinessView } };
  'business.startCampaign': { payload: { kind: CampaignKindView }; result: { message: string; view: BusinessView } };
  'business.signSponsor': { payload: { offerId: string }; result: { message: string; view: BusinessView } };
  'business.chooseVendor': { payload: { kind: 'budget' | 'standard' | 'brand'; brandId?: string }; result: { message: string; view: BusinessView } };
  'business.orderMerch': { payload: { sku: 'uniform' | 'cap' | 'cheer'; qty: number }; result: { message: string; view: BusinessView } };
  'business.setMerchPolicy': { payload: { auto: boolean; targetWeeks: number }; result: { message: string; view: BusinessView } };
  'business.cancelFacility': { payload: { kind: FacilityKindView }; result: { message: string; view: BusinessView } };
  'trade.view': { payload: { clubId: number }; result: TradeView };
  'trade.preview': { payload: { clubId: number } & TradePackageView; result: TradePreviewView };
  'trade.propose': { payload: { clubId: number; commandId: string } & TradePackageView; result: TradeResultView };
  'trade.acceptCounter': { payload: { clubId: number; commandId: string }; result: TradeResultView };
  'trade.offers': { payload: void; result: TradeOffersView };
  'live.view': { payload: void; result: LiveGameView };
  'live.start': { payload: void; result: LiveGameView };
  'live.decide': { payload: { choice: LiveChoice }; result: LiveGameView };
  'live.settings': { payload: { participate: boolean }; result: LiveGameView };
  'budget.view': { payload: void; result: BudgetView };
  'budget.set': { payload: BudgetPlanInput; result: { message: string; apCharged: number; view: BudgetView } };
  'meeting.convene': { payload: void; result: { message: string; view: BudgetView } };
  'awards.list': { payload: { season?: number }; result: AwardsView };
  'trade.respondOffer': { payload: { offerId: number; accept: boolean; commandId: string }; result: TradeOfferResultView };
  'owner.career': { payload: void; result: CareerView };
  'owner.acceptJob': { payload: { clubId: number }; result: DashboardView };
  'roster.view': { payload: void; result: RosterView };
  'roster.move': { payload: { promote: number[]; demote: number[] }; result: { message: string; view: RosterView } };
  'roster.setPlan': { payload: { mode: 'auto' | 'manual'; plan?: GamePlanView }; result: { message: string; view: RosterView } };
  'game.standings': { payload: void; result: StandingView[] };
  'game.schedule': { payload: { clubId?: number; month?: string }; result: FixtureView[] };
  'game.boxScore': { payload: { fixtureId: number }; result: BoxScoreView };
  'game.startNextSeason': { payload: void; result: DashboardView };
  'game.inbox': { payload: void; result: InboxItemView[] };
  'game.inboxRead': { payload: { id: number }; result: { ok: true } };
  'game.finance': { payload: void; result: FinanceView };
  'game.calendar': { payload: { from: string; to: string }; result: CalendarEventView[] };
  'market.view': { payload: void; result: MarketView };
  'market.faOffer': { payload: { playerId: number; years: number; salaryWon: number; bonusWon: number }; result: OfferResultView };
  'market.salaryOffer': { payload: { playerId: number; offerWon: number }; result: OfferResultView };
  'market.salaryAuto': { payload: void; result: OfferResultView };
  'market.extensionOffer': { payload: { playerId: number; years: number; salaryWon: number; bonusWon: number }; result: OfferResultView };
  'market.domesticOffer': { payload: { playerId: number; salaryWon: number }; result: OfferResultView };
  'market.foreignOffer': { payload: { playerId: number; salaryUsd: number }; result: OfferResultView };
  'market.release': { payload: { playerId: number }; result: OfferResultView };
  'org.view': { payload: void; result: OrganizationView };
  'org.hire': { payload: { staffId: number }; result: OfferResultView };
  'org.fire': { payload: { staffId: number }; result: OfferResultView };
  'org.setPolicy': { payload: DelegationPolicyView; result: OfferResultView };
  'org.delegateFa': { payload: { playerId: number; maxTotalWon?: number; maxYears?: number }; result: OfferResultView };
  'org.delegateSalary': { payload: { playerId?: number }; result: OfferResultView };
  'org.delegateHire': { payload: { team: string; title: '팀장' | '팀원'; maxSalaryWon?: number }; result: OfferResultView };
  'org.cancelTask': { payload: { taskId: number }; result: OfferResultView };
  'org.approve': { payload: { approvalId: number }; result: OfferResultView };
  'org.reject': { payload: { approvalId: number }; result: OfferResultView };
  'org.decideMany': { payload: { approvalIds: number[]; approve: boolean }; result: OfferResultView };
  'game.team': { payload: void; result: TeamRecordsView };
  'game.hallOfFame': { payload: { clubId: number }; result: TeamRecordsView };
  'draft.view': { payload: void; result: DraftView };
  'draft.setBoard': { payload: { ids: number[] }; result: DraftView };
  'roster.persuade': { payload: { playerId: number }; result: OfferResultView };
  'owner.emergency': { payload: void; result: OfferResultView };
  'owner.rebuild': { payload: void; result: OfferResultView };
  'save.list': { payload: void; result: SaveSlotInfo[] };
  'save.save': { payload: { slot: string }; result: SaveSlotInfo };
  'save.load': { payload: { slot: string; backupIndex?: number }; result: DashboardView };
  'save.resumeSession': { payload: void; result: DashboardView };
}

export type RequestName = keyof RequestMap;
export const REQUEST_NAMES: readonly RequestName[] = [
  'app.status',
  'game.clubOptions',
  'game.new',
  'game.dashboard',
  'game.advance',
  'game.players',
  'game.player',
  'player.note',
  'player.scout',
  'player.actions',
  'player.rest',
  'player.medicalCheck',
  'player.train',
  'player.trainDelegate',
  'player.trainStop',
  'club.view',
  'club.note',
  'business.view',
  'business.setTicketPolicy',
  'business.startFacility',
  'business.startCampaign',
  'business.signSponsor',
  'business.chooseVendor',
  'business.orderMerch',
  'business.setMerchPolicy',
  'business.cancelFacility',
  'trade.view',
  'trade.preview',
  'trade.propose',
  'trade.acceptCounter',
  'trade.offers',
  'live.view',
  'live.start',
  'live.decide',
  'live.settings',
  'budget.view',
  'budget.set',
  'meeting.convene',
  'awards.list',
  'trade.respondOffer',
  'owner.career',
  'owner.acceptJob',
  'roster.view',
  'roster.move',
  'roster.setPlan',
  'game.standings',
  'game.schedule',
  'game.boxScore',
  'game.startNextSeason',
  'game.inbox',
  'game.inboxRead',
  'game.finance',
  'game.calendar',
  'market.view',
  'market.faOffer',
  'market.salaryOffer',
  'market.salaryAuto',
  'market.foreignOffer',
  'market.extensionOffer',
  'market.domesticOffer',
  'market.release',
  'org.view',
  'org.hire',
  'org.fire',
  'org.setPolicy',
  'org.delegateFa',
  'org.delegateSalary',
  'org.delegateHire',
  'org.cancelTask',
  'org.approve',
  'org.reject',
  'org.decideMany',
  'game.team',
  'game.hallOfFame',
  'draft.view',
  'draft.setBoard',
  'roster.persuade',
  'owner.emergency',
  'owner.rebuild',
  'save.list',
  'save.save',
  'save.load',
  'save.resumeSession',
];

export interface ProgressEvent {
  type: 'advanceProgress';
  date: string;
  daysProcessed: number;
  gamesPlayed: number;
}

export type ApiResponse<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } };

/** 사용자에게 보여줄 오류. code로 화면이 복구 경로를 고른다. */
export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
