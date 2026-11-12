// ③ 구단별 취임 프롤로그(27b v0.2, D-223·D-224·D-238). 장면·미션 정의는 코드가 아니라 data/prologue.json에 둔다.
// 이 모듈은 정의 파일 규격 검사와 장 시기(날짜 기준) 계산만 한다. 미션 판정·건너뛰기 기본 처리는 게임 진행 계층(game/prologue.ts).
import raw from '../data/prologue.json';
import { addDays, type GameDate } from '../calendar';
import { seasonKeyDates } from '../schedule';
import type { CardEffect } from './cards';

/** 미션 종류: 판정은 실제 명령 결과·실제 상태로만 한다(가짜 성공 없음) */
export const MISSIONS = ['answer', 'ack', 'policy', 'franchise', 'advance', 'scout', 'roster', 'cardLive', 'cardDelegation', 'ownFa', 'sponsorMain', 'hireBudget', 'campRoster'] as const;
export type MissionKind = (typeof MISSIONS)[number];
/** 장 건너뛰기 기본 처리(담당자 기본 처리). 없으면 게임의 원래 기본 흐름(운영팀 자체 안건·마감일 기본안)에 맡긴다 */
export const DEFAULTS = ['answer', 'delegateFranchise'] as const;
/** 회견 답변 효과는 결정적 효과만(난수 없이 같은 결과) */
export const ANSWER_EFFECTS = new Set(['FAN_NOW', 'PRESS', 'CHAIRMAN']);
/** 화면 이동 대상(화면 계층 경로 이름) */
export const TARGETS = ['dashboard', 'inbox', 'news', 'players', 'roster', 'market', 'org', 'schedule', 'standings', 'hof', 'business', 'finance'] as const;
/** 대사 자리표시자 */
export const PLACEHOLDERS = ['club', 'clubFull', 'city', 'player', 'manager', 'chairman', 'chairmanLine', 'arrivalLine', 'question', 'reporter', 'goal', 'arc', 'task', 'cash', 'date', 'deadline', 'dismissMisses', 'fanFloor', 'fanWeeks', 'rank', 'roster', 'act'] as const;

export type SceneLine = readonly [speaker: string, text: string];
export type ProloguePart = 'season' | 'winter';

export interface PrologueAnswer {
  id: string;
  label: string;
  text: string;
  effects: CardEffect[];
}

export interface PrologueChapterDef {
  id: string;
  part: ProloguePart;
  title: string;
  /** 시즌편: 'MM-DD' | 'opening' | 'openingWeek' (+Nd·-Nd). 첫 겨울편은 turn */
  from?: string;
  until?: string;
  turn?: number;
  /** 첫 겨울편 미션 기한 턴(없으면 turn과 같음) */
  untilTurn?: number;
  mission: MissionKind;
  default?: (typeof DEFAULTS)[number];
  missionText: string;
  learn: string[];
  targets: string[];
  lines: SceneLine[];
}

export interface ArrivalSceneDef {
  id: string;
  title: string;
  lines: SceneLine[];
}

export interface PrologueClubDef {
  title: string;
  chairman: string;
  question: string;
  chairmanLine: string;
  arrivalLine: string;
  scenes: Record<string, SceneLine[]>;
}

export interface PrologueDef {
  version: number;
  reporter: string;
  answers: PrologueAnswer[];
  answerDefault: string;
  parts: Record<'season' | 'winter' | 'arrival', string>;
  chapters: PrologueChapterDef[];
  arrival: ArrivalSceneDef[];
  clubs: Record<string, PrologueClubDef>;
}

const DATE_TOKEN = /^(?:(\d\d-\d\d)|(opening|openingWeek))(?:([+-])(\d+)d)?$/;

function lineErrors(lines: unknown, where: string): string[] {
  if (!Array.isArray(lines) || !lines.length) return [`${where}: 대사가 비어 있음`];
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!Array.isArray(l) || l.length !== 2 || typeof l[0] !== 'string' || typeof l[1] !== 'string' || !l[1]) out.push(`${where}[${i}]: [화자, 대사] 형식이 아님`);
    else for (const m of `${l[0]} ${l[1]}`.matchAll(/\{(\w+)\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) out.push(`${where}[${i}]: 모르는 자리표시자 {${m[1]}}`);
  });
  return out;
}

/** 정의 파일 규격 검사: 장·미션·기본 처리·시기·대사·답변 효과. 위반이 있으면 프롤로그 전체를 쓰지 않는다 */
export function parsePrologue(input: unknown, clubIds: readonly number[]): { def: PrologueDef | null; errors: string[] } {
  const d = input as PrologueDef;
  const errors: string[] = [];
  if (!d || typeof d !== 'object' || !Array.isArray(d.chapters) || !Array.isArray(d.answers) || !Array.isArray(d.arrival) || !d.clubs) return { def: null, errors: ['프롤로그 정의 형식이 아님'] };
  const ids = new Set<string>();
  for (const c of d.chapters) {
    const w = `장 ${c.id}`;
    if (!c.id || ids.has(c.id)) errors.push(`${w}: ID 중복·없음`);
    ids.add(c.id);
    if (c.part !== 'season' && c.part !== 'winter') errors.push(`${w}: part는 season·winter`);
    if (!(MISSIONS as readonly string[]).includes(c.mission)) errors.push(`${w}: 모르는 미션 ${c.mission}`);
    if (c.default && !(DEFAULTS as readonly string[]).includes(c.default)) errors.push(`${w}: 모르는 기본 처리 ${c.default}`);
    if ((c.mission === 'answer') !== (c.default === 'answer')) errors.push(`${w}: 답변 미션은 기본 처리 answer(기본 답변)와 짝`);
    if ((c.mission === 'franchise') !== (c.default === 'delegateFranchise')) errors.push(`${w}: 간판 외야수 미션은 기본 처리 delegateFranchise와 짝`);
    if (c.part === 'season' && (!DATE_TOKEN.test(c.from ?? '') || !DATE_TOKEN.test(c.until ?? ''))) errors.push(`${w}: 시즌편 시기(from·until) 형식`);
    if (c.part === 'winter' && !(Number.isInteger(c.turn) && c.turn! >= 1 && c.turn! <= 4 && (c.untilTurn === undefined || (Number.isInteger(c.untilTurn) && c.untilTurn >= c.turn! && c.untilTurn <= 4)))) errors.push(`${w}: 첫 겨울편 턴은 1~4(untilTurn ≥ turn)`);
    if (!c.missionText || !Array.isArray(c.learn) || !c.learn.length) errors.push(`${w}: 미션 설명·배우는 것 없음`);
    for (const t of c.targets ?? []) if (!(TARGETS as readonly string[]).includes(t)) errors.push(`${w}: 모르는 화면 ${t}`);
    errors.push(...lineErrors(c.lines, `${w} 대사`));
  }
  const answerIds = new Set(d.answers.map((a) => a.id));
  for (const a of d.answers) for (const e of a.effects ?? []) if (!ANSWER_EFFECTS.has(e.type)) errors.push(`답변 ${a.id}: 회견 답변 효과는 ${[...ANSWER_EFFECTS].join('·')}만(${e.type})`);
  if (!answerIds.has(d.answerDefault)) errors.push(`기본 답변 ${d.answerDefault}이 답변 목록에 없음`);
  if (d.arrival.length !== 3) errors.push('부임 장면은 3개');
  for (const a of d.arrival) errors.push(...lineErrors(a.lines, `부임 장면 ${a.id}`));
  for (const id of clubIds) {
    const c = d.clubs[String(id)];
    if (!c) {
      errors.push(`구단 ${id}: 프롤로그 없음`);
      continue;
    }
    if (!c.title || !c.chairman || !c.question || !c.chairmanLine || !c.arrivalLine) errors.push(`구단 ${id}: 제목·면담 상대·질문·회장 대사 없음`);
    for (const [k, lines] of Object.entries(c.scenes ?? {})) {
      if (!ids.has(k)) errors.push(`구단 ${id}: 없는 장 ${k}의 장면`);
      errors.push(...lineErrors(lines, `구단 ${id} ${k}`));
    }
  }
  return { def: errors.length ? null : d, errors };
}

const LOADED = parsePrologue(raw, Object.keys((raw as unknown as PrologueDef).clubs).map(Number));
export const PROLOGUE_ERRORS = LOADED.errors;
export const PROLOGUE: PrologueDef | null = LOADED.def;
export const prologueChapter = (id: string) => PROLOGUE?.chapters.find((c) => c.id === id) ?? null;

/** 시즌편 시기 토큰 → 날짜(첫 시즌 기준). 'opening' = 개막일, 'openingWeek' = 개막 주 월요일 */
export function prologueDate(token: string, season: number): GameDate {
  const m = DATE_TOKEN.exec(token);
  if (!m) throw new Error(`프롤로그 시기 형식: ${token}`);
  const k = seasonKeyDates(season);
  const base = m[1] ? `${season}-${m[1]}` : m[2] === 'opening' ? k.opening : k.openingWeekMonday;
  const n = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
  return addDays(base, n);
}
