// ② 구단 스토리(27·27a, D-222·D-224·D-237). 스토리 정의는 코드가 아니라 data/clubStories.json에 둔다.
// 장(章) 카드는 결정 카드와 같은 형식(선택지·효과·확률 결과)이고 parseCards 규격 검사를 그대로 쓴다.
// 시점(스토리 시즌·날짜 구간·스토브리그 턴), 분기, 결말 조건은 이 모듈이 검사한다.
import raw from '../data/clubStories.json';
import { STORY } from '../config';
import { ageOn, type GameDate } from '../calendar';
import type { ClubId, PlayerId, PlayerTruth } from '../types';
import { overall } from '../worldgen';
import { CARDS, effectErrors, parseCards, PHASES, type CardChoice, type CardEffect, type EventCard, type LoadedCard } from './cards';
import { exprVars, parseExpr, type ExprNode } from './expr';

/** 스토리 배역(가상 인물 → 실제 선수). 스토리 시작 때 정해 저장한다 */
export const ROLES = ['ace', 'closer', 'star', 'captain', 'veteran', 'prospect', 'prospectC', 'prospect2', 'prospect3', 'youngOF', 'franchise', 'bargain'] as const;
export type StoryRole = (typeof ROLES)[number];
export const ROLE_LABEL: Record<StoryRole, string> = { ace: '에이스', closer: '마무리', star: '간판 타자', captain: '캡틴', veteran: '베테랑', prospect: '유망주', prospectC: '유망주 포수', prospect2: '유망주', prospect3: '유망주', youngOF: '신예 외야수', franchise: '간판 외야수', bargain: '2군 거포' };

/** 조건식 변수: 스토리 성적 요약(시즌 마감 때 원시 기록에서 집계)과 현재 시즌 진행 */
export const STORY_VARS = [
  'story.season', 'story.titles', 'story.ksFinals', 'story.ksLosses', 'story.postseasons', 'story.lowSeasons', 'story.profits',
  'story.lastRank', 'story.lastPs', 'story.lastKs', 'story.lastChampion', 'story.psStreak', 'story.ksLossStreak', 'story.missStreak', 'story.lowStreak',
  'story.homegrown', 'story.ageDrop', 'story.effRank', 'story.inPs', 'story.inKs', 'story.chairman', 'story.branch',
] as const;

/** 스토리 조건식에서 쓰는 구단 변수(스토리 모듈이 직접 계산하는 것만) */
export const STORY_CLUB_VARS = ['club.rank', 'club.fan', 'club.cashEok', 'club.stadiumLevel', 'club.week', 'club.turn'] as const;

export interface StoryChapterDef {
  id: string;
  act: 1 | 2;
  /** 2막 분기(A·B). 없으면 공통 */
  branch?: string;
  title: string;
  /** season: 스토리 시즌(1~3)의 날짜 구간(MM-DD), stove: 스토리 시즌 offseason(1~2) 뒤 스토브리그 턴 구간 */
  phase: 'season' | 'stove';
  season?: number;
  from?: string;
  to?: string;
  offseason?: number;
  turns?: [number, number];
  /** 추가 조건식(구단·스토리 변수, story.flag.*, cast.*) */
  cond?: string;
  /** 대상: club 또는 배역 */
  role: 'club' | StoryRole;
  default: string;
  /** AI 구단 선택: 운영 상태 → 선택지(없으면 기본) */
  ai?: Partial<Record<'contend' | 'middle' | 'rebuild' | 'austerity', string>>;
  texts: string[];
  choices: CardChoice[];
}

export interface StoryEndingDef {
  id: string;
  title: string;
  kind: 'success' | 'neutral' | 'fail' | 'variant';
  cond: string;
  /** 결말 판정 시즌 전이라도 조건을 채우면 바로 결말(예: 매지션스 우승) */
  early?: boolean;
  effects: CardEffect[];
  epilogue: string;
  /** 결말 뒤 여는 다음 과제 이름(내용은 후속 작성, D-224 (2)) */
  next?: string;
}

export interface StoryArcDef {
  clubId: ClubId;
  arc: string;
  title: string;
  task: string;
  synopsis: string;
  /** 1시즌 마감 때 2막 분기: 위에서부터 조건을 채우는 첫 분기 */
  transition: Array<{ branch: string; cond: string; text: string }>;
  chapters: StoryChapterDef[];
  endings: StoryEndingDef[];
}

export interface LoadedArc extends Omit<StoryArcDef, 'chapters' | 'endings' | 'transition'> {
  chapters: Array<StoryChapterDef & { card: LoadedCard; condNode: ExprNode | null }>;
  endings: Array<StoryEndingDef & { condNode: ExprNode }>;
  transition: Array<{ branch: string; cond: string; text: string; condNode: ExprNode }>;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** 조건식에 쓸 수 있는 변수인지 */
export function storyVarAllowed(v: string): boolean {
  if ((STORY_CLUB_VARS as readonly string[]).includes(v) || (STORY_VARS as readonly string[]).includes(v)) return true;
  if (/^story\.flag\.[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return true;
  const m = /^cast\.([A-Za-z0-9]+)(\.(starter|first))?$/.exec(v);
  return !!m && (ROLES as readonly string[]).includes(m[1]!);
}

function condErrors(src: unknown, where: string): { node: ExprNode | null; errors: string[] } {
  if (!isText(src)) return { node: null, errors: [`${where}: 조건식 필요`] };
  try {
    const node = parseExpr(src);
    const bad = [...exprVars(node)].filter((v) => !storyVarAllowed(v));
    return { node, errors: bad.map((v) => `${where}: 변수 ${v}`) };
  } catch (e) {
    return { node: null, errors: [`${where}: 문법 ${(e as Error).message}`] };
  }
}

/** 장 정의 → 결정 카드 형식(규격 검사·효과 적용·카드 화면을 결정 카드와 같이 쓴다) */
const asCard = (ch: StoryChapterDef): EventCard => ({
  id: ch.id,
  type: 'decision',
  category: 'story',
  priority: true,
  phases: [...PHASES],
  target: ch.role === 'club' ? 'club' : 'ourPlayer',
  trigger: '1',
  weight: 1,
  cooldownWeeks: 1,
  seasonCap: 1,
  delegateTeam: null,
  delegateDefault: ch.default,
  texts: ch.texts,
  choices: ch.choices,
});

/** 스토리 정의 규격 검사. 규격에 맞지 않는 구단 스토리는 통째로 건너뛰고 오류로 남긴다 */
export function parseStories(input: unknown): { arcs: LoadedArc[]; errors: string[] } {
  const arcs: LoadedArc[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) return { arcs, errors: ['스토리 정의는 배열이어야 합니다.'] };
  const clubs = new Set<number>();
  const allIds = new Set<string>(CARDS.map((c) => c.id));
  for (const a of input as StoryArcDef[]) for (const ch of a?.chapters ?? []) if (isText(ch?.id)) allIds.add(ch.id);
  const seenIds = new Set<string>();
  for (const [i, a] of (input as StoryArcDef[]).entries()) {
    const where = isText(a?.arc) ? a.arc : `#${i}`;
    const bad: string[] = [];
    if (!(Number.isInteger(a?.clubId) && a.clubId >= 1 && a.clubId <= 10)) bad.push('clubId');
    else if (clubs.has(a.clubId)) bad.push('clubId 중복');
    for (const k of ['arc', 'title', 'task', 'synopsis'] as const) if (!isText(a?.[k])) bad.push(k);
    const chapters: LoadedArc['chapters'] = [];
    if (!Array.isArray(a?.chapters) || a.chapters.length < 4) bad.push('chapters(4장 이상)');
    else {
      for (const ch of a.chapters) {
        const w = `${where}/${ch?.id ?? '?'}`;
        if (!isText(ch?.id) || seenIds.has(ch.id) || CARDS.some((c) => c.id === ch.id)) { bad.push(`${w}: id`); continue; }
        seenIds.add(ch.id);
        if (ch.act !== 1 && ch.act !== 2) bad.push(`${w}: act`);
        if (ch.branch !== undefined && !(isText(ch.branch) && ch.act === 2)) bad.push(`${w}: branch(2막만)`);
        if (!isText(ch.title)) bad.push(`${w}: title`);
        if (ch.phase === 'season') {
          if (!(Number.isInteger(ch.season) && ch.season! >= 1 && ch.season! <= STORY.endingSeason)) bad.push(`${w}: season`);
          if (!(MD.test(ch.from ?? '') && MD.test(ch.to ?? '') && ch.from! <= ch.to!)) bad.push(`${w}: from·to`);
        } else if (ch.phase === 'stove') {
          if (!(Number.isInteger(ch.offseason) && ch.offseason! >= 1 && ch.offseason! < STORY.endingSeason)) bad.push(`${w}: offseason`);
          if (!(Array.isArray(ch.turns) && ch.turns.length === 2 && ch.turns.every((t) => Number.isInteger(t) && t >= 1 && t <= 4) && ch.turns[0] <= ch.turns[1])) bad.push(`${w}: turns`);
        } else bad.push(`${w}: phase`);
        if (ch.act === 1 && !((ch.phase === 'season' && ch.season === 1) || (ch.phase === 'stove' && ch.offseason === 1))) bad.push(`${w}: 1막은 1시즌·첫 스토브리그`);
        if (!(ch.role === 'club' || (ROLES as readonly string[]).includes(ch.role))) bad.push(`${w}: role`);
        if (ch.ai !== undefined && !Object.values(ch.ai).every((v) => ch.choices?.some((c) => c.id === v))) bad.push(`${w}: ai 선택지`);
        let condNode: ExprNode | null = null;
        if (ch.cond !== undefined) {
          const r = condErrors(ch.cond, `${w} cond`);
          condNode = r.node;
          bad.push(...r.errors);
        }
        // 스토리 플래그는 선택지 flags로 남긴다(FLAG·SPAWN·DIRECTIVE는 결정 카드 전용)
        if ((ch.choices ?? []).some((c) => [...(c?.effects ?? []), ...(c?.outcomes ?? []).flatMap((o) => o?.effects ?? [])].some((x) => ['FLAG', 'SPAWN', 'DIRECTIVE'].includes(x?.type)))) bad.push(`${w}: FLAG·SPAWN·DIRECTIVE 대신 선택지 flags`);
        for (const x of (ch.choices ?? []).flatMap((c) => [...(c?.effects ?? []), ...(c?.outcomes ?? []).flatMap((o) => o?.effects ?? [])])) if (x?.role !== undefined && !(ROLES as readonly string[]).includes(x.role)) bad.push(`${w}: 효과 role ${x.role}`);
        const parsed = parseCards([asCard(ch)], { minTexts: 2, extraIds: allIds });
        if (parsed.errors.length) bad.push(...parsed.errors.map((e) => `${w}: ${e}`));
        else if (parsed.cards[0]!.inactive) bad.push(`${w}: ${parsed.cards[0]!.inactive}`);
        else chapters.push({ ...ch, card: parsed.cards[0]!, condNode });
      }
    }
    const transition: LoadedArc['transition'] = [];
    if (!Array.isArray(a?.transition) || !a.transition.length) bad.push('transition');
    else for (const t of a.transition) {
      const r = condErrors(t?.cond, `${where} transition ${t?.branch}`);
      bad.push(...r.errors);
      if (!isText(t?.branch) || !isText(t?.text)) bad.push(`${where} transition 필드`);
      else if (r.node) transition.push({ ...t, condNode: r.node });
    }
    const branches = new Set(transition.map((t) => t.branch));
    for (const ch of chapters) if (ch.branch && !branches.has(ch.branch)) bad.push(`${where}/${ch.id}: 없는 분기 ${ch.branch}`);
    const endings: LoadedArc['endings'] = [];
    if (!Array.isArray(a?.endings) || a.endings.length < 3) bad.push('endings(3개 이상)');
    else for (const e of a.endings) {
      const w = `${where} ending ${e?.id ?? '?'}`;
      if (!isText(e?.id) || !isText(e?.title) || !isText(e?.epilogue) || !['success', 'neutral', 'fail', 'variant'].includes(e?.kind)) bad.push(`${w}: 필드`);
      if (!Array.isArray(e?.effects)) bad.push(`${w}: effects`);
      else for (const x of e.effects) bad.push(...effectErrors(x, w, allIds).filter(Boolean));
      if (Array.isArray(e?.effects) && e.effects.some((x) => ['SPAWN', 'REST', 'HEAL', 'SUSPEND', 'COND', 'INJ_RISK', 'DIRECTIVE', 'CONTRACT', 'MOOD'].includes(x?.type))) bad.push(`${w}: 결말 효과는 구단 단위만`);
      const r = condErrors(e?.cond, w);
      bad.push(...r.errors);
      if (r.node && isText(e?.id)) endings.push({ ...e, condNode: r.node });
    }
    if (endings.length && endings[endings.length - 1]!.cond.trim() !== '1') bad.push(`${where}: 마지막 결말은 조건 '1'(항상)`);
    if (bad.length) {
      errors.push(`${where}: ${bad.join(', ')}`);
      continue;
    }
    clubs.add(a.clubId);
    arcs.push({ clubId: a.clubId, arc: a.arc, title: a.title, task: a.task, synopsis: a.synopsis, transition, chapters, endings });
  }
  return { arcs, errors };
}

const LOADED = parseStories(raw);
export const STORY_ERRORS = LOADED.errors;
export const STORIES: readonly LoadedArc[] = LOADED.arcs;
export const arcOf = (clubId: ClubId) => STORIES.find((a) => a.clubId === clubId) ?? null;
export const storyChapter = (id: string) => {
  for (const a of STORIES) {
    const ch = a.chapters.find((c) => c.id === id);
    if (ch) return { arc: a, chapter: ch };
  }
  return null;
};
/** 결정 카드·스토리 카드 공용 조회 */
export const findCard = (id: string): LoadedCard | null => CARDS.find((c) => c.id === id) ?? storyChapter(id)?.chapter.card ?? null;

// ───────── 배역(D-237 (2)) ─────────

/**
 * 스토리 인물 중 선수 배역을 그 구단 실제 선수에게 맡긴다(공개 능력·나이·포지션만, 히든 값은 쓰지 않는다).
 * 같은 선수가 두 배역을 맡지 않는다. 맞는 선수가 없으면 배역 없음(그 배역 장은 건너뛴다).
 */
export function pickCast(players: readonly PlayerTruth[], clubId: ClubId, date: GameDate, franchiseId: PlayerId | null): Partial<Record<StoryRole, PlayerId>> {
  const mine = players.filter((p) => p.clubId === clubId && !p.retired).sort((a, b) => overall(b) - overall(a) || a.id - b.id);
  const age = (p: PlayerTruth) => ageOn(p.birthDate, date);
  const used = new Set<PlayerId>();
  const out: Partial<Record<StoryRole, PlayerId>> = {};
  const take = (role: StoryRole, list: PlayerTruth[]) => {
    const p = list.find((x) => !used.has(x.id));
    if (!p) return;
    used.add(p.id);
    out[role] = p.id;
  };
  const hitters = mine.filter((p) => !p.isPitcher);
  const domestic = mine.filter((p) => p.origin === 'domestic');
  // 간판 외야수 첫 안건(D-215): 미계약 상태로 캠프를 맞으므로 소속과 무관하게 맡긴다
  if (franchiseId !== null && players.some((p) => p.id === franchiseId && !p.retired)) {
    used.add(franchiseId);
    out.franchise = franchiseId;
  } else take('franchise', domestic.filter((p) => !p.isPitcher && ['LF', 'CF', 'RF'].includes(p.position)));
  take('ace', domestic.filter((p) => p.isPitcher && p.position === 'SP'));
  take('closer', domestic.filter((p) => p.isPitcher && p.position === 'RP' && age(p) <= 30));
  take('star', domestic.filter((p) => !p.isPitcher && age(p) <= 31));
  // 캡틴: 상위 타자 12명 중 가장 나이 많은 국내 선수, 베테랑: 상위 20명 중 가장 나이 많은 국내 선수
  take('captain', hitters.slice(0, 12).filter((p) => p.origin === 'domestic' && age(p) >= 32).sort((a, b) => age(b) - age(a) || a.id - b.id));
  take('veteran', mine.slice(0, 20).filter((p) => p.origin === 'domestic' && age(p) >= 33).sort((a, b) => age(b) - age(a) || a.id - b.id));
  const young = domestic.filter((p) => age(p) <= STORY.prospectAge);
  take('prospectC', young.filter((p) => !p.isPitcher && p.position === 'C'));
  take('prospect', young);
  take('youngOF', young.filter((p) => !p.isPitcher && ['LF', 'CF', 'RF'].includes(p.position)));
  take('prospect2', young);
  take('prospect3', young);
  // 저평가 발굴: 2군 국내 타자 중 장타 능력 최고(2군에서 기회를 못 받은 선수)
  take('bargain', domestic.filter((p) => !p.isPitcher && p.level === '2군').sort((a, b) => b.batting.power - a.batting.power || a.id - b.id));
  return out;
}
