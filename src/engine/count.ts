// 볼카운트 층(10a 10장, D-161·D-167). 순수 함수만 둔다.
// 카운트 (볼 0~3, 스트라이크 0~2) 12개 상태에서 투구 사건(볼·스트라이크·파울·사구·인플레이)으로 진행하는 마르코프 체인이다.
// 2스트라이크 파울은 카운트를 유지한다(자기 순환은 1/(1 − 파울)로 풀어 정확히 계산한다).
// 대결마다 기준표 P0의 볼·스트라이크·사구에 배율 3개를 곱해 체인 흡수 확률이 타석 모델 대결 확률과 같아지도록 푼다.

export const COUNT_EVENTS = ['ball', 'strike', 'foul', 'hbp', 'inplay'] as const;
export type CountEvent = (typeof COUNT_EVENTS)[number];
const BALL = 0;
const STRIKE = 1;
const FOUL = 2;
const HBP = 3;
const INPLAY = 4;

/** 체인 결과(흡수 상태) 순서: 볼넷·삼진·사구·인플레이(홈런 포함) */
export const COUNT_RESULTS = ['BB', 'K', 'HBP', 'IP'] as const;
export type CountResult = (typeof COUNT_RESULTS)[number];

/** 카운트 상태 번호 = 볼 × 3 + 스트라이크 (0~11) */
export const countIndex = (balls: number, strikes: number) => balls * 3 + strikes;

/** 카운트별 투구 사건 확률표 [12][5](각 행 합 1) */
export type CountTable = number[][];

export interface ChainSummary {
  /** 0-0에서 시작한 흡수 확률 [볼넷, 삼진, 사구, 인플레이] */
  absorb: [number, number, number, number];
  /** 결과별 (투구 수 × 그 결과) 기댓값. 결과별 평균 투구 수 = mean[o] / absorb[o] */
  pitchMass: [number, number, number, number];
}

type Vec4 = [number, number, number, number];
const ZERO: Vec4 = [0, 0, 0, 0];
const unit = (o: number): Vec4 => {
  const v: Vec4 = [0, 0, 0, 0];
  v[o] = 1;
  return v;
};

/** 흡수 확률과 결과별 투구 수 기댓값(정확 계산) */
export function chainSummary(P: CountTable): ChainSummary {
  // A[i]: 상태 i에서 시작한 흡수 확률, M[i]: 상태 i에서 시작해 남은 투구 수 × 결과 지시
  const A: Vec4[] = new Array(12);
  const M: Vec4[] = new Array(12);
  for (let b = 3; b >= 0; b--) {
    for (let s = 2; s >= 0; s--) {
      const p = P[countIndex(b, s)]!;
      // 다음 상태(흡수면 null과 결과 번호)
      const ballNext = b < 3 ? countIndex(b + 1, s) : -1; // -1: 볼넷
      const strikeNext = s < 2 ? countIndex(b, s + 1) : -2; // -2: 삼진
      const foulNext = s < 2 ? countIndex(b, s + 1) : -3; // -3: 같은 상태 유지
      const a: Vec4 = [0, 0, 0, 0];
      const m: Vec4 = [0, 0, 0, 0];
      const add = (prob: number, next: number, terminal: Vec4 | null) => {
        if (prob === 0) return;
        const an = terminal ?? A[next]!;
        const mn = terminal ? ZERO : M[next]!;
        for (let o = 0; o < 4; o++) {
          a[o] = a[o]! + prob * an[o]!;
          m[o] = m[o]! + prob * (an[o]! + mn[o]!);
        }
      };
      add(p[BALL]!, ballNext, ballNext === -1 ? unit(0) : null);
      add(p[STRIKE]!, strikeNext, strikeNext === -2 ? unit(1) : null);
      add(p[HBP]!, -1, unit(2));
      add(p[INPLAY]!, -1, unit(3));
      if (foulNext === -3) {
        // 2스트라이크 파울: x = rest + pf·x (흡수), m = rest_m + pf·(a + m) → 1/(1 − pf)
        const pf = p[FOUL]!;
        const k = 1 / (1 - pf);
        for (let o = 0; o < 4; o++) a[o] = a[o]! * k;
        for (let o = 0; o < 4; o++) m[o] = (m[o]! + pf * a[o]!) * k;
      } else add(p[FOUL]!, foulNext, null);
      A[countIndex(b, s)] = a;
      M[countIndex(b, s)] = m;
    }
  }
  return { absorb: A[0]!, pitchMass: M[0]! };
}

/** 결과별 평균 투구 수 */
export function meanPitches(c: ChainSummary): Vec4 {
  return c.absorb.map((a, o) => (a > 0 ? c.pitchMass[o]! / a : 0)) as Vec4;
}

/** 기준표에 볼·스트라이크·사구 배율(로그)을 곱한 대결 표 */
export function matchupTable(P0: CountTable, logBall: number, logStrike: number, logHbp: number): CountTable {
  const eb = Math.exp(logBall);
  const es = Math.exp(logStrike);
  const eh = Math.exp(logHbp);
  return P0.map((row) => {
    const w = [row[BALL]! * eb, row[STRIKE]! * es, row[FOUL]!, row[HBP]! * eh, row[INPLAY]!];
    const sum = w[0]! + w[1]! + w[2]! + w[3]! + w[4]!;
    return w.map((x) => x / sum);
  });
}

export interface MatchupFit {
  ok: boolean;
  table: CountTable;
  /** 맞춘 흡수 확률과 대결 확률의 사건별 최대 차이 */
  maxError: number;
  iterations: number;
}

/** 3×3 선형계(가우스 소거). 특이하면 null */
function solve3(J: number[][], r: number[]): number[] | null {
  const a = J.map((row, i) => [...row, r[i]!]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(a[i]![c]!) > Math.abs(a[piv]![c]!)) piv = i;
    if (Math.abs(a[piv]![c]!) < 1e-15) return null;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const f = a[i]![c]! / a[c]![c]!;
      for (let j = c; j < 4; j++) a[i]![j]! -= f * a[c]![j]!;
    }
  }
  return [0, 1, 2].map((i) => a[i]![3]! / a[i]![i]!);
}

// ───────── 빠른 흡수 계산(대결 맞춤 전용, 할당 없음) ─────────
// 승부처 타석마다 뉴턴법으로 여러 번 부르므로 표를 만들지 않고 배율을 곱해 바로 흡수 확률만 계산한다.

interface FlatModel {
  /** 기준표 [12 × 5] 평탄화 */
  p: Float64Array;
  /** 배율 0에서의 흡수 확률(볼넷·삼진·사구) */
  ref: [number, number, number];
  /** 배율 0에서의 로짓 선형화 역행렬(초기값 추정용) */
  jinv: number[][] | null;
}
const FLAT = new WeakMap<CountTable, FlatModel>();
const SCRATCH = new Float64Array(48);
const logit = (p: number) => Math.log(p / (1 - p));

/** 기준표 P0에 볼·스트라이크·사구 로그 배율을 곱한 체인의 흡수 확률(볼넷·삼진·사구)을 out에 쓴다 */
function absorb3(p: Float64Array, lb: number, ls: number, lh: number, out: Float64Array | number[]): void {
  const eb = Math.exp(lb);
  const es = Math.exp(ls);
  const eh = Math.exp(lh);
  const A = SCRATCH;
  for (let b = 3; b >= 0; b--) {
    for (let s = 2; s >= 0; s--) {
      const i = b * 3 + s;
      const o = i * 5;
      const wb = p[o]! * eb;
      const ws = p[o + 1]! * es;
      const wf = p[o + 2]!;
      const wh = p[o + 3]! * eh;
      const wi = p[o + 4]!;
      const inv = 1 / (wb + ws + wf + wh + wi);
      const pb = wb * inv;
      const ps = ws * inv;
      const pf = wf * inv;
      let a0 = 0;
      let a1 = 0;
      let a2 = wh * inv;
      let a3 = wi * inv;
      if (b < 3) {
        const n = (i + 3) * 4;
        a0 += pb * A[n]!;
        a1 += pb * A[n + 1]!;
        a2 += pb * A[n + 2]!;
        a3 += pb * A[n + 3]!;
      } else a0 += pb;
      if (s < 2) {
        // 스트라이크와 2스트라이크 전 파울은 같은 다음 상태
        const q = ps + pf;
        const n = (i + 1) * 4;
        a0 += q * A[n]!;
        a1 += q * A[n + 1]!;
        a2 += q * A[n + 2]!;
        a3 += q * A[n + 3]!;
      } else {
        a1 += ps;
        const k = 1 / (1 - pf);
        a0 *= k;
        a1 *= k;
        a2 *= k;
        a3 *= k;
      }
      const w = i * 4;
      A[w] = a0;
      A[w + 1] = a1;
      A[w + 2] = a2;
      A[w + 3] = a3;
    }
  }
  out[0] = A[0]!;
  out[1] = A[1]!;
  out[2] = A[2]!;
}

function flatModel(P0: CountTable): FlatModel {
  let m = FLAT.get(P0);
  if (m) return m;
  const p = new Float64Array(60);
  P0.forEach((row, i) => row.forEach((v, j) => (p[i * 5 + j] = v)));
  const r = [0, 0, 0];
  absorb3(p, 0, 0, 0, r);
  // 로짓 공간 야코비안(배율 0): 초기값 x0 = J⁻¹ (logit(목표) − logit(기준))
  const h = 1e-5;
  const J = [0, 1, 2].map(() => [0, 0, 0]);
  for (let j = 0; j < 3; j++) {
    const v = [0, 0, 0];
    v[j] = h;
    const a = [0, 0, 0];
    absorb3(p, v[0]!, v[1]!, v[2]!, a);
    for (let i = 0; i < 3; i++) J[i]![j] = (logit(a[i]!) - logit(r[i]!)) / h;
  }
  const jinv = invert3(J);
  m = { p, ref: [r[0]!, r[1]!, r[2]!], jinv };
  FLAT.set(P0, m);
  return m;
}

function invert3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!;
  const B = -(d! * i! - f! * g!);
  const C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  if (Math.abs(det) < 1e-15) return null;
  const k = 1 / det;
  return [
    [A * k, -(b! * i! - c! * h!) * k, (b! * f! - c! * e!) * k],
    [B * k, (a! * i! - c! * g!) * k, -(a! * f! - c! * d!) * k],
    [C * k, -(a! * h! - b! * g!) * k, (a! * e! - b! * d!) * k],
  ];
}

/**
 * 대결 맞춤(D-167 (4)): 흡수 확률(볼넷·삼진·사구)이 목표와 같아지는 배율을 감쇠 뉴턴법으로 푼다.
 * 인플레이는 나머지라 3개만 맞추면 된다. tol 안에 들어오지 못하면 ok = false.
 * 초기값은 기준표에서 로짓 선형화로 추정해 반복 수를 줄인다(결과는 tol 안에서 같다).
 */
export function fitMatchup(P0: CountTable, target: { BB: number; K: number; HBP: number }, tol: number, maxIter: number): MatchupFit {
  const t = [target.BB, target.K, target.HBP];
  const fm = flatModel(P0);
  let x = [0, 0, 0];
  if (fm.jinv && t.every((v) => v > 0 && v < 1)) {
    const dl = [logit(t[0]!) - logit(fm.ref[0]), logit(t[1]!) - logit(fm.ref[1]), logit(t[2]!) - logit(fm.ref[2])];
    x = fm.jinv.map((row) => row[0]! * dl[0]! + row[1]! * dl[1]! + row[2]! * dl[2]!);
  }
  const buf = [0, 0, 0];
  const resid = (v: number[]) => {
    absorb3(fm.p, v[0]!, v[1]!, v[2]!, buf);
    return [buf[0]! - t[0]!, buf[1]! - t[1]!, buf[2]! - t[2]!];
  };
  if (Math.max(...resid(x).map(Math.abs)) > Math.max(...resid([0, 0, 0]).map(Math.abs))) x = [0, 0, 0];
  const norm = (r: number[]) => Math.max(Math.abs(r[0]!), Math.abs(r[1]!), Math.abs(r[2]!));
  let r = resid(x);
  let it = 0;
  const h = 1e-6;
  while (norm(r) > tol && it < maxIter) {
    it++;
    const J: number[][] = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const xp = [...x];
      xp[j]! += h;
      const rp = resid(xp);
      for (let i = 0; i < 3; i++) J[i]![j] = (rp[i]! - r[i]!) / h;
    }
    const step = solve3(J, r.map((v) => -v));
    if (!step) break;
    // 감쇠: 오차가 줄 때까지 걸음을 반으로
    let lambda = 1;
    let accepted = false;
    for (let k = 0; k < 30; k++) {
      const xn = x.map((v, i) => v + lambda * step[i]!);
      const rn = resid(xn);
      if (norm(rn) < norm(r)) {
        x = xn;
        r = rn;
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    if (!accepted) break;
  }
  const table = matchupTable(P0, x[0]!, x[1]!, x[2]!);
  const a = chainSummary(table).absorb;
  const ip = 1 - t[0]! - t[1]! - t[2]!;
  const maxError = Math.max(Math.abs(a[0] - t[0]!), Math.abs(a[1] - t[1]!), Math.abs(a[2] - t[2]!), Math.abs(a[3] - ip));
  return { ok: norm(r) <= tol, table, maxError, iterations: it };
}

export interface CountPa {
  result: CountResult;
  pitches: number;
  /** 마지막 투구 뒤 카운트(볼넷이면 볼 4, 삼진이면 스트라이크 3) */
  balls: number;
  strikes: number;
  fouls: number;
  /** 스트라이크 사건(루킹·헛스윙) 수. 투구 수 = 볼 + 스트라이크 사건 + 파울 + (마지막 사구·인플레이 1) */
  strikeEvents: number;
}

/**
 * 투구 단위 진행. uniform(n)은 n번째 투구의 균등 난수(10a 10.5: 키에서 파생, 순서대로 꺼내 쓰지 않음).
 * maxPitches를 넘으면 다음 투구를 인플레이로 끝낸다(연속 파울 수십 개, 확률상 무시할 만큼 작다).
 */
export function runCountPa(P: CountTable, uniform: (n: number) => number, maxPitches: number): CountPa {
  let balls = 0;
  let strikes = 0;
  let fouls = 0;
  let strikeEvents = 0;
  for (let n = 1; ; n++) {
    const p = P[countIndex(balls, strikes)]!;
    let e = INPLAY;
    if (n <= maxPitches) {
      let u = uniform(n);
      e = INPLAY;
      for (let j = 0; j < 5; j++) {
        u -= p[j]!;
        if (u < 0) {
          e = j;
          break;
        }
      }
    }
    if (e === BALL) {
      balls++;
      if (balls === 4) return { result: 'BB', pitches: n, balls, strikes, fouls, strikeEvents };
    } else if (e === STRIKE) {
      strikes++;
      strikeEvents++;
      if (strikes === 3) return { result: 'K', pitches: n, balls, strikes, fouls, strikeEvents };
    } else if (e === FOUL) {
      fouls++;
      if (strikes < 2) strikes++;
    } else if (e === HBP) return { result: 'HBP', pitches: n, balls, strikes, fouls, strikeEvents };
    else return { result: 'IP', pitches: n, balls, strikes, fouls, strikeEvents };
  }
}

/** 리그 기준 대결 맞춤 목표(볼넷·삼진·사구 비율, 결과별 평균 투구 수) */
export interface CountTargets {
  rates: { BB: number; K: number; HBP: number };
  pitches: { BB: number; K: number; HBP: number; IP: number };
}

/** 기준표 조정값 7개(D-167 (3)): 볼·스트라이크·파울·사구 로그 배율, 2스트라이크 파울 배율, 카운트 진행에 따른 사구·인플레이 기울기 */
export function shapedTable(base: CountTable, th: number[]): CountTable {
  const [lb, ls, lf, lh, lf2, sh, si] = th as [number, number, number, number, number, number, number];
  return base.map((row, idx) => {
    const b = Math.floor(idx / 3);
    const s = idx % 3;
    const depth = b + s;
    const w = [row[BALL]! * Math.exp(lb), row[STRIKE]! * Math.exp(ls), row[FOUL]! * Math.exp(lf + (s === 2 ? lf2 : 0)), row[HBP]! * Math.exp(lh + sh * depth), row[INPLAY]! * Math.exp(si * depth)];
    const sum = w.reduce((x, y) => x + y, 0);
    return w.map((x) => x / sum);
  });
}

/** 기준표 맞춤 잔차(척도: 비율 0.001, 투구 수 0.01) */
function shapeResiduals(base: CountTable, th: number[], t: CountTargets): number[] {
  const c = chainSummary(shapedTable(base, th));
  const m = meanPitches(c);
  return [
    (c.absorb[0] - t.rates.BB) / 0.001,
    (c.absorb[1] - t.rates.K) / 0.001,
    (c.absorb[2] - t.rates.HBP) / 0.001,
    (m[0] - t.pitches.BB) / 0.01,
    (m[1] - t.pitches.K) / 0.01,
    (m[2] - t.pitches.HBP) / 0.01,
    (m[3] - t.pitches.IP) / 0.01,
  ];
}

function solveN(J: number[][], r: number[]): number[] | null {
  const n = r.length;
  const a = J.map((row, i) => [...row, r[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(a[i]![c]!) > Math.abs(a[piv]![c]!)) piv = i;
    if (Math.abs(a[piv]![c]!) < 1e-18) return null;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    for (let i = 0; i < n; i++) {
      if (i === c) continue;
      const f = a[i]![c]! / a[c]![c]!;
      for (let j = c; j <= n; j++) a[i]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

/** 기준표 맞춤(보정 도구용): 레벤버그-마쿼트. 잔차 최대값(척도 단위)과 조정값을 돌려준다 */
export function fitCountTable(base: CountTable, t: CountTargets, maxIter = 200): { table: CountTable; theta: number[]; maxScaledResidual: number } {
  let th = [0, 0, 0, 0, 0, 0, 0];
  let r = shapeResiduals(base, th, t);
  const cost = (v: number[]) => v.reduce((s, x) => s + x * x, 0);
  let mu = 1e-3;
  for (let it = 0; it < maxIter && Math.max(...r.map(Math.abs)) > 1e-3; it++) {
    const J: number[][] = r.map(() => new Array(7).fill(0));
    for (let j = 0; j < 7; j++) {
      const tp = [...th];
      tp[j]! += 1e-6;
      const rp = shapeResiduals(base, tp, t);
      for (let i = 0; i < 7; i++) J[i]![j] = (rp[i]! - r[i]!) / 1e-6;
    }
    // (JᵀJ + μ·diag) δ = −Jᵀr
    const JtJ = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => J.reduce((s, row) => s + row[i]! * row[j]!, 0)));
    const Jtr = Array.from({ length: 7 }, (_, i) => -J.reduce((s, row, k) => s + row[i]! * r[k]!, 0));
    let improved = false;
    for (let k = 0; k < 20; k++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + mu) + 1e-12 : v)));
      const d = solveN(A, Jtr);
      if (!d) break;
      const tn = th.map((v, i) => v + d[i]!);
      const rn = shapeResiduals(base, tn, t);
      if (cost(rn) < cost(r)) {
        th = tn;
        r = rn;
        mu = Math.max(mu / 3, 1e-9);
        improved = true;
        break;
      }
      mu *= 4;
    }
    if (!improved) break;
  }
  return { table: shapedTable(base, th), theta: th, maxScaledResidual: Math.max(...r.map(Math.abs)) };
}
