// 타구·수비 존 모델 (10b 문서, D-102). 홈런이 아닌 인플레이 타구의 구역·담당 수비수·판정·주자 진루·수비 기록.
// 안타 여부의 기대값은 x 고정 보정 θ(§6)로 10a의 x_match에 맞추고, 타구 질·방향은 안타의 모양을,
// 개인 수비 능력·타자 주력은 그 위의 차이를 만든다. 수치는 zoneConfig(밸런스 초안)에만 있다.
import { clampP, logit, sigmoid } from './mathx';
import type { Rng } from './rng';
import type { PlayerId, PlayerTruth } from './types';
import { ZONE_CONFIG as Z, type BallType, type Depth, type Quality } from './zoneConfig';

export type FieldPos = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';
export type Fielders = Record<FieldPos, PlayerTruth>;
export type TypeShares = Record<BallType, number>;

export interface Runner {
  id: PlayerId;
  speed: number;
  baserunning: number;
  /** 책임 투수 */
  pitcherId: PlayerId;
  /** 실책으로 출루하면 false(비자책) */
  earned: boolean;
}
export type Bases = [Runner | null, Runner | null, Runner | null];

export interface Credit {
  playerId: PlayerId;
  kind: 'PO' | 'A' | 'E';
}

export interface Cell {
  type: BallType;
  q: Quality;
  /** 필드 방향 1~7(3루 선상 → 1루 선상, 좌타자는 거울상으로 이미 바꾼 값) */
  dir: number;
  depth: Depth;
  p: number;
  /** 중립 조건 도달 로짓(θ 제외). 도달할 수 없는 칸은 −Infinity */
  reachLogit0: number;
  /** 중립 조건 dH/dPr(처리·실책 기록·송구는 θ와 무관한 상수) */
  dHdPr: number;
}

const INFIELD_POS = new Set<FieldPos>(['P', 'C', '1B', '2B', '3B', 'SS']);
const TYPES: readonly BallType[] = ['GB', 'LD', 'FB'];
const z = (v: number) => (v - 50) / Z.zDivisor;

// ───────── 유효 수비 능력 (§4) ─────────

function skillOf(p: PlayerTruth, pos: FieldPos): number {
  return pos === 'P' ? Z.effective.skillPivot : (p.positions[pos] ?? 0);
}
const penalty = (p: PlayerTruth, pos: FieldPos) => Z.effective.skillPenalty * Math.max(0, Z.effective.skillPivot - skillOf(p, pos));
export function effRange(p: PlayerTruth, pos: FieldPos): number {
  const share = INFIELD_POS.has(pos) ? Z.effective.infieldSpeedShare : Z.effective.outfieldSpeedShare;
  return (1 - share) * p.defense.range + share * p.batting.speed - penalty(p, pos);
}
export function effFielding(p: PlayerTruth, pos: FieldPos): number {
  return (pos === 'P' ? (p.pitching?.fielding ?? 50) : p.defense.fielding) - penalty(p, pos);
}
const effArm = (p: PlayerTruth, pos: FieldPos) => p.defense.armStrength - penalty(p, pos);
const effAccuracy = (p: PlayerTruth, pos: FieldPos) => p.defense.armAccuracy - penalty(p, pos);

// ───────── 타구 분포 (§3) ─────────

// 설정에서 정해지는 상수 로짓은 모듈을 읽을 때 한 번만 계산한다(성능, 결과 동일).
const Q_CUT: Record<BallType, [number, number]> = {
  GB: [logit(Z.quality.base.GB[0]), logit(Z.quality.base.GB[0] + Z.quality.base.GB[1])],
  LD: [logit(Z.quality.base.LD[0]), logit(Z.quality.base.LD[0] + Z.quality.base.LD[1])],
  FB: [logit(Z.quality.base.FB[0]), logit(Z.quality.base.FB[0] + Z.quality.base.FB[1])],
};
const CLEAN_L: Record<BallType, number> = { GB: logit(Z.clean.base.GB), LD: logit(Z.clean.base.LD), FB: logit(Z.clean.base.FB) };
const THROW_L = [logit(Z.throw.base[0]), logit(Z.throw.base[1]), logit(Z.throw.base[2])] as const;
const PULL = [1, 2, 3, 4, 5, 6, 7].map((s) => (4 - s) / 3);

/** 타구 질 분포(약·중·강): 순서형 로짓 */
export function qualityDist(type: BallType, power: number, stuff: number, velocityZ: number): [number, number, number] {
  const [c1, c2] = Q_CUT[type];
  const mu = Z.quality.power * z(power) - Z.quality.stuff * z(stuff) - Z.quality.velocity * velocityZ;
  const pw = sigmoid(c1 - mu);
  const pm = sigmoid(c2 - mu);
  return [pw, pm - pw, 1 - pm];
}

const DIR_CACHE = new Map<number, number[]>();
/** 방향 분포(필드 방향 S1~S7). 라인드라이브·뜬공은 장타가 높을수록 당겨친다. 좌타자는 거울상 */
export function directionDist(type: BallType, power: number, hand: 'R' | 'L'): number[] {
  // 능력치는 정수라 (유형, 장타, 방향)별로 한 번만 계산한다.
  const key = Number.isInteger(power) ? (TYPE_ORDER[type] * 1000 + power) * 2 + (hand === 'L' ? 1 : 0) : -1;
  if (key >= 0) {
    const hit = DIR_CACHE.get(key);
    if (hit) return hit;
    const v = computeDirection(type, power, hand);
    DIR_CACHE.set(key, v);
    return v;
  }
  return computeDirection(type, power, hand);
}
const TYPE_ORDER: Record<BallType, number> = { GB: 0, LD: 1, FB: 2 };
function computeDirection(type: BallType, power: number, hand: 'R' | 'L'): number[] {
  const base = Z.direction.base[type];
  const tau = type === 'GB' ? 0 : Z.direction.pullPerPower * z(power);
  const w = tau === 0 ? [...base] : base.map((p, i) => p * Math.exp(tau * PULL[i]!));
  const total = w.reduce((a, x) => a + x, 0);
  const pull = w.map((x) => x / total);
  return hand === 'L' ? [...pull].reverse() : pull;
}

function buildDepth(type: BallType, q: Quality): Array<[Depth, number]> {
  const row = Z.depth[type][q]!;
  const fo = row.FO ?? 0;
  const out = Object.entries(row) as Array<[Depth, number]>;
  if (fo === 0 || Z.park.foulAreaFactor === 1) return out;
  // 파울 지역 크기: 늘거나 준 몫은 같은 행의 다른 깊이에 비례 배분한다(§3.3).
  const newFo = Math.min(1, fo * Z.park.foulAreaFactor);
  const rest = 1 - fo;
  return out.map(([d, p]) => [d, d === 'FO' ? newFo : rest > 0 ? (p * (1 - newFo)) / rest : 0]);
}
const DEPTHS: Record<BallType, Array<Array<[Depth, number]>>> = {
  GB: [0, 1, 2].map((q) => buildDepth('GB', q as Quality)),
  LD: [0, 1, 2].map((q) => buildDepth('LD', q as Quality)),
  FB: [0, 1, 2].map((q) => buildDepth('FB', q as Quality)),
};

/** 깊이 분포(유형·질) */
export function depthDist(type: BallType, q: Quality): Array<[Depth, number]> {
  return DEPTHS[type][q]!;
}

/** 대결의 모든 구역 칸과 확률(합 1). 수비수와 무관하다 */
export function cellsFor(shares: TypeShares, power: number, stuff: number, velocityZ: number, hand: 'R' | 'L'): Cell[] {
  const cells: Cell[] = [];
  for (const type of TYPES) {
    if (shares[type] <= 0) continue;
    const qd = qualityDist(type, power, stuff, velocityZ);
    const dd = directionDist(type, power, hand);
    for (const q of [0, 1, 2] as Quality[]) {
      for (const [depth, pd] of depthDist(type, q)) {
        for (let i = 0; i < 7; i++) {
          const p = shares[type] * qd[q] * dd[i]! * pd;
          if (p > 0) {
            const n = neutralConst(type, q, i + 1, depth);
            cells.push({ type, q, dir: i + 1, depth, p, reachLogit0: n.reachLogit0, dHdPr: n.dHdPr });
          }
        }
      }
    }
  }
  return cells;
}

// ───────── 판정 확률 (§5) ─────────

const isOutfieldDepth = (d: Depth) => d === 'SH' || d === 'DP' || d === 'WL';

function reachBase(type: BallType, depth: Depth, q: Quality): number {
  return Z.reach[type][depth]?.[q] ?? 0;
}

function reachDirAdj(type: BallType, dir: number, depth: Depth): number {
  if (type === 'GB' && depth === 'IN') {
    if (dir === 2 || dir === 4 || dir === 6) return Z.reachDir.groundGap;
    if (dir === 3 || dir === 5) return Z.reachDir.groundFacing;
    return 0;
  }
  if (isOutfieldDepth(depth)) {
    if (dir === 3 || dir === 5) return Z.reachDir.outfieldGap;
    if (dir === 1 || dir === 7) return Z.reachDir.outfieldLine;
  }
  return 0;
}

/** 도달 확률. rangeZ: 유효 범위 z(중립 0), theta: x 고정 보정 */
function reachProb(c: { type: BallType; q: Quality; dir: number; depth: Depth }, rangeZ: number, theta: number): number {
  const L0 = NC_REACH[cellIndex(TYPE_INDEX[c.type], c.q, DEPTH_INDEX[c.depth], c.dir)]!;
  if (L0 === -Infinity) return 0;
  const coef = isOutfieldDepth(c.depth) ? Z.reachRange.outfield : Z.reachRange.infield;
  return sigmoid(L0 + coef * rangeZ + theta);
}

const cleanProb = (type: BallType, fieldingZ: number) => sigmoid(CLEAN_L[type] + Z.clean.fielding * fieldingZ);

function throwDirAdj(dir: number): number {
  return dir === 1 ? Z.throw.dir.S1 : dir === 2 ? Z.throw.dir.S2 : dir === 7 ? Z.throw.dir.S7 : 0;
}
/** 내야 땅볼 1루 송구 아웃 확률 */
function throwOutProb(q: Quality, dir: number, armZ: number, batterSpeedZ: number, coverZ = 0): number {
  return sigmoid(THROW_L[q] + throwDirAdj(dir) + Z.throw.arm * armZ - Z.throw.batterSpeed * batterSpeedZ + coverZ);
}
const throwErrorProb = (accuracyZ: number) => Z.throw.errorBase * Math.exp(-Z.throw.errorAccuracy * accuracyZ);

/** 중립 조건(수비 50·숙련 70·타자 주력 50)의 칸 상수: θ와 무관한 값(도달 로짓, dH/dPr)을 모듈을 읽을 때 한 번 계산한다 */
const DEPTH_LIST: readonly Depth[] = ['IN', 'SH', 'DP', 'WL', 'FO'];
const DEPTH_INDEX: Record<Depth, number> = { IN: 0, SH: 1, DP: 2, WL: 3, FO: 4 };
const TYPE_INDEX: Record<BallType, number> = { GB: 0, LD: 1, FB: 2 };
const cellIndex = (t: number, q: number, d: number, dir: number) => ((t * 3 + q) * 5 + d) * 7 + (dir - 1);
const N_CELLS = 3 * 3 * 5 * 7;
const NC_REACH = new Float64Array(N_CELLS);
const NC_DH = new Float64Array(N_CELLS);
for (const type of TYPES) {
  for (const q of [0, 1, 2] as Quality[]) {
    for (const depth of DEPTH_LIST) {
      for (let dir = 1; dir <= 7; dir++) {
        const i = cellIndex(TYPE_INDEX[type], q, DEPTH_INDEX[depth], dir);
        const rb = reachBase(type, depth, q);
        const Pc = cleanProb(type, 0);
        const e = Z.clean.errorShare[q];
        const Pout = type === 'GB' && depth === 'IN' ? throwOutProb(q, dir, 0, 0) : 1;
        NC_REACH[i] = rb <= 0 ? -Infinity : logit(rb) + reachDirAdj(type, dir, depth);
        NC_DH[i] = -1 + (1 - Pc) * (1 - e) + Pc * (1 - Pout);
      }
    }
  }
}
// 같은 도달 로짓을 가진 칸끼리 묶는다(방향 보정 종류가 몇 개뿐이라 약 50묶음). 앵커링에서 묶음마다 sigmoid를 한 번만 계산한다.
const NC_GROUP = new Int32Array(N_CELLS);
const GROUP_L0: number[] = [];
{
  const seen = new Map<number, number>();
  for (let i = 0; i < N_CELLS; i++) {
    const L0 = NC_REACH[i]!;
    let g = seen.get(L0);
    if (g === undefined) {
      g = GROUP_L0.length;
      GROUP_L0.push(L0);
      seen.set(L0, g);
    }
    NC_GROUP[i] = g;
  }
}
export const GROUP_COUNT = GROUP_L0.length;
const GROUP_PR = new Float64Array(GROUP_L0.length);

function neutralConst(type: BallType, q: Quality, dir: number, depth: Depth): { reachLogit0: number; dHdPr: number } {
  const i = cellIndex(TYPE_INDEX[type], q, DEPTH_INDEX[depth], dir);
  return { reachLogit0: NC_REACH[i]!, dHdPr: NC_DH[i]! };
}

/** 중립 조건에서 그 칸의 안타 확률(H = 1 + Pr·dH/dPr)과 도달 확률 */
function neutralHit(c: Cell, theta: number): { H: number; dHdPr: number; Pr: number } {
  const Pr = c.reachLogit0 === -Infinity ? 0 : sigmoid(c.reachLogit0 + theta);
  return { H: 1 + Pr * c.dHdPr, dHdPr: c.dHdPr, Pr };
}

/** §6 x 고정 보정: 중립 조건의 기대 안타율이 x_match와 같아지는 θ(뉴턴법). 결정적 계산이다 */
export function anchorTheta(cells: readonly Cell[], xMatch: number): number {
  let theta = 0;
  for (let i = 0; i < Z.anchor.iterations; i++) {
    let f = -xMatch;
    let df = 0;
    for (const c of cells) {
      const n = neutralHit(c, theta);
      f += c.p * n.H;
      df += c.p * n.dHdPr * n.Pr * (1 - n.Pr);
    }
    if (Math.abs(f) < Z.anchor.tolerance || df === 0) break;
    theta -= f / df;
  }
  return theta;
}

/**
 * 뉴턴법 시작값 표: 평균 대결(유형 비율 기준값·장타·구위 50·구속 평균·우타자)의 x별 θ를 모듈을 읽을 때 계산한다.
 * 시작값이 입력(x)만으로 정해지므로 결정적이다(저장·불러오기 뒤에도 같은 θ).
 */
const THETA0_MIN = 0.15;
const THETA0_STEP = 0.001;
const THETA0: number[] = [];
/** 격자점 θ에서 묶음별 도달 확률(미리 계산) */
const START_PR: Float64Array[] = [];
{
  const avgCells = cellsFor({ GB: 0.44, LD: 0.21, FB: 0.35 }, 50, 50, 0, 'R');
  for (let x = THETA0_MIN; x <= 0.6 + 1e-9; x += THETA0_STEP) {
    let theta = 0;
    for (let it = 0; it < 30; it++) {
      let f = -x;
      let df = 0;
      for (const c of avgCells) {
        const Pr = c.reachLogit0 === -Infinity ? 0 : sigmoid(c.reachLogit0 + theta);
        f += c.p * (1 + Pr * c.dHdPr);
        df += c.p * c.dHdPr * Pr * (1 - Pr);
      }
      if (Math.abs(f) < 1e-9 || df === 0) break;
      theta -= f / df;
    }
    THETA0.push(theta);
  }
}
for (const th of THETA0) {
  const row = new Float64Array(GROUP_L0.length);
  for (let g = 0; g < GROUP_L0.length; g++) row[g] = GROUP_L0[g] === -Infinity ? 0 : 1 / (1 + Math.exp(-(GROUP_L0[g]! + th)));
  START_PR.push(row);
}
/** 가장 가까운 격자점(시작값). 입력 x만으로 정해진다 */
function thetaStartIndex(x: number): number {
  const i = Math.round((x - THETA0_MIN) / THETA0_STEP);
  return Math.max(0, Math.min(THETA0.length - 1, i));
}
function thetaStart(x: number): number {
  return THETA0[thetaStartIndex(x)]!;
}

/**
 * 묶음 가중치 캐시: (유형, 질, 장타, 타격 방향)별로 '묶음 g의 dH/dPr 가중 합'을 희소 목록으로 둔다.
 * 기대 안타율 f(θ) = 1 + Σ_g Ad_g·Pr_g(θ), Ad_g = Σ_(유형,질) 유형 비율·질 확률·W[g] 이므로 칸 154개 대신 묶음으로 계산한다.
 */
const GROUP_W = new Map<number, { g: Int32Array; w: Float64Array }>();
function groupWeights(type: BallType, q: number, power: number, hand: 'R' | 'L'): { g: Int32Array; w: Float64Array } {
  const key = ((TYPE_INDEX[type] * 3 + q) * 128 + power) * 2 + (hand === 'L' ? 1 : 0);
  const hit = GROUP_W.get(key);
  if (hit) return hit;
  const dd = directionDist(type, power, hand);
  const acc = new Map<number, number>();
  for (const [depth, pd] of DEPTHS[type][q]!) {
    for (let dir = 1; dir <= 7; dir++) {
      const p = pd * dd[dir - 1]!;
      if (p <= 0) continue;
      const i = cellIndex(TYPE_INDEX[type], q, DEPTH_INDEX[depth], dir);
      const g = NC_GROUP[i]!;
      acc.set(g, (acc.get(g) ?? 0) + p * NC_DH[i]!);
    }
  }
  const v = { g: Int32Array.from(acc.keys()), w: Float64Array.from(acc.values()) };
  GROUP_W.set(key, v);
  return v;
}
const AD = new Float64Array(64);

/**
 * 묶음 앵커링: anchorFast와 같은 방정식을 묶음 단위로 푼다. 첫 갱신은 격자점의 미리 계산한 도달 확률을 쓴다.
 * 장타가 정수가 아니면(외부 입력) anchorFast로 계산한다.
 */
function anchorGrouped(shares: TypeShares, power: number, stuff: number, velocityZ: number, hand: 'R' | 'L', xMatch: number): number {
  if (!Number.isInteger(power) || power < 0 || power > 127) return anchorFast(shares, power, stuff, velocityZ, hand, xMatch);
  const G = GROUP_L0.length;
  AD.fill(0, 0, G);
  for (const type of TYPES) {
    const st = shares[type];
    if (st <= 0) continue;
    const qd = qualityDist(type, power, stuff, velocityZ);
    for (let q = 0; q < 3; q++) {
      const c = st * qd[q]!;
      const gw = groupWeights(type, q, power, hand);
      for (let k = 0; k < gw.g.length; k++) AD[gw.g[k]!]! += c * gw.w[k]!;
    }
  }
  const si = thetaStartIndex(xMatch);
  let theta = THETA0[si]!;
  let pr: Float64Array = START_PR[si]!;
  for (let it = 0; it < Z.anchor.iterations; it++) {
    if (it > 0) {
      for (let g = 0; g < G; g++) GROUP_PR[g] = GROUP_L0[g] === -Infinity ? 0 : 1 / (1 + Math.exp(-(GROUP_L0[g]! + theta)));
      pr = GROUP_PR;
    }
    let f = 1 - xMatch;
    let df = 0;
    for (let g = 0; g < G; g++) {
      const a = AD[g]!;
      if (a === 0) continue;
      const p = pr[g]!;
      f += a * p;
      df += a * p * (1 - p);
    }
    if (Math.abs(f) < Z.anchor.tolerance || df === 0) break;
    theta -= f / df;
    if (Math.abs(f) < Z.anchor.oneStepResidual) break;
  }
  return theta;
}

/** 빠른 앵커링: 칸 객체를 만들지 않고 재사용 배열로 같은 식을 푼다(cellsFor + anchorTheta와 같은 방정식, 시작값만 표에서) */
const W_P = new Float64Array(N_CELLS);
const W_I = new Int32Array(N_CELLS);
function anchorFast(shares: TypeShares, power: number, stuff: number, velocityZ: number, hand: 'R' | 'L', xMatch: number): number {
  let n = 0;
  for (const type of TYPES) {
    const st = shares[type];
    if (st <= 0) continue;
    const ti = TYPE_INDEX[type];
    const qd = qualityDist(type, power, stuff, velocityZ);
    const dd = directionDist(type, power, hand);
    for (let q = 0; q < 3; q++) {
      for (const [depth, pd] of DEPTHS[type][q]!) {
        const di = DEPTH_INDEX[depth];
        const base = st * qd[q]! * pd;
        for (let dir = 1; dir <= 7; dir++) {
          const p = base * dd[dir - 1]!;
          if (p > 0) {
            W_P[n] = p;
            W_I[n] = cellIndex(ti, q, di, dir);
            n++;
          }
        }
      }
    }
  }
  let theta = thetaStart(xMatch);
  for (let it = 0; it < Z.anchor.iterations; it++) {
    for (let g = 0; g < GROUP_L0.length; g++) {
      const L0 = GROUP_L0[g]!;
      GROUP_PR[g] = L0 === -Infinity ? 0 : 1 / (1 + Math.exp(-(L0 + theta)));
    }
    let f = -xMatch;
    let df = 0;
    for (let k = 0; k < n; k++) {
      const i = W_I[k]!;
      const d = NC_DH[i]!;
      const Pr = GROUP_PR[NC_GROUP[i]!]!;
      f += W_P[k]! * (1 + Pr * d);
      df += W_P[k]! * d * Pr * (1 - Pr);
    }
    if (Math.abs(f) < Z.anchor.tolerance || df === 0) break;
    theta -= f / df;
    // 시작값이 충분히 가까우면 한 번 갱신으로 끝낸다(뉴턴법은 남는 오차가 제곱으로 준다).
    if (Math.abs(f) < Z.anchor.oneStepResidual) break;
  }
  return theta;
}

/** 중립 조건 기대 안타율(테스트·검증용) */
export function neutralHitRate(cells: readonly Cell[], theta: number): number {
  return cells.reduce((a, c) => a + c.p * neutralHit(c, theta).H, 0);
}

/** 도달하지 못한 타구의 1·2·3루타 비율(§7) */
function hitKindDist(c: { type: BallType; q: Quality; dir: number; depth: Depth }): readonly [number, number, number] {
  const H = Z.hitKinds;
  if (c.depth === 'IN') return c.type === 'GB' && c.q === 2 && (c.dir === 1 || c.dir === 7) ? (H.groundLineHard as unknown as [number, number, number]) : [1, 0, 0];
  if (c.depth === 'FO') return [1, 0, 0];
  if (c.depth === 'SH') return (c.dir === 3 || c.dir === 5 ? H.shallowGap : H.shallowOther) as unknown as [number, number, number];
  if (c.depth === 'DP') return (c.dir === 1 || c.dir === 3 || c.dir === 5 || c.dir === 7 ? H.deepGapLine : H.deepStraight) as unknown as [number, number, number];
  return H.warning as unknown as [number, number, number];
}

/** 중립 조건 기대 결과 분포(인플레이 타구 대비, 합 1): 시작 이전 기록 생성·화면 설명·검증용 */
export function expectedInPlay(cells: readonly Cell[], theta: number): Record<'1B' | '2B' | '3B' | 'ROE' | 'GO' | 'FO', number> {
  const out = { '1B': 0, '2B': 0, '3B': 0, ROE: 0, GO: 0, FO: 0 };
  for (const c of cells) {
    const Pr = reachProb(c, 0, theta);
    const Pc = cleanProb(c.type, 0);
    const e = Z.clean.errorShare[c.q];
    const k = hitKindDist(c);
    out['1B'] += c.p * (1 - Pr) * k[0];
    out['2B'] += c.p * (1 - Pr) * k[1];
    out['3B'] += c.p * (1 - Pr) * k[2];
    out.ROE += c.p * Pr * (1 - Pc) * e;
    out['1B'] += c.p * Pr * (1 - Pc) * (1 - e);
    if (c.type === 'GB' && c.depth === 'IN') {
      const Pout = throwOutProb(c.q, c.dir, 0, 0);
      const te = throwErrorProb(0);
      out['1B'] += c.p * Pr * Pc * (1 - Pout);
      out.GO += c.p * Pr * Pc * Pout * (1 - te);
      out.ROE += c.p * Pr * Pc * Pout * te;
    } else out.FO += c.p * Pr * Pc;
  }
  return out;
}

// ───────── 담당 수비수 (§4) ─────────

const IN_CANDIDATES: Record<number, FieldPos[]> = { 1: ['3B'], 2: ['SS', '3B'], 3: ['SS'], 4: ['SS', '2B'], 5: ['2B'], 6: ['2B', '1B'], 7: ['1B'] };
const OF_CANDIDATES: Record<number, FieldPos[]> = { 1: ['LF'], 2: ['LF'], 3: ['LF', 'CF'], 4: ['CF'], 5: ['CF', 'RF'], 6: ['RF'], 7: ['RF'] };
const OF_BY_DIR: Record<number, FieldPos> = { 1: 'LF', 2: 'LF', 3: 'LF', 4: 'CF', 5: 'CF', 6: 'RF', 7: 'RF' };

function candidatesFor(type: BallType, q: Quality, dir: number, depth: Depth, assignDraw: number): FieldPos[] {
  if (depth === 'FO') return [dir <= 2 ? '3B' : dir <= 5 ? 'C' : '1B'];
  if (depth === 'IN') {
    if (dir === 4 && q === 0 && type === 'GB' && assignDraw < Z.assign.pitcherWeakGroundball) return ['P'];
    if (dir === 4 && q === 0 && type === 'FB' && assignDraw < Z.assign.catcherWeakFly) return ['C'];
    return IN_CANDIDATES[dir]!;
  }
  return OF_CANDIDATES[dir]!;
}

export function zoneId(dir: number, depth: Depth): string {
  return depth === 'FO' ? `FO-${dir <= 2 ? 'L' : dir <= 5 ? 'C' : 'R'}` : `S${dir}-${depth}`;
}

// ───────── 판정과 주자 진루 (§5·§7·§8) ─────────

export interface InPlayInput {
  batter: PlayerTruth;
  hand: 'R' | 'L';
  fielders: Fielders;
  shares: TypeShares;
  /** 투수 실효 구위·구속 z(10a) */
  stuff: number;
  velocityZ: number;
  theta: number;
  outs: number;
  bases: Bases;
  batterRunner: Runner;
  /** 유형별 타구 질 분포(같은 대결이면 같은 값, 호출하는 쪽에서 캐시 가능) */
  qualities?: Record<BallType, [number, number, number]>;
}

export interface ScoredRun {
  runner: Runner;
  rbi: boolean;
  unearned: boolean;
}

export interface InPlayResult {
  outcome: '1B' | '2B' | '3B' | 'GO' | 'FO' | 'DP' | 'SF' | 'ROE' | 'FC';
  /** 내야 안타(공이 내야를 벗어나지 않은 1루타) */
  infieldHit: boolean;
  outsAdded: number;
  scored: ScoredRun[];
  bases: Bases;
  credits: Credit[];
  zone: string;
  type: BallType;
  quality: Quality;
  fielderId: PlayerId;
}

function pick<T>(rng: Rng, items: readonly T[], probs: readonly number[]): T {
  return items[pickIndex(rng, probs)]!;
}
/** 확률 배열에서 인덱스 하나를 뽑는다(배열을 새로 만들지 않음) */
function pickIndex(rng: Rng, probs: readonly number[]): number {
  let r = rng.next();
  const last = probs.length - 1;
  for (let i = 0; i < last; i++) {
    r -= probs[i]!;
    if (r < 0) return i;
  }
  return last;
}
const QUALITIES: readonly Quality[] = [0, 1, 2];
const DIRS = [1, 2, 3, 4, 5, 6, 7] as const;
const HIT_KINDS = [1, 2, 3] as const;
const DEPTH_PROBS: Record<BallType, number[][]> = {
  GB: [0, 1, 2].map((q) => DEPTHS.GB[q]!.map(([, p]) => p)),
  LD: [0, 1, 2].map((q) => DEPTHS.LD[q]!.map(([, p]) => p)),
  FB: [0, 1, 2].map((q) => DEPTHS.FB[q]!.map(([, p]) => p)),
};

/** 한 인플레이 타구 판정의 상태(판정 함수들이 함께 쓴다). 타석마다 한 번 만든다 */
interface Play {
  rng: Rng;
  fielders: Fielders;
  batter: PlayerTruth;
  B: Runner;
  type: BallType;
  q: Quality;
  dir: number;
  depth: Depth;
  fpos: FieldPos;
  fielder: PlayerTruth;
  outs: number;
  outsStart: number;
  b: Bases;
  scored: ScoredRun[];
  credits: Credit[];
  blockingZ: number;
}

const A = Z.advance;
// 추가 진루 기준 로짓(상수)
const ADV_L = {
  doubleFirstHome: [logit(A.doubleFirstHome.attempt), logit(A.doubleFirstHome.safe), logit(A.doubleFirstHome.twoOutAttempt), logit(A.doubleFirstHome.twoOutSafe)],
  singleSecondHome: [logit(A.singleSecondHome.attempt), logit(A.singleSecondHome.safe), logit(A.singleSecondHome.twoOutAttempt), logit(A.singleSecondHome.twoOutSafe)],
  singleFirstThird: [logit(A.singleFirstThird.attempt), logit(A.singleFirstThird.safe)],
  batterSingle: [logit(A.batterSingle.attempt), logit(A.batterSingle.attemptGap), logit(A.batterSingle.safe)],
  batterDouble: [logit(A.batterDouble.attempt), logit(A.batterDouble.safe)],
  tagThirdAttempt: { SH: logit(A.tagThird.attempt.SH), DP: logit(A.tagThird.attempt.DP), WL: logit(A.tagThird.attempt.WL) } as Record<string, number>,
  tagThirdSafe: { SH: logit(A.tagThird.safe.SH), DP: logit(A.tagThird.safe.DP), WL: logit(A.tagThird.safe.WL) } as Record<string, number>,
  tagSecond: [logit(A.tagSecond.attemptRightDeep), logit(A.tagSecond.attempt), logit(A.tagSecond.safe)],
  dpBase: [logit(Z.groundOut.dpBase[0]), logit(Z.groundOut.dpBase[1]), logit(Z.groundOut.dpBase[2])],
  homeDashSafe: logit(Z.groundOut.thirdHome.safe),
  lineDrivePair: logit(Z.lineDrivePair.base),
};

function credit(P: Play, pos: FieldPos, kind: Credit['kind']): void {
  P.credits.push({ playerId: P.fielders[pos].id, kind });
}
/** 아웃 1개: 자살은 정확히 1명, 보살은 송구한 수비수(있으면) */
function recordOut(P: Play, poPos: FieldPos, assist?: FieldPos): void {
  credit(P, poPos, 'PO');
  if (assist !== undefined && assist !== poPos) credit(P, assist, 'A');
  P.outs++;
}
function scoreRunner(P: Play, r: Runner, rbi: boolean, unearned = false): void {
  P.scored.push({ runner: r, rbi, unearned });
}
function finish(P: Play, outcome: InPlayResult['outcome'], infieldHit = false): InPlayResult {
  return {
    outcome,
    infieldHit,
    outsAdded: P.outs - P.outsStart,
    scored: P.scored,
    bases: P.outs >= 3 ? [null, null, null] : P.b,
    credits: P.credits,
    zone: zoneId(P.dir, P.depth),
    type: P.type,
    quality: P.q,
    fielderId: P.fielder.id,
  };
}
const STAY = 0;
const SAFE = 1;
const OUT = 2;
/** §8.1 추가 진루: 시도 → 성공. 기준값은 로짓으로 받는다 */
function tryAdvance(P: Play, r: Runner, attemptL: number, safeL: number, armZ: number, aAdj = 0, home = false): number {
  const pa = sigmoid(attemptL + aAdj + A.attempt.baserunning * z(r.baserunning) + A.attempt.speed * z(r.speed) - A.attempt.arm * armZ);
  if (!P.rng.chance(clampP(pa))) return STAY;
  const ps = sigmoid(safeL + A.safe.speed * z(r.speed) - A.safe.arm * armZ - (home ? A.safe.blocking * P.blockingZ : 0));
  return P.rng.chance(ps) ? SAFE : OUT;
}

// ── 안타 ──
function playHit(P: Play, kind: 1 | 2 | 3, infield: boolean): InPlayResult {
  const b = P.b;
  const B = P.B;
  const throwerPos: FieldPos = isOutfieldDepth(P.depth) ? P.fpos : OF_BY_DIR[P.dir]!;
  const armZ = z(effArm(P.fielders[throwerPos], throwerPos));
  const r1 = b[0];
  const r2 = b[1];
  const r3 = b[2];
  if (kind === 3) {
    if (r3) scoreRunner(P, r3, true);
    if (r2) scoreRunner(P, r2, true);
    if (r1) scoreRunner(P, r1, true);
    b[0] = null;
    b[1] = null;
    b[2] = B;
    return finish(P, '3B');
  }
  if (kind === 2) {
    if (r3) scoreRunner(P, r3, true);
    if (r2) scoreRunner(P, r2, true);
    b[0] = null;
    b[1] = B;
    b[2] = null;
    if (r1) {
      const two = P.outsStart === 2;
      const L = ADV_L.doubleFirstHome;
      const res = tryAdvance(P, r1, two ? L[2]! : L[0]!, two ? L[3]! : L[1]!, armZ, 0, true);
      if (res === SAFE) scoreRunner(P, r1, true);
      else if (res === OUT) recordOut(P, 'C', throwerPos);
      else b[2] = r1;
    }
    if (P.outs < 3 && !b[2]) {
      const res = tryAdvance(P, B, ADV_L.batterDouble[0]!, ADV_L.batterDouble[1]!, armZ);
      if (res === SAFE) {
        b[1] = null;
        b[2] = B;
      } else if (res === OUT) {
        b[1] = null;
        recordOut(P, '3B', throwerPos);
      }
    }
    return finish(P, '2B');
  }
  if (infield) {
    // 내야 안타: 밀려서 가는 주자만 진루한다.
    if (r1 && r2 && r3) scoreRunner(P, r3, true);
    b[2] = r1 && r2 ? r2 : r3;
    b[1] = r1 ? r1 : r2;
    b[0] = B;
    return finish(P, '1B', true);
  }
  // 외야 1루타
  if (r3) scoreRunner(P, r3, true);
  let third: Runner | null = null;
  let second: Runner | null = null;
  if (r2) {
    const two = P.outsStart === 2;
    const L = ADV_L.singleSecondHome;
    const aAdj = P.depth === 'SH' ? A.singleSecondHome.shallow : P.depth === 'DP' || P.depth === 'WL' ? A.singleSecondHome.deep : 0;
    const res = tryAdvance(P, r2, two ? L[2]! : L[0]!, two ? L[3]! : L[1]!, armZ, aAdj, true);
    if (res === SAFE) scoreRunner(P, r2, true);
    else if (res === OUT) recordOut(P, 'C', throwerPos);
    else third = r2;
  }
  if (r1 && P.outs < 3) {
    if (!third) {
      const res = tryAdvance(P, r1, ADV_L.singleFirstThird[0]!, ADV_L.singleFirstThird[1]!, armZ, P.dir >= 6 ? A.singleFirstThird.rightSide : 0);
      if (res === SAFE) third = r1;
      else if (res === OUT) recordOut(P, '3B', throwerPos);
      else second = r1;
    } else second = r1;
  }
  let first: Runner | null = B;
  if (P.outs < 3 && !second) {
    const gap = (P.dir === 3 || P.dir === 5) && isOutfieldDepth(P.depth);
    const res = tryAdvance(P, B, gap ? ADV_L.batterSingle[1]! : ADV_L.batterSingle[0]!, ADV_L.batterSingle[2]!, armZ);
    if (res === SAFE) {
      second = B;
      first = null;
    } else if (res === OUT) {
      first = null;
      recordOut(P, P.dir <= 3 ? 'SS' : '2B', throwerPos);
    }
  }
  b[0] = first;
  b[1] = second;
  b[2] = third;
  return finish(P, '1B');
}

// ── 실책 출루(§8.3): 타자 1루(외야·송구 실책이면 30% 2루), 주자 한 베이스(송구 실책이면 30% 한 베이스 더) ──
function playError(P: Play, errPos: FieldPos, throwError: boolean): InPlayResult {
  credit(P, errPos, 'E');
  const extraRunner = throwError && P.rng.chance(Z.errorAdvance.runnerExtraThrow);
  const batterExtra = (throwError || isOutfieldDepth(P.depth)) && P.rng.chance(Z.errorAdvance.batterExtraOutfieldOrThrow);
  const n = extraRunner ? 2 : 1;
  const b = P.b;
  const nb: Bases = [null, null, null];
  // 앞 주자부터 n베이스 진루. 실책 플레이의 득점은 비자책.
  for (let from = 2; from >= 0; from--) {
    const r = b[from];
    if (!r) continue;
    if (from + n >= 3) scoreRunner(P, r, false, true);
    else nb[from + n] = r;
  }
  // 타자 자리가 차 있으면 그 주자부터 한 베이스씩 민다.
  let at = batterExtra ? 1 : 0;
  let moving: Runner | null = { ...P.B, earned: false };
  while (moving) {
    const prev: Runner | null = nb[at] ?? null;
    nb[at] = moving;
    moving = prev;
    at++;
    if (moving && at >= 3) {
      scoreRunner(P, moving, false, true);
      moving = null;
    }
  }
  b[0] = nb[0];
  b[1] = nb[1];
  b[2] = nb[2];
  return finish(P, 'ROE');
}

// ── 내야 땅볼 아웃(§8.2) ──
function playGroundOut(P: Play, cover: boolean): InPlayResult {
  const b = P.b;
  const firstPo: FieldPos = cover ? 'P' : '1B';
  const batterOutAtFirst = () => recordOut(P, firstPo, P.fpos === firstPo ? undefined : P.fpos);
  const r1 = b[0];
  const r2 = b[1];
  const r3 = b[2];
  if (P.outsStart === 2) {
    batterOutAtFirst();
    return finish(P, 'GO');
  }
  if (r1) {
    let pivot: FieldPos = P.dir <= 3 ? '2B' : 'SS';
    if (pivot === P.fpos) pivot = pivot === 'SS' ? '2B' : 'SS';
    const G = Z.groundOut;
    const adj = P.dir >= 3 && P.dir <= 5 ? G.dpCenter : P.dir === 1 || P.dir === 7 ? G.dpLine : 0;
    const piv = P.fielders[pivot];
    const pDp = sigmoid(ADV_L.dpBase[P.q]! + adj + G.dpPivotArm * z(effArm(piv, pivot)) + G.dpPivotFielding * z(effFielding(piv, pivot)) - G.dpBatterSpeed * z(P.batter.batting.speed) - G.dpRunnerSpeed * z(r1.speed));
    if (P.rng.chance(pDp)) {
      recordOut(P, pivot, P.fpos); // 2루 포스 아웃
      if (P.rng.chance(throwErrorProb(z(effAccuracy(piv, pivot))))) {
        // 피벗 송구 실책: 타자는 1루에 산다.
        credit(P, pivot, 'E');
        if (r3 && r2) scoreRunner(P, r3, false, true);
        b[2] = r2 ?? r3;
        b[1] = null;
        b[0] = { ...P.B, earned: false };
        return finish(P, 'ROE');
      }
      recordOut(P, firstPo, pivot); // 1루 아웃(병살)
      if (P.outs < 3) {
        if (r3) scoreRunner(P, r3, false);
        b[2] = r2;
        b[1] = null;
        b[0] = null;
      }
      return finish(P, 'DP');
    }
    if (P.q === 0) {
      // 약한 땅볼: 타자만 1루에서 잡고 주자는 한 베이스씩 진루(진루타)
      batterOutAtFirst();
      if (P.outs < 3) {
        if (r3) scoreRunner(P, r3, true);
        b[2] = r2;
        b[1] = r1;
        b[0] = null;
      }
      return finish(P, 'GO');
    }
    // 야수 선택: 선행 주자(1루 주자)를 2루에서 잡고 타자는 1루에 산다. 밀린 주자만 진루한다.
    recordOut(P, pivot, P.fpos);
    if (P.outs < 3) {
      if (r2 && r3) scoreRunner(P, r3, true);
      b[2] = r2 ? r2 : r3;
      b[1] = null;
      b[0] = P.B;
    }
    return finish(P, 'FC');
  }
  if (r3) {
    const G = Z.groundOut.thirdHome;
    if (P.rng.chance(P.dir <= 3 ? G.left : G.centerRight)) {
      // 홈 쇄도: 홈 송구 승부, 타자는 1루에 산다(야수 선택).
      const ps = sigmoid(ADV_L.homeDashSafe + A.safe.speed * z(r3.speed) - A.safe.arm * z(effArm(P.fielder, P.fpos)) - A.safe.blocking * P.blockingZ);
      if (P.rng.chance(ps)) scoreRunner(P, r3, true);
      else recordOut(P, 'C', P.fpos);
      b[2] = r2;
      b[1] = null;
      b[0] = P.B;
      return finish(P, 'FC');
    }
    batterOutAtFirst();
    return finish(P, 'GO');
  }
  batterOutAtFirst();
  if (r2 && P.outs < 3) {
    const S = Z.groundOut.secondToThird;
    if (P.rng.chance(P.dir >= 5 ? S.right : P.dir <= 3 ? S.left : S.center)) {
      b[2] = r2;
      b[1] = null;
    }
  }
  return finish(P, 'GO');
}

// ── 뜬공·라인드라이브 포구(§8.1·§8.3) ──
function playAirOut(P: Play): InPlayResult {
  const b = P.b;
  recordOut(P, P.fpos);
  if (P.outs >= 3) return finish(P, 'FO');
  // 인필드 플라이: 2아웃 미만, 주자 1·2루 또는 만루의 내야 뜬공은 타자만 아웃, 주자는 그대로
  if (P.type === 'FB' && P.depth === 'IN' && b[0] && b[1]) return finish(P, 'FO');
  // 직선타 병살: 내야 라인드라이브를 잡으면 가까운 베이스 주자가 귀루하지 못할 수 있다.
  if (P.type === 'LD' && P.depth === 'IN' && (b[0] || b[1] || b[2])) {
    const order = P.dir <= 3 ? LD_ORDER_LEFT : P.dir === 4 ? LD_ORDER_CENTER : LD_ORDER_RIGHT;
    let idx: 0 | 1 | 2 = 0;
    for (const i of order) {
      if (b[i]) {
        idx = i;
        break;
      }
    }
    const r = b[idx]!;
    const p = sigmoid(ADV_L.lineDrivePair - Z.lineDrivePair.baserunning * z(r.baserunning));
    if (P.rng.chance(p)) {
      const basePos: FieldPos = idx === 0 ? '1B' : idx === 1 ? (P.dir <= 3 ? '2B' : 'SS') : '3B';
      b[idx] = null;
      recordOut(P, basePos, P.fpos);
    }
    return finish(P, 'FO');
  }
  let sac = false;
  if (isOutfieldDepth(P.depth)) {
    const armZ = z(effArm(P.fielder, P.fpos));
    const r3 = b[2];
    if (r3 && P.outs < 3) {
      const res = tryAdvance(P, r3, ADV_L.tagThirdAttempt[P.depth]!, ADV_L.tagThirdSafe[P.depth]!, armZ, 0, true);
      if (res === SAFE) {
        scoreRunner(P, r3, true);
        sac = true;
        b[2] = null;
      } else if (res === OUT) {
        b[2] = null;
        recordOut(P, 'C', P.fpos);
      }
    }
    const r2b = b[1];
    if (r2b && !b[2] && P.outs < 3) {
      const res = tryAdvance(P, r2b, (P.depth === 'DP' || P.depth === 'WL') && P.dir >= 5 ? ADV_L.tagSecond[0]! : ADV_L.tagSecond[1]!, ADV_L.tagSecond[2]!, armZ);
      if (res === SAFE) {
        b[2] = r2b;
        b[1] = null;
      } else if (res === OUT) {
        b[1] = null;
        recordOut(P, '3B', P.fpos);
      }
    }
  }
  return finish(P, sac ? 'SF' : 'FO');
}
const LD_ORDER_LEFT = [2, 1, 0] as const;
const LD_ORDER_CENTER = [1, 0, 2] as const;
const LD_ORDER_RIGHT = [0, 1, 2] as const;

/** 홈런이 아닌 인플레이 타구 하나를 판정한다. rng는 그 타석의 하위 난수 흐름(§12) */
export function resolveInPlay(rng: Rng, input: InPlayInput): InPlayResult {
  const { batter, hand, fielders, shares, theta } = input;
  // 추첨 순서 고정: 유형 → 질 → 방향 → 깊이 → 투수·포수 배정 → 도달 → 처리 → 실책 기록 → 송구 → 송구 실책 → 병살 → 주자
  const rType = rng.next();
  const type: BallType = rType < shares.GB ? 'GB' : rType < shares.GB + shares.LD ? 'LD' : 'FB';
  const q = pick(rng, QUALITIES, input.qualities?.[type] ?? qualityDist(type, batter.batting.power, input.stuff, input.velocityZ));
  const dir: number = pick(rng, DIRS, directionDist(type, batter.batting.power, hand));
  const depth = DEPTHS[type][q]![pickIndex(rng, DEPTH_PROBS[type][q]!)]![0];
  const assignDraw = rng.next();
  const cell = { type, q, dir, depth };

  // 담당 수비수: 후보 중 도달 확률이 높은 쪽이 처리한다.
  const cands = candidatesFor(type, q, dir, depth, assignDraw);
  let fpos = cands[0]!;
  let Pr = -1;
  for (const pos of cands) {
    const pr = reachProb(cell, z(effRange(fielders[pos], pos)), theta);
    if (pr > Pr) {
      Pr = pr;
      fpos = pos;
    }
  }
  const fielder = fielders[fpos];
  const P: Play = {
    rng,
    fielders,
    batter,
    B: input.batterRunner,
    type,
    q,
    dir,
    depth,
    fpos,
    fielder,
    outs: input.outs,
    outsStart: input.outs,
    b: [input.bases[0], input.bases[1], input.bases[2]],
    scored: [],
    credits: [],
    blockingZ: z(fielders.C.catcher?.blocking ?? 50),
  };

  // 도달 → 처리 → 실책 기록
  if (!rng.chance(Pr)) {
    const kind = pick(rng, HIT_KINDS, hitKindDist(cell));
    // 파울 지역·내야 뜬공이 떨어지면 내야 안타, 내야를 통과한 땅볼·라인드라이브는 외야 1루타로 처리한다.
    return playHit(P, kind, depth === 'FO' || (depth === 'IN' && type === 'FB'));
  }
  const Pc = cleanProb(type, z(effFielding(fielder, fpos)));
  if (!rng.chance(Pc)) {
    if (rng.chance(Z.clean.errorShare[q])) return playError(P, fpos, false);
    return playHit(P, 1, depth === 'IN' || depth === 'FO');
  }

  // ── 내야 땅볼: 1루 송구 ──
  if (type === 'GB' && depth === 'IN') {
    const cover = fpos === '1B' ? rng.chance(Z.throw.pitcherCover) : false;
    const coverZ = cover ? Z.throw.pitcherCoverFielding * z(effFielding(fielders.P, 'P')) : 0;
    const pOut = throwOutProb(q, dir, z(effArm(fielder, fpos)), z(batter.batting.speed), coverZ);
    if (!rng.chance(pOut)) return playHit(P, 1, true); // 송구가 늦은 내야 안타
    if (rng.chance(throwErrorProb(z(effAccuracy(fielder, fpos))))) return playError(P, fpos, true);
    return playGroundOut(P, cover);
  }

  // ── 뜬공·라인드라이브 포구 ──
  return playAirOut(P);
}

/**
 * 앵커링 캐시: θ는 (유형 비율, 타자 장타, 투수 실효 구위·구속, 타격 방향, x_match)만으로 정해지는 결정적 값이라
 * 같은 입력이면 다시 계산하지 않는다. 저장하지 않으며 결과에 영향이 없다(성능용).
 */
interface ThetaEntry {
  gb: number;
  power: number;
  stuff: number;
  velocityZ: number;
  hand: 'R' | 'L';
  x: number;
  theta: number;
}
const THETA_CACHE = new Map<number, ThetaEntry[]>();
const THETA_CACHE_MAX = 100_000;
const THETA_PER_PAIR = 6;
/** pairKey: (타자, 투수)를 나타내는 정수(같은 쌍이면 같은 값). 입력이 모두 같을 때만 캐시 값을 쓴다 */
export function cachedTheta(pairKey: number, shares: TypeShares, power: number, stuff: number, velocityZ: number, hand: 'R' | 'L', xMatch: number): number {
  const list = THETA_CACHE.get(pairKey);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.gb === shares.GB && e.power === power && e.stuff === stuff && e.velocityZ === velocityZ && e.hand === hand && e.x === xMatch) {
        if (i > 0) [list[0], list[i]] = [e, list[0]!];
        return e.theta;
      }
    }
  }
  if (THETA_CACHE.size >= THETA_CACHE_MAX) THETA_CACHE.clear();
  const theta = anchorGrouped(shares, power, stuff, velocityZ, hand, xMatch);
  const entry: ThetaEntry = { gb: shares.GB, power, stuff, velocityZ, hand, x: xMatch, theta };
  if (list) {
    list.unshift(entry);
    // 성적 혼합·압박으로 x가 경기·타석마다 달라지므로 쌍마다 최근 값 몇 개만 둔다(결과는 같고 탐색 비용만 제한)
    if (list.length > THETA_PER_PAIR) list.length = THETA_PER_PAIR;
  }
  else THETA_CACHE.set(pairKey, [entry]);
  return theta;
}
