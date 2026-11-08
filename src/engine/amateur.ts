// 고교·대학 선수 풀 (07 문서, D-084). 경기는 돌리지 않고 능력 기반 시즌 요약 성적을 만든다(B안).
// 능력·잠재력 상위 10% 선수에게만 특징을 살린 개인 업적을 단다.
import { addDays, makeDate } from './calendar';
import { battingLine, pitchingLine } from './history';
import { Rng } from './rng';
import type { BattingTotals, PitchingTotals } from './stats';
import type { HiddenAttributes, Position, PlayerTruth } from './types';
import { hiddenFor, makeName, overall } from './worldgen';

export type SchoolLevel = '고교' | '대학';

export interface AmateurSeason {
  year: number;
  level: SchoolLevel;
  school: string;
  grade: number;
  kind: 'bat' | 'pit';
  totals: BattingTotals | PitchingTotals;
  /** 타자 도루(요약 성적에만 있는 값) */
  SB?: number;
}

export interface AmateurHonor {
  year: number;
  level: SchoolLevel;
  title: string;
}

export interface Amateur {
  id: number;
  name: string;
  birthDate: string;
  level: SchoolLevel;
  school: string;
  /** 다가오는(또는 진행 중인) 학년 */
  grade: number;
  isPitcher: boolean;
  position: Position;
  bats: 'R' | 'L' | 'S';
  throws: 'R' | 'L';
  batting: PlayerTruth['batting'];
  pitching: PlayerTruth['pitching'];
  defense: PlayerTruth['defense'];
  hidden: HiddenAttributes;
  seasons: AmateurSeason[];
  honors: AmateurHonor[];
  status: 'active' | 'drafted' | 'gone';
  draft: { year: number; clubId: number; round: number; pick: number } | null;
}

/** ASSUMPTION(D-084): 풀 규모(07 문서 고교 450·대학 300)와 시즌 출전량 */
export const AMATEUR = {
  hsPerGrade: 150,
  colPerGrade: 75,
  pitcherShare: 0.45,
  hsPa: 110,
  colPa: 150,
  hsAceOuts: 150,
  colAceOuts: 210,
  /** 학교급 평균 상대 능력 */
  hsOpponent: 24,
  colOpponent: 32,
  honorShare: 0.1,
  hsCollegeRate: 0.55,
  growthPerYear: 2.6,
} as const;

const HS_REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '수원', '청주', '전주', '마산', '경주', '포항', '강릉', '제주', '순천', '군산', '천안', '안산', '춘천', '목포'];
const HS_NAMES = ['한빛', '새솔', '동산', '청람', '해송', '백양', '누리', '태백', '미래', '정원', '가람', '솔빛', '신명', '광명', '보람'];
const COLLEGES = ['한빛대', '청람대', '동해대', '서원대', '가람대', '태양대', '백두대', '중앙과학대', '남부대', '해오름대', '누리대', '새길대', '송원대', '은하대', '정명대'];
export const HS_TOURNAMENTS = ['봉황기', '청룡기', '황금사자기', '대통령기'];
export const COL_TOURNAMENTS = ['대학야구 춘계리그', '대학야구 추계리그', '전국대학선수권'];

export function hsSchools(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 40; i++) out.push(`${HS_REGIONS[i % HS_REGIONS.length]} ${HS_NAMES[(i * 7) % HS_NAMES.length]}고`);
  return [...new Set(out)];
}

const clamp = (v: number, lo = 10, hi = 95) => Math.round(Math.max(lo, Math.min(hi, v)));
const POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** 학년에 해당하는 나이(그해 4월 기준) */
function ageFor(level: SchoolLevel, grade: number): number {
  return level === '고교' ? 15 + grade : 18 + grade;
}

/** 새 선수: 재능(잠재력)을 먼저 정하고, 나이가 어릴수록 현재 능력이 잠재력에서 멀다. */
export function makeAmateur(rng: Rng, id: number, level: SchoolLevel, grade: number, schoolYear: number, school: string): Amateur {
  const age = ageFor(level, grade);
  const isPitcher = rng.chance(AMATEUR.pitcherShare);
  const talent = rng.normal(0, 1);
  const remaining = Math.max(0, 24 - age) * AMATEUR.growthPerYear;
  const cur = (bias = 0) => clamp(48 + 9 * talent + bias + rng.normal(0, 6) - remaining);
  const position = isPitcher ? (rng.chance(0.5) ? 'SP' : 'RP') : rng.pick(POSITIONS);
  const pitching = isPitcher ? { stuff: cur(), control: cur(-2), groundball: clamp(rng.normal(50, 12)), stamina: clamp(rng.normal(position === 'SP' ? 62 : 40, 10)) } : null;
  const batting = isPitcher
    ? { contact: clamp(rng.normal(15, 5)), eye: clamp(rng.normal(15, 5)), power: clamp(rng.normal(12, 5)), speed: clamp(rng.normal(35, 10)) }
    : { contact: cur(), eye: cur(-2), power: cur(position === '1B' || position === 'LF' || position === 'RF' ? 3 : -2), speed: clamp(rng.normal(position === 'CF' || position === 'SS' ? 58 : 46, 12)) };
  const current: Record<string, number> = isPitcher ? { stuff: pitching!.stuff, control: pitching!.control, groundball: pitching!.groundball, stamina: pitching!.stamina } : { ...batting };
  const hidden = hiddenFor(rng, age, current);
  // 잠재력은 재능에 묶는다(hiddenFor의 기본 여유보다 크다).
  for (const k of Object.keys(current)) (hidden.potential as Record<string, number>)[k] = clamp(Math.max(current[k]!, 48 + 9 * talent + rng.normal(0, 5) + (k === 'stamina' || k === 'speed' || k === 'groundball' ? current[k]! - 48 : 0)), 10, 99);
  return {
    id,
    name: makeName(rng, 'domestic'),
    birthDate: addDays(makeDate(schoolYear - age, 4, 1), -rng.int(1, 364)),
    level,
    school,
    grade,
    isPitcher,
    position: position as Position,
    bats: rng.chance(0.06) ? 'S' : rng.chance(0.32) ? 'L' : 'R',
    throws: rng.chance(0.25) && !['C', 'SS', '2B', '3B'].includes(position) ? 'L' : 'R',
    batting,
    pitching,
    defense: { fielding: cur(), arm: clamp(rng.normal(52, 12)), range: clamp(rng.normal(50, 12)) },
    hidden,
    seasons: [],
    honors: [],
    status: 'active',
    draft: null,
  };
}

/** 프로 선수와 같은 능력 표현으로 바꾼다(요약 성적·평가용) */
export function asTruth(a: Amateur): PlayerTruth {
  return {
    id: a.id,
    name: a.name,
    birthDate: a.birthDate,
    bats: a.bats,
    throws: a.throws,
    isPitcher: a.isPitcher,
    origin: 'domestic',
    position: a.position,
    clubId: null,
    level: '2군',
    salary: 0,
    contractYears: 0,
    career: { proSeasons: 0, faServiceYears: 0, faEligible: false, franchise: false, foreignRenewals: 0 },
    batting: a.batting,
    pitching: a.pitching,
    defense: a.defense,
    hidden: a.hidden,
  };
}

/** 능력 + 잠재력 점수(상위 10% 판정용) */
export function prospectScore(a: Amateur): number {
  const pot = Object.values(a.hidden.potential).filter((v): v is number => typeof v === 'number');
  const potAvg = pot.length ? pot.reduce((x, y) => x + y, 0) / pot.length : 50;
  return overall(asTruth(a)) * 0.5 + potAvg * 0.5;
}

/** 한 시즌 요약 성적(B안). 출전량은 능력이 높을수록 많다. */
export function seasonLine(rng: Rng, a: Amateur, year: number): AmateurSeason {
  const hs = a.level === '고교';
  const role = Math.max(0.15, Math.min(1, 0.35 + (overall(asTruth(a)) - (hs ? 30 : 38)) / 25));
  const opponent = hs ? AMATEUR.hsOpponent : AMATEUR.colOpponent;
  const base = { year, level: a.level, school: a.school, grade: a.grade };
  if (a.isPitcher) {
    const outs = Math.max(6, Math.round((hs ? AMATEUR.hsAceOuts : AMATEUR.colAceOuts) * role * (a.position === 'SP' ? 1 : 0.55)));
    return { ...base, kind: 'pit', totals: pitchingLine(rng, asTruth(a), outs, a.position === 'SP', false, opponent) };
  }
  const pa = Math.max(8, Math.round((hs ? AMATEUR.hsPa : AMATEUR.colPa) * role));
  const totals = battingLine(rng, asTruth(a), pa, opponent);
  const onBase = totals.H - totals.HR + totals.BB + totals.HBP;
  const SB = Math.max(0, Math.round(onBase * 0.12 * Math.exp((a.batting.speed - 50) / 18) + rng.normal(0, 1)));
  return { ...base, kind: 'bat', totals, SB };
}

/** 한 해 성장: 잠재력 쪽으로 다가간다. */
export function grow(rng: Rng, a: Amateur): void {
  const step = (cur: number, pot: number) => clamp(cur + Math.max(0, Math.min(pot - cur, rng.normal(AMATEUR.growthPerYear, 1.2))));
  const pot = a.hidden.potential as Record<string, number>;
  if (a.pitching) for (const k of ['stuff', 'control'] as const) a.pitching[k] = step(a.pitching[k], pot[k] ?? a.pitching[k]);
  if (!a.isPitcher) for (const k of ['contact', 'eye', 'power'] as const) a.batting[k] = step(a.batting[k], pot[k] ?? a.batting[k]);
  a.defense.fielding = step(a.defense.fielding, a.defense.fielding + 2);
}

/**
 * 그해 개인 업적: 학교급마다 능력·잠재력 상위 10%만 대상(D-084).
 * 투수 → 탈삼진·평균자책·다승, 타자 → 홈런·타율·안타·도루, 학교 → 전국대회 우승과 MVP.
 */
export function awardHonors(rng: Rng, pool: Amateur[], year: number): void {
  for (const level of ['고교', '대학'] as SchoolLevel[]) {
    const all = pool.filter((a) => a.status === 'active' && a.level === level);
    const top = [...all].sort((x, y) => prospectScore(y) - prospectScore(x) || x.id - y.id).slice(0, Math.max(1, Math.round(all.length * AMATEUR.honorShare)));
    const line = (a: Amateur) => a.seasons.find((s) => s.year === year);
    const give = (a: Amateur | undefined, title: string) => a && a.honors.push({ year, level, title: `${year} ${level} ${title}` });
    const leader = <T>(list: Amateur[], fn: (a: Amateur) => T | null, better: (x: T, y: T) => boolean) => {
      let best: Amateur | undefined;
      let bv: T | null = null;
      for (const a of list) {
        const v = fn(a);
        if (v === null) continue;
        if (bv === null || better(v, bv)) (best = a), (bv = v);
      }
      return best;
    };
    const pit = top.filter((a) => a.isPitcher);
    const bat = top.filter((a) => !a.isPitcher);
    const p = (a: Amateur) => line(a)?.totals as PitchingTotals | undefined;
    const b = (a: Amateur) => line(a)?.totals as BattingTotals | undefined;
    const minOuts = level === '고교' ? 60 : 90;
    const minPa = level === '고교' ? 60 : 80;
    give(leader(pit, (a) => p(a)?.K ?? null, (x, y) => x > y), '탈삼진왕');
    give(leader(pit, (a) => (p(a) && p(a)!.OUTS >= minOuts ? (27 * p(a)!.ER) / p(a)!.OUTS : null), (x, y) => x < y), '평균자책 1위');
    give(leader(pit, (a) => p(a)?.W ?? null, (x, y) => x > y), '다승왕');
    give(leader(bat, (a) => b(a)?.HR ?? null, (x, y) => x > y), '홈런왕');
    give(leader(bat, (a) => (b(a) && b(a)!.PA >= minPa && b(a)!.AB > 0 ? b(a)!.H / b(a)!.AB : null), (x, y) => x > y), '타격왕');
    give(leader(bat, (a) => b(a)?.H ?? null, (x, y) => x > y), '최다 안타');
    give(leader(bat, (a) => line(a)?.SB ?? null, (x, y) => x > y), '도루왕');
    // 전국대회: 상위 선수가 많은 학교가 강하다. 우승 학교의 최고 상위 선수가 MVP.
    const strength = new Map<string, number>();
    for (const a of top) strength.set(a.school, (strength.get(a.school) ?? 0) + prospectScore(a));
    const contenders = [...strength.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 6);
    for (const t of level === '고교' ? HS_TOURNAMENTS : COL_TOURNAMENTS) {
      if (!contenders.length) break;
      const total = contenders.reduce((s, c) => s + c[1], 0);
      let r = rng.next() * total;
      let champ = contenders[0]![0];
      for (const [school, w] of contenders) {
        r -= w;
        if (r < 0) {
          champ = school;
          break;
        }
      }
      const members = top.filter((a) => a.school === champ).sort((x, y) => prospectScore(y) - prospectScore(x));
      for (const m of members) give(m, `${t} 우승(${champ})`);
      give(members[0], `${t} MVP`);
    }
    // 상위 10%인데 아직 업적이 없는 선수: 가장 두드러진 특징의 부문 순위를 단다.
    const rankIn = (list: Amateur[], fn: (a: Amateur) => number | null, a: Amateur, higher = true) => {
      const v = fn(a);
      if (v === null) return null;
      return 1 + list.filter((x) => {
        const w = fn(x);
        return w !== null && (higher ? w > v : w < v);
      }).length;
    };
    // 부문 10위 밖이면 특징을 살린 대표 선발로 표시한다.
    const squad = level === '고교' ? '청소년 대표 선발' : '대학 대표 선발';
    const allPit = all.filter((a) => a.isPitcher);
    const allBat = all.filter((a) => !a.isPitcher);
    for (const a of top) {
      if (a.honors.some((h) => h.year === year)) continue;
      if (!line(a)) continue;
      if (a.isPitcher) {
        const byStuff = (a.pitching?.stuff ?? 0) >= (a.pitching?.control ?? 0);
        const r = byStuff ? rankIn(allPit, (x) => p(x)?.K ?? null, a) : rankIn(allPit, (x) => (p(x) && p(x)!.OUTS >= minOuts ? (27 * p(x)!.ER) / p(x)!.OUTS : null), a, false);
        give(a, r !== null && r <= 10 ? `${byStuff ? '탈삼진' : '평균자책'} ${r}위` : `${squad}(${byStuff ? '구위' : '제구'})`);
      } else {
        const trait = ['power', 'contact', 'speed'].sort((x, y) => (a.batting as unknown as Record<string, number>)[y]! - (a.batting as unknown as Record<string, number>)[x]!)[0];
        const r =
          trait === 'power'
            ? rankIn(allBat, (x) => b(x)?.HR ?? null, a)
            : trait === 'speed'
              ? rankIn(allBat, (x) => line(x)?.SB ?? null, a)
              : rankIn(allBat, (x) => (b(x) && b(x)!.PA >= minPa && b(x)!.AB > 0 ? b(x)!.H / b(x)!.AB : null), a);
        give(a, r !== null && r <= 10 ? `${trait === 'power' ? '홈런' : trait === 'speed' ? '도루' : '타율'} ${r}위` : `${squad}(${trait === 'power' ? '장타력' : trait === 'speed' ? '주력' : '컨택'})`);
      }
    }
  }
}

/** 새 게임: 2027 학년도 기준 고교 1~3, 대학 1~4학년과 지난 시즌 요약 성적·업적 */
export function generateAmateurs(seed: string, firstId: number, schoolYear: number): Amateur[] {
  const rng = Rng.derive(seed, 'amateur', schoolYear);
  const hs = hsSchools();
  let id = firstId;
  const out: Amateur[] = [];
  for (let g = 1; g <= 3; g++) for (let i = 0; i < AMATEUR.hsPerGrade; i++) out.push(makeAmateur(rng, id++, '고교', g, schoolYear, rng.pick(hs)));
  for (let g = 1; g <= 4; g++) for (let i = 0; i < AMATEUR.colPerGrade; i++) out.push(makeAmateur(rng, id++, '대학', g, schoolYear, rng.pick(COLLEGES)));
  // 지난 시즌들: 학년을 거꾸로 돌려 요약 성적을 만든다(성장 전 능력으로).
  for (let back = 1; back <= 3; back++) {
    const year = schoolYear - back;
    const snapshot: Amateur[] = [];
    for (const a of out) {
      const pastGrade = a.grade - back;
      const pastLevel: SchoolLevel | null = pastGrade >= 1 ? a.level : a.level === '대학' && pastGrade + 3 >= 1 ? '고교' : null;
      if (!pastLevel) continue;
      const g = pastGrade >= 1 ? pastGrade : pastGrade + 3;
      const shift = -AMATEUR.growthPerYear * back;
      const past: Amateur = { ...a, level: pastLevel, grade: g, school: pastLevel === a.level ? a.school : rng.pick(hs), batting: shiftR(a.batting, shift), pitching: a.pitching ? shiftR(a.pitching, shift) : null };
      past.seasons = [];
      past.honors = [];
      past.seasons.push(seasonLine(Rng.derive(seed, 'amateur-line', a.id, year), past, year));
      snapshot.push(past);
    }
    awardHonors(Rng.derive(seed, 'amateur-honor', year), snapshot, year);
    for (const s of snapshot) {
      const a = out.find((x) => x.id === s.id)!;
      a.seasons.push(...s.seasons);
      a.honors.push(...s.honors);
    }
  }
  for (const a of out) a.seasons.sort((x, y) => x.year - y.year);
  return out;
}

function shiftR<T extends object>(r: T, d: number): T {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'stamina' || k === 'groundball' || k === 'speed' ? v : clamp((v as number) + d)])) as T;
}

/** 시즌 마감 뒤 학년도 넘김: 졸업·진학·입학 */
export function advanceSchoolYear(seed: string, pool: Amateur[], nextYear: number, nextId: () => number): { pool: Amateur[]; gone: number; toCollege: number } {
  const rng = Rng.derive(seed, 'school-year', nextYear);
  let gone = 0;
  let toCollege = 0;
  for (const a of pool) {
    if (a.status !== 'active') continue;
    const graduating = (a.level === '고교' && a.grade >= 3) || (a.level === '대학' && a.grade >= 4);
    if (!graduating) {
      a.grade += 1;
      grow(rng, a);
      continue;
    }
    if (a.level === '고교' && rng.chance(AMATEUR.hsCollegeRate * Math.min(1.2, prospectScore(a) / 45))) {
      a.level = '대학';
      a.grade = 1;
      a.school = rng.pick(COLLEGES);
      grow(rng, a);
      toCollege++;
    } else {
      a.status = 'gone';
      gone++;
    }
  }
  const hs = hsSchools();
  const fresh: Amateur[] = [];
  for (let i = 0; i < AMATEUR.hsPerGrade; i++) fresh.push(makeAmateur(rng, nextId(), '고교', 1, nextYear, rng.pick(hs)));
  const colFresh = pool.filter((a) => a.status === 'active' && a.level === '대학' && a.grade === 1).length;
  for (let i = colFresh; i < AMATEUR.colPerGrade; i++) fresh.push(makeAmateur(rng, nextId(), '대학', 1, nextYear, rng.pick(COLLEGES)));
  return { pool: [...pool, ...fresh], gone, toCollege };
}
