// 게임 날짜. 'YYYY-MM-DD' 문자열로 저장하고 UTC 기준으로 계산해 시간대 영향을 없앤다.

export type GameDate = string;

const DAY_MS = 86_400_000;

// 성능(9a, D-240): 날짜 문자열 → 1970-01-01부터의 일수는 순수 함수라 메모한다(값은 같다). 크기가 너무 커지면 비운다
const dayNumMemo = new Map<GameDate, number>();
const addMemo = new Map<string, GameDate>();
const MEMO_MAX = 200_000;

function dayNum(d: GameDate): number {
  let n = dayNumMemo.get(d);
  if (n === undefined) {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    n = Math.round(Date.UTC(y, m - 1, day) / DAY_MS);
    if (dayNumMemo.size >= MEMO_MAX) dayNumMemo.clear();
    dayNumMemo.set(d, n);
  }
  return n;
}

export function toDate(d: GameDate): Date {
  return new Date(dayNum(d) * DAY_MS);
}

export function fromDate(date: Date): GameDate {
  return date.toISOString().slice(0, 10);
}

export function makeDate(year: number, month: number, day: number): GameDate {
  return fromDate(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(d: GameDate, days: number): GameDate {
  const key = `${d}|${days}`;
  let out = addMemo.get(key);
  if (out === undefined) {
    out = fromDate(new Date((dayNum(d) + days) * DAY_MS));
    if (addMemo.size >= MEMO_MAX) addMemo.clear();
    addMemo.set(key, out);
  }
  return out;
}

export function diffDays(a: GameDate, b: GameDate): number {
  return dayNum(a) - dayNum(b);
}

/** 0=일요일 … 6=토요일 */
export function weekday(d: GameDate): number {
  return (((dayNum(d) + 4) % 7) + 7) % 7; // 1970-01-01은 목요일(4)
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
