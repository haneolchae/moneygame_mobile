// 타석 단위 경기 시뮬레이션 (10 문서).
// 승패와 개인 성적은 같은 사건 기록(타석·주루 사건·득점)에서 나온다. 결과를 먼저 정하지 않는다.
//
// 구조(4c-0, D-164): 경기 상태(GameState) → 결정 지점(nextDecision) → 지시 적용(applyDirective) → 타석 전 주루 사건(runPrePlays)
// → 타석 준비(preparePa) → 타석 판정(resolvePa). 자동 경기(simulateGame)는 감독 AI(managerDecide)가 모든 결정을 내리는 같은 루프다.
// 구단주 참여(4c-3)는 같은 결정 지점에서 다른 지시를 넣는다.
// 4c-1(D-161·D-167): 승부처 타석만 볼카운트 층. 모든 판정 난수는 (경기 키, 경기 ID, 순번, 사건 종류)에서 파생한다.
// 4c-2a(D-170): 좌우 상대 보정, 도루·견제사·폭투·포일·보크, 희생번트·스퀴즈, 고의사구, 히트앤드런, 대타·대주자·대수비,
// 수비 위치, 승부처 카운트 지시. 감독 AI는 상대 선수를 자기 구단 추정값으로 본다(D-165 (3)).
//
// 단순화 (ASSUMPTION(D-091·D-170), 후속 단계에서 확장):
//  - 실책으로 출루한 주자와 실책 플레이·포일로 들어온 득점만 비자책으로 처리한다.
//  - 승리투수: 결승점 시점의 투수. 선발이 5이닝(15아웃) 미만이면 가장 많은 아웃을 잡은 구원투수. 홀드는 아직 판정하지 않는다.
//  - 주루 사건은 타석 시작 전에 한 번 판정한다(투구 사이 시점은 나누지 않는다). 견제·도루 시도는 투구 수에 더하지 않는다.
import { CLUTCH, SIM, TACTICS } from './config';
import { fitMatchup, runCountPa, scaleTable, type CountTable } from './count';
import COUNT_MODEL from './data/countModel.json';
import { BATTER_DIRECTION, consistencyPerformance, FORM_EVENTS, pressureIndex, pressureLoss, type PlayerForm } from './form';
import { logit, sigmoid } from './mathx';
import { batterSide, battingSide, combineTop, effectivePitching, framingContext, NEUTRAL_ENVIRONMENT, paProbabilities, pitcherSide, typeShares, type DefenseContext, type LeagueEnvironment, type SideLogits, type TopLevel } from './probability';
import { Rng } from './rng';
import { buntProbs, canPlay, countMultipliers, defaultEstimator, hitIndex, runningRates, stealSuccess, trueRating, type CountTactic, type Estimator, type RatingKey } from './tactics';
import type { ClubId, FixtureId, PlayerId, PlayerTruth, Position } from './types';
import { authorityLogit, hookAdjust, judgmentSd, leadershipFactor, managedPlayer, NEUTRAL_MANAGER, smallBallFactor, staminaFactor, type ManagerProfile } from './manager';
import { leverage, winProbability } from './winProb';
import { cachedTheta, effFielding, effRange, NORMAL_ALIGNMENT, qualityDist, resolveInPlay, type Alignment, type Bases, type Credit, type FieldPos, type Fielders, type Runner } from './zone';
import type { BallType, Quality } from './zoneConfig';

/** FC: 야수 선택(타자는 살고 다른 주자가 아웃되거나 진루), SH: 희생번트 성공(타수 아님) */
export type PaOutcome = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'HBP' | 'K' | 'GO' | 'FO' | 'DP' | 'SF' | 'SH' | 'ROE' | 'FC';
export const HIT_OUTCOMES: readonly PaOutcome[] = ['1B', '2B', '3B', 'HR'];

export interface LineupSpot {
  player: PlayerTruth;
  position: Position | 'DH';
}

export interface TeamSetup {
  clubId: ClubId;
  lineup: LineupSpot[]; // 9명, 타순
  starter: PlayerTruth;
  bullpen: PlayerTruth[]; // 출전 가능한 불펜 (마무리 제외)
  closer: PlayerTruth | null;
  /** 팀 수비 지수(내야·외야·포수 프레이밍) */
  defense: DefenseContext;
  /** 4c-2a: 라인업에 없는 1군 야수(대타·대주자·대수비 후보) */
  bench?: PlayerTruth[];
  /** 4c-2b: 감독(없으면 평균 감독) */
  manager?: ManagerProfile;
}

export interface PaEvent {
  seq: number;
  inning: number;
  half: 'T' | 'B';
  battingClub: ClubId;
  batterId: PlayerId;
  pitcherId: PlayerId;
  outcome: PaOutcome;
  rbi: number;
  outsBefore: number;
  outsOnPlay: number;
  pitches: number;
  homeScore: number;
  awayScore: number;
  /** 수비 기록(자살·보살·실책, 10b §11) */
  credits: Credit[];
  /** 인플레이 타구 정보(구역·유형·질·처리 수비수). 홈런·볼넷·삼진·번트는 없음 */
  bb?: { zone: string; type: BallType; quality: Quality; fielderId: PlayerId; infieldHit: boolean };
  /** 4c-1 승부처 타석(볼카운트 층으로 진행, D-161). 일반 타석은 없음 */
  clutch?: true;
  /** 승부처 타석의 마지막 카운트(메모리에만, 저장하지 않음 — D-165) */
  count?: { balls: number; strikes: number; fouls: number };
  /** 승부처 기준을 넘었지만 대결 맞춤을 풀지 못해 타석 단위로 계산한 타석(D-167 (4), 목표 0건) */
  countFallback?: true;
  /** 4c-3 승부처 타석의 투구 순서(화면용, 메모리에만 — D-174 (6)) */
  pitchLog?: string;
  /** 4c-2a: 고의사구, 번트(희생·스퀴즈), 히트앤드런 */
  ibb?: true;
  bunt?: 'sac' | 'squeeze';
  hitAndRun?: true;
}

/** 4c-2a 주루 사건: 도루·도루 실패·견제사(주자 한 명), 폭투·포일·보크(모든 주자 한 베이스) */
export interface PlayEvent {
  seq: number;
  inning: number;
  half: 'T' | 'B';
  battingClub: ClubId;
  kind: 'SB' | 'CS' | 'PO' | 'WP' | 'PB' | 'BK';
  /** 도루·도루 실패·견제사의 주자. 폭투·포일·보크는 null */
  runnerId: PlayerId | null;
  /** 출발 베이스(1~3). 폭투·포일·보크는 0 */
  from: number;
  pitcherId: PlayerId;
  catcherId: PlayerId;
  outsBefore: number;
  outsOnPlay: number;
  homeScore: number;
  awayScore: number;
  credits: Credit[];
}

/** 4c-2a 선수 교체(메모리에만): 대타·대주자·대수비 */
export interface SubEvent {
  seq: number;
  clubId: ClubId;
  kind: 'PH' | 'PR' | 'DEF';
  outId: PlayerId;
  inId: PlayerId;
}

/** 4c-2b 감독 결정 하나(신뢰도 갱신 재료, D-163) */
export interface ManagerDecision {
  clubId: ClubId;
  side: 'off' | 'def';
  kinds: string[];
  inning: number;
  wpBefore: number;
  wpAfter: number;
}

export interface RunEvent {
  seq: number;
  battingClub: ClubId;
  runnerId: PlayerId;
  pitcherId: PlayerId; // 책임 투수
  earned: boolean;
}

export interface GameResult {
  fixtureId: FixtureId;
  home: ClubId;
  away: ClubId;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  outcome: 'home' | 'away' | 'tie';
  lineScore: { home: number[]; away: number[] };
  events: PaEvent[];
  /** 4c-2a 주루 사건 */
  plays: PlayEvent[];
  /** 4c-2a 선수 교체 */
  subs: SubEvent[];
  /** 4c-3 우리 경기의 구단주 참여 지점 수(참여 설정과 무관, D-174 (7)) */
  ownerPoints: number;
  /** 4c-2b 감독 결정과 그 타석의 승리 확률 변화(그 구단 쪽), 구단별 타석당 승리 확률 변화 합(팀 기준선용) */
  managerDecisions: ManagerDecision[];
  wpTrack: Array<{ clubId: ClubId; offSum: number; offN: number; defSum: number; defN: number }>;
  runs: RunEvent[];
  /** 8a(D-180): 투수별 홀드·블론세이브·퀄리티 스타트(해당 있는 투수만), 선수·포지션별 수비 아웃 */
  pitcherFlags: Array<{ clubId: ClubId; pitcherId: PlayerId; hold: boolean; blown: boolean; qs: boolean }>;
  fieldOuts: Array<{ clubId: ClubId; playerId: PlayerId; position: string; outs: number }>;
  starters: { home: PlayerId; away: PlayerId };
  winningPitcher: PlayerId | null;
  losingPitcher: PlayerId | null;
  savePitcher: PlayerId | null;
}

export interface PitcherStint {
  pitcher: PlayerTruth;
  isStarter: boolean;
  pitches: number;
  outs: number;
  runs: number;
  leadAtEntry: number;
  outsAtEntryOfInning: boolean;
  /** 8a(D-180): 등판 중 가장 낮았던 리드, 내려갈 때 리드(홀드·블론세이브 판정) */
  minLead: number;
  leadAtExit?: number;
}

export interface TeamState {
  setup: TeamSetup;
  /** 경기 중 라인업(교체가 반영된 사본). 타순은 바뀌지 않는다 */
  lineup: LineupSpot[];
  /** 남은 벤치 야수 */
  bench: PlayerTruth[];
  /** 교체되어 나간 선수(다시 나올 수 없다) */
  removed: Set<PlayerId>;
  /** 이 팀 소속으로 경기에 등록된 모든 선수(감독 AI가 자기 선수를 실제 값으로 보는 범위) */
  own: Set<PlayerId>;
  orderIndex: number;
  stint: PitcherStint;
  stints: PitcherStint[];
  usedRelievers: Set<PlayerId>;
  /** 수비 위치(라인업 포지션). 투수는 타석마다 현재 투수로 채운다 */
  fielders: Fielders;
  /** 4c-2a 수비 위치 지시 */
  align: Alignment;
  /** 4c-2b 감독 */
  manager: ManagerProfile;
  /** 타석당 승리 확률 변화(이 팀 쪽) 합: 공격·수비 */
  wp: { offSum: number; offN: number; defSum: number; defN: number };
  /** 8a(D-180): '선수|포지션' → 수비 아웃(지명타자는 수비 동안 라인업에 있던 아웃) */
  defOuts: Map<string, number>;
}

export type Side = 'home' | 'away';

export { paProbabilities };

/** 승부처 카운트 결정(4c-2a): 공격 '기다려', 수비 '유인구·정면 승부'. 4c-3에서 구단주 지시를 넣는 자리 */
export type CountDecider = (g: GameState, prep: PreparedPa, balls: number, strikes: number) => { offense: CountTactic; defense: CountTactic };

/** 경기 입력(3b): 경기 시작 때 고정한 선수별 최근·과거 표본(10a 4·7장)과 경기 중요도 */
export interface GameOptions {
  forms?: { batter: ReadonlyMap<PlayerId, PlayerForm>; pitcher: ReadonlyMap<PlayerId, PlayerForm> };
  postseason?: boolean;
  /** 볼카운트 층 적용 범위: clutch = 승부처 타석만(게임 기본), off = 사용 안 함, all = 모든 타석(검증·보정 도구용) */
  countLayer?: 'clutch' | 'off' | 'all';
  /** 4c-2a: 감독 AI가 상대 선수를 보는 추정값(없으면 엔진 기본 추정) */
  estimator?: Estimator;
  /** 4c-2a: 작전 사건을 끈다(보정 도구 비교·4c-1 기준 시험용) */
  tactics?: 'on' | 'off';
  /** 4c-3: 구단주 승부처 참여(D-174) */
  owner?: OwnerControl;
}

/** 4c-3 구단주 지시(자기 쪽만): 수비면 투수·고의사구·수비 위치·대수비, 공격이면 대타·대주자·작전 */
export interface OwnerPrePa {
  pitcherId?: PlayerId | null;
  ibb?: boolean;
  align?: Alignment;
  defensiveSubs?: Directive['defensiveSubs'];
  pinchHitter?: PlayerId | null;
  pinchRunners?: Directive['pinchRunners'];
  play?: OffensePlay;
}

/** 4c-3 구단주 참여 제어(D-174 (2)): 기록된 지시를 돌려주고, 없으면 멈추거나(관전) 감독 추천대로 간다(하루 진행) */
export interface OwnerControl {
  clubId: ClubId;
  /** 참여 설정. 꺼져 있어도 참여 지점 수는 센다 */
  enabled: boolean;
  maxPerGame: number;
  prePa: (key: number) => OwnerPrePa | undefined;
  count: (paSeq: number, balls: number, strikes: number) => CountTactic | undefined;
  pauseWhenMissing: boolean;
}

export type OwnerPoint =
  | { kind: 'prePa'; key: number; role: 'off' | 'def'; recommended: Directive }
  | { kind: 'count'; key: number; paSeq: number; balls: number; strikes: number; log: string; role: 'off' | 'def'; recommended: CountTactic; batterId: PlayerId; pitcherId: PlayerId };

/** 구단주 지시가 없어 멈춘 지점(관전 미리보기가 잡는다) */
export class OwnerPause extends Error {
  constructor(public readonly point: OwnerPoint) {
    super('구단주 결정 대기');
  }
}

/** 구단주 지시를 추천에 합친다: 구단주 쪽 항목만 바꾸고 상대 쪽은 상대 감독 추천. 고의사구와 공격 작전은 함께 할 수 없다 */
export function mergeOwner(rec: Directive, o: OwnerPrePa, role: 'off' | 'def'): Directive {
  const d: Directive = role === 'def'
    ? { ...rec, pitcherId: o.pitcherId !== undefined ? o.pitcherId : rec.pitcherId, ibb: o.ibb ?? rec.ibb, align: o.align ?? rec.align, defensiveSubs: o.defensiveSubs ?? rec.defensiveSubs }
    : { ...rec, pinchHitter: o.pinchHitter !== undefined ? o.pinchHitter : rec.pinchHitter, pinchRunners: o.pinchRunners ?? rec.pinchRunners, play: o.play ?? rec.play };
  if (d.ibb) d.play = 'none';
  return d;
}

/** 구단주 쪽 결정이 추천과 같은가(같으면 감독 결정으로 신뢰도에 넣는다, D-174 (3)) */
export function sameSide(a: Directive, b: Directive, role: 'off' | 'def'): boolean {
  const pick = (d: Directive) => (role === 'def' ? [d.pitcherId, d.ibb, d.align, d.defensiveSubs] : [d.pinchHitter, d.pinchRunners, d.play]);
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
}

/** 타석 판정 난수의 사건 종류(D-167 (5)). 투구는 PITCH_BASE + 투구 순번 */
const DRAW = { top: 1, pitches: 2, hrSplit: 3, steal: 10, running: 11, bunt: 12, decideSteal: 13, decideHnr: 14, decideBunt: 15, hnrSteal: 16, judge: 17, powerRound: 18, pitchBase: 100 } as const;
const COUNT_P0 = (COUNT_MODEL as { version: string; table: CountTable }).table;
export const countModelVersion = (): string => (COUNT_MODEL as { version: string }).version;

/** 타석 준비 결과: 대결 확률과 승부처 판정(난수를 쓰지 않는다) */
export interface PreparedPa {
  batter: PlayerTruth;
  pitcher: PlayerTruth;
  top: TopLevel;
  /** 타석 시작 때 레버리지(7회 전이면 계산하지 않아 0) */
  leverage: number;
  clutch: boolean;
}

export type OffensePlay = 'none' | 'steal2' | 'steal3' | 'hitAndRun' | 'sacBunt' | 'squeeze';

/**
 * 경기 상태. 결정 지점 사이에서 한 걸음씩 진행한다.
 * phase: halfStart = 반 이닝 시작 전(말 공격 생략 판정 전), pa = 다음 타석 대기, over = 경기 종료.
 */
export interface GameState {
  fixtureId: FixtureId;
  maxInnings: number;
  env: LeagueEnvironment;
  opts: GameOptions;
  rng: Rng;
  /** 타석별 하위 난수 흐름의 경기 키(10b §12) */
  bbKey: number;
  teams: Record<Side, TeamState>;
  framing: Record<Side, SideLogits>;
  /** 대결 한쪽 값(성적 혼합 포함)과 경기별 수행 편차는 선수마다 경기당 한 번 계산한다(10a 6.1·7장) */
  batSides: Map<PlayerId, SideLogits>;
  pitSides: Map<PlayerId, SideLogits>;
  perf: Map<PlayerId, number>;
  score: Record<Side, number>;
  lineScore: { home: number[]; away: number[] };
  events: PaEvent[];
  plays: PlayEvent[];
  subs: SubEvent[];
  runs: RunEvent[];
  seq: number;
  inning: number;
  half: 'T' | 'B';
  phase: 'halfStart' | 'pa' | 'over';
  outs: number;
  bases: [Runner | null, Runner | null, Runner | null];
  halfRuns: number;
  /** 이번 반 이닝의 첫 타석 전인가(투수 교체 판단의 이닝 시작 여부) */
  atHalfStart: boolean;
  /** 결승점 추적: 리드가 바뀔 때마다 기록한다 */
  leadChange: { leader: Side; winnerPitcher: PlayerId; loserPitcher: PlayerId } | null;
  /** 이번 타석에 적용할 공격 작전·고의사구(지시 적용 때 정하고 타석이 끝나면 비운다) */
  pending: { play: OffensePlay; ibb: boolean };
  estimator: Estimator;
  estCache: Map<string, number>;
  /** 승부처 카운트 결정(없으면 감독 AI) */
  countDecider: CountDecider | null;
  /** 4c-2b: 이번 결정 지점의 홈팀 승리 확률과 감독이 내린 결정(타석이 끝나면 점수를 매긴다) */
  wpAtDecision: number | null;
  openDecisions: Array<{ side: Side; role: 'off' | 'def'; kinds: string[] }>;
  managerDecisions: ManagerDecision[];
  /** 4c-3: 지금 결정 지점 키, 구단주 참여 지점 수, 참여 중인 타석의 결정 키 */
  decisionKey: number;
  ownerPoints: number;
  ownerPaKey: number | null;
}

/** 타석 전 결정 지점(D-170 (1)): 수비(투수·대수비·수비 위치·고의사구)와 공격(대타·대주자·작전) */
export interface DecisionPoint {
  kind: 'prePa';
  /** 수비 쪽 */
  side: Side;
  batSide: Side;
  inning: number;
  atInningStart: boolean;
  /** 결정 난수 키(다음 순번) */
  key: number;
}

export interface Directive {
  kind: 'prePa';
  /** null이면 지금 투수가 계속 던진다 */
  pitcherId: PlayerId | null;
  defensiveSubs: Array<{ position: FieldPos; playerId: PlayerId }>;
  align: Alignment;
  ibb: boolean;
  pinchHitter: PlayerId | null;
  pinchRunners: Array<{ base: 0 | 1 | 2; playerId: PlayerId }>;
  play: OffensePlay;
}

export const NO_DIRECTIVE: Directive = { kind: 'prePa', pitcherId: null, defensiveSubs: [], align: NORMAL_ALIGNMENT, ibb: false, pinchHitter: null, pinchRunners: [], play: 'none' };

/** 타석 위 단계 추첨(순서 고정: 볼넷·삼진·홈런·사구·인플레이) */
function drawTop(rng: Rng, p: { BB: number; K: number; HR: number; HBP: number }): PaOutcome | 'INPLAY' {
  let r = rng.next();
  if ((r -= p.BB) < 0) return 'BB';
  if ((r -= p.K) < 0) return 'K';
  if ((r -= p.HR) < 0) return 'HR';
  if ((r -= p.HBP) < 0) return 'HBP';
  return 'INPLAY';
}

/** 타구 질 분포(장타·실효 구위·구속이 같으면 같은 값, 결정적 계산 캐시) */
const QUALITY_CACHE = new Map<string, Record<BallType, [number, number, number]>>();
function qualitiesFor(power: number, stuff: number, velocityZ: number): Record<BallType, [number, number, number]> {
  const key = `${power}|${stuff}|${velocityZ}`;
  let v = QUALITY_CACHE.get(key);
  if (!v) {
    if (QUALITY_CACHE.size >= 50_000) QUALITY_CACHE.clear();
    v = { GB: qualityDist('GB', power, stuff, velocityZ), LD: qualityDist('LD', power, stuff, velocityZ), FB: qualityDist('FB', power, stuff, velocityZ) };
    QUALITY_CACHE.set(key, v);
  }
  return v;
}

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
export const battingSideOf = (half: 'T' | 'B'): Side => (half === 'T' ? 'away' : 'home');
const leadFor = (g: GameState, side: Side) => (side === 'home' ? g.score.home - g.score.away : g.score.away - g.score.home);
const basesMask = (b: GameState['bases']) => (b[0] ? 1 : 0) | (b[1] ? 2 : 0) | (b[2] ? 4 : 0);

function makeTeam(raw: TeamSetup, bbKey: number, fixtureId: FixtureId): TeamState {
  // 4c-2b: 감독 보정을 더한 경기용 선수 사본(저장 능력치 불변, D-172 (2)). 장타 확률 반올림 난수는 (경기 키, 경기 ID, 선수)에서 파생
  const manager = raw.manager ?? NEUTRAL_MANAGER;
  const adj = (p: PlayerTruth) => managedPlayer(p, manager, Rng.fromKeys(bbKey, fixtureId, -p.id, DRAW.powerRound).next());
  const setup: TeamSetup = { ...raw, lineup: raw.lineup.map((s) => ({ ...s, player: adj(s.player) })), starter: adj(raw.starter), bullpen: raw.bullpen.map(adj), closer: raw.closer ? adj(raw.closer) : null, bench: (raw.bench ?? []).map(adj) };
  const stint: PitcherStint = { pitcher: setup.starter, isStarter: true, pitches: 0, outs: 0, runs: 0, leadAtEntry: 0, outsAtEntryOfInning: true, minLead: 0 };
  const lineup = setup.lineup.map((s) => ({ ...s }));
  const fielders = { P: stint.pitcher } as Fielders;
  for (const spot of lineup) if (spot.position !== 'DH') fielders[spot.position as FieldPos] = spot.player;
  const bench = [...(setup.bench ?? [])];
  const own = new Set<PlayerId>([...lineup.map((s) => s.player.id), ...bench.map((p) => p.id), setup.starter.id, ...setup.bullpen.map((p) => p.id), ...(setup.closer ? [setup.closer.id] : [])]);
  return { setup, lineup, bench, removed: new Set(), own, orderIndex: 0, stint, stints: [stint], usedRelievers: new Set(), fielders, align: NORMAL_ALIGNMENT, manager, wp: { offSum: 0, offN: 0, defSum: 0, defN: 0 }, defOuts: new Map() };
}

/** 경기 상태 만들기. env: 시즌 리그 환경(D-100), opts: 성적 혼합 표본·경기 중요도(3b) */
export function createGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, opts: GameOptions = {}): GameState {
  // 타석별 하위 난수 흐름(10b §12): 판정 난수는 (경기 키, 순번)에서 파생한 난수를 쓴다(팀 준비는 난수를 쓰지 않는다).
  const bbKey = rng.int(0, 2_000_000_000);
  const teams = { home: makeTeam(home, bbKey, fixtureId), away: makeTeam(away, bbKey, fixtureId) };
  return {
    fixtureId,
    maxInnings,
    env,
    opts,
    rng,
    bbKey,
    teams,
    framing: { home: framingContext(home.defense), away: framingContext(away.defense) },
    batSides: new Map(),
    pitSides: new Map(),
    perf: new Map(),
    score: { home: 0, away: 0 },
    lineScore: { home: [], away: [] },
    events: [],
    plays: [],
    subs: [],
    runs: [],
    seq: 0,
    inning: 1,
    half: 'T',
    phase: 'halfStart',
    outs: 0,
    bases: [null, null, null],
    halfRuns: 0,
    atHalfStart: true,
    leadChange: null,
    pending: { play: 'none', ibb: false },
    estimator: opts.estimator ?? defaultEstimator,
    estCache: new Map(),
    countDecider: null,
    wpAtDecision: null,
    openDecisions: [],
    managerDecisions: [],
    decisionKey: 0,
    ownerPoints: 0,
    ownerPaKey: null,
  };
}

/** 반 이닝 시작 처리: 9회 이후 말 공격 전에 홈팀이 앞서면 경기 종료(말 공격 없음 X) */
function settle(g: GameState): void {
  if (g.phase !== 'halfStart') return;
  if (g.half === 'B' && g.inning >= 9 && g.score.home > g.score.away) {
    g.lineScore.home.push(-1); // -1: 말 공격 없음(X)
    g.phase = 'over';
    return;
  }
  g.outs = 0;
  g.bases = [null, null, null];
  g.halfRuns = 0;
  g.atHalfStart = true;
  g.teams[other(battingSideOf(g.half))].align = NORMAL_ALIGNMENT;
  g.phase = 'pa';
}

/** 다음 타석 전 결정 지점. 경기가 끝났으면 null */
export function nextDecision(g: GameState): DecisionPoint | null {
  settle(g);
  if (g.phase === 'over') return null;
  const batSide = battingSideOf(g.half);
  g.wpAtDecision = wpNow(g);
  g.openDecisions = [];
  g.decisionKey = g.seq + 1;
  return { kind: 'prePa', side: other(batSide), batSide, inning: g.inning, atInningStart: g.atHalfStart, key: g.seq + 1 };
}

/** 지금 상태의 홈팀 승리 확률(표, 경기가 끝났으면 결과) */
function wpNow(g: GameState): number {
  if (g.phase === 'over') return g.score.home > g.score.away ? 1 : g.score.home < g.score.away ? 0 : 0.5;
  const diff = g.score.home - g.score.away;
  if (g.phase === 'halfStart') {
    if (g.half === 'B' && g.inning >= 9 && diff > 0) return 1;
    return winProbability(g.inning, g.half, 0, 0, diff, g.opts.postseason === true);
  }
  return winProbability(g.inning, g.half, g.outs, basesMask(g.bases), diff, g.opts.postseason === true);
}

/** 타석(또는 반 이닝을 끝낸 주루 사건) 뒤: 팀 기준선용 승리 확률 변화와 감독 결정 점수 재료를 남긴다(D-163) */
function closeDecision(g: GameState, batSide: Side): void {
  if (g.wpAtDecision === null) return;
  const delta = wpNow(g) - g.wpAtDecision;
  const offDelta = batSide === 'home' ? delta : -delta;
  const off = g.teams[batSide].wp;
  const def = g.teams[other(batSide)].wp;
  off.offSum += offDelta;
  off.offN++;
  def.defSum -= offDelta;
  def.defN++;
  for (const d of g.openDecisions) {
    const before = d.side === 'home' ? g.wpAtDecision : 1 - g.wpAtDecision;
    g.managerDecisions.push({ clubId: g.teams[d.side].setup.clubId, side: d.role, kinds: d.kinds, inning: g.inning, wpBefore: before, wpAfter: before + (d.role === 'off' ? offDelta : -offDelta) });
  }
  g.wpAtDecision = null;
  g.openDecisions = [];
}

// ───────── 감독 AI(D-170) ─────────

/** 평가 쪽이 보는 능력: 자기 선수는 실제 값, 상대 선수는 자기 구단 추정값 */
function seen(g: GameState, evaluator: Side, p: PlayerTruth, key: RatingKey): number {
  const t = g.teams[evaluator];
  if (t.own.has(p.id)) return trueRating(p, key);
  const k = `${t.setup.clubId}:${p.id}:${key}`;
  let v = g.estCache.get(k);
  if (v === undefined) {
    v = g.estimator(t.setup.clubId, p, key);
    g.estCache.set(k, v);
  }
  return v;
}
const seenHit = (g: GameState, evaluator: Side, p: PlayerTruth) => hitIndex(seen(g, evaluator, p, 'contact'), seen(g, evaluator, p, 'power'), seen(g, evaluator, p, 'eye'));
const decideDraw = (g: GameState, d: DecisionPoint, kind: number) => Rng.fromKeys(g.bbKey, g.fixtureId, d.key, kind).next();
const defIndex = (p: PlayerTruth, pos: FieldPos) => (effRange(p, pos) + effFielding(p, pos)) / 2;

/** 투수 교체(4c-0 감독 판단 그대로): 선발 투구 수·실점 한도, 구원 투구 수, 세이브 상황 마무리, 접전이면 좋은 불펜 */
function decidePitcher(g: GameState, d: DecisionPoint): PlayerId | null {
  const t = g.teams[d.side];
  const s = t.stint;
  const lead = leadFor(g, d.side);
  const available = t.setup.bullpen.filter((p) => !t.usedRelievers.has(p.id));
  const closerAvailable = t.setup.closer && !t.usedRelievers.has(t.setup.closer.id) && s.pitcher.id !== t.setup.closer.id;
  let needChange = false;
  if (s.isStarter) {
    const limit = SIM.starterPitchLimitBase + SIM.starterPitchLimitPerStamina * (s.pitcher.pitching?.stamina ?? 50) + hookAdjust(t.manager);
    needChange = s.pitches * staminaFactor(t.manager) >= limit || s.runs >= SIM.starterRunsBeforeHook;
  } else {
    needChange = s.pitches * staminaFactor(t.manager) >= SIM.relieverPitchLimit || (d.atInningStart && s.outs >= 3);
  }
  const saveSituation = d.atInningStart && d.inning >= 9 && lead >= 1 && lead <= SIM.closerMaxLead;
  if (saveSituation && closerAvailable) needChange = true;
  if (!needChange) return null;
  let next: PlayerTruth | undefined;
  if (saveSituation && closerAvailable) next = t.setup.closer!;
  else if (available.length > 0) {
    const close = d.inning >= 7 && Math.abs(lead) <= 3;
    // 불펜은 품질순 정렬되어 있다. 접전이면 좋은 투수, 아니면 뒤쪽 투수를 쓴다.
    next = close ? available[0] : available[available.length - 1];
  } else if (closerAvailable) next = t.setup.closer!;
  return next ? next.id : null;
}

/** 감독 AI 결정. 수비 → 공격(대타·대주자) → 수비(고의사구·수비 위치) → 공격 작전 순으로 정한다 */
export function managerDecide(g: GameState, d: DecisionPoint): Directive {
  const dir: Directive = { ...NO_DIRECTIVE, defensiveSubs: [], pinchRunners: [] };
  if (g.opts.tactics === 'off') return { ...dir, pitcherId: decidePitcher(g, d) };
  const T = TACTICS;
  const def = g.teams[d.side];
  const off = g.teams[d.batSide];
  const defLead = leadFor(g, d.side);
  const offDiff = -defLead;
  dir.pitcherId = decidePitcher(g, d);
  const pitcher = dir.pitcherId ? [...def.setup.bullpen, ...(def.setup.closer ? [def.setup.closer] : [])].find((p) => p.id === dir.pitcherId)! : def.stint.pitcher;
  // 대수비: 반 이닝 시작, 8회 이후 1~3점 앞설 때 수비 지수가 크게 나은 벤치 선수 한 명
  if (d.atInningStart && d.inning >= T.defSub.minInning && defLead >= T.defSub.minLead && defLead <= T.defSub.maxLead) {
    let best: { position: FieldPos; playerId: PlayerId; gain: number } | null = null;
    for (const spot of def.lineup) {
      if (spot.position === 'DH') continue;
      const pos = spot.position as FieldPos;
      const cur = defIndex(spot.player, pos);
      for (const c of def.bench) {
        if (def.removed.has(c.id) || !canPlay(c, spot.position)) continue;
        const gain = defIndex(c, pos) - cur;
        if (gain >= T.defSub.gap && (!best || gain > best.gain)) best = { position: pos, playerId: c.id, gain };
      }
    }
    if (best) dir.defensiveSubs.push({ position: best.position, playerId: best.playerId });
  }
  // 대타: 7회 이후, 상위 타순 제외, 벤치 타자의 타격 지수(좌우 유리 반영)가 크게 높을 때
  const spotIdx = off.orderIndex % 9;
  const spot = off.lineup[spotIdx]!;
  const platoonAdj = (p: PlayerTruth) => (battingSide(p, pitcher) === pitcher.throws ? -T.pinchHit.platoon : T.pinchHit.platoon);
  let batter = spot.player;
  if (d.inning >= T.pinchHit.minInning && spotIdx >= T.pinchHit.protectTop) {
    const cur = hitIndex(batter.batting.contact, batter.batting.power, batter.batting.eye) + platoonAdj(batter);
    let best: PlayerTruth | null = null;
    let bestV = cur + T.pinchHit.gap;
    for (const c of off.bench) {
      if (off.removed.has(c.id) || !canPlay(c, spot.position)) continue;
      const v = hitIndex(c.batting.contact, c.batting.power, c.batting.eye) + platoonAdj(c);
      if (v >= bestV) {
        best = c;
        bestV = v;
      }
    }
    if (best) {
      dir.pinchHitter = best.id;
      batter = best;
    }
  }
  // 대주자: 8회 이후 1점 차 이내, 앞 주자부터 주력이 크게 빠른 벤치 선수
  if (d.inning >= T.pinchRun.minInning && Math.abs(offDiff) <= T.pinchRun.maxDiff) {
    const used = new Set<PlayerId>(dir.pinchHitter ? [dir.pinchHitter] : []);
    for (const base of [2, 1, 0] as const) {
      const r = g.bases[base];
      if (!r) continue;
      const rs = off.lineup.find((s) => s.player.id === r.id);
      if (!rs) continue;
      const c = off.bench
        .filter((p) => !off.removed.has(p.id) && !used.has(p.id) && canPlay(p, rs.position) && p.batting.speed >= r.speed + T.pinchRun.speedGap)
        .sort((a, b) => b.batting.speed - a.batting.speed || a.id - b.id)[0];
      if (c) {
        dir.pinchRunners.push({ base, playerId: c.id });
        used.add(c.id);
        break;
      }
    }
  }
  const b = g.bases;
  // 고의사구: 8회 이후, 1루가 비고 득점권 주자, 점수 차 2 이하, 타자가 다음 타자보다 추정 타격 지수가 크게 높을 때
  if (d.inning >= T.ibb.minInning && !b[0] && (b[1] || b[2]) && Math.abs(defLead) <= T.ibb.maxDiff) {
    const next = off.lineup[(off.orderIndex + 1) % 9]!.player;
    if (seenHit(g, d.side, batter) - seenHit(g, d.side, next) >= T.ibb.gap) dir.ibb = true;
  }
  // 수비 위치(10b §9): 3루 주자·2아웃 미만·7회 이후 동점이거나 1점 앞서면 내야 전진, 1루 주자·2아웃 미만이면 병살 대비,
  // 8회 이후 1~2점 앞서면 외야 후진·선상 수비
  const align: Alignment = { infield: 'normal', outfield: 'normal', lines: false };
  if (b[2] && g.outs < 2 && d.inning >= 7 && (defLead === 0 || defLead === 1)) align.infield = 'in';
  else if (b[0] && g.outs < 2) align.infield = 'dp';
  if (d.inning >= 8 && defLead >= 1 && defLead <= 2) {
    align.outfield = 'back';
    align.lines = true;
  }
  dir.align = align;
  if (dir.ibb) return dir;
  // 공격 작전: 스퀴즈 > 희생번트 > 도루 > 히트앤드런. 상대 포수·투수는 추정값으로 본다
  const topOrder = spotIdx < T.pinchHit.protectTop;
  const bunter = batter;
  const small = smallBallFactor(off.manager);
  // 작전 능력: 도루 성공 추정에 판단 오차를 더한다(결정 난수에서 파생, D-172 (2))
  const judge = Rng.fromKeys(g.bbKey, g.fixtureId, d.key, DRAW.judge).normal(0, judgmentSd(off.manager));
  if (b[2] && g.outs < 2 && d.inning >= 7 && (offDiff === 0 || offDiff === -1) && !topOrder && decideDraw(g, d, DRAW.decideBunt) < T.bunt.squeezeShare * small) dir.play = 'squeeze';
  else if ((b[0] || b[1]) && !b[2] && g.outs === 0 && !topOrder && ((d.inning >= 7 && Math.abs(offDiff) <= 1) || hitIndex(bunter.batting.contact, bunter.batting.power, bunter.batting.eye) < T.bunt.weakIndex) && decideDraw(g, d, DRAW.decideBunt) < T.bunt.sacShare * small) dir.play = 'sacBunt';
  else if (Math.abs(offDiff) <= T.steal.maxDiff) {
    const catcher = def.fielders.C;
    const stealOf = (base: 2 | 3, r: Runner) => stealSuccess(base, r, seen(g, d.batSide, catcher, 'armStrength'), seen(g, d.batSide, catcher, 'transfer'), seen(g, d.batSide, pitcher, 'holdRunners'), authorityLogit(off.manager)) + judge;
    const cand: OffensePlay = b[0] && !b[1] && stealOf(2, b[0]) >= T.steal.breakEven2 ? 'steal2' : b[1] && !b[2] && !b[0] && stealOf(3, b[1]) >= T.steal.breakEven3 ? 'steal3' : 'none';
    if (cand !== 'none' && decideDraw(g, d, DRAW.decideSteal) < T.steal.attemptShare * small) dir.play = cand;
  }
  if (dir.play === 'none' && b[0] && !b[1] && g.outs < 2 && b[0].speed >= T.hitAndRun.minSpeed && batter.batting.contact >= T.hitAndRun.minContact && decideDraw(g, d, DRAW.decideHnr) < T.hitAndRun.attemptShare * small) dir.play = 'hitAndRun';
  return dir;
}

/** 지시가 규칙에 맞지 않는 이유(없으면 null). 감독 AI와 구단주 지시가 같은 검사를 쓴다 */
export function directiveError(g: GameState, d: DecisionPoint, dir: Directive): string | null {
  const def = g.teams[d.side];
  const off = g.teams[d.batSide];
  if (dir.pitcherId !== null && dir.pitcherId !== def.stint.pitcher.id) {
    const pool = [...def.setup.bullpen, ...(def.setup.closer ? [def.setup.closer] : [])];
    if (!pool.some((p) => p.id === dir.pitcherId)) return '출전 가능한 불펜 투수가 아닙니다.';
    if (def.usedRelievers.has(dir.pitcherId)) return '이미 등판한 투수는 다시 나올 수 없습니다.';
  }
  const benchOk = (t: TeamState, id: PlayerId) => t.bench.some((p) => p.id === id) && !t.removed.has(id);
  for (const s of dir.defensiveSubs) {
    if (!benchOk(def, s.playerId)) return '벤치에 남은 선수가 아닙니다.';
    if (!def.lineup.some((x) => x.position === s.position)) return '라인업에 없는 포지션입니다.';
  }
  if (dir.pinchHitter !== null && !benchOk(off, dir.pinchHitter)) return '대타로 낼 수 있는 선수가 아닙니다.';
  for (const r of dir.pinchRunners) {
    if (!g.bases[r.base]) return '그 베이스에 주자가 없습니다.';
    if (!benchOk(off, r.playerId)) return '대주자로 낼 수 있는 선수가 아닙니다.';
  }
  const b = g.bases;
  if (dir.play === 'steal2' && !(b[0] && !b[1])) return '2루 도루는 1루 주자가 있고 2루가 비어야 합니다.';
  if (dir.play === 'steal3' && !(b[1] && !b[2])) return '3루 도루는 2루 주자가 있고 3루가 비어야 합니다.';
  if (dir.play === 'hitAndRun' && !(b[0] && !b[1] && g.outs < 2)) return '히트앤드런은 1루 주자, 2루 빔, 2아웃 미만일 때만 합니다.';
  if (dir.play === 'sacBunt' && !((b[0] || b[1]) && g.outs < 2)) return '희생번트는 주자가 있고 2아웃 미만일 때만 합니다.';
  if (dir.play === 'squeeze' && !(b[2] && g.outs < 2)) return '스퀴즈는 3루 주자가 있고 2아웃 미만일 때만 합니다.';
  if (dir.ibb && dir.play !== 'none') return '고의사구와 공격 작전은 함께 정할 수 없습니다.';
  return null;
}

function substitute(t: TeamState, outId: PlayerId, inP: PlayerTruth): LineupSpot | null {
  const spot = t.lineup.find((s) => s.player.id === outId);
  if (!spot) return null;
  spot.player = inP;
  if (spot.position !== 'DH') t.fielders[spot.position as FieldPos] = inP;
  t.removed.add(outId);
  t.bench = t.bench.filter((p) => p.id !== inP.id);
  return spot;
}

/** 지시 적용. 호출자는 directiveError로 먼저 검사한다 */
export function applyDirective(g: GameState, d: DecisionPoint, dir: Directive, ownerOverride: Side | null = null): void {
  const def = g.teams[d.side];
  const off = g.teams[d.batSide];
  if (dir.pitcherId !== null && dir.pitcherId !== def.stint.pitcher.id) {
    const next = [...def.setup.bullpen, ...(def.setup.closer ? [def.setup.closer] : [])].find((p) => p.id === dir.pitcherId)!;
    def.usedRelievers.add(next.id);
    def.stint.leadAtExit = leadFor(g, d.side);
    const stint: PitcherStint = { pitcher: next, isStarter: false, pitches: 0, outs: 0, runs: 0, leadAtEntry: leadFor(g, d.side), outsAtEntryOfInning: d.atInningStart, minLead: leadFor(g, d.side) };
    def.stints.push(stint);
    def.stint = stint;
  }
  for (const s of dir.defensiveSubs) {
    const inP = def.bench.find((p) => p.id === s.playerId)!;
    const spot = def.lineup.find((x) => x.position === s.position)!;
    g.subs.push({ seq: d.key, clubId: def.setup.clubId, kind: 'DEF', outId: spot.player.id, inId: inP.id });
    substitute(def, spot.player.id, inP);
  }
  if (dir.pinchHitter !== null) {
    const inP = off.bench.find((p) => p.id === dir.pinchHitter)!;
    const outP = off.lineup[off.orderIndex % 9]!.player;
    g.subs.push({ seq: d.key, clubId: off.setup.clubId, kind: 'PH', outId: outP.id, inId: inP.id });
    substitute(off, outP.id, inP);
  }
  for (const r of dir.pinchRunners) {
    const inP = off.bench.find((p) => p.id === r.playerId)!;
    const runner = g.bases[r.base]!;
    g.subs.push({ seq: d.key, clubId: off.setup.clubId, kind: 'PR', outId: runner.id, inId: inP.id });
    substitute(off, runner.id, inP);
    g.bases[r.base] = { ...runner, id: inP.id, speed: inP.batting.speed, baserunning: inP.batting.baserunning };
  }
  def.align = dir.align;
  g.pending = { play: dir.play, ibb: dir.ibb };
  // 4c-2b: 감독 결정(신뢰도 재료). 기본 수비 위치·병살 대비(1루 주자 때 늘 하는 수비)·작전 없음은 결정으로 세지 않는다
  const defKinds = [...(dir.pitcherId !== null ? ['투수 교체'] : []), ...(dir.defensiveSubs.length ? ['대수비'] : []), ...(dir.ibb ? ['고의사구'] : []), ...(dir.align.infield === 'in' || dir.align.outfield !== 'normal' || dir.align.lines ? ['수비 위치'] : [])];
  const offKinds = [...(dir.pinchHitter !== null ? ['대타'] : []), ...(dir.pinchRunners.length ? ['대주자'] : []), ...(dir.play !== 'none' ? [dir.play] : [])];
  // 4c-3(D-174 (3)): 구단주가 추천과 다르게 정한 쪽은 감독 결정(신뢰도)에 넣지 않는다
  if (defKinds.length && ownerOverride !== d.side) g.openDecisions.push({ side: d.side, role: 'def', kinds: defKinds });
  if (offKinds.length && ownerOverride !== d.batSide) g.openDecisions.push({ side: d.batSide, role: 'off', kinds: offKinds });
}

function sideOf(g: GameState, p: PlayerTruth, role: 'batter' | 'pitcher'): SideLogits {
  const cache = role === 'batter' ? g.batSides : g.pitSides;
  let v = cache.get(p.id);
  if (!v) {
    v = role === 'batter' ? batterSide(p, g.env, g.opts.forms?.batter.get(p.id)) : pitcherSide(p, g.env, g.opts.forms?.pitcher.get(p.id));
    cache.set(p.id, v);
  }
  return v;
}

// u_game: 선수·경기별 1회 추첨(저장되는 경기 난수에서 파생, 타석 흐름과 겹치지 않게 음수 키)
function perfOf(g: GameState, p: PlayerTruth): number {
  let v = g.perf.get(p.id);
  if (v === undefined) {
    v = consistencyPerformance(p.hidden.consistency, Rng.fromInts(g.bbKey, g.fixtureId, -p.id).next() * 2 - 1);
    g.perf.set(p.id, v);
  }
  return v;
}

function scoreRun(g: GameState, batSide: Side, runner: Runner, extraUnearned: boolean): void {
  const defSide = other(batSide);
  const before = leadFor(g, batSide);
  g.score[batSide]++;
  g.halfRuns++;
  g.runs.push({ seq: g.seq, battingClub: g.teams[batSide].setup.clubId, runnerId: runner.id, pitcherId: runner.pitcherId, earned: runner.earned && !extraUnearned });
  const responsible = g.teams[defSide].stints.find((st) => st.pitcher.id === runner.pitcherId);
  if (responsible) responsible.runs++;
  if (before === 0) {
    // 이 득점으로 리드를 잡았다.
    g.leadChange = { leader: batSide, winnerPitcher: g.teams[batSide].stint.pitcher.id, loserPitcher: runner.pitcherId };
  }
}

// ───────── 주루 사건(D-170 (3)) ─────────

/** 주루 사건 하나를 기록하고 끝내기·3아웃을 처리한다. 경기·반 이닝이 끝났으면 false */
function recordPlay(g: GameState, kind: PlayEvent['kind'], runnerId: PlayerId | null, from: number, outsBefore: number, credits: Credit[]): boolean {
  const batSide = battingSideOf(g.half);
  const def = g.teams[other(batSide)];
  const outsOnPlay = g.outs - outsBefore;
  def.stint.outs += outsOnPlay;
  afterDefense(g, other(batSide), outsOnPlay);
  g.plays.push({ seq: g.seq, inning: g.inning, half: g.half, battingClub: g.teams[batSide].setup.clubId, kind, runnerId, from, pitcherId: def.stint.pitcher.id, catcherId: def.fielders.C.id, outsBefore, outsOnPlay, homeScore: g.score.home, awayScore: g.score.away, credits });
  endOfPlay(g, batSide);
  const goOn = g.phase === 'pa' && g.outs < 3;
  if (!goOn) closeDecision(g, batSide);
  return goOn;
}

/** 도루 판정(실제 값). 도루 실패면 포수 보살·베이스 커버 자살 */
function resolveSteal(g: GameState, base: 2 | 3, drawKind: number): boolean {
  const batSide = battingSideOf(g.half);
  const def = g.teams[other(batSide)];
  const from = base - 1;
  const r = g.bases[from - 1]!;
  g.seq++;
  const outsBefore = g.outs;
  const catcher = def.fielders.C;
  const p = stealSuccess(base, r, catcher.defense.armStrength, catcher.catcher?.transfer ?? 50, def.stint.pitcher.pitching?.holdRunners ?? 50, authorityLogit(g.teams[batSide].manager));
  g.bases[from - 1] = null;
  const credits: Credit[] = [];
  if (Rng.fromKeys(g.bbKey, g.fixtureId, g.seq, drawKind).next() < p) {
    g.bases[base - 1] = r;
    return recordPlay(g, 'SB', r.id, from, outsBefore, credits);
  }
  g.outs++;
  credits.push({ playerId: catcher.id, kind: 'A' }, { playerId: def.fielders[base === 2 ? 'SS' : '3B'].id, kind: 'PO' });
  return recordPlay(g, 'CS', r.id, from, outsBefore, credits);
}

/** 타석 전 주루 사건(도루 지시, 견제사·폭투·포일·보크). 타석이 이어지면 true, 반 이닝·경기가 끝났으면 false */
export function runPrePlays(g: GameState): boolean {
  settle(g);
  if (g.phase === 'over') return false;
  if (g.opts.tactics === 'off' || g.pending.ibb) return true;
  const play = g.pending.play;
  if (play === 'steal2' || play === 'steal3') {
    g.pending = { ...g.pending, play: 'none' };
    if (!resolveSteal(g, play === 'steal2' ? 2 : 3, DRAW.steal)) return false;
  }
  if (play === 'sacBunt' || play === 'squeeze' || !(g.bases[0] || g.bases[1] || g.bases[2])) return true;
  const batSide = battingSideOf(g.half);
  const def = g.teams[other(batSide)];
  const rates = runningRates(def.stint.pitcher, def.fielders.C, g.bases[0] !== null && play !== 'steal2');
  const u = Rng.fromKeys(g.bbKey, g.fixtureId, g.seq + 1, DRAW.running).next();
  let kind: PlayEvent['kind'] | null = null;
  let acc = rates.pickoff;
  if (u < acc) kind = 'PO';
  else if (u < (acc += rates.wildPitch)) kind = 'WP';
  else if (u < (acc += rates.passedBall)) kind = 'PB';
  else if (u < (acc += rates.balk)) kind = 'BK';
  if (!kind) return true;
  g.seq++;
  const outsBefore = g.outs;
  if (kind === 'PO') {
    const r = g.bases[0]!;
    g.bases[0] = null;
    g.outs++;
    return recordPlay(g, 'PO', r.id, 1, outsBefore, [
      { playerId: def.stint.pitcher.id, kind: 'A' },
      { playerId: def.fielders['1B'].id, kind: 'PO' },
    ]);
  }
  // 폭투·포일·보크: 모든 주자 한 베이스. 포일 득점은 비자책
  const [r1, r2, r3] = g.bases;
  if (r3) scoreRun(g, batSide, r3, kind === 'PB');
  g.bases = [null, r1, r2];
  return recordPlay(g, kind, null, 0, outsBefore, []);
}

// ───────── 타석 ─────────

/**
 * 다음 타석 준비(결정 지점·주루 사건 처리 뒤): 타자·투수, 대결 확률, 레버리지·승부처 판정. 상태와 난수를 바꾸지 않는다
 * (선수별 대결 값·수행 편차의 경기 캐시만 채운다).
 */
export function preparePa(g: GameState): PreparedPa {
  settle(g);
  if (g.phase === 'over') throw new Error('경기가 끝났습니다.');
  const batSide = battingSideOf(g.half);
  const defSide = other(batSide);
  const bat = g.teams[batSide];
  const batter = bat.lineup[bat.orderIndex % 9]!.player;
  const pitcher = g.teams[defSide].stint.pitcher;
  const { inning } = g;
  // 타석 위 단계 확률(10a 5·6장): 대결 한쪽 값 + 사건별 상황 보정(프레이밍 + 방향 계수 × (타자 수행 − 투수 수행) + 좌우 상대)
  const bases0 = g.bases;
  const pressure = pressureIndex({ inning, scoreDiff: g.score.home - g.score.away, runners: (bases0[0] ? 1 : 0) + (bases0[1] ? 1 : 0) + (bases0[2] ? 1 : 0), postseason: g.opts.postseason === true });
  // 4c-2b 리더십: 압박 손실·경기별 수행 편차 크기 배율(D-172 (2))
  const batPerf = (perfOf(g, batter) - pressureLoss(pressure, batter.batting.mental, batter.hidden.pressureSensitivity)) * leadershipFactor(bat.manager);
  const pitPerf = (perfOf(g, pitcher) - pressureLoss(pressure, pitcher.pitching?.mental ?? 50, pitcher.hidden.pressureSensitivity)) * leadershipFactor(g.teams[defSide].manager);
  const fr = g.framing[defSide];
  const context = {} as SideLogits;
  // 4c-2a 좌우 상대(D-170 (2)): 같은 손이면 투수 쪽, 다르면 타자 쪽
  const platoon = g.opts.tactics === 'off' ? 0 : battingSide(batter, pitcher) === pitcher.throws ? 1 : -1;
  for (const e of FORM_EVENTS) context[e] = fr[e] + BATTER_DIRECTION[e] * (batPerf - pitPerf) + platoon * TACTICS.platoon[e];
  const eff = effectivePitching(pitcher);
  const top = combineTop(sideOf(g, batter, 'batter'), sideOf(g, pitcher, 'pitcher'), g.env, context, typeShares(batter, pitcher), eff.stuff, eff.velocityZ) as TopLevel;
  // 승부처(D-161): 7회 이후 + 타석 시작 레버리지 기준 이상. 화면·참여 설정과 무관하게 모든 경기에 같은 규칙.
  // 고의사구·번트 타석은 투구 단위로 진행하지 않는다.
  const mode = g.opts.countLayer ?? 'clutch';
  let li = 0;
  if (inning >= CLUTCH.minInning) li = leverage(inning, g.half, g.outs, basesMask(bases0), g.score.home - g.score.away, g.opts.postseason === true);
  const special = g.pending.ibb || g.pending.play === 'sacBunt' || g.pending.play === 'squeeze';
  const clutch = !special && COUNT_P0.length > 0 && (mode === 'all' || (mode === 'clutch' && inning >= CLUTCH.minInning && li >= CLUTCH.leverageThreshold));
  return { batter, pitcher, top, leverage: li, clutch };
}

/** 승부처 카운트 결정(감독 AI, D-170 (9)): 3-0·3-1 기다려, 3볼이면 1루가 비고 강타자면 유인구 아니면 정면 승부 */
export const managerCountDecide: CountDecider = (g, prep, balls, strikes) => {
  if (g.opts.tactics === 'off' || balls < 3) return { offense: 'none', defense: 'none' };
  const defSide = other(battingSideOf(g.half));
  const strong = seenHit(g, defSide, prep.batter) >= 60;
  return { offense: strikes < 2 ? 'take' : 'none', defense: !g.bases[0] && strong ? 'pitchAround' : 'attack' };
};

/** 타석 1개 진행: 타석 전 주루 사건 → 준비 → 판정. 주루 사건으로 반 이닝·경기가 끝나면 null(타자는 다음 이닝 선두) */
export function stepPlateAppearance(g: GameState): PaEvent | null {
  if (!runPrePlays(g)) {
    g.pending = { play: 'none', ibb: false };
    return null;
  }
  return resolvePa(g, preparePa(g));
}

/** 준비한 타석을 판정한다. 모든 판정 난수는 (경기 키, 경기 ID, 타석 순번, 사건 종류)에서 파생한다(D-167 (5)) */
export function resolvePa(g: GameState, prep: PreparedPa): PaEvent {
  g.atHalfStart = false;
  const batSide = battingSideOf(g.half);
  const defSide = other(batSide);
  const bat = g.teams[batSide];
  const def = g.teams[defSide];
  bat.orderIndex++;
  const { batter, pitcher } = prep;
  const pending = g.pending;
  g.pending = { play: 'none', ibb: false };
  const hnr = pending.play === 'hitAndRun' && g.bases[0] !== null && g.bases[1] === null;
  // 히트앤드런(D-170 (4)): 삼진 로짓을 낮추고 그 몫을 인플레이로 옮긴다
  let top = prep.top;
  if (hnr) {
    const K = sigmoid(logit(top.K) + TACTICS.hitAndRun.k);
    top = { ...top, K, inPlay: top.inPlay + (top.K - K) };
  }
  const { inning, half } = g;
  const paSeq = g.seq + 1;
  const draw = (kind: number) => Rng.fromKeys(g.bbKey, g.fixtureId, paSeq, kind);
  let outcome0: PaOutcome | 'INPLAY' | 'BUNT';
  let counted: ReturnType<typeof runCountPa> | null = null;
  let fallback = false;
  if (pending.ibb) outcome0 = 'BB';
  else if (pending.play === 'sacBunt' || pending.play === 'squeeze') outcome0 = 'BUNT';
  else if (prep.clutch) {
    // 볼카운트 층(10a 10장): 대결 확률과 같은 결과 분포로 맞춘 체인을 투구 단위로 진행
    const fit = fitMatchup(COUNT_P0, { BB: top.BB, K: top.K, HBP: top.HBP }, CLUTCH.fitTolerance, CLUTCH.fitMaxIter);
    if (fit.ok) {
      // 카운트 결정 지점(타석 시작·2스트라이크·3볼): 지시가 있으면 그 지점부터 투구 확률에 배율을 곱한다
      const decider = g.countDecider ?? managerCountDecide;
      const ctl = g.opts.owner;
      const ownerRole = ctl ? (g.teams[batSide].setup.clubId === ctl.clubId ? 'off' : g.teams[defSide].setup.clubId === ctl.clubId ? 'def' : null) : null;
      const ownerPa = !!ctl && ctl.enabled && ownerRole !== null && g.ownerPaKey !== null && g.ownerPaKey === g.decisionKey;
      counted = runCountPa(fit.table, (n) => draw(DRAW.pitchBase + n).next(), CLUTCH.maxPitches, (balls, strikes, log) => {
        let t = decider(g, prep, balls, strikes);
        // 4c-3(D-174 (2)): 구단주 참여 타석의 2스트라이크·3볼 지점은 구단주 쪽을 기록된 지시로(없으면 멈추거나 추천대로)
        if (ownerPa && !(balls === 0 && strikes === 0)) {
          const rec = ownerRole === 'off' ? t.offense : t.defense;
          const o = ctl!.count(paSeq, balls, strikes);
          if (o === undefined && ctl!.pauseWhenMissing) throw new OwnerPause({ kind: 'count', key: g.decisionKey, paSeq, balls, strikes, log, role: ownerRole!, recommended: rec, batterId: batter.id, pitcherId: pitcher.id });
          const v = o ?? rec;
          t = ownerRole === 'off' ? { ...t, offense: v } : { ...t, defense: v };
        }
        return t.offense === 'none' && t.defense === 'none' ? null : scaleTable(fit.table, countMultipliers(t.offense, t.defense));
      });
      if (counted.result === 'IP') outcome0 = draw(DRAW.hrSplit).next() * (top.HR + top.inPlay) < top.HR ? 'HR' : 'INPLAY';
      else outcome0 = counted.result;
    } else {
      fallback = true;
      outcome0 = drawTop(draw(DRAW.top), top);
    }
  } else outcome0 = drawTop(draw(DRAW.top), top);
  let outcome: PaOutcome = outcome0 === 'INPLAY' || outcome0 === 'BUNT' ? 'GO' : outcome0;
  let rbi = 0;
  const outsBefore = g.outs;
  const runnerOf = (earned = true): Runner => ({ id: batter.id, speed: batter.batting.speed, baserunning: batter.batting.baserunning, pitcherId: pitcher.id, earned });
  const scoreR = (r: Runner, credit: boolean, unearned = false) => {
    scoreRun(g, batSide, r, unearned);
    if (credit) rbi++;
  };
  const fielders = def.fielders;
  fielders.P = pitcher;
  const credits: Credit[] = [];
  let bb: PaEvent['bb'];
  g.seq++;
  switch (outcome0) {
    case 'HR': {
      for (const r of g.bases) if (r) scoreR(r, true);
      scoreR(runnerOf(), true);
      g.bases = [null, null, null];
      break;
    }
    case 'BB':
    case 'HBP': {
      // 밀어내기: 앞 베이스가 차 있을 때만 주자가 진루한다.
      const [r1, r2, r3] = g.bases;
      if (r1 && r2 && r3) scoreR(r3, true);
      g.bases = [runnerOf(), r1 ?? r2, r1 && r2 ? r2 : r3];
      break;
    }
    case 'K': {
      g.outs++;
      credits.push({ playerId: fielders.C.id, kind: 'PO' }); // 삼진 자살은 포수
      break;
    }
    case 'BUNT': {
      // 번트(D-170 (5)): 번트 안타 → 성공(희생·스퀴즈) → 실패(선행 주자 아웃)
      const kind = pending.play === 'squeeze' ? 'squeeze' : 'sac';
      const pr = buntProbs(kind, batter, authorityLogit(bat.manager));
      const u = draw(DRAW.bunt).next();
      const [r1, r2, r3] = g.bases;
      if (u < pr.hit) {
        outcome = '1B';
        g.bases = [runnerOf(), r1, r2];
        if (r3) scoreR(r3, true);
      } else if (u < pr.hit + (1 - pr.hit) * pr.success) {
        // 성공: 타자는 1루에서 아웃, 모든 주자 한 베이스 진루(3루 주자는 득점)
        outcome = 'SH';
        g.outs++;
        credits.push({ playerId: pitcher.id, kind: 'A' }, { playerId: fielders['1B'].id, kind: 'PO' });
        if (r3) scoreR(r3, true);
        g.bases = [null, r1, r2];
      } else {
        // 실패: 선행 주자 아웃(스퀴즈는 홈, 희생번트는 다음 베이스), 타자는 1루(야수 선택)
        outcome = 'FC';
        g.outs++;
        if (kind === 'squeeze') {
          credits.push({ playerId: pitcher.id, kind: 'A' }, { playerId: fielders.C.id, kind: 'PO' });
          g.bases = [runnerOf(), r1 ?? null, r2 ?? null];
        } else {
          const leadBase = r2 ? 3 : 2;
          credits.push({ playerId: pitcher.id, kind: 'A' }, { playerId: fielders[leadBase === 3 ? '3B' : 'SS'].id, kind: 'PO' });
          g.bases = r2 ? [runnerOf(), r1 ? r1 : null, r3] : [runnerOf(), null, r3];
        }
      }
      break;
    }
    default: {
      // 홈런이 아닌 인플레이 타구: 존 모델(10b). 수비 위치·히트앤드런 출발을 넘긴다
      const hand = battingSide(batter, pitcher);
      // 앵커링 θ(10b §6)는 결정적 계산이라 같은 입력이면 캐시 값을 쓴다.
      const theta = cachedTheta(batter.id * 1_000_003 + pitcher.id, top.shares, batter.batting.power, top.stuff, top.velocityZ, hand, top.x);
      const qualities = qualitiesFor(batter.batting.power, top.stuff, top.velocityZ);
      const r = resolveInPlay(Rng.fromInts(g.bbKey, g.fixtureId, g.seq), {
        batter,
        hand,
        fielders,
        shares: top.shares,
        stuff: top.stuff,
        velocityZ: top.velocityZ,
        theta,
        outs: g.outs,
        bases: g.bases as Bases,
        batterRunner: runnerOf(),
        qualities,
        align: def.align,
        going: hnr,
      });
      g.outs += r.outsAdded;
      for (const sr of r.scored) scoreR(sr.runner, sr.rbi, sr.unearned);
      g.bases = r.bases;
      outcome = r.outcome;
      credits.push(...r.credits);
      bb = { zone: r.zone, type: r.type, quality: r.quality, fielderId: r.fielderId, infieldHit: r.infieldHit };
      break;
    }
  }
  if (g.outs >= 3) g.bases = [null, null, null];
  const outsOnPlay = g.outs - outsBefore;
  // 투구 수(10a 10.4): 승부처 타석은 실제 투구 수, 고의사구는 0(자동 고의사구), 일반 타석은 결과별 투구 수 모델
  const pitches = pending.ibb
    ? 0
    : counted
      ? counted.pitches
      : Math.max(1, Math.round((outcome === 'K' ? SIM.pitches.k : outcome === 'BB' ? SIM.pitches.bb : outcome === 'HBP' ? SIM.pitches.hbp : SIM.pitches.other) + draw(DRAW.pitches).normal(0, SIM.pitches.jitter)));
  def.stint.pitches += pitches;
  def.stint.outs += outsOnPlay;
  afterDefense(g, battingSideOf(half) === 'home' ? 'away' : 'home', outsOnPlay);
  const ev: PaEvent = {
    seq: g.seq,
    inning,
    half,
    battingClub: bat.setup.clubId,
    batterId: batter.id,
    pitcherId: pitcher.id,
    outcome,
    rbi,
    outsBefore,
    outsOnPlay,
    pitches,
    homeScore: g.score.home,
    awayScore: g.score.away,
    credits,
  };
  if (bb) ev.bb = bb;
  if (counted) {
    ev.clutch = true;
    ev.count = { balls: counted.balls, strikes: counted.strikes, fouls: counted.fouls };
    ev.pitchLog = counted.log;
  }
  if (fallback) ev.countFallback = true;
  if (pending.ibb) ev.ibb = true;
  if (outcome0 === 'BUNT') ev.bunt = pending.play === 'squeeze' ? 'squeeze' : 'sac';
  if (hnr) ev.hitAndRun = true;
  g.events.push(ev);
  endOfPlay(g, batSide);
  closeDecision(g, batSide);
  // 히트앤드런 삼진: 출발한 1루 주자의 도루 판정(삼진 뒤 주루 사건)
  if (hnr && outcome === 'K' && g.phase === 'pa' && g.outs < 3 && g.bases[0] && !g.bases[1]) resolveSteal(g, 2, DRAW.hnrSteal);
  return ev;
}

/** 타석·주루 사건 뒤: 끝내기, 반 이닝 종료, 이닝·경기 종료 판정 */
function endOfPlay(g: GameState, batSide: Side): void {
  // 끝내기: 9회 이후 말 공격 중 홈팀이 앞서면 즉시 종료
  if (g.half === 'B' && g.inning >= 9 && g.score.home > g.score.away) {
    g.lineScore[batSide].push(g.halfRuns);
    g.phase = 'over';
    return;
  }
  if (g.outs < 3) return;
  g.lineScore[batSide].push(g.halfRuns);
  if (g.half === 'T') {
    g.half = 'B';
    g.phase = 'halfStart';
    return;
  }
  if (g.inning >= 9 && g.score.home !== g.score.away) g.phase = 'over';
  else if (g.inning >= g.maxInnings) g.phase = 'over';
  else {
    g.inning++;
    g.half = 'T';
    g.phase = 'halfStart';
  }
}

/** 8a(D-180): 수비 아웃을 지금 수비수(투수는 현재 투수, 지명타자 포함)에게 더하고, 현재 투수의 최저 리드를 갱신한다 */
function afterDefense(g: GameState, defSide: Side, outs: number): void {
  const def = g.teams[defSide];
  def.stint.minLead = Math.min(def.stint.minLead, leadFor(g, defSide));
  if (outs <= 0) return;
  const add = (id: PlayerId, pos: string) => {
    const k = `${id}|${pos}`;
    def.defOuts.set(k, (def.defOuts.get(k) ?? 0) + outs);
  };
  for (const pos of FIELD_LIST) add(pos === 'P' ? def.stint.pitcher.id : def.fielders[pos].id, pos);
  const dh = def.lineup.find((s) => s.position === 'DH');
  if (dh) add(dh.player.id, 'DH');
}
const FIELD_LIST: readonly FieldPos[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** 8a(D-180): 홀드·블론세이브·퀄리티 스타트(세이브 상황 = 등판 때 1~3점 리드) */
function pitcherFlags(g: GameState, winningPitcher: PlayerId | null, savePitcher: PlayerId | null): GameResult['pitcherFlags'] {
  const out: GameResult['pitcherFlags'] = [];
  for (const side of ['home', 'away'] as const) {
    const t = g.teams[side];
    const last = t.stints[t.stints.length - 1]!;
    last.leadAtExit = leadFor(g, side);
    t.stints.forEach((st, i) => {
      const er = g.runs.filter((r) => r.pitcherId === st.pitcher.id && r.earned).length;
      const qs = st.isStarter && st.outs >= SIM.qsMinOuts && er <= SIM.qsMaxEr;
      const saveSit = !st.isStarter && st.leadAtEntry >= 1 && st.leadAtEntry <= SIM.saveMaxLead;
      const hold = saveSit && i < t.stints.length - 1 && st.outs >= 1 && (st.leadAtExit ?? 0) >= 1 && st.pitcher.id !== winningPitcher && st.pitcher.id !== savePitcher;
      const blown = saveSit && st.minLead <= 0;
      if (qs || hold || blown) out.push({ clubId: t.setup.clubId, pitcherId: st.pitcher.id, hold, blown, qs });
    });
  }
  return out;
}

/** 8a: 선수·포지션별 수비 아웃 */
function fieldOuts(g: GameState): GameResult['fieldOuts'] {
  const out: GameResult['fieldOuts'] = [];
  for (const side of ['home', 'away'] as const) {
    const t = g.teams[side];
    for (const [k, outs] of t.defOuts) {
      const [id, position] = k.split('|') as [string, string];
      out.push({ clubId: t.setup.clubId, playerId: Number(id), position, outs });
    }
  }
  return out;
}

/** 경기 결과: 승리·패전·세이브 판정 */
export function finishGame(g: GameState): GameResult {
  const score = g.score;
  const outcome: GameResult['outcome'] = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'tie';
  let winningPitcher: PlayerId | null = null;
  let losingPitcher: PlayerId | null = null;
  let savePitcher: PlayerId | null = null;
  const lc = g.leadChange;
  if (outcome !== 'tie' && lc && lc.leader === outcome) {
    const winTeam = g.teams[outcome];
    const starterStint = winTeam.stints[0]!;
    winningPitcher = lc.winnerPitcher;
    if (winningPitcher === starterStint.pitcher.id && starterStint.outs < SIM.winQualifyingOutsForStarter) {
      const relievers = winTeam.stints.slice(1).sort((a, b) => b.outs - a.outs);
      winningPitcher = relievers[0]?.pitcher.id ?? winningPitcher;
    }
    losingPitcher = lc.loserPitcher;
    const last = winTeam.stints[winTeam.stints.length - 1]!;
    if (last.pitcher.id !== winningPitcher && !last.isStarter) {
      const qualifies = (last.leadAtEntry >= 1 && last.leadAtEntry <= SIM.saveMaxLead && last.outs >= SIM.saveMinOuts) || last.outs >= 9;
      if (qualifies) savePitcher = last.pitcher.id;
    }
  }
  const home = g.teams.home.setup;
  const away = g.teams.away.setup;
  return {
    fixtureId: g.fixtureId,
    home: home.clubId,
    away: away.clubId,
    homeRuns: score.home,
    awayRuns: score.away,
    innings: g.inning,
    outcome,
    lineScore: g.lineScore,
    events: g.events,
    plays: g.plays,
    subs: g.subs,
    managerDecisions: g.managerDecisions,
    ownerPoints: g.ownerPoints,
    wpTrack: (['home', 'away'] as const).map((s) => ({ clubId: g.teams[s].setup.clubId, ...g.teams[s].wp })),
    runs: g.runs,
    starters: { home: home.starter.id, away: away.starter.id },
    winningPitcher,
    losingPitcher,
    savePitcher,
    pitcherFlags: pitcherFlags(g, winningPitcher, savePitcher),
    fieldOuts: fieldOuts(g),
  };
}

/** 자동 경기: 감독 AI가 모든 결정을 내린다. env: 시즌 리그 환경(D-100), opts: 성적 혼합 표본·경기 중요도(3b) */
export function simulateGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, opts: GameOptions = {}): GameResult {
  const g = createGame(fixtureId, home, away, rng, maxInnings, env, opts);
  runGame(g);
  return finishGame(g);
}

/** 이 결정 지점이 구단주 참여 지점인가(D-174 (2)): 우리 경기, 7회 이후, 승부처 레버리지, 경기당 상한 */
function ownerRoleAt(g: GameState, d: DecisionPoint, ctl: OwnerControl): 'off' | 'def' | null {
  const role = g.teams[d.batSide].setup.clubId === ctl.clubId ? 'off' : g.teams[d.side].setup.clubId === ctl.clubId ? 'def' : null;
  if (!role || d.inning < CLUTCH.minInning || g.ownerPoints >= ctl.maxPerGame) return null;
  const li = leverage(g.inning, g.half, g.outs, basesMask(g.bases), g.score.home - g.score.away, g.opts.postseason === true);
  return li >= CLUTCH.leverageThreshold ? role : null;
}

/**
 * 경기 진행 루프: 결정 지점마다 감독 AI 추천을 만들고, 구단주 참여 지점이면 기록된 구단주 지시를 합친다.
 * 지시가 없고 pauseWhenMissing이면 OwnerPause를 던진다(관전 미리보기). 상태 g는 호출하는 쪽이 들고 있다.
 */
export function runGame(g: GameState): void {
  const ctl = g.opts.owner;
  for (let d = nextDecision(g); d; d = nextDecision(g)) {
    const rec = managerDecide(g, d);
    let dir = rec;
    let override: Side | null = null;
    const role = ctl ? ownerRoleAt(g, d, ctl) : null;
    if (ctl && role) {
      g.ownerPoints++;
      g.ownerPaKey = d.key;
      if (ctl.enabled) {
        const o = ctl.prePa(d.key);
        if (o === undefined && ctl.pauseWhenMissing) {
          g.ownerPoints--;
          throw new OwnerPause({ kind: 'prePa', key: d.key, role, recommended: rec });
        }
        if (o) {
          const merged = mergeOwner(rec, o, role);
          // 규칙에 어긋난 기록은 쓰지 않는다(기록 때 이미 검사하므로 안전장치)
          if (directiveError(g, d, merged) === null) {
            dir = merged;
            if (!sameSide(merged, rec, role)) override = role === 'off' ? d.batSide : d.side;
          }
        }
      }
    }
    applyDirective(g, d, dir, override);
    stepPlateAppearance(g);
  }
}
