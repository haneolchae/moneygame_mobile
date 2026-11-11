// 8e 올스타전(D-189·25 문서): 일정, 팀 구분, 박스 기록, 미스터 올스타 점수, 홈런 레이스. 상태가 없는 순수 함수만 둔다.
import { addDays, type GameDate } from './calendar';
import { ALLSTAR as AS } from './config';
import type { GameResult } from './gamesim';
import { sigmoid } from './mathx';
import { batterSide } from './probability';
import { Rng } from './rng';
import { seasonKeyDates } from './schedule';
import type { ClubId, PlayerId, PlayerTruth } from './types';

export type AllStarTeam = 'dream' | 'nanum';
export const ALLSTAR_TEAMS: readonly AllStarTeam[] = ['dream', 'nanum'];
export const TEAM_LABEL: Record<AllStarTeam, string> = { dream: '드림', nanum: '나눔' };
/** 드림 = 홀수 번호, 나눔 = 짝수 번호(번호 고정) */
export const teamOfClub = (c: ClubId): AllStarTeam => (c % 2 === 1 ? 'dream' : 'nanum');

/** 베스트 12 자리(외야 셋은 한 자리 묶음) */
export const BEST_SLOTS = ['SP', 'MRP', 'CL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'] as const;
export type BestSlot = (typeof BEST_SLOTS)[number];
export const SLOT_SIZE = (s: string) => (s === 'OF' ? 3 : 1);
export const SLOT_LABEL: Record<string, string> = { SP: '선발 투수', MRP: '중간 투수', CL: '마무리 투수', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', OF: '외야수', DH: '지명타자', RP: '구원 투수', F: '야수' };
export const isPitcherSlot = (s: string) => s === 'SP' || s === 'MRP' || s === 'CL' || s === 'RP';

/** 올스타 일정: 투표 시작(월), 중간 집계(일 3번), 마감·발표(일), 홈런 레이스(금), 올스타전(토), 결과 편지(월) */
export function allStarDates(season: number) {
  const k = seasonKeyDates(season);
  const voteStart = addDays(k.openingWeekMonday, AS.voteStartWeeks * 7);
  const interim = Array.from({ length: AS.interimWeeks }, (_, i) => addDays(voteStart, i * 7 + 6));
  const close = addDays(voteStart, AS.interimWeeks * 7 + 6);
  return { voteStart, interim, close, hrRace: addDays(k.allStar, -1), game: k.allStar, letter: addDays(k.allStar, 2), opening: k.opening };
}

/** 개최 순환: (시즌 − 2027) mod 10 + 1 */
export const rotationHost = (season: number, clubCount = 10): ClubId => ((((season - 2027) % clubCount) + clubCount) % clubCount) + 1;

/** 올스타전 선수 한 명의 기록(타격·투구) */
export interface AllStarLine {
  playerId: PlayerId;
  team: AllStarTeam;
  PA: number;
  AB: number;
  H: number;
  D: number;
  T: number;
  HR: number;
  RBI: number;
  R: number;
  SB: number;
  BB: number;
  SO: number;
  /** 투구: 아웃, 피안타, 볼넷, 탈삼진, 실점, 자책, 투구 수, 무실점 이닝 */
  OUTS: number;
  PH: number;
  PBB: number;
  PK: number;
  PR: number;
  ER: number;
  pitches: number;
  scoreless: number;
}

const emptyLine = (playerId: PlayerId, team: AllStarTeam): AllStarLine => ({ playerId, team, PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, RBI: 0, R: 0, SB: 0, BB: 0, SO: 0, OUTS: 0, PH: 0, PBB: 0, PK: 0, PR: 0, ER: 0, pitches: 0, scoreless: 0 });
const NO_AB = new Set(['BB', 'HBP', 'SF', 'SH']);

/** 경기 결과에서 선수별 올스타 기록을 만든다. sideTeam: 엔진 구단 번호 → 팀 */
export function boxLines(r: GameResult, sideTeam: (engineClub: ClubId) => AllStarTeam): AllStarLine[] {
  const lines = new Map<PlayerId, AllStarLine>();
  const other = (t: AllStarTeam): AllStarTeam => (t === 'dream' ? 'nanum' : 'dream');
  const line = (id: PlayerId, team: AllStarTeam) => {
    let l = lines.get(id);
    if (!l) lines.set(id, (l = emptyLine(id, team)));
    return l;
  };
  // 이닝(반)별 투수 아웃·실점: 무실점 이닝 판정
  const half = new Map<string, { outs: number; runs: number }>();
  const tally = (pitcherId: PlayerId, inning: number, h: string, outs: number, runs: number) => {
    const k = `${pitcherId}|${inning}|${h}`;
    const v = half.get(k) ?? { outs: 0, runs: 0 };
    v.outs += outs;
    v.runs += runs;
    half.set(k, v);
  };
  const seq = [...r.events.map((e) => ({ s: e.seq, pa: e, play: null })), ...r.plays.map((p) => ({ s: p.seq, pa: null, play: p }))].sort((a, b) => a.s - b.s);
  let prev = { home: 0, away: 0 };
  for (const x of seq) {
    const ev = x.pa ?? x.play!;
    const bt = sideTeam(ev.battingClub);
    const runs = ev.homeScore - prev.home + (ev.awayScore - prev.away);
    prev = { home: ev.homeScore, away: ev.awayScore };
    const p = line(ev.pitcherId, other(bt));
    p.OUTS += ev.outsOnPlay;
    tally(ev.pitcherId, ev.inning, ev.half, ev.outsOnPlay, runs);
    if (x.pa) {
      const e = x.pa;
      const b = line(e.batterId, bt);
      b.PA += 1;
      if (!NO_AB.has(e.outcome)) b.AB += 1;
      const hit = e.outcome === '1B' || e.outcome === '2B' || e.outcome === '3B' || e.outcome === 'HR';
      if (hit) {
        b.H += 1;
        p.PH += 1;
      }
      if (e.outcome === '2B') b.D += 1;
      if (e.outcome === '3B') b.T += 1;
      if (e.outcome === 'HR') b.HR += 1;
      if (e.outcome === 'BB') {
        b.BB += 1;
        p.PBB += 1;
      }
      if (e.outcome === 'K') {
        b.SO += 1;
        p.PK += 1;
      }
      b.RBI += e.rbi;
      p.pitches += e.pitches;
    } else if (x.play!.kind === 'SB' && x.play!.runnerId !== null) line(x.play!.runnerId, bt).SB += 1;
  }
  for (const run of r.runs) {
    line(run.runnerId, sideTeam(run.battingClub)).R += 1;
    const p = line(run.pitcherId, other(sideTeam(run.battingClub)));
    p.PR += 1;
    if (run.earned) p.ER += 1;
  }
  for (const [k, v] of half) if (v.outs >= 3 && v.runs === 0) lines.get(Number(k.split('|')[0]))!.scoreless += 1;
  return [...lines.values()].sort((a, b) => a.playerId - b.playerId);
}

/** 미스터 올스타 점수(편차 제외) */
export function mvpPoints(l: AllStarLine): number {
  const M = AS.mvp;
  const singles = l.H - l.D - l.T - l.HR;
  return singles * M.single + l.D * M.double + l.T * M.triple + l.HR * M.hr + l.RBI * M.rbi + l.R * M.run + l.SB * M.sb + l.scoreless * M.scorelessInning + l.PK * M.k;
}

export const mvpNoise = (seed: string, season: number, playerId: PlayerId) => (Rng.derive(seed, 'allstar-mvp', season, playerId).next() * 2 - 1) * AS.mvp.noise;

/** 투표 편차 ±noise((시드, 시즌, 선수) 파생) */
export const voteNoise = (seed: string, season: number, playerId: PlayerId) => (Rng.derive(seed, 'allstar-vote', season, playerId).next() * 2 - 1) * AS.noise;

/** 홈런 레이스 스윙 홈런 확률: 10a 타자 쪽 홈런 로짓(성적 혼합 없음) + 가산 */
export const swingHrProb = (p: PlayerTruth) => sigmoid(batterSide(p).h + AS.hrRace.logitShift);

export interface HrMatch {
  round: 1 | 2 | 3;
  a: PlayerId;
  b: PlayerId;
  hrA: number;
  hrB: number;
  /** 연장 스윙 결과(있을 때) */
  tiebreak: Array<[number, number]>;
  winner: PlayerId;
}

export interface HrRaceResult {
  matches: HrMatch[];
  champion: PlayerId;
}

/**
 * 홈런 레이스: 드림 n위 대 나눔 (5−n)위 8강 → 4강 → 결승. 각 팀 4명이 안 되면 있는 인원으로 부전승 처리.
 * seasonHr: 동점 최종 판정용 정규시즌 홈런.
 */
export function hrRace(seed: string, season: number, dream: PlayerTruth[], nanum: PlayerTruth[], seasonHr: (id: PlayerId) => number): HrRaceResult | null {
  const H = AS.hrRace;
  const n = H.perTeam;
  const seeds: Array<[PlayerTruth | null, PlayerTruth | null]> = Array.from({ length: n }, (_, i) => [dream[i] ?? null, nanum[n - 1 - i] ?? null]);
  const matches: HrMatch[] = [];
  const swingAll = (p: PlayerTruth, round: number, match: number, extra: number, count: number) => {
    const prob = swingHrProb(p);
    let hr = 0;
    for (let s = 0; s < count; s++) if (Rng.derive(seed, 'hr-race', season, round, match, p.id, extra, s).next() < prob) hr++;
    return hr;
  };
  const play = (a: PlayerTruth | null, b: PlayerTruth | null, round: 1 | 2 | 3, match: number): PlayerTruth | null => {
    if (!a || !b) return a ?? b;
    const hrA = swingAll(a, round, match, 0, H.swings);
    const hrB = swingAll(b, round, match, 0, H.swings);
    const tiebreak: Array<[number, number]> = [];
    let winner: PlayerTruth | null = hrA > hrB ? a : hrB > hrA ? b : null;
    for (let t = 1; !winner && t <= H.tieRounds; t++) {
      const x = swingAll(a, round, match, t, H.tieSwings);
      const y = swingAll(b, round, match, t, H.tieSwings);
      tiebreak.push([x, y]);
      if (x !== y) winner = x > y ? a : b;
    }
    winner ??= seasonHr(a.id) > seasonHr(b.id) || (seasonHr(a.id) === seasonHr(b.id) && a.id < b.id) ? a : b;
    matches.push({ round, a: a.id, b: b.id, hrA, hrB, tiebreak, winner: winner.id });
    return winner;
  };
  const qf = seeds.map(([a, b], i) => play(a, b, 1, i));
  const sf = [play(qf[0] ?? null, qf[1] ?? null, 2, 0), play(qf[2] ?? null, qf[3] ?? null, 2, 1)];
  const champ = play(sf[0] ?? null, sf[1] ?? null, 3, 0);
  return champ ? { matches, champion: champ.id } : null;
}

/** 올스타전 날짜 판정용: 그 날이 올스타 일정의 어느 날인가 */
export function allStarDayKind(season: number, date: GameDate): 'voteStart' | 'interim' | 'close' | 'hrRace' | 'game' | 'letter' | null {
  const d = allStarDates(season);
  if (date === d.voteStart) return 'voteStart';
  if (d.interim.includes(date)) return 'interim';
  if (date === d.close) return 'close';
  if (date === d.hrRace) return 'hrRace';
  if (date === d.game) return 'game';
  if (date === d.letter) return 'letter';
  return null;
}

/** 8e-2(D-190 (8)): 올스타 유니폼 판매 기간(올스타전 ± 일) */
export function allStarWindow(season: number): { from: GameDate; to: GameDate } {
  const g = seasonKeyDates(season).allStar;
  return { from: addDays(g, -AS.merchWindowDays), to: addDays(g, AS.merchWindowDays) };
}
