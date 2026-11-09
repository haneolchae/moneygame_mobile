// 확률 모델 보정 도구 (10a 7a·8장, D-100·D-103): 새로 생성한 리그(능력 평균 50)로 경기만 돌려 리그 분포를 잰다.
// 사용: npm run calibrate -- [--seeds 6] [--games 720] [--runs 0] [--hr 0]
//  --runs/--hr: 시즌 리그 환경 편차(예: 0.1 = +10%)를 넣어 환경 반영 크기를 확인한다.
// 기준 확률(PROBABILITY_CONFIG.base 등)은 이 도구로 리그 목표에 맞춘다. 게임 안에서는 시즌마다
// 같은 측정 함수(measureLeague)로 실제 1군 구성에 맞춰 다시 조정한다(D-103).
import { emptyTotals, measureLeague, type LeagueTotals } from '../src/engine/leagueCalibration';
import { PROBABILITY_CONFIG } from '../src/engine/probabilityConfig';
import { Rng } from '../src/engine/rng';
import type { ClubId, PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const seeds = Number(arg('seeds', '6'));
const games = Number(arg('games', '720'));
const env = { runs: Number(arg('runs', '0')), hr: Number(arg('hr', '0')) };

const t: LeagueTotals = emptyTotals();
const t0 = Date.now();
for (let s = 0; s < seeds; s++) {
  const world = generateWorld(Rng.fromSeed(`calibrate-${s}`), 2026);
  const active = new Map<ClubId, PlayerTruth[]>();
  for (const p of world) if (p.clubId !== null && p.level === '1군') active.set(p.clubId, [...(active.get(p.clubId) ?? []), p]);
  const r = measureLeague(active, games, `calibrate-${s}`, 'tool', env);
  for (const k of Object.keys(t) as Array<keyof LeagueTotals>) t[k] += r[k];
}
const obp = (t.h + t.bb + t.hbp) / (t.ab + t.bb + t.hbp + t.sf);
const slg = t.tb / t.ab;
const target = PROBABILITY_CONFIG.leagueTarget;
console.log(
  JSON.stringify({
    modelVersion: PROBABILITY_CONFIG.modelVersion,
    env,
    games: t.games,
    runsPerGame: +(t.runs / t.games).toFixed(2),
    targetRunsPerGame: +(target.runsPerGame * (1 + env.runs)).toFixed(2),
    hrPerPa: +(t.hr / t.pa).toFixed(4),
    targetHrPerPa: +(target.hrPerPa * (1 + env.hr)).toFixed(4),
    avg: +(t.h / t.ab).toFixed(3),
    obp: +obp.toFixed(3),
    slg: +slg.toFixed(3),
    ops: +(obp + slg).toFixed(3),
    babip: +((t.h - t.hr) / (t.ab - t.k - t.hr + t.sf)).toFixed(3),
    bbPct: +(t.bb / t.pa).toFixed(3),
    kPct: +(t.k / t.pa).toFixed(3),
    doubles: t.b2,
    triples: t.b3,
    roePct: +(t.roe / t.pa).toFixed(4),
    // 존 모델 검증 지표(10b §14·§15.2, D-104)
    hitRateGB: +(t.hitGB / t.bipGB).toFixed(3),
    hitRateLD: +(t.hitLD / t.bipLD).toFixed(3),
    hitRateFB: +(t.hitFB / t.bipFB).toFixed(3),
    singlePct: +(100 * (t.h - t.hr - t.b2 - t.b3) / (t.h - t.hr)).toFixed(1),
    doublePct: +(100 * t.b2 / (t.h - t.hr)).toFixed(1),
    triplePct: +(100 * t.b3 / (t.h - t.hr)).toFixed(2),
    infieldHitPct: +(100 * t.infieldHits / t.h).toFixed(1),
    errorsPerTeamGame: +(t.errors / (2 * t.games)).toFixed(2),
    dpPerTeamGame: +(t.dp / (2 * t.games)).toFixed(2),
    sfPerTeamGame: +(t.sf / (2 * t.games)).toFixed(2),
    elapsedMs: Date.now() - t0,
  }),
);
