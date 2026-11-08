// 실제 KBO 구단 역사 데이터 형식 (24 문서, D-082). 2025 시즌까지.

export interface HistSeason {
  year: number;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number;
  postseason: string;
}

export interface LegendCareer {
  [stat: string]: number | null;
}

export interface Legend {
  /** 가상 이름(실제 이름은 넣지 않는다) */
  name: string;
  position: string;
  bats: string | null;
  throws: string | null;
  firstYear: number | null;
  lastYear: number | null;
  retiredNumber: number | null;
  isPitcher: boolean;
  /** KBO 통산 기록 */
  career: LegendCareer;
}

export interface HistRecord {
  label: string;
  holder: string;
  year: number | null;
  value: number | string | null;
}

export interface ClubHistoryData {
  clubId: number;
  firstSeason: number;
  seasons: HistSeason[];
  regularSeasonFirst: number[];
  legends: Legend[];
  records: HistRecord[];
}
