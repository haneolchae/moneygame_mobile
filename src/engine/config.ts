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

/** ASSUMPTION(D-087): 선수 생성 분포. 능력치 목록은 D-087, 분포는 초기안(성장 모델이 구현되면 교체) */
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

/**
 * ASSUMPTION(D-093): 경기 운영 설정(주자 진루·투구 수·투수 교체). 타석 결과 확률은 probabilityConfig(10a)에 있다.
 */
export const SIM = {
  /** 주자 진루 판단에 쓰는 속도: 주력 비중(나머지는 주루 판단) */
  runnerSpeedWeight: 0.6,
  /** 포지션 숙련도 반영: 주 포지션 평균 수준(pivot)과 차이 1점당 수비 지수 변화(weight) */
  positionSkillPivot: 70,
  positionSkillWeight: 0.5,
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

/** ASSUMPTION(D-089): 관찰(스카우트 평가) 오차. 3c 스카우트 추정 범위 구현 전 임시값 */
export const OBSERVATION = {
  otherClubSd: 7,
  displayStep: 5, // 다른 구단 선수 평가는 1~100 척도 5점 단위(3c 추정 범위 전까지)
} as const;

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
/**
 * 미지명 졸업자 FA 등록(D-099, 사용자 확정·기준 초기안): 시즌 마감 때 진학하지 않은 고교 졸업자 중 프로 진출 신청 기준
 * (DRAFT.hsApplyScore와 같은 값) 이상, 대학 졸업자 중 colMinScore 이상이 소속 없는 FA로 등록된다.
 * 1년 동안 계약하지 못한 국내 무소속 선수는 다음 시즌 마감 때 은퇴한다.
 */
export const UNDRAFTED_FA = {
  // D-125: 아마추어 척도와 함께 9 낮춤(38·40 → 29·31)
  hsMinScore: 29,
  colMinScore: 31,
} as const;

/** ASSUMPTION(D-098): 국내 미계약 선수 풀 규모(새 게임 시작 때 1회 생성, 이후 공급은 D-099 미지명 졸업자)와 능력 평균 보정 */
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

/** 2d 사용자 1·2군 편성·경기 운영 계획 (D-119 행동력 0, D-120) */
export const ROSTER_MOVE = {
  /** ASSUMPTION(D-120): 개막 뒤 1군에서 말소한 선수는 10일 뒤 재등록(KBO 원문 확인 필요) */
  reRegisterDays: 10,
  /** ASSUMPTION(D-120): 사용자 편성의 1군 포수 최소 인원(주전 + 백업) */
  activeMinCatchers: 2,
  /** 수동 선발 로테이션 인원 */
  rotationSize: 5,
} as const;

/** 4b-1 건강: 피로·부상·휴식·검사 (D-126 초기안) */
export const HEALTH = {
  /** 피로(0~100)는 최근 7일 출전 기록에서 계산 */
  fatigueDays: 7,
  fatigueDecay: 0.85,
  hitterGameLoad: 12,
  catcherFactor: 1.3,
  pitchLoad: 0.4,
  /** 감독 자동 운영: 이 피로 이상 야수는 대체 가능하면 선발 제외 */
  autoRestFatigue: 70,
  /** ASSUMPTION(D-126): 출전 1회당 기본 부상 확률과 보정 */
  baseInjuryChance: 0.005, // 매일 출전 주전의 피로 계수(약 2.1)를 반영해 구단당 연 약 20건 목표(D-126 정정)
  fatigueDivisor: 50,
  agePivot: 30,
  agePerYear: 0.03,
  durabilityMax: 1.3,
  durabilitySpan: 0.6,
  /** 중증도: 누적 비율과 기간(일) */
  severities: [
    { label: '경미', share: 0.5, min: 1, max: 7 },
    { label: '보통', share: 0.3, min: 8, max: 30 },
    { label: '중증', share: 0.17, min: 31, max: 90 },
    { label: '시즌 아웃', share: 0.03, min: 91, max: 180 },
  ],
  /** 메디컬팀 역량(0~1)에 따른 실제 기간 단축 최대·추정 범위 폭 */
  maxRecoveryCut: 0.15,
  estimateWidthBest: 0.15,
  estimateWidthWorst: 0.4,
  /** 이 일수 이상이면 1군에서 내리고 대체 선수를 올린다 */
  demoteDays: 10,
  /** 1군 건강 최소 인원(이보다 적으면 짧은 부상자도 내리고 채운다) */
  healthyMinHitters: 10,
  healthyMinPitchers: 10,
  restMaxDays: 3,
  checkAp: 1,
  checkCooldownDays: 7,
  /** 외국인 장기 부상 알림 기준(일) */
  foreignLongDays: 42,
} as const;

/** 6a 관중·티켓·매점(D-141 초기안) */
export const ATTENDANCE = {
  baseOccupancy: 0.62,
  marketBase: 0.85,
  marketSlope: 0.15,
  loyaltyBase: { 낮음: 0.96, 보통: 1.0, 높음: 1.04, '매우 높음': 1.08 } as Record<string, number>,
  /** 성적 민감도: 충성도가 높을수록 부진기에도 덜 줄어든다 */
  loyaltySensitivity: { 낮음: 0.6, 보통: 0.5, 높음: 0.35, '매우 높음': 0.25 } as Record<string, number>,
  /** 시즌 초 이 경기 수까지 직전 시즌 승률과 섞는다 */
  blendGames: 20,
  /** 요일 배율(0=일 … 6=토) */
  weekday: [1.12, 0.92, 0.92, 0.92, 0.92, 1.05, 1.2] as readonly number[],
  opponentSlope: 0.08,
  noise: 0.05,
  minOccupancy: 0.2,
  /** 2026 기준 평균 객단가·매점 객단가(원), 매점 구단 몫, 입장수입 관람료 비율 */
  ticketPriceWon: 15_000,
  concessionPerHeadWon: 7_000,
  concessionShareBp: 5_000,
  gateFeeBp: 1_000,
  policy: {
    low: { label: '저가', price: 0.85, demand: 1.08 },
    normal: { label: '보통', price: 1.0, demand: 1.0 },
    high: { label: '고가', price: 1.2, demand: 0.88 },
  },
} as const;

/** 6b 팬 만족도·캠페인(D-147 초기안, 팬 반발 해임은 D-043). 비용은 2026 기준(물가 연동) */
export const MARKETING = {
  startSatisfaction: 50,
  loyaltyBonus: { 낮음: -5, 보통: 0, 높음: 5, '매우 높음': 10 } as Record<string, number>,
  /** 목표 = 50 + pctSlope × (승률 − 0.5) + 충성도 + 캠페인, 매주 차이의 weeklyMove만큼 이동 */
  pctSlope: 100,
  targetMin: 5,
  targetMax: 95,
  weeklyMove: 0.1,
  /** 관중 수요 × (1 + demandSlope × (만족도 − 50) / 50) */
  demandSlope: 0.15,
  backlashBelow: 20,
  backlashDemand: 0.8,
  recoverAt: 25,
  dismissWeeks: 8,
  campaignAp: 2,
  maxDemandBoost: 0.08,
  maxSatisfactionBoost: 8,
  campaigns: {
    family: { label: '가족 프로모션', weeks: 4, costWon: 300_000_000, demand: 0.04, satisfaction: 0 },
    local: { label: '지역 행사', weeks: 4, costWon: 200_000_000, demand: 0, satisfaction: 4 },
    online: { label: '온라인 콘텐츠', weeks: 8, costWon: 200_000_000, demand: 0.02, satisfaction: 2 },
    fanEvent: { label: '선수 팬 행사', weeks: 2, costWon: 150_000_000, demand: 0, satisfaction: 5 },
  },
  /** AI 구단이 실행하는 캠페인과 현금 하한(시작 현금 배수) */
  aiKinds: ['family', 'online'] as readonly string[],
  aiCashFloor: 0.9,
} as const;

/** 6a 시설 투자(D-141: 큰 투자 방향은 사용자 확정 D-135, 수치 초기안). 금액은 2026 기준(물가 연동) */
export const FACILITY = {
  maxLevel: 5,
  /** 다음 단계(2~5) 공사비·공사 기간(주) */
  costWon: { 2: 6_000_000_000, 3: 10_000_000_000, 4: 16_000_000_000, 5: 24_000_000_000 } as Record<number, number>,
  weeks: { 2: 12, 3: 16, 4: 20, 5: 24 } as Record<number, number>,
  /** 지급: 착공·중간·완공 (bp) */
  paymentsBp: [3_000, 4_000, 3_000] as readonly number[],
  upkeepPerLevelWon: 200_000_000,
  startAp: 3,
  /** 구장 시설: 지자체 승인(주) */
  approvalWeeks: 4,
  /** AI·장기 실행 드라이버: 투자 뒤에도 남길 현금 = 시작 현금 × 이 값 */
  aiCashFloor: 0.9,
  kinds: {
    stadium: { label: '구장 편의시설', effect: '관중 수요 +3%, 매점 객단가 +5% (단계당)', needsApproval: true },
    training: { label: '실내 훈련장', effect: '집중 훈련 효과 +4% (단계당)', needsApproval: false },
    rehab: { label: '재활센터', effect: '메디컬 역량 +0.05 (단계당)', needsApproval: false },
    scouting: { label: '분석·스카우팅 사무실', effect: '스카우트 추정 오차 −3% (단계당)', needsApproval: false },
  },
  stadiumDemandPerLevel: 0.03,
  stadiumConcessionPerLevel: 0.05,
  trainingPerLevel: 0.04,
  rehabPerLevel: 0.05,
  scoutingPerLevel: 0.03,
} as const;

/** D-135 모기업 지원금 재협상(방향 사용자 확정, 계수 초기안): 보유 현금 / 시작 현금 R로 다음 시즌 지원 배수 */
export const SUPPORT_RENEGOTIATION = {
  upper: 1.2,
  /** D-139(사용자 확정): 0.6 → 1.0 */
  cutSlope: 1.0,
  minFactor: 0.4,
  lower: 0.8,
  raiseSlope: 0.5,
  maxFactor: 1.2,
} as const;

/** 5b 계약 확장(D-136 초기안) */
export const CONTRACT = {
  /** D-130 세션: 같은 주 같은 선수 직접 제안 상한 */
  offersPerSession: 3,
  extensionMaxYears: 5,
  /** 연장 요구 = FA 요구 × 배수(FA 자격까지 1년 이내 / 그 밖) */
  extensionNearFa: 0.95,
  extensionFar: 0.85,
  extensionMaxAge: 36,
  /** 국내 무소속 선수 요구 연봉 = max(최저, 시장 평가 연봉 × 배수) */
  domesticDemandShare: 0.8,
} as const;

/** 5a 트레이드(D-130 세션 과금 사용자 확정, D-131 초기안) */
export const TRADE = {
  /** 세션: 상대 구단과 그 주 첫 협상 때 행동력 1, 같은 주 제안 상한 */
  sessionAp: 1,
  proposalsPerSession: 3,
  maxPlayersPerSide: 3,
  /** ASSUMPTION(D-131): 한 거래 현금 한도 */
  maxCashWon: 1_000_000_000,
  /** ASSUMPTION(D-131): 거래 기간 — 스토브리그 K+5부터, 시즌은 7/31까지 [KBO·확인 필요] */
  stoveOpenDaysAfterK: 5,
  deadlineMonthDay: '07-31',
  /** 가치 모델: 보유 기간 상한·연 할인·시장 가치(FA 기준 연봉 × 프리미엄) */
  maxHorizon: 4,
  discount: 0.9,
  worthAge: 29,
  worthProSeasons: 9,
  worthPremium: 1.25,
  /** 공개 나이 곡선(연간 예상 능력 변화): [이 나이 이하, 변화] */
  ageCurve: [
    [24, 2],
    [27, 1],
    [30, 0],
    [33, -1],
    [99, -2],
  ] as ReadonlyArray<readonly [number, number]>,
  /** 다른 구단 선수 평가 오차(구단·시즌 고정) — 리그 공통 평가와 평균한다(D-133) */
  clubEstimateSd: 2,
  /** 포지션 수요: 40인 안 같은 쪽 인원 기준 */
  needThin: { pitchers: 18, hitters: 18, catchers: 3 },
  needThick: { pitchers: 24, hitters: 23, catchers: 5 },
  needUp: 1.15,
  needDown: 0.9,
  /** 경쟁 단계: 순위 이하 상위권, 이상 하위권 */
  contenderRank: 3,
  rebuildRank: 8,
  contenderNow: 1.3,
  contenderLater: 0.8,
  rebuildNow: 0.7,
  rebuildLater: 1.2,
  rebuildVeteranAge: 31,
  rebuildVeteran: 0.8,
  franchiseKeep: 1.5,
  /** 수락: 받는 가치 ≥ 주는 가치 + |주는 가치| × (margin ± marginSd) + friction */
  /** D-134(사용자 확정): 12% → 6% */
  margin: 0.06,
  marginSd: 0.04,
  frictionWon: 100_000_000,
  /** 이 비율 이상이면 현금 역제안 */
  counterRatio: 0.8,
  cashStepWon: 10_000_000,
  /** AI가 현금을 낼 때 남겨 둘 현금 */
  aiCashReserveWon: 3_000_000_000,
  actionLogMax: 300,
} as const;

/** 4b-2 집중 훈련(D-128). 효과·강도·코치 계수는 사용자 확정, 코치 배정·담당 한도·AI 계획 수는 초기안 */
export const TRAINING = {
  /** 주 목표: 연간 기대 성장 +30%, 정점 뒤 하락 −20%. 보조 목표는 그 절반 */
  growthBonus: 0.3,
  declineRelief: 0.2,
  secondaryShare: 0.5,
  intensity: {
    low: { effect: 0.7, injury: 0.85, label: '낮음' },
    normal: { effect: 1.0, injury: 1.0, label: '보통' },
    high: { effect: 1.3, injury: 1.3, label: '높음' },
  },
  /** 코치·수용도 계수 = coachMin + coachSpan × (coachWeight × 지도력 + (1 − coachWeight) × 수용도) / 100 → 0.8~1.2 */
  coachMin: 0.8,
  coachSpan: 0.4,
  coachWeight: 0.6,
  /** ASSUMPTION(D-128): 담당 코치 공석일 때 지도력 */
  vacantCoaching: 30,
  /** ASSUMPTION(D-128): 코치당 담당 한도 = loadBase + ⌊소통력 / loadPer⌋ */
  loadBase: 4,
  loadPer: 20,
  /** 월간 효과를 계산하는 지난 기간(일) */
  periodDays: 30,
  /** 비용: 새 지시·목표 변경 행동력 1(02) + 육성팀 처리량(개인 계획 작성 4의 50%), 맡기기는 처리량 4(03) */
  directAp: 1,
  planWp: 4,
  /** ASSUMPTION(D-128): 육성팀 목표 선택 오차 σ = delegateNoiseBase + delegateNoiseSpan × (1 − 역량) */
  delegateNoiseBase: 4,
  delegateNoiseSpan: 8,
  /** ASSUMPTION(D-128): AI 구단은 스프링캠프 시작에 정점 전 유망주 이만큼 계획 */
  aiPlans: 6,
} as const;

/** 4a 성장·노화(D-123 사용자 확정 주기, D-124 초기안 계수) */
export const DEVELOPMENT = {
  /** ASSUMPTION(D-124): 정점 전 연간 성장 = (잠재 − 현재) × growthShare × 계수 */
  growthShare: 0.22,
  maxAnnualGain: 6,
  /** 정점 뒤 변화 없는 기간(년) */
  plateauYears: 2,
  /** ASSUMPTION(D-124): 하락 = (declineBase + declinePerYear × 정점+2 이후 연수) × 노화 계수 × 능력 배수 */
  declineBase: 1.2,
  declinePerYear: 0.35,
  declineWeight: { speed: 1.4, power: 0.8, eye: 0.6, control: 0.6 } as Record<string, number>,
  /** 특성(1~100) → 계수 0.7~1.3 */
  traitMin: 0.7,
  traitSpan: 0.6,
  /** 구속(km/h) */
  velocityYoungAge: 24,
  velocityYoungGain: 0.5,
  velocityDeclineBase: 0.5,
  velocityDeclinePerYear: 0.15,
  /** D-123: 시즌 3~10월 매월 1일 반영, 월 상한 */
  monthlyMonths: [3, 4, 5, 6, 7, 8, 9, 10] as readonly number[],
  monthlyShare: 0.4,
  monthlyCap: 1,
  monthlyVelocityCap: 0.3,
  monthlyNoiseSd: 0.15,
  /** 스토브리그 연간 편차 */
  annualNoiseSd: 0.6,
  ratingMin: 1,
  ratingMax: 100,
} as const;

/** ASSUMPTION(D-120): 시범경기 — 개막 16일 전 목요일~개막 4일 전 화요일, 월요일 휴식, 9회까지(연장 없음) */
export const EXHIBITION = {
  startDaysBeforeOpening: 16,
  endDaysBeforeOpening: 4,
  maxInnings: 9,
} as const;
