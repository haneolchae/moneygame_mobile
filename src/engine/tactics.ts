// 4c-2a 작전 사건·감독 AI 판단 재료(10 문서 지시·감독 판단, D-170). 순수 함수만 둔다.
// 감독 AI는 자기 선수는 실제 값, 상대 선수는 자기 구단 추정값으로 본다(D-165 (3)). 추정값은 Estimator가 주고,
// 엔진 기본값은 실제 값 + (평가 구단·선수·항목)으로 고정된 편차다. 판단 함수는 추정값만 읽어 실제 값을 드러내지 않는다.
import { TACTICS as T } from './config';
import { logit, sigmoid } from './mathx';
import { Rng } from './rng';
import type { PlayerTruth, Position } from './types';

export type RatingKey = 'contact' | 'power' | 'eye' | 'speed' | 'baserunning' | 'bunt' | 'armStrength' | 'transfer' | 'holdRunners' | 'blocking' | 'control';
const KEY_INDEX: Record<RatingKey, number> = { contact: 1, power: 2, eye: 3, speed: 4, baserunning: 5, bunt: 6, armStrength: 7, transfer: 8, holdRunners: 9, blocking: 10, control: 11 };

export function trueRating(p: PlayerTruth, key: RatingKey): number {
  switch (key) {
    case 'contact':
    case 'power':
    case 'eye':
    case 'speed':
    case 'baserunning':
    case 'bunt':
      return p.batting[key];
    case 'armStrength':
      return p.defense.armStrength;
    case 'transfer':
    case 'blocking':
      return p.catcher?.[key] ?? 50;
    case 'holdRunners':
    case 'control':
      return p.pitching?.[key] ?? 50;
  }
}

/** 평가 구단이 보는 능력. 자기 선수면 실제 값을 넘겨도 된다(호출하는 쪽이 구분) */
export type Estimator = (evaluatorClubId: number, p: PlayerTruth, key: RatingKey) => number;

/** 엔진 기본 추정: 실제 값 + 구단·선수·항목 고정 편차(표준편차 TACTICS.estimateSd), 1~100 */
export const defaultEstimator: Estimator = (club, p, key) =>
  Math.max(1, Math.min(100, trueRating(p, key) + Rng.fromKeys(0x45535449, club, p.id, KEY_INDEX[key]).normal(0, T.estimateSd)));

export const z = (v: number) => (v - 50) / 10;

/** 타격 지수(컨택·장타·선구안 평균) */
export const hitIndex = (contact: number, power: number, eye: number) => (contact + power + eye) / 3;

/** 그 포지션을 맡을 수 있는가(지명타자는 누구나). 포지션 숙련 50 이상 */
export const canPlay = (p: PlayerTruth, pos: Position | 'DH') => pos === 'DH' || (p.positions[pos as Position] ?? 0) >= 50;

/** 도루 성공 확률(10 문서 D-170 (3)). base: 2 = 2루 도루, 3 = 3루 도루. 값은 판단이면 추정, 판정이면 실제 */
export function stealSuccess(base: 2 | 3, runner: { speed: number; baserunning: number }, catcherArm: number, catcherTransfer: number, pitcherHold: number, extraLogit = 0): number {
  const S = T.steal;
  return sigmoid(extraLogit + logit(base === 2 ? S.base2 : S.base3) + S.speed * z(runner.speed) + S.baserunning * z(runner.baserunning) - S.catcherArm * z(catcherArm) - S.catcherTransfer * z(catcherTransfer) - S.hold * z(pitcherHold));
}

/** 타석 전 주루 사건 확률(주자가 있을 때): 견제사(1루 주자), 폭투, 포일, 보크 */
export function runningRates(pitcher: PlayerTruth, catcher: PlayerTruth, runnerOnFirst: boolean): { pickoff: number; wildPitch: number; passedBall: number; balk: number } {
  const hold = z(pitcher.pitching?.holdRunners ?? 50);
  return {
    pickoff: runnerOnFirst ? T.pickoff.rate * Math.exp(T.pickoff.hold * hold) : 0,
    wildPitch: T.wildPitch.rate * Math.exp(T.wildPitch.control * z(pitcher.pitching?.control ?? 50)),
    passedBall: T.passedBall.rate * Math.exp(T.passedBall.blocking * z(catcher.catcher?.blocking ?? 50)),
    balk: T.balk.rate * Math.exp(T.balk.hold * hold),
  };
}

/** 번트 결과 확률: 번트 안타, (안타가 아니면) 성공 */
export function buntProbs(kind: 'sac' | 'squeeze', batter: PlayerTruth, extraLogit = 0): { hit: number; success: number } {
  const B = T.bunt;
  return {
    hit: kind === 'sac' ? sigmoid(logit(B.hitBase) + B.hitSpeed * z(batter.batting.speed)) : 0,
    success: sigmoid(extraLogit + logit(kind === 'sac' ? B.sacBase : B.squeezeBase) + B.skill * z(batter.batting.bunt)),
  };
}

/** 카운트 지시 배율 [볼, 스트라이크, 파울, 사구, 인플레이] */
export type CountTactic = 'none' | 'take' | 'pitchAround' | 'attack';
export function countMultipliers(offense: CountTactic, defense: CountTactic): [number, number, number, number, number] {
  const m: [number, number, number, number, number] = [1, 1, 1, 1, 1];
  for (const t of [offense, defense]) {
    if (t === 'none') continue;
    const c = T.count[t];
    m[0] *= c.ball;
    m[1] *= c.strike;
    m[2] *= c.foul;
    m[4] *= c.inplay;
  }
  return m;
}
