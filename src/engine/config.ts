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

/**
 * CONFIRMED (D-214·D-215): 세계는 실제 2026 한국시리즈 최종전 날(startDate = K, D-061)에 만들고,
 * 첫 스토브리그를 화면 없이 자동 실행한 뒤 2027-02-01(월) 스프링캠프에서 구단주가 취임한다. 첫 시즌은 2027.
 */
export const NEW_GAME = {
  startDate: '2026-11-08',
  previousSeason: 2026,
  firstSeason: 2027,
  /** D-215: 첫 안건(간판 외야수 잔류 협상) 마감 — 2월 2주 일요일. 미계약이면 다음 날 시장에 다시 열린다 */
  franchiseDeadline: '2027-02-14',
} as const;
export const FIRST_SEASON = NEW_GAME.firstSeason;

/** CONFIRMED (D-061·D-225 (5)·01 문서): 스토브리그 리그 일정. K = 한국시리즈 최종전 날짜. FA 절차는 공시·신청 → 시장 개장 2단계. */
export const STOVE = {
  faNoticeAfterK: 5,
  faMarketAfterK: 9,
  reserveListMonthDay: '11-30',
  /** D-229: 비활동 기간 규칙은 없다. 보류 선수 연봉 협상 시작일 */
  salaryTalksStart: '12-01',
  arbitrationDeadline: '01-10',
  campRosterDeadline: '01-31',
  seasonModeStartMonthDay: '02-01', // 2월 1일이 속한 주의 월요일에 시즌 모드 시작
} as const;

/**
 * 스토브리그 4턴(D-216·D-217·D-219·D-220·D-229).
 * 턴 끝: 1턴 보류 명단 확정 전날 / 2턴 1턴 끝 다음 날부터 turn2Weeks주 / 3턴 연봉조정 신청 마감 / 4턴 시즌 모드 시작 전날.
 */
export const STOVE_TURN = {
  turns: 4,
  turn2Weeks: 3,
  /** D-217: 턴마다 주간 최대치 × apWeeks, 이월 없음 */
  apWeeks: 2,
  /** D-219: 구간 진행 멈춤 상한(넘는 건은 기본 처리) */
  maxStops: 2,
  /** D-220: 턴당 결정 카드 상한(중대 사건 별도) */
  maxCards: 3,
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
  /** 8a(D-180) 퀄리티 스타트: 선발 6이닝 이상·자책 3 이하 */
  qsMinOuts: 18,
  qsMaxEr: 3,
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
  /** 9a(D-240): 세션 DB 페이지 캐시(KiB). 기본 2MB에서 64MB로 */
  cacheKiB: 65_536,
} as const;

/**
 * 외국인 계약 규정(D-048·D-225 (5)·D-228). 금액 상한은 신규 외국인 상한·아시아쿼터 상한 하나씩(총액·재계약 증액 규정 없음).
 * 보유는 40인 명단 기준 외국인 3명·아시아쿼터 1명 이하. 달러 금액은 고정 환율로 원화 장부에 기록한다.
 */
export const FOREIGN = {
  usdKrw: 1_400,
  newCapUsd: 1_000_000,
  /** 아시아쿼터 연봉 상한(신규·재계약 모두) */
  asiaNewCapUsd: 200_000,
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
  /** EV-2(D-205 (3)): 훈련 강도 × 카드 부상 위험 배율 합계 상한 */
  maxRiskMult: 3,
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

/** 6d 굿즈(D-153 초기안). 금액은 2026 기준(물가 연동) */
export const MERCH = {
  skus: {
    uniform: { label: '유니폼', priceWon: 99_000, buyRate: 0.008 },
    cap: { label: '모자', priceWon: 35_000, buyRate: 0.015 },
    cheer: { label: '응원 용품', priceWon: 12_000, buyRate: 0.03 },
    /** 8e-2(D-190 (8)): 올스타전 ±14일만 판매, 자동 재주문 없음 */
    allstar: { label: '올스타 유니폼(한정)', priceWon: 120_000, buyRate: 0.003 },
  },
  vendors: {
    budget: { label: '저가 대량 제작사', costRate: 0.4, demand: 0.85, uniformDemand: 0.85, leadDays: 21, minOrder: { uniform: 500, cap: 1000, cheer: 2000, allstar: 500 } },
    standard: { label: '국내 전문 제작사', costRate: 0.55, demand: 1.0, uniformDemand: 1.0, leadDays: 14, minOrder: { uniform: 100, cap: 200, cheer: 500, allstar: 100 } },
    brand: { label: '스포츠 브랜드 공식 파트너', costRate: 0.65, demand: 1.0, uniformDemand: 1.3, leadDays: 14, minOrder: { uniform: 100, cap: 200, cheer: 500, allstar: 100 } },
  },
  /** 브랜드 파트너 후원금(계약 때) × 인지도 배수 */
  partnerFeeWon: 300_000_000,
  partnerTier: { 상: 1.2, 중: 1.0, 하: 0.8 } as Record<string, number>,
  vendorAp: 2,
  /** 경기 없는 시즌 날 온라인 판매 = 직전 홈경기 수요 × 이 값 */
  onlineShare: 0.2,
  demandSlope: 0.15,
  backlashDemand: 0.7,
  noise: 0.1,
  /** 자동 재주문: 목표 재고 주수(기본·범위), 최근 판매 주수, 개막 전 첫 발주(일) */
  targetWeeksDefault: 4,
  targetWeeksMin: 2,
  targetWeeksMax: 8,
  recentWeeks: 4,
  firstOrderDaysBeforeOpening: 21,
  /** 첫 발주용 주간 수요 추정: 좌석 수 × 이 점유율 × 주 3경기 × (1 + 온라인) */
  baselineOccupancy: 0.7,
  baselineGamesPerWeek: 3,
  maxManualOrder: 50_000,
} as const;

/**
 * 6c 스폰서(D-149 초기안). ASSUMPTION(D-149): 금액 규모(mainBaseWon·subBaseWon)는 사용자 결정 대기인 임시값이다.
 * 금액은 2026 기준(물가 연동).
 */
export const SPONSOR = {
  mainSlots: 1,
  subSlots: 3,
  mainOffers: 4,
  subOffers: 6,
  mainBaseWon: 2_500_000_000,
  subBaseWon: 400_000_000,
  tier: { 상: 1.2, 중: 1.0, 하: 0.8 } as Record<string, number>,
  styles: {
    guaranteed: { label: '보장형', guaranteed: 1.1, incentive: 0.1 },
    balanced: { label: '균형형', guaranteed: 1.0, incentive: 0.25 },
    performance: { label: '성과형', guaranteed: 0.8, incentive: 0.5 },
  },
  incentives: {
    postseason: '포스트시즌 진출',
    top3: '정규시즌 3위 이내',
    occupancy: '시즌 좌석 점유율 75% 이상',
    satisfaction: '시즌 말 팬 만족도 60 이상',
    /** 8e-2(D-190 (5)) */
    allstar3: '올스타 3명 이상 선정',
    mrAllstar: '미스터 올스타 배출',
  },
  /** 8e-2: 올스타 인센티브 기준 인원 */
  allStarGoal: 3,
  obligations: {
    none: '의무 없음',
    campaigns: '시즌 중 캠페인 2회 이상(미달 시 보장액의 20% 반환)',
    noHighPrice: '고가 티켓 정책 금지',
  },
  topRank: 3,
  occupancyGoal: 0.75,
  satisfactionGoal: 60,
  campaignsRequired: 2,
  refundShare: 0.2,
  /** 구단 매력 = 1 + 시장·승률·만족도 보정, 0.7~1.4 */
  appealMarket: 0.25,
  appealPct: 0.8,
  appealSatisfaction: 0.004,
  appealMin: 0.7,
  appealMax: 1.4,
  /** 사업제휴팀 전문성 평균 100일 때 +10% */
  staffBoostMax: 0.1,
  /** 일정(스토브리그): 제안 도착·AI 선택(12월), 기본 계약(다음 해 1월) */
  offerMonthDay: '12-07',
  aiPickMonthDay: '12-14',
  defaultMonthDay: '01-31',
  defaultShare: 0.9,
  aiIncentiveWeight: 0.4,
  signAp: 2,
  /** 후보 브랜드는 리스트 파일 src/engine/data/brands.json에서 읽는다(D-152) */
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
  /** D-242(사용자 확정 2026-11-12): 0.4 → 0.2. 9a 10시즌에서 현금 1.8배 이상이면 하한에 닿아 더 줄지 않았다 */
  minFactor: 0.2,
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
  /** 경쟁 단계는 운영 상태(AI_CLUB, D-155)로 정한다 */
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
  /** D-155 (5): 트레이드로 옮긴 선수의 재트레이드 제한(일) */
  retradeLockDays: 60,
} as const;

/** 4c-1 승부처 타석·볼카운트 층(D-161·D-167 초기안). 승리 확률 표·기준표 값은 engine/data의 설정 파일(보정 도구가 만듦) */
export const CLUTCH = {
  /** 이 이닝부터 승부처 판정 */
  minInning: 7,
  /** 레버리지 기준값(조정값, D-168 ⑥에 맞춰 보정 도구에서 정함). 초기 1.5는 경기당 승부처 7.1개로 범위(2~6)를 넘어 2.0으로 정했다 */
  leverageThreshold: 2.0,
  /** 포스트시즌 연장에서 쓰는 승리 확률 표 행(표는 정규시즌 11회 무승부 규칙) */
  postseasonExtraRow: 10,
  /** 대결 맞춤 뉴턴법 허용 오차·반복 상한 */
  fitTolerance: 1e-9,
  fitMaxIter: 40,
  /** 한 타석 투구 상한(넘으면 인플레이로 끝냄, 확률상 거의 없음) */
  maxPitches: 40,
  /** 승리 확률 표 만들기: 반 이닝 득점 상한, 정규시즌 마지막 이닝, 표 점수 차 범위 */
  table: { runsCap: 20, maxInnings: 11, diffMax: 10 },
  /** 기준표 투구당 파울 비율 목표(D-169 초기안): 2스트라이크 전, 2스트라이크 */
  foulTargets: { early: 0.16, twoStrike: 0.25 },
} as const;

/**
 * 볼카운트 기준표의 기본 모양(카운트별 볼·스트라이크(루킹+헛스윙)·파울·사구·인플레이 비율, 합 1).
 * 보정 도구가 조정값 7개를 맞춰 리그 볼넷·삼진·사구 비율과 결과별 평균 투구 수(SIM.pitches)에 맞춘 표를 만든다(D-167 (3)).
 * 행 순서: 0-0, 0-1, 0-2, 1-0, 1-1, 1-2, 2-0, 2-1, 2-2, 3-0, 3-1, 3-2 (볼-스트라이크)
 */
export const COUNT_BASE_SHAPE: readonly (readonly [number, number, number, number, number])[] = [
  [0.38, 0.36, 0.14, 0.005, 0.115],
  [0.45, 0.24, 0.17, 0.005, 0.135],
  [0.55, 0.14, 0.17, 0.005, 0.135],
  [0.38, 0.3, 0.16, 0.005, 0.155],
  [0.4, 0.24, 0.19, 0.005, 0.165],
  [0.45, 0.15, 0.22, 0.005, 0.175],
  [0.37, 0.32, 0.15, 0.005, 0.155],
  [0.38, 0.23, 0.2, 0.005, 0.185],
  [0.39, 0.15, 0.25, 0.005, 0.205],
  [0.45, 0.42, 0.06, 0.005, 0.065],
  [0.37, 0.24, 0.19, 0.005, 0.195],
  [0.32, 0.15, 0.29, 0.005, 0.235],
];

/** 4c-2a 작전 사건·감독 AI 판단(D-170 초기안). z = (능력 − 50) / 10 */
export const TACTICS = {
  /** 감독 AI가 상대 선수를 볼 때 쓰는 구단 추정 편차(구단·선수·항목 고정) */
  estimateSd: 6,
  /** 좌우 상대: 같은 손 대결의 투수 쪽 보정 로짓(다른 손이면 부호 반대) */
  platoon: { b: -0.05, k: 0.1, h: -0.1, x: -0.04 },
  // 보정 도구 측정(D-171 ①)으로 맞춘 값: 처음 기준 0.74·0.70, 손익분기 0.72·0.80, 시도 비율 0.35, 폭투 1.0%, 견제사 0.5%는 도루 시도·성공률·견제사가 범위를 넘거나 폭투가 모자랐다
  steal: {
    base2: 0.71,
    base3: 0.67,
    speed: 0.6,
    baserunning: 0.3,
    catcherArm: 0.35,
    catcherTransfer: 0.15,
    hold: 0.25,
    breakEven2: 0.66,
    breakEven3: 0.74,
    maxDiff: 4,
    /** 조건을 갖춘 타석에서 실제로 시도하는 비율(감독 판단의 변동) */
    attemptShare: 0.16,
  },
  /** 타석당 주루 사건 기준 확률(주자가 있을 때)과 능력 반영 계수(로그 배율) */
  pickoff: { rate: 0.0035, hold: 0.4 },
  wildPitch: { rate: 0.012, control: -0.3 },
  passedBall: { rate: 0.002, blocking: -0.4 },
  balk: { rate: 0.0012, hold: -0.3 },
  hitAndRun: { k: -0.25, dp: -1.5, firstToThird: 0.8, minSpeed: 55, minContact: 55, attemptShare: 0.12 },
  bunt: { sacBase: 0.78, squeezeBase: 0.62, skill: 0.6, hitBase: 0.05, hitSpeed: 0.3, sacShare: 0.5, weakIndex: 40, squeezeShare: 0.25 },
  ibb: { minInning: 8, maxDiff: 2, gap: 8 },
  pinchHit: { minInning: 7, gap: 10, protectTop: 4, platoon: 4 },
  pinchRun: { minInning: 8, maxDiff: 1, speedGap: 20 },
  defSub: { minInning: 8, minLead: 1, maxLead: 3, gap: 15 },
  /** 수비 위치 보정(10b §9): 도달 로짓 보정, 병살·홈 송구 */
  align: {
    infieldInGround: -0.5,
    infieldInHomeSafe: 0.3,
    dpCenter: 0.4,
    dpSides: -0.3,
    dpBase: 0.3,
    outfieldIn: { SH: 0.6, DP: -0.5, WL: -0.8 },
    outfieldBack: { SH: -0.5, DP: 0.3, WL: 0.4 },
    linesGroundLine: 0.8,
    linesGroundNear: -0.4,
    linesOutfield: 0.4,
  },
  /** 카운트 지시 배율(그 지점부터 타석 끝까지) */
  count: {
    take: { ball: 1, strike: 1.15, foul: 0.5, inplay: 0.4 },
    pitchAround: { ball: 1.35, strike: 0.85, foul: 1, inplay: 0.8 },
    attack: { ball: 0.8, strike: 1.1, foul: 1, inplay: 1.1 },
  },
} as const;

/** 8b 업적 경험치(D-182·02 문서): 단계 1~5 경험치, 업적 경험치 시즌 상한 */
export const ACHIEVEMENT_XP = {
  byTier: [10, 20, 35, 60, 100] as readonly number[],
  seasonCap: 300,
} as const;

/** 8a 리그 시상(D-180·25 문서) */
export const AWARDS = {
  rankPointsTop: 10,
  voteSpread: 3,
  titleBonus: 5,
  /** 팀 순위 보정: (10 − 순위) × teamBonusPerRank */
  teamBonusPerRank: 10 / 9,
  qualPaPerGame: 3.1,
  qualOutsPerGame: 3,
  /** MVP 같은 표에 둘 때 투수 점수 배율(타자 9부문 기준) */
  starterScale: 9 / 6,
  relieverScale: 9 / 5,
  /** 구원 평균자책·WHIP 순위 자격 등판 수 */
  relieverRateGames: 30,
  mvpReliefSv: 30,
  mvpReliefHld: 30,
  closerMinSv: 20,
  setupMinHld: 15,
  /** 포지션 자격(수비 아웃): 720이닝, 지명타자 480이닝, 수비상 투수 50경기 */
  posQualOuts: 2160,
  dhQualOuts: 1440,
  pitcherDefGames: 50,
  ggPitcher: { W: 10, SV: 30, HLD: 30 },
  rookie: { maxProSeasons: 5, priorPa: 60, priorOuts: 90 },
  /** 감독상 예상 승수 = base + (5.5 − 기대 순위) × perRank, 순위 상승 폭 배수, 가을야구 보너스 */
  manager: { baseWins: 72, perRank: 4, rankGain: 3, postseason: 5 },
  front: { drafteeBatG: 50, drafteePitG: 30, drafteeEach: 2, profit: 3 },
  monthly: { minPa: 60, minOuts: 60, minG: 8 },
  milestones: {
    H: [1000, 1500, 2000, 2500], HR: [100, 200, 300, 400], RBI: [1000], SB: [200, 300],
    W: [100, 150], SV: [100, 200, 300], K: [1000, 1500, 2000],
  } as Record<string, readonly number[]>,
  /** 베스트 팀 선발·구원 인원 */
  bestStarters: 5,
  bestRelievers: 2,
  /** KBO 시상식 발표(K + 일), 골든글러브는 12월 둘째 월요일 */
  ceremonyAfterK: 3,
} as const;

/** 6e 예산 배분·특별 운영회의(D-176·D-177) */
export const BUDGET_PLAN = {
  minMultiplier: 0.5,
  maxMultiplier: 2,
  multiplierStep: 0.25,
  /** 한도 단위(원) */
  capStepWon: 100_000_000,
  /** 2026 기준 기본 한도: 선수 연봉 총액 = 샐러리캡 + payrollExtra(외국인 몫) */
  defaultCapsWon: { payrollExtra: 6_000_000_000, facility: 30_000_000_000, marketing: 3_000_000_000, merch: 5_000_000_000 },
  /** 운영비 배수 2배마다 효과(배수 0.5면 반대 방향) */
  effects: { scoutingPerDoubling: 0.06, trainingPerDoubling: 0.06, medicalPerDoubling: 0.04 },
  /** AI 구단 운영 상태별 2군·선수단 운영비 배수 */
  aiOps: {
    contend: { futures: 1.25, teamOps: 1.25 },
    middle: { futures: 1, teamOps: 1 },
    rebuild: { futures: 1.5, teamOps: 1 },
    austerity: { futures: 0.75, teamOps: 0.75 },
  },
  /** 예산안 수립(스토브리그 다음 시즌): 그 주 첫 확정의 행동력, 경영지원팀 처리량(직접은 50%) */
  planAp: 1,
  planWp: 30,
  /** 특별 운영회의 행동력, 남겨 둘 보고 수 */
  meetingAp: 1,
  meetingKeep: 10,
} as const;

/** 4c-3 경기 관전·승부처 참여(D-160·D-174) */
export const LIVE = {
  /** 경기당 구단주 참여 타석 상한 */
  maxPerGame: 2,
} as const;

/** 4c-2b 감독 능력치·성향·신뢰도(D-162·D-163·D-172 초기안). z = (능력 − 50) / 50 */
export const MANAGER = {
  /** 기본 보정 최대 점수(조정값, D-173 ①) */
  K: 0.9,
  authorityLogit: 0.045,
  leadership: 0.045,
  condition: 0.1,
  stamina: 0.03,
  development: 0.05,
  /** 작전: 감독 AI 판단 오차(도루 성공 추정에 더하는 편차) */
  judgmentSd: 0.06,
  /** 성향: 스몰볼 시도 비율 배율 0.5 + 값/100, 불펜 조기 투입 선발 투구 수 한도 −(값 − 50)/divisor */
  quickHookDivisor: 5,
  trust: {
    start: 50,
    /** 결정 점수 × 100 × gain 만큼 오르내린다(조정값, D-173 ③) */
    gain: 0.03,
    /** 팀 기준선 지수이동평균 반감 타석 수 */
    baselineHalfLife: 200,
    seasonRegression: 0.5,
    recentMax: 50,
  },
  /** 채용 시장 감독 후보 수와 평균 능력 */
  candidates: 3,
  candidateMean: 54,
  /** AI 구단 감독 교체(D-166) */
  replace: { missSeasons: 2, trustBelow: 30, renewAtLeast: 50 },
} as const;

/** 7a AI 구단 운영 상태·긴축·AI 간 트레이드(D-155 초기안) */
export const AI_CLUB = {
  /** 기준 순위: 이 순위 이내 우승 경쟁, 이 순위 이하 리빌딩 */
  contendRank: 4,
  rebuildRank: 8,
  /** 현재 순위를 쓰는 최소 경기 수(팀당). 모자라면 직전 시즌 최종 순위 */
  minGames: 30,
  /** 재정 긴축: 현금 0 미만 진입, 이 금액 이상 회복 시 해제 */
  austerityExitWon: 2_000_000_000,
  /** 긴급 지원 = 부족액 + 여유분(억 단위 올림) */
  emergencyBufferWon: 1_000_000_000,
  stanceLogMax: 400,
  trade: {
    /** 구단별 기간(스토브리그·시즌)당 AI 간 거래 상한. 리그 전체는 주 1건 */
    maxPerClubPeriod: 2,
    veteranMinAge: 28,
    prospectMaxAge: 25,
    veteranCandidates: 5,
    prospectCandidates: 8,
  },
  /** 7b(D-157): AI 구단이 우리 구단에 먼저 보내는 트레이드 제안 */
  offer: {
    /** D-159(사용자 확정): 스토브리그 주 1건·최대 4건, 시즌 중 4~8월 최대 4건. 시즌 중 월 1건은 초기안 */
    maxPerPeriod: 4,
    seasonFromMonth: 4,
    seasonToMonth: 8,
    seasonPerMonth: 1,
    maxOpen: 2,
    clubGapDays: 30,
    /** 받은 날 포함 유효 일수. 스토브리그는 주 단위로 진행하므로 받은 다음 주까지 응답할 수 있어야 한다 */
    validDays: 14,
  },
} as const;

/** 7b 해임 뒤 영입 제안(D-157 (3) 초기안) */
export const CAREER = {
  /** 재임 중 포스트시즌 진출이 있거나 이 레벨 이상이면 2개 구단 */
  twoOffersLevel: 3,
  /** 이 레벨 이상이거나 재임 정규시즌이 이 수 이상이면 1개 구단 */
  oneOfferLevel: 2,
  oneOfferSeasons: 2,
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

/** 8e 올스타전(D-189·D-190, 초기안 — 계수는 9a에서 조정) */
export const ALLSTAR = {
  /** 개막 주 월요일 + 이 주 수 = 투표 시작(10주차 월요일), 중간 집계 주 수, 마감 주(13주차 일요일) */
  voteStartWeeks: 9,
  interimWeeks: 3,
  /** 자격: 야수 출전 비율, 선발 등판, 구원 등판 */
  fielderGameShare: 0.6,
  minStarts: 8,
  minRelief: 20,
  /** 투표 점수 = 성적 × perfWeight + 팬 기반 × fanWeight + 편차(±noise) + 캠페인 */
  perfWeight: 0.7,
  fanWeight: 0.3,
  noise: 0.08,
  /** 득표 수 = 투표 점수 × 이 값(표시용) */
  voteScale: 1_000_000,
  /** 감독 추천: 득표가 자리 1위의 이 비율 이상인 2위를 우선 */
  runnerUpShare: 0.9,
  recPitchers: { SP: 3, RP: 3 },
  recFielders: 6,
  /** 경기: 투수 최대 아웃, 이 회 수비 시작부터 선발 야수 교체, 정규 이닝 */
  maxOuts: 6,
  regularsOutFrom: 6,
  innings: 9,
  /** 선발이 올스타전 전 이 일수 안에 등판했으면 던지지 않는다 */
  starterRestDays: 2,
  /** 미스터 올스타 점수와 편차(±) */
  mvp: { single: 1, double: 2, triple: 3, hr: 4, rbi: 1, run: 1, sb: 1, scorelessInning: 2, k: 0.5, noise: 1 },
  /** 홈런 레이스: 팀별 인원, 라운드당 스윙, 스윙 홈런 로짓 가산, 연장 스윙·횟수 */
  hrRace: { perTeam: 4, swings: 15, logitShift: 2.6, tieSwings: 3, tieRounds: 3 },
  /** 경기 ID(정규 경기와 겹치지 않는 값) = base + 시즌 */
  fixtureBase: 900_000,
  /** 엔진 구단 번호(드림·나눔) */
  engineClub: { dream: 91, nanum: 92 },
  /** 8e-2 투표 캠페인: 행동력, 비용(2026 원), 투표 점수 가산 */
  campaignAp: 2,
  campaignCostWon: 100_000_000,
  campaignBonus: 0.05,
  /** 8e-2 유치 신청: 행동력, 점수 가중치, AI 신청 조건 */
  applyAp: 2,
  hostScore: { occupancy: 0.5, stadium: 0.3, capacity: 0.2 },
  aiApplyMinStadium: 2,
  aiApplyChance: 0.3,
  /** 8e-2 개최 효과: 입장 수입 배수(평균 객단가 × 수용 인원 × 배수), 행사 비용(2026 원), 개최 구단 만족도 */
  hostTicketMultiplier: 2,
  hostCostWon: 300_000_000,
  hostSatisfaction: 3,
  /** 8e-2 선정 효과: 선정 1명당 만족도, 상한 */
  satisfactionPerPick: 0.5,
  satisfactionCap: 3,
  /** 8e-2 직전 시즌 올스타 선정 선수 연봉 요구액 가산 */
  salaryBonus: 0.05,
  /** 8e-2 한정 유니폼 판매 기간(올스타전 ± 일), 선정 1명당 수요 가산 */
  merchWindowDays: 14,
  merchPerPick: 0.5,
} as const;

/** EV-1 턴 이벤트·브리핑(D-192·D-193·D-203, 초기안) */
export const EVENTS = {
  /** 후보가 있어도 카드가 없는 주 비율(사용자 확정 25%) */
  emptyShare: 0.25,
  cooldownWeeks: 8,
  playerCooldownWeeks: 4,
  /** 직전 주와 같은 분류 가중치 배수 */
  sameCategoryWeight: 0.3,
  /** 비용 등급(기준 예산 대비 bp) */
  costBp: { small: [10, 20], medium: [50, 100], large: [200, 400] } as Record<string, readonly [number, number]>,
  /** 한 사건 팬 만족도 하락 상한 */
  fanDropCap: 12,
  /** 확률 결과 범위 */
  outcomeMin: 0.25,
  outcomeMax: 0.85,
  /** 브리핑 줄 수 */
  briefingMin: 3,
  briefingMax: 15,
  /** 경고: 연패, 팬 만족도 주간 하락, 고피로 기준 */
  lossStreakWarn: 4,
  fanDropWarn: 5,
  tiredFatigue: 60,
  /** 주전: 1군에서 능력 순 타자 9명·투수 6명 */
  starterHitters: 9,
  starterPitchers: 6,
  /** EV-2(D-205): 기분 주간 회복, 컨디션 점당 로짓·상한, 언론 관계 시작·주간 회복, 홍보팀 완화 */
  moodRecover: 0.2,
  condLogitPerPoint: 0.01,
  condMax: 5,
  pressStart: 50,
  pressRecover: 0.05,
  prRelief: 0.2,
  prDefaultQuality: 0.3,
  /** 관중 수요 가산 하한(상한은 MARKETING.maxDemandBoost), 굿즈 수요 배율 범위, 훈련 효과 배율 범위 */
  demandMin: -0.2,
  merchMin: 0.7,
  merchMax: 1.3,
  growthMin: 0.9,
  growthMax: 1.1,
  /** EV-3(D-207): 맡긴 카드 담당 팀 처리량, 확률 위험 등급 경계 */
  delegateWp: 4,
  riskLow: 0.35,
  riskMid: 0.6,
  /** 슬럼프: 최근 28일 OPS 미만·최소 타석 */
  slumpOps: 0.55,
  slumpMinPa: 40,
  /** EV-4(D-210): 히든 생활 요인(과거 이력 비율, 자기관리–성실성 상관), 평판 메모 적중·오탐 */
  pastMajor: 0.02,
  pastMinor: 0.06,
  selfControlCorr: 0.3,
  repThreshold: 40,
  repHitBase: 0.5,
  repHitSpan: 0.2,
  repFalseBase: 0.15,
  repFalseSpan: 0.1,
  /** 한 사건 징계 합계 범위, 연봉 감액 비율, 품위 조항 인센티브 감액 비율 */
  sanctionMin: 5,
  sanctionMax: 30,
  payCut: 0.1,
  /** ASSUMPTION(D-234): 'MLB 관심' 카드 포스팅 이적료 = 연봉 × salaryMultiple(min~max, 1,000만 원 단위) */
  postingFee: { salaryMultiple: 4, minWon: 1_000_000_000, maxWon: 8_000_000_000 },
  sponsorCut: 0.5,
  /** AI 구단 방출 기준(사실·리그 징계 이상) */
  aiReleaseGames: 20,
} as const;

/** ② 구단 스토리(27·27a, D-222·D-224·D-237, 초기안) */
export const STORY = {
  /** 시즌 중 스토리 카드 간격(주). '월 1장 이하'(D-224)를 주 단위로 둔다 */
  seasonGapWeeks: 4,
  /** 스토브리그 턴당 스토리 카드 상한(턴 카드 3장 안에 들어간다) */
  stovePerTurn: 1,
  /** 결말 판정 스토리 시즌(1막 = 1시즌, 2막 = 첫 실제 스토브리그~3시즌) */
  endingSeason: 3,
  /** 모기업 신뢰(0~100, 시작 50): 이후 모기업 지원금 지급분 배수 = 1 + (신뢰 − 50) × bpPerPoint / 10,000 (신뢰 0~100 → 0.9~1.1배) */
  chairmanStart: 50,
  chairmanBpPerPoint: 20,
  /** 하위권 = 정규시즌 순위 이 값 이상 */
  lowRank: 8,
  /** 자체 육성: 스토리 시작 때 이 나이 이하로 그 구단에 있던 선수 또는 그 구단 지명 선수 */
  homegrownAge: 24,
  /** 유망주 배역 나이 상한 */
  prospectAge: 23,
} as const;
