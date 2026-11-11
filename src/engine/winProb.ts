// 승리 확률 표·레버리지(10 문서 승리 확률 표, D-161·D-167). 순수 함수만 둔다.
// 표는 보정 도구가 엔진 경기의 타석 전이(24개 주자·아웃 상태 → 다음 상태·득점)로 계산해 설정 파일로 둔다.
// 값은 홈팀 승리 확률(무승부 0.5). 레버리지 = 그 타석의 기대 |Δ승리 확률| ÷ 리그 평균.
import { CLUTCH } from './config';
import WIN_TABLE from './data/winProbability.json';

export interface WinTable {
  version: string;
  /** 정규시즌 마지막 이닝(그 뒤 무승부) */
  maxInnings: number;
  /** 점수 차(홈 − 원정) 표 범위 ±diffMax. 넘으면 끝값을 쓴다 */
  diffMax: number;
  /** [이닝 1..maxInnings][초·말][상태 24][점수 차] 홈팀 승리 확률 */
  wp: number[];
  /** 같은 순서의 레버리지 */
  li: number[];
}

const TABLE = WIN_TABLE as WinTable;

/** 주자 상태 비트: 1루 1, 2루 2, 3루 4. 상태 번호 = 아웃 × 8 + 주자 */
export const baseOutState = (outs: number, basesMask: number) => outs * 8 + basesMask;

function cell(t: WinTable, inning: number, half: 'T' | 'B', outs: number, basesMask: number, diff: number): number {
  const D = t.diffMax;
  const d = Math.max(-D, Math.min(D, diff));
  return (((inning - 1) * 2 + (half === 'T' ? 0 : 1)) * 24 + baseOutState(outs, basesMask)) * (2 * D + 1) + (d + D);
}

/** 표의 이닝 행: 정규시즌은 그대로, 포스트시즌 연장(규칙상 11회 뒤에도 계속)은 연장 기준 행(ASSUMPTION(D-167)) */
function rowInning(t: WinTable, inning: number, postseason: boolean): number {
  if (postseason && inning > CLUTCH.postseasonExtraRow) return CLUTCH.postseasonExtraRow;
  return Math.min(inning, t.maxInnings);
}

export const winTableVersion = (): string => TABLE.version;
export const winTableReady = (): boolean => TABLE.li.length > 0;

/** 타석 시작 때 홈팀 승리 확률 */
export function winProbability(inning: number, half: 'T' | 'B', outs: number, basesMask: number, diff: number, postseason: boolean, t: WinTable = TABLE): number {
  if (t.wp.length === 0) return 0.5;
  return t.wp[cell(t, rowInning(t, inning, postseason), half, outs, basesMask, diff)]!;
}

/** 타석 시작 때 레버리지(표가 없으면 0) */
export function leverage(inning: number, half: 'T' | 'B', outs: number, basesMask: number, diff: number, postseason: boolean, t: WinTable = TABLE): number {
  if (t.li.length === 0) return 0;
  return t.li[cell(t, rowInning(t, inning, postseason), half, outs, basesMask, diff)]!;
}

// ───────── 표 만들기(보정 도구용) ─────────

/** 상태 s(0~23)에서 타석 하나의 전이: to = 다음 상태(24 = 3아웃으로 반 이닝 종료), runs = 그 타석 득점, p = 확률 */
export type Transitions = Array<Array<{ to: number; runs: number; p: number }>>;
export const END_STATE = 24;

/** 반 이닝 남은 득점 분포 R[s][r](r ≤ runsCap, 넘는 몫은 runsCap에 합친다). 같은 아웃 안의 순환은 반복 계산으로 수렴 */
export function halfInningRuns(T: Transitions, runsCap: number): number[][] {
  const R: number[][] = Array.from({ length: 24 }, () => new Array(runsCap + 1).fill(0));
  for (let iter = 0; iter < 500; iter++) {
    let delta = 0;
    for (let s = 23; s >= 0; s--) {
      const next = new Array(runsCap + 1).fill(0);
      for (const { to, runs, p } of T[s]!) {
        if (to === END_STATE) next[Math.min(runsCap, runs)] += p;
        else {
          const src = R[to]!;
          for (let r = 0; r <= runsCap; r++) if (src[r]) next[Math.min(runsCap, r + runs)] += p * src[r]!;
        }
      }
      for (let r = 0; r <= runsCap; r++) delta = Math.max(delta, Math.abs(next[r] - R[s]![r]!));
      R[s] = next;
    }
    if (delta < 1e-13) break;
  }
  return R;
}

/**
 * 승리 확률 W와 타석 기대 |ΔW| 표(정규화 전). 이닝 1..maxInnings, 점수 차 ±diffMax.
 * 내부 계산은 ±innerMax 범위(넘으면 승패가 정해진 것으로 본다).
 */
export function buildWinTables(T: Transitions, maxInnings: number, diffMax: number, runsCap: number, innerMax = 40): { wp: number[]; eAbs: number[] } {
  const R = halfInningRuns(T, runsCap);
  const ND = 2 * innerMax + 1;
  const idx = (d: number) => d + innerMax;
  // W[i][h][s][d], V(i, h, d) = 반 이닝 시작 값
  const W = Array.from({ length: maxInnings + 2 }, () => [0, 1].map(() => Array.from({ length: 24 }, () => new Array(ND).fill(0))));
  const decided = (d: number) => (d > 0 ? 1 : d < 0 ? 0 : 0.5);
  const startB = (i: number, d: number): number => {
    if (d > innerMax) return 1;
    if (d < -innerMax) return 0;
    if (i >= 9 && d > 0) return 1; // 말 공격 없음
    return W[i]![1]![0]![idx(d)]!;
  };
  const startT = (i: number, d: number): number => {
    if (d > innerMax) return 1;
    if (d < -innerMax) return 0;
    return W[i]![0]![0]![idx(d)]!;
  };
  /** 말 공격이 끝난 뒤(이닝 i, 점수 차 d) */
  const afterInning = (i: number, d: number): number => {
    if (i >= 9 && d !== 0) return decided(d);
    if (i >= maxInnings) return decided(d);
    return startT(i + 1, d);
  };
  for (let i = maxInnings; i >= 1; i--) {
    for (let s = 0; s < 24; s++) {
      for (let d = -innerMax; d <= innerMax; d++) {
        // 말: 9회 이후 홈팀이 앞서면 끝(끝내기). 득점은 늘기만 하므로 최종 득점으로 판정해도 같다
        let v = 0;
        if (i >= 9 && d > 0) v = 1;
        else for (let r = 0; r < R[s]!.length; r++) if (R[s]![r]) v += R[s]![r]! * afterInning(i, d + r);
        W[i]![1]![s]![idx(d)] = v;
      }
    }
    for (let s = 0; s < 24; s++) {
      for (let d = -innerMax; d <= innerMax; d++) {
        let v = 0;
        for (let r = 0; r < R[s]!.length; r++) if (R[s]![r]) v += R[s]![r]! * startB(i, d - r);
        W[i]![0]![s]![idx(d)] = v;
      }
    }
  }
  const wAt = (i: number, h: number, s: number, d: number): number => {
    if (d > innerMax) return 1;
    if (d < -innerMax) return 0;
    return W[i]![h]![s]![idx(d)]!;
  };
  const wp: number[] = [];
  const eAbs: number[] = [];
  for (let i = 1; i <= maxInnings; i++) {
    for (let h = 0; h < 2; h++) {
      for (let s = 0; s < 24; s++) {
        for (let d = -diffMax; d <= diffMax; d++) {
          const w0 = wAt(i, h, s, d);
          let e = 0;
          for (const { to, runs, p } of T[s]!) {
            const d2 = h === 0 ? d - runs : d + runs;
            let w1: number;
            if (h === 1 && i >= 9 && d2 > 0) w1 = 1; // 끝내기
            else if (to === END_STATE) w1 = h === 0 ? startB(i, d2) : afterInning(i, d2);
            else w1 = wAt(i, h, to, d2);
            e += p * Math.abs(w1 - w0);
          }
          wp.push(w0);
          eAbs.push(e);
        }
      }
    }
  }
  return { wp, eAbs };
}

/** 표 칸 번호(보정 도구가 타석 상태별 출현 횟수로 리그 평균을 낼 때 쓴다) */
export function tableCell(maxInnings: number, diffMax: number, inning: number, half: 'T' | 'B', outs: number, basesMask: number, diff: number, postseason = false): number {
  const t = { maxInnings, diffMax } as WinTable;
  return cell(t, rowInning(t, inning, postseason), half, outs, basesMask, diff);
}
