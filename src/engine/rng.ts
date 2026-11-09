// 저장 가능한 결정론적 난수 생성기 (sfc32).
// 상태는 32비트 정수 4개이며 그대로 저장·복원한다. 같은 상태에서는 항상 같은 수열이 나온다.

export type RngState = readonly [number, number, number, number];

/** 문자열을 128비트(32비트 × 4) 해시로 바꾼다 (cyrb128). 시드와 파생 키에 쓴다. */
export function hash128(input: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
    // 상태가 모두 0이면 수열이 멈추므로 막는다.
    if ((this.a | this.b | this.c | this.d) === 0) this.d = 1;
  }

  static fromSeed(seed: string): Rng {
    const rng = new Rng(hash128(seed));
    // 초기 상관을 없애기 위해 앞부분을 버린다.
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  /**
   * 정수 키 조합으로 독립 흐름을 만든다(문자열 해시 없이 빠름). 타석별 하위 흐름(10b §12)처럼 자주 만드는 곳에 쓴다.
   * 같은 키면 같은 수열이다.
   */
  static fromInts(a: number, b: number, c: number): Rng {
    const mix = (x: number) => {
      x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
      x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
      return (x ^ (x >>> 16)) >>> 0;
    };
    const rng = new Rng([mix(a ^ 0x9e3779b9), mix(b + 0x7f4a7c15), mix(c ^ 0x632be5ab), mix((a + b + c) ^ 0x243f6a88)]);
    for (let i = 0; i < 4; i++) rng.nextUint32();
    return rng;
  }

  /** 시드와 키 조합으로 독립 흐름을 만든다. 예: 경기별 난수 = derive(seed, 'game', fixtureId). */
  static derive(seed: string, ...keys: Array<string | number>): Rng {
    return Rng.fromSeed(`${seed}::${keys.join('::')}`);
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  nextUint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1) 실수 */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 표준정규분포 (Box-Muller) */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('빈 배열에서 고를 수 없음');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }
}

/** 조회용 결정론적 노이즈. 난수 흐름을 소비하지 않으므로 화면 조회가 게임 결과를 바꾸지 않는다. */
export function stableNormal(...keys: Array<string | number>): number {
  return Rng.fromSeed(keys.join('::')).normal();
}
