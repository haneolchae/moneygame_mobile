// 최근·과거 성적 혼합과 경기별 수행·압박 (10a 4장·6장, D-090·D-107). 계수는 probabilityConfig에만 둔다.
// 경기 시작 때 그 경기 전날까지 확정된 기록으로 선수별 표본을 고정하고(7장), 경기 중에는 바꾸지 않는다.
// 사건 분모(2장): b = 사구가 아닌 타석, k = 볼넷도 아닌 타석, h = 삼진도 아닌 타석, x = 홈런도 아닌 인플레이 타구.
import { clampP, logit, sigmoid } from './mathx';
import { PROBABILITY_CONFIG } from './probabilityConfig';

const F = PROBABILITY_CONFIG.form;
const P = PROBABILITY_CONFIG.performance;

export const FORM_EVENTS = ['b', 'k', 'h', 'x'] as const;
export type FormEvent = (typeof FORM_EVENTS)[number];
export type FormRole = 'batter' | 'pitcher';

/** 가중 성공·가중 기회 */
export interface EventSample {
  succ: number;
  opp: number;
}
export type EventSamples = Record<FormEvent, EventSample>;

/** 선수 한 명의 그 경기용 표본(최근 창·과거 창은 겹치지 않는다) */
export interface PlayerForm {
  recent: EventSamples;
  history: EventSamples;
}

/** 타석 결과 코드: 사구·볼넷·삼진·홈런·인플레이 안타·그 밖의 인플레이 결과 */
export const PaCode = { HBP: 0, BB: 1, K: 2, HR: 3, HIT: 4, OUT: 5 } as const;
export type PaCode = (typeof PaCode)[keyof typeof PaCode];

export function paCode(outcome: string): PaCode {
  switch (outcome) {
    case 'HBP':
      return PaCode.HBP;
    case 'BB':
      return PaCode.BB;
    case 'K':
      return PaCode.K;
    case 'HR':
      return PaCode.HR;
    case '1B':
    case '2B':
    case '3B':
      return PaCode.HIT;
    default:
      return PaCode.OUT; // 땅볼·뜬공·병살·희생플라이·실책 출루·야수 선택
  }
}

export const emptySamples = (): EventSamples => ({ b: { succ: 0, opp: 0 }, k: { succ: 0, opp: 0 }, h: { succ: 0, opp: 0 }, x: { succ: 0, opp: 0 } });

/** 결과 하나를 사건 분모 규칙대로 가중치 w로 더한다 */
export function addCode(s: EventSamples, code: PaCode, w: number): void {
  if (code === PaCode.HBP) return;
  s.b.opp += w;
  if (code === PaCode.BB) return void (s.b.succ += w);
  s.k.opp += w;
  if (code === PaCode.K) return void (s.k.succ += w);
  s.h.opp += w;
  if (code === PaCode.HR) return void (s.h.succ += w);
  s.x.opp += w;
  if (code === PaCode.HIT) s.x.succ += w;
}

/** 시즌 합계(타자: PA·BB·HBP·SO·HR·H, 투수: BF·BB·HBP·K·HR·H)를 가중치 w로 더한다 */
export function addTotals(s: EventSamples, t: { pa: number; bb: number; hbp: number; k: number; hr: number; h: number }, w: number): void {
  const b = t.pa - t.hbp;
  const k = b - t.bb;
  const h = k - t.k;
  const x = h - t.hr;
  s.b.opp += w * b;
  s.b.succ += w * t.bb;
  s.k.opp += w * k;
  s.k.succ += w * t.k;
  s.h.opp += w * h;
  s.h.succ += w * t.hr;
  s.x.opp += w * x;
  s.x.succ += w * (t.h - t.hr);
}

/** 최근 창의 경과 일수 가중치(창 밖이면 0) */
export function recentAgeWeight(ageDays: number): number {
  for (const [maxDays, w] of F.recentAge) if (ageDays <= maxDays) return w;
  return 0;
}

/**
 * 현재 시즌 기록으로 최근 창과 과거 창(현재 시즌분) 원시 표본을 만든다.
 * days·codes: 그 선수의 이번 시즌 타석(오래된 순), today 이전 날짜만 들어 있어야 한다(미래 기록 금지).
 * seasonSoFar: 같은 타석 전체의 가중치 1 합계. 과거 창(현재 시즌분) = 전체 − 최근 창에 들어간 타석(겹침 없음).
 * 직전 시즌분은 호출하는 쪽이 neutralize로 리그 수준을 맞춰 더한다.
 */
export function buildForm(days: ArrayLike<number>, codes: ArrayLike<number>, count: number, today: number, role: FormRole, seasonSoFar: EventSamples): PlayerForm {
  const recent = emptySamples();
  const inRecent = emptySamples();
  const maxPa = role === 'batter' ? F.recentWindow.batterPa : F.recentWindow.pitcherPa;
  let taken = 0;
  for (let i = count - 1; i >= 0 && taken < maxPa; i--) {
    const age = today - days[i]!;
    if (age <= 0) throw new Error('성적 혼합: 경기 당일 이후 기록이 들어왔습니다.');
    if (age > F.recentWindow.maxDays) break;
    const w = recentAgeWeight(age);
    addCode(recent, codes[i]! as PaCode, w);
    addCode(inRecent, codes[i]! as PaCode, 1);
    taken++;
  }
  const history = emptySamples();
  for (const e of FORM_EVENTS) {
    history[e].succ = seasonSoFar[e].succ - inRecent[e].succ;
    history[e].opp = seasonSoFar[e].opp - inRecent[e].opp;
  }
  return { recent, history };
}

/**
 * 리그 수준 중립화(10a 4.3, D-107): 원시 비율을 같은 기간 리그 실제 비율 대비 로짓 차이로 바꾸고, 엔진 기준(그날 1군 선수
 * 능력 기준 확률의 평균 로짓)에 다시 얹는다. 실제 수비·구장·시즌 환경처럼 리그 전체에 같이 걸린 차이가 성적 혼합으로
 * 두 번 들어가지 않게 한다. w: 표본 가중치(시즌 가중치), into에 더한다.
 */
export function neutralizeInto(into: EventSamples, s: EventSamples, league: EventSamples, baselineLogit: Record<FormEvent, number>, w: number): void {
  for (const e of FORM_EVENTS) {
    const opp = s[e].opp;
    if (opp <= 0 || league[e].opp <= 0) continue;
    const rate = sigmoid(logit(s[e].succ / opp) - logit(league[e].succ / league[e].opp) + baselineLogit[e]);
    into[e].succ += w * opp * rate;
    into[e].opp += w * opp;
  }
}

/** 4.2 비중: 표본 비율에 따라 최근 최대 0.3, 과거 최대 0.2, 나머지는 능력치 */
export function blendWeights(event: FormEvent, role: FormRole, nRecent: number, nHistory: number): { ability: number; recent: number; history: number } {
  const rR = Math.min(1, Math.max(0, nRecent) / F.nRecent[role][event]);
  const rH = Math.min(1, Math.max(0, nHistory) / F.nHistory[event]);
  const recent = F.weights.recent * rR;
  const history = F.weights.history * rH;
  return { ability: 1 - recent - history, recent, history };
}

/** 4.3 사건별 혼합식. consistency: 히든 일관성(1~100). 표본이 없으면 q_ability 그대로 */
export function blendEvent(event: FormEvent, role: FormRole, qAbility: number, form: PlayerForm | undefined, consistency: number): number {
  if (!form) return qAbility;
  const r = form.recent[event];
  const h = form.history[event];
  const w = blendWeights(event, role, r.opp, h.opp);
  if (w.ability === 1) return qAbility;
  const d = F.cap[event];
  const lo = qAbility - d;
  const hi = qAbility + d;
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  let q = w.ability * qAbility;
  if (w.recent > 0) {
    const c = (consistency - 1) / 99;
    const sensitivity = F.sensitivity.max - F.sensitivity.span * c;
    q += w.recent * clamp(qAbility + sensitivity * (r.succ / r.opp - qAbility));
  }
  if (w.history > 0) q += w.history * clamp(h.succ / h.opp);
  return Math.min(1, Math.max(0, q));
}

/** 6.1 경기별 수행 편차(로짓). u: 선수·경기별 1회 추첨한 Uniform(−1, 1) */
export function consistencyPerformance(consistency: number, u: number): number {
  const c = (consistency - 1) / 99;
  return (P.consistencySigma.base + P.consistencySigma.span * (1 - c)) * u;
}

export interface PressureState {
  inning: number;
  /** 공격 팀 기준 점수 차(부호 무관) */
  scoreDiff: number;
  runners: number;
  postseason: boolean;
}

/** 압박 0~1: 이닝·점수 차·주자·경기 중요도 */
export function pressureIndex(s: PressureState): number {
  const C = P.pressure;
  const inning = C.inning[Math.min(C.inning.length, Math.max(1, s.inning)) - 1]!;
  const close = Math.max(0, 1 - Math.abs(s.scoreDiff) / (C.closeMaxDiff + 1));
  const v = inning * close * (1 + C.perRunner * s.runners) * (s.postseason ? C.postseason : 1);
  return Math.min(1, Math.max(0, v));
}

/** 6.2 압박 손실(로짓, 0 이상). mental: 멘탈 능력치, sensitivity: 히든 압박 민감도, morale: 기분(0~100) */
export function pressureLoss(pressure: number, mental: number, sensitivity: number, morale: number = P.pressure.defaultMorale): number {
  if (pressure <= 0) return 0;
  const C = P.pressure;
  const m = (mental - 1) / 99;
  const s = (sensitivity - 1) / 99;
  const mood = morale / 100;
  return C.coefficient * pressure * (1 - C.mentalRelief * m) * (C.sensitivityBase + C.sensitivitySpan * s) * (1 + C.moodSpan * (1 - mood));
}

/** 6.3 방향 계수: 타자 수행이 좋아지면 볼넷·홈런·인플레이 안타 ↑, 삼진 ↓. 투수는 반대 */
export const BATTER_DIRECTION: Record<FormEvent, number> = { b: 1, k: -1, h: 1, x: 1 };

export { clampP };
