// 통계 산식 (05 문서). 원시 합계에서만 계산하고, 분모가 0이면 null('—' 표시)을 돌려준다.

export interface BattingTotals {
  G: number;
  PA: number;
  AB: number;
  H: number;
  '2B': number;
  '3B': number;
  HR: number;
  RBI: number;
  R: number;
  BB: number;
  HBP: number;
  SO: number;
  SF: number;
  /** 4c-2a 도루·도루 실패(시작 이전 생성 기록에는 없을 수 있다) */
  SB?: number;
  CS?: number;
}

export interface PitchingTotals {
  G: number;
  GS: number;
  OUTS: number;
  W: number;
  L: number;
  SV: number;
  BF: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  HBP: number;
  K: number;
  HR: number;
  pitches: number;
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export function battingRates(t: BattingTotals) {
  const singles = t.H - t['2B'] - t['3B'] - t.HR;
  const avg = ratio(t.H, t.AB);
  const obp = ratio(t.H + t.BB + t.HBP, t.AB + t.BB + t.HBP + t.SF);
  const slg = ratio(singles + 2 * t['2B'] + 3 * t['3B'] + 4 * t.HR, t.AB);
  return {
    AVG: avg,
    OBP: obp,
    SLG: slg,
    OPS: obp === null || slg === null ? null : obp + slg,
    ISO: slg === null || avg === null ? null : slg - avg,
    BABIP: ratio(t.H - t.HR, t.AB - t.SO - t.HR + t.SF),
    'BB%': ratio(t.BB, t.PA),
    'K%': ratio(t.SO, t.PA),
  };
}

/** FIP 상수: 리그 ERA와 리그 FIP(상수 제외)가 같아지도록 정한다 (05 문서). */
export function fipConstant(league: PitchingTotals): number | null {
  if (league.OUTS === 0) return null;
  const era = (27 * league.ER) / league.OUTS;
  const raw = (13 * league.HR + 3 * (league.BB + league.HBP) - 2 * league.K) / (league.OUTS / 3);
  return era - raw;
}

export function pitchingRates(t: PitchingTotals, fipC: number | null) {
  const ip3 = t.OUTS / 3;
  return {
    ERA: ratio(27 * t.ER, t.OUTS),
    WHIP: ratio(3 * (t.BB + t.H), t.OUTS),
    'K/9': ratio(27 * t.K, t.OUTS),
    'BB/9': ratio(27 * t.BB, t.OUTS),
    'HR/9': ratio(27 * t.HR, t.OUTS),
    FIP: ip3 === 0 || fipC === null ? null : (13 * t.HR + 3 * (t.BB + t.HBP) - 2 * t.K) / ip3 + fipC,
    'K-BB%': ratio(t.K - t.BB, t.BF),
  };
}

/** 이닝 표기: 17아웃 → "5.2" */
export function formatInnings(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}
