// EV-4 히든 생활·평판 요인과 평판 메모(D-210 (1)(2), 26 5장).
// 요인은 (시드, 선수)에서 파생해 바뀌지 않는다. 선수 기록·화면 응답에 넣지 않는다(04 데이터 경계).
import { EVENTS as E } from '../config';
import { Rng } from '../rng';
import type { PlayerTruth } from '../types';

export type PastRecord = 'none' | 'minor' | 'major';
export interface LifeFactors {
  selfControl: number;
  publicAwareness: number;
  warmth: number;
  humility: number;
  pastRecord: PastRecord;
}

const clamp = (v: number) => Math.max(1, Math.min(100, Math.round(v)));
const cache = new Map<string, LifeFactors>();

/** 히든 생활 요인(자기관리는 성실성과 상관 0.3) */
export function lifeOf(seed: string, p: Pick<PlayerTruth, 'id' | 'hidden'>): LifeFactors {
  const key = `${seed}|${p.id}`;
  let v = cache.get(key);
  if (v) return v;
  const rng = Rng.derive(seed, 'life', p.id);
  const zWe = Math.max(-3, Math.min(3, (p.hidden.workEthic - 50) / 15));
  const selfControl = clamp(50 + 15 * (E.selfControlCorr * zWe + Math.sqrt(1 - E.selfControlCorr ** 2) * rng.normal(0, 1)));
  const publicAwareness = clamp(rng.normal(50, 15));
  const warmth = clamp(rng.normal(50, 15));
  const humility = clamp(rng.normal(50, 15));
  const u = rng.next();
  const pastRecord: PastRecord = u < E.pastMajor ? 'major' : u < E.pastMajor + E.pastMinor ? 'minor' : 'none';
  v = { selfControl, publicAwareness, warmth, humility, pastRecord };
  if (cache.size > 20_000) cache.clear();
  cache.set(key, v);
  return v;
}

export interface ReputationNote {
  text: string;
  source: string;
  certainty: '소문' | '복수 증언';
}

const SOURCES = ['학교 관계자', '전 동료', '지역 기자', '구단 직원'] as const;
/** 요인 → 해당 여부와 문구(26 5.3) */
const FACTORS: Array<[string, (l: LifeFactors) => boolean, string[]]> = [
  ['past', (l) => l.pastRecord !== 'none', ['고교 시절 팀 내 갈등이 있었다는 이야기가 돈다', '졸업 동기들과 연락을 거의 안 한다']],
  ['selfLow', (l) => l.selfControl < 30, ['시즌 중 늦은 시간 외출이 잦다는 말이 있다', '카지노가 있는 해외 전지훈련지를 선호한다']],
  ['selfHigh', (l) => l.selfControl > 75, ['식단·수면 관리가 철저하다']],
  ['publicLow', (l) => l.publicAwareness < 30, ['SNS에서 말이 거칠다는 평']],
  ['warmHigh', (l) => l.warmth > 75, ['지역 아동센터에 자주 얼굴을 비춘다는 제보']],
  ['humbleHigh', (l) => l.humility > 75, ['인터뷰나 노출을 꺼린다']],
];
export const REPUTATION_FACTORS = FACTORS.map(([k]) => k);

/** 조사 역량 0~1에서 적중·오탐 확률 */
export const hitRate = (skill: number) => E.repHitBase + E.repHitSpan * skill;
export const falseRate = (skill: number) => E.repFalseBase - E.repFalseSpan * skill;

/**
 * 평판 메모(최대 3개). 요인별 난수는 (시드, 관찰 구단, 선수, 요인)에서 파생해 다시 조사해도 같다.
 * factorsOverride: 시험용 합성 요인
 */
export function reputationNotes(seed: string, observer: number, p: Pick<PlayerTruth, 'id' | 'hidden'>, skill: number, factorsOverride?: LifeFactors): ReputationNote[] {
  const l = factorsOverride ?? lifeOf(seed, p);
  const s = Math.max(0, Math.min(1, skill));
  const out: ReputationNote[] = [];
  for (const [key, has, texts] of FACTORS) {
    const rng = Rng.derive(seed, 'rep', observer, p.id, key);
    const r = rng.next();
    const truth = has(l);
    if (!(truth ? r < hitRate(s) : r < falseRate(s))) continue;
    out.push({ text: texts[rng.int(0, texts.length - 1)]!, source: SOURCES[rng.int(0, SOURCES.length - 1)]!, certainty: truth && rng.next() < 0.5 * s ? '복수 증언' : '소문' });
  }
  return out.slice(0, 3);
}

/** 스카우트 오차 배율(작을수록 정확)을 조사 역량 0~1로 */
export const scoutSkill = (scale: number) => Math.max(0, Math.min(1, (1.3 - scale) / 0.6));

/** 약물 위험(26 5.1): (100 − 자기관리)/50 × 승부욕/50 × (장기 부상 복귀 직전이면 3) */
export const drugRisk = (l: LifeFactors, competitiveness: number, nearReturn: boolean) => ((100 - l.selfControl) / 50) * (competitiveness / 50) * (nearReturn ? 3 : 1);
