// 조직·직원·팀 처리량 (03 문서, D-020~D-028). 순수 규칙만 둔다.
import { addDays, makeDate } from './calendar';
import { MANAGER } from './config';
import { stableNormal, type Rng } from './rng';

export type TeamKey = 'ops' | 'scout' | 'analysis' | 'dev' | 'medical' | 'marketing' | 'pr' | 'partnership' | 'merch' | 'facility' | 'admin';
export type Division = 'baseball' | 'business';
export type StaffTitle = '비서' | '단장' | '사업본부장' | '팀장' | '팀원' | '감독' | '수석코치' | '코치';

export interface TeamDef {
  key: TeamKey;
  name: string;
  division: Division;
  defaultMembers: number;
  memberLabel: string;
  /** 정기 업무(주당 WP): 시즌 / 스토브리그 (D-028) */
  upkeep: { season: number; stove: number };
}

/** 03 문서 조직 구성 (D-021, D-046: 스카우트 7명) */
export const TEAMS: readonly TeamDef[] = [
  { key: 'ops', name: '운영팀', division: 'baseball', defaultMembers: 4, memberLabel: '팀원', upkeep: { season: 8, stove: 4 } },
  { key: 'scout', name: '스카우트팀', division: 'baseball', defaultMembers: 7, memberLabel: '스카우트', upkeep: { season: 10, stove: 5 } },
  { key: 'analysis', name: '전력분석팀', division: 'baseball', defaultMembers: 4, memberLabel: '분석원', upkeep: { season: 12, stove: 4 } },
  { key: 'dev', name: '육성팀', division: 'baseball', defaultMembers: 3, memberLabel: '팀원', upkeep: { season: 8, stove: 4 } },
  { key: 'medical', name: '컨디셔닝·메디컬팀', division: 'baseball', defaultMembers: 6, memberLabel: '트레이너', upkeep: { season: 30, stove: 15 } },
  { key: 'marketing', name: '마케팅팀', division: 'business', defaultMembers: 4, memberLabel: '팀원', upkeep: { season: 10, stove: 5 } },
  { key: 'pr', name: '홍보팀', division: 'business', defaultMembers: 3, memberLabel: '팀원', upkeep: { season: 8, stove: 6 } },
  { key: 'partnership', name: '사업제휴팀', division: 'business', defaultMembers: 3, memberLabel: '팀원', upkeep: { season: 5, stove: 5 } },
  { key: 'merch', name: '상품팀', division: 'business', defaultMembers: 2, memberLabel: '팀원', upkeep: { season: 5, stove: 3 } },
  { key: 'facility', name: '구장시설팀', division: 'business', defaultMembers: 3, memberLabel: '팀원', upkeep: { season: 10, stove: 6 } },
  { key: 'admin', name: '경영지원팀', division: 'business', defaultMembers: 4, memberLabel: '팀원', upkeep: { season: 10, stove: 10 } },
];

export const teamDef = (key: TeamKey) => TEAMS.find((t) => t.key === key)!;

/** 코칭스태프 15명 (D-022) */
export const COACH_SLOTS: ReadonlyArray<{ part: string; title: StaffTitle; squad: '1군' | '퓨처스' }> = [
  { part: '감독', title: '감독', squad: '1군' },
  { part: '수석', title: '수석코치', squad: '1군' },
  { part: '투수', title: '코치', squad: '1군' },
  { part: '불펜', title: '코치', squad: '1군' },
  { part: '타격', title: '코치', squad: '1군' },
  { part: '보조타격', title: '코치', squad: '1군' },
  { part: '수비', title: '코치', squad: '1군' },
  { part: '작전·주루(1루)', title: '코치', squad: '1군' },
  { part: '작전·주루(3루)', title: '코치', squad: '1군' },
  { part: '배터리', title: '코치', squad: '1군' },
  { part: '퓨처스 감독', title: '코치', squad: '퓨처스' },
  { part: '퓨처스 투수', title: '코치', squad: '퓨처스' },
  { part: '퓨처스 타격', title: '코치', squad: '퓨처스' },
  { part: '퓨처스 수비', title: '코치', squad: '퓨처스' },
  { part: '퓨처스 주루·배터리', title: '코치', squad: '퓨처스' },
];

/** 직급별 능력 항목 (03 문서 직원 능력) */
export const ABILITY_KEYS: Record<StaffTitle, string[]> = {
  비서: ['schedule', 'organize', 'liaison'],
  단장: ['judgment', 'management', 'coordination', 'expertise'],
  사업본부장: ['judgment', 'management', 'coordination', 'expertise'],
  팀장: ['judgment', 'management', 'execution', 'expertise'],
  팀원: ['execution', 'expertise'],
  // 4c-2b(D-172): 감독 능력치 8개(engine/manager.ts MANAGER_KEYS)
  감독: ['hitting', 'pitching', 'fieldRun', 'tactics', 'authority', 'leadership', 'condition', 'development'],
  수석코치: ['coaching', 'communication', 'management'],
  코치: ['coaching', 'communication'],
};

export const ABILITY_LABEL: Record<string, string> = {
  schedule: '일정 관리력',
  organize: '정리력',
  liaison: '대인 조율력',
  judgment: '판단력',
  management: '관리력',
  coordination: '조정력',
  expertise: '전문성',
  execution: '실행력',
  hitting: '타격 지휘',
  pitching: '투수 운용',
  fieldRun: '수비·주루 지휘',
  tactics: '작전',
  leadership: '리더십',
  condition: '컨디션 관리',
  development: '육성',
  authority: '권위',
  coaching: '지도력',
  communication: '소통력',
};

export interface StaffMember {
  id: number;
  name: string;
  birthDate: string;
  title: StaffTitle;
  /** 소속 팀(팀장·팀원). 본부장은 담당 부문, 코치는 담당 파트 */
  team: TeamKey | null;
  division: Division | null;
  part: string | null;
  clubId: number | null;
  salary: number;
  contractYears: number;
  abilities: Record<string, number>;
  /** 감독 만족도 등 관계 지표 (0~100) */
  satisfaction: number;
  /** 4c-2b 감독만: 성향(0~100), 신뢰도, 팀 기준선(공격·수비), 최근 결정 */
  manager?: ManagerState;
}

export interface ManagerState {
  smallBall: number;
  quickHook: number;
  trust: number;
  baseOff: number;
  baseDef: number;
  recent: Array<{ date: string; side: 'off' | 'def'; kinds: string[]; inning: number; delta: number; score: number }>;
  /** EV-1(D-203 (6)): 구단 사건 카드로 바뀐 신뢰도(출처 기록) */
  events?: Array<{ date: string; delta: number; source: string }>;
}

/** ASSUMPTION(D-076): 직급별 기준 연봉. 능력 평균 50 기준, 능력에 따라 ×0.6~×1.8 */
export const STAFF_BASE_SALARY: Record<StaffTitle, number> = {
  비서: 50_000_000,
  단장: 250_000_000,
  사업본부장: 200_000_000,
  팀장: 100_000_000,
  팀원: 50_000_000,
  감독: 400_000_000,
  수석코치: 200_000_000,
  코치: 130_000_000,
};

export function abilityAvg(s: Pick<StaffMember, 'abilities' | 'title'>): number {
  const keys = ABILITY_KEYS[s.title].filter((k) => k !== 'authority');
  return keys.reduce((a, k) => a + (s.abilities[k] ?? 50), 0) / keys.length;
}

export function staffSalary(title: StaffTitle, avg: number): number {
  const f = Math.max(0.6, Math.min(1.8, Math.exp((avg - 50) / 25)));
  return Math.round((STAFF_BASE_SALARY[title] * f) / 1_000_000) * 1_000_000;
}

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍'];
const GIVEN = ['민수', '지훈', '현우', '성민', '준호', '영진', '상훈', '재원', '동현', '수진', '은영', '지은', '혜진', '태영', '경민', '승우', '정훈', '미경', '소영', '대성', '우진', '하늘', '세영', '진우'];
const clamp = (v: number) => Math.round(Math.max(15, Math.min(95, v)));

export function makeStaff(rng: Rng, id: number, title: StaffTitle, clubId: number | null, opts: { team?: TeamKey | null; division?: Division | null; part?: string | null; mean?: number; year?: number } = {}): StaffMember {
  const mean = opts.mean ?? 50;
  const abilities: Record<string, number> = {};
  for (const k of ABILITY_KEYS[title]) abilities[k] = clamp(rng.normal(mean, 12));
  const age = title === '팀원' ? rng.int(26, 45) : title === '비서' ? rng.int(26, 40) : rng.int(36, 62);
  const year = opts.year ?? 2026;
  const s: StaffMember = {
    id,
    name: rng.pick(SURNAMES) + rng.pick(GIVEN),
    birthDate: addDays(makeDate(year - age, 1, 1), rng.int(0, 364)),
    title,
    team: opts.team ?? null,
    division: opts.division ?? null,
    part: opts.part ?? null,
    clubId,
    salary: 0,
    contractYears: rng.int(1, 3),
    abilities,
    satisfaction: 60,
  };
  // 4c-2b(D-172): 감독은 성향 2개(0~100 고르게)와 신뢰도 50으로 시작한다
  if (title === '감독') s.manager = { smallBall: rng.int(0, 100), quickHook: rng.int(0, 100), trust: 50, baseOff: 0, baseDef: 0, recent: [] };
  s.salary = staffSalary(title, abilityAvg(s));
  return s;
}

/**
 * 구단 시작 조직 (D-023): 비서·단장·사업본부장·코칭스태프는 재직, 팀장 2~4자리는 공석,
 * 팀원은 기본 인원의 60~80%.
 */
export function generateOrganization(rng: Rng, clubId: number, nextId: () => number, year: number): StaffMember[] {
  const out: StaffMember[] = [];
  out.push(makeStaff(rng, nextId(), '비서', clubId, { year }));
  out.push(makeStaff(rng, nextId(), '단장', clubId, { division: 'baseball', year }));
  out.push(makeStaff(rng, nextId(), '사업본부장', clubId, { division: 'business', year }));
  const vacant = new Set(rng.shuffle(TEAMS.map((t) => t.key)).slice(0, rng.int(2, 4)));
  for (const t of TEAMS) {
    if (!vacant.has(t.key)) out.push(makeStaff(rng, nextId(), '팀장', clubId, { team: t.key, division: t.division, year }));
    const n = Math.max(1, Math.round(t.defaultMembers * (0.6 + rng.next() * 0.2)));
    for (let i = 0; i < n; i++) out.push(makeStaff(rng, nextId(), '팀원', clubId, { team: t.key, division: t.division, mean: 46, year }));
  }
  for (const slot of COACH_SLOTS) out.push(makeStaff(rng, nextId(), slot.title, clubId, { part: slot.part, year }));
  return out;
}

/** 채용 시장 후보: 팀장 6, 팀원 14, 코치 4, 감독 3, 본부장 1, 비서 1 (매달 새로 만든다) */
export function generateCandidates(rng: Rng, nextId: () => number, year: number): StaffMember[] {
  const out: StaffMember[] = [];
  const team = () => rng.pick(TEAMS);
  for (let i = 0; i < 6; i++) {
    const t = team();
    out.push(makeStaff(rng, nextId(), '팀장', null, { team: t.key, division: t.division, mean: 52, year }));
  }
  for (let i = 0; i < 14; i++) {
    const t = team();
    out.push(makeStaff(rng, nextId(), '팀원', null, { team: t.key, division: t.division, mean: 50, year }));
  }
  for (let i = 0; i < 4; i++) out.push(makeStaff(rng, nextId(), '코치', null, { part: rng.pick(COACH_SLOTS.filter((c) => c.title === '코치')).part, mean: 52, year }));
  // 4c-2b(D-172 (5)): 감독 후보 매달 3명
  for (let i = 0; i < MANAGER.candidates; i++) out.push(makeStaff(rng, nextId(), '감독', null, { part: '감독', mean: MANAGER.candidateMean, year }));
  const div = rng.chance(0.5) ? 'baseball' : 'business';
  out.push(makeStaff(rng, nextId(), div === 'baseball' ? '단장' : '사업본부장', null, { division: div, mean: 54, year }));
  out.push(makeStaff(rng, nextId(), '비서', null, { mean: 55, year }));
  for (const c of out) c.contractYears = rng.int(1, 3);
  return out;
}

/** 구단이 아는 직원 평가(평판). 실제 능력에 고정 오차를 더한 20~80 값 */
export function observedAbility(seed: string, s: StaffMember, key: string, known: boolean): number {
  const v = (s.abilities[key] ?? 50) + stableNormal(seed, 'staff-obs', s.id, key) * (known ? 3 : 7);
  return Math.round((20 + Math.max(0, Math.min(100, v)) * 0.6) / 5) * 5;
}

// ───────── 팀 처리량 (D-026·D-027) ─────────

export interface TeamCapacity {
  team: TeamKey;
  leader: StaffMember | null;
  /** 팀장이 없을 때 겸임하는 본부장 */
  acting: StaffMember | null;
  members: StaffMember[];
  contribution: number;
  managementFactor: number;
  coordinationBonus: number;
  weeklyWp: number;
  upkeep: number;
}

export const contribution = (s: StaffMember) => 5 + (s.abilities.execution ?? 50) / 10;

export function teamCapacity(staff: StaffMember[], team: TeamKey, mode: 'season' | 'stove'): TeamCapacity {
  const def = teamDef(team);
  const leader = staff.find((s) => s.title === '팀장' && s.team === team) ?? null;
  const head = staff.find((s) => (def.division === 'baseball' ? s.title === '단장' : s.title === '사업본부장')) ?? null;
  const members = staff.filter((s) => s.title === '팀원' && s.team === team);
  let managementFactor: number;
  let total = 0;
  let span: number;
  if (leader) {
    managementFactor = 0.8 + (leader.abilities.management ?? 50) * 0.004;
    span = 4 + Math.floor((leader.abilities.management ?? 50) / 20);
    total += contribution(leader);
  } else if (head) {
    managementFactor = (0.8 + (head.abilities.management ?? 50) * 0.004) * 0.7;
    span = 4 + Math.floor((head.abilities.management ?? 50) / 20);
  } else {
    // 03 문서: 팀장·본부장 모두 없으면 정기 업무만 팀원 기여 50%(아래 한 번만 줄인다). ① 정리: 예전에는 관리 보정 0.5·관리 범위 0·기여 50%가 겹쳐 12.5%였다
    managementFactor = 1;
    span = Number.POSITIVE_INFINITY;
  }
  members.forEach((m, i) => (total += contribution(m) * (i < span ? 1 : 0.5)));
  if (!leader && !head) total *= 0.5; // 팀장·본부장 모두 없으면 정기 업무만 절반 효율로
  const coordinationBonus = head ? Math.min(0.1, (head.abilities.coordination ?? 50) * 0.001) : 0;
  return {
    team,
    leader,
    acting: leader ? null : head,
    members,
    contribution: total,
    managementFactor,
    coordinationBonus,
    weeklyWp: Math.round(total * managementFactor * (1 + coordinationBonus)),
    upkeep: def.upkeep[mode],
  };
}

/** 업무 처리량 비용 (D-028·D-049). 직접 행동은 이 값의 50%를 쓴다. */
export const TASK_WP = {
  faRound: 10,
  salaryTalk: 4,
  foreignContract: 10,
  hire: 6,
  // ASSUMPTION(D-095): 40인 초과 명단 정리안 준비
  rosterTrim: 2,
  // ASSUMPTION(D-131): 트레이드 1회 협상(직접 세션은 50%)
  tradeRound: 10,
} as const;

/** 스카우트팀 평가 정확도: 팀장·스카우트의 전문성 평균으로 관찰 오차 배율을 정한다(06 문서 연결, D-076). */
export function scoutingSdScale(staff: StaffMember[]): number {
  const scouts = staff.filter((s) => s.team === 'scout' && (s.title === '팀장' || s.title === '팀원'));
  if (scouts.length === 0) return 1.5;
  const avg = scouts.reduce((a, s) => a + (s.abilities.expertise ?? 50), 0) / scouts.length;
  const coverage = Math.min(1, scouts.length / 8);
  return Math.max(0.6, 1.35 - 0.6 * (avg / 100) - 0.25 * coverage);
}

/** 비서 일정 관리력에 따른 알림 범위(일). 비서가 없으면 당일만 (03 문서 비서) */
export function secretaryLookaheadDays(secretary: StaffMember | null): number {
  if (!secretary) return 0;
  return 5 + Math.round(((secretary.abilities.schedule ?? 50) / 100) * 16);
}

/** 해고 보상금: 남은 계약 연수 연봉의 50% (ASSUMPTION, D-076) */
export function severance(s: StaffMember): number {
  return Math.round((s.salary * Math.max(1, s.contractYears) * 0.5) / 1_000_000) * 1_000_000;
}
