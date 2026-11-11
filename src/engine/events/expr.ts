// EV-1 조건식 평가기(D-203 (3), 26a E3): 숫자·문자열·변수·비교·논리·사칙·괄호만 허용하는 소형 식.
// 함수 호출·대입·속성 계산 같은 그 밖 문법은 규격 오류로 거부한다(임의 코드 실행 없음).

export type ExprNode =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'not'; a: ExprNode }
  | { k: 'neg'; a: ExprNode }
  | { k: 'bin'; op: string; a: ExprNode; b: ExprNode };

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

const OPS = ['&&', '||', '<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '!', '(', ')'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error('문자열이 닫히지 않았습니다.');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // 변수: 영문·숫자·밑줄과 점(분류.이름)만
    const id = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`허용하지 않는 문자: ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

/** 식을 읽는다. 허용 밖 문법이면 오류 */
export function parseExpr(src: string): ExprNode {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const bin = (next: () => ExprNode, ops: string[]) => (): ExprNode => {
    let a = next();
    while (peek()?.t === 'op' && ops.includes(String(peek()!.v))) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: 'bin', op, a, b: next() };
    }
    return a;
  };
  const primary = (): ExprNode => {
    const t = toks[p++];
    if (!t) throw new Error('식이 끝났습니다.');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (isOp('(')) throw new Error(`함수 호출은 허용하지 않습니다: ${t.v}`);
      if (t.v === 'true') return { k: 'num', v: 1 };
      if (t.v === 'false') return { k: 'num', v: 0 };
      return { k: 'var', name: t.v };
    }
    if (t.v === '(') {
      const e = or();
      if (!isOp(')')) throw new Error('괄호가 닫히지 않았습니다.');
      p++;
      return e;
    }
    if (t.v === '!') return { k: 'not', a: primary() };
    if (t.v === '-') return { k: 'neg', a: primary() };
    throw new Error(`예상하지 못한 기호: ${t.v}`);
  };
  const mul = bin(primary, ['*', '/']);
  const add = bin(mul, ['+', '-']);
  const cmp = bin(add, ['<', '<=', '>', '>=']);
  const eq = bin(cmp, ['==', '!=']);
  const and = bin(eq, ['&&']);
  const or: () => ExprNode = bin(and, ['||']);
  const e = or();
  if (p < toks.length) throw new Error(`해석하지 못한 부분: ${JSON.stringify(toks[p])}`);
  return e;
}

/** 식에 쓰인 변수 이름 */
export function exprVars(e: ExprNode, out = new Set<string>()): Set<string> {
  if (e.k === 'var') out.add(e.name);
  else if (e.k === 'not' || e.k === 'neg') exprVars(e.a, out);
  else if (e.k === 'bin') {
    exprVars(e.a, out);
    exprVars(e.b, out);
  }
  return out;
}

export type ExprValue = number | string;
const truthy = (v: ExprValue) => (typeof v === 'number' ? v !== 0 : v.length > 0);

/** 값 계산. 없는 변수는 0(플래그처럼 없으면 거짓) */
export function evalExpr(e: ExprNode, vars: (name: string) => ExprValue | undefined): ExprValue {
  switch (e.k) {
    case 'num':
    case 'str':
      return e.v;
    case 'var':
      return vars(e.name) ?? 0;
    case 'not':
      return truthy(evalExpr(e.a, vars)) ? 0 : 1;
    case 'neg':
      return -Number(evalExpr(e.a, vars));
    case 'bin': {
      if (e.op === '&&') return truthy(evalExpr(e.a, vars)) && truthy(evalExpr(e.b, vars)) ? 1 : 0;
      if (e.op === '||') return truthy(evalExpr(e.a, vars)) || truthy(evalExpr(e.b, vars)) ? 1 : 0;
      const a = evalExpr(e.a, vars);
      const b = evalExpr(e.b, vars);
      switch (e.op) {
        case '==':
          return a === b ? 1 : 0;
        case '!=':
          return a !== b ? 1 : 0;
        case '<':
          return a < b ? 1 : 0;
        case '<=':
          return a <= b ? 1 : 0;
        case '>':
          return a > b ? 1 : 0;
        case '>=':
          return a >= b ? 1 : 0;
        case '+':
          return Number(a) + Number(b);
        case '-':
          return Number(a) - Number(b);
        case '*':
          return Number(a) * Number(b);
        case '/':
          return Number(b) === 0 ? 0 : Number(a) / Number(b);
      }
      throw new Error(`연산자 오류: ${e.op}`);
    }
  }
}

export const isTrue = (e: ExprNode, vars: (name: string) => ExprValue | undefined) => truthy(evalExpr(e, vars));
