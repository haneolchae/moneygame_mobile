// 브랜드 리스트 읽기(23 문서, D-152). 후보 브랜드와 세부 성향은 코드가 아니라 리스트 파일(data/brands.json)에 둔다.
// 규격에 맞지 않는 항목은 건너뛰고 오류로 남긴다(자동 테스트가 오류 0건을 확인). 목록은 나중에 파일만 바꿔 넣는다.
import raw from './data/brands.json';

export const BRAND_CATEGORIES = ['general', 'sportswear', 'running', 'outdoor', 'fashion', 'baseball'] as const;
export const BRAND_ROLES = ['sponsor', 'maker', 'collab'] as const;
export const BRAND_STYLES = ['guaranteed', 'balanced', 'performance'] as const;
export const BRAND_INCENTIVES = ['postseason', 'top3', 'occupancy', 'satisfaction', 'allstar3', 'mrAllstar'] as const;
export const BRAND_OBLIGATIONS = ['none', 'campaigns', 'noHighPrice'] as const;
/** 9b-1(D-236 (2)): 스폰서 보장액 지급 방식 — 일시불·월별·혼합 */
export const BRAND_PAYMENTS = ['lump', 'monthly', 'mixed'] as const;

export type BrandStyle = (typeof BRAND_STYLES)[number];
export type BrandIncentive = (typeof BRAND_INCENTIVES)[number];
export type BrandObligation = (typeof BRAND_OBLIGATIONS)[number];
export type BrandPayment = (typeof BRAND_PAYMENTS)[number];

export interface BrandSpec {
  id: string;
  name: string;
  category: (typeof BRAND_CATEGORIES)[number];
  industry: string;
  awareness: '상' | '중' | '하';
  audience: string;
  roles: Array<(typeof BRAND_ROLES)[number]>;
  /** 스폰서 보장액 지급 방식(없으면 일시불) */
  payment?: BrandPayment;
  traits?: {
    /** 제안 유형 가중치(없으면 고르게) */
    style?: Partial<Record<BrandStyle, number>>;
    incentives?: BrandIncentive[];
    obligations?: BrandObligation[];
    note?: string;
  };
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const within = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const listOf = <T extends string>(list: readonly T[], v: unknown): v is T[] => Array.isArray(v) && v.length > 0 && v.every((x) => within(list, x));

/** 리스트를 규격대로 검사해 쓸 수 있는 항목과 오류를 나눈다 */
export function parseBrands(input: unknown): { brands: BrandSpec[]; errors: string[] } {
  const brands: BrandSpec[] = [];
  const errors: string[] = [];
  if (!Array.isArray(input)) return { brands, errors: ['브랜드 리스트는 배열이어야 합니다.'] };
  const seen = new Set<string>();
  input.forEach((item, i) => {
    const b = item as Record<string, unknown>;
    const where = `항목 ${i + 1}${isText(b?.id) ? `(${b.id})` : ''}`;
    const bad: string[] = [];
    if (!b || typeof b !== 'object') return void errors.push(`${where}: 객체가 아닙니다.`);
    if (!isText(b.id) || !/^[a-z0-9-]+$/.test(b.id)) bad.push('id는 영문 소문자·숫자·하이픈');
    else if (seen.has(b.id)) bad.push('id 중복');
    if (!isText(b.name)) bad.push('name 없음');
    if (!within(BRAND_CATEGORIES, b.category)) bad.push('category 값 오류');
    if (!isText(b.industry)) bad.push('industry 없음');
    if (!within(['상', '중', '하'] as const, b.awareness)) bad.push('awareness는 상·중·하');
    if (!isText(b.audience)) bad.push('audience 없음');
    if (!listOf(BRAND_ROLES, b.roles)) bad.push('roles 값 오류');
    if (b.payment !== undefined && !within(BRAND_PAYMENTS, b.payment)) bad.push('payment는 lump·monthly·mixed');
    const t = b.traits as Record<string, unknown> | undefined;
    if (t !== undefined) {
      if (typeof t !== 'object' || t === null) bad.push('traits는 객체');
      else {
        if (t.style !== undefined && !(typeof t.style === 'object' && t.style !== null && Object.entries(t.style).every(([k, v]) => within(BRAND_STYLES, k) && typeof v === 'number' && v >= 0) && Object.values(t.style).some((v) => (v as number) > 0))) bad.push('traits.style 값 오류');
        if (t.incentives !== undefined && !listOf(BRAND_INCENTIVES, t.incentives)) bad.push('traits.incentives 값 오류');
        if (t.obligations !== undefined && !listOf(BRAND_OBLIGATIONS, t.obligations)) bad.push('traits.obligations 값 오류');
        if (t.note !== undefined && typeof t.note !== 'string') bad.push('traits.note는 글');
      }
    }
    if (bad.length) return void errors.push(`${where}: ${bad.join(', ')}`);
    seen.add(b.id as string);
    brands.push(b as unknown as BrandSpec);
  });
  return { brands, errors };
}

const parsed = parseBrands(raw);
/** 규격을 통과한 브랜드(파일 순서) */
export const BRANDS: readonly BrandSpec[] = parsed.brands;
export const BRAND_ERRORS: readonly string[] = parsed.errors;
export const brandsFor = (role: (typeof BRAND_ROLES)[number]) => BRANDS.filter((b) => b.roles.includes(role));
