// 타석 확률 모델 설정 (10a 문서 8장, D-091·D-093·D-100).
// 모든 계수·기준 확률·상한은 '밸런스 초안'이다(실제 야구의 통계적 정답이 아니다). 코드에 직접 쓰지 않고 이 파일에서만 바꾼다.
// 능력치 효과는 z = (능력 − 50) / 50 에 계수를 곱한 로짓 이동이다. 부호는 10a 3장에 고정돼 있다.

import { ZONE_CONFIG } from './zoneConfig';

export const PROBABILITY_CONFIG = {
  modelVersion: '3a2-zone-1',

  /** 리그 목표 기준값 (D-100, 사용자 확정): 경기당 득점(양 팀 합), 타석당 홈런 */
  leagueTarget: { runsPerGame: 9.8, hrPerPa: 0.0225 },

  /**
   * 리그 기준 조건부 확률(능력 평균 50인 리그). 밸런스 초안 — 기준 리그 시뮬레이션으로 leagueTarget에 맞춘 값.
   * hbp: 전체 타석 대비, b: 사구가 아닌 타석 대비 볼넷, k: 볼넷이 아닌 타석 대비 삼진, h: 볼넷·삼진이 아닌 타석 대비 홈런
   */
  base: { hbp: 0.011, b: 0.095, k: 0.205, h: 0.0292 },

  /** 볼넷: 선구안 ↑ → ↑, 제구 ↑ → ↓ (포수 프레이밍은 상황 보정) */
  walk: { batterEye: 0.55, batterContact: 0.1, pitcherControl: 0.6 },
  /** 삼진: 컨택 ↑ → ↓, 구위·구속 ↑ → ↑ */
  strikeout: { batterContact: 0.75, batterEye: 0.15, pitcherStuff: 0.6, pitcherVelocity: 0.15 },
  /** 홈런: 장타 ↑ → ↑, 구위 ↑ → ↓. 땅볼 유도는 여기에 쓰지 않는다(10a 2장) */
  homeRun: { batterPower: 1.1, batterContact: 0.1, pitcherStuff: 0.35 },

  /** 홈런이 아닌 인플레이 타구 유형 기준 비율(땅볼·라인드라이브·뜬공, 합 1) */
  battedBall: {
    groundball: 0.44,
    lineDrive: 0.21,
    flyBall: 0.35,
    /** 땅볼 로짓: 투수 땅볼 유도 ↑ → ↑ (타구 유형 단계에만 적용), 타자 장타 ↑ → ↓(띄우는 타자) */
    pitcherGroundball: 0.9,
    batterPower: 0.3,
    /** 구역·수비수·판정·주자 진루(10b 존 모델, D-102) */
    zone: ZONE_CONFIG,
  },

  /**
   * 인플레이 안타 확률 x(홈런이 아닌 인플레이 타구 대비, D-102): 타자 컨택·장타, 투수 구위·구속만 쓴다.
   * 타자 주력·수비·구장은 존 모델(zoneConfig)에서만 적용한다. 존 모델은 중립 조건에서 이 값에 고정(앵커링)된다.
   */
  inPlayHit: { base: 0.34, contact: 0.28, power: 0.12, stuff: 0.12, velocity: 0.05 },

  /** 구종 섞기: 구종 제구·품질은 선수 제구·구위 대비 잔차로 해석해 사용 비중 가중으로 더한다(같은 효과를 두 번 더하지 않음) */
  pitchMix: { commandWeight: 0.5, qualityWeight: 0.5 },
  /** 구속: 리그 평균·표준편차(km/h). z = (구속 − 평균) / 표준편차 */
  velocity: { leagueAvg: 143, sd: 3.5 },

  /** 상황 보정(delta_context): 포수 프레이밍. 합 상한 ±0.25 로짓(10a 5장). 개인 수비는 존 모델에서 */
  context: { framingOnWalk: 0.12, framingOnStrikeout: 0.08, maxAbsLogit: 0.25 },

  /** 확률 계산 전 제한 */
  probabilityFloor: 0.0001,

  /**
   * 시즌 리그 환경(D-100): 홈런 편차는 h 기준 확률에 비율로, 득점 편차는 볼넷·인플레이 안타 로짓을
   * runsLogitPerLogRatio × (ln(1 + 득점 편차) − hrRunsOffset × ln(1 + 홈런 편차))만큼 옮긴다(홈런 환경이 득점 목표를 흔들지 않게 상쇄).
   * 이동 크기는 기준 리그 보정(scripts/calibrate-model.ts)으로 맞춘 밸런스 초안.
   */
  environment: { stepPct: 0.05, maxPct: 0.1, runsLogitPerLogRatio: 0.77, hrRunsOffset: 0.22 },

  /**
   * 시즌 리그 기준 재조정(D-103): 시즌 모드 시작 때 실제 1군으로 games경기를 모의해 목표 대비 보정값을 정한다.
   * maxAdjustRatio: 보정 배율 상한(득점·홈런 각각 1/상한 ~ 상한). 밸런스 초안.
   */
  seasonCalibration: { games: 1440, maxInnings: 12, maxAdjustRatio: 1.3 },
} as const;

export type ProbabilityConfig = typeof PROBABILITY_CONFIG;
