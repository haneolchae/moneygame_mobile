// 확률 모델 보정 도구 (10a 7a·8장, D-100): 새로 생성한 리그(능력 평균 50)로 경기만 돌려 리그 분포를 잰다.
// 사용: npm run calibrate -- [--seeds 3] [--games 720] [--runs 0] [--hr 0]
//  --runs/--hr: 시즌 리그 환경 편차(예: 0.1 = +10%)를 넣어 환경 반영 크기를 확인한다.
// 저장·날짜 진행 없이 엔진만 쓴다. 결과는 PROBABILITY_CONFIG.leagueTarget과 비교해 출력한다.
import { simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { PROBABILITY_CONFIG } from '../src/engine/probabilityConfig';
import { Rng } from '../src/engine/rng';
import type { PlayerId, PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const seeds = Number(arg('seeds', '3'));
const games = Number(arg('games', '720'));
const env = { runs: Number(arg('runs', '0')), hr: Number(arg('hr', '0')) };

const t = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, hbp: 0, k: 0, sf: 0, tb: 0, runs: 0, games: 0, b2: 0, b3: 0, roe: 0 };
for (let s = 0; s < seeds; s++) {
  const world = generateWorld(Rng.fromSeed(`calibrate-${s}`), 2026);
  const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
  const active = (c: number) => world.filter((p: PlayerTruth) => p.clubId === c && p.level === '1군');
  const last = new Map<number, PlayerId | null>();
  const rng = Rng.fromSeed(`pairs-${s}`);
  for (let g = 0; g < games; g++) {
    const home = rng.pick(clubs);
    let away = rng.pick(clubs);
    while (away === home) away = rng.pick(clubs);
    const team = (c: number) => prepareTeam(c, active(c), [], last.get(c) ?? null);
    const th = team(home);
    const ta = team(away);
    last.set(home, th.starter.id);
    last.set(away, ta.starter.id);
    const r = simulateGame(g + 1, th, ta, Rng.derive(`calibrate-${s}`, 'game', g), 12, env);
    t.games++;
    t.runs += r.homeRuns + r.awayRuns;
    for (const e of r.events) {
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
    }
  }
}
const avg = t.h / t.ab;
const obp = (t.h + t.bb + t.hbp) / (t.ab + t.bb + t.hbp + t.sf);
const slg = t.tb / t.ab;
const babip = (t.h - t.hr) / (t.ab - t.k - t.hr + t.sf);
const target = PROBABILITY_CONFIG.leagueTarget;
const out = {
  modelVersion: PROBABILITY_CONFIG.modelVersion,
  env,
  games: t.games,
  runsPerGame: +(t.runs / t.games).toFixed(2),
  targetRunsPerGame: +(target.runsPerGame * (1 + env.runs)).toFixed(2),
  hrPerPa: +(t.hr / t.pa).toFixed(4),
  targetHrPerPa: +(target.hrPerPa * (1 + env.hr)).toFixed(4),
  avg: +avg.toFixed(3),
  obp: +obp.toFixed(3),
  slg: +slg.toFixed(3),
  ops: +(obp + slg).toFixed(3),
  babip: +babip.toFixed(3),
  bbPct: +(t.bb / t.pa).toFixed(3),
  kPct: +(t.k / t.pa).toFixed(3),
  doubles: t.b2,
  triples: t.b3,
  roePct: +(t.roe / t.pa).toFixed(4),
};
console.log(JSON.stringify(out));
