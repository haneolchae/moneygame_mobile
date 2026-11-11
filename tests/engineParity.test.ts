// 4c-0 엔진 구조 전환(D-164): 고정 세계·고정 시드 경기 표본의 결과(타석 사건·득점·투수 기록 전체)가
// 전환 전 엔진과 완전히 같은지 요약 해시로 확인한다. 기준 해시는 전환 전 엔진(커밋 661dc05)으로 만든 값이다.
// 볼카운트 층(4c-1)부터는 승부처 타석의 결과가 달라지므로, 이 시험은 승부처 판정을 끈 경기로 같은 값을 확인한다.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PlayerForm } from '../src/engine/form';
import { simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { NEUTRAL_ENVIRONMENT, type LeagueEnvironment } from '../src/engine/probability';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

/** 전환 전 엔진의 표본 요약 해시 */
const EXPECTED = '147d0e0c3ff81b314cdbde656d2f56c103d3c519';

function sample(): string {
  const world = generateWorld(Rng.fromSeed('parity-sample'), 2026);
  const clubs = [...new Set(world.map((p) => p.clubId).filter((c): c is number => c !== null))];
  const active = (c: number) => world.filter((p) => p.clubId === c && p.level === '1군');
  const forms = { batter: new Map<number, PlayerForm>(), pitcher: new Map<number, PlayerForm>() };
  const rng = Rng.fromSeed('parity-forms');
  const s = (rate: number, n: number) => ({ succ: rate * n, opp: n });
  for (const p of world as PlayerTruth[]) {
    const f: PlayerForm = {
      recent: { b: s(0.08 + rng.next() * 0.04, 90), k: s(0.18 + rng.next() * 0.06, 80), h: s(0.02 + rng.next() * 0.02, 60), x: s(0.3 + rng.next() * 0.08, 60) },
      history: { b: s(0.09, 400), k: s(0.2, 400), h: s(0.03, 400), x: s(0.33, 400) },
    };
    (p.isPitcher ? forms.pitcher : forms.batter).set(p.id, f);
  }
  const envs: LeagueEnvironment[] = [NEUTRAL_ENVIRONMENT, { runs: 0.06, hr: -0.04, runsAdj: 0.03, hrAdj: 1.05 }];
  const hashes: string[] = [];
  for (let g = 0; g < 60; g++) {
    const h = clubs[g % clubs.length]!;
    const a = clubs[(g * 7 + 3) % clubs.length]!;
    if (h === a) continue;
    const r = simulateGame(1000 + g, prepareTeam(h, active(h), [], null), prepareTeam(a, active(a), [], null), Rng.derive('parity', 'game', g), [9, 12, 15][g % 3]!, envs[g % 2], g % 2 === 0 ? { forms, postseason: g % 4 === 0 } : {});
    hashes.push(createHash('sha1').update(JSON.stringify(r)).digest('hex'));
  }
  return createHash('sha1').update(hashes.join('\n')).digest('hex');
}

describe('경기 엔진 표본 일치 (4c-0)', () => {
  it('고정 세계·시드 경기 표본이 전환 전 엔진과 같다', () => {
    expect(sample()).toBe(EXPECTED);
  });
});
