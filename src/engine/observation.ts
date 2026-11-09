// 구단이 인지하는 선수 평가(관찰). 능력치는 1~100 척도로 보여 준다(D-086, 20~80 표시 변환 폐지).
// 우리 구단 선수는 실제값(D-078), 다른 구단 선수는 고정된 오차를 더한 값(5점 단위)이다.
// 오차는 (시드, 관찰 구단, 선수, 항목)으로 정해지는 결정론적 값이라 조회할 때마다 바뀌지 않고 난수 흐름도 쓰지 않는다.
// 3c에서 다른 구단 선수는 '스카우트 추정 범위'(가운데 값 ± 폭, D-089)로 바뀐다.
import { OBSERVATION } from './config';
import { stableNormal } from './rng';
import type { ClubId, PlayerTruth } from './types';
import { breakingBall } from './worldgen';

export interface ObservedRatings {
  [attribute: string]: number;
}

const toScale = (v: number) => Math.max(1, Math.min(100, v));

function observe(seed: string, observer: ClubId, player: PlayerTruth, attribute: string, value: number, sdScale: number): number {
  // 우리 구단 선수는 현재 능력치를 오차 없이 1점 단위로 보여준다(D-078). 히든 요소는 이 함수로 노출하지 않는다.
  if (player.clubId === observer) return Math.round(toScale(value));
  const sd = OBSERVATION.otherClubSd * sdScale;
  const noisy = value + stableNormal(seed, 'obs', observer, player.id, attribute) * sd;
  const step = OBSERVATION.displayStep;
  return Math.max(1, Math.round(toScale(noisy) / step) * step);
}

/** sdScale: 스카우트팀 능력에 따른 오차 배율 (staff.scoutingSdScale, 2c) */
export function observePlayer(seed: string, observer: ClubId, player: PlayerTruth, sdScale = 1): ObservedRatings {
  const out: ObservedRatings = {};
  if (player.pitching) {
    for (const [k, v] of Object.entries(player.pitching)) {
      // 구속(km/h)은 공개 측정값이라 오차 없이 보여 준다(1~100 능력치가 아님).
      out[k] = k === 'velocityAvg' || k === 'velocityMax' ? v : observe(seed, observer, player, k, v, sdScale);
    }
    const breaking = breakingBall(player.pitches);
    if (breaking !== null) out.breaking = observe(seed, observer, player, 'breaking', breaking, sdScale);
  }
  if (!player.isPitcher) {
    for (const [k, v] of Object.entries(player.batting)) out[k] = observe(seed, observer, player, k, v, sdScale);
    for (const [k, v] of Object.entries(player.defense)) out[`def_${k}`] = observe(seed, observer, player, `def_${k}`, v, sdScale);
    if (player.catcher) for (const [k, v] of Object.entries(player.catcher)) out[`cat_${k}`] = observe(seed, observer, player, `cat_${k}`, v, sdScale);
  }
  return out;
}
