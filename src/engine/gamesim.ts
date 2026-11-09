// 타석 단위 경기 시뮬레이션 (10 문서).
// 승패와 개인 성적은 같은 사건 기록(타석·득점)에서 나온다. 결과를 먼저 정하지 않는다.
//
// 첫 개발 단계의 단순화 (ASSUMPTION(D-091), 설정·후속 단계에서 확장). 타석 결과 확률은 probability.ts(10a):
//  - 도루·폭투·견제·대타·대수비·좌우 상대 보정·고의사구·희생번트는 아직 없다.
//  - 실책으로 출루한 주자와 실책 플레이로 들어온 득점만 비자책으로 처리한다.
//  - 승리투수: 결승점 시점의 투수. 선발이 5이닝(15아웃) 미만이면 가장 많은 아웃을 잡은 구원투수.
//  - 홀드는 아직 판정하지 않는다.
import { SIM } from './config';
import { NEUTRAL_ENVIRONMENT, paProbabilities, type DefenseContext, type LeagueEnvironment } from './probability';
import type { Rng } from './rng';
import type { ClubId, FixtureId, PlayerId, PlayerTruth, Position } from './types';

export type PaOutcome = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'HBP' | 'K' | 'GO' | 'FO' | 'DP' | 'SF' | 'ROE';
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

interface Runner {
  id: PlayerId;
  speed: number;
  pitcherId: PlayerId;
  earned: boolean;
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

const fx = (k: number, x: number) => Math.exp((k * (x - 50)) / 50);
const clampP = (p: number) => Math.max(0.01, Math.min(0.97, p));

export { paProbabilities };

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

const speedAdj = (p: number, speed: number) => clampP(p * fx(0.5, speed));

/** env: 시즌 리그 환경(D-100) */
export function simulateGame(fixtureId: FixtureId, home: TeamSetup, away: TeamSetup, rng: Rng, maxInnings: number, env: LeagueEnvironment = NEUTRAL_ENVIRONMENT): GameResult {
  const makeTeam = (setup: TeamSetup): TeamState => {
    const stint: PitcherStint = { pitcher: setup.starter, isStarter: true, pitches: 0, outs: 0, runs: 0, leadAtEntry: 0, outsAtEntryOfInning: true };
    return { setup, orderIndex: 0, stint, stints: [stint], usedRelievers: new Set() };
  };
  const teams = { home: makeTeam(home), away: makeTeam(away) };
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
        const outcome0 = drawOutcome(rng, paProbabilities(batter, pitcher, def.setup.defense, env));
        let outcome: PaOutcome = outcome0;
        let rbi = 0;
        const outsBefore = outs;
        const runnerOf = (earned = true): Runner => ({ id: batter.id, speed: SIM.runnerSpeedWeight * batter.batting.speed + (1 - SIM.runnerSpeedWeight) * batter.batting.baserunning, pitcherId: pitcher.id, earned });
        const scoreR = (r: Runner, credit: boolean, unearned = false) => {
          scoreRun(batSide, r, unearned);
          halfRuns++;
          if (credit) rbi++;
        };
        seq++;
        switch (outcome0) {
          case 'HR': {
            for (const r of bases) if (r) scoreR(r, true);
            scoreR(runnerOf(), true);
            bases = [null, null, null];
            break;
          }
          case '3B': {
            for (const r of bases) if (r) scoreR(r, true);
            bases = [null, null, runnerOf()];
            break;
          }
          case '2B': {
            const [r1, r2, r3] = bases;
            if (r3) scoreR(r3, true);
            if (r2) scoreR(r2, true);
            let third: Runner | null = null;
            if (r1) {
              if (rng.chance(speedAdj(SIM.advance.doubleScoresFromFirst, r1.speed))) scoreR(r1, true);
              else third = r1;
            }
            bases = [null, runnerOf(), third];
            break;
          }
          case '1B': {
            const [r1, r2, r3] = bases;
            if (r3) scoreR(r3, true);
            let third: Runner | null = null;
            if (r2) {
              if (rng.chance(speedAdj(SIM.advance.singleScoresFromSecond, r2.speed))) scoreR(r2, true);
              else third = r2;
            }
            let second: Runner | null = null;
            if (r1) {
              if (!third && rng.chance(speedAdj(SIM.advance.singleFirstToThird, r1.speed))) third = r1;
              else second = r1;
            }
            bases = [runnerOf(), second, third];
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
          case 'ROE': {
            const [r1, r2, r3] = bases;
            if (r3) scoreR(r3, false, true);
            bases = [runnerOf(false), r1, r2];
            break;
          }
          case 'K': {
            outs++;
            break;
          }
          case 'GO': {
            const [r1, r2, r3] = bases;
            if (r1 && outs < 2 && rng.chance(SIM.advance.doublePlay)) {
              outcome = 'DP';
              outs += 2;
              let third: Runner | null = r3;
              if (outs < 3) {
                if (r3) {
                  scoreR(r3, false);
                  third = null;
                }
                bases = [null, null, r2 ?? third];
              } else bases = [null, null, null];
              break;
            }
            // 타자 아웃. 3루·2루 주자는 확률로 진루하고, 1루 주자는 2루로 가며 앞 주자를 밀어낸다.
            outs++;
            let third: Runner | null = r3;
            let second: Runner | null = r2;
            if (r3 && outs < 3 && rng.chance(speedAdj(SIM.advance.groundoutAdvance, r3.speed))) {
              scoreR(r3, true);
              third = null;
            }
            if (second && !third && outs < 3 && rng.chance(SIM.advance.groundoutAdvance)) {
              third = second;
              second = null;
            }
            if (r1 && outs < 3) {
              if (second) {
                if (third) scoreR(third, true);
                third = second;
              }
              second = r1;
            }
            bases = outs < 3 ? [null, second, third] : [null, null, null];
            break;
          }
          case 'FO': {
            const [r1, r2, r3] = bases;
            outs++;
            let third: Runner | null = r3;
            if (r3 && outs < 3 && rng.chance(speedAdj(SIM.advance.sacFlyFromThird, r3.speed))) {
              outcome = 'SF';
              scoreR(r3, true);
              third = null;
            }
            let second: Runner | null = r2;
            if (r2 && !third && outs < 3 && rng.chance(SIM.advance.flyoutSecondToThird)) {
              third = r2;
              second = null;
            }
            bases = [r1, second, third];
            break;
          }
          default:
            break;
        }
        const outsOnPlay = outs - outsBefore;
        const pitches = Math.max(1, Math.round(
          (outcome0 === 'K' ? SIM.pitches.k : outcome0 === 'BB' ? SIM.pitches.bb : outcome0 === 'HBP' ? SIM.pitches.hbp : SIM.pitches.other) +
            rng.normal(0, SIM.pitches.jitter),
        ));
        def.stint.pitches += pitches;
        def.stint.outs += outsOnPlay;
        events.push({
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
        });
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
