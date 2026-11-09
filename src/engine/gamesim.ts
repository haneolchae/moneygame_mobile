// 타석 단위 경기 시뮬레이션 (10 문서).
// 승패와 개인 성적은 같은 사건 기록(타석·득점)에서 나온다. 결과를 먼저 정하지 않는다.
//
// 첫 개발 단계의 단순화 (ASSUMPTION(D-091), 설정·후속 단계에서 확장). 타석 결과 확률은 probability.ts(10a):
//  - 도루·폭투·견제·대타·대수비·좌우 상대 보정·고의사구·희생번트는 아직 없다.
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

interface PitcherStint {
  pitcher: PlayerTruth;
  isStarter: boolean;
  pitches: number;
  outs: number;
  runs: number;
  leadAtEntry: number;
  outsAtEntryOfInning: boolean;
}

interface TeamState {
  setup: TeamSetup;
  orderIndex: number;
  stint: PitcherStint;
  stints: PitcherStint[];
  usedRelievers: Set<PlayerId>;
}

export { paProbabilities };

/** 경기 입력(3b): 경기 시작 때 고정한 선수별 최근·과거 표본(10a 4·7장)과 경기 중요도 */
export interface GameOptions {
  forms?: { batter: ReadonlyMap<PlayerId, PlayerForm>; pitcher: ReadonlyMap<PlayerId, PlayerForm> };
  postseason?: boolean;
}

/** 타석 위 단계 추첨(순서 고정: 볼넷·삼진·홈런·사구·인플레이) */
function drawTop(rng: Rng, p: { BB: number; K: number; HR: number; HBP: number }): PaOutcome | 'INPLAY' {
  let r = rng.next();
  if ((r -= p.BB) < 0) return 'BB';
  if ((r -= p.K) < 0) return 'K';
  if ((r -= p.HR) < 0) return 'HR';
  if ((r -= p.HBP) < 0) return 'HBP';
  return 'INPLAY';
}

function drawOutcome(rng: Rng, probs: Record<string, number>): PaOutcome {
  let r = rng.next();
  let last: string = 'FO';
  for (const [key, value] of Object.entries(probs)) {
    last = key;
    r -= value;
    if (r < 0) return key as PaOutcome;
  }
  return last as PaOutcome;
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

/** env: 시즌 리그 환경(D-100), opts: 성적 혼합 표본·경기 중요도(3b) */
export function simulateGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT, opts: GameOptions = {}): GameResult {
  const makeTeam = (setup: TeamSetup): TeamState => {
    const stint: PitcherStint = { pitcher: setup.starter, isStarter: true, pitches: 0, outs: 0, runs: 0, leadAtEntry: 0, outsAtEntryOfInning: true };
    return { setup, orderIndex: 0, stint, stints: [stint], usedRelievers: new Set() };
  };
  const teams = { home: makeTeam(home), away: makeTeam(away) };
  // 타석별 하위 난수 흐름(10b §12): 인플레이 타구 판정은 (경기 키, 타석 순번)에서 파생한 난수를 쓴다.
  const bbKey = rng.int(0, 2_000_000_000);

  // 수비 위치(라인업 포지션). 투수는 타석마다 현재 투수로 채운다.
  const fieldersOf = (t: TeamState): Fielders => {
    const f = { P: t.stint.pitcher } as Fielders;
    for (const spot of t.setup.lineup) if (spot.position !== 'DH') f[spot.position as FieldPos] = spot.player;
    return f;
  };
  const homeFielders = fieldersOf(teams.home);
  const awayFielders = fieldersOf(teams.away);

  // 대결 한쪽 값(성적 혼합 포함)과 경기별 수행 편차는 선수마다 경기당 한 번 계산한다(10a 6.1·7장).
  const batSides = new Map<PlayerId, SideLogits>();
  const pitSides = new Map<PlayerId, SideLogits>();
  const perf = new Map<PlayerId, number>();
  const sideOf = (p: PlayerTruth, role: 'batter' | 'pitcher'): SideLogits => {
    const cache = role === 'batter' ? batSides : pitSides;
    let v = cache.get(p.id);
    if (!v) {
      v = role === 'batter' ? batterSide(p, env, opts.forms?.batter.get(p.id)) : pitcherSide(p, env, opts.forms?.pitcher.get(p.id));
      cache.set(p.id, v);
    }
    return v;
  };
  // u_game: 선수·경기별 1회 추첨(저장되는 경기 난수에서 파생, 타석 흐름과 겹치지 않게 음수 키)
  const perfOf = (p: PlayerTruth): number => {
    let v = perf.get(p.id);
    if (v === undefined) {
      v = consistencyPerformance(p.hidden.consistency, Rng.fromInts(bbKey, fixtureId, -p.id).next() * 2 - 1);
      perf.set(p.id, v);
    }
    return v;
  };
  const framing = { home: framingContext(home.defense), away: framingContext(away.defense) };

  const score = { home: 0, away: 0 };
  const lineScore = { home: [] as number[], away: [] as number[] };
  const events: PaEvent[] = [];
  const runs: RunEvent[] = [];
  let seq = 0;

  // 결승점 추적: 리드가 바뀔 때마다 기록한다.
  let leadChange: { leader: 'home' | 'away'; winnerPitcher: PlayerId; loserPitcher: PlayerId } | null = null;

  const leadFor = (side: 'home' | 'away') => (side === 'home' ? score.home - score.away : score.away - score.home);

  const choosePitcher = (defSide: 'home' | 'away', inning: number, atInningStart: boolean) => {
    const t = teams[defSide];
    const s = t.stint;
    const lead = leadFor(defSide);
    const available = t.setup.bullpen.filter((p) => !t.usedRelievers.has(p.id));
    const closerAvailable = t.setup.closer && !t.usedRelievers.has(t.setup.closer.id) && s.pitcher.id !== t.setup.closer.id;
    let needChange = false;
    if (s.isStarter) {
      const limit = SIM.starterPitchLimitBase + SIM.starterPitchLimitPerStamina * (s.pitcher.pitching?.stamina ?? 50);
      needChange = s.pitches >= limit || s.runs >= SIM.starterRunsBeforeHook;
    } else {
      needChange = s.pitches >= SIM.relieverPitchLimit || (atInningStart && s.outs >= 3);
    }
    const saveSituation = atInningStart && inning >= 9 && lead >= 1 && lead <= SIM.closerMaxLead;
    if (saveSituation && closerAvailable) needChange = true;
    if (!needChange) return;
    let next: PlayerTruth | undefined;
    if (saveSituation && closerAvailable) next = t.setup.closer!;
    else if (available.length > 0) {
      const close = inning >= 7 && Math.abs(lead) <= 3;
      // 불펜은 품질순 정렬되어 있다. 접전이면 좋은 투수, 아니면 뒤쪽 투수를 쓴다.
      next = close ? available[0] : available[available.length - 1];
    } else if (closerAvailable) next = t.setup.closer!;
    if (!next) return; // 남은 투수가 없으면 현재 투수가 계속 던진다.
    t.usedRelievers.add(next.id);
    const stint: PitcherStint = { pitcher: next, isStarter: false, pitches: 0, outs: 0, runs: 0, leadAtEntry: lead, outsAtEntryOfInning: atInningStart };
    t.stints.push(stint);
    t.stint = stint;
  };

  const scoreRun = (batSide: 'home' | 'away', runner: Runner, extraUnearned: boolean) => {
    const defSide = batSide === 'home' ? 'away' : 'home';
    const before = leadFor(batSide);
    score[batSide]++;
    runs.push({ seq, battingClub: teams[batSide].setup.clubId, runnerId: runner.id, pitcherId: runner.pitcherId, earned: runner.earned && !extraUnearned });
    const responsible = teams[defSide].stints.find((st) => st.pitcher.id === runner.pitcherId);
    if (responsible) responsible.runs++;
    if (before === 0) {
      // 이 득점으로 리드를 잡았다.
      leadChange = { leader: batSide, winnerPitcher: teams[batSide].stint.pitcher.id, loserPitcher: runner.pitcherId };
    }
  };

  let inning = 1;
  let gameOver = false;
  while (!gameOver) {
    for (const half of ['T', 'B'] as const) {
      const batSide = half === 'T' ? 'away' : 'home';
      const defSide = half === 'T' ? 'home' : 'away';
      // 9회 이후 말 공격 전에 홈팀이 앞서면 경기 종료
      if (half === 'B' && inning >= 9 && score.home > score.away) {
        lineScore.home.push(-1); // -1: 말 공격 없음(X)
        gameOver = true;
        break;
      }
      const bat = teams[batSide];
      const def = teams[defSide];
      let outs = 0;
      let bases: [Runner | null, Runner | null, Runner | null] = [null, null, null];
      let halfRuns = 0;
      let first = true;
      while (outs < 3) {
        choosePitcher(defSide, inning, first);
        first = false;
        const spot = bat.setup.lineup[bat.orderIndex % 9]!;
        bat.orderIndex++;
        const batter = spot.player;
        const pitcher = def.stint.pitcher;
        // 타석 위 단계 확률(10a 5·6장): 대결 한쪽 값 + 사건별 상황 보정(프레이밍 + 방향 계수 × (타자 수행 − 투수 수행))
        const pressure = pressureIndex({ inning, scoreDiff: score.home - score.away, runners: (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0), postseason: opts.postseason === true });
        const batPerf = perfOf(batter) - pressureLoss(pressure, batter.batting.mental, batter.hidden.pressureSensitivity);
        const pitPerf = perfOf(pitcher) - pressureLoss(pressure, pitcher.pitching?.mental ?? 50, pitcher.hidden.pressureSensitivity);
        const fr = framing[defSide];
        const context = {} as SideLogits;
        for (const e of FORM_EVENTS) context[e] = fr[e] + BATTER_DIRECTION[e] * (batPerf - pitPerf);
        const eff = effectivePitching(pitcher);
        const top = combineTop(sideOf(batter, 'batter'), sideOf(pitcher, 'pitcher'), env, context, typeShares(batter, pitcher), eff.stuff, eff.velocityZ) as TopLevel;
        const outcome0 = drawTop(rng, top);
        let outcome: PaOutcome = outcome0 === 'INPLAY' ? 'GO' : outcome0;
        let rbi = 0;
        const outsBefore = outs;
        const runnerOf = (earned = true): Runner => ({ id: batter.id, speed: batter.batting.speed, baserunning: batter.batting.baserunning, pitcherId: pitcher.id, earned });
        const scoreR = (r: Runner, credit: boolean, unearned = false) => {
          scoreRun(batSide, r, unearned);
          halfRuns++;
          if (credit) rbi++;
        };
        const fielders = def === teams.home ? homeFielders : awayFielders;
        fielders.P = pitcher;
        const credits: Credit[] = [];
        let bb: PaEvent['bb'];
        seq++;
        switch (outcome0) {
          case 'HR': {
            for (const r of bases) if (r) scoreR(r, true);
            scoreR(runnerOf(), true);
            bases = [null, null, null];
            break;
          }
          case 'BB':
          case 'HBP': {
            // 밀어내기: 앞 베이스가 차 있을 때만 주자가 진루한다.
            const [r1, r2, r3] = bases;
            if (r1 && r2 && r3) scoreR(r3, true);
            bases = [runnerOf(), r1 ?? r2, r1 && r2 ? r2 : r3];
            break;
          }
          case 'K': {
            outs++;
            credits.push({ playerId: fielders.C.id, kind: 'PO' }); // 삼진 자살은 포수
            break;
          }
          default: {
            // 홈런이 아닌 인플레이 타구: 존 모델(10b)
            const hand = battingSide(batter, pitcher);
            // 앵커링 θ(10b §6)는 결정적 계산이라 같은 입력이면 캐시 값을 쓴다.
            const theta = cachedTheta(batter.id * 1_000_003 + pitcher.id, top.shares, batter.batting.power, top.stuff, top.velocityZ, hand, top.x);
            const qualities = qualitiesFor(batter.batting.power, top.stuff, top.velocityZ);
            const r = resolveInPlay(Rng.fromInts(bbKey, fixtureId, seq), {
              batter,
              hand,
              fielders,
              shares: top.shares,
              stuff: top.stuff,
              velocityZ: top.velocityZ,
              theta,
              outs,
              bases: bases as Bases,
              batterRunner: runnerOf(),
              qualities,
            });
            outs += r.outsAdded;
            for (const sr of r.scored) scoreR(sr.runner, sr.rbi, sr.unearned);
            bases = r.bases;
            outcome = r.outcome;
            credits.push(...r.credits);
            bb = { zone: r.zone, type: r.type, quality: r.quality, fielderId: r.fielderId, infieldHit: r.infieldHit };
            break;
          }
        }
        const outsOnPlay = outs - outsBefore;
        const pitches = Math.max(1, Math.round(
          (outcome === 'K' ? SIM.pitches.k : outcome === 'BB' ? SIM.pitches.bb : outcome === 'HBP' ? SIM.pitches.hbp : SIM.pitches.other) +
            rng.normal(0, SIM.pitches.jitter),
        ));
        def.stint.pitches += pitches;
        def.stint.outs += outsOnPlay;
        const ev: PaEvent = {
          seq,
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
          homeScore: score.home,
          awayScore: score.away,
          credits,
        };
        if (bb) ev.bb = bb;
        events.push(ev);
        // 끝내기: 9회 이후 말 공격 중 홈팀이 앞서면 즉시 종료
        if (half === 'B' && inning >= 9 && score.home > score.away) {
          gameOver = true;
          break;
        }
      }
      lineScore[batSide].push(halfRuns);
      if (gameOver) break;
    }
    if (gameOver) break;
    if (inning >= 9 && score.home !== score.away) gameOver = true;
    else if (inning >= maxInnings) gameOver = true;
    else inning++;
  }

  const outcome: GameResult['outcome'] = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'tie';
  let winningPitcher: PlayerId | null = null;
  let losingPitcher: PlayerId | null = null;
  let savePitcher: PlayerId | null = null;
  const lc = leadChange as { leader: 'home' | 'away'; winnerPitcher: PlayerId; loserPitcher: PlayerId } | null;
  if (outcome !== 'tie' && lc && lc.leader === outcome) {
    const winTeam = teams[outcome];
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

  return {
    fixtureId,
    home: home.clubId,
    away: away.clubId,
    homeRuns: score.home,
    awayRuns: score.away,
    innings: inning,
    outcome,
    lineScore,
    events,
    runs,
    starters: { home: home.starter.id, away: away.starter.id },
    winningPitcher,
    losingPitcher,
    savePitcher,
  };
}
