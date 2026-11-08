// 구단이 인지하는 선수 평가(관찰). 실제 값에 고정된 오차를 더해 20~80 평가로 바꾼다(04·06 문서).
// 오차는 (시드, 관찰 구단, 선수, 항목)으로 정해지는 결정론적 값이라 조회할 때마다 바뀌지 않고 난수 흐름도 쓰지 않는다.
// 06 문서의 누적 관찰·스카우트 능력 모델은 3단계에서 이 함수를 대체한다.
import { OBSERVATION, toScoutScale } from './config';
import { stableNormal } from './rng';
import type { ClubId, PlayerTruth } from './types';

export interface ObservedRatings {
  [attribute: string]: number;
}

function observe(seed: string, observer: ClubId, player: PlayerTruth, attribute: string, value: number, sdScale: number): number {
  // 우리 구단 선수는 현재 능력치를 오차 없이 1점 단위로 보여준다(D-078). 히든 요소는 이 함수로 노출하지 않는다.
  if (player.clubId === observer) return Math.round(toScoutScale(value));
  const sd = OBSERVATION.otherClubSd * sdScale;
  const noisy = value + stableNormal(seed, 'obs', observer, player.id, attribute) * sd;
  const step = OBSERVATION.displayStep;
  return Math.round(toScoutScale(noisy) / step) * step;
}

/** sdScale: 스카우트팀 능력에 따른 오차 배율 (staff.scoutingSdScale, 2c) */
export function observePlayer(seed: string, observer: ClubId, player: PlayerTruth, sdScale = 1): ObservedRatings {
  const out: ObservedRatings = {};
  if (player.pitching) {
    for (const [k, v] of Object.entries(player.pitching)) out[k] = observe(seed, observer, player, k, v, sdScale);
  }
  if (!player.isPitcher) {
    for (const [k, v] of Object.entries(player.batting)) out[k] = observe(seed, observer, player, k, v, sdScale);
  }
  for (const [k, v] of Object.entries(player.defense)) out[`def_${k}`] = observe(seed, observer, player, `def_${k}`, v, sdScale);
  return out;
}
