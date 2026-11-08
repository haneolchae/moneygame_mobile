// 금액 규칙. 모든 금액은 정수 원(₩) 단위로 저장한다.
//
// - 저장·장부 금액: JavaScript 안전 정수 범위(±9,007,199,254,740,991원, 약 9천조 원) 안의 정수.
//   구단 단위 금액(수천억 원)과 리그 누적 합계를 모두 넉넉히 담는다.
// - 중간 계산: 금액 × 비율처럼 범위를 넘을 수 있는 곱셈은 BigInt로 계산한 뒤 정수 원으로 반올림한다.
// - 비율: 정수 베이시스포인트(1bp = 0.01%)로 표현한다. 예: 물가 2.5% = 250bp, 50% = 5000bp.
// - 반올림: 원 단위 "사사오입"(0.5원은 0에서 먼 쪽으로). 음수도 대칭으로 처리한다.
// - 나눠 지급(분할): 나머지 원은 앞 회차부터 1원씩 더해 합계가 정확히 원금과 같게 한다.

export type Won = number;

export const BP_SCALE = 10_000n;

export function assertWon(value: number, label = '금액'): asserts value is Won {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}은 안전 정수 원 단위여야 함: ${value}`);
}

/** BigInt 나눗셈을 원 단위 사사오입으로 반올림한다. */
function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return negative ? -q : q;
}

function toSafe(value: bigint): Won {
  const n = Number(value);
  assertWon(n, '계산 결과');
  return n;
}

/** 금액 × 비율(bp). 예: applyRate(10억, 250) = 2,500만 원 */
export function applyRate(amount: Won, rateBp: number): Won {
  assertWon(amount);
  if (!Number.isInteger(rateBp)) throw new Error(`비율은 정수 bp여야 함: ${rateBp}`);
  return toSafe(divRoundHalfAwayFromZero(BigInt(amount) * BigInt(rateBp), BP_SCALE));
}

/** 금액을 (1 + 비율)만큼 늘린다. 물가 상승, 중계권료 인상 등에 쓴다. */
export function growBy(amount: Won, rateBp: number): Won {
  return amount + applyRate(amount, rateBp);
}

/** 금액 × 분자 / 분모 (예: 일할 계산). */
export function prorate(amount: Won, numerator: number, denominator: number): Won {
  assertWon(amount);
  if (denominator === 0) throw new Error('분모가 0');
  return toSafe(divRoundHalfAwayFromZero(BigInt(amount) * BigInt(numerator), BigInt(denominator)));
}

/** 금액을 n회로 나눈다. 합계는 원금과 정확히 같다. */
export function splitEvenly(amount: Won, parts: number): Won[] {
  assertWon(amount);
  if (!Number.isInteger(parts) || parts <= 0) throw new Error(`분할 횟수 오류: ${parts}`);
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

export const EOK = 100_000_000; // 1억 원
export const MAN = 10_000; // 1만 원

/** 표시용: 억·만 원 단위 문자열 */
export function formatWon(amount: Won): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= EOK) {
    const eok = abs / EOK;
    return `${sign}${eok >= 100 ? Math.round(eok).toLocaleString('ko-KR') : eok.toFixed(1).replace(/\.0$/, '')}억`;
  }
  if (abs >= MAN) return `${sign}${Math.round(abs / MAN).toLocaleString('ko-KR')}만`;
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}
