// 타구·수비 존 모델 설정 (10b 문서 §3~§10, D-102). 표의 모든 수치는 밸런스 초안이다.
// 코드에 직접 쓰지 않고 이 파일에서만 바꾼다. PROBABILITY_CONFIG.battedBall.zone으로 연결된다.
// 이 문서의 z(능력) = (능력치 − 50) / 10 (10a의 /50과 다르다).

export type BallType = 'GB' | 'LD' | 'FB';
/** 타구 질: 0 약, 1 중, 2 강 */
export type Quality = 0 | 1 | 2;
export type Depth = 'IN' | 'SH' | 'DP' | 'WL' | 'FO';

export const ZONE_CONFIG = {
  zDivisor: 10,

  /** §3.1 타구 질: 유형별 기준 분포(약·중·강)와 위치 μ 계수 */
  quality: {
    base: { GB: [0.35, 0.45, 0.2], LD: [0.2, 0.45, 0.35], FB: [0.3, 0.45, 0.25] } as Record<BallType, readonly [number, number, number]>,
    power: 0.25,
    stuff: 0.15,
    velocity: 0.05,
  },

  /** §3.2 방향 기준 분포(우타자, S1~S7)와 당겨치기 τ = pullPerPower·z(장타)(라인드라이브·뜬공만) */
  direction: {
    base: {
      GB: [0.09, 0.24, 0.15, 0.1, 0.14, 0.18, 0.1],
      LD: [0.08, 0.16, 0.17, 0.18, 0.17, 0.14, 0.1],
      FB: [0.06, 0.15, 0.18, 0.22, 0.18, 0.13, 0.08],
    } as Record<BallType, readonly number[]>,
    pullPerPower: 0.15,
  },

  /** §3.3 깊이 분포(유형·질별, 합 1). 비어 있으면 0 */
  depth: {
    GB: [{ IN: 1 }, { IN: 1 }, { IN: 1 }],
    LD: [{ IN: 0.55, SH: 0.45 }, { IN: 0.25, SH: 0.6, DP: 0.15 }, { IN: 0.15, SH: 0.45, DP: 0.35, WL: 0.05 }],
    FB: [{ IN: 0.55, FO: 0.25, SH: 0.2 }, { IN: 0.1, FO: 0.1, SH: 0.45, DP: 0.35 }, { SH: 0.1, DP: 0.6, WL: 0.3 }],
  } as Record<BallType, ReadonlyArray<Partial<Record<Depth, number>>>>,

  /** §4 투수·포수 보조 배정(S4-IN 약한 땅볼의 투수, 약한 뜬공의 포수) */
  assign: { pitcherWeakGroundball: 0.25, catcherWeakFly: 0.1 },
  /** §4 유효 수비 능력: 숙련도 기준과 1점당 감점, 범위의 주력 비중 */
  effective: { skillPivot: 70, skillPenalty: 0.5, infieldSpeedShare: 0.15, outfieldSpeedShare: 0.25 },

  /** §5.1 도달 기준 확률(유형·깊이·질). 0이면 그 조합 없음 */
  reach: {
    GB: { IN: [0.97, 0.875, 0.7] },
    LD: { IN: [0.8, 0.64, 0.46], SH: [0.1, 0.12, 0.08], DP: [0, 0.4, 0.3], WL: [0, 0, 0.1] },
    FB: { IN: [0.99, 0.99, 0], FO: [1, 1, 0], SH: [0.62, 0.78, 0.62], DP: [0, 0.94, 0.88], WL: [0, 0, 0.6] },
  } as Record<BallType, Partial<Record<Depth, readonly [number, number, number]>>>,
  reachRange: { infield: 0.25, outfield: 0.3 },
  /** 방향 보정(로짓): 땅볼 내야 빈틈·정면, 외야 빈틈·선상 */
  reachDir: { groundGap: -1.0, groundFacing: 0.6, outfieldGap: -0.4, outfieldLine: -0.2 },

  /** §5.2 처리: 기준 확률과 포구 계수, 처리 실패를 실책으로 기록할 비율(질별) */
  clean: { base: { GB: 0.962, LD: 0.995, FB: 0.98 } as Record<BallType, number>, fielding: 0.3, errorShare: [0.8, 0.8, 0.4] as const },

  /** §5.3 송구(내야 땅볼): 기준(질별)·방향 보정·송구 파워·타자 주력, 송구 실책, 투수 1루 커버 */
  throw: {
    base: [0.86, 0.965, 0.985] as const,
    dir: { S1: -0.3, S2: -0.8, S7: 1.5 },
    arm: 0.25,
    batterSpeed: 0.35,
    errorBase: 0.015,
    errorAccuracy: 0.3,
    pitcherCover: 0.3,
    pitcherCoverFielding: 0.15,
  },

  /** §6 앵커링 */
  /** 뉴턴법 최대 반복·허용 오차. 시작값 오차가 oneStepResidual보다 작으면 한 번 갱신으로 끝낸다(남는 오차는 이 값의 제곱 수준) */
  anchor: { iterations: 4, tolerance: 1e-5, oneStepResidual: 0.002 },

  /** §7 안타 종류(1·2·3루타) */
  hitKinds: {
    groundLineHard: [0.47, 0.5, 0.03],
    shallowGap: [0.75, 0.25, 0],
    shallowOther: [0.9, 0.1, 0],
    deepGapLine: [0.18, 0.72, 0.1],
    deepStraight: [0.27, 0.7, 0.03],
    warning: [0.12, 0.68, 0.2],
  },

  /** §8.1 추가 진루: 시도·성공 기준과 계수 */
  advance: {
    attempt: { baserunning: 0.35, speed: 0.25, arm: 0.25 },
    safe: { speed: 0.45, arm: 0.35, blocking: 0.15 },
    singleSecondHome: { attempt: 0.62, safe: 0.93, twoOutAttempt: 0.9, twoOutSafe: 0.9, shallow: -0.5, deep: 0.5 },
    singleFirstThird: { attempt: 0.3, safe: 0.95, rightSide: 0.4 },
    doubleFirstHome: { attempt: 0.45, safe: 0.9, twoOutAttempt: 0.75, twoOutSafe: 0.88 },
    tagThird: { attempt: { SH: 0.6, DP: 0.95, WL: 0.98 }, safe: { SH: 0.85, DP: 0.95, WL: 0.99 } },
    tagSecond: { attemptRightDeep: 0.35, attempt: 0.1, safe: 0.95 },
    batterSingle: { attempt: 0.08, attemptGap: 0.15, safe: 0.85 },
    batterDouble: { attempt: 0.05, safe: 0.8 },
  },

  /** §8.2 내야 땅볼 아웃: 병살, 2루 주자 진루, 3루 주자 홈 쇄도 */
  groundOut: {
    dpBase: [0.18, 0.4, 0.55] as const,
    dpCenter: 0.3,
    dpLine: -0.3,
    dpPivotArm: 0.25,
    dpPivotFielding: 0.15,
    dpBatterSpeed: 0.35,
    dpRunnerSpeed: 0.15,
    secondToThird: { right: 0.85, left: 0.35, center: 0.6 },
    thirdHome: { centerRight: 0.7, left: 0.45, safe: 0.7 },
  },

  /** §8.3 직선타 병살, 실책 출루 */
  lineDrivePair: { base: 0.12, baserunning: 0.3 },
  errorAdvance: { batterExtraOutfieldOrThrow: 0.3, runnerExtraThrow: 0.3 },

  /** §10 구장(3a2는 모든 구장 기준 프로필, 보정 0) */
  park: { foulAreaFactor: 1 },
} as const;
