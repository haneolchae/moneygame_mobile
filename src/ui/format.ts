// 표시 형식. 게임 규칙은 넣지 않는다.
import type { StatValue } from '../shared/protocol';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export function dateKo(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')} (${WEEKDAY[wd]})`;
}

export function shortDate(d: string): string {
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
}

export function won(amount: number): string {
  const eok = amount / 100_000_000;
  if (Math.abs(eok) >= 1) return `${eok >= 100 ? Math.round(eok).toLocaleString('ko-KR') : eok.toFixed(1).replace(/\.0$/, '')}억`;
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
}

/** 비율 지표: .312 형태. 분모 0이면 '—' (05 문서) */
export function rate3(v: StatValue | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(3).replace(/^0/, '');
}

export function fixed2(v: StatValue | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(2);
}

export function pct(v: StatValue | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export function innings(ip: StatValue | undefined): string {
  if (ip === null || ip === undefined) return '—';
  const outs = Math.round(ip * 3);
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

export function int(v: StatValue | undefined): string {
  return v === null || v === undefined ? '—' : String(Math.round(v));
}

export const RATING_LABELS: Record<string, string> = {
  contact: '컨택',
  eye: '선구안',
  power: '장타력',
  speed: '주력',
  stuff: '구위',
  control: '제구',
  groundball: '땅볼 유도',
  stamina: '지구력',
  def_fielding: '수비 숙련',
  def_arm: '송구',
  def_range: '수비 범위',
};

export const POSITION_LABELS: Record<string, string> = {
  SP: '선발',
  RP: '구원',
  C: '포수',
  '1B': '1루수',
  '2B': '2루수',
  '3B': '3루수',
  SS: '유격수',
  LF: '좌익수',
  CF: '중견수',
  RF: '우익수',
};

/** 20~80 평가 등급 문구 (색만으로 구분하지 않도록 글자로도 표시) */
export function gradeLabel(v: number): string {
  if (v >= 70) return '최상';
  if (v >= 60) return '우수';
  if (v >= 50) return '평균';
  if (v >= 40) return '미흡';
  return '부족';
}
