// 규칙 설정. 코드 속 숫자는 의미 있는 이름으로 이곳에서 관리한다(claude.md 공통 구현 계약).
//
// 표기 규칙
//  - CONFIRMED: 기획 문서·결정 로그에서 확정된 값 (바꾸려면 결정 로그 갱신 필요)
//  - ASSUMPTION: 기획에 없어 구현을 위해 둔 임시 가정 (바꾸기 쉽게 이곳에만 둔다)

export const RULES_VERSION = 2;

/** CONFIRMED (D-006, D-008, D-016, 01·09 문서) */
export const LEAGUE = {
  clubs: 10,
  gamesPerOpponent: 16,
  gamesPerSeason: 144,
  regularSeasonMaxInnings: 11,
  rosterMax: 40,
  activeRoster: 26,
  activePitchers: 13,
  activeHitters: 13,
} as const;

/** CONFIRMED (D-007, D-010): 정규시즌 26주 편성 */
export const SCHEDULE = {
  openingMonth: 3,
  openingSaturdayOrdinal: 4, // 3월 넷째 토요일
  allStarMonth: 7,
  allStarSaturdayOrdinal: 2, // 7월 둘째 토요일
  fullWeeks: 25,
  twoGameWeeksAtEnd: 4,
  threeGameMeetingsPerPair: 4,
  twoGameMeetingsPerPair: 2,
} as const;

/** CONFIRMED (D-061): 실제 2026 한국시리즈 최종전 날 스토브리그에서 시작한다. 첫 시즌은 2027. */
export const NEW_GAME = {
  startDate: '2026-11-08',
  previousSeason: 2026,
  firstSeason: 2027,
} as const;
export const FIRST_SEASON = NEW_GAME.firstSeason;

/** CONFIRMED (D-061·01 문서): 스토브리그 리그 일정. K = 한국시리즈 최종전 날짜. */
export const STOVE = {
  faNoticeAfterK: 5,
  faApplyDeadlineAfterK: 7,
  faApprovalAfterK: 8,
  faMarketAfterK: 9,
  reserveListMonthDay: '11-30',
  inactivePeriodStart: '12-01',
  arbitrationDeadline: '01-10',
  campRosterDeadline: '01-31',
  seasonModeStartMonthDay: '02-01', // 2월 1일이 속한 주의 월요일에 시즌 모드 시작
} as const;

/** CONFIRMED (02 문서): 레벨별 주간 행동력, 레벨업 필요 경험치 100 + 25 × (L−1) */
export const OWNER = {
  weeklyApByLevel: [
    { minLevel: 20, ap: 14 },
    { minLevel: 15, ap: 12 },
    { minLevel: 10, ap: 10 },
    { minLevel: 5, ap: 8 },
    { minLevel: 1, ap: 6 },
  ],
  xpBase: 100,
  xpPerLevel: 25,
} as const;

/** CONFIRMED (D-037): 물가 상승률 범위(bp). 시즌 연도가 바뀔 때 사업 난수로 정한다. */
export const INFLATION = { minBp: 150, maxBp: 350, baseYear: 2026 } as const;

/** ASSUMPTION: 선수 생성 분포 (선수·성장 모델이 구현되면 교체) */
export const WORLDGEN = {
  pitchersPerClub: 20,
  hittersPerClub: 20,
  startersPerClub: 6,
  activeStarters: 5,
  strengthShift: { 상: 3, 중: 0, 하: -3 } as Record<string, number>,
  ratingMean: 50,
  ratingSd: 11,
  minAge: 19,
  maxAge: 37,
  minSalary: 30_000_000, // CONFIRMED: 2026 최저 연봉 3,000만 원 (D-038)
} as const;

/** ASSUMPTION: 타석 결과 기준 확률 (가상 리그 목표 밸런스, 10 문서: 실제 리그 재현이 아님) */
export const SIM = {
  base: {
    bb: 0.088,
    hbp: 0.011,
    k: 0.19,
    hr: 0.024,
    babip: 0.305,
    doubleShareOfHits: 0.2,
    tripleShareOfHits: 0.018,
    groundballShareOfOuts: 0.46,
    errorOnBallInPlay: 0.014,
  },
  /** 능력 1표준편차(약 11점)당 영향의 크기. exp(k × (값-50)/50) 형태로 쓴다. */
  effect: {
    eyeOnBb: 0.55,
    controlOnBb: 0.55,
    stuffOnK: 0.5,
    contactOnK: 0.5,
    powerOnHr: 0.9,
    stuffOnHr: 0.35,
    groundballOnHr: 0.3,
    contactOnBabip: 0.16,
    defenseOnBabip: 0.1,
    stuffOnBabip: 0.06,
    powerOnDoubles: 0.4,
    speedOnTriples: 0.8,
    groundballOnGb: 0.35,
    defenseOnErrors: 0.5,
  },
  advance: {
    singleScoresFromSecond: 0.6,
    singleFirstToThird: 0.25,
    doubleScoresFromFirst: 0.42,
    sacFlyFromThird: 0.55,
    flyoutSecondToThird: 0.3,
    groundoutAdvance: 0.55,
    doublePlay: 0.42,
  },
  pitches: { k: 4.8, bb: 5.6, hbp: 3.6, other: 3.4, jitter: 1.2 },
  starterPitchLimitBase: 72,
  starterPitchLimitPerStamina: 0.5, // 체력 100이면 122구
  starterRunsBeforeHook: 6,
  relieverPitchLimit: 28,
  starterRestDays: 4,
  closerMaxLead: 3,
  winQualifyingOutsForStarter: 15,
  saveMaxLead: 3,
  saveMinOuts: 3,
} as const;

/** ASSUMPTION: 관찰(스카우트 평가) 오차. 06 문서의 스카우트 모델 구현 전 임시값 */
export const OBSERVATION = {
  otherClubSd: 7,
  displayStep: 5, // 20~80 평가는 5점 단위
} as const;

/** CONFIRMED: 표시 평가 20~80 (04 문서). 내부 0~100을 하나의 함수로 변환한다. */
export function toScoutScale(internal: number): number {
  return 20 + Math.max(0, Math.min(100, internal)) * 0.6;
}

/** 저장 관련 설정 (03_development, 20 문서) */
export const SAVE = {
  autosaveEveryDays: 7,
  manualBackupsKept: 2,
  autosaveBackupsKept: 3,
} as const;

/** 외국인 계약 규정 (사용자 제공 KBO 규정, D-048). 달러 금액은 고정 환율로 원화 장부에 기록한다. */
export const FOREIGN = {
  usdKrw: 1_400,
  newCapUsd: 1_000_000,
  totalCapUsd: 4_000_000,
  totalCapPerRenewalUsd: 100_000,
  asiaNewCapUsd: 200_000,
  asiaRenewalStepUsd: 100_000,
  maxForeign: 3,
  maxAsia: 1,
} as const;

export const usdToWon = (usd: number) => usd * FOREIGN.usdKrw;
export const wonToUsd = (won: number) => Math.round(won / FOREIGN.usdKrw);

/** ASSUMPTION(D-095): 마감일 있는 의무 안건(40인 초과 정리). 운영팀은 마감 actWindowDays일 전부터 정리안을 실행·상정한다. */
export const ROSTER_OBLIGATION = {
  actWindowDays: 7,
} as const;

/**
 * ASSUMPTION(D-098): 포지션 최소 인원. AI 구단·우리 운영팀의 드래프트·FA·외국인·방출 판단과 1군 편성이 함께 쓴다.
 * 40인 기준 투수·야수 각 17명 이상, 포수 3명 이상. 1군 26인 기준 투수 12명·야수 13명 이상.
 */
/** ASSUMPTION(D-098): 국내 미계약 선수 풀 규모(새 게임·시즌 마감마다 생성)와 능력 평균 보정 */
export const FREE_POOL = {
  pitchers: 8,
  starters: 3,
  catchers: 3,
  otherHitters: 6,
  ratingShift: -6,
} as const;

export const ROSTER_COMPOSITION = {
  minPitchers: 17,
  minHitters: 17,
  minCatchers: 3,
  activeMinPitchers: 12,
  activeMinHitters: 13,
} as const;
