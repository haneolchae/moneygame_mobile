// 타석 단위 경기 시뮬레이션 (10 문서).
// 승패와 개인 성적은 같은 사건 기록(타석·득점)에서 나온다. 결과를 먼저 정하지 않는다.
//
// 4c-0(D-164) 구조: 경기 상태(GameState) → 결정 지점(nextDecision) → 지시 적용(applyDirective) → 타석 1개 진행(stepPlateAppearance).
// 자동 경기(simulateGame)는 감독 AI(managerDecide)가 모든 결정을 내리는 같은 루프다. 구단주 참여(4c-3)는 같은 결정 지점에서
// 다른 지시를 넣는다. 4c-0은 구조만 바꿨고 난수 사용 순서와 확률 계산은 전환 전과 같다(고정 시드 결과 완전 일치 시험).
//
// 첫 개발 단계의 단순화 (ASSUMPTION(D-091), 설정·후속 단계에서 확장). 타석 결과 확률은 probability.ts(10a):
//  - 도루·폭투·견제·대타·대수비·좌우 상대 보정·고의사구·희생번트는 아직 없다(4c-2).
//  - 실책으로 출루한 주자와 실책 플레이로 들어온 득점만 비자책으로 처리한다.
//  - 승리투수: 결승점 시점의 투수. 선발이 5이닝(15아웃) 미만이면 가장 많은 아웃을 잡은 구원투수.
//  - 홀드는 아직 판정하지 않는다.
import { SIM } from './config';
import { BATTER_DIRECTION, consistencyPerformance, FORM_EVENTS, pressureIndex, pressureLoss, type PlayerForm } from './form';
import { batterSide, battingSide, combineTop, effectivePitching, framingContext, NEUTRAL_ENVIRONMENT, paProbabilities, pitcherSide, typeShares, type DefenseContext, type LeagueEnvironment, type SideLogits, type TopLevel } from './probability';
import { Rng } from './rng';
import type { ClubId, FixtureId, PlayerId, PlayerTruth, Position } from './types';
import { cachedTheta, qualityDist, resolveInPlay, type Bases, type Credit, type FieldPos, type Fielders, type Runner } from './zone';
import type { BallType, Quality } from './zoneConfig';

/** FC: 야수 선택(타자는 살고 다른 주자가 아웃되거나 진루) */
export type PaOutcome = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'HBP' | 'K' | 'GO' | 'FO' | 'DP' | 'SF' | 'ROE' | 'FC';
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
  /** 인플레이 타구 정보(구역·유형·질·처리 수비수). 홈런·볼넷·삼진은 없음 */
  bb?: { zone: string; type: BallType; quality: Quality; fielderId: PlayerId; infieldHit: boolean };
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
  runs: RunEvent[];
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
}

export interface TeamState {
  setup: TeamSetup;
  orderIndex: number;
  stint: PitcherStint;
  stints: PitcherStint[];
  usedRelievers: Set<PlayerId>;
  /** 수비 위치(라인업 포지션). 투수는 타석마다 현재 투수로 채운다 */
  fielders: Fielders;
}

export type Side = 'home' | 'away';

export { paProbabilities };

/** 경기 입력(3b): 경기 시작 때 고정한 선수별 최근·과거 표본(10a 4·7장)과 경기 중요도 */
export interface GameOptions {
  forms?: { batter: ReadonlyMap<PlayerId, PlayerForm>; pitcher: ReadonlyMap<PlayerId, PlayerForm> };
  postseason?: boolean;
}

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
}

/** 결정 지점. 4c-0에는 타석 전 투수 교체 판단 하나뿐이다(작전·대타 등은 4c-2) */
export interface PitcherDecision {
  kind: 'pitcher';
  /** 수비 쪽 */
  side: Side;
  inning: number;
  atInningStart: boolean;
}
export type DecisionPoint = PitcherDecision;

/** 지시. pitcherId가 null이면 지금 투수가 계속 던진다 */
export interface PitcherDirective {
  kind: 'pitcher';
  pitcherId: PlayerId | null;
}
export type Directive = PitcherDirective;

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

function makeTeam(setup: TeamSetup): TeamState {
  const stint: PitcherStint = { pitcher: setup.starter, isStarter: true, pitches: 0, outs: 0, runs: 0, leadAtEntry: 0, outsAtEntryOfInning: true };
  const fielders = { P: stint.pitcher } as Fielders;
  for (const spot of setup.lineup) if (spot.position !== 'DH') fielders[spot.position as FieldPos] = spot.player;
  return { setup, orderIndex: 0, stint, stints: [stint], usedRelievers: new Set(), fielders };
}

/** 경기 상태 만들기. env: 시즌 리그 환경(D-100), opts: 성적 혼합 표본·경기 중요도(3b) */
export function createGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, opts: GameOptions = {}): GameState {
  const teams = { home: makeTeam(home), away: makeTeam(away) };
  // 타석별 하위 난수 흐름(10b §12): 인플레이 타구 판정은 (경기 키, 타석 순번)에서 파생한 난수를 쓴다.
  const bbKey = rng.int(0, 2_000_000_000);
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
  g.phase = 'pa';
}

/** 다음 타석 전 결정 지점. 경기가 끝났으면 null */
export function nextDecision(g: GameState): DecisionPoint | null {
  settle(g);
  if (g.phase === 'over') return null;
  return { kind: 'pitcher', side: other(battingSideOf(g.half)), inning: g.inning, atInningStart: g.atHalfStart };
}

/** 감독 AI: 선발 투구 수·실점 한도, 구원 투구 수, 세이브 상황 마무리, 접전이면 좋은 불펜(10 문서 감독 판단) */
export function managerDecide(g: GameState, d: DecisionPoint): Directive {
  const t = g.teams[d.side];
  const s = t.stint;
  const lead = leadFor(g, d.side);
  const available = t.setup.bullpen.filter((p) => !t.usedRelievers.has(p.id));
  const closerAvailable = t.setup.closer && !t.usedRelievers.has(t.setup.closer.id) && s.pitcher.id !== t.setup.closer.id;
  let needChange = false;
  if (s.isStarter) {
    const limit = SIM.starterPitchLimitBase + SIM.starterPitchLimitPerStamina * (s.pitcher.pitching?.stamina ?? 50);
    needChange = s.pitches >= limit || s.runs >= SIM.starterRunsBeforeHook;
  } else {
    needChange = s.pitches >= SIM.relieverPitchLimit || (d.atInningStart && s.outs >= 3);
  }
  const saveSituation = d.atInningStart && d.inning >= 9 && lead >= 1 && lead <= SIM.closerMaxLead;
  if (saveSituation && closerAvailable) needChange = true;
  if (!needChange) return { kind: 'pitcher', pitcherId: null };
  let next: PlayerTruth | undefined;
  if (saveSituation && closerAvailable) next = t.setup.closer!;
  else if (available.length > 0) {
    const close = d.inning >= 7 && Math.abs(lead) <= 3;
    // 불펜은 품질순 정렬되어 있다. 접전이면 좋은 투수, 아니면 뒤쪽 투수를 쓴다.
    next = close ? available[0] : available[available.length - 1];
  } else if (closerAvailable) next = t.setup.closer!;
  // 남은 투수가 없으면 현재 투수가 계속 던진다.
  return { kind: 'pitcher', pitcherId: next ? next.id : null };
}

/** 지시가 규칙에 맞지 않는 이유(없으면 null). 감독 AI와 구단주 지시가 같은 검사를 쓴다 */
export function directiveError(g: GameState, d: DecisionPoint, dir: Directive): string | null {
  if (dir.pitcherId === null) return null;
  const t = g.teams[d.side];
  if (dir.pitcherId === t.stint.pitcher.id) return null;
  const pool = [...t.setup.bullpen, ...(t.setup.closer ? [t.setup.closer] : [])];
  if (!pool.some((p) => p.id === dir.pitcherId)) return '출전 가능한 불펜 투수가 아닙니다.';
  if (t.usedRelievers.has(dir.pitcherId)) return '이미 등판한 투수는 다시 나올 수 없습니다.';
  return null;
}

/** 지시 적용(투수 교체). 호출자는 directiveError로 먼저 검사한다 */
export function applyDirective(g: GameState, d: DecisionPoint, dir: Directive): void {
  if (dir.pitcherId === null) return;
  const t = g.teams[d.side];
  if (dir.pitcherId === t.stint.pitcher.id) return;
  const next = [...t.setup.bullpen, ...(t.setup.closer ? [t.setup.closer] : [])].find((p) => p.id === dir.pitcherId)!;
  t.usedRelievers.add(next.id);
  const stint: PitcherStint = { pitcher: next, isStarter: false, pitches: 0, outs: 0, runs: 0, leadAtEntry: leadFor(g, d.side), outsAtEntryOfInning: d.atInningStart };
  t.stints.push(stint);
  t.stint = stint;
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
  g.runs.push({ seq: g.seq, battingClub: g.teams[batSide].setup.clubId, runnerId: runner.id, pitcherId: runner.pitcherId, earned: runner.earned && !extraUnearned });
  const responsible = g.teams[defSide].stints.find((st) => st.pitcher.id === runner.pitcherId);
  if (responsible) responsible.runs++;
  if (before === 0) {
    // 이 득점으로 리드를 잡았다.
    g.leadChange = { leader: batSide, winnerPitcher: g.teams[batSide].stint.pitcher.id, loserPitcher: runner.pitcherId };
  }
}

/** 타석 1개 진행(결정 지점 처리 뒤). 반 이닝·이닝 종료와 경기 종료까지 상태에 반영한다 */
export function stepPlateAppearance(g: GameState): PaEvent {
  settle(g);
  if (g.phase === 'over') throw new Error('경기가 끝났습니다.');
  g.atHalfStart = false;
  const batSide = battingSideOf(g.half);
  const defSide = other(batSide);
  const bat = g.teams[batSide];
  const def = g.teams[defSide];
  const spot = bat.setup.lineup[bat.orderIndex % 9]!;
  bat.orderIndex++;
  const batter = spot.player;
  const pitcher = def.stint.pitcher;
  const { inning, half } = g;
  // 타석 위 단계 확률(10a 5·6장): 대결 한쪽 값 + 사건별 상황 보정(프레이밍 + 방향 계수 × (타자 수행 − 투수 수행))
  const bases0 = g.bases;
  const pressure = pressureIndex({ inning, scoreDiff: g.score.home - g.score.away, runners: (bases0[0] ? 1 : 0) + (bases0[1] ? 1 : 0) + (bases0[2] ? 1 : 0), postseason: g.opts.postseason === true });
  const batPerf = perfOf(g, batter) - pressureLoss(pressure, batter.batting.mental, batter.hidden.pressureSensitivity);
  const pitPerf = perfOf(g, pitcher) - pressureLoss(pressure, pitcher.pitching?.mental ?? 50, pitcher.hidden.pressureSensitivity);
  const fr = g.framing[defSide];
  const context = {} as SideLogits;
  for (const e of FORM_EVENTS) context[e] = fr[e] + BATTER_DIRECTION[e] * (batPerf - pitPerf);
  const eff = effectivePitching(pitcher);
  const top = combineTop(sideOf(g, batter, 'batter'), sideOf(g, pitcher, 'pitcher'), g.env, context, typeShares(batter, pitcher), eff.stuff, eff.velocityZ) as TopLevel;
  const outcome0 = drawTop(g.rng, top);
  let outcome: PaOutcome = outcome0 === 'INPLAY' ? 'GO' : outcome0;
  let rbi = 0;
  const outsBefore = g.outs;
  const runnerOf = (earned = true): Runner => ({ id: batter.id, speed: batter.batting.speed, baserunning: batter.batting.baserunning, pitcherId: pitcher.id, earned });
  const scoreR = (r: Runner, credit: boolean, unearned = false) => {
    scoreRun(g, batSide, r, unearned);
    g.halfRuns++;
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
    default: {
      // 홈런이 아닌 인플레이 타구: 존 모델(10b)
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
  const outsOnPlay = g.outs - outsBefore;
  const pitches = Math.max(1, Math.round(
    (outcome === 'K' ? SIM.pitches.k : outcome === 'BB' ? SIM.pitches.bb : outcome === 'HBP' ? SIM.pitches.hbp : SIM.pitches.other) +
      g.rng.normal(0, SIM.pitches.jitter),
  ));
  def.stint.pitches += pitches;
  def.stint.outs += outsOnPlay;
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
  g.events.push(ev);
  endOfPlay(g, batSide);
  return ev;
}

/** 타석 뒤: 끝내기, 반 이닝 종료, 이닝·경기 종료 판정 */
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
    runs: g.runs,
    starters: { home: home.starter.id, away: away.starter.id },
    winningPitcher,
    losingPitcher,
    savePitcher,
  };
}

/** 자동 경기: 감독 AI가 모든 결정을 내린다. env: 시즌 리그 환경(D-100), opts: 성적 혼합 표본·경기 중요도(3b) */
export function simulateGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, opts: GameOptions = {}): GameResult {
  const g = createGame(fixtureId, home, away, rng, maxInnings, env, opts);
  for (let d = nextDecision(g); d; d = nextDecision(g)) {
    applyDirective(g, d, managerDecide(g, d));
    stepPlateAppearance(g);
  }
  return finishGame(g);
}
