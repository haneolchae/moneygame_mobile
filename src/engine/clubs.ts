// 10개 가상 구단 (21 문서, D-032·D-033·D-041·D-047·D-064). 실제 구단명은 게임 데이터에 넣지 않는다.
// 시작 전력은 실제 2026 KBO 순위에 맞춘다(D-064): 1~4위 상, 5~8위 중, 9~10위 하.
import { EOK } from './money';
import type { ClubProfile, SeasonStanding } from './types';

const eok = (n: number) => n * EOK;

export const CLUB_PROFILES: readonly ClubProfile[] = [
  { id: 1, name: '서울 제미니즈', shortName: '제미니즈', city: '서울', stadium: '잠실 공동 구장', stadiumCapacity: 23_750, sharedStadiumGroup: 'jamsil', parentIndustry: '전자·화학 대기업', colors: '진홍·검정', difficulty: '쉬움', startCash: eok(300), parentSupport: eok(230), namingRights: 0, marketSize: 1.2, loyalty: '높음', strength: '상', prospectHeavy: false, primaryColor: '#A50034', secondaryColor: '#1A1A1A' },
  { id: 2, name: '서울 그리즐리스', shortName: '그리즐리스', city: '서울', stadium: '잠실 공동 구장', stadiumCapacity: 23_750, sharedStadiumGroup: 'jamsil', parentIndustry: '중공업·소비재 그룹', colors: '남색·흰색', difficulty: '보통', startCash: eok(150), parentSupport: eok(160), namingRights: 0, marketSize: 1.2, loyalty: '높음', strength: '중', prospectHeavy: false, primaryColor: '#131230', secondaryColor: '#FFFFFF' },
  { id: 3, name: '서울 레전즈', shortName: '레전즈', city: '서울', stadium: '서울 돔구장', stadiumCapacity: 16_000, sharedStadiumGroup: null, parentIndustry: '모기업 없음(명명권 스폰서)', colors: '버건디', difficulty: '매우 어려움', startCash: eok(30), parentSupport: 0, namingRights: eok(100), marketSize: 0.7, loyalty: '낮음', strength: '하', prospectHeavy: true, primaryColor: '#7A1F2B', secondaryColor: '#C8A165' },
  { id: 4, name: '인천 세일러스', shortName: '세일러스', city: '인천', stadium: '인천 구장', stadiumCapacity: 23_000, sharedStadiumGroup: null, parentIndustry: '유통 대기업', colors: '빨강·노랑', difficulty: '보통', startCash: eok(200), parentSupport: eok(190), namingRights: 0, marketSize: 1.0, loyalty: '보통', strength: '중', prospectHeavy: false, primaryColor: '#CE0E2D', secondaryColor: '#FFC72C' },
  { id: 5, name: '수원 매지션스', shortName: '매지션스', city: '수원', stadium: '수원 구장', stadiumCapacity: 18_700, sharedStadiumGroup: null, parentIndustry: '통신 대기업', colors: '검정·빨강', difficulty: '쉬움', startCash: eok(250), parentSupport: eok(260), namingRights: 0, marketSize: 0.9, loyalty: '보통', strength: '상', prospectHeavy: false, primaryColor: '#111111', secondaryColor: '#E4002B' },
  { id: 6, name: '대전 팰컨스', shortName: '팰컨스', city: '대전', stadium: '대전 신축 구장', stadiumCapacity: 17_000, sharedStadiumGroup: null, parentIndustry: '화학·방산·금융 그룹', colors: '주황', difficulty: '보통', startCash: eok(200), parentSupport: eok(190), namingRights: 0, marketSize: 0.9, loyalty: '매우 높음', strength: '하', prospectHeavy: false, primaryColor: '#F37321', secondaryColor: '#1F1F1F' },
  { id: 7, name: '대구 레오즈', shortName: '레오즈', city: '대구', stadium: '대구 구장', stadiumCapacity: 24_000, sharedStadiumGroup: null, parentIndustry: '전자 대기업', colors: '파랑', difficulty: '쉬움', startCash: eok(300), parentSupport: eok(230), namingRights: 0, marketSize: 1.0, loyalty: '높음', strength: '상', prospectHeavy: false, primaryColor: '#074CA1', secondaryColor: '#C0C0C0' },
  { id: 8, name: '광주 팬서스', shortName: '팬서스', city: '광주', stadium: '광주 구장', stadiumCapacity: 20_500, sharedStadiumGroup: null, parentIndustry: '자동차', colors: '빨강·검정', difficulty: '보통', startCash: eok(200), parentSupport: eok(190), namingRights: 0, marketSize: 1.2, loyalty: '매우 높음', strength: '상', prospectHeavy: false, primaryColor: '#D7141A', secondaryColor: '#111111' },
  { id: 9, name: '창원 렉스', shortName: '렉스', city: '창원', stadium: '창원 구장', stadiumCapacity: 18_000, sharedStadiumGroup: null, parentIndustry: '게임사', colors: '남색·금색', difficulty: '어려움', startCash: eok(100), parentSupport: eok(130), namingRights: 0, marketSize: 0.7, loyalty: '보통', strength: '중', prospectHeavy: false, primaryColor: '#1D3A6D', secondaryColor: '#C9A24B' },
  { id: 10, name: '부산 타이탄스', shortName: '타이탄스', city: '부산', stadium: '부산 구장', stadiumCapacity: 22_600, sharedStadiumGroup: null, parentIndustry: '유통·식품 그룹', colors: '남색·빨강', difficulty: '어려움', startCash: eok(100), parentSupport: eok(150), namingRights: 0, marketSize: 1.2, loyalty: '매우 높음', strength: '중', prospectHeavy: false, primaryColor: '#041E42', secondaryColor: '#D00F31' },
];

export function clubById(id: number): ClubProfile {
  const club = CLUB_PROFILES.find((c) => c.id === id);
  if (!club) throw new Error(`알 수 없는 구단 ID: ${id}`);
  return club;
}

/** 실제 2026 KBO 정규시즌 최종 순위와 한국시리즈 결과를 가상 구단에 대응 (D-061, 22 문서). */
export const SEASON_2026_STANDINGS: readonly SeasonStanding[] = [
  { season: 2026, clubId: 5, rank: 1, wins: 90, losses: 49, ties: 5, postseason: '한국시리즈 준우승' },
  { season: 2026, clubId: 7, rank: 2, wins: 83, losses: 58, ties: 3, postseason: '한국시리즈 우승' },
  { season: 2026, clubId: 8, rank: 3, wins: 79, losses: 63, ties: 2, postseason: '포스트시즌 진출' },
  { season: 2026, clubId: 1, rank: 4, wins: 78, losses: 65, ties: 1, postseason: '포스트시즌 진출' },
  { season: 2026, clubId: 2, rank: 5, wins: 73, losses: 66, ties: 5, postseason: '와일드카드' },
  { season: 2026, clubId: 4, rank: 6, wins: 65, losses: 74, ties: 5, postseason: '' },
  { season: 2026, clubId: 10, rank: 7, wins: 64, losses: 77, ties: 3, postseason: '' },
  { season: 2026, clubId: 9, rank: 8, wins: 64, losses: 78, ties: 2, postseason: '' },
  { season: 2026, clubId: 6, rank: 9, wins: 57, losses: 83, ties: 4, postseason: '' },
  { season: 2026, clubId: 3, rank: 10, wins: 50, losses: 90, ties: 4, postseason: '' },
];
