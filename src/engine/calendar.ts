// 게임 날짜. 'YYYY-MM-DD' 문자열로 저장하고 UTC 기준으로 계산해 시간대 영향을 없앤다.

export type GameDate = string;

const DAY_MS = 86_400_000;

export function toDate(d: GameDate): Date {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(date: Date): GameDate {
  return date.toISOString().slice(0, 10);
}

export function makeDate(year: number, month: number, day: number): GameDate {
  return fromDate(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(d: GameDate, days: number): GameDate {
  return fromDate(new Date(toDate(d).getTime() + days * DAY_MS));
}

export function diffDays(a: GameDate, b: GameDate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY_MS);
}

/** 0=일요일 … 6=토요일 */
export function weekday(d: GameDate): number {
  return toDate(d).getUTCDay();
}

/** 해당 주의 월요일 (게임 주는 월~일) */
export function mondayOf(d: GameDate): GameDate {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

/** 그 달의 n번째 특정 요일. weekdayIndex: 0=일 … 6=토 */
export function nthWeekdayOfMonth(year: number, month: number, weekdayIndex: number, n: number): GameDate {
  const first = makeDate(year, month, 1);
  const offset = (weekdayIndex - weekday(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

export function yearOf(d: GameDate): number {
  return Number(d.slice(0, 4));
}

/** 생년월일과 기준일로 만 나이를 계산한다 (04 문서: 나이는 기준 날짜와 생년월일로 계산). */
export function ageOn(birthDate: GameDate, on: GameDate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
export function formatDateKo(d: GameDate): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}년 ${m}월 ${day}일 (${WEEKDAY_KO[weekday(d)]})`;
}
