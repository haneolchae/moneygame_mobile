// 경기 엔진 기준 결과(골든): 고정 세계·고정 시드 경기 표본의 결과(타석 사건·득점·투수 기록 전체)를 요약 해시로 고정해
// 의도하지 않은 엔진 변경을 잡는다. 엔진 동작을 일부러 바꾸는 차수에서만 해시를 새로 기록하고 이유를 남긴다.
//  - 4c-0(D-164): 전환 전 엔진(커밋 661dc05)과 같은 값 147d0e0c… 으로 구조 전환이 동작을 바꾸지 않았음을 확인했다.
//  - 4c-1(D-167 (5)): 타석 판정 난수를 (경기 키, 타석 순번, 사건 종류)에서 파생하도록 바꿔 결과 경로가 달라졌다(분포는 같음,
//    보정 도구로 확인). 볼카운트 층 표(winProbability.json·countModel.json)를 다시 만들어도 해시가 바뀐다.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PlayerForm } from '../src/engine/form';
import { simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { NEUTRAL_ENVIRONMENT, type LeagueEnvironment } from '../src/engine/probability';
import { Rng } from '../src/engine/rng';
import type { PlayerTruth } from '../src/engine/types';
import { generateWorld } from '../src/engine/worldgen';

/** 엔진 표본 요약 해시. 4c-1 처음 기준표 d5480b6c…, D-169 파울 비율 기준표 7b2d5c0b…, 4c-2a 작전 사건(D-170) 73c41884…, 4c-2b 감독 판단 오차·승리 확률 표 wp-64952f24d2·기준표 cm-1cbf6ee319부터 아래 값 */
const EXPECTED = 'e300bc4b72ae81cf2170c5774bc46314fa1da162';

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

describe('경기 엔진 기준 결과', () => {
  it('고정 세계·시드 경기 표본이 기록한 기준 해시와 같다', () => {
    expect(sample()).toBe(EXPECTED);
  });
});
