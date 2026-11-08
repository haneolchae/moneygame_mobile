// 개발용: 조사한 실제 KBO 구단 역사(JSON)를 게임 데이터(src/engine/data/kboHistory.ts)로 바꾼다 (24 문서, D-082).
// 실제 선수 이름은 게임 데이터에 넣지 않는다. 같은 사람은 같은 가상 이름으로 바꾸고, 기록 숫자만 유지한다.
// 실행: node scripts/import-kbo-history.mjs <JSON 파일들...>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const SURNAMES = ['강', '고', '구', '권', '김', '나', '남', '노', '도', '류', '문', '민', '박', '배', '백', '서', '석', '성', '손', '송', '신', '안', '양', '엄', '오', '우', '원', '유', '윤', '이', '임', '장', '전', '정', '조', '주', '지', '진', '차', '천', '최', '추', '하', '한', '허', '현', '홍', '황'];
const FIRST = ['가', '건', '경', '규', '기', '나', '단', '대', '도', '동', '래', '로', '률', '린', '무', '민', '범', '병', '보', '산', '서', '석', '선', '성', '세', '솔', '수', '승', '시', '아', '언', '연', '열', '온', '완', '용', '우', '운', '원', '윤', '율', '은', '이', '인', '재', '정', '준', '지', '진', '찬', '창', '채', '청', '태', '택', '평', '하', '한', '해', '헌', '혁', '현', '호', '홍', '환', '효', '훈', '휘'];
const SECOND = ['겸', '곤', '광', '교', '구', '권', '규', '근', '길', '담', '덕', '란', '람', '랑', '령', '록', '룡', '림', '목', '반', '방', '배', '벽', '빈', '삼', '상', '섭', '술', '앙', '엽', '영', '오', '옥', '완', '욱', '웅', '익', '일', '잠', '전', '조', '종', '주', '중', '직', '천', '철', '초', '추', '춘', '탁', '탄', '판', '표', '필', '학', '항', '형', '화', '흠', '흥'];
const FOREIGN = ['로건 하퍼', '닐 크로퍼드', '브렛 웨일', '이선 몰리', '칼 데이비슨', '레이 파울러', '데인 엘리스', '숀 맥케이', '트래비스 노턴', '피트 갤러거'];

const used = new Set();
const names = new Map();
const PLACEHOLDER = '이름 미상';

function fictional(realName) {
  if (!realName) return PLACEHOLDER;
  if (names.has(realName)) return names.get(realName);
  const isForeign = /[a-zA-Z]/.test(realName) || realName.includes(' ') || realName.length > 4;
  let salt = 0;
  let out;
  do {
    const h = createHash('sha256').update(`fo-legend:${realName}:${salt++}`).digest();
    out = isForeign ? `${FOREIGN[h[0] % FOREIGN.length]}${salt > 1 ? ` ${salt}` : ''}` : `${SURNAMES[h[0] % SURNAMES.length]}${FIRST[h[1] % FIRST.length]}${SECOND[h[2] % SECOND.length]}`;
  } while (used.has(out) || out === realName);
  used.add(out);
  names.set(realName, out);
  return out;
}

const POSTSEASON = new Set(['한국시리즈 우승', '한국시리즈 준우승', '플레이오프 탈락', '준플레이오프 탈락', '와일드카드 탈락', '']);
const files = process.argv.slice(2);
const clubs = [];
const problems = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const c of j.clubs) {
    const seasons = (c.seasons ?? []).filter((s) => s.year <= 2025).sort((a, b) => a.year - b.year);
    for (let i = 1; i < seasons.length; i++) if (seasons[i].year !== seasons[i - 1].year + 1) problems.push(`${c.clubId}: ${seasons[i - 1].year}→${seasons[i].year} 연도 누락`);
    for (const s of seasons) {
      if (!POSTSEASON.has(s.postseason ?? '')) problems.push(`${c.clubId} ${s.year}: 포스트시즌 표기 '${s.postseason}'`);
      if ([s.rank, s.wins, s.losses].some((v) => typeof v !== 'number')) problems.push(`${c.clubId} ${s.year}: 순위·승패 누락`);
    }
    clubs.push({
      clubId: c.clubId,
      firstSeason: c.firstSeason,
      seasons: seasons.map((s) => ({ year: s.year, rank: s.rank ?? null, wins: s.wins ?? null, losses: s.losses ?? null, ties: s.ties ?? 0, postseason: s.postseason ?? '' })),
      regularSeasonFirst: (c.regularSeasonFirst ?? []).filter((y) => y <= 2025),
      legends: (c.legends ?? []).map((l) => ({
        name: fictional(l.realName),
        position: l.position ?? '',
        bats: l.bats ?? null,
        throws: l.throws ?? null,
        firstYear: l.firstYear ?? null,
        lastYear: l.lastYear ?? null,
        retiredNumber: l.retiredNumber ?? null,
        isPitcher: l.position === 'P',
        career: l.career ?? {},
      })),
      records: (c.singleSeasonRecords ?? []).filter((r) => r.year == null || r.year <= 2025).map((r) => ({ label: r.label, holder: fictional(r.realName), year: r.year ?? null, value: r.value ?? null })),
    });
  }
}
clubs.sort((a, b) => a.clubId - b.clubId);
const header = `// 실제 KBO 구단 역사(2025 시즌까지, D-082). scripts/import-kbo-history.mjs로 생성 — 직접 고치지 않는다.
// 구단은 게임 구단 ID로만 구분하고, 선수 이름은 모두 가상 이름으로 바꿨다. 숫자 기록은 조사 자료 그대로다.
import type { ClubHistoryData } from './historyTypes';

export const KBO_HISTORY: ClubHistoryData[] = `;
const body = `${header}${JSON.stringify(clubs, null, 2)};\n`;
// 실명 유출 검사: 조사 자료의 실제 이름이 결과 파일에 하나라도 남으면 중단한다.
const leaked = [...names.keys()].filter((n) => n.length >= 2 && body.includes(n));
if (leaked.length) throw new Error(`실명 ${leaked.length}건이 데이터에 남았습니다.`);
writeFileSync(new URL('../src/engine/data/kboHistory.ts', import.meta.url), body);
console.log(JSON.stringify({ clubs: clubs.map((c) => ({ id: c.clubId, seasons: c.seasons.length, legends: c.legends.length, records: c.records.length })), problems }, null, 1));
