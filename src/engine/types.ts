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

/** 내부 능력 0~100 (04 문서) */
export interface BattingRatings {
  contact: number;
  eye: number;
  power: number;
  speed: number;
}
export interface PitchingRatings {
  stuff: number;
  control: number;
  groundball: number;
  stamina: number;
}
export interface DefenseRatings {
  fielding: number; // 주 포지션 숙련도
  arm: number;
  range: number;
}

/** 히든 요소. 이번 단계에서는 생성·저장만 하고 성장 모델(5단계)에서 사용한다. */
export interface HiddenAttributes {
  potential: Partial<Record<keyof BattingRatings | keyof PitchingRatings, number>>;
  growthRate: number;
  peakAge: number;
  coachability: number;
  workEthic: number;
  durability: number;
  recovery: number;
  adaptability: number;
  leadership: number;
  competitiveness: number;
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
  hidden: HiddenAttributes;
  /** 아마추어 시절 개인 업적(D-084) */
  honors?: string[];
  /** 신인 드래프트 지명 정보 */
  draft?: { year: number; round: number; pick: number; school: string };
  /** 은퇴(시즌·사유). 은퇴 선수는 소속이 없다 */
  retired?: { season: number; reason: string };
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
