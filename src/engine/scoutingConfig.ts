/** ASSUMPTION(D-113): 스카우팅 정확도·비용·공개 기준의 밸런스 초안. */
export const SCOUTING = {
  ap: 1, wp: 8, cooldownDays: 28,
  confidenceStep: 20, maxConfidence: 100, minTeamScale: 0.5,
  initialWidth: 15, minWidth: 2, staleDays: 90, staleWidth: 2,
  velocityWidth: 4, velocityUnit: 0.3, velocityMin: 70, velocityMax: 180,
  usageUnit: 0.01, observationSd: 7, confidenceDecay: 125,
  traitThreshold: 40, traitHigh: 65, traitLow: 35, traitSd: 12,
} as const;
