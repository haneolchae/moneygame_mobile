// 8a 리그 시상(D-180·25 문서): 순위 점수·자격·투표 편차·이름. 상태가 없는 순수 함수만 둔다.
import { AWARDS as A } from './config';
import { Rng } from './rng';
import type { BattingTotals, PitchingTotals } from './stats';

export type PitLine = PitchingTotals & { HLD: number; BS: number; QS: number };

export const AWARD_LABEL: Record<string, string> = {
  title_AVG: '타율 1위', title_HR: '홈런 1위', title_RBI: '타점 1위', title_R: '득점 1위', title_H: '안타 1위', title_SB: '도루 1위', title_OBP: '출루율 1위', title_SLG: '장타율 1위',
  title_W: '다승 1위', title_ERA: '평균자책 1위', title_K: '탈삼진 1위', title_SV: '세이브 1위', title_HLD: '홀드 1위', title_WPCT: '승률 1위',
  mvp: '정규시즌 MVP', roy: '신인왕', pitcher: '최우수 투수', closer: '최우수 구원 투수(마무리)', setup: '최우수 구원 투수(중간)', comeback: '재기상',
  manager: '감독상', front: '올해의 프런트', defense: '수비상', milestone: '기록 달성상', ks_mvp: '한국시리즈 MVP',
  gg: '골든글러브', platinum: '플래티넘 글러브', best1: '베스트 팀 1팀', best2: '베스트 팀 2팀',
  monthly_bat: '월간 MVP(타자)', monthly_pit: '월간 MVP(투수)', monthly_rookie: '월간 신인',
};

export const POS_LABEL: Record<string, string> = { P: '투수', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', OF: '외야수', DH: '지명타자', SP: '선발 투수', RP: '구원 투수', UT: '야수(추가)' };

export const awardTitle = (award: string, slot: string) => {
  const base = AWARD_LABEL[award] ?? award;
  if (!slot) return base;
  if (award.startsWith('monthly_')) return `${Number(slot.slice(5))}월 ${base}`;
  if (award === 'milestone') return `${base}(${slot})`;
  return `${base}(${POS_LABEL[slot.replace(/\d+$/, '')] ?? slot})`;
};

/** 투표 편차: (시드, 시즌, 상, 대상)에서 파생한 ±spread */
export const voteNoise = (seed: string, season: number, award: string, subject: number) => (Rng.derive(seed, 'award', season, award, subject).next() * 2 - 1) * A.voteSpread;

/** 부문 순위 점수: 값 높은(또는 낮은) 순으로 1위 10점 ~ 10위 1점. 동률은 같은 순위(경쟁 순위) */
export function rankPoints(values: Map<number, number>, higherBetter = true): Map<number, number> {
  const list = [...values.entries()].filter(([, v]) => Number.isFinite(v)).sort((a, b) => (higherBetter ? b[1] - a[1] : a[1] - b[1]) || a[0] - b[0]);
  const out = new Map<number, number>();
  let rank = 0;
  list.forEach(([id, v], i) => {
    if (i === 0 || v !== list[i - 1]![1]) rank = i + 1;
    if (rank <= A.rankPointsTop) out.set(id, A.rankPointsTop + 1 - rank);
  });
  return out;
}

/** 공동 1위(값이 같은 대상 모두) */
export function leaders(values: Map<number, number>, higherBetter = true): number[] {
  const list = [...values.entries()].filter(([, v]) => Number.isFinite(v));
  if (list.length === 0) return [];
  const best = higherBetter ? Math.max(...list.map(([, v]) => v)) : Math.min(...list.map(([, v]) => v));
  return list.filter(([, v]) => v === best).map(([id]) => id).sort((a, b) => a - b);
}

export const avg = (b: BattingTotals) => (b.AB > 0 ? b.H / b.AB : NaN);
export const obp = (b: BattingTotals) => { const d = b.AB + b.BB + b.HBP + b.SF; return d > 0 ? (b.H + b.BB + b.HBP) / d : NaN; };
export const slg = (b: BattingTotals) => (b.AB > 0 ? (b.H + b['2B'] + 2 * b['3B'] + 3 * b.HR) / b.AB : NaN);
export const ops = (b: BattingTotals) => obp(b) + slg(b);
export const era = (p: PitchingTotals) => (p.OUTS > 0 ? (p.ER * 27) / p.OUTS : NaN);
export const whip = (p: PitchingTotals) => (p.OUTS > 0 ? ((p.H + p.BB) * 3) / p.OUTS : NaN);
export const isStarter = (p: PitchingTotals) => p.GS * 2 >= p.G;

/** 타자 9부문 순위 점수 합(비율 부문은 자격자만) */
export function hitterPoints(lines: Map<number, BattingTotals>, qualified: (id: number) => boolean): Map<number, number> {
  const pick = (f: (b: BattingTotals) => number, rate = false) => new Map([...lines].filter(([id]) => !rate || qualified(id)).map(([id, b]) => [id, f(b)]));
  const parts = [
    rankPoints(pick(avg, true)), rankPoints(pick((b) => b.HR)), rankPoints(pick((b) => b.RBI)), rankPoints(pick((b) => b.R)), rankPoints(pick((b) => b.H)),
    rankPoints(pick((b) => b.SB ?? 0)), rankPoints(pick(obp, true)), rankPoints(pick(slg, true)), rankPoints(pick(ops, true)),
  ];
  return sumMaps(parts);
}

/** 선발 6부문(다승·평균자책·탈삼진·이닝·WHIP·QS), 구원 5부문(세이브·홀드·평균자책·WHIP·등판) 순위 점수 합 */
export function pitcherPoints(lines: Map<number, PitLine>, qualifiedStarter: (id: number) => boolean, qualifiedReliever: (id: number) => boolean): { starter: Map<number, number>; reliever: Map<number, number> } {
  const st = new Map([...lines].filter(([, p]) => isStarter(p)));
  const rp = new Map([...lines].filter(([, p]) => !isStarter(p)));
  const pick = (m: Map<number, PitLine>, f: (p: PitLine) => number, q?: (id: number) => boolean) => new Map([...m].filter(([id]) => !q || q(id)).map(([id, p]) => [id, f(p)]));
  const starter = sumMaps([
    rankPoints(pick(st, (p) => p.W)), rankPoints(pick(st, era, qualifiedStarter), false), rankPoints(pick(st, (p) => p.K)), rankPoints(pick(st, (p) => p.OUTS)), rankPoints(pick(st, whip, qualifiedStarter), false), rankPoints(pick(st, (p) => p.QS)),
  ]);
  const reliever = sumMaps([
    rankPoints(pick(rp, (p) => p.SV)), rankPoints(pick(rp, (p) => p.HLD)), rankPoints(pick(rp, era, qualifiedReliever), false), rankPoints(pick(rp, whip, qualifiedReliever), false), rankPoints(pick(rp, (p) => p.G)),
  ]);
  return { starter, reliever };
}

export function sumMaps(parts: Array<Map<number, number>>): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of parts) for (const [id, v] of m) out.set(id, (out.get(id) ?? 0) + v);
  return out;
}

/** 이정표: 지난 합계 < 기준 ≤ 지금 합계인 기준들 */
export function crossed(before: number, after: number, steps: readonly number[]): number[] {
  return steps.filter((s) => before < s && after >= s);
}
