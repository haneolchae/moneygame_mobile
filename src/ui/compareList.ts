// 선수 비교 목록(3e, D-122): 화면용 임시 선택. 세이브에 저장하지 않으며 최대 4명.
export const COMPARE_MAX = 4;
export const compareList: { ids: number[] } = { ids: [] };

export function toggleCompare(id: number): 'added' | 'removed' | 'full' {
  if (compareList.ids.includes(id)) {
    compareList.ids = compareList.ids.filter((x) => x !== id);
    return 'removed';
  }
  if (compareList.ids.length >= COMPARE_MAX) return 'full';
  compareList.ids = [...compareList.ids, id];
  return 'added';
}
