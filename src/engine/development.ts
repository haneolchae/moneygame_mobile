// 4a 성장·노화(04·11 문서, D-123·D-124). 나이·히든 잠재 상한·성장 속도·성실성·정점 나이·노화 속도로
// 연간 기대 변화를 정하고, 시즌 중 월 1회(소폭·상한)와 스토브리그 1회로 나눠 실제 현재 능력에 반영한다.
// 히든 값은 성장에만 쓰고 경기 확률에 직접 더하지 않는다. 난수는 저장 시드에서 선수·기간별로 파생한다.
import { DEVELOPMENT as D, TRAINING } from './config';
import { Rng } from './rng';
import type { DevelopmentState, PlayerTruth } from './types';

export const VELOCITY = 'velocity';

interface DevKey {
  key: string;
  label: string;
  get: (p: PlayerTruth) => number;
  set: (p: PlayerTruth, v: number) => void;
}

const HITTER_KEYS: DevKey[] = [
  { key: 'contact', label: '컨택', get: (p) => p.batting.contact, set: (p, v) => (p.batting.contact = v) },
  { key: 'eye', label: '선구안', get: (p) => p.batting.eye, set: (p, v) => (p.batting.eye = v) },
  { key: 'power', label: '장타', get: (p) => p.batting.power, set: (p, v) => (p.batting.power = v) },
  { key: 'speed', label: '주력', get: (p) => p.batting.speed, set: (p, v) => (p.batting.speed = v) },
  { key: 'range', label: '수비 범위', get: (p) => p.defense.range, set: (p, v) => (p.defense.range = v) },
  { key: 'fielding', label: '포구', get: (p) => p.defense.fielding, set: (p, v) => (p.defense.fielding = v) },
];
const PITCHER_KEYS: DevKey[] = [
  { key: 'stuff', label: '구위', get: (p) => p.pitching!.stuff, set: (p, v) => (p.pitching!.stuff = v) },
  { key: 'control', label: '제구', get: (p) => p.pitching!.control, set: (p, v) => (p.pitching!.control = v) },
  { key: 'groundball', label: '땅볼 유도', get: (p) => p.pitching!.groundball, set: (p, v) => (p.pitching!.groundball = v) },
  { key: 'stamina', label: '지구력', get: (p) => p.pitching!.stamina, set: (p, v) => (p.pitching!.stamina = v) },
];

export function devKeys(p: PlayerTruth): DevKey[] {
  return p.isPitcher && p.pitching ? PITCHER_KEYS : HITTER_KEYS;
}

export const DEV_LABEL: Record<string, string> = Object.fromEntries([...HITTER_KEYS, ...PITCHER_KEYS].map((k) => [k.key, k.label]).concat([[VELOCITY, '평균 구속(km/h)']]));

const traitFactor = (t: number) => D.traitMin + (D.traitSpan * t) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 핵심 능력 평균(보고·검증용): 타자 컨택·선구·장타, 투수 구위·제구 */
export function coreAverage(p: PlayerTruth): number {
  if (p.isPitcher && p.pitching) return (p.pitching.stuff + p.pitching.control) / 2;
  return (p.batting.contact + p.batting.eye + p.batting.power) / 3;
}

/** 지금 능력 스냅샷(변화 보고 기준) */
export function devSnapshot(p: PlayerTruth): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of devKeys(p)) out[k.key] = k.get(p);
  if (p.isPitcher && p.pitching) out[VELOCITY] = p.pitching.velocityAvg;
  return out;
}

/** 그 나이에서의 연간 기대 변화(능력별, 구속은 km/h) */
export function annualExpected(p: PlayerTruth, age: number): Record<string, number> {
  const h = p.hidden;
  const out: Record<string, number> = {};
  const declineYears = age - (h.peakAge + D.plateauYears);
  for (const k of devKeys(p)) {
    const cur = k.get(p);
    const pot = (h.potential as Record<string, number | undefined>)[k.key] ?? cur;
    if (age < h.peakAge) out[k.key] = Math.min(D.maxAnnualGain, Math.max(0, pot - cur) * D.growthShare * traitFactor(h.growthRate) * traitFactor(h.workEthic));
    else if (declineYears <= 0) out[k.key] = 0;
    else out[k.key] = -(D.declineBase + D.declinePerYear * declineYears) * traitFactor(h.declineRate) * (D.declineWeight[k.key] ?? 1);
  }
  if (p.isPitcher && p.pitching) {
    out[VELOCITY] =
      age < D.velocityYoungAge ? D.velocityYoungGain * traitFactor(h.growthRate) : declineYears > 0 ? -(D.velocityDeclineBase + D.velocityDeclinePerYear * declineYears) * traitFactor(h.declineRate) : 0;
  }
  return out;
}

/**
 * 훈련 반영(4b-2, D-128): 능력별 훈련 강도 s(주 목표 보통·평균 코치 ≈ 1)에 따라
 * 성장은 × (1 + 0.3s), 정점 뒤 하락은 × (1 − 0.2s). 정체 구간(0)은 그대로.
 */
export function withTraining(expected: Record<string, number>, strength: Record<string, number> | undefined): Record<string, number> {
  if (!strength) return expected;
  const out = { ...expected };
  for (const [k, s] of Object.entries(strength)) {
    const e = out[k];
    if (e === undefined || !s) continue;
    out[k] = e > 0 ? e * (1 + TRAINING.growthBonus * s) : e < 0 ? e * (1 - TRAINING.declineRelief * s) : 0;
  }
  return out;
}

/** 구속 이동: 평균·최고·구종 구속을 같은 폭으로 */
function shiftVelocity(p: PlayerTruth, d: number) {
  if (!p.pitching || d === 0) return;
  p.pitching.velocityAvg = round1(p.pitching.velocityAvg + d);
  p.pitching.velocityMax = round1(p.pitching.velocityMax + d);
  for (const pitch of p.pitches ?? []) pitch.velocity = round1(pitch.velocity + d);
}

function state(p: PlayerTruth, date: string): DevelopmentState {
  if (!p.dev) p.dev = { acc: {} };
  if (!p.dev.base) {
    p.dev.base = devSnapshot(p);
    p.dev.baseDate = date;
  }
  return p.dev;
}

/** 정수 단위 반영: 상승은 잠재 상한을 넘지 않고, 1~100 범위를 지킨다. 반영한 정수 변화를 돌려준다. */
function applyRating(p: PlayerTruth, k: DevKey, step: number): number {
  const cur = k.get(p);
  const pot = (p.hidden.potential as Record<string, number | undefined>)[k.key];
  let next = cur + step;
  if (step > 0 && pot !== undefined) next = Math.min(next, Math.max(cur, pot));
  next = Math.max(D.ratingMin, Math.min(D.ratingMax, next));
  k.set(p, next);
  return next - cur;
}

/**
 * 월간 반영(D-123): 연간 기대 변화의 monthlyShare를 달 수로 나눠 소수까지 누적하고, 능력치당 월 1점(구속 0.3km/h)까지만 반영한다.
 * 같은 달은 다시 반영하지 않는다. 반영한 변화(능력별)를 돌려준다.
 */
export function applyMonthly(p: PlayerTruth, seed: string, date: string, age: number, strength?: Record<string, number>): Record<string, number> {
  const monthKey = date.slice(0, 7);
  if (p.dev?.month === monthKey) return {};
  const dev = state(p, date);
  const expected = withTraining(annualExpected(p, age), strength);
  // 연간 반영용 훈련 기록(4b-2): 그 달 강도를 더하고 월간 반영 횟수를 센다.
  dev.trainMonths = (dev.trainMonths ?? 0) + 1;
  if (strength && Object.keys(strength).length) {
    dev.trainSum = dev.trainSum ?? {};
    for (const [k, s] of Object.entries(strength)) dev.trainSum[k] = (dev.trainSum[k] ?? 0) + s;
  }
  const rng = Rng.derive(seed, 'dev-month', p.id, monthKey);
  const share = D.monthlyShare / D.monthlyMonths.length;
  const changed: Record<string, number> = {};
  for (const k of devKeys(p)) {
    const acc = (dev.acc[k.key] ?? 0) + expected[k.key]! * share + rng.normal(0, D.monthlyNoiseSd);
    const step = acc >= 1 ? D.monthlyCap : acc <= -1 ? -D.monthlyCap : 0;
    const applied = step ? applyRating(p, k, step) : 0;
    // 상한(잠재·1~100)에 막힌 몫은 버려 다음 달로 쌓이지 않게 한다.
    dev.acc[k.key] = applied === step ? acc - step : 0;
    if (applied) changed[k.key] = applied;
  }
  if (p.isPitcher && p.pitching) {
    const acc = (dev.acc[VELOCITY] ?? 0) + expected[VELOCITY]! * share + rng.normal(0, D.monthlyNoiseSd * D.monthlyVelocityCap);
    const step = round1(Math.max(-D.monthlyVelocityCap, Math.min(D.monthlyVelocityCap, acc)));
    const usable = Math.abs(step) >= 0.1 ? step : 0;
    shiftVelocity(p, usable);
    dev.acc[VELOCITY] = acc - usable;
    if (usable) changed[VELOCITY] = usable;
  }
  dev.month = monthKey;
  return changed;
}

/**
 * 스토브리그 연간 반영(D-124): 연간 기대 변화의 나머지(1 − monthlyShare)와 연간 편차, 그동안 남은 소수 누적을 한 번에 반영한다.
 * 같은 시즌은 다시 반영하지 않는다. 반영 뒤 능력을 다음 보고 기준으로 남긴다.
 */
export function applyAnnual(p: PlayerTruth, seed: string, season: number, date: string, age: number): Record<string, number> {
  if (p.dev?.season === season) return {};
  const dev = state(p, date);
  const before = devSnapshot(p);
  // 4b-2: 연간 반영의 훈련 효과는 그 시즌 월간 훈련 강도의 평균(8개월 기준)
  const avg = Object.fromEntries(Object.entries(dev.trainSum ?? {}).map(([k, s]) => [k, s / D.monthlyMonths.length]));
  const expected = withTraining(annualExpected(p, age), avg);
  delete dev.trainSum;
  delete dev.trainMonths;
  const rng = Rng.derive(seed, 'dev-year', p.id, season);
  for (const k of devKeys(p)) {
    const total = (dev.acc[k.key] ?? 0) + expected[k.key]! * (1 - D.monthlyShare) + rng.normal(0, D.annualNoiseSd);
    const step = Math.round(total);
    const applied = step ? applyRating(p, k, step) : 0;
    dev.acc[k.key] = applied === step ? total - step : 0;
  }
  if (p.isPitcher && p.pitching) {
    const total = (dev.acc[VELOCITY] ?? 0) + expected[VELOCITY]! * (1 - D.monthlyShare) + rng.normal(0, D.annualNoiseSd * D.monthlyVelocityCap);
    const step = round1(total);
    shiftVelocity(p, step);
    dev.acc[VELOCITY] = total - step;
  }
  dev.season = season;
  dev.base = devSnapshot(p);
  dev.baseDate = date;
  const after = dev.base;
  const changed: Record<string, number> = {};
  for (const [k, v] of Object.entries(after)) {
    const d = k === VELOCITY ? round1(v - before[k]!) : v - before[k]!;
    if (d) changed[k] = d;
  }
  return changed;
}
