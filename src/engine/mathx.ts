// 확률 계산 공통 함수(10a·10b). 계산 전 확률을 [floor, 1 − floor]로 제한한다.
const FLOOR = 0.0001;

export const clampP = (p: number) => Math.min(1 - FLOOR, Math.max(FLOOR, p));
export const logit = (p: number) => {
  const q = clampP(p);
  return Math.log(q / (1 - q));
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
