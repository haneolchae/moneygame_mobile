// EV-1 카드 정의 읽기·후보 선택(D-203 (1)(4), 26a E1·E4). 카드는 코드가 아니라 data/eventCards.json에 둔다.
// 규격에 맞지 않는 카드는 건너뛰고 오류로 남긴다. 실제 모델에 연결되지 않은 효과를 쓰는 카드는 비활성(추첨 안 함).
import raw from '../data/eventCards.json';
import { EVENTS as E } from '../config';
import type { Rng } from '../rng';
import { exprVars, parseExpr, type ExprNode } from './expr';

export const CARD_CATEGORIES = ['injury', 'award', 'sponsor', 'coach', 'transfer', 'ops', 'personal', 'positive'] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<CardCategory, string> = { injury: '부상·건강', award: '시상·기록', sponsor: '스폰서·사업', coach: '감독·코치', transfer: '이적·육성', ops: '운영·팬', personal: '일상 개인사', positive: '긍정 개인사' };
export const PHASES = ['preseason', 'regular', 'postseason'] as const;
export type CardPhase = (typeof PHASES)[number];
export const TARGETS = ['club', 'ourPlayer'] as const;
export const TEAMS = ['medical', 'pr', 'partnership', 'operations', 'marketing'] as const;
export const TEAM_LABEL: Record<string, string> = { medical: '컨디셔닝·메디컬팀', pr: '홍보팀', partnership: '사업제휴팀', operations: '운영팀', marketing: '마케팅팀' };

/** 26 4장 효과 전체 */
export const EFFECT_TYPES = ['CASH', 'RECUR', 'DEMAND', 'MERCH', 'FAN_NOW', 'FAN_TARGET', 'PRESS', 'MOOD', 'COND', 'INJ_RISK', 'REST', 'SUSPEND', 'GROWTH', 'TRUST', 'CLUBHOUSE', 'FLAG', 'SPAWN', 'CONTRACT', 'HEAL'] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];
/** 실제 모델에 연결한 효과(EV-1 6종 + EV-2 10종). SUSPEND·CONTRACT는 EV-4에서 연결한다 */
export const CONNECTED: ReadonlySet<EffectType> = new Set<EffectType>(['CASH', 'FAN_NOW', 'REST', 'TRUST', 'FLAG', 'SPAWN', 'MOOD', 'CLUBHOUSE', 'COND', 'INJ_RISK', 'DEMAND', 'MERCH', 'RECUR', 'FAN_TARGET', 'PRESS', 'GROWTH', 'HEAL']);
/** 기간(주)이 필요한 효과 */
export const TIMED: ReadonlySet<EffectType> = new Set<EffectType>(['COND', 'INJ_RISK', 'DEMAND', 'MERCH', 'RECUR', 'FAN_TARGET']);
export const COST_GRADES = ['small', 'medium', 'large'] as const;

/** 조건식에서 쓸 수 있는 변수(flag.이름은 따로 허용) */
export const CLUB_VARS = ['club.rank', 'club.streak', 'club.fan', 'club.cashEok', 'club.week', 'season.half', 'club.subSlotsFree', 'club.feat', 'club.tradeRecent'] as const;
export const PLAYER_VARS = ['player.injuryDays', 'player.starter', 'player.age', 'player.fatigue', 'player.pitcher', 'player.active', 'player.slump', 'player.awardRecent'] as const;

/** EV-3(D-207 (2)): 분류별 담당 팀(D-199). 시상·기록과 감독·코치는 담당 팀이 없어 위임할 수 없다 */
export const CATEGORY_TEAM: Record<CardCategory, (typeof TEAMS)[number] | null> = { injury: 'medical', personal: 'pr', positive: 'pr', sponsor: 'partnership', transfer: 'operations', ops: 'marketing', award: null, coach: null };
export const LINKS = ['market', 'trade', 'org'] as const;

export interface CardEffect {
  type: EffectType;
  /** 효과 크기(만족도·신뢰도 ±, 기분 ± 등) */
  value?: number;
  /** CASH: 정수 원(음수 지출) 또는 비용 등급 */
  won?: number;
  grade?: (typeof COST_GRADES)[number];
  /** REST 일수, 기간 효과 주 수 */
  days?: number;
  weeks?: number;
  /** FLAG 이름, SPAWN 카드 */
  name?: string;
  card?: string;
  /** GROWTH·MOOD 대상: 카드 대상 선수(기본), 우리 1군 전원, 대상이 아닌 1군 주전 1명(MOOD) */
  who?: 'target' | 'club' | 'other';
  /** CASH·RECUR 비용 등급 금액을 수입으로 */
  income?: boolean;
}

export interface CardOutcome {
  p: number;
  /** 카드 화면에 위험 등급과 함께 보이는 짧은 설명 */
  hint?: string;
  effects: CardEffect[];
  text: string;
}

export interface CardChoice {
  id: string;
  label: string;
  effects: CardEffect[];
  /** 확률 결과(합 ≤ 1). 남은 확률은 elseText */
  outcomes?: CardOutcome[];
  elseText?: string;
  /** 선택하면 바로 알리는 처리 문장 */
  text: string;
  /** 선택 뒤 열 화면 */
  link?: (typeof LINKS)[number];
}

export interface EventCard {
  id: string;
  type: 'decision';
  category: CardCategory;
  priority: boolean;
  phases: CardPhase[];
  target: (typeof TARGETS)[number];
  trigger: string;
  weight: number;
  cooldownWeeks: number;
  seasonCap: number;
  delegateTeam: (typeof TEAMS)[number] | null;
  delegateDefault: string;
  texts: string[];
  choices: CardChoice[];
}

export interface LoadedCard extends EventCard {
  cond: ExprNode;
  /** 비활성 사유(연결 전 효과). 없으면 추첨 대상 */
  inactive: string | null;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const within = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

function effectErrors(e: unknown, where: string, cardIds: Set<string>): string[] {
  const x = e as CardEffect;
  if (!x || typeof x !== 'object' || !within(EFFECT_TYPES, x.type)) return [`${where}: 효과 종류 오류`];
  const bad: string[] = [];
  if (x.type === 'CASH' && !(Number.isInteger(x.won) || within(COST_GRADES, x.grade))) bad.push(`${where}: CASH는 won(정수) 또는 grade`);
  if (['FAN_NOW', 'TRUST', 'MOOD', 'PRESS', 'CLUBHOUSE', 'COND', 'FAN_TARGET'].includes(x.type) && typeof x.value !== 'number') bad.push(`${where}: ${x.type} value 필요`);
  if (x.type === 'REST' && !(Number.isInteger(x.days) && x.days! > 0)) bad.push(`${where}: REST days 필요`);
  if (TIMED.has(x.type) && !(Number.isInteger(x.weeks) && x.weeks! >= 1)) bad.push(`${where}: ${x.type} weeks 필요`);
  if (['INJ_RISK', 'DEMAND', 'MERCH', 'GROWTH'].includes(x.type) && !(typeof x.value === 'number' && x.value > 0)) bad.push(`${where}: ${x.type} 배율 value 필요`);
  if (x.type === 'RECUR' && !(Number.isInteger(x.won) || within(COST_GRADES, x.grade))) bad.push(`${where}: RECUR는 won 또는 grade`);
  if (x.who !== undefined && x.who !== 'target' && x.who !== 'club' && x.who !== 'other') bad.push(`${where}: who 오류`);
  if (x.type === 'HEAL' && !(Number.isInteger(x.days) && x.days !== 0)) bad.push(`${where}: HEAL days 필요`);
  if (x.type === 'FLAG' && !isText(x.name)) bad.push(`${where}: FLAG name 필요`);
  if (x.type === 'SPAWN' && !(isText(x.card) && cardIds.has(x.card) && Number.isInteger(x.weeks) && x.weeks! >= 1)) bad.push(`${where}: SPAWN card·weeks 오류`);
  return bad;
}

/** 카드 정의를 규격대로 검사해 쓸 수 있는 카드와 오류를 나눈다 */
export function parseCards(input: unknown): { cards: LoadedCard[]; errors: string[] } {
  const cards: LoadedCard[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) return { cards, errors: ['카드 정의는 배열이어야 합니다.'] };
  const ids = new Set(input.map((c) => (c as EventCard)?.id).filter(isText));
  const seen = new Set<string>();
  for (const [i, rawCard] of input.entries()) {
    const c = rawCard as EventCard;
    const where = isText(c?.id) ? c.id : `#${i}`;
    const bad: string[] = [];
    if (!isText(c?.id)) bad.push('id');
    else if (seen.has(c.id)) bad.push('id 중복');
    if (c?.type !== 'decision') bad.push('type(EV-1은 decision만)');
    if (!within(CARD_CATEGORIES, c?.category)) bad.push('category');
    if (typeof c?.priority !== 'boolean') bad.push('priority');
    if (!Array.isArray(c?.phases) || !c.phases.length || !c.phases.every((p) => within(PHASES, p))) bad.push('phases');
    if (!within(TARGETS, c?.target)) bad.push('target');
    if (!(typeof c?.weight === 'number' && c.weight > 0)) bad.push('weight');
    if (!(Number.isInteger(c?.cooldownWeeks) && c.cooldownWeeks >= 1)) bad.push('cooldownWeeks');
    if (!(Number.isInteger(c?.seasonCap) && c.seasonCap >= 1)) bad.push('seasonCap');
    if (!(c?.delegateTeam === null || within(TEAMS, c?.delegateTeam))) bad.push('delegateTeam');
    else if (within(CARD_CATEGORIES, c?.category) && c.delegateTeam !== CATEGORY_TEAM[c.category]) bad.push('delegateTeam(분류 담당 팀과 다름)');
    if (!Array.isArray(c?.texts) || c.texts.length < 3 || !c.texts.every(isText)) bad.push('texts(변형 3종 이상)');
    if (!Array.isArray(c?.choices) || c.choices.length < 2 || c.choices.length > 3) bad.push('choices(2~3개)');
    else {
      for (const ch of c.choices) {
        if (ch?.link !== undefined && !within(LINKS, ch.link)) bad.push(`choice ${ch?.id ?? '?'} link`);
        if (!isText(ch?.id) || !isText(ch?.label) || !isText(ch?.text) || !Array.isArray(ch?.effects)) {
          bad.push(`choice ${ch?.id ?? '?'} 필드`);
          continue;
        }
        for (const e of ch.effects) bad.push(...effectErrors(e, `choice ${ch.id}`, ids));
        if (ch.outcomes !== undefined) {
          if (!Array.isArray(ch.outcomes) || ch.outcomes.reduce((a, o) => a + (o?.p ?? 0), 0) > 1 + 1e-9) bad.push(`choice ${ch.id} outcomes 확률 합`);
          else for (const o of ch.outcomes) {
            if (!(typeof o?.p === 'number' && o.p >= E.outcomeMin && o.p <= E.outcomeMax) || !isText(o?.text) || !Array.isArray(o?.effects)) bad.push(`choice ${ch.id} outcome 필드(확률 ${E.outcomeMin}~${E.outcomeMax})`);
            else for (const e of o.effects) bad.push(...effectErrors(e, `choice ${ch.id} outcome`, ids));
          }
        }
      }
      if (!c.choices.some((ch) => ch?.id === c.delegateDefault)) bad.push('delegateDefault(선택지 id)');
    }
    let cond: ExprNode | null = null;
    if (!isText(c?.trigger)) bad.push('trigger');
    else {
      try {
        cond = parseExpr(c.trigger);
        const allowed = new Set<string>([...CLUB_VARS, ...(c.target === 'ourPlayer' ? PLAYER_VARS : [])]);
        for (const v of exprVars(cond)) if (!allowed.has(v) && !v.startsWith('flag.')) bad.push(`trigger 변수 ${v}`);
      } catch (e) {
        bad.push(`trigger 문법: ${(e as Error).message}`);
      }
    }
    if (bad.length || !cond) {
      errors.push(`${where}: ${bad.join(', ')}`);
      continue;
    }
    seen.add(c.id);
    const used = new Set<EffectType>(c.choices.flatMap((ch) => [...ch.effects, ...(ch.outcomes ?? []).flatMap((o) => o.effects)].map((e) => e.type)));
    const missing = [...used].filter((t) => !CONNECTED.has(t));
    cards.push({ ...c, cond, inactive: missing.length ? `연결 전 효과: ${missing.join('·')}` : null });
  }
  return { cards, errors };
}

const LOADED = parseCards(raw);
export const CARD_ERRORS = LOADED.errors;
export const CARDS: readonly LoadedCard[] = LOADED.cards;
export const cardById = (id: string) => CARDS.find((c) => c.id === id) ?? null;

// ───────── 후보 선택(순수 함수) ─────────

export interface CardHistory {
  cardId: string;
  playerId: number | null;
  week: number;
  season: number;
}

export interface Candidate {
  card: Pick<EventCard, 'id' | 'category' | 'priority' | 'weight' | 'cooldownWeeks' | 'seasonCap'>;
  playerId: number | null;
  /** 연쇄로 예약된 카드(그 주 우선 후보) */
  spawned?: boolean;
}

/** 쿨다운·시즌 상한·같은 선수 4주로 거른다 */
export function passesLimits(c: Candidate, history: readonly CardHistory[], week: number, season: number): boolean {
  if (c.spawned) return true;
  const same = history.filter((h) => h.cardId === c.card.id);
  if (same.some((h) => week - h.week < c.card.cooldownWeeks)) return false;
  if (same.filter((h) => h.season === season).length >= c.card.seasonCap) return false;
  if (c.playerId !== null && history.some((h) => h.playerId === c.playerId && week - h.week < E.playerCooldownWeeks)) return false;
  return true;
}

/**
 * 후보 선택(D-193·D-203 (4)): 연쇄·우선 카드가 있으면 그중 가중 추첨, 없으면 25% 공란 추첨 → 가중 추첨(직전 주 같은 분류 ×0.3).
 * 난수는 이벤트 스트림에서만 받는다.
 */
export function pickCandidate(cands: readonly Candidate[], rng: Rng, lastCategory: string | null): { pick: Candidate | null; empty: boolean } {
  if (!cands.length) return { pick: null, empty: false };
  const weighted = (list: readonly Candidate[]) => {
    const w = list.map((c) => c.card.weight * (c.card.category === lastCategory ? E.sameCategoryWeight : 1));
    const total = w.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    for (let i = 0; i < list.length; i++) if ((r -= w[i]!) < 0) return list[i]!;
    return list[list.length - 1]!;
  };
  // EV-2(D-205 (9)): 카드 가중치로 카드를 고른 뒤 그 카드의 대상 중 하나를 고른다(대상 수가 가중치를 키우지 않게)
  const byCard = (list: readonly Candidate[]) => {
    const groups = new Map<string, Candidate[]>();
    for (const c of list) groups.set(c.card.id, [...(groups.get(c.card.id) ?? []), c]);
    const reps = [...groups.values()].map((g) => g[0]!);
    const rep = weighted(reps);
    const g = groups.get(rep.card.id)!;
    return g.length === 1 ? g[0]! : g[rng.int(0, g.length - 1)]!;
  };
  const urgent = cands.filter((c) => c.spawned || c.card.priority);
  if (urgent.length) return { pick: byCard(urgent), empty: false };
  if (rng.next() < E.emptyShare) return { pick: null, empty: true };
  return { pick: byCard(cands), empty: false };
}
