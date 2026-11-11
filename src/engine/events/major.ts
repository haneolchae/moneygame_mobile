// EV-4 중대 사건(D-210 (3)(4), 26 7장): 정의는 data/majorCases.json. 발생 위험과 진실은 히든 생활 요인에서 나온다.
import raw from '../data/majorCases.json';
import { Rng } from '../rng';
import type { CardEffect } from './cards';
import { drugRisk, type LifeFactors } from './life';

export type CaseTruth = 'fact' | 'exaggerated' | 'false' | 'found' | 'hidden';
export interface CaseResult {
  effects: CardEffect[];
  text: string;
  /** 구단 징계 폭(최소~최대 경기): 결론 때 '구단 징계 수위' 카드 */
  clubSanction?: [number, number];
  outcomes?: Array<{ p: number; effects: CardEffect[]; text: string }>;
}
export interface MajorCaseDef {
  id: string;
  motif: string;
  phase: 'season' | 'stove';
  target: 'player' | 'rookie';
  truth: 'pastRecord' | 'gambling' | 'fact' | 'coverup';
  hazard: { model: 'pastRecord' | 'selfControl' | 'drug' | 'awareness'; base: number };
  resolveWeeks: [number, number];
  /** 결론을 다음 시즌 개막 기준 주로 잡는다(원정도박) */
  resolveAt?: 'opening';
  league: { games: number; atOpen: boolean };
  texts: string[];
  choices: Array<{ id: string; label: string; effects: CardEffect[]; text: string; coverupP?: number }>;
  results: Record<string, Partial<Record<CaseTruth, CaseResult>>>;
  ai: { keep: string; release: string };
  auto: string;
}

const TRUTHS: Record<MajorCaseDef['truth'], CaseTruth[]> = { pastRecord: ['fact', 'exaggerated', 'false'], gambling: ['fact', 'false'], fact: ['fact'], coverup: ['fact', 'found', 'hidden'] };

/** 규격 검사: 선택지마다 진실별 결과표가 빠짐없이 있어야 한다(26a D3) */
export function parseMajor(input: unknown): { cases: MajorCaseDef[]; errors: string[] } {
  const cases: MajorCaseDef[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) return { cases, errors: ['중대 사건 정의는 배열이어야 합니다.'] };
  for (const [i, x] of input.entries()) {
    const c = x as MajorCaseDef;
    const bad: string[] = [];
    if (typeof c?.id !== 'string') bad.push('id');
    if (!['season', 'stove'].includes(c?.phase)) bad.push('phase');
    if (!['player', 'rookie'].includes(c?.target)) bad.push('target');
    if (!(c?.truth in TRUTHS)) bad.push('truth');
    if (!(typeof c?.hazard?.base === 'number' && c.hazard.base > 0)) bad.push('hazard');
    if (!Array.isArray(c?.texts) || c.texts.length < 3) bad.push('texts');
    if (!Array.isArray(c?.choices) || c.choices.length < 2) bad.push('choices');
    else {
      for (const ch of c.choices) {
        const res = c.results?.[ch.id];
        if (!res) {
          bad.push(`results.${ch.id}`);
          continue;
        }
        // 이 선택에서 나올 수 있는 진실(은폐 선택지는 발각·묻힘, 그 밖 은폐형은 사실)
        const need = c.truth === 'coverup' ? (ch.coverupP !== undefined ? ['found', 'hidden'] : ['fact']) : TRUTHS[c.truth];
        for (const t of need) if (!res[t as CaseTruth]) bad.push(`results.${ch.id}.${t}`);
      }
      if (!c.choices.some((ch) => ch.id === c.auto)) bad.push('auto');
      if (!c.choices.some((ch) => ch.id === c.ai?.keep) || !c.choices.some((ch) => ch.id === c.ai?.release)) bad.push('ai');
    }
    if (bad.length) errors.push(`${c?.id ?? `#${i}`}: ${bad.join(', ')}`);
    else cases.push(c);
  }
  return { cases, errors };
}

const LOADED = parseMajor(raw);
export const MAJOR_ERRORS = LOADED.errors;
export const MAJOR_CASES: readonly MajorCaseDef[] = LOADED.cases;

/** 주간 발생 위험 배수(히든 생활 요인) */
export function hazardFactor(def: MajorCaseDef, l: LifeFactors, competitiveness: number, nearReturn: boolean): number {
  switch (def.hazard.model) {
    case 'pastRecord':
      return l.pastRecord === 'major' ? 12 : l.pastRecord === 'minor' ? 4 : 0.25;
    case 'selfControl':
      return ((100 - l.selfControl) / 50) ** 2;
    case 'drug':
      return drugRisk(l, competitiveness, nearReturn);
    case 'awareness':
      return l.publicAwareness / 50;
  }
}

/** 진실(26 5.2): 히든 값에서 나온다. 경미 이력의 사실·과장, 도박 사실 확률만 사건 난수로 가른다 */
export function caseTruth(def: MajorCaseDef, l: LifeFactors, rng: Rng): CaseTruth {
  if (def.truth === 'pastRecord') return l.pastRecord === 'major' ? 'fact' : l.pastRecord === 'minor' ? (rng.next() < 0.5 ? 'fact' : 'exaggerated') : 'false';
  if (def.truth === 'gambling') return rng.next() < Math.max(0.2, Math.min(0.9, 0.3 + (60 - l.selfControl) / 100)) ? 'fact' : 'false';
  return 'fact';
}
