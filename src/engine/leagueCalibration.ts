// 시즌 리그 기준 재조정 (D-103): 실제 1군 선수 구성으로 모의 경기를 돌려 리그 득점·홈런을 재고,
// 그 시즌 목표(기준값 × (1 + 시즌 편차), D-100)에 맞도록 기준 확률 보정값을 정한다.
// 능력치를 재정규화하지 않는다(D-086). 저장되는 난수 흐름을 쓰지 않고 (시드, 시즌)에서 파생한 난수만 쓴다.
import { simulateGame } from './gamesim';
import { prepareTeam } from './lineup';
import type { LeagueEnvironment } from './probability';
import { PROBABILITY_CONFIG as C } from './probabilityConfig';
import { Rng } from './rng';
import type { ClubId, PlayerId, PlayerTruth } from './types';

export interface LeagueTotals {
  games: number;
  runs: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  k: number;
  sf: number;
  tb: number;
  b2: number;
  b3: number;
  roe: number;
  /** 존 모델 검증(10b §14·§15.2): 유형별 인플레이 타구·안타, 내야 안타, 실책, 병살, 희생플라이 */
  bipGB: number;
  hitGB: number;
  bipLD: number;
  hitLD: number;
  bipFB: number;
  hitFB: number;
  infieldHits: number;
  errors: number;
  dp: number;
  /** 4c-1 승부처 타석(D-168 ⑥): 승부처 타석 수, 승부처가 있는 경기 수, 경기별 min(2, 승부처 타석 수) 합, 대결 맞춤 실패로 타석 단위 처리한 수 */
  clutchPa: number;
  clutchGames: number;
  clutchChances: number;
  countFallback: number;
}

/** 구단별 1군 선수로 무작위 대진 경기를 돌려 리그 합계를 잰다(선발은 로테이션 순서). */
export function measureLeague(active: Map<ClubId, PlayerTruth[]>, games: number, seed: string, key: string | number, env: LeagueEnvironment): LeagueTotals {
  const t: LeagueTotals = emptyTotals();
  const clubs = [...active.keys()];
  if (clubs.length < 2) return t;
  const last = new Map<ClubId, PlayerId | null>();
  const pairs = Rng.derive(seed, 'league-calib', key);
  for (let g = 0; g < games; g++) {
    const home = pairs.pick(clubs);
    let away = pairs.pick(clubs);
    while (away === home) away = pairs.pick(clubs);
    const th = prepareTeam(home, active.get(home)!, [], last.get(home) ?? null);
    const ta = prepareTeam(away, active.get(away)!, [], last.get(away) ?? null);
    last.set(home, th.starter.id);
    last.set(away, ta.starter.id);
    const r = simulateGame(g + 1, th, ta, Rng.derive(seed, 'league-calib-game', key, g), C.seasonCalibration.maxInnings, env);
    t.games++;
    t.runs += r.homeRuns + r.awayRuns;
    let clutch = 0;
    for (const e of r.events) {
      if (e.clutch) clutch++;
      if (e.countFallback) t.countFallback++;
      t.pa++;
      const o = e.outcome;
      if (o === 'BB') t.bb++;
      else if (o === 'HBP') t.hbp++;
      else if (o === 'SF') t.sf++;
      else t.ab++;
      if (o === 'K') t.k++;
      if (o === 'ROE') t.roe++;
      if (o === '1B' || o === '2B' || o === '3B' || o === 'HR') {
        t.h++;
        t.tb += o === '1B' ? 1 : o === '2B' ? 2 : o === '3B' ? 3 : 4;
      }
      if (o === '2B') t.b2++;
      if (o === '3B') t.b3++;
      if (o === 'HR') t.hr++;
      if (o === 'DP') t.dp++;
      for (const c of e.credits) if (c.kind === 'E') t.errors++;
      if (e.bb) {
        const isHit = o === '1B' || o === '2B' || o === '3B';
        if (e.bb.type === 'GB') (t.bipGB++, isHit && t.hitGB++);
        else if (e.bb.type === 'LD') (t.bipLD++, isHit && t.hitLD++);
        else (t.bipFB++, isHit && t.hitFB++);
        if (e.bb.infieldHit) t.infieldHits++;
      }
    }
    t.clutchPa += clutch;
    if (clutch > 0) t.clutchGames++;
    t.clutchChances += Math.min(2, clutch);
  }
  return t;
}

/**
 * 그 시즌 환경(편차)과 실제 선수 구성에서 목표에 맞는 보정값을 정한다.
 * runsAdj: 득점 로그 비율 보정(ln(목표/측정)), hrAdj: 홈런 기준 확률 배율(목표/측정). 상한은 설정값.
 */
export function seasonAdjustment(active: Map<ClubId, PlayerTruth[]>, seed: string, season: number, deviation: { runs: number; hr: number }): LeagueEnvironment & { measuredRunsPerGame: number; measuredHrPerPa: number } {
  const env: LeagueEnvironment = { runs: deviation.runs, hr: deviation.hr };
  const t = measureLeague(active, C.seasonCalibration.games, seed, season, env);
  const runs = t.games ? t.runs / t.games : C.leagueTarget.runsPerGame;
  const hr = t.pa ? t.hr / t.pa : C.leagueTarget.hrPerPa;
  const targetRuns = C.leagueTarget.runsPerGame * (1 + deviation.runs);
  const targetHr = C.leagueTarget.hrPerPa * (1 + deviation.hr);
  const lim = C.seasonCalibration.maxAdjustRatio;
  const clampRatio = (x: number) => Math.max(1 / lim, Math.min(lim, x));
  const hrAdj = Math.round(clampRatio(targetHr / hr) * 10_000) / 10_000;
  const runsAdj = Math.round(Math.log(clampRatio(targetRuns / runs)) * 10_000) / 10_000;
  return { ...env, runsAdj, hrAdj, measuredRunsPerGame: Math.round(runs * 100) / 100, measuredHrPerPa: Math.round(hr * 10_000) / 10_000 };
}

export function emptyTotals(): LeagueTotals {
  return { games: 0, runs: 0, pa: 0, ab: 0, h: 0, hr: 0, bb: 0, hbp: 0, k: 0, sf: 0, tb: 0, b2: 0, b3: 0, roe: 0, bipGB: 0, hitGB: 0, bipLD: 0, hitLD: 0, bipFB: 0, hitFB: 0, infieldHits: 0, errors: 0, dp: 0, clutchPa: 0, clutchGames: 0, clutchChances: 0, countFallback: 0 };
}
