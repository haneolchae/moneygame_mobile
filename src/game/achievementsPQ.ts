// 8d 업적 P(진기록)·Q(실수·불명예) 판정(D-186). 경기 결과·시즌 기록·수상·운영 상태로만 판정한다.
// 경기를 넘는 연속 상태는 PQState(시즌마다 새로)와 PQMemo(계속)로 저장본 meta에 남긴다.
import type { GameDate } from '../engine/calendar';
import { addDays } from '../engine/calendar';
import { CLOSE_RULES } from './seasonClose';
import type { GameResult } from '../engine/gamesim';
import { seasonKeyDates } from '../engine/schedule';
import { battingRates, pitchingRates } from '../engine/stats';
import { clubHistory } from '../engine/data/history';
import { TEAMS } from '../engine/staff';
import type { ClubId, PlayerTruth } from '../engine/types';
import type { GameMeta, GameRepository } from './ports';

type Judge = (series: string, value: number, detail: (label: string) => string) => void;
type Flag = (series: string, cond: boolean, detail: string) => void;

/** 시즌 상태(시즌이 바뀌면 새로) */
export interface PQState {
  season: number;
  hrRun: Record<string, number>;
  obRun: Record<string, number>;
  wo: Record<string, number>;
  phHR: Record<string, number>;
  lossRun: number;
  homeLossRun: number;
  open: number;
  openBroken: boolean;
  openL: number;
  openLBroken: boolean;
  table: Record<string, [number, number, number]>;
  wireBroken: boolean;
  wireStarted: boolean;
  asbRank: number | null;
  firstInnExit: number;
  lastShutoutLoss: boolean;
  wo9: number;
}
export const newPQState = (season: number): PQState => ({ wo9: 0, season, hrRun: {}, obRun: {}, wo: {}, phHR: {}, lossRun: 0, homeLossRun: 0, open: 0, openBroken: false, openL: 0, openLBroken: false, table: {}, wireBroken: false, wireStarted: false, asbRank: null, firstInnExit: 0, lastShutoutLoss: false });

/** 시즌을 넘는 상태 */
export interface PQMemo {
  qsRun: Record<string, number>;
  svRun: Record<string, number>;
  relZero: Record<string, number>;
  iron: Record<string, number>;
  emergencySeasons: number[];
  vacancySince: GameDate | null;
  clubWinsBase: number | null;
}
export const newPQMemo = (): PQMemo => ({ qsRun: {}, svRun: {}, relZero: {}, iron: {}, emergencySeasons: [], vacancySince: null, clubWinsBase: null });

const HIT = new Set(['1B', '2B', '3B', 'HR']);
const OB = new Set(['1B', '2B', '3B', 'HR', 'BB', 'HBP']);
const OUTS = new Set(['K', 'GO', 'FO', 'DP', 'SF', 'SH', 'FC']);

export interface PQCtx {
  repo: GameRepository;
  meta: GameMeta;
  date: GameDate;
  judge: Judge;
  flag: Flag;
  name: (id: number) => string;
  st: PQState;
  memo: PQMemo;
  tenureFirst: number;
}

/** 우리 경기 하나(정규시즌·포스트시즌): 경기 계열 */
export function judgePQGame(c: PQCtx, g: GameResult, regular: boolean, debutIds: Set<number>): void {
  const { meta, date, judge, flag, name, st, memo } = c;
  const club = meta.userClubId;
  const home = g.home === club;
  const mine = home ? g.homeRuns : g.awayRuns;
  const opp = home ? g.awayRuns : g.homeRuns;
  const won = mine > opp;
  const lost = mine < opp;
  const tag = `${date} ${mine}-${opp}`;
  const seq = [...g.events.map((e) => ({ ...e, pa: true as const })), ...g.plays.map((p) => ({ ...p, pa: false as const }))].sort((a, b) => a.seq - b.seq);
  const ours = g.events.filter((e) => e.battingClub === club);
  const theirs = g.events.filter((e) => e.battingClub !== club);
  // 이닝별 득점(우리)
  const line = home ? g.lineScore.home : g.lineScore.away;
  const oppLine = home ? g.lineScore.away : g.lineScore.home;
  judge('P_bigInning', Math.max(0, ...line), (l) => `${tag} 한 이닝 ${Math.max(...line)}득점(${l})`);
  flag('Q_innA', Math.max(0, ...oppLine) >= 10, `${tag} 한 이닝 ${Math.max(...oppLine)}실점`);
  const byInning = new Map<string, number>();
  for (const e of ours) byInning.set(`${e.inning}`, (byInning.get(`${e.inning}`) ?? 0) + 1);
  flag('P_batAround', [...byInning.values()].some((n) => n >= 10), `${tag} 타자 일순`);
  flag('P_everyInn', line.length >= 8 && line.slice(0, 8).every((r) => r > 0), `${tag} 1~8회 매 이닝 득점`);
  // 연속 타자 홈런, 한 이닝 2홈런, 만루홈런
  let b2b = 0;
  let best = 0;
  for (const e of ours) {
    b2b = e.outcome === 'HR' ? b2b + 1 : 0;
    best = Math.max(best, b2b);
  }
  judge('P_b2b', best, (l) => `${tag} ${l}타자 연속 홈런`);
  const innHR = new Map<string, number>();
  const innGS = new Map<number, number>();
  for (const e of ours) {
    if (e.outcome === 'HR') innHR.set(`${e.inning}:${e.batterId}`, (innHR.get(`${e.inning}:${e.batterId}`) ?? 0) + 1);
    if (e.outcome === 'HR' && e.rbi === 4) innGS.set(e.inning, (innGS.get(e.inning) ?? 0) + 1);
  }
  for (const [k, n] of innHR) if (n >= 2) flag('P_inning2hr', true, `${tag} ${name(Number(k.split(':')[1]))} 한 이닝 2홈런`);
  flag('P_hanmandu', [...innGS.values()].some((n) => n >= 2), `${tag} 한만두`);
  const gs = ours.filter((e) => e.outcome === 'HR' && e.rbi === 4);
  flag('P_gs3', gs.length >= 3, `${tag} 팀 만루홈런 ${gs.length}개`);
  // 선수별
  const byB = new Map<number, Array<(typeof ours)[number]>>();
  for (const e of ours) byB.set(e.batterId, [...(byB.get(e.batterId) ?? []), e]);
  let five = 0;
  for (const [id, list] of byB) {
    const h = list.filter((e) => HIT.has(e.outcome)).length;
    const ab = list.filter((e) => !['BB', 'HBP', 'SF', 'SH'].includes(e.outcome)).length;
    if (h >= 5) five++;
    flag('P_6for6', ab >= 6 && h === ab, `${tag} ${name(id)} ${ab}타수 ${h}안타`);
    flag('P_2gs', list.filter((e) => e.outcome === 'HR' && e.rbi === 4).length >= 2, `${tag} ${name(id)} 만루홈런 2개`);
    for (let i = 1; i < list.length; i++) if (list[i]!.outcome === 'HR' && list[i]!.rbi === 4 && list[i - 1]!.outcome === 'HR' && list[i - 1]!.rbi === 4) flag('P_gsRun', true, `${tag} ${name(id)} 연타석 만루홈런`);
    const first = (o: string) => list.findIndex((e) => e.outcome === o);
    const [a, b, cc, d] = ['1B', '2B', '3B', 'HR'].map(first) as [number, number, number, number];
    flag('P_natCycle', a >= 0 && a < b && b < cc && cc < d, `${tag} ${name(id)} 내추럴 사이클`);
    // 연타석 홈런·연속 출루(경기 걸침)
    for (const e of list) {
      st.hrRun[String(id)] = e.outcome === 'HR' ? (st.hrRun[String(id)] ?? 0) + 1 : 0;
      judge('P_hrRun', st.hrRun[String(id)]!, (l) => `${date} ${name(id)} ${l}연타석 홈런`);
      if (e.outcome === 'SH') continue;
      st.obRun[String(id)] = OB.has(e.outcome) ? (st.obRun[String(id)] ?? 0) + 1 : 0;
      judge('P_obRun', st.obRun[String(id)]!, (l) => `${date} ${name(id)} ${l}타석 연속 출루`);
    }
  }
  flag('P_two5', five >= 2, `${tag} 5안타 타자 ${five}명`);
  // 선발 라인업(처음 9명)
  const starters: number[] = [];
  for (const e of ours) if (!starters.includes(e.batterId) && starters.length < 9) starters.push(e.batterId);
  if (starters.length === 9) {
    flag('P_allHit', starters.every((id) => byB.get(id)!.some((e) => HIT.has(e.outcome))), `${tag} 선발 전원 안타`);
    flag('P_allRun', starters.every((id) => g.runs.some((r) => r.runnerId === id && r.battingClub === club)), `${tag} 선발 전원 득점`);
    flag('Q_allK', starters.every((id) => byB.get(id)!.some((e) => e.outcome === 'K')), `${tag} 선발 전원 삼진`);
  }
  // 도루·병살·실책·삼진·4사구
  const sb = g.plays.filter((p) => p.battingClub === club && p.kind === 'SB');
  flag('P_teamSB5', sb.length >= 5, `${tag} 팀 도루 ${sb.length}개`);
  const sbBy = new Map<number, number>();
  for (const p of sb) if (p.runnerId) sbBy.set(p.runnerId, (sbBy.get(p.runnerId) ?? 0) + 1);
  for (const [id, n] of sbBy) judge('P_indivSB', n, (l) => `${tag} ${name(id)} 도루 ${n}개(${l})`);
  flag('P_tp', seq.some((x) => x.battingClub !== club && x.outsOnPlay >= 3), `${tag} 수비 삼중살`);
  judge('P_dp4', theirs.filter((e) => e.outcome === 'DP').length >= 4 ? 1 : 0, () => `${tag} 수비 병살 ${theirs.filter((e) => e.outcome === 'DP').length}개`);
  const errs = theirs.flatMap((e) => e.credits.filter((x) => x.kind === 'E')).concat(g.plays.filter((p) => p.battingClub !== club).flatMap((p) => p.credits.filter((x) => x.kind === 'E')));
  judge('Q_err', errs.length, (l) => `${tag} 팀 실책 ${errs.length}개(${l})`);
  const errBy = new Map<number, number>();
  for (const x of errs) errBy.set(x.playerId, (errBy.get(x.playerId) ?? 0) + 1);
  for (const [id, n] of errBy) flag('Q_err3', n >= 3, `${tag} ${name(id)} 실책 ${n}개`);
  const ks = ours.filter((e) => e.outcome === 'K').length;
  judge('Q_k', ks, (l) => `${tag} 팀 삼진 ${ks}개(${l})`);
  const gdp = ours.filter((e) => e.outcome === 'DP').length;
  judge('Q_gdp', gdp, (l) => `${tag} 병살타 ${gdp}개(${l})`);
  const bbAllowed = theirs.filter((e) => e.outcome === 'BB' || e.outcome === 'HBP').length;
  flag('Q_bb12', bbAllowed >= 12, `${tag} 4사구 ${bbAllowed}개 허용`);
  judge('Q_runsA', opp, (l) => `${tag} ${opp}실점(${l})`);
  // 점수 흐름: 최대 리드·열세, 9회 2아웃, 9회 시작 점수
  let lead = 0;
  let deficit = 0;
  let sMine = 0;
  let sOpp = 0;
  let outs = 0;
  let half = '';
  let n9 = false;
  let q9 = false;
  let start9: number | null = null;
  for (const x of seq) {
    const h = `${x.inning}${x.half}`;
    if (h !== half) (half = h, (outs = 0));
    const ourBat = x.battingClub === club;
    if (ourBat && x.inning >= 9 && start9 === null) start9 = sOpp - sMine;
    if (x.inning >= 9 && outs >= 2) {
      if (ourBat && sMine < sOpp) n9 = true;
      if (!ourBat && sMine > sOpp) q9 = true;
    }
    outs += x.outsOnPlay;
    sMine = home ? x.homeScore : x.awayScore;
    sOpp = home ? x.awayScore : x.homeScore;
    lead = Math.max(lead, sMine - sOpp);
    deficit = Math.max(deficit, sOpp - sMine);
  }
  if (won && regular && n9) st.wo9 = (st.wo9 ?? 0) + 1;
  if (won) judge('P_9th2out', st.wo9 ?? 0, (l) => `${date} 9회 2아웃 역전승 ${l}회`);
  flag('Q_9th2out', lost && q9, `${tag} 9회 2아웃 역전패`);
  if (lost) judge('Q_blownLead', lead, (l) => `${tag} ${lead}점 앞서다 역전패(${l})`);
  flag('P_9th7', won && start9 !== null && start9 >= 7, `${tag} 9회 ${start9}점 차 역전승`);
  // 끝내기(마지막 사건)
  const last = seq[seq.length - 1];
  const walkoff = !!last && last.half === 'B' && g.homeRuns > g.awayRuns;
  if (walkoff && won && home && last) {
    if (last.pa) {
      const e = last;
      const before = (home ? e.homeScore : e.awayScore) - e.rbi;
      flag('P_woHR', e.outcome === 'HR', `${tag} ${name(e.batterId)} 끝내기 홈런`);
      flag('P_woGS', e.outcome === 'HR' && e.rbi === 4, `${tag} ${name(e.batterId)} 끝내기 만루홈런`);
      flag('P_woGSc', e.outcome === 'HR' && e.rbi === 4 && before < (home ? e.awayScore : e.homeScore), `${tag} ${name(e.batterId)} 역전 끝내기 만루홈런`);
      flag('P_woWalk', e.outcome === 'BB' || e.outcome === 'HBP', `${tag} 밀어내기 끝내기`);
      flag('P_woSF', e.outcome === 'SF', `${tag} 끝내기 희생플라이`);
      flag('P_woInf', !!e.bb?.infieldHit && HIT.has(e.outcome), `${tag} 끝내기 내야 안타`);
      flag('P_woSqz', e.bunt === 'squeeze', `${tag} 끝내기 스퀴즈`);
      st.wo[String(e.batterId)] = (st.wo[String(e.batterId)] ?? 0) + 1;
      flag('P_wo3', st.wo[String(e.batterId)]! >= 3, `${date} ${name(e.batterId)} 시즌 끝내기 ${st.wo[String(e.batterId)]}회`);
      const ph = g.subs.find((s) => s.kind === 'PH' && s.inId === e.batterId && s.clubId === club);
      flag('P_phWoHR', !!ph && e.outcome === 'HR' && !ours.some((x) => x.batterId === e.batterId && x.seq < e.seq && x.seq > ph.seq), `${tag} ${name(e.batterId)} 대타 끝내기 홈런`);
    }
  }
  if (walkoff && lost && !home && last) {
    if (last.pa) {
      flag('Q_woErr', last.outcome === 'ROE' || last.credits.some((x) => x.kind === 'E'), `${tag} 끝내기 실책 패`);
      flag('Q_woWalk', last.outcome === 'BB' || last.outcome === 'HBP', `${tag} 밀어내기 끝내기 패`);
      flag('Q_woGS', last.outcome === 'HR' && last.rbi === 4, `${tag} 끝내기 만루홈런 패`);
    } else {
      flag('Q_woWP', last.kind === 'WP', `${tag} 끝내기 폭투 패`);
      flag('Q_woBK', last.kind === 'BK', `${tag} 끝내기 보크 패`);
    }
  }
  // 수비로 경기 종료(원정 승리 마지막 수비 또는 홈 9회초 끝)
  if (won && last && last.battingClub !== club && last.pa) {
    flag('P_woTP', last.outsOnPlay >= 3, `${tag} 끝내기 삼중살`);
    flag('P_woDP', last.outcome === 'DP', `${tag} 끝내기 병살`);
  }
  // 대타 홈런·만루홈런
  for (const s of g.subs.filter((x) => x.kind === 'PH' && x.clubId === club)) {
    const pa = ours.find((e) => e.batterId === s.inId && e.seq > s.seq);
    if (pa?.outcome === 'HR') {
      st.phHR[String(s.inId)] = (st.phHR[String(s.inId)] ?? 0) + 1;
      judge('P_phHR', st.phHR[String(s.inId)]!, (l) => `${date} ${name(s.inId)} 시즌 대타 홈런 ${l}개`);
      flag('P_phGS', pa.rbi === 4, `${tag} ${name(s.inId)} 대타 만루홈런`);
    }
  }
  // 투수
  const ourHits = ours.filter((e) => HIT.has(e.outcome)).length;
  const oppHits = theirs.filter((e) => HIT.has(e.outcome)).length;
  const pitchers = [...new Set(theirs.map((e) => e.pitcherId))];
  const solo = pitchers.length === 1 ? pitchers[0]! : null;
  if (won && solo !== null && opp === 0) {
    const pitches = theirs.reduce((a, e) => a + e.pitches, 0);
    flag('P_noBBsho', bbAllowed === 0, `${tag} ${name(solo)} 무4사구 완봉`);
    flag('P_maddux', pitches <= 100, `${tag} ${name(solo)} ${pitches}구 완봉`);
  }
  flag('P_noHitWin', won && ourHits === 0, `${tag} 무안타 승리`);
  flag('P_noHitLoss', lost && oppHits === 0, `${tag} 노히트 패배`);
  flag('P_6hrLoss', lost && ours.filter((e) => e.outcome === 'HR').length >= 6, `${tag} 팀 홈런 6개에도 패배`);
  flag('P_20hLoss', lost && ourHits >= 20, `${tag} 팀 ${ourHits}안타에도 패배`);
  flag('Q_noHit', lost && ourHits === 0, `${tag} 노히트 노런 당함`);
  flag('Q_perfect', lost && !ours.some((e) => OB.has(e.outcome) || !OUTS.has(e.outcome)), `${tag} 퍼펙트 당함`);
  flag('P_lowHits', won && ourHits + oppHits <= 2, `${tag} 양 팀 안타 ${ourHits + oppHits}개`);
  flag('P_30runs', won && mine + opp >= 30, `${tag} 양 팀 ${mine + opp}득점`);
  flag('P_10hr', g.events.filter((e) => e.outcome === 'HR').length >= 10, `${tag} 양 팀 홈런 ${g.events.filter((e) => e.outcome === 'HR').length}개`);
  flag('P_15inn', won && g.innings >= 15, `${tag} ${g.innings}회 승리`);
  flag('P_by20', won && mine - opp >= 20, `${tag} ${mine - opp}점 차 승리`);
  flag('P_20to0', won && opp === 0 && mine >= 20, `${tag} 영봉승`);
  flag('P_revenge', st.lastShutoutLoss && mine >= 15, `${tag} 영봉패 다음 경기 ${mine}득점`);
  st.lastShutoutLoss = lost && mine === 0;
  // 선발 1회 강판·연속 QS·세이브·불펜 무실점
  const starter = home ? g.starters.home : g.starters.away;
  const starterOuts = theirs.filter((e) => e.pitcherId === starter).reduce((a, e) => a + e.outsOnPlay, 0);
  if (regular && starterOuts < 3) st.firstInnExit++;
  const qs = g.pitcherFlags.some((f) => f.pitcherId === starter && f.qs);
  memo.qsRun[String(starter)] = qs ? (memo.qsRun[String(starter)] ?? 0) + 1 : 0;
  judge('P_qsRun', memo.qsRun[String(starter)]!, (l) => `${date} ${name(starter)} 연속 QS ${l}경기`);
  if (g.savePitcher !== null && pitchers.includes(g.savePitcher)) {
    memo.svRun[String(g.savePitcher)] = (memo.svRun[String(g.savePitcher)] ?? 0) + 1;
    judge('P_svRun', memo.svRun[String(g.savePitcher)]!, (l) => `${date} ${name(g.savePitcher!)} 연속 세이브 ${l}`);
  }
  for (const f of g.pitcherFlags) if (f.blown && f.clubId === club) memo.svRun[String(f.pitcherId)] = 0;
  for (const id of pitchers) {
    if (id === starter) continue;
    const ran = g.runs.some((r) => r.pitcherId === id && r.battingClub !== club);
    memo.relZero[String(id)] = ran ? 0 : (memo.relZero[String(id)] ?? 0) + 1;
    judge('P_relZero', memo.relZero[String(id)]!, (l) => `${date} ${name(id)} 구원 ${l}경기 연속 무실점`);
  }
  // 데뷔(그 경기 전까지 1군 출전 0)
  for (const id of debutIds) {
    const list = byB.get(id);
    flag('P_debutHR', !!list && list[0]!.outcome === 'HR', `${tag} ${name(id)} 데뷔 첫 타석 홈런`);
    flag('P_debutWin', g.winningPitcher === id, `${tag} ${name(id)} 데뷔전 승리`);
    const k = theirs.filter((e) => e.pitcherId === id && e.outcome === 'K').length;
    flag('P_debutK', k >= 10, `${tag} ${name(id)} 데뷔전 ${k}탈삼진`);
  }
  // 한 경기 3포지션, 철인 연속 출전
  const posBy = new Map<number, Set<string>>();
  for (const f of g.fieldOuts) if (f.clubId === club && f.outs > 0) posBy.set(f.playerId, new Set([...(posBy.get(f.playerId) ?? []), f.position]));
  for (const [id, set] of posBy) flag('P_3pos', [...set].filter((p) => p !== 'DH').length >= 3, `${tag} ${name(id)} ${[...set].join('·')} 수비`);
  if (regular) {
    const played = new Set<number>([...ours.map((e) => e.batterId), ...[...posBy.keys()].filter((id) => !pitchers.includes(id))]);
    const iron: Record<string, number> = {};
    for (const id of played) iron[String(id)] = (memo.iron[String(id)] ?? 0) + 1;
    memo.iron = iron;
    for (const [id, n] of Object.entries(iron)) judge('P_iron', n, (l) => `${date} ${name(Number(id))} ${l}경기 연속 출전`);
  }
  // 연패·홈 연패·개막 연승/연패
  if (regular) {
    st.lossRun = lost ? st.lossRun + 1 : won ? 0 : st.lossRun;
    judge('Q_lossRun', st.lossRun, (l) => `${date} ${l}연패`);
    if (home) {
      st.homeLossRun = lost ? st.homeLossRun + 1 : won ? 0 : st.homeLossRun;
      judge('Q_homeLoss', st.homeLossRun, (l) => `${date} 홈 ${l}연패`);
    }
    if (!st.openBroken) {
      if (won) st.open++;
      else if (lost) st.openBroken = true;
      judge('P_openRun', st.open, (l) => `${meta.season} 개막 ${l}연승`);
    }
    if (!st.openLBroken) {
      if (lost) st.openL++;
      else if (won) st.openLBroken = true;
      judge('Q_openLoss', st.openL, (l) => `${meta.season} 개막 ${l}연패`);
    }
  }
}

/** 리그 승패표(정규시즌 모든 경기)와 와이어 투 와이어·조기 확정·전반기 순위 */
export function judgePQLeague(c: PQCtx, results: GameResult[], regularIds: Set<number>, totalGames: number): void {
  const { meta, date, judge, st } = c;
  const club = String(meta.userClubId);
  for (const g of results) {
    if (!regularIds.has(g.fixtureId)) continue;
    for (const [id, my, their] of [[g.home, g.homeRuns, g.awayRuns], [g.away, g.awayRuns, g.homeRuns]] as const) {
      const t = st.table[String(id)] ?? [0, 0, 0];
      st.table[String(id)] = my > their ? [t[0] + 1, t[1], t[2]] : my < their ? [t[0], t[1] + 1, t[2]] : [t[0], t[1], t[2] + 1];
    }
  }
  const pct = (t: [number, number, number]) => t[0] / Math.max(1, t[0] + t[1]);
  const me = st.table[club];
  if (!me) return;
  const others = Object.entries(st.table).filter(([k]) => k !== club);
  if (results.some((g) => regularIds.has(g.fixtureId))) {
    st.wireStarted = true;
    if (!others.every(([, t]) => pct(me) > pct(t))) st.wireBroken = true;
    // 1위 확정: 우리 승 > 다른 구단 최대 가능 승
    const remaining = totalGames - (me[0] + me[1] + me[2]);
    const clinched = others.every(([, t]) => me[0] > t[0] + (totalGames - (t[0] + t[1] + t[2])));
    if (clinched) judge('P_clinch', remaining, (l) => `${date} ${remaining}경기 남기고 1위 확정(${l})`);
  }
  if (st.asbRank === null && date >= seasonKeyDates(meta.season).allStar) {
    st.asbRank = 1 + others.filter(([, t]) => pct(t) > pct(me)).length;
  }
}

/** 정규시즌 마지막 날: 시즌 계열 */
export function judgePQSeason(c: PQCtx, players: PlayerTruth[], team: ReturnType<GameRepository['teamTotals']>): void {
  const { repo, meta, judge, flag, name, st } = c;
  const club = meta.userClubId;
  const season = meta.season;
  const games = repo.getGames(season, 'regular');
  const g144 = Math.round((games.length * 2) / Math.max(1, repo.getClubs().length));
  const qualPa = g144 * 3.1;
  const qualOuts = g144 * 3;
  const mine = players.filter((p) => p.clubId === club);
  const ids = mine.map((p) => p.id);
  const bat = repo.battingTotals(season, ids, club);
  const pit = repo.pitchingTotals(season, ids, club);
  const flags = repo.flagTotals(season, club);
  const ex = repo.batterExtras(season, club, ids);
  const wp = repo.pitcherWildPitches(season, ids);
  const posOuts = new Map<number, Map<string, number>>();
  for (const r of repo.positionOuts(season)) if (r.clubId === club) posOuts.set(r.playerId, new Map([...(posOuts.get(r.playerId) ?? []), [r.position, ((posOuts.get(r.playerId)?.get(r.position)) ?? 0) + r.outs]]));
  const mainPos = (id: number) => [...(posOuts.get(id) ?? new Map<string, number>()).entries()].filter(([p]) => p !== 'DH').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const totalOuts = (id: number) => [...(posOuts.get(id) ?? new Map<string, number>()).values()].reduce((a, b) => a + b, 0);
  const fielding = repo.fieldingByClub(season, club);
  const catcher = repo.catcherStops(season, ids);
  const ageOf = (p: PlayerTruth) => season - Number(p.birthDate.slice(0, 4)) - (p.birthDate.slice(5) > '07-01' ? 1 : 0);
  let hr20 = 0;
  let hr30 = 0;
  let three = 0;
  for (const p of mine) {
    const b = bat.get(p.id);
    const q = pit.get(p.id);
    const f = flags.get(p.id) ?? { HLD: 0, BS: 0, QS: 0 };
    const x = ex.get(p.id);
    const n = name(p.id);
    if (b) {
      const r = battingRates(b);
      const qual = b.PA >= qualPa;
      if (b.HR >= 20) hr20++;
      if (b.HR >= 30) hr30++;
      if (qual && (r.AVG ?? 0) >= 0.3) three++;
      judge('P_hbp', b.HBP, (l) => `${season} ${n} 몸에 맞는 공 ${b.HBP}개(${l})`);
      judge('P_ibb', x?.IBB ?? 0, (l) => `${season} ${n} 고의4구 ${x?.IBB ?? 0}개(${l})`);
      judge('P_sh', x?.SH ?? 0, (l) => `${season} ${n} 희생번트 ${x?.SH ?? 0}개(${l})`);
      judge('P_gsIndiv', x?.GS ?? 0, (l) => `${season} ${n} 만루홈런 ${x?.GS ?? 0}개(${l})`);
      judge('P_leadHR', x?.leadHR ?? 0, (l) => `${season} ${n} 선두타자 홈런 ${x?.leadHR ?? 0}개(${l})`);
      const mp = mainPos(p.id);
      const share = mp ? (posOuts.get(p.id)!.get(mp) ?? 0) / Math.max(1, totalOuts(p.id)) : 0;
      flag('P_lead30', b.HR >= 30 && (x?.leadG ?? 0) * 2 > b.G, `${season} ${n} 1번 타자 ${b.HR}홈런`);
      flag('P_c20', mp === 'C' && share > 0.5 && b.HR >= 20 && qual && (r.AVG ?? 0) >= 0.3, `${season} ${n} 포수 ${b.HR}홈런·타율 ${(r.AVG ?? 0).toFixed(3)}`);
      flag('P_ss30', mp === 'SS' && share > 0.5 && b.HR >= 30, `${season} ${n} 유격수 ${b.HR}홈런`);
      flag('P_age40', ageOf(p) >= 40 && b.HR >= 20, `${season} ${n} 만 ${ageOf(p)}세 ${b.HR}홈런`);
      flag('P_age20', ageOf(p) <= 20 && b.HR >= 20, `${season} ${n} 만 ${ageOf(p)}세 ${b.HR}홈런`);
      const fe = fielding.get(p.id);
      flag('P_noErr', qual && !!mp && mp !== 'C' && mp !== '1B' && (posOuts.get(p.id)!.get(mp) ?? 0) >= 2160 && (fe?.E ?? 0) === 0, `${season} ${n} ${mp} 무실책`);
      if (mp && ['LF', 'CF', 'RF'].includes(mp)) judge('P_ofA', fe?.A ?? 0, (l) => `${season} ${n} 외야 보살 ${fe?.A ?? 0}개(${l})`);
      const ct = catcher.get(p.id);
      flag('P_cs50', mp === 'C' && !!ct && ct.SB + ct.CS >= 40 && ct.CS / (ct.SB + ct.CS) >= 0.5, `${season} ${n} 도루 저지 ${ct?.CS}/${(ct?.SB ?? 0) + (ct?.CS ?? 0)}`);
      flag('Q_mendoza', qual && (r.AVG ?? 1) <= 0.2, `${season} ${n} 타율 ${(r.AVG ?? 0).toFixed(3)}`);
      judge('Q_so', b.SO, (l) => `${season} ${n} 삼진 ${b.SO}개(${l})`);
      flag('Q_cs15', (b.CS ?? 0) >= 15, `${season} ${n} 도루 실패 ${b.CS}개`);
      flag('Q_sb50', (b.SB ?? 0) + (b.CS ?? 0) >= 10 && (b.SB ?? 0) / ((b.SB ?? 0) + (b.CS ?? 0)) < 0.5, `${season} ${n} 도루 ${b.SB}/${(b.SB ?? 0) + (b.CS ?? 0)}`);
      flag('Q_gdp25', (x?.GDP ?? 0) >= 25, `${season} ${n} 병살타 ${x?.GDP}개`);
      flag('Q_noHR', qual && b.HR === 0 && (mp === '1B' || mp === 'LF' || mp === 'RF' || (!mp && (posOuts.get(p.id)?.get('DH') ?? 0) > 0)), `${season} ${n} 규정 타석 무홈런`);
      // 연속 시즌 3할·100안타(우리 구단 소속)
      // 연속 시즌은 이번 시즌 조건을 채운 선수만 거꾸로 센다
      if (qual && (r.AVG ?? 0) >= 0.3) judge('P_run300', runSeasons(repo, p.id, club, season, (bb) => bb.PA >= qualPa && (battingRates(bb).AVG ?? 0) >= 0.3), (l) => `${season} ${n} ${l}시즌 연속 3할`);
      if (b.H >= 100) judge('P_run100h', runSeasons(repo, p.id, club, season, (bb) => bb.H >= 100), (l) => `${season} ${n} ${l}시즌 연속 100안타`);
    }
    if (q) {
      const r = pitchingRates(q, null);
      flag('P_swing', q.W >= 10 && (q.SV >= 10 || f.HLD >= 20), `${season} ${n} ${q.W}승 ${q.SV}세이브 ${f.HLD}홀드`);
      flag('P_age40', ageOf(p) >= 40 && (q.W >= 10 || q.SV >= 20), `${season} ${n} 만 ${ageOf(p)}세 ${q.W}승 ${q.SV}세이브`);
      flag('P_age20', ageOf(p) <= 20 && q.W >= 10, `${season} ${n} 만 ${ageOf(p)}세 ${q.W}승`);
      flag('P_dom20', p.origin === 'domestic' && q.W >= 20, `${season} ${n} ${q.W}승`);
      flag('P_noBlown', q.SV >= 20 && f.BS === 0, `${season} ${n} ${q.SV}세이브 블론 0`);
      flag('Q_era7', q.OUTS >= qualOuts && (r.ERA ?? 0) >= 7, `${season} ${n} 평균자책 ${(r.ERA ?? 0).toFixed(2)}`);
      flag('Q_0and10', q.GS * 2 >= q.G && q.W === 0 && q.L >= 10, `${season} ${n} 0승 ${q.L}패`);
      judge('Q_blown', f.BS, (l) => `${season} ${n} 블론세이브 ${f.BS}개(${l})`);
      flag('Q_wp20', (wp.get(p.id) ?? 0) >= 20, `${season} ${n} 폭투 ${wp.get(p.id)}개`);
      if (q.W >= 10) judge('P_run10w', runSeasons(repo, p.id, club, season, (_b, pp) => (pp?.W ?? 0) >= 10), (l) => `${season} ${n} ${l}시즌 연속 10승`);
    }
  }
  flag('P_hr20x5', hr20 >= 5, `${season} 20홈런 타자 ${hr20}명`);
  flag('P_hr30x3', hr30 >= 3, `${season} 30홈런 타자 ${hr30}명`);
  judge('P_300s', three, (l) => `${season} 규정 3할 타자 ${three}명(${l})`);
  const sp10 = [...pit.entries()].filter(([, q]) => q.GS * 2 >= q.G && q.W >= 10).length;
  flag('P_5sp10', sp10 >= 5, `${season} 10승 선발 ${sp10}명`);
  flag('P_5sp30', sp10 >= 5 && [...pit.values()].some((q) => q.SV >= 30), `${season} 10승 선발 ${sp10}명 + 30세이브`);
  // 7포지션
  for (const [id, m] of posOuts) flag('P_7pos', ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].every((p) => (m.get(p) ?? 0) > 0), `${season} ${name(id)} 7포지션 수비`);
  // 팀: 상대 전적·무승부·1점 차·연장·원정·트리플 크라운·실책·순위
  const my = games.filter((g) => g.home === club || g.away === club);
  const res = (g: (typeof my)[number]) => { const a = g.home === club ? g.homeRuns : g.awayRuns; const b = g.home === club ? g.awayRuns : g.homeRuns; return a > b ? 1 : a < b ? -1 : 0; };
  for (const o of repo.getClubs().map((x) => x.id).filter((x) => x !== club)) {
    const vs = my.filter((g) => g.home === o || g.away === o);
    flag('P_16_0', vs.length >= 16 && vs.every((g) => res(g) === 1), `${season} ${o}번 구단 상대 ${vs.length}전 전승`);
    flag('Q_0_16', vs.length >= 16 && vs.every((g) => res(g) === -1), `${season} ${o}번 구단 상대 ${vs.length}전 전패`);
  }
  const ties = my.filter((g) => res(g) === 0).length;
  judge('P_ties', ties, (l) => `${season} 무승부 ${ties}(${l})`);
  const oneRunW = my.filter((g) => res(g) === 1 && Math.abs(g.homeRuns - g.awayRuns) === 1).length;
  const oneRunL = my.filter((g) => res(g) === -1 && Math.abs(g.homeRuns - g.awayRuns) === 1).length;
  judge('P_oneRun', oneRunW, (l) => `${season} 1점 차 ${oneRunW}승(${l})`);
  flag('Q_oneRunL', oneRunL >= 25, `${season} 1점 차 ${oneRunL}패`);
  const extra = my.filter((g) => g.innings > 9);
  flag('P_extraUnb', extra.length >= 5 && extra.every((g) => res(g) >= 0), `${season} 연장 ${extra.length}경기 무패`);
  const road = my.filter((g) => g.away === club);
  const rw = road.filter((g) => res(g) === 1).length;
  const rl = road.filter((g) => res(g) === -1).length;
  judge('P_roadPct', rw / Math.max(1, rw + rl), (l) => `${season} 원정 ${rw}승 ${rl}패(${l})`);
  const me = team.find((t) => t.clubId === club);
  if (me) {
    const best = (f: (t: (typeof team)[number]) => number, low = false) => team.every((t) => (low ? f(me) <= f(t) : f(me) >= f(t)));
    flag('P_teamTriple', best((t) => battingRates(t.bat).AVG ?? 0) && best((t) => t.bat.HR) && best((t) => pitchingRates(t.pit, null).ERA ?? 99, true), `${season} 팀 타율·홈런·평균자책 1위`);
    const errs = repo.clubErrors(season);
    const myE = errs.get(club) ?? 0;
    judge('Q_seasonErr', myE, (l) => `${season} 팀 실책 ${myE}개(${l})`);
    flag('Q_errMost', [...errs.values()].every((e) => myE >= e), `${season} 팀 실책 ${myE}개 리그 최다`);
  }
  const table = repo.getClubs().map((x) => x.id).map((id) => ({ id, w: games.filter((g) => (g.home === id && g.homeRuns > g.awayRuns) || (g.away === id && g.awayRuns > g.homeRuns)).length, l: games.filter((g) => (g.home === id && g.homeRuns < g.awayRuns) || (g.away === id && g.awayRuns < g.homeRuns)).length }));
  const pct = (t: { w: number; l: number }) => t.w / Math.max(1, t.w + t.l);
  const myT = table.find((t) => t.id === club)!;
  const rank = 1 + table.filter((t) => pct(t) > pct(myT)).length;
  judge('Q_losses', myT.l, (l) => `${season} ${myT.l}패(${l})`);
  judge('Q_pct', pct(myT), (l) => `${season} 승률 ${pct(myT).toFixed(3)}(${l})`);
  flag('P_wire', st.wireStarted && !st.wireBroken && rank === 1, `${season} 개막부터 단독 1위`);
  if (st.asbRank !== null && st.asbRank >= 8 && rank === 1) judge('P_turn', 1, () => `${season} 전반기 ${st.asbRank}위 → 정규시즌 1위`);
  flag('Q_collapse', st.asbRank === 1 && rank > 5, `${season} 전반기 1위 → ${rank}위`);
  flag('Q_1stExit', st.firstInnExit >= 5, `${season} 선발 1회 강판 ${st.firstInnExit}회`);
  // 최하위 연속·꼴찌 추락·우승 다음 해 꼴찌
  if (rank === 10) {
    let run = 1;
    for (let y = season - 1; y >= c.tenureFirst; y--) if (repo.getSeasonStandings(y).find((s) => s.clubId === club)?.rank === 10) run++; else break;
    judge('Q_last', run, (l) => `${season} 최하위 ${l}시즌 연속`);
    const prev = repo.getSeasonStandings(season - 1).find((s) => s.clubId === club);
    flag('Q_fall', !!prev && prev.rank <= 5, `${season - 1} ${prev?.rank}위 → ${season} 10위`);
    flag('Q_champLast', prev?.postseason === '한국시리즈 우승', `${season - 1} 우승 → ${season} 최하위`);
  }
  // 5시즌 연속 승수 증가(재임)
  const wins = (y: number) => (y === season ? myT.w : repo.getSeasonStandings(y).find((s) => s.clubId === club)?.wins ?? null);
  let up = 0;
  for (let y = season; y > c.tenureFirst; y--) { const a = wins(y); const b = wins(y - 1); if (a !== null && b !== null && a > b) up++; else break; }
  flag('P_up5', up >= 5, `${season} ${up}시즌 연속 승수 증가`);
  // 구단 통산 승(실제 역사 포함, 재임 중 기준을 넘을 때)
  const realW = (clubHistory(club)?.seasons ?? []).reduce((a, h) => a + (h.wins ?? 0), 0);
  let gameW = 0;
  for (let y = 2026; y < season; y++) gameW += repo.getSeasonStandings(y).find((s) => s.clubId === club)?.wins ?? 0;
  const total = realW + gameW + myT.w;
  if (c.memo.clubWinsBase === null) c.memo.clubWinsBase = total - myT.w;
  if (total > (c.memo.clubWinsBase ?? total)) for (const t of [1000, 2000, 3000]) if (c.memo.clubWinsBase! < t && total >= t) judge('P_clubWins', total, (l) => `${season} 구단 통산 ${l}승(${total}승)`);
  // 최고 연봉 선수 규정 미달, 트레이드로 받은 선수 미출전, FA 먹튀
  const top = [...mine].sort((a, b) => b.salary - a.salary)[0];
  if (top) flag('Q_topPaid', (bat.get(top.id)?.PA ?? 0) < qualPa && (pit.get(top.id)?.OUTS ?? 0) < qualOuts, `${season} 최고 연봉 ${top.name} 규정 미달`);
  const got = (meta.tradeHistory ?? []).filter((t) => !t.ai && (t.clubA === club || t.clubB === club) && (t.season === season || (t.period === 'stove' && t.season === season - 1))).flatMap((t) => (t.clubA === club ? t.bToA : t.aToB));
  for (const id of got) flag('Q_tradeBust', !bat.has(id) && !pit.has(id), `${season} 트레이드로 받은 ${name(id)} 1군 미출전`);
  for (const e of repo.getFa(season - 1).filter((x) => x.signedClub === club && x.originClub !== club && (x.contract?.years ?? 0) >= 3)) {
    const b = bat.get(e.playerId);
    const q = pit.get(e.playerId);
    const bad = q ? q.OUTS < qualOuts || (pitchingRates(q, null).ERA ?? 0) >= 6 : !b || b.PA < qualPa || (battingRates(b).AVG ?? 0) <= 0.23;
    flag('Q_faBust', bad, `${season} FA ${name(e.playerId)} 첫 시즌 부진`);
  }
}

/** 수상 날: 다관왕·신인 골든글러브·외국인 MVP·놓친 대어·트레이드 후회 */
export function judgePQAwards(c: PQCtx, players: PlayerTruth[]): void {
  const { repo, meta, flag, judge, name } = c;
  const club = meta.userClubId;
  const season = meta.season;
  const aw = repo.getAwards({ season });
  const ours = aw.filter((a) => a.clubId === club && a.playerId !== null);
  const by = new Map<number, string[]>();
  for (const a of ours) by.set(a.playerId!, [...(by.get(a.playerId!) ?? []), a.award]);
  for (const [id, list] of by) {
    const bt = list.filter((k) => /^title_(AVG|HR|RBI|R|H|SB|OBP|SLG)$/.test(k)).length;
    const pt = list.filter((k) => /^title_(W|ERA|K|SV|HLD|WPCT)$/.test(k)).length;
    judge('P_batCrown', bt, (l) => `${season} ${name(id)} 타격 ${bt}관왕(${l})`);
    flag('P_pitCrown', pt >= 4, `${season} ${name(id)} 투수 ${pt}관왕`);
    flag('P_royGG', list.includes('roy') && list.includes('gg'), `${season} ${name(id)} 신인왕·골든글러브`);
    flag('P_fMVP', list.includes('mvp') && players.find((p) => p.id === id)?.origin !== 'domestic', `${season} ${name(id)} 외국인 MVP`);
  }
  const released = new Set(repo.getObligations().filter((o) => o.clubId === club && o.seasons.includes(season)).map((o) => o.playerId));
  for (const a of aw.filter((x) => x.playerId !== null && x.clubId !== club && released.has(x.playerId) && (x.award.startsWith('title_') || x.award === 'gg' || x.award === 'mvp'))) flag('Q_relStar', true, `${season} 방출한 ${name(a.playerId!)} 다른 구단에서 수상`);
  const gave = (meta.tradeHistory ?? []).filter((t) => !t.ai && (t.clubA === club || t.clubB === club) && t.season === season - 1).flatMap((t) => (t.clubA === club ? t.aToB : t.bToA));
  for (const a of aw.filter((x) => x.playerId !== null && x.clubId !== club && gave.includes(x.playerId) && (x.award.startsWith('title_') || x.award === 'mvp'))) flag('Q_tradeStar', true, `${season} 트레이드로 내준 ${name(a.playerId!)} 수상`);
}

/** 매주 일요일: 운영 불명예 */
export function judgePQOps(c: PQCtx, players: PlayerTruth[], fresh: GameMeta): void {
  const { repo, meta, date, flag, judge, memo } = c;
  const club = meta.userClubId;
  if (fresh.emergencyUsedSeason !== null && fresh.emergencyUsedSeason !== undefined && !memo.emergencySeasons.includes(fresh.emergencyUsedSeason)) memo.emergencySeasons = [...memo.emergencySeasons, fresh.emergencyUsedSeason];
  judge('Q_emergency', memo.emergencySeasons.length, (l) => `${date} 긴급 지원 ${l}회`);
  flag('Q_crisis', !!fresh.cashCrisisSince, `${date} 자금 위기`);
  flag('Q_brink', !!fresh.cashCrisisSince && fresh.cashCrisisSince <= addDays(date, -28), `${date} 현금 마이너스 4주`);
  flag('Q_warn', (fresh.goalMisses ?? 0) >= CLOSE_RULES.warnAfterMisses, `${date} 성적 목표 연속 미달 경고`);
  flag('Q_backlash', !!fresh.fans?.[String(club)]?.lowSince, `${date} 팬 반발`);
  // EV-4: 우리 선수 중대 사건(사실, 자진 신고 제외)·은폐 발각
  const cases = (fresh.eventState?.cases ?? []).filter((x) => x.clubId === club && x.stage === 'closed');
  judge('Q_scandal', cases.filter((x) => x.truth === 'fact' && x.type !== 'MAJ-06').length, (l) => `${date} 중대 사건 ${l}건`);
  flag('Q_coverup', cases.some((x) => x.truth === 'found'), `${date} 사건 은폐 발각`);
  const staff = repo.getStaff(club);
  const vacant = !TEAMS.every((t) => staff.some((x) => x.title === '팀장' && x.team === t.key));
  memo.vacancySince = vacant ? (memo.vacancySince ?? date) : null;
  flag('Q_vacancy', !!memo.vacancySince && memo.vacancySince <= addDays(date, -56), `${date} 팀장 공석 8주`);
  const expired = repo.getApprovals('expired').length;
  judge('Q_expired', expired, (l) => `${date} 결재 기한 만료 ${expired}건(${l})`);
  const weeks = repo.apWeeks().filter((w) => w.weekId < date);
  const waste = weeks.reduce((a, w) => a + Math.max(0, w.granted - w.used), 0);
  judge('Q_apWaste', waste, (l) => `${date} 쓰지 않은 행동력 ${waste}(${l})`);
  const tenureSeasons = Math.max(0, meta.season - c.tenureFirst + (meta.mode === 'stove' ? 1 : 0));
  flag('Q_lowLevel', tenureSeasons >= 10 && fresh.ownerLevel < 10, `${date} 재임 ${tenureSeasons}시즌 레벨 ${fresh.ownerLevel}`);
  const franchiseRetired = players.find((p) => p.career.franchise && p.retired && p.retired.season >= c.tenureFirst);
  flag('Q_persuadeFail', !!franchiseRetired, `${date} 간판 ${franchiseRetired?.name ?? ''} 은퇴`);
  const released = new Set(repo.getObligations().filter((o) => o.clubId === club).map((o) => o.playerId));
  const draftRel = players.find((p) => released.has(p.id) && p.draft?.clubId === club && p.draft.round === 1 && p.clubId !== club);
  if (draftRel) {
    const played = repo.battingTotals(meta.season, [draftRel.id]).size + repo.pitchingTotals(meta.season, [draftRel.id]).size;
    flag('Q_draftRel', played === 0, `${date} 1라운드 ${draftRel.name} 데뷔 없이 방출`);
  }
}

/** 우리 구단 소속 연속 시즌(이번 시즌부터 거꾸로) */
function runSeasons(repo: GameRepository, id: number, club: ClubId, season: number, ok: (b: ReturnType<GameRepository['battingTotals']> extends Map<number, infer B> ? B : never, p?: ReturnType<GameRepository['pitchingTotals']> extends Map<number, infer P> ? P : never) => boolean): number {
  let n = 0;
  for (let y = season; y >= 2027; y--) {
    const b = repo.battingTotals(y, [id], club).get(id);
    const p = repo.pitchingTotals(y, [id], club).get(id);
    if (!(b || p) || !ok(b ?? { G: 0, PA: 0, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, BB: 0, HBP: 0, SO: 0, SF: 0 }, p)) break;
    n++;
  }
  return n;
}
