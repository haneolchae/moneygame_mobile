// 게임 시작 이전(2026 시즌까지) 선수 기록 생성 (05 문서, D-079).
// 당시 능력은 현재 능력에서 나이에 따른 성장·노화를 거꾸로 적용해 구하고, 경기와 같은 타석 확률 모델로 시즌 합계를 만든다.
// 경기별·분할 기록은 없다. 같은 시드면 같은 기록이 나온다.
import { paProbabilities } from './gamesim';
import { Rng } from './rng';
import type { BattingTotals, PitchingTotals } from './stats';
import type { ClubId, PlayerId, PlayerTruth } from './types';
import { ageCurve, overall } from './worldgen';

export interface HistoryLine {
  playerId: PlayerId;
  season: number;
  clubId: ClubId;
  kind: 'bat' | 'pit';
  totals: BattingTotals | PitchingTotals;
}

/** ASSUMPTION(D-079): 출전량 기준. 능력 47 안팎이 주전 경계다. */
export const HISTORY = {
  regularPa: 560,
  starterOuts: 165 * 3,
  relieverOuts: 65 * 3,
  roleMid: 47,
  roleSpread: 3.5,
  firstSeasonShare: 0.5,
  minPa: 5,
  minOuts: 3,
} as const;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clampR = (v: number) => Math.max(15, Math.min(95, v));

const AVG_PLAYER = {
  batting: { contact: 50, eye: 50, power: 50, speed: 50 },
  pitching: { stuff: 50, control: 50, groundball: 50, stamina: 50 },
  defense: { fielding: 50, arm: 50, range: 50 },
} as unknown as PlayerTruth;

/** 모든 능력이 v인 가상의 상대 */
function flatPlayer(v: number): PlayerTruth {
  return {
    batting: { contact: v, eye: v, power: v, speed: v },
    pitching: { stuff: v, control: v, groundball: 50, stamina: 50 },
    defense: { fielding: v, arm: v, range: v },
  } as unknown as PlayerTruth;
}

/** 그 시즌의 능력: 현재 능력 − (현재 나이 보정 − 당시 나이 보정) */
export function pastSelf(p: PlayerTruth, season: number, currentSeason: number): PlayerTruth {
  const born = Number(p.birthDate.slice(0, 4));
  const shift = ageCurve(season - born) - ageCurve(currentSeason - born);
  const adj = <T extends object>(r: T): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clampR((v as number) + shift)])) as T;
  return { ...p, batting: adj(p.batting), pitching: p.pitching ? adj(p.pitching) : null, defense: adj(p.defense) };
}

function draw(rng: Rng, probs: Record<string, number>): string {
  let r = rng.next();
  let last = 'FO';
  for (const [k, v] of Object.entries(probs)) {
    last = k;
    r -= v;
    if (r < 0) return k;
  }
  return last;
}

/** opponent: 상대 평균 능력(프로 50). 아마추어 기록은 같은 학교급 평균을 상대로 만든다. */
export function battingLine(rng: Rng, p: PlayerTruth, pa: number, opponent = 50): BattingTotals {
  const probs = paProbabilities(p, opponent === 50 ? AVG_PLAYER : flatPlayer(opponent), 50);
  const c: Record<string, number> = {};
  for (let i = 0; i < pa; i++) {
    let o = draw(rng, probs);
    if (o === 'FO' && rng.chance(0.06)) o = 'SF';
    c[o] = (c[o] ?? 0) + 1;
  }
  const n = (k: string) => c[k] ?? 0;
  const H = n('1B') + n('2B') + n('3B') + n('HR');
  const reach = H + n('BB') + n('HBP') + n('ROE');
  return {
    G: Math.min(144, Math.max(1, Math.round(pa / 3.9))),
    PA: pa,
    AB: pa - n('BB') - n('HBP') - n('SF'),
    H,
    '2B': n('2B'),
    '3B': n('3B'),
    HR: n('HR'),
    RBI: Math.round(n('HR') * 1.55 + (H - n('HR')) * 0.27 + n('SF') + rng.normal(0, 3)),
    R: Math.max(n('HR'), Math.round(reach * 0.31 + n('HR') * 0.69 + rng.normal(0, 3))),
    BB: n('BB'),
    HBP: n('HBP'),
    SO: n('K'),
    SF: n('SF'),
  };
}

export function pitchingLine(rng: Rng, p: PlayerTruth, targetOuts: number, starter: boolean, closer: boolean, opponent = 50): PitchingTotals {
  const probs = paProbabilities(opponent === 50 ? AVG_PLAYER : flatPlayer(opponent), p, 50);
  const c: Record<string, number> = {};
  let outs = 0;
  let bf = 0;
  while (outs < targetOuts) {
    const o = draw(rng, probs);
    c[o] = (c[o] ?? 0) + 1;
    bf++;
    if (o === 'K' || o === 'GO' || o === 'FO') outs++;
  }
  const n = (k: string) => c[k] ?? 0;
  const H = n('1B') + n('2B') + n('3B') + n('HR');
  const tb = n('1B') + 2 * n('2B') + 3 * n('3B') + 4 * n('HR');
  // Base Runs로 실점을 추정한다.
  const A = H + n('BB') + n('HBP') + n('ROE') - n('HR');
  const B = (1.4 * tb - 0.6 * H - 3 * n('HR') + 0.1 * (n('BB') + n('HBP'))) * 1.02;
  const R = Math.max(0, Math.round((A * B) / Math.max(1, B + outs) + n('HR')));
  const ER = Math.min(R, Math.round(R * 0.92));
  const era = outs > 0 ? (27 * ER) / outs : 9;
  const GS = starter ? Math.max(1, Math.round(outs / 16.5)) : 0;
  const G = starter ? GS : Math.max(1, Math.round((outs / 3) * 1.05));
  let W: number;
  let L: number;
  if (starter) {
    const dec = Math.round(GS * 0.62);
    W = Math.round(dec * Math.max(0.2, Math.min(0.8, 0.5 + (4.4 - era) * 0.07)));
    L = dec - W;
  } else {
    W = Math.round(G * 0.04);
    L = Math.round(G * 0.04);
  }
  return { G, GS, OUTS: outs, W, L, SV: closer ? Math.round(G * 0.45) : 0, BF: bf, H, R, ER, BB: n('BB'), HBP: n('HBP'), K: n('K'), HR: n('HR'), pitches: Math.round(bf * 3.9) };
}

/** KBO에서 뛴 시즌 수: 국내 선수는 프로 연차, 외국인·아시아쿼터는 재계약 연차 + 1 */
export function kboSeasons(p: PlayerTruth): number {
  return p.origin === 'domestic' ? p.career.proSeasons : p.career.foreignRenewals + 1;
}

/** 소속 선수 전원의 시작 이전 기록. 구단별 마무리(구원 중 최고 능력)는 세이브를 얻는다. */
export function generateHistory(seed: string, players: PlayerTruth[], lastSeason: number): HistoryLine[] {
  const out: HistoryLine[] = [];
  const closers = new Set<PlayerId>();
  const clubIds = [...new Set(players.filter((p) => p.clubId !== null).map((p) => p.clubId!))];
  for (const c of clubIds) {
    const best = players.filter((p) => p.clubId === c && p.position === 'RP').sort((a, b) => overall(b) - overall(a) || a.id - b.id)[0];
    if (best) closers.add(best.id);
  }
  for (const p of players) {
    if (p.clubId === null) continue;
    const rng = Rng.derive(seed, 'history', p.id);
    const n = kboSeasons(p);
    for (let i = 0; i < n; i++) {
      const season = lastSeason - i;
      const past = pastSelf(p, season, lastSeason);
      const role = logistic((overall(past) - HISTORY.roleMid) / HISTORY.roleSpread) * (0.8 + rng.next() * 0.25) * (i === n - 1 && n > 1 ? HISTORY.firstSeasonShare : 1);
      if (p.isPitcher) {
        const starter = p.position === 'SP';
        const outs = Math.round((starter ? HISTORY.starterOuts : HISTORY.relieverOuts) * role);
        if (outs < HISTORY.minOuts) continue;
        out.push({ playerId: p.id, season, clubId: p.clubId, kind: 'pit', totals: pitchingLine(rng, past, outs, starter, closers.has(p.id) && i < 3) });
      } else {
        const pa = Math.round(HISTORY.regularPa * role);
        if (pa < HISTORY.minPa) continue;
        out.push({ playerId: p.id, season, clubId: p.clubId, kind: 'bat', totals: battingLine(rng, past, pa) });
      }
    }
  }
  return out;
}

export function addBatting(a: BattingTotals, b: BattingTotals): BattingTotals {
  const out = { ...a };
  for (const k of Object.keys(b) as Array<keyof BattingTotals>) out[k] = (a[k] ?? 0) + b[k];
  return out;
}

export function addPitching(a: PitchingTotals, b: PitchingTotals): PitchingTotals {
  const out = { ...a };
  for (const k of Object.keys(b) as Array<keyof PitchingTotals>) out[k] = (a[k] ?? 0) + b[k];
  return out;
}

export const EMPTY_BATTING: BattingTotals = { G: 0, PA: 0, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, BB: 0, HBP: 0, SO: 0, SF: 0 };
export const EMPTY_PITCHING: PitchingTotals = { G: 0, GS: 0, OUTS: 0, W: 0, L: 0, SV: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, HBP: 0, K: 0, HR: 0, pitches: 0 };
