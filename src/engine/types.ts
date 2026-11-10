// 엔진 도메인 타입. 실제 능력(히든 포함)은 PlayerTruth에만 있고, 화면용 데이터는 별도로 만든다(04 문서).
import type { GameDate } from './calendar';
import type { Won } from './money';

export type ClubId = number;
export type PlayerId = number;
export type FixtureId = number;

export type Difficulty = '쉬움' | '보통' | '어려움' | '매우 어려움';
export type StrengthTier = '상' | '중' | '하';

export interface ClubProfile {
  id: ClubId;
  name: string; // 가상 구단명 (21 문서)
  shortName: string;
  city: string;
  stadium: string;
  stadiumCapacity: number;
  sharedStadiumGroup: string | null; // 같은 값을 가진 구단은 동시 홈경기 불가 (D-035)
  parentIndustry: string;
  colors: string;
  difficulty: Difficulty;
  startCash: Won;
  parentSupport: Won;
  namingRights: Won;
  marketSize: number;
  loyalty: '낮음' | '보통' | '높음' | '매우 높음';
  strength: StrengthTier;
  prospectHeavy: boolean;
  /** 엠블럼·화면 색 (hex) */
  primaryColor: string;
  secondaryColor: string;
}

/** 직전 시즌 결과 요약 (첫 스토브리그는 실제 2026 KBO 결과, D-061) */
export interface SeasonStanding {
  season: number;
  clubId: ClubId;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  postseason: string;
}

export type Hand = 'R' | 'L' | 'S';
export type Position = 'SP' | 'RP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';
export const FIELD_POSITIONS: readonly Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/**
 * 능력치 1~100 정수(계산은 소수 허용), 50 = 초기 리그 평균 (D-086).
 * 타자·야수 12개 = batting 8 + defense 4 (D-087). 투수는 pitching(구속은 km/h로 따로) + 구종 배열.
 */
export interface BattingRatings {
  contact: number;
  power: number;
  eye: number;
  /** 주루 판단(추가 진루·도루 판단). 순수 속도와 별개 */
  baserunning: number;
  speed: number;
  bunt: number;
  /** 압박 상황의 수행 저하 완화(평상시 상시 보너스 아님, 3b 압박 경로에서 사용) */
  mental: number;
  /** 경기·시즌 피로 누적 저항 */
  stamina: number;
}
export interface PitchingRatings {
  /** 평균 구속(km/h). 1~100 능력치가 아님 */
  velocityAvg: number;
  /** 최고 구속(km/h) */
  velocityMax: number;
  stuff: number;
  control: number;
  groundball: number;
  mental: number;
  /** 견제(주자 리드 억제) */
  holdRunners: number;
  stamina: number;
  /** 등판 뒤 피로 회복 */
  recovery: number;
  /** 투수 수비(번트·땅볼 처리, 베이스 커버) */
  fielding: number;
}
export interface DefenseRatings {
  /** 수비 반응·범위 */
  range: number;
  /** 포구 */
  fielding: number;
  armStrength: number;
  armAccuracy: number;
}
/** 포수 전용 (D-087) */
export interface CatcherRatings {
  blocking: number;
  framing: number;
  /** 송구 전환 */
  transfer: number;
}
/** 포지션 숙련도 0~100 (주 포지션은 높고, 낯선 포지션은 낮다) */
export type PositionSkills = Partial<Record<Position, number>>;

export type PitchType = '포심' | '투심' | '커터' | '슬라이더' | '커브' | '체인지업' | '스플리터' | '포크';
export const FASTBALL_TYPES: readonly PitchType[] = ['포심', '투심', '커터'];
export interface Pitch {
  type: PitchType;
  /** 평균 구속(km/h) */
  velocity: number;
  movement: number;
  /** 구종 제구: 선수 전체 제구에 대한 구종별 편차로 해석 */
  command: number;
  /** 구종 품질: 공통 구위 대비 잔차로 해석 */
  quality: number;
  mastery: number;
  /** 사용 비중(구종 합 1) */
  usage: number;
}

export type ContractPreference = '금액' | '기간' | '우승 전력' | '출전 기회' | '연고';

/**
 * 히든 요소 12종 (D-088). 화면·통신 계층에 숫자로 보내지 않는다.
 * 잠재력·성실성·코칭 수용도는 성장 시스템에만 쓰고 매 타석에 더하지 않는다.
 */
export interface HiddenAttributes {
  /** 능력별 잠재 상한 */
  potential: Partial<Record<keyof BattingRatings | keyof PitchingRatings | keyof DefenseRatings, number>>;
  /** 성장 속도 */
  growthRate: number;
  /** 정점 나이(노화 곡선) */
  peakAge: number;
  /** 노화 속도 */
  declineRate: number;
  workEthic: number;
  coachability: number;
  adaptability: number;
  /** 일관성: 경기별 수행 편차·최근 성적 민감도(10a) */
  consistency: number;
  /** 내구성(높을수록 부상 덜 함) */
  durability: number;
  /** 회복 성향(휴식·정신적 피로 회복). 투수 능력치 '회복력'과 다르다 */
  recoveryTendency: number;
  /** 압박 민감도(낮을수록 덜 민감) */
  pressureSensitivity: number;
  leadership: number;
  competitiveness: number;
  contractPreference: ContractPreference;
}

export type RosterLevel = '1군' | '2군';

/** 선수 출신: 국내, 외국인(3명), 아시아쿼터(1명) (D-046·D-048) */
export type PlayerOrigin = 'domestic' | 'foreign' | 'asia';

/** 선수 경력 (첫 스토브리그 세계 생성 시 함께 만든다, 22 문서) */
export interface PlayerCareer {
  proSeasons: number;
  /** FA 자격 연수(1군 등록 기준). FA 규칙 세부는 2b 단계에서 구현 */
  faServiceYears: number;
  /** 이번 스토브리그에 FA 자격을 얻는 선수 */
  faEligible: boolean;
  /** 우리 구단 간판 선수 표시 (첫 안건) */
  franchise: boolean;
  /** 외국인·아시아쿼터: KBO 재계약 연차(같은 구단에서 재계약한 횟수). 국내 선수는 0 */
  foreignRenewals: number;
  /** 마지막 FA 계약이 시작된 시즌(재FA는 4시즌 뒤, D-085) */
  lastFaSeason?: number;
  /** 은퇴 설득으로 한 시즌 더 뛰기로 한 시즌 */
  persuadedSeason?: number;
}

export interface PlayerTruth {
  id: PlayerId;
  name: string;
  birthDate: GameDate;
  bats: Hand;
  throws: 'R' | 'L';
  isPitcher: boolean;
  origin: PlayerOrigin;
  position: Position;
  clubId: ClubId | null;
  level: RosterLevel;
  /** 현재 계약의 연봉. 연봉은 2~11월 10회로 나눠 지급한다(D-059). */
  salary: Won;
  /** 현재 시즌 이후 남은 계약 연수. 0이면 이번 시즌으로 계약이 끝난다. */
  contractYears: number;
  career: PlayerCareer;
  batting: BattingRatings;
  pitching: PitchingRatings | null;
  defense: DefenseRatings;
  /** 포수만 */
  catcher?: CatcherRatings;
  positions: PositionSkills;
  /** 투수만 */
  pitches?: Pitch[];
  hidden: HiddenAttributes;
  /** 아마추어 시절 개인 업적(D-084) */
  honors?: string[];
  /** 신인 드래프트 지명 정보 */
  draft?: { year: number; round: number; pick: number; school: string };
  /** 은퇴(시즌·사유). 은퇴 선수는 소속이 없다 */
  retired?: { season: number; reason: string };
  /** 성장·노화 누적 상태(4a, D-124). 내부 계산용이며 화면 응답에 그대로 넣지 않는다 */
  dev?: DevelopmentState;
  /** 부상 상태·이력(4b-1, D-126). 실제 복귀일은 화면 응답에 넣지 않는다 */
  health?: HealthState;
}

export interface InjuryState {
  part: string;
  severity: string;
  /** 부상 발생일(그날 경기 뒤) */
  date: GameDate;
  /** 실제 복귀일(이날부터 출전 가능). 숨김 */
  returnDate: GameDate;
  /** 메디컬팀 진단 추정 복귀 범위 */
  estimate: { from: GameDate; to: GameDate };
  /** 부상으로 1군에서 내렸는가, 부상 전 1군이었는가 */
  demoted: boolean;
  wasActive: boolean;
}

export interface HealthState {
  injury: InjuryState | null;
  /** 지난 부상: 발생일·복귀일·부위·중증도 */
  history: Array<{ date: GameDate; returnDate: GameDate; part: string; severity: string }>;
  /** 마지막 특별 검사일 */
  lastCheck?: GameDate;
}

export interface DevelopmentState {
  /** 능력별 소수 누적(정수·0.1km/h 단위 반영 전) */
  acc: Record<string, number>;
  /** 마지막 월간 반영 'YYYY-MM' */
  month?: string;
  /** 마지막 연간(스토브리그) 반영 시즌 */
  season?: number;
  /** 마지막 연간 반영 직후(또는 첫 반영 직전) 능력: 우리 선수 변화 보고 기준 */
  base?: Record<string, number>;
  baseDate?: string;
}

export interface Fixture {
  id: FixtureId;
  season: number;
  date: GameDate;
  home: ClubId;
  away: ClubId;
  seriesId: number;
  gameInSeries: number;
  /** 경기 단계. 없으면 정규시즌 */
  stage?: GameStage;
}

/** 정규시즌, 와일드카드, 준플레이오프, 플레이오프, 한국시리즈 */
export type GameStage = 'regular' | 'wc' | 'semi' | 'po' | 'ks';
