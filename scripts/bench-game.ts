// 경기 계산 벤치마크: 같은 세계에서 simulateGame만 반복해 경기당 시간을 잰다(성능 비교용, 결과 저장 없음).
// 사용: npx esbuild scripts/bench-game.ts --bundle --platform=node --outfile=dist/cli/bench.js && node dist/cli/bench.js [games]
import { performance } from 'node:perf_hooks';
import type { PlayerForm } from '../src/engine/form';
import { simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

const games = Number(process.argv[2] ?? 1500);
const world = generateWorld(Rng.fromSeed('bench'), 2026);
const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
const active = (c: number) => world.filter((p) => p.clubId === c && p.level === '1군');
// 성적 혼합 표본: 선수마다 다른 최근·과거 비율(경기마다 x가 달라지는 실제 조건을 흉내)
const forms = { batter: new Map<number, PlayerForm>(), pitcher: new Map<number, PlayerForm>() };
const rng = Rng.fromSeed('bench-forms');
const sample = (rate: number, n: number) => ({ succ: rate * n, opp: n });
for (const p of world as PlayerTruth[]) {
  const f: PlayerForm = {
    recent: { b: sample(0.08 + rng.next() * 0.04, 90), k: sample(0.18 + rng.next() * 0.06, 80), h: sample(0.02 + rng.next() * 0.02, 60), x: sample(0.3 + rng.next() * 0.08, 60) },
    history: { b: sample(0.09, 400), k: sample(0.2, 400), h: sample(0.03, 400), x: sample(0.33, 400) },
  };
  (p.isPitcher ? forms.pitcher : forms.batter).set(p.id, f);
}
for (const withForms of [false, true]) {
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    const h = clubs[g % clubs.length]!;
    const a = clubs[(g * 7 + 3) % clubs.length]!;
    if (h === a) continue;
    simulateGame(g + 1, prepareTeam(h, active(h), [], null), prepareTeam(a, active(a), [], null), Rng.derive('bench', 'game', g), 12, undefined, withForms ? { forms } : {});
  }
  console.log(JSON.stringify({ withForms, games, msPerGame: +((performance.now() - t0) / games).toFixed(3) }));
}
