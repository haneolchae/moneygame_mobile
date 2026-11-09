// 가상 세계 생성: 구단별 선수 40명(국내 36 + 외국인 3 + 아시아쿼터 1)과 해외 선수 풀.
// 분포·연봉 시세는 config 설정값(WORLDGEN, D-075·D-087)과 아래 상수를 따른다.
import { addDays, makeDate } from './calendar';
import { CLUB_PROFILES } from './clubs';
import { FOREIGN, FREE_POOL, LEAGUE, usdToWon, WORLDGEN } from './config';
import type { Rng } from './rng';
import { FASTBALL_TYPES, type BattingRatings, type CatcherRatings, type ClubProfile, type ContractPreference, type DefenseRatings, type HiddenAttributes, type Pitch, type PitchingRatings, type PitchType, type PlayerOrigin, type PlayerTruth, type Position, type PositionSkills } from './types';

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍', '유', '고', '문', '양', '손', '배', '백', '허', '남', '노', '하', '곽', '성', '차', '주', '우', '구', '민', '류', '나'];
const SURNAME_WEIGHTS = [21, 14, 8, 5, 4, 2.3, 2.1, 2, 2, 2, 1.5, 1.5, 1.5, 1.5, 1.3, 1.3, 1.3, 1.2, 1.1, 1.1, 1, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7, 0.6, 0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.3, 0.3, 0.3];
const GIVEN_FIRST = ['민', '서', '준', '도', '현', '지', '우', '태', '성', '재', '승', '동', '영', '상', '진', '한', '경', '규', '정', '형', '용', '석', '종', '주', '시', '건', '유', '대', '호', '윤', '은', '찬', '희', '원', '병', '광', '세', '수', '인', '혁'];
const GIVEN_SECOND = ['준', '호', '우', '민', '현', '진', '훈', '수', '혁', '석', '빈', '성', '원', '영', '찬', '규', '환', '재', '욱', '철', '기', '범', '율', '한', '서', '형', '택', '헌', '완', '열', '일', '균', '모', '식', '구', '건', '오', '혁', '용', '태'];
// 외국인(미주·중남미) 이름 표기
const FOREIGN_FIRST = ['제이크', '라이언', '타일러', '케일럽', '오스틴', '브랜든', '조던', '카일', '마이클', '대니얼', '루이스', '호세', '카를로스', '라파엘', '미겔', '앤서니', '에릭', '저스틴', '데릭', '헨리', '마커스', '코디', '트레버', '브라이언'];
const FOREIGN_LAST = ['밀러', '존슨', '윌리엄스', '로페즈', '가르시아', '마르티네즈', '로드리게스', '앤더슨', '톰슨', '화이트', '해리스', '클라크', '루이스', '워커', '홀', '영', '앨런', '라미레즈', '헤르난데즈', '페레즈', '스미스', '테일러', '무어', '잭슨'];
// 아시아쿼터(일본·대만·호주 등) 이름 표기
const ASIA_NAMES = ['다나카 쇼타', '스즈키 하루토', '야마모토 렌', '사토 유마', '와타나베 소라', '린 웨이', '천 즈하오', '왕 보원', '황 쯔캉', '제임스 오코너', '미첼 브라운', '노아 그린', '이토 다이키', '고바야시 슌', '마쓰모토 카이토'];

function pickWeighted(rng: Rng, items: readonly string[], weights: readonly number[]): string {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return items[i] as string;
  }
  return items[items.length - 1] as string;
}

export function makeName(rng: Rng, origin: PlayerOrigin): string {
  if (origin === 'foreign') return `${rng.pick(FOREIGN_FIRST)} ${rng.pick(FOREIGN_LAST)}`;
  if (origin === 'asia') return rng.pick(ASIA_NAMES);
  return pickWeighted(rng, SURNAMES, SURNAME_WEIGHTS) + rng.pick(GIVEN_FIRST) + rng.pick(GIVEN_SECOND);
}

const clamp = (v: number, lo = 10, hi = 95) => Math.round(Math.max(lo, Math.min(hi, v)));

/** 나이에 따른 현재 능력 보정. 27~31세가 정점이다. */
export function ageCurve(age: number): number {
  if (age < 27) return -(27 - age) * 1.1;
  if (age <= 31) return 0;
  return -(age - 31) * 1.8;
}

const CONTRACT_PREFERENCES: readonly ContractPreference[] = ['금액', '기간', '우승 전력', '출전 기회', '연고'];

/** 히든 요소 12종(D-088). current: 잠재 상한을 둘 능력치(현재 값) */
export function hiddenFor(rng: Rng, age: number, current: Record<string, number>): HiddenAttributes {
  const potential: HiddenAttributes['potential'] = {};
  const room = Math.max(0, 27 - age) * 1.6;
  for (const [key, value] of Object.entries(current)) {
    (potential as Record<string, number>)[key] = clamp(value + Math.max(0, rng.normal(room, 5)), 10, 99);
  }
  const trait = () => clamp(rng.normal(50, 15), 1, 100);
  return {
    potential,
    growthRate: trait(),
    peakAge: clamp(rng.normal(28, 1.5), 25, 32),
    declineRate: trait(),
    workEthic: trait(),
    coachability: trait(),
    adaptability: trait(),
    consistency: trait(),
    durability: trait(),
    recoveryTendency: trait(),
    pressureSensitivity: trait(),
    leadership: trait(),
    competitiveness: trait(),
    contractPreference: rng.pick(CONTRACT_PREFERENCES),
  };
}

/** 야수 수비 종합(범위·포구·송구). 능력 종합·라인업·팀 수비가 함께 쓴다. */
export function defenseValue(d: DefenseRatings): number {
  return 0.4 * d.range + 0.35 * d.fielding + 0.1 * d.armStrength + 0.15 * d.armAccuracy;
}

/** 투수 변화구 종합(화면 표시용): 속구가 아닌 구종 품질의 사용 비중 가중 평균. 확률 계산에 따로 더하지 않는다(10a 3장). */
export function breakingBall(pitches: readonly Pitch[] | undefined): number | null {
  const br = (pitches ?? []).filter((x) => !FASTBALL_TYPES.includes(x.type));
  const w = br.reduce((a, x) => a + x.usage, 0);
  return w > 0 ? Math.round(br.reduce((a, x) => a + x.quality * x.usage, 0) / w) : null;
}

const RELATED_POSITIONS: Partial<Record<Position, Position[]>> = {
  C: ['1B'],
  '1B': ['3B', 'LF', 'RF'],
  '2B': ['SS', '3B'],
  '3B': ['1B', 'SS'],
  SS: ['2B', '3B'],
  LF: ['RF', 'CF', '1B'],
  CF: ['LF', 'RF'],
  RF: ['LF', 'CF'],
};

/** 포지션 숙련도: 주 포지션 높음, 관련 포지션 1~2개 중간, 나머지는 기록하지 않음(=0) */
export function positionSkillsFor(rng: Rng, position: Position, fielding: number): PositionSkills {
  if (position === 'SP' || position === 'RP') return { [position]: 100 };
  const out: PositionSkills = { [position]: clamp(rng.normal(70 + (fielding - 50) * 0.4, 7), 50, 98) };
  const related = RELATED_POSITIONS[position] ?? [];
  const n = Math.min(related.length, rng.int(1, 2));
  for (const pos of related.slice(0, n)) out[pos] = clamp(rng.normal(52, 9), 25, 80);
  return out;
}

/** 야수 능력치 묶음. r(bias): 능력 생성기(구단 전력·나이·출신 보정이 들어간 정규분포) */
export function hitterAbilities(rng: Rng, position: Position, r: (bias?: number) => number, origin: PlayerOrigin = 'domestic'): { batting: BattingRatings; defense: DefenseRatings; catcher?: CatcherRatings; positions: PositionSkills } {
  const premium = position === 'C' || position === 'SS' || position === '2B' || position === 'CF';
  const speed = clamp(rng.normal(position === 'CF' || position === 'SS' ? 60 : 48, 12));
  const batting: BattingRatings = {
    contact: r(),
    power: r(origin === 'foreign' ? 8 : premium ? -5 : 4),
    eye: r(),
    baserunning: clamp(rng.normal(48 + (speed - 50) * 0.4, 10)),
    speed,
    bunt: clamp(rng.normal(premium ? 50 : 40, 12)),
    mental: clamp(rng.normal(50, 12)),
    stamina: clamp(rng.normal(position === 'C' ? 58 : 52, 10)),
  };
  const defense: DefenseRatings = {
    range: clamp(rng.normal(premium ? 58 : 48, 12)),
    fielding: r(premium ? 3 : 0),
    armStrength: clamp(rng.normal(position === 'C' || position === 'SS' || position === '3B' || position === 'RF' ? 60 : 52, 11)),
    armAccuracy: clamp(rng.normal(52, 11)),
  };
  const catcher = position === 'C' ? { blocking: r(), framing: r(), transfer: r() } : undefined;
  return { batting, defense, ...(catcher ? { catcher } : {}), positions: positionSkillsFor(rng, position, defense.fielding) };
}

/** 투수의 타격·수비 값(DH 리그라 거의 쓰지 않는다) */
function pitcherBatting(rng: Rng): BattingRatings {
  return { contact: clamp(rng.normal(15, 5)), power: clamp(rng.normal(12, 5)), eye: clamp(rng.normal(15, 5)), baserunning: clamp(rng.normal(35, 8)), speed: clamp(rng.normal(35, 10)), bunt: clamp(rng.normal(30, 10)), mental: 50, stamina: 50 };
}

const SECONDARY_PITCHES: readonly PitchType[] = ['슬라이더', '커브', '체인지업', '스플리터', '포크', '커터'];
const PITCH_SPEED_GAP: Record<PitchType, number> = { 포심: 0, 투심: -3, 커터: -5, 슬라이더: -10, 커브: -20, 체인지업: -12, 스플리터: -8, 포크: -10 };

/** 투수 능력치 묶음과 구종 배열. 사용 비중은 합 1로 정규화한다(구종 수 보너스 없음). */
export function pitcherAbilities(rng: Rng, starter: boolean, r: (bias?: number) => number, origin: PlayerOrigin = 'domestic'): { pitching: PitchingRatings; pitches: Pitch[]; batting: BattingRatings; defense: DefenseRatings; positions: PositionSkills } {
  const stuff = r();
  const control = r();
  const groundball = clamp(rng.normal(50, 13));
  const velocityAvg = Math.round((143 + (stuff - 50) * 0.22 + (starter ? -1 : 1) + (origin === 'foreign' ? 2 : 0) + rng.normal(0, 2.5)) * 10) / 10;
  const pitching: PitchingRatings = {
    velocityAvg,
    velocityMax: Math.round((velocityAvg + 3 + rng.next() * 3) * 10) / 10,
    stuff,
    control,
    groundball,
    mental: clamp(rng.normal(50, 12)),
    holdRunners: clamp(rng.normal(50, 12)),
    stamina: starter ? clamp(rng.normal(72, 8), 55, 95) : clamp(rng.normal(35, 8), 15, 55),
    recovery: clamp(rng.normal(starter ? 50 : 58, 10)),
    fielding: clamp(rng.normal(48, 10)),
  };
  const fastball: PitchType = groundball >= 60 && rng.chance(0.6) ? '투심' : '포심';
  const extra = starter ? rng.int(2, 4) : rng.int(1, 2);
  const pool = [...SECONDARY_PITCHES];
  const types: PitchType[] = [fastball];
  for (let i = 0; i < extra && pool.length; i++) types.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!);
  const raw = types.map((t, i) => (i === 0 ? 0.45 + rng.next() * 0.15 : 0.1 + rng.next() * 0.25));
  const total = raw.reduce((a, x) => a + x, 0);
  const pitches: Pitch[] = types.map((type, i) => ({
    type,
    velocity: Math.round((velocityAvg + PITCH_SPEED_GAP[type] + rng.normal(0, 1.5)) * 10) / 10,
    movement: clamp(rng.normal(50, 12)),
    command: clamp(control + rng.normal(0, 7)),
    quality: clamp(stuff + rng.normal(0, 8)),
    mastery: clamp(rng.normal(55, 12)),
    usage: Math.round((raw[i]! / total) * 1000) / 1000,
  }));
  // 반올림 오차는 주 구종에 몰아 합을 정확히 1로 맞춘다.
  pitches[0]!.usage = Math.round((1 - pitches.slice(1).reduce((a, x) => a + x.usage, 0)) * 1000) / 1000;
  const defense: DefenseRatings = { range: clamp(rng.normal(40, 10)), fielding: pitching.fielding, armStrength: clamp(rng.normal(60, 10)), armAccuracy: clamp(rng.normal(50, 10)) };
  return { pitching, pitches, batting: pitcherBatting(rng), defense, positions: { [starter ? 'SP' : 'RP']: 100 } };
}

export function hitterOverall(p: PlayerTruth): number {
  const b = p.batting;
  return 0.3 * b.contact + 0.2 * b.eye + 0.3 * b.power + 0.08 * b.speed + 0.12 * defenseValue(p.defense);
}

export function pitcherOverall(p: PlayerTruth): number {
  const pr = p.pitching;
  if (!pr) return 0;
  const staminaWeight = p.position === 'SP' ? 0.15 : 0.03;
  return (0.45 * pr.stuff + 0.37 * pr.control + 0.1 * pr.groundball + staminaWeight * pr.stamina) / (0.92 + staminaWeight);
}

export function overall(p: PlayerTruth): number {
  return p.isPitcher ? pitcherOverall(p) : hitterOverall(p);
}

/**
 * 국내 선수 연봉 시세 (ASSUMPTION, D-075): 능력 40 ≈ 0.6억, 50 ≈ 1.7억, 60 ≈ 5억, 70 ≈ 15억, 75 ≈ 28억 안팎.
 * 구단 국내 연봉 총액이 기획 규모(100~140억, D-038)에 가깝도록 맞춘 값이다.
 * FA를 거친 베테랑(프로 9년 이상)은 30% 높다. 22세 이하는 6,000만 원 이하. 100만 원 단위.
 */
export function domesticSalary(ovr: number, age: number, proSeasons: number): number {
  let won = WORLDGEN.minSalary + 140_000_000 * Math.exp((ovr - 50) / 7.5);
  if (proSeasons >= 9) won *= 1.3;
  if (age <= 22) won = Math.min(won, 60_000_000);
  return Math.max(WORLDGEN.minSalary, Math.round(won / 1_000_000) * 1_000_000);
}

interface GenContext {
  rng: Rng;
  season: number;
  nextId: () => number;
  /** 능력 평균 보정(국내 미계약 선수 풀처럼 수준이 낮은 집단) */
  shift?: number;
}

function genAge(rng: Rng, club: ClubProfile | null, origin: PlayerOrigin): number {
  if (origin !== 'domestic') return clamp(rng.normal(29, 2.5), 24, 35);
  const youngSkew = club?.prospectHeavy ? -3 : 0;
  return clamp(rng.normal(27 + youngSkew, 4.2), WORLDGEN.minAge, WORLDGEN.maxAge);
}

function birthDateFor(rng: Rng, season: number, age: number): string {
  // 시즌 기준일(4월 1일)에 만 나이가 age가 되도록, 기준일 이전 1년 안에서 생일을 고른다.
  return addDays(makeDate(season - age, 4, 1), -rng.int(1, 364));
}

/** 경력: 프로 연차와 FA 자격 연수(1군 등록 기준). */
function careerFor(rng: Rng, age: number, origin: PlayerOrigin): PlayerTruth['career'] {
  if (origin !== 'domestic') return { proSeasons: rng.int(1, 3), faServiceYears: 0, faEligible: false, franchise: false, foreignRenewals: rng.int(0, 2) };
  const proSeasons = Math.max(1, age - 19 - rng.int(0, 3));
  return { proSeasons, faServiceYears: Math.max(0, Math.round(proSeasons * (0.45 + rng.next() * 0.55))), faEligible: false, franchise: false, foreignRenewals: 0 };
}

/** 계약 잔여 연수: 국내 선수의 약 60%는 1년 계약이라 이번 스토브리그에 연봉 협상을 한다(0). 외국인은 모두 1년 계약. */
function contractYearsFor(rng: Rng, origin: PlayerOrigin): number {
  if (origin !== 'domestic') return 0;
  return rng.chance(0.6) ? 0 : rng.int(1, 3);
}

/** 능력 보정: 외국인은 리그 평균보다 강하게 영입되는 경향이 있다. */
const ORIGIN_SHIFT: Record<PlayerOrigin, number> = { domestic: 0, foreign: 7, asia: 3 };

function genPitcher(ctx: GenContext, club: ClubProfile | null, starter: boolean, origin: PlayerOrigin = 'domestic'): PlayerTruth {
  const { rng } = ctx;
  const age = genAge(rng, club, origin);
  const shift = (club ? (WORLDGEN.strengthShift[club.strength] ?? 0) : 0) + ageCurve(age) + ORIGIN_SHIFT[origin] + (ctx.shift ?? 0);
  const r = (bias = 0) => clamp(rng.normal(WORLDGEN.ratingMean + shift + bias, WORLDGEN.ratingSd));
  const ab = pitcherAbilities(rng, starter, r, origin);
  const career = careerFor(rng, age, origin);
  const p: PlayerTruth = {
    id: ctx.nextId(),
    name: makeName(rng, origin),
    birthDate: birthDateFor(rng, ctx.season, age),
    bats: rng.chance(0.25) ? 'L' : 'R',
    throws: rng.chance(0.28) ? 'L' : 'R',
    isPitcher: true,
    origin,
    position: starter ? 'SP' : 'RP',
    clubId: club?.id ?? null,
    level: '2군',
    salary: 0,
    contractYears: contractYearsFor(rng, origin),
    career,
    ...ab,
    hidden: hiddenFor(rng, age, { stuff: ab.pitching.stuff, control: ab.pitching.control, groundball: ab.pitching.groundball, stamina: ab.pitching.stamina }),
  };
  p.salary = salaryForOrigin(rng, p, age);
  return p;
}

function genHitter(ctx: GenContext, club: ClubProfile | null, position: Position, origin: PlayerOrigin = 'domestic'): PlayerTruth {
  const { rng } = ctx;
  const age = genAge(rng, club, origin);
  const shift = (club ? (WORLDGEN.strengthShift[club.strength] ?? 0) : 0) + ageCurve(age) + ORIGIN_SHIFT[origin] + (ctx.shift ?? 0);
  const r = (offset = 0) => clamp(rng.normal(WORLDGEN.ratingMean + shift + offset, WORLDGEN.ratingSd));
  // 포지션 성향: 중앙 내야·포수는 수비 쪽, 코너는 장타 쪽으로 기운다. 외국인 타자는 장타 쪽.
  const ab = hitterAbilities(rng, position, r, origin);
  const career = careerFor(rng, age, origin);
  const p: PlayerTruth = {
    id: ctx.nextId(),
    name: makeName(rng, origin),
    birthDate: birthDateFor(rng, ctx.season, age),
    bats: rng.chance(0.08) ? 'S' : rng.chance(0.33) ? 'L' : 'R',
    throws: position === 'C' || position === 'SS' || position === '2B' || position === '3B' ? 'R' : rng.chance(0.2) ? 'L' : 'R',
    isPitcher: false,
    origin,
    position,
    clubId: club?.id ?? null,
    level: '2군',
    salary: 0,
    contractYears: contractYearsFor(rng, origin),
    career,
    ...ab,
    pitching: null,
    hidden: hiddenFor(rng, age, { contact: ab.batting.contact, eye: ab.batting.eye, power: ab.batting.power, speed: ab.batting.speed, range: ab.defense.range, fielding: ab.defense.fielding }),
  };
  p.salary = salaryForOrigin(rng, p, age);
  return p;
}

/** 외국인 연봉은 달러 계약을 고정 환율로 원화 환산한다(D-048 상한 안). */
function salaryForOrigin(rng: Rng, p: PlayerTruth, age: number): number {
  if (p.origin === 'domestic') return domesticSalary(overall(p), age, p.career.proSeasons);
  const ovrFactor = Math.max(0, Math.min(1, (overall(p) - 45) / 30));
  if (p.origin === 'asia') return usdToWon(Math.round((FOREIGN.asiaNewCapUsd * (0.55 + 0.45 * ovrFactor)) / 10_000) * 10_000);
  const base = FOREIGN.newCapUsd * (0.6 + 0.5 * ovrFactor) + p.career.foreignRenewals * 150_000;
  return usdToWon(Math.round(base / 10_000) * 10_000 + rng.int(0, 5) * 10_000);
}

/** 1군 26명 자동 구성: 선발 5, 불펜 8, 포지션별 최고 선수 + 남은 야수 중 상위. */
export function assignActiveRoster(players: PlayerTruth[]): void {
  for (const p of players) p.level = '2군';
  const byOvr = (a: PlayerTruth, b: PlayerTruth) => overall(b) - overall(a) || a.id - b.id;
  const sps = players.filter((p) => p.position === 'SP').sort(byOvr).slice(0, WORLDGEN.activeStarters);
  const rps = players
    .filter((p) => p.isPitcher && !sps.includes(p))
    .sort(byOvr)
    .slice(0, LEAGUE.activePitchers - sps.length);
  const hitters = players.filter((p) => !p.isPitcher).sort(byOvr);
  const chosen = new Set<PlayerTruth>();
  for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as Position[]) {
    const best = hitters.find((h) => h.position === pos && !chosen.has(h));
    if (best) chosen.add(best);
  }
  // 백업 포수 1명은 반드시 둔다.
  const backupC = hitters.find((h) => h.position === 'C' && !chosen.has(h));
  if (backupC) chosen.add(backupC);
  for (const h of hitters) {
    if (chosen.size >= LEAGUE.activeHitters) break;
    chosen.add(h);
  }
  const active = [...sps, ...rps, ...chosen];
  // D-098: 한쪽이 모자라 26명을 못 채우면 다른 쪽에서 임시로 채운다. 최소 인원 미달은 규칙 검사(invariants)가 기록한다.
  if (active.length < LEAGUE.activeRoster) {
    const rest = players.filter((p) => !active.includes(p)).sort(byOvr);
    active.push(...rest.slice(0, LEAGUE.activeRoster - active.length));
  }
  for (const p of active) p.level = '1군';
}

/** 국내 선수 구성: 투수 18(선발 5), 야수 18. 외국인 3(선발 2 + 타자 1), 아시아쿼터 1. 합계 40 (D-016, D-046) */
const DOMESTIC_PITCHERS = 18;
const DOMESTIC_STARTERS = 5;
const DOMESTIC_HITTER_POSITIONS: Position[] = ['C', 'C', 'C', '1B', '1B', '2B', '2B', '3B', '3B', 'SS', 'SS', 'SS', 'LF', 'LF', 'CF', 'CF', 'RF', 'RF'];
const FOREIGN_HITTER_POSITIONS: Position[] = ['1B', '3B', 'LF', 'RF', 'CF'];

export function generateWorld(rng: Rng, season: number): PlayerTruth[] {
  let id = 1;
  const ctx: GenContext = { rng, season, nextId: () => id++ };
  const players: PlayerTruth[] = [];
  for (const club of CLUB_PROFILES) {
    const clubPlayers: PlayerTruth[] = [];
    for (let i = 0; i < DOMESTIC_PITCHERS; i++) clubPlayers.push(genPitcher(ctx, club, i < DOMESTIC_STARTERS));
    for (const pos of DOMESTIC_HITTER_POSITIONS) clubPlayers.push(genHitter(ctx, club, pos));
    clubPlayers.push(genPitcher(ctx, club, true, 'foreign'), genPitcher(ctx, club, true, 'foreign'));
    clubPlayers.push(genHitter(ctx, club, rng.pick(FOREIGN_HITTER_POSITIONS), 'foreign'));
    clubPlayers.push(genPitcher(ctx, club, rng.chance(0.5), 'asia'));
    assignActiveRoster(clubPlayers);
    players.push(...clubPlayers);
  }
  return players;
}

/** 해외 선수 풀: 이번 스토브리그에 영입할 수 있는 외국인·아시아쿼터 후보 (소속 없음). */
export function generateOverseasPool(rng: Rng, season: number, firstId: number): PlayerTruth[] {
  let id = firstId;
  const ctx: GenContext = { rng, season, nextId: () => id++ };
  const pool: PlayerTruth[] = [];
  for (let i = 0; i < 16; i++) pool.push(genPitcher(ctx, null, i < 11, 'foreign'));
  for (let i = 0; i < 10; i++) pool.push(genHitter(ctx, null, rng.pick(FOREIGN_HITTER_POSITIONS), 'foreign'));
  for (let i = 0; i < 6; i++) pool.push(genPitcher(ctx, null, rng.chance(0.4), 'asia'));
  for (let i = 0; i < 4; i++) pool.push(genHitter(ctx, null, rng.pick(['2B', 'SS', 'CF', 'LF'] as Position[]), 'asia'));
  for (const p of pool) {
    p.career.foreignRenewals = 0;
    // 신규 영입 상한(외국인 100만 달러, 아시아쿼터 20만 달러) 안에서 요구한다 (D-048).
    const cap = p.origin === 'asia' ? FOREIGN.asiaNewCapUsd : FOREIGN.newCapUsd;
    p.salary = Math.min(salaryForOrigin(rng, p, 29), usdToWon(cap));
  }
  return pool;
}

/**
 * 국내 미계약 선수 풀(D-098): 방출·미지명·독립리그 출신으로 소속 없이 입단을 기다리는 선수. 포지션 최소 인원 보충의 공급원이다.
 * 새 게임과 매 시즌 마감 때 만든다. 수준은 리그 평균보다 낮고, 영입하면 최저 연봉 1년 계약이다.
 */
export function generateDomesticFreePool(rng: Rng, season: number, firstId: number, counts: { pitchers: number; catchers: number; otherHitters: number } = FREE_POOL): PlayerTruth[] {
  let id = firstId;
  const ctx: GenContext = { rng, season, nextId: () => id++, shift: FREE_POOL.ratingShift };
  const pool: PlayerTruth[] = [];
  const starters = Math.round((counts.pitchers * FREE_POOL.starters) / FREE_POOL.pitchers);
  for (let i = 0; i < counts.pitchers; i++) pool.push(genPitcher(ctx, null, i < starters));
  for (let i = 0; i < counts.catchers; i++) pool.push(genHitter(ctx, null, 'C'));
  for (let i = 0; i < counts.otherHitters; i++) pool.push(genHitter(ctx, null, rng.pick(DOMESTIC_HITTER_POSITIONS.filter((x) => x !== 'C'))));
  for (const p of pool) {
    p.clubId = null;
    p.level = '2군';
    p.contractYears = 0;
    p.salary = WORLDGEN.minSalary;
    p.career.franchise = false;
    p.career.faEligible = false;
  }
  return pool;
}

/** FA 자격 기준 연수 (ASSUMPTION: KBO 등록일수 규정 원문 확인 전 단순화) */
export const FA_SERVICE_YEARS_REQUIRED = 8;

/**
 * 첫 스토브리그용 FA 자격 선수 지정 (22 문서): 구단마다 2~4명, 사용자 구단에는 간판 외야수 1명을 반드시 포함한다.
 * 지정된 선수는 이번 시즌으로 계약이 끝난다(contractYears = 0). 국내 선수만 대상이다.
 */
export function assignFaCandidates(rng: Rng, players: PlayerTruth[], userClubId: number): void {
  const clubIds = [...new Set(players.map((p) => p.clubId).filter((c): c is number => c !== null))];
  for (const clubId of clubIds) {
    const mine = players.filter((p) => p.clubId === clubId && p.origin === 'domestic');
    if (clubId === userClubId) {
      const outfielders = mine.filter((p) => p.position === 'LF' || p.position === 'CF' || p.position === 'RF').sort((a, b) => overall(b) - overall(a) || a.id - b.id);
      const star = outfielders[0];
      if (star) {
        star.career.faServiceYears = Math.max(star.career.faServiceYears, FA_SERVICE_YEARS_REQUIRED + 1);
        star.career.proSeasons = Math.max(star.career.proSeasons, star.career.faServiceYears);
        star.career.faEligible = true;
        star.career.franchise = true;
        star.contractYears = 0;
        star.salary = domesticSalary(overall(star), 30, star.career.proSeasons);
      }
    }
    const target = rng.int(2, 4);
    const pool = rng.shuffle(mine.filter((p) => !p.career.faEligible && p.career.faServiceYears >= FA_SERVICE_YEARS_REQUIRED));
    let count = mine.filter((p) => p.career.faEligible).length;
    for (const p of pool) {
      if (count >= target) break;
      p.career.faEligible = true;
      p.contractYears = 0;
      count++;
    }
  }
}
