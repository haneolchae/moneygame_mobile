// 업적(24 문서, D-080·D-097·D-182): 분류 → 계열 → 단계. 원시 경기 기록·순위·장부·조직 상태로만 판정하고 하루 처리 트랜잭션 안에서 기록한다.
// 우리 구단만 달성한다. 선수 업적은 우리 구단 소속으로 쌓은 기록만 센다.
import { weekday, type GameDate } from '../engine/calendar';
import { ACHIEVEMENT_XP as X } from '../engine/config';
import type { GameResult } from '../engine/gamesim';
import { addXp, xpToNext } from '../engine/owner';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import { battingRates, pitchingRates, type BattingTotals, type PitchingTotals } from '../engine/stats';
import type { ClubId, PlayerTruth } from '../engine/types';
import { allStarDates } from '../engine/allStar';
import { EOK } from '../engine/money';
import { clubHistory } from '../engine/data/history';
import { TEAMS } from '../engine/staff';
import type { GameMeta, GameRepository, InboxMessage } from './ports';
import { judgeOps, newMemo, type AchMemo } from './achievementsOps';
import { judgePQAwards, judgePQGame, judgePQLeague, judgePQOps, judgePQSeason, newPQMemo, newPQState, type PQMemo, type PQState } from './achievementsPQ';
import { addDays } from '../engine/calendar';
import { AWARDS } from '../engine/config';

export type AchievementType = 'once' | 'season' | 'cumulative';

export const CATEGORY_LABEL: Record<string, string> = {
  A: 'A 경기', B: 'B 타자 시즌', C: 'C 투수 시즌', D: 'D 통산', E: 'E 시즌 성적', F: 'F 왕조·연속',
  G: 'G 육성·드래프트', H: 'H 선수단 운영', I: 'I 시설', J: 'J 팬·관중', K: 'K 굿즈·스폰서', L: 'L 재무', M: 'M 조직·구단주', N: 'N 구단 역사', O: 'O 수상',
  P: 'P 진기록', Q: 'Q 불명예',
};

interface SeriesDef {
  id: string;
  cat: string;
  title: string;
  type: AchievementType;
  /** 단계 기준값(낮을수록 좋은 계열은 lower) */
  stages: readonly number[];
  /** 단계 이름(없으면 기준값) */
  labels?: readonly string[];
  /** 단계별 경험치 단계(1~5). 없으면 단계 순서 */
  tiers?: readonly number[];
  lower?: boolean;
  desc: string;
  /** 8c(D-184): 원천 기능이 없어 판정하지 않는 계열의 사유 */
  inactive?: string;
}

const s = (id: string, cat: string, title: string, type: AchievementType, stages: readonly number[], desc: string, extra: Partial<SeriesDef> = {}): SeriesDef => ({ id, cat, title, type, stages, desc, ...extra });
const one = (id: string, cat: string, title: string, type: AchievementType, tier: number, desc: string, extra: Partial<SeriesDef> = {}): SeriesDef => s(id, cat, title, type, [1], desc, { tiers: [tier], labels: [''], ...extra });

/** 계열 목록(8b: A~F, 8c 전 임시 운영 계열) */
export const SERIES: readonly SeriesDef[] = [
  // A 경기(1회형, 시즌 누적은 시즌형)
  s('A_streak', 'A', '팀 연승', 'once', [5, 7, 10, 12, 15], '정규시즌 연승(무승부는 연승을 끊지 않음)'),
  s('A_home', 'A', '홈 연승', 'once', [5, 8, 12], '정규시즌 홈 경기 연승'),
  s('A_series', 'A', '연속 시리즈 위닝', 'once', [5, 8, 12], '연속으로 이긴 시리즈(2·3연전) 수'),
  s('A_runs', 'A', '한 경기 득점', 'once', [10, 15, 20, 25], '한 경기 팀 득점'),
  s('A_hits', 'A', '한 경기 팀 안타', 'once', [15, 20, 25], '한 경기 팀 안타'),
  s('A_hr', 'A', '한 경기 팀 홈런', 'once', [3, 5, 7], '한 경기 팀 홈런'),
  s('A_comeback', 'A', '역전승', 'once', [3, 5, 7, 10], '가장 크게 뒤진 점수 차를 뒤집은 승리'),
  s('A_walkoff', 'A', '끝내기 승리', 'season', [3, 5, 10], '한 시즌 끝내기 승리 수'),
  s('A_extra', 'A', '연장 승리', 'season', [3, 5, 10], '한 시즌 연장 승리 수'),
  s('A_shutout', 'A', '영봉승', 'season', [5, 10, 15], '한 시즌 영봉승 수'),
  s('A_sweep', 'A', '3연전 스윕', 'season', [3, 5, 8], '한 시즌 3연전 전승 수'),
  s('A_pk', 'A', '투수 한 경기 탈삼진', 'once', [10, 12, 15, 18], '우리 투수 한 경기 탈삼진'),
  one('A_cg', 'A', '완투승', 'once', 2, '우리 투수 혼자 끝까지 던진 승리'),
  one('A_sho', 'A', '완봉승', 'once', 3, '우리 투수 혼자 무실점으로 던진 승리'),
  one('A_nono', 'A', '노히트 노런', 'once', 5, '우리 투수 혼자 안타를 내주지 않은 승리'),
  one('A_perfect', 'A', '퍼펙트 게임', 'once', 5, '우리 투수 혼자 한 명도 출루시키지 않은 승리'),
  s('A_bh', 'A', '타자 한 경기 안타', 'once', [4, 5, 6], '우리 타자 한 경기 안타'),
  s('A_bhr', 'A', '타자 한 경기 홈런', 'once', [2, 3, 4], '우리 타자 한 경기 홈런'),
  s('A_brbi', 'A', '타자 한 경기 타점', 'once', [6, 8, 10], '우리 타자 한 경기 타점'),
  one('A_cycle', 'A', '사이클링 히트', 'once', 3, '우리 타자 한 경기 단타·2루타·3루타·홈런'),
  one('A_first', 'A', '첫 승', 'once', 1, '구단주 취임 후 첫 승리'),
  one('A_firsthome', 'A', '첫 홈 승리', 'once', 1, '구단주 취임 후 첫 홈 경기 승리'),
  one('A_firstps', 'A', '첫 포스트시즌 승리', 'once', 2, '구단주 취임 후 첫 포스트시즌 경기 승리'),
  // B 타자 시즌 기록(1회형, 우리 구단 소속 기록)
  s('B_hr', 'B', '홈런', 'once', [30, 40, 50, 60, 70], '우리 타자 한 시즌 홈런'),
  s('B_h', 'B', '안타', 'once', [100, 150, 200, 250], '우리 타자 한 시즌 안타'),
  s('B_rbi', 'B', '타점', 'once', [80, 100, 120, 150], '우리 타자 한 시즌 타점'),
  s('B_r', 'B', '득점', 'once', [80, 100, 120, 150], '우리 타자 한 시즌 득점'),
  s('B_2b', 'B', '2루타', 'once', [30, 40, 50], '우리 타자 한 시즌 2루타'),
  s('B_3b', 'B', '3루타', 'once', [5, 10, 15], '우리 타자 한 시즌 3루타'),
  s('B_sb', 'B', '도루', 'once', [30, 40, 50, 60, 80], '우리 타자 한 시즌 도루'),
  s('B_bb', 'B', '볼넷', 'once', [80, 100, 120], '우리 타자 한 시즌 볼넷'),
  s('B_avg', 'B', '타율', 'once', [0.3, 0.33, 0.35, 0.4], '규정 타석 타율(시즌 종료)', { labels: ['.300', '.330', '.350', '.400'] }),
  s('B_obp', 'B', '출루율', 'once', [0.4, 0.45, 0.5], '규정 타석 출루율(시즌 종료)', { labels: ['.400', '.450', '.500'] }),
  s('B_slg', 'B', '장타율', 'once', [0.55, 0.6, 0.7], '규정 타석 장타율(시즌 종료)', { labels: ['.550', '.600', '.700'] }),
  s('B_ops', 'B', 'OPS', 'once', [0.9, 1.0, 1.1], '규정 타석 OPS(시즌 종료)', { labels: ['.900', '1.000', '1.100'] }),
  s('B_so', 'B', '삼진 억제', 'once', [40, 30, 20], '규정 타석 삼진 수 이하(시즌 종료)', { lower: true }),
  s('B_hstreak', 'B', '연속 경기 안타', 'once', [20, 25, 30], '한 시즌 연속 경기 안타'),
  s('B_obstreak', 'B', '연속 경기 출루', 'once', [30, 40, 50], '한 시즌 연속 경기 출루'),
  one('B_allgames', 'B', '전 경기 출전', 'once', 2, '정규시즌 전 경기 출전(시즌 종료)'),
  s('B_2020', 'B', '호타준족', 'once', [20, 30, 40], '같은 시즌 홈런·도루 모두 기준 이상', { labels: ['20-20', '30-30', '40-40'] }),
  one('B_33100', 'B', '3할-30홈런-100타점', 'once', 3, '규정 타석 타율 .300·30홈런·100타점(시즌 종료)'),
  one('B_triple', 'B', '타격 트리플 크라운', 'once', 5, '타율(규정)·홈런·타점 리그 1위(시즌 종료)'),
  // C 투수 시즌 기록(1회형)
  s('C_w', 'C', '승', 'once', [10, 15, 20, 25], '우리 투수 한 시즌 승'),
  s('C_sv', 'C', '세이브', 'once', [20, 30, 40, 50], '우리 투수 한 시즌 세이브'),
  s('C_hld', 'C', '홀드', 'once', [20, 25, 30, 35], '우리 투수 한 시즌 홀드'),
  s('C_k', 'C', '탈삼진', 'once', [150, 200, 250, 300], '우리 투수 한 시즌 탈삼진'),
  s('C_ip', 'C', '이닝', 'once', [150, 180, 200, 220], '우리 투수 한 시즌 이닝'),
  s('C_era', 'C', '평균자책', 'once', [3, 2.5, 2, 1.5], '규정 이닝 평균자책 이하(시즌 종료)', { lower: true, labels: ['3.00', '2.50', '2.00', '1.50'] }),
  s('C_whip', 'C', 'WHIP', 'once', [1.1, 1.0, 0.9], '규정 이닝 WHIP 이하(시즌 종료)', { lower: true, labels: ['1.10', '1.00', '0.90'] }),
  s('C_qs', 'C', '퀄리티 스타트', 'once', [20, 25, 30], '한 시즌 퀄리티 스타트(6이닝 이상 자책 3 이하)'),
  s('C_cg', 'C', '완투', 'once', [3, 5, 10], '한 시즌 완투'),
  s('C_sho', 'C', '완봉', 'once', [2, 3, 5], '한 시즌 완봉'),
  s('C_zero', 'C', '연속 무실점 이닝', 'once', [20, 30, 40], '실점 없는 등판을 이은 이닝'),
  s('C_swin', 'C', '선발 연승', 'once', [8, 10, 12], '선발 등판 승리를 패배 없이 이은 수'),
  one('C_unbeaten', 'C', '무패 시즌', 'once', 3, '10승 이상 0패(시즌 종료)'),
  one('C_triple', 'C', '투수 트리플 크라운', 'once', 5, '다승·평균자책(규정)·탈삼진 리그 1위(시즌 종료)'),
  // D 통산(우리 구단 소속 통산, 1회형)
  s('D_hr', 'D', '통산 홈런', 'once', [100, 200, 300, 400], '우리 구단 소속 통산 홈런'),
  s('D_h', 'D', '통산 안타', 'once', [1000, 1500, 2000, 2500], '우리 구단 소속 통산 안타'),
  s('D_rbi', 'D', '통산 타점', 'once', [500, 1000, 1500], '우리 구단 소속 통산 타점'),
  s('D_sb', 'D', '통산 도루', 'once', [200, 300, 500], '우리 구단 소속 통산 도루'),
  s('D_w', 'D', '통산 승', 'once', [50, 100, 150, 200], '우리 구단 소속 통산 승'),
  s('D_sv', 'D', '통산 세이브', 'once', [100, 200, 300], '우리 구단 소속 통산 세이브'),
  s('D_hld', 'D', '통산 홀드', 'once', [100, 150, 200], '우리 구단 소속 통산 홀드(2027 시즌부터 기록)'),
  s('D_k', 'D', '통산 탈삼진', 'once', [1000, 1500, 2000], '우리 구단 소속 통산 탈삼진'),
  s('D_g', 'D', '통산 출전 경기(야수)', 'once', [1000, 1500, 2000], '우리 구단 소속 야수 통산 출전'),
  s('D_oneclub', 'D', '원클럽맨', 'once', [10, 15, 20], '모든 경력 시즌을 우리 구단에서 보낸 선수의 근속 연수'),
  // E 시즌 성적(팀, 시즌형)
  s('E_w', 'E', '정규시즌 승', 'season', [70, 80, 90, 100], '정규시즌 승'),
  s('E_pct', 'E', '정규시즌 승률', 'season', [0.55, 0.6, 0.65, 0.7], '정규시즌 승률', { labels: ['.550', '.600', '.650', '.700'] }),
  s('E_post', 'E', '순위·포스트시즌', 'season', [1, 2, 3, 4], '가을야구 → 한국시리즈 진출 → 한국시리즈 우승 → 통합 우승', { labels: ['가을야구', '한국시리즈 진출', '한국시리즈 우승', '통합 우승'] }),
  one('E_first', 'E', '정규시즌 1위', 'season', 4, '정규시즌 1위'),
  one('E_wc', 'E', '와일드카드 돌파', 'season', 2, '4·5위로 시작해 준플레이오프 진출'),
  s('E_rise', 'E', '꼴찌의 반란', 'season', [1, 2], '전 시즌 10위에서 가을야구 → 한국시리즈 우승', { labels: ['가을야구', '한국시리즈 우승'], tiers: [3, 5] }),
  s('E_homepct', 'E', '홈 승률', 'season', [0.6, 0.7], '정규시즌 홈 승률', { labels: ['.600', '.700'] }),
  one('E_h2h', 'E', '전 구단 상대 우세', 'season', 3, '9개 구단 모두 상대 전적 우세'),
  s('E_thr', 'E', '팀 홈런', 'season', [150, 180, 220, 250], '팀 홈런'),
  s('E_tavg', 'E', '팀 타율', 'season', [0.28, 0.29, 0.3], '팀 타율', { labels: ['.280', '.290', '.300'] }),
  s('E_tops', 'E', '팀 OPS', 'season', [0.78, 0.8, 0.85], '팀 OPS', { labels: ['.780', '.800', '.850'] }),
  s('E_tr', 'E', '팀 득점', 'season', [750, 850, 950], '팀 득점'),
  s('E_tsb', 'E', '팀 도루', 'season', [100, 150, 200], '팀 도루'),
  s('E_tera', 'E', '팀 평균자책', 'season', [3.99, 3.49, 2.99], '팀 평균자책 이하', { lower: true, labels: ['3.99', '3.49', '2.99'] }),
  s('E_twhip', 'E', '팀 WHIP', 'season', [1.3, 1.2, 1.1], '팀 WHIP 이하', { lower: true, labels: ['1.30', '1.20', '1.10'] }),
  s('E_tk', 'E', '팀 탈삼진', 'season', [1100, 1250, 1400], '팀 탈삼진'),
  one('E_minra', 'E', '리그 최소 실점', 'season', 2, '10개 구단 중 최소 실점'),
  one('E_mine', 'E', '리그 최소 실책', 'season', 2, '10개 구단 중 최소 실책'),
  one('E_maxr', 'E', '리그 최다 득점', 'season', 2, '10개 구단 중 최다 득점'),
  // F 왕조·연속(재임 시즌, 시즌형 / 누적형)
  s('F_ps', 'F', '연속 가을야구', 'season', [3, 5, 7, 10], '재임 중 연속 가을야구 시즌'),
  s('F_ks', 'F', '한국시리즈 연패', 'season', [2, 3, 4], '재임 중 연속 한국시리즈 우승'),
  s('F_first', 'F', '정규시즌 1위 연속', 'season', [2, 3], '재임 중 연속 정규시즌 1위'),
  s('F_500', 'F', '연속 승률 5할 이상', 'season', [5, 10, 15], '재임 중 연속 승률 5할 이상 시즌'),
  s('F_titles', 'F', '재임 중 우승', 'cumulative', [1, 3, 5, 10], '재임 중 한국시리즈 우승 횟수'),
  s('F_psn', 'F', '재임 중 가을야구', 'cumulative', [5, 10, 20], '재임 중 가을야구 진출 횟수'),
  // ───── 8c(D-184) G~O. inactive: 원천 기능이 없어 판정하지 않는 계열 ─────
  // G 육성·드래프트(우리 구단 지명 선수, 누적형)
  s('G_debut', 'G', '지명 선수 1군 데뷔', 'cumulative', [1, 5, 10, 20], '우리 구단 지명 선수의 1군 첫 출전(명)'),
  s('G_qual', 'G', '지명 선수 규정 진입', 'cumulative', [1, 5, 10], '우리 구단 지명 선수가 규정 타석·이닝을 채운 수(명)'),
  s('G_late', 'G', '5라운드 이하 주전 정착', 'cumulative', [1, 3], '5라운드 이하 지명 선수 규정 진입(명)'),
  s('G_roy', 'G', '지명 선수 신인왕', 'cumulative', [1, 3, 5], '우리 구단 지명 선수 신인왕(명)'),
  s('G_title', 'G', '지명 선수 타이틀', 'cumulative', [1, 5, 10], '우리 구단 지명 선수 타이틀(개)'),
  s('G_mvp', 'G', '지명 선수 MVP', 'cumulative', [1, 3], '우리 구단 지명 선수 정규시즌 MVP(회)'),
  s('G_young', 'G', '1~3년차 활약', 'cumulative', [1, 3, 5], '지명 1~3년차 시즌 20홈런 또는 10승(명)'),
  one('G_first1', 'G', '1순위의 증명', 'once', 3, '1라운드 1순위 지명 선수 규정 OPS .850 또는 15승 시즌'),
  // H 선수단 운영
  s('H_trade', 'H', '트레이드 성사', 'cumulative', [1, 5, 10, 25], '재임 중 트레이드 성사(건)'),
  s('H_tradeTitle', 'H', '트레이드 영입 타이틀', 'cumulative', [1, 3], '트레이드로 데려온 선수가 그 시즌 타이틀(명)'),
  s('H_trade300', 'H', '트레이드 영입 즉시 효과', 'cumulative', [1, 3], '트레이드 영입 시즌 규정 3할 또는 10승(명)'),
  s('H_fa', 'H', '외부 FA 영입', 'cumulative', [1, 3, 5, 10], '다른 구단 FA 영입(명)'),
  s('H_faTitle', 'H', 'FA 영입 타이틀', 'cumulative', [1, 3], '외부 FA로 데려온 선수의 타이틀(개)'),
  s('H_stay', 'H', '내부 FA 잔류', 'cumulative', [1, 3, 5, 10], '우리 FA 선수 잔류 계약(명)'),
  one('H_franchise', 'H', '간판을 지켜라', 'once', 2, '간판 선수와 FA 잔류 계약'),
  s('H_foreign', 'H', '외국인 연속 재계약', 'once', [2, 3, 5], '같은 외국인 선수 재계약 연차'),
  one('H_f15', 'H', '외국인 투수 15승', 'once', 2, '외국인 투수 한 시즌 15승(우리 구단 소속)'),
  one('H_f30', 'H', '외국인 타자 30홈런', 'once', 2, '외국인 타자 한 시즌 30홈런(우리 구단 소속)'),
  // D-228: 'MLB 관심' 스토브리그 결정 카드의 포스팅 성사·무산 기록으로 판정
  s('H_posting', 'H', '포스팅 MLB 진출', 'cumulative', [1, 3], '포스팅으로 MLB 진출(명)'),
  s('H_postingFee', 'H', '포스팅 이적료 누적', 'cumulative', [100, 300], '포스팅 이적료 누적(억)'),
  s('H_multi', 'H', '다년 계약 완주', 'cumulative', [1, 5], '3년 이상 계약 완주(명)', { inactive: '계약 이력 기록 없음' }),
  s('H_persuade', 'H', '은퇴 설득 성공', 'cumulative', [1, 3, 5], '은퇴를 설득해 한 시즌 더 뛴 선수(명)'),
  s('H_oneclubRetire', 'H', '원클럽맨 은퇴', 'cumulative', [1, 3], '모든 경력을 우리 구단에서 보내고 은퇴(명)'),
  one('H_noRelease', 'H', '방출 없는 시즌', 'season', 2, '그 시즌을 덮는 방출 잔여 연봉 의무 0건(정규시즌 종료)'),
  // I 시설(누적형, 1단계 경험치)
  one('I_start', 'I', '첫 착공', 'once', 1, '시설 공사를 처음 착공'),
  one('I_done', 'I', '첫 완공', 'once', 1, '시설 공사를 처음 완공'),
  s('I_levels', 'I', '시설 단계 완공 누적', 'cumulative', [3, 5, 10, 20], '완공한 시설 단계 합', { tiers: [1, 1, 1, 1] }),
  one('I_max', 'I', '모든 시설 최고 단계', 'once', 5, '시설 4종 모두 최고 단계'),
  s('I_approval', 'I', '지자체 승인 공사 완공', 'cumulative', [1, 3], '구장 편의시설(지자체 승인) 완공 단계', { tiers: [1, 1] }),
  s('I_condition', 'I', '개막일 시설 상태 80 이상', 'cumulative', [1, 3, 5], '개막일 모든 시설 상태 80 이상(시즌)', { inactive: '시설 노후도 기능 없음', tiers: [1, 1, 1] }),
  one('I_breakdown', 'I', '시설 고장 0 시즌', 'season', 1, '시설 고장 사건 없는 시즌', { inactive: '시설 고장 기능 없음' }),
  // J 팬·마케팅·관중
  s('J_att', 'J', '시즌 홈 관중', 'season', [60, 80, 100, 120, 150], '정규시즌 홈 관중(만 명)', { labels: ['60만', '80만', '100만', '120만', '150만'] }),
  s('J_sellouts', 'J', '시즌 매진 경기', 'season', [10, 20, 36, 72], '정규시즌 홈 매진 경기 수'),
  s('J_sellStreak', 'J', '연속 매진', 'once', [5, 10, 20], '홈 경기 연속 매진'),
  s('J_sat', 'J', '시즌 종료 팬 만족도', 'season', [70, 80, 90], '정규시즌 마지막 날 팬 만족도'),
  s('J_loyalty', 'J', '시즌 종료 팬 충성도', 'season', [70, 80, 90], '팬 충성도', { inactive: '팬 충성도 변화 모델 없음' }),
  one('J_recover', 'J', '팬 반발 회복', 'once', 3, '팬 반발 상태를 8주 안에 회복'),
  s('J_campaigns', 'J', '마케팅 캠페인 실행', 'cumulative', [5, 10, 25, 50], '재임 중 캠페인 실행(건)'),
  s('J_seasonTicket', 'J', '시즌권 판매 목표', 'cumulative', [1, 3, 5], '시즌권 목표 달성 시즌', { inactive: '시즌권 기능 없음' }),
  one('J_avgTop', 'J', '홈 평균 관중 1위', 'season', 3, '정규시즌 홈 평균 관중 리그 1위'),
  // K 굿즈·스폰서·영업
  s('K_merch', 'K', '굿즈 시즌 매출', 'season', [30, 50, 100, 200], '정규시즌 굿즈 매출(억)', { labels: ['30억', '50억', '100억', '200억'] }),
  s('K_sku', 'K', '단일 상품 누적 판매', 'once', [10000, 50000, 100000], '한 상품군 누적 판매(개)', { labels: ['1만', '5만', '10만'] }),
  s('K_launch', 'K', '굿즈 출시', 'cumulative', [10, 25, 50], '굿즈 종류 출시', { inactive: '상품 출시 기능 없음(상품군 3종 고정)' }),
  s('K_disposal', 'K', '재고 폐기 관리', 'season', [1, 2], '폐기율 5% 이하 · 폐기 0', { inactive: '재고 폐기 기능 없음' }),
  s('K_sponsorN', 'K', '스폰서 계약 체결', 'cumulative', [5, 10, 25], '재임 중 스폰서 계약(건)'),
  s('K_brands', 'K', '계약 브랜드 수', 'cumulative', [10, 25, 50], '스폰서 계약을 맺은 서로 다른 브랜드 수'),
  one('K_topBrand', 'K', '최상위 브랜드 메인 스폰서', 'once', 3, '최상위 제안 성향 브랜드와 메인 계약', { inactive: '브랜드 제안 성향 등급 없음' }),
  s('K_sponsorRev', 'K', '시즌 스폰서 수입', 'season', [30, 50, 100, 150], '시즌 마감 정산 스폰서 수입(억)', { labels: ['30억', '50억', '100억', '150억'] }),
  s('K_incentive', 'K', '스폰서 인센티브 전부 충족', 'cumulative', [1, 3], '인센티브 조건 전부 충족 시즌', { inactive: '정산 결과 기록 없음' }),
  one('K_renew', 'K', '스폰서 재계약률 100%', 'season', 2, '스폰서 전원 재계약', { inactive: '스폰서 재계약 기능 없음(1년 계약)' }),
  s('K_ticket', 'K', '티켓 시즌 수입', 'season', [100, 150, 200], '정규시즌 입장 수입(억)', { labels: ['100억', '150억', '200억'] }),
  // L 재무
  s('L_cash', 'L', '현금 잔고', 'once', [300, 500, 1000, 2000], '보유 현금(억)', { labels: ['300억', '500억', '1,000억', '2,000억'] }),
  s('L_profitRun', 'L', '흑자 시즌 연속', 'once', [1, 3, 5, 10], '장부 시즌 흑자(기초 현금 제외) 연속'),
  s('L_op', 'L', '시즌 영업이익', 'season', [50, 100, 200], '장부 시즌 영업이익(억, 기초 현금·모기업 지원 제외)', { labels: ['50억', '100억', '200억'] }),
  s('L_noParent', 'L', '모기업 지원 없이 흑자', 'cumulative', [1, 3], '모기업 지원금을 빼고도 흑자인 장부 시즌'),
  s('L_noEmergency', 'L', '긴급 지원 없이', 'once', [5, 10], '긴급 지원 없이 이어간 재임 시즌'),
  one('L_crisis', 'L', '자금 위기 탈출', 'once', 3, '현금 0 미만 위기 상태 해제'),
  one('L_capTitle', 'L', '샐러리캡 안에서 우승', 'season', 4, '국내 선수 연봉 총액이 샐러리캡 안에서 한국시리즈 우승'),
  one('L_cheapPs', 'L', '저비용 가을야구', 'season', 4, '연봉 총액 리그 하위 3개 구단으로 가을야구'),
  s('L_sales', 'L', '선수 매각·이적료 수입', 'cumulative', [50, 100, 300], '트레이드 현금·FA 보상금 수입 합(억)', { labels: ['50억', '100억', '300억'] }),
  // M 조직·결재·구단주
  s('M_approvals', 'M', '결재 처리', 'cumulative', [50, 100, 500, 1000, 5000], '결재 승인·반려 누적(건)'),
  s('M_novacancy', 'M', '팀장 공석 0 유지', 'cumulative', [1, 3, 5], '정규시즌 마지막 날 팀장 공석 0인 시즌'),
  s('M_hire', 'M', '직원 채용', 'cumulative', [10, 25, 50], '직원 채용(명)', { inactive: '채용 이력 기록 없음' }),
  one('M_tenure3', 'M', '팀장 전원 3년 근속', 'once', 3, '팀장 전원 3년 이상 근속', { inactive: '직원 근속 기록 없음' }),
  s('M_level', 'M', '구단주 레벨', 'once', [5, 10, 15, 20], '구단주 레벨 도달'),
  s('M_seasons', 'M', '재임 시즌', 'once', [5, 10, 20, 30], '구단주 재임 시즌 합(정규시즌 종료 기준)'),
  one('M_escape', 'M', '해임 위기 탈출', 'once', 3, '성적 목표 연속 미달 경고 뒤 해제'),
  one('M_rebuildPs', 'M', '리빌딩 완성', 'once', 3, '리빌딩 선언 뒤 3시즌 안에 가을야구'),
  one('M_hardTitle', 'M', '어려운 구단 우승', 'once', 5, '어려움 이상 난이도 구단으로 한국시리즈 우승'),
  one('M_otherTitle', 'M', '두 번째 구단 우승', 'once', 4, '해임 뒤 다른 구단에서 한국시리즈 우승'),
  // ②(27 1.1, D-237): 구단 서사 — 구단주로 맞은 구단 스토리 결말 수, 성공 결말 수
  s('M_story', 'M', '구단 서사', 'cumulative', [1, 2, 3], '구단주로 맞은 구단 스토리 결말(결말마다)'),
  one('M_storyGood', 'M', '해피 엔딩', 'once', 3, '구단주로 구단 스토리 성공 결말'),
  s('M_interview', 'M', '인터뷰·면담 응대', 'cumulative', [10, 50, 100], '언론 인터뷰·면담(건)', { inactive: '인터뷰·면담 기능 없음' }),
  // M-2 구단주 행동·메타
  s('M2_ap', 'M', '행동력 누적 사용', 'cumulative', [100, 500, 1000, 5000], '재임 중 쓴 행동력'),
  s('M2_full', 'M', '행동력 전부 쓴 주', 'cumulative', [10, 50, 100], '받은 행동력을 모두 쓴 주'),
  s('M2_zero', 'M', '완전 위임 주', 'cumulative', [10, 50], '행동력을 하나도 쓰지 않고 넘긴 주'),
  s('M2_chairman', 'M', '회장님 경영', 'season', [1, 2, 3], '전 팀 위임으로 시즌 완주 · 가을야구 · 우승', { inactive: '위임 상태 시즌 기록 없음', labels: ['완주', '가을야구', '우승'] }),
  one('M2_micro', 'M', '마이크로매니저', 'season', 2, '시즌 중 위임 없이 모든 행동 직접', { inactive: '위임 상태 시즌 기록 없음' }),
  s('M2_directFa', 'M', '직접 협상 FA 성사', 'cumulative', [1, 10, 25], '직접 협상 FA 계약(건)', { inactive: '제안 기록에 직접·위임 구분 없음' }),
  s('M2_oneRound', 'M', '한 번에 성사', 'cumulative', [1, 5], '첫 제안 한 번으로 FA 계약 성사(건)'),
  s('M2_scout', 'M', '직접 선수 조사', 'cumulative', [50, 200, 500], '직접 선수 조사(회)'),
  s('M2_dispatch', 'M', '대회 파견', 'cumulative', [10, 25, 50], '직접 대회 파견(회)', { inactive: '대회 파견 기능 없음' }),
  s('M2_draftScout', 'M', '발굴한 아마추어', 'cumulative', [1, 2], '직접 조사한 아마추어 지명 → 정착 · 타이틀', { inactive: '아마추어 직접 조사 기록 연결 없음' }),
  s('M2_trainTitle', 'M', '집중 훈련의 결실', 'cumulative', [1, 3], '개인 집중 훈련 지정 선수 타이틀(명)', { inactive: '훈련 지정 이력 기록 없음' }),
  s('M2_medical', 'M', '부상 조기 발견', 'cumulative', [5, 20], '특별 검사로 부상 조기 발견(건)', { inactive: '조기 발견 판정 기록 없음' }),
  s('M2_camp', 'M', '캠프 직접 지휘', 'cumulative', [3, 5, 10], '캠프 직접 지휘(회)', { inactive: '캠프 지휘 기능 없음' }),
  s('M2_talks', 'M', '선수·직원 면담', 'cumulative', [50, 100, 300], '면담(건)', { inactive: '면담 기능 없음' }),
  s('M2_reject', 'M', '깐깐한 구단주', 'cumulative', [10, 50], '결재 반려(건)'),
  one('M2_allHire', 'M', '팀장 전원 직접 채용', 'once', 3, '팀장 전원을 직접 채용', { inactive: '채용 이력 기록 없음' }),
  one('M2_policy', 'M', '일관된 정책', 'once', 3, '팀 정책 변경 없이 3시즌', { inactive: '정책 변경 이력 없음' }),
  s('M2_budget', 'M', '예산 안에서 시즌 완주', 'cumulative', [1, 3, 5], '정규시즌 마지막 날 재량 지출·연봉 총액이 예산 한도 안인 시즌'),

  s('M2_allstarHost', 'M', '올스타전 유치', 'cumulative', [1, 3], '올스타전 유치 성공(회)'),
  s('M2_allstarVote', 'M', '투표 캠페인 베스트 12', 'cumulative', [1, 5], '올스타 투표 캠페인으로 베스트 12(명)'),
  s('M2_loyal', 'M', '의리', 'cumulative', [1, 3], '다른 구단 영입 제안 거절(회)', { inactive: '재임 중 영입 제안 기능 없음(해임 뒤 제안만)' }),
  one('M2_rebuildTitle', 'M', '리빌딩 끝 우승', 'once', 5, '리빌딩 선언 뒤 5시즌 안에 한국시리즈 우승'),
  one('M2_dynasty2', 'M', '두 번째 왕조', 'once', 4, '우승 간격 5시즌 이상으로 다시 우승'),
  one('M2_threeClubs', 'M', '세 구단 가을야구', 'once', 3, '서로 다른 세 구단에서 가을야구'),
  one('M2_hard10', 'M', '어려운 구단 10시즌', 'once', 4, '어려움 이상 난이도 구단에서 10시즌 재임'),
  one('M2_lv20in7', 'M', '초고속 성장', 'once', 4, '재임 7시즌 안에 레벨 20'),
  one('M2_noWarn', 'M', '흔들림 없는 10년', 'once', 4, '재임 10시즌 동안 해임 경고 0'),
  one('M2_50', 'M', '재임 50시즌', 'once', 5, '구단주 재임 50시즌'),
  s('M2_farewell', 'M', '간판 은퇴 경기', 'cumulative', [1, 3], '간판 선수 은퇴 경기 개최(명)', { inactive: '은퇴 경기 기능 없음' }),
  one('M2_allround', 'M', '올라운더', 'once', 4, 'A~O 모든 분류에서 1개 이상 달성(비활성만 있는 분류 제외)'),
  s('M2_rate', 'M', '전체 업적 달성률', 'once', [25, 50, 75, 100], '활성 업적(P·Q 제외) 달성률(%)', { labels: ['25%', '50%', '75%', '100%'] }),
  s('M2_golden', 'M', '황금 시즌', 'season', [10, 20], '한 시즌 시즌형 업적 수'),
  s('M2_collector', 'M', '진기록 수집가', 'cumulative', [5, 15, 30], 'P 분류 달성(개)'),
  one('M2_overcome', 'M', '흑역사 극복', 'once', 4, '최하위·90패·승률 .350 이하 뒤 2시즌 안에 가을야구'),
  // N 구단 역사·기록 경신
  s('N_records', 'N', '구단 단일 시즌 기록', 'cumulative', [1, 5, 10, 20], '재임 중 세운 구단 단일 시즌 기록(부문)'),
  s('N_legend', 'N', '레전드 추월', 'cumulative', [1, 3, 5], '구단 통산 1위 등극(부문)', { inactive: '레전드 통산 비교 기능 없음' }),
  one('N_mostW', 'N', '창단 이래 최다승', 'once', 3, '구단 역사(실제 역사 포함) 최다승 시즌'),
  one('N_bestPct', 'N', '창단 이래 최고 승률', 'once', 3, '구단 역사(실제 역사 포함) 최고 승률 시즌'),
  one('N_teamHr', 'N', '창단 이래 최다 팀 홈런', 'once', 3, '구단 역사 최다 팀 홈런', { inactive: '실제 구단 시즌 팀 홈런 자료 없음' }),
  one('N_firstTitle', 'N', '구단 최초 우승', 'once', 5, '구단 역사(실제 역사 포함) 첫 한국시리즈 우승'),
  s('N_hof', 'N', '레전드 헌액', 'cumulative', [1, 3, 5], '레전드 헌액·영구결번(명)', { inactive: '헌액 기능 없음' }),
  // O 수상(우리 구단 수상)
  s('O_titles', 'O', '타이틀 홀더', 'cumulative', [1, 5, 10, 25], '우리 구단 타이틀(개)'),
  one('O_sweepBat', 'O', '타자 타이틀 독식', 'season', 3, '한 시즌 타자 타이틀 8개 중 4개 이상'),
  one('O_sweepPit', 'O', '투수 타이틀 독식', 'season', 3, '한 시즌 투수 타이틀 6개 중 3개 이상'),
  one('O_sweepAll', 'O', '타이틀 싹쓸이', 'season', 5, '한 시즌 타이틀 14개 중 8개 이상'),
  s('O_gg', 'O', '골든글러브', 'cumulative', [1, 5, 10, 25], '우리 구단 골든글러브(명)'),
  s('O_ggSeason', 'O', '한 시즌 골든글러브', 'season', [3, 5, 7], '한 시즌 우리 구단 골든글러브(명)'),
  s('O_mvp', 'O', '정규시즌 MVP', 'cumulative', [1, 3], '우리 구단 MVP(회)'),
  s('O_roy', 'O', '신인왕', 'cumulative', [1, 3, 5], '우리 구단 신인왕(회)'),
  s('O_ksmvp', 'O', '한국시리즈 MVP', 'cumulative', [1, 3], '우리 구단 한국시리즈 MVP(회)'),
  one('O_mvpRoy', 'O', 'MVP·신인왕 동시', 'season', 3, '한 시즌 MVP와 신인왕 동시 배출'),
  s('O_mvpRepeat', 'O', 'MVP 연속 수상', 'once', [2, 3], '같은 선수 MVP 연속 수상'),
  s('O_defense', 'O', '수비상', 'cumulative', [1, 5, 10, 25], '우리 구단 수비상(명)'),
  s('O_platinum', 'O', '플래티넘 글러브', 'cumulative', [1, 3], '우리 구단 플래티넘 글러브(회)'),
  s('O_pitcher', 'O', '최우수 투수', 'cumulative', [1, 3, 5], '우리 구단 최우수 투수(회)'),
  s('O_reliever', 'O', '최우수 구원 투수', 'cumulative', [1, 3, 5], '우리 구단 최우수 구원 투수(회)'),
  s('O_comeback', 'O', '재기상', 'cumulative', [1, 3], '우리 구단 재기상(회)'),
  s('O_manager', 'O', '감독상', 'cumulative', [1, 3], '우리 감독 감독상(회)'),
  s('O_front', 'O', '올해의 프런트', 'cumulative', [1, 3, 5], '우리 구단 올해의 프런트(회)', { tiers: [4, 4, 4] }),
  s('O_best', 'O', '베스트 팀 선정', 'cumulative', [1, 5, 15, 30], '우리 선수 베스트 팀 선정(명)'),
  s('O_best1Season', 'O', '한 시즌 베스트 1팀', 'season', [3, 5, 8], '한 시즌 베스트 1팀 우리 선수(명)'),
  s('O_monthly', 'O', '월간 시상', 'cumulative', [1, 10, 25, 50], '우리 선수 월간 MVP·월간 신인(회)'),
  s('O_monthlyRepeat', 'O', '월간 MVP 연속', 'once', [2, 3], '같은 선수 월간 MVP 연속(개월)'),
  s('O_milestone', 'O', '기록 달성상', 'cumulative', [1, 5, 10], '우리 선수 기록 달성상(회)'),
  s('O_popular', 'O', '인기상', 'cumulative', [1, 3], '인기상(회)', { inactive: '인기 지표 구현 전' }),
  one('O_grand', 'O', '그랜드슬램', 'season', 5, '한 시즌 MVP·최우수 투수·신인왕·감독상·올해의 프런트 모두 우리 구단'),
  s('O_allstar', 'O', '올스타 선정', 'cumulative', [1, 5, 10, 25], '올스타 선정(명)'),
  s('O_allstarSeason', 'O', '한 시즌 올스타', 'season', [3, 5, 7], '한 시즌 올스타 선정(명)'),
  s('O_best12', 'O', '베스트 12 투표 1위', 'cumulative', [1, 5, 10], '베스트 12 포지션 1위(명)'),
  s('O_topVote', 'O', '올스타 최다 득표', 'cumulative', [1, 3], '올스타 팬 투표 최다 득표(회)'),
  s('O_mrAllstar', 'O', '미스터 올스타', 'cumulative', [1, 3], '미스터 올스타(회)'),
  s('O_hrRace', 'O', '홈런 레이스 우승', 'cumulative', [1, 3], '홈런 레이스 우승(회)'),
  s('O_allstarRun', 'O', '올스타 연속 선정', 'once', [5, 10], '같은 선수 올스타 연속 선정(회)'),
  s('O_allstarHr', 'O', '올스타전 홈런', 'cumulative', [1, 5], '올스타전 우리 선수 홈런(개)'),
  s('O_allstarHome', 'O', '올스타전 홈구장 개최', 'cumulative', [1, 3], '올스타전 홈구장 개최(회)'),
  // ───── 8d(D-186) P 진기록(숨김, 1단계 경험치 기본) ─────
  s('P_bigInning', 'P', '빅이닝', 'once', [7, 10, 13], '한 이닝 우리 팀 득점', { tiers: [1, 1, 1] }),
  one('P_batAround', 'P', '타자 일순', 'once', 1, '한 이닝 우리 타자 10명 이상 타석'),
  s('P_b2b', 'P', '연속 타자 홈런', 'once', [2, 3, 4], '우리 타자 연속 홈런(명)', { tiers: [1, 1, 1] }),
  s('P_hrRun', 'P', '연타석 홈런', 'once', [3, 4], '한 선수 연속 타석 홈런(경기 걸침 허용)', { tiers: [1, 1] }),
  one('P_inning2hr', 'P', '한 이닝 2홈런', 'once', 3, '한 선수가 한 이닝에 홈런 2개'),
  one('P_woHR', 'P', '끝내기 홈런', 'once', 2, '끝내기 홈런'),
  one('P_woGS', 'P', '끝내기 만루홈런', 'once', 4, '끝내기 만루홈런'),
  one('P_woGSc', 'P', '역전 끝내기 만루홈런', 'once', 5, '지고 있다가 끝내기 만루홈런'),
  one('P_woWalk', 'P', '밀어내기 끝내기', 'once', 1, '끝내기 볼넷·몸에 맞는 공'),
  s('P_9th2out', 'P', '9회 2아웃 역전승', 'season', [1, 3], '9회 이후 2아웃에서 뒤지다가 이긴 경기(시즌)', { tiers: [1, 1] }),
  s('P_1to0', 'P', '1-0 승리', 'season', [3, 5], '1-0 승리(시즌)', { tiers: [1, 1] }),
  one('P_15inn', 'P', '연장 15회 승리', 'once', 1, '15회까지 간 경기 승리'),
  one('P_allHit', 'P', '선발 전원 안타', 'once', 1, '선발 타자 9명 모두 안타'),
  one('P_allRun', 'P', '선발 전원 득점', 'once', 1, '선발 타자 9명 모두 득점'),
  one('P_teamSB5', 'P', '한 경기 팀 도루 5개', 'once', 1, '한 경기 우리 팀 도루 5개'),
  s('P_indivSB', 'P', '한 경기 개인 도루', 'once', [3, 4], '한 선수 한 경기 도루', { tiers: [1, 2] }),
  one('P_homeSteal', 'P', '홈스틸', 'once', 3, '홈스틸 성공', { inactive: '주루 모델에 홈스틸 시도 없음' }),
  one('P_tp', 'P', '수비 삼중살', 'once', 3, '우리 수비 삼중살'),
  one('P_utp', 'P', '무보살 삼중살', 'once', 5, '무보살 삼중살', { inactive: '수비 기록이 한 사람 삼중살을 만들지 않음' }),
  one('P_dp4', 'P', '한 경기 병살 4개', 'once', 1, '한 경기 우리 수비 병살 4개'),
  one('P_noBBsho', 'P', '무4사구 완봉', 'once', 3, '볼넷·몸에 맞는 공 없는 완봉승'),
  one('P_maddux', 'P', '매덕스', 'once', 4, '100구 이하 완봉승'),
  s('P_qsRun', 'P', '선발 연속 QS', 'once', [10, 15, 20], '우리 선발 투수 연속 퀄리티 스타트', { tiers: [1, 1, 1] }),
  one('P_debutHR', 'P', '데뷔 첫 타석 홈런', 'once', 3, '1군 첫 경기 첫 타석 홈런'),
  one('P_debutWin', 'P', '데뷔전 승리 투수', 'once', 3, '1군 첫 경기 승리 투수'),
  one('P_debutK', 'P', '데뷔전 10탈삼진', 'once', 3, '1군 첫 경기 10탈삼진'),
  one('P_age40', 'P', '불혹의 활약', 'once', 3, '만 40세 이상 20홈런·10승·20세이브(시즌 종료)'),
  one('P_swing', 'P', '스윙맨', 'once', 1, '같은 시즌 10승-10세이브 또는 10승-20홀드'),
  one('P_noErr', 'P', '무실책 시즌', 'once', 3, '규정 타석·포지션 720이닝 무실책(포수·1루수 제외)'),
  one('P_cs50', 'P', '강견 포수', 'once', 3, '도루 시도 40회 이상 저지율 50% 이상'),
  s('P_ofA', 'P', '외야 보살', 'once', [10, 15], '외야수 시즌 보살', { tiers: [1, 1] }),
  s('P_hbp', 'P', '몸에 맞는 공', 'once', [20, 25], '타자 시즌 몸에 맞는 공', { tiers: [1, 1] }),
  s('P_ibb', 'P', '가장 피하고 싶은 타자', 'once', [10, 15], '타자 시즌 고의4구', { tiers: [1, 1] }),
  s('P_sh', 'P', '희생번트 장인', 'once', [25, 35], '타자 시즌 희생번트', { tiers: [1, 1] }),
  s('P_obRun', 'P', '연속 타석 출루', 'once', [10, 12], '한 선수 연속 타석 출루', { tiers: [1, 1] }),
  one('P_wo3', 'P', '끝내기 사나이', 'once', 3, '한 시즌 같은 선수 끝내기 3회'),
  one('P_3pos', 'P', '한 경기 3포지션', 'once', 1, '한 선수 한 경기 3포지션 수비'),
  one('P_7pos', 'P', '만능 야수', 'once', 1, '한 시즌 투수·포수 외 7포지션 모두 수비'),
  one('P_16_0', 'P', '16전 전승', 'season', 4, '같은 상대 시즌 전승(16경기 이상)'),
  s('P_ties', 'P', '무승부 시즌', 'season', [8, 10], '시즌 무승부', { tiers: [1, 1] }),
  one('P_lowHits', 'P', '투수전 승리', 'once', 1, '양 팀 합계 안타 2개 이하 경기 승리'),
  one('P_30runs', 'P', '난타전 승리', 'once', 1, '양 팀 합계 30득점 경기 승리'),
  one('P_revenge', 'P', '복수전', 'once', 1, '영봉패 다음 경기 15득점'),
  one('P_10hr', 'P', '홈런 축제', 'once', 1, '한 경기 양 팀 홈런 10개'),
  one('P_hanmandu', 'P', '한만두', 'once', 5, '한 이닝 우리 팀 만루홈런 2개'),
  one('P_2gs', 'P', '한 경기 만루홈런 2개', 'once', 5, '한 선수 한 경기 만루홈런 2개'),
  one('P_gsRun', 'P', '연타석 만루홈런', 'once', 5, '한 선수 연속 타석 만루홈런'),
  s('P_gsIndiv', 'P', '만루홈런 시즌(개인)', 'once', [3, 4, 5], '한 선수 시즌 만루홈런', { tiers: [1, 1, 1] }),
  s('P_gsTeam', 'P', '만루홈런 시즌(팀)', 'season', [8, 12], '팀 시즌 만루홈런', { tiers: [1, 1] }),
  one('P_gs3', 'P', '한 경기 팀 만루홈런 3개', 'once', 5, '한 경기 우리 팀 만루홈런 3개'),
  s('P_leadHR', 'P', '선두타자 홈런', 'once', [8, 12], '한 선수 시즌 경기 첫 타석 홈런', { tiers: [1, 1] }),
  one('P_natCycle', 'P', '내추럴 사이클', 'once', 4, '단타→2루타→3루타→홈런 순서'),
  one('P_6for6', 'P', '6타수 6안타', 'once', 4, '한 경기 6타수 6안타'),
  one('P_two5', 'P', '5안타 타자 2명', 'once', 1, '한 경기 5안타 타자 2명'),
  one('P_everyInn', 'P', '전 이닝 득점', 'once', 4, '1~8회 매 이닝 득점'),
  one('P_by20', 'P', '20점 차 승리', 'once', 1, '20점 차 이상 승리'),
  one('P_20to0', 'P', '20-0', 'once', 1, '20점 이상 영봉승'),
  one('P_9th7', 'P', '9회 7점 차 역전승', 'once', 4, '9회 공격 시작 때 7점 이상 뒤지다 승리'),
  one('P_noHitWin', 'P', '무안타 승리', 'once', 5, '팀 안타 0개로 승리'),
  one('P_noHitLoss', 'P', '노히트 패배', 'once', 1, '상대에게 안타 0개를 주고 패배'),
  one('P_6hrLoss', 'P', '6홈런 패배', 'once', 1, '팀 홈런 6개 이상 친 경기 패배'),
  one('P_20hLoss', 'P', '20안타 패배', 'once', 1, '팀 20안타 경기 패배'),
  one('P_woTP', 'P', '끝내기 삼중살', 'once', 3, '수비 삼중살로 경기 종료(승리)'),
  one('P_woDP', 'P', '끝내기 병살', 'once', 1, '수비 병살로 경기 종료(승리)'),
  one('P_woSF', 'P', '끝내기 희생플라이', 'once', 1, '끝내기 희생플라이'),
  one('P_woInf', 'P', '끝내기 내야 안타', 'once', 1, '끝내기 내야 안타'),
  one('P_woSqz', 'P', '끝내기 스퀴즈', 'once', 1, '끝내기 스퀴즈'),
  one('P_phWoHR', 'P', '대타 끝내기 홈런', 'once', 3, '대타 끝내기 홈런'),
  one('P_phGS', 'P', '대타 만루홈런', 'once', 3, '대타 만루홈런'),
  s('P_phHR', 'P', '대타 홈런 시즌', 'once', [3, 5], '한 선수 시즌 대타 홈런', { tiers: [1, 1] }),
  s('P_oneRun', 'P', '1점 차 승부사', 'season', [25, 30], '1점 차 승리(시즌)', { tiers: [1, 1] }),
  one('P_extraUnb', 'P', '연장 무패', 'season', 1, '연장 5경기 이상 연장 패배 0(시즌)'),
  s('P_openRun', 'P', '개막 연승', 'season', [5, 8, 10], '개막 뒤 연승(시즌)', { tiers: [1, 1, 1] }),
  one('P_wire', 'P', '와이어 투 와이어', 'season', 5, '개막일부터 마지막 날까지 단독 1위'),
  s('P_clinch', 'P', '조기 1위 확정', 'season', [10, 15, 20], '정규시즌 N경기 남기고 1위 확정', { tiers: [1, 1, 1] }),
  s('P_turn', 'P', '후반기 대역전', 'season', [1, 2], '전반기 8위 이하 → 정규시즌 1위 · 한국시리즈 우승', { labels: ['정규시즌 1위', '우승'], tiers: [1, 1] }),
  s('P_roadPct', 'P', '원정 승률', 'season', [0.6, 0.65], '원정 승률', { labels: ['.600', '.650'], tiers: [1, 1] }),
  s('P_relZero', 'P', '불펜 연속 무실점', 'once', [20, 30, 40], '구원 투수 연속 경기 무실점', { tiers: [1, 1, 1] }),
  s('P_svRun', 'P', '연속 세이브', 'once', [20, 30, 40], '블론 없는 연속 세이브', { tiers: [1, 1, 1] }),
  one('P_noBlown', 'P', '완벽한 마무리', 'season', 4, '20세이브 이상 블론세이브 0'),
  one('P_5sp10', 'P', '10승 선발 5명', 'season', 4, '선발 5명 모두 10승'),
  one('P_5sp30', 'P', '완벽한 마운드', 'season', 5, '선발 5명 10승 + 마무리 30세이브'),
  one('P_hr20x5', 'P', '20홈런 타자 5명', 'season', 1, '같은 시즌 20홈런 타자 5명'),
  one('P_hr30x3', 'P', '30홈런 타자 3명', 'season', 1, '같은 시즌 30홈런 타자 3명'),
  s('P_300s', 'P', '3할 타선', 'season', [4, 5], '규정 3할 타자 수', { tiers: [1, 1] }),
  one('P_teamTriple', 'P', '팀 트리플 크라운', 'season', 5, '팀 타율·홈런·평균자책 리그 1위'),
  s('P_batCrown', 'P', '타격 다관왕', 'once', [5, 7], '한 선수 타자 타이틀 수', { tiers: [4, 5] }),
  one('P_pitCrown', 'P', '투수 4관왕', 'once', 5, '한 선수 투수 타이틀 4개'),
  one('P_lead30', 'P', '1번 타자 30홈런', 'once', 3, '주로 1번 타자로 나선 선수 30홈런'),
  one('P_c20', 'P', '공격형 포수', 'once', 3, '포수 20홈런·규정 3할'),
  one('P_ss30', 'P', '거포 유격수', 'once', 3, '유격수 30홈런'),
  one('P_age20', 'P', '스무 살의 활약', 'once', 3, '만 20세 이하 10승 또는 20홈런'),
  one('P_royGG', 'P', '신인 골든글러브', 'once', 4, '같은 시즌 신인왕과 골든글러브'),
  one('P_fMVP', 'P', '외국인 MVP', 'once', 1, '우리 외국인 선수 MVP'),
  one('P_dom20', 'P', '국내 20승 투수', 'once', 1, '국내 투수 20승'),
  s('P_run300', 'P', '연속 시즌 3할', 'once', [5, 7, 10], '우리 구단 소속 연속 시즌 규정 3할', { tiers: [1, 1, 1] }),
  s('P_run10w', 'P', '연속 시즌 10승', 'once', [5, 7, 10], '우리 구단 소속 연속 시즌 10승', { tiers: [1, 1, 1] }),
  s('P_run100h', 'P', '연속 시즌 100안타', 'once', [7, 10, 15], '우리 구단 소속 연속 시즌 100안타', { tiers: [1, 1, 1] }),
  s('P_iron', 'P', '철인', 'once', [500, 1000], '우리 구단 연속 경기 출전', { tiers: [1, 1] }),
  one('P_up5', 'P', '5시즌 연속 승수 증가', 'once', 3, '재임 중 5시즌 연속 승수 증가'),
  s('P_clubWins', 'P', '구단 통산 승', 'once', [1000, 2000, 3000], '구단 통산 승(실제 역사 포함, 재임 중 도달)', { tiers: [1, 1, 1] }),
  // ───── 8d(D-186) Q 실수·불명예(숨김, 경험치 0) ─────
  s('Q_err', 'Q', '한 경기 팀 실책', 'once', [4, 5, 6], '한 경기 우리 팀 실책'),
  one('Q_err3', 'Q', '개인 한 경기 3실책', 'once', 1, '한 선수 한 경기 실책 3개'),
  one('Q_woErr', 'Q', '끝내기 실책 패', 'once', 1, '상대 끝내기가 우리 실책으로'),
  one('Q_woWP', 'Q', '끝내기 폭투 패', 'once', 1, '끝내기 폭투로 패배'),
  one('Q_woBK', 'Q', '끝내기 보크 패', 'once', 1, '끝내기 보크로 패배'),
  one('Q_woWalk', 'Q', '밀어내기 끝내기 패', 'once', 1, '밀어내기로 끝내기 패배'),
  s('Q_seasonErr', 'Q', '시즌 팀 실책', 'season', [110, 130], '시즌 팀 실책'),
  one('Q_errMost', 'Q', '리그 최다 실책', 'season', 1, '시즌 팀 실책 리그 최다'),
  s('Q_lossRun', 'Q', '연패', 'once', [7, 10, 15], '팀 연패'),
  s('Q_runsA', 'Q', '한 경기 실점', 'once', [15, 20, 25], '한 경기 실점'),
  one('Q_innA', 'Q', '한 이닝 10실점', 'once', 1, '한 이닝 10실점'),
  s('Q_blownLead', 'Q', '리드 날린 역전패', 'once', [7, 10], '가장 크게 앞섰던 점수 차를 뒤집힌 패배'),
  one('Q_9th2out', 'Q', '9회 2아웃 역전패', 'once', 1, '9회 이후 2아웃에서 앞서다 패배'),
  one('Q_woGS', 'Q', '끝내기 만루홈런 패', 'once', 1, '끝내기 만루홈런을 맞고 패배'),
  one('Q_noHit', 'Q', '노히트 노런 당함', 'once', 1, '안타 0개로 패배'),
  one('Q_perfect', 'Q', '퍼펙트 당함', 'once', 1, '한 명도 출루하지 못하고 패배'),
  s('Q_k', 'Q', '한 경기 팀 삼진', 'once', [15, 18], '한 경기 우리 타자 삼진'),
  s('Q_gdp', 'Q', '한 경기 병살타', 'once', [4, 5], '한 경기 우리 병살타'),
  one('Q_lob', 'Q', '잔루 15개', 'once', 1, '한 경기 잔루 15개 이상', { inactive: '잔루 기록 없음' }),
  one('Q_bb12', 'Q', '4사구 12개', 'once', 1, '한 경기 투수진 볼넷·몸에 맞는 공 12개 이상'),
  s('Q_losses', 'Q', '시즌 패', 'season', [90, 100], '시즌 패'),
  s('Q_pct', 'Q', '시즌 승률', 'season', [0.35, 0.3], '시즌 승률 이하', { lower: true, labels: ['.350', '.300'] }),
  s('Q_last', 'Q', '최하위', 'season', [1, 2, 3], '연속 최하위 시즌'),
  one('Q_fall', 'Q', '꼴찌 추락', 'season', 1, '전 시즌 가을야구 → 10위'),
  one('Q_mendoza', 'Q', '멘도사 라인', 'season', 1, '규정 타석 타율 .200 이하'),
  one('Q_era7', 'Q', '평균자책 7점대', 'season', 1, '규정 이닝 평균자책 7.00 이상'),
  one('Q_0and10', 'Q', '0승 10패', 'season', 1, '선발 투수 0승 10패'),
  s('Q_so', 'Q', '삼진왕(불명예)', 'season', [150, 180], '타자 시즌 삼진'),
  one('Q_cs15', 'Q', '도루 실패 15개', 'season', 1, '타자 시즌 도루 실패 15개'),
  one('Q_sb50', 'Q', '도루 성공률 50% 미만', 'season', 1, '도루 시도 10회 이상 성공률 50% 미만'),
  one('Q_gdp25', 'Q', '병살타 25개', 'season', 1, '타자 시즌 병살타 25개'),
  one('Q_wp20', 'Q', '폭투 20개', 'season', 1, '투수 시즌 폭투 20개'),
  one('Q_noHR', 'Q', '무홈런 거포 포지션', 'season', 1, '1루·지명·좌우익수 규정 타석 무홈런'),
  one('Q_relStar', 'Q', '놓친 대어', 'once', 1, '방출한 선수가 그 시즌 다른 구단에서 타이틀·골든글러브·MVP'),
  one('Q_tradeStar', 'Q', '트레이드 후회', 'once', 1, '트레이드로 내준 선수가 다음 시즌 타이틀·MVP'),
  one('Q_tradeBust', 'Q', '받은 선수 미출전', 'once', 1, '트레이드로 받은 선수가 그 시즌 1군 미출전'),
  one('Q_faBust', 'Q', 'FA 먹튀', 'once', 1, '3년 이상 FA 영입 첫 시즌 규정 미달·타율 .230 이하·평균자책 6.00 이상'),

  one('Q_draftRel', 'Q', '1라운드 지명 방출', 'once', 1, '1라운드 지명 선수 1군 데뷔 없이 방출'),
  one('Q_posting', 'Q', '포스팅 무응찰', 'once', 1, '포스팅에 동의했지만 무산'),
  s('Q_capPenalty', 'Q', '샐러리캡 제재', 'once', [1, 2], '샐러리캡 초과 제재', { inactive: '샐러리캡 제재 기능 없음' }),
  s('Q_emergency', 'Q', '긴급 지원 요청', 'once', [1, 3], '모기업 긴급 지원'),
  one('Q_crisis', 'Q', '자금 위기', 'once', 1, '현금 0 미만 위기 상태'),
  one('Q_brink', 'Q', '파산 직전', 'once', 1, '현금 마이너스 4주'),
  one('Q_warn', 'Q', '해임 경고', 'once', 1, '성적 목표 연속 미달 경고'),
  one('Q_backlash', 'Q', '팬 반발', 'once', 1, '팬 반발 상태 돌입'),
  one('Q_vacancy', 'Q', '공석 방치', 'once', 1, '팀장 공석 8주 이상'),
  one('Q_facility', 'Q', '낡은 구장', 'once', 1, '시설 상태 30 미만 개막·고장 좌석 폐쇄', { inactive: '시설 노후도 기능 없음' }),
  s('Q_disposal', 'Q', '굿즈 폐기', 'season', [30, 50], '굿즈 재고 폐기율(%)', { inactive: '재고 폐기 기능 없음' }),
  one('Q_sponsorCut', 'Q', '스폰서 해지', 'once', 1, '의무 불이행 스폰서 해지', { inactive: '스폰서 해지 기능 없음' }),
  one('Q_persuadeFail', 'Q', '간판의 은퇴', 'once', 1, '간판 선수가 재임 중 은퇴'),
  s('Q_expired', 'Q', '결재 기한 만료', 'once', [5, 20], '결재 기한 만료(건)'),
  s('Q_openLoss', 'Q', '개막 연패', 'season', [5, 8, 10], '개막 뒤 연패(시즌)'),
  s('Q_homeLoss', 'Q', '홈 연패', 'once', [7, 10], '홈 경기 연패'),
  one('Q_0_16', 'Q', '0-16', 'season', 1, '같은 상대 시즌 전패(16경기 이상)'),
  s('Q_blown', 'Q', '불지르는 마무리', 'season', [8, 12], '한 투수 시즌 블론세이브'),
  one('Q_oneRunL', 'Q', '1점 차 25패', 'season', 1, '1점 차 패배 25(시즌)'),
  one('Q_collapse', 'Q', '후반기 추락', 'season', 1, '전반기 1위 → 가을야구 탈락'),
  one('Q_allK', 'Q', '선발 전원 삼진', 'once', 1, '선발 타자 9명 모두 삼진'),
  one('Q_1stExit', 'Q', '1회 강판 5회', 'season', 1, '선발 투수 1회 강판 시즌 5회'),
  one('Q_injury5', 'Q', '부상 병동', 'season', 1, '주전 30일 이상 부상 5명', { inactive: '주전 판정 기준 없음' }),
  one('Q_champLast', 'Q', '우승 다음 해 꼴찌', 'season', 1, '우승 다음 시즌 최하위'),
  one('Q_topPaid', 'Q', '최고 연봉 부진', 'season', 1, '최고 연봉 선수 규정 미달'),
  s('Q_apWaste', 'Q', '행동력 소멸', 'once', [100, 500], '쓰지 않고 넘긴 행동력 누적'),
  // EV-4(D-210 (9)): 중대 사건
  s('Q_scandal', 'Q', '중대 사건', 'cumulative', [1, 3], '우리 선수 중대 사건이 사실로 확인(건)'),
  one('Q_coverup', 'Q', '은폐 발각', 'once', 1, '구단이 숨긴 사건이 드러남'),
  one('Q_lowLevel', 'Q', '느린 성장', 'once', 1, '재임 10시즌 레벨 10 미만'),
];

/** 화면·기록용 업적 정의(단계마다 하나) */
export interface AchievementDef {
  key: string;
  series: string;
  seriesTitle: string;
  stage: number;
  stageLabel: string;
  title: string;
  category: string;
  description: string;
  xp: number;
  /** 시즌형(시즌마다 다시 달성, 두 번째부터 경험치 절반) */
  repeat: boolean;
  type: AchievementType;
  /** 비활성 사유(판정하지 않음) */
  inactive: string | null;
  /** 분류 글자(A~Q) */
  cat: string;
}

const stageLabel = (sd: SeriesDef, i: number) => sd.labels?.[i] ?? String(sd.stages[i]);
export const ACHIEVEMENTS: readonly AchievementDef[] = SERIES.flatMap((sd) =>
  sd.stages.map((_, i) => {
    // P는 기본 1단계(D-186 (1)), Q는 경험치 0
    const tier = sd.tiers?.[i] ?? (sd.cat === 'P' ? 1 : i + 1);
    const label = stageLabel(sd, i);
    return {
      key: `${sd.id}.${i + 1}`,
      series: sd.id,
      seriesTitle: sd.title,
      stage: i + 1,
      stageLabel: label,
      title: label ? `${sd.title} ${label}` : sd.title,
      category: CATEGORY_LABEL[sd.cat] ?? sd.cat,
      description: sd.desc,
      xp: sd.cat === 'Q' ? 0 : (X.byTier[tier - 1] ?? X.byTier[0]!),
      repeat: sd.type === 'season',
      type: sd.type,
      inactive: sd.inactive ?? null,
      cat: sd.cat,
    };
  }),
);
const DEF = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
const SER = new Map(SERIES.map((x) => [x.id, x]));

/** KBO 규정 타석: 경기 수 × 3.1 */
export const QUALIFY_PA_PER_GAME = 3.1;

const HIT = new Set(['1B', '2B', '3B', 'HR']);
const ON_BASE = new Set(['1B', '2B', '3B', 'HR', 'BB', 'HBP']);
const r3 = (n: number) => n.toFixed(3).replace(/^0/, '');

/** 경기한 날 쌓는 상태(D-182 (3)): 시즌별 누적 수, 투수 연속 상태 */
interface AchState {
  season: number;
  walkoff: number;
  extra: number;
  shutout: number;
  sweep: number;
  cg: Record<string, number>;
  sho: Record<string, number>;
  zero: Record<string, number>;
  swin: Record<string, number>;
  /** 연승·홈 연승·연속 위닝 시리즈, 진행 중 시리즈 */
  streak: number;
  homeStreak: number;
  seriesRun: number;
  cur: { id: number; w: number; l: number; n: number } | null;
}
const newState = (season: number): AchState => ({ season, walkoff: 0, extra: 0, shutout: 0, sweep: 0, cg: {}, sho: {}, zero: {}, swin: {}, streak: 0, homeStreak: 0, seriesRun: 0, cur: null });

type Hit = { key: string; detail: string };

export class Achievements {
  constructor(private readonly repo: GameRepository) {}

  /** 우리 구단 정규시즌 시리즈별 경기 수(시즌 일정은 개막 때 정해진다) */
  private seriesCache: { season: number; club: ClubId; size: Map<number, number> } | null = null;
  private seriesSize(season: number, club: ClubId): Map<number, number> {
    if (this.seriesCache?.season === season && this.seriesCache.club === club) return this.seriesCache.size;
    const size = new Map<number, number>();
    for (const f of this.repo.getFixtures(season)) if ((!f.stage || f.stage === 'regular') && (f.home === club || f.away === club)) size.set(f.seriesId, (size.get(f.seriesId) ?? 0) + 1);
    this.seriesCache = { season, club, size };
    return size;
  }

  private careerCache: { season: number; club: ClubId; bat: Map<number, BattingTotals>; pit: Map<number, PitchingTotals>; hld: Map<number, number>; seasons: Map<number, Set<number>>; otherClub: Set<number> } | null = null;

  /** 하루 처리 뒤 판정. 새로 달성한 업적을 기록하고 편지함·경험치를 반영한다. */
  onDay(meta: GameMeta, date: GameDate, results: GameResult[]): void {
    const have = this.repo.getAchievements();
    const season = meta.season;
    const club = meta.userClubId;
    // 선수 목록은 이름이 필요할 때만 읽는다(매일 전체를 해석하지 않는다)
    let playerList: PlayerTruth[] | null = null;
    const allPlayers = () => (playerList ??= this.repo.getPlayers());
    let playerMap: Map<number, { name: string; career: { franchise: boolean } }> | null = null;
    const players = () => (playerMap ??= new Map(allPlayers().map((p) => [p.id, p])));
    const name = (id: number) => players().get(id)?.name ?? `#${id}`;
    const hits: Hit[] = [];
    /** 계열 판정: 값이 넘은 모든 단계(아래 단계 포함)를 한 번에 */
    const judge = (series: string, value: number, detail: (label: string) => string) => {
      const sd = SER.get(series)!;
      if (sd.inactive) return;
      sd.stages.forEach((t, i) => {
        const ok = sd.lower ? value <= t + 1e-9 : value >= t - 1e-9;
        if (!ok) return;
        const key = `${series}.${i + 1}`;
        const doneBefore = sd.type === 'season' ? have.some((a) => a.key === key && a.season === season) : have.some((a) => a.key === key);
        if (doneBefore || hits.some((h) => h.key === key)) return;
        hits.push({ key, detail: detail(stageLabel(sd, i)) });
      });
    };
    const flag = (series: string, cond: boolean, detail: string) => cond && judge(series, 1, () => detail);

    const st = this.state(meta);
    // 8d(D-186): P·Q 상태
    const pqRaw = this.repo.getMetaValue<PQState>('pqState');
    const pqSt: PQState = pqRaw && pqRaw.season === season ? { ...newPQState(season), ...pqRaw } : newPQState(season);
    const pqMemo: PQMemo = { ...newPQMemo(), ...(this.repo.getMetaValue<PQMemo>('pqMemo') ?? {}) };
    const pqBefore = JSON.stringify([pqSt, pqMemo]);
    const pq = { repo: this.repo, meta, date, judge, flag, name, st: pqSt, memo: pqMemo, tenureFirst: this.tenureFirstSeason(meta) };
    // ───── A 경기(우리 경기가 있던 날만) ─────
    const ourGames = results.filter((g) => g.home === club || g.away === club);
    const todays = ourGames.length ? new Map(this.repo.getFixturesOn(date).map((f) => [f.id, f])) : new Map<number, { stage?: string; seriesId: number }>();
    for (const g of ourGames) {
      const home = g.home === club;
      const fx = todays.get(g.fixtureId);
      const regular = !fx?.stage || fx.stage === 'regular';
      judgePQGame(pq, g, regular, this.debuts(meta, g));
      const mine = home ? g.homeRuns : g.awayRuns;
      const opp = home ? g.awayRuns : g.homeRuns;
      const won = mine > opp;
      const tag = `${date} ${mine}-${opp}`;
      if (won) {
        flag('A_first', true, `${tag} 승리`);
        flag('A_firsthome', home, `${tag} 홈 승리`);
        flag('A_firstps', !regular, `${tag} 포스트시즌 승리`);
      }
      const ours = g.events.filter((e) => e.battingClub === club);
      const theirs = g.events.filter((e) => e.battingClub !== club);
      judge('A_runs', mine, (l) => `${tag} ${mine}득점(${l})`);
      judge('A_hits', ours.filter((e) => HIT.has(e.outcome)).length, () => `${tag} 팀 ${ours.filter((e) => HIT.has(e.outcome)).length}안타`);
      judge('A_hr', ours.filter((e) => e.outcome === 'HR').length, () => `${tag} 팀 ${ours.filter((e) => e.outcome === 'HR').length}홈런`);
      if (won) {
        let deficit = 0;
        for (const x of [...g.events, ...g.plays].sort((a, b) => a.seq - b.seq)) deficit = Math.max(deficit, home ? x.awayScore - x.homeScore : x.homeScore - x.awayScore);
        judge('A_comeback', deficit, () => `${tag} ${deficit}점 차 역전승`);
      }
      // 투수
      const ks = new Map<number, number>();
      for (const e of theirs) if (e.outcome === 'K') ks.set(e.pitcherId, (ks.get(e.pitcherId) ?? 0) + 1);
      for (const [id, k] of ks) judge('A_pk', k, () => `${date} ${name(id)} ${k}탈삼진`);
      const pitchers = new Set(theirs.map((e) => e.pitcherId));
      const solo = pitchers.size === 1 ? [...pitchers][0]! : null;
      if (solo !== null && won) {
        const oppHits = theirs.filter((e) => HIT.has(e.outcome)).length;
        const reached = theirs.some((e) => ON_BASE.has(e.outcome) || e.outcome === 'ROE' || e.outcome === 'FC');
        flag('A_cg', true, `${tag} ${name(solo)} 완투승`);
        flag('A_sho', opp === 0, `${tag} ${name(solo)} 완봉승`);
        flag('A_nono', oppHits === 0, `${tag} ${name(solo)} 노히트 노런`);
        flag('A_perfect', !reached, `${tag} ${name(solo)} 퍼펙트 게임`);
      }
      // 타자
      const byBatter = new Map<number, { h: number; hr: number; rbi: number; kinds: Set<string> }>();
      for (const e of ours) {
        const b = byBatter.get(e.batterId) ?? { h: 0, hr: 0, rbi: 0, kinds: new Set<string>() };
        if (HIT.has(e.outcome)) (b.h++, b.kinds.add(e.outcome));
        if (e.outcome === 'HR') b.hr++;
        b.rbi += e.rbi;
        byBatter.set(e.batterId, b);
      }
      for (const [id, b] of byBatter) {
        judge('A_bh', b.h, () => `${date} ${name(id)} ${b.h}안타`);
        judge('A_bhr', b.hr, () => `${date} ${name(id)} ${b.hr}홈런`);
        judge('A_brbi', b.rbi, () => `${date} ${name(id)} ${b.rbi}타점`);
        flag('A_cycle', ['1B', '2B', '3B', 'HR'].every((o) => b.kinds.has(o)), `${date} ${name(id)} 사이클링 히트`);
      }
      if (!regular) continue;
      // 시즌 누적(경기한 날 저장본에 쌓는다)
      const last = g.events[g.events.length - 1];
      if (won && home && last?.half === 'B') st.walkoff++;
      if (won && g.innings > 9) st.extra++;
      if (won && opp === 0) st.shutout++;
      // 투수 연속 상태(우리 투수)
      if (solo !== null && won) {
        st.cg[String(solo)] = (st.cg[String(solo)] ?? 0) + 1;
        if (opp === 0) st.sho[String(solo)] = (st.sho[String(solo)] ?? 0) + 1;
      }
      for (const id of pitchers) {
        const ran = g.runs.some((r) => r.pitcherId === id && r.battingClub !== club);
        const outs = theirs.filter((e) => e.pitcherId === id).reduce((a, e) => a + e.outsOnPlay, 0) + g.plays.filter((p) => p.pitcherId === id && p.battingClub !== club).reduce((a, p) => a + p.outsOnPlay, 0);
        st.zero[String(id)] = ran ? 0 : (st.zero[String(id)] ?? 0) + outs;
        judge('C_zero', Math.floor((st.zero[String(id)] ?? 0) / 3), (l) => `${date} ${name(id)} 연속 무실점 ${l}이닝`);
      }
      const starter = home ? g.starters.home : g.starters.away;
      if (g.winningPitcher === starter) st.swin[String(starter)] = (st.swin[String(starter)] ?? 0) + 1;
      else if (g.losingPitcher === starter) st.swin[String(starter)] = 0;
      judge('C_swin', st.swin[String(starter)] ?? 0, (l) => `${date} ${name(starter)} 선발 ${l}연승`);
      // 연승·홈 연승(무승부는 끊지 않음), 시리즈(그 시리즈 경기를 모두 치르면 정산)
      if (won) st.streak++;
      else if (mine < opp) st.streak = 0;
      if (home) st.homeStreak = won ? st.homeStreak + 1 : mine < opp ? 0 : st.homeStreak;
      if (fx) {
        if (!st.cur || st.cur.id !== fx.seriesId) st.cur = { id: fx.seriesId, w: 0, l: 0, n: 0 };
        st.cur.n++;
        if (won) st.cur.w++;
        else if (mine < opp) st.cur.l++;
        if (st.cur.n >= (this.seriesSize(season, club).get(fx.seriesId) ?? 3)) {
          st.seriesRun = st.cur.w > st.cur.l ? st.seriesRun + 1 : 0;
          if (st.cur.n === 3 && st.cur.w === 3) st.sweep++;
          st.cur = null;
        }
      }
    }
    // 연승·홈 연승·시리즈·시즌 누적(정규시즌, 우리 경기가 있던 날)
    if (meta.mode === 'season' && ourGames.length) {
      judge('A_streak', st.streak, (l) => `${date} ${l}연승`);
      judge('A_home', st.homeStreak, (l) => `${date} 홈 ${l}연승`);
      judge('A_series', st.seriesRun, (l) => `${date} ${l}연속 위닝 시리즈`);
      judge('A_walkoff', st.walkoff, (l) => `${season} 끝내기 승리 ${l}회`);
      judge('A_extra', st.extra, (l) => `${season} 연장 승리 ${l}회`);
      judge('A_shutout', st.shutout, (l) => `${season} 영봉승 ${l}회`);
      judge('A_sweep', st.sweep, (l) => `${season} 3연전 스윕 ${l}회`);
    }

    // 8d: 리그 승패표(정규시즌 경기가 있던 날)
    if (meta.mode === 'season' && results.length) {
      const fx = this.repo.getFixturesOn(date).filter((f) => !f.stage || f.stage === 'regular').map((f) => f.id);
      if (fx.length) judgePQLeague(pq, results, new Set(fx), this.teamGames(season));
    }
    // ───── B·C·D 선수(매주 일요일, 정규시즌 마지막 날) ─────
    const regEnd = seasonKeyDates(season).regularSeasonEnd;
    const end = date === regEnd;
    // 정규시즌이 끝나면 기록이 더 바뀌지 않는다(포스트시즌 일요일은 건너뛴다)
    if (meta.mode === 'season' && (end || (weekday(date) === 0 && date < regEnd))) this.players(meta, date, end, judge, name, st, allPlayers);

    // ───── E·F 시즌(정규시즌 마지막 날), 포스트시즌(한국시리즈 종료일) ─────
    if (meta.mode === 'season' && end) this.seasonEnd(meta, judge, flag);
    const ps = meta.postseason;
    if (ps && ps.season === season && ps.finishedDate === date) this.postseasonEnd(meta, judge, flag);

    // ───── G~O(D-184): 매주 일요일·정규시즌 끝·한국시리즈 끝·수상 날·장부 시즌 마감 ─────
    {
      // 판정할 일이 있는 날만(매일 메타 전체를 읽지 않는다)
      const freshSeason = this.repo.getMetaValue<number>('season') ?? season;
      const freshK = this.repo.getMetaValue<string>('kDate') ?? meta.kDate;
      const when = {
        sunday: weekday(date) === 0,
        seasonEnd: meta.mode === 'season' && end,
        ksEnd: !!ps && ps.season === season && ps.finishedDate === date,
        awardDay: weekday(date) === 1 || date === addDays(meta.kDate, AWARDS.ceremonyAfterK) || date === addDays(freshK, AWARDS.ceremonyAfterK),
        homeGame: ourGames.some((g) => g.home === club),
        financeClosed: freshSeason > season ? season : null,
        // 8e: 올스타 발표일·올스타전 날
        allStarDay: meta.mode === 'season' && (date === allStarDates(season).close || date === allStarDates(season).game),
      };
      const memo: AchMemo = { ...newMemo(), ...(this.repo.getMetaValue<AchMemo>('achMemo') ?? {}) };
      const before = JSON.stringify(memo);
      if (Object.values(when).some((v) => v !== false && v !== null)) judgeOps({ repo: this.repo, meta, date, judge, flag, memo, players: allPlayers, career: () => this.career(meta), tenureFirst: this.tenureFirstSeason(meta), ...when });
      // 8d P·Q: 시즌 끝·수상 날·일요일
      if (when.seasonEnd) judgePQSeason(pq, allPlayers(), this.teamTotals(season));
      this.teamCache = null;
      // 수상 계열 P·Q는 그날 시상이 있었을 때만
      if (when.awardDay && this.repo.getAwards({ season }).some((a) => a.date === date)) judgePQAwards(pq, allPlayers());
      if (when.sunday) judgePQOps(pq, allPlayers(), this.repo.getMeta());
      // ②(D-237): 구단 서사 — 결말은 한국시리즈 종료일 시즌 마감 뒤 정해지므로 다음 월요일에 판정한다
      if (weekday(date) === 1) {
        const endings = Object.values(this.repo.getMetaValue<Record<string, { ending: { owner: boolean; kind: string; title: string; season: number } | null }>>('stories') ?? {}).flatMap((x) => (x.ending?.owner ? [x.ending] : []));
        if (endings.length) {
          judge('M_story', endings.length, (l) => `${date} 구단 스토리 결말 ${l}개(${endings.map((e) => e.title).join(', ')})`);
          const good = endings.find((e) => e.kind === 'success');
          flag('M_storyGood', !!good, `${good?.season ?? ''} 구단 스토리 성공 결말 '${good?.title ?? ''}'`);
        }
      }
      // M-2 메타: 올라운더·달성률·황금 시즌(오늘 판정 포함)
      const doneKeys = new Set([...have.map((a) => a.key), ...hits.map((h) => h.key)]);
      // 올라운더·달성률은 A~O만(P·Q 제외, D-186)
      const active = ACHIEVEMENTS.filter((a) => !a.inactive && a.cat !== 'P' && a.cat !== 'Q');
      const cats = [...new Set(active.map((a) => a.cat))];
      flag('M2_allround', cats.every((c) => active.some((a) => a.cat === c && doneKeys.has(a.key))), `${date} 모든 분류(${cats.join('')}) 달성`);
      const rate = (active.filter((a) => doneKeys.has(a.key)).length / active.length) * 100;
      judge('M2_rate', rate, (l) => `${date} 업적 달성률 ${rate.toFixed(1)}%(${l})`);
      const golden = new Set([...have.filter((a) => a.season === season).map((a) => a.key), ...hits.filter((h) => DEF.get(h.key)?.repeat).map((h) => h.key)].filter((k) => k.split('.')[0] !== 'M2_golden')).size;
      judge('M2_golden', golden, (l) => `${season} 시즌형 업적 ${l}개`);
      judge('M2_collector', [...doneKeys].filter((k) => k.startsWith('P_')).length, (l) => `${date} 진기록 ${l}개`);
      const shame = (y: number) => have.some((a) => a.season === y && /^(Q_losses|Q_last|Q_pct)\./.test(a.key));
      flag('M2_overcome', doneKeys.has('E_post.1') && [...have, ...hits.map((h) => ({ ...h, season }))].some((a) => a.key === 'E_post.1' && (a as { season: number }).season === season) && (shame(season - 1) || shame(season - 2)), `${season} 흑역사 뒤 가을야구`);
      if (JSON.stringify(memo) !== before) this.repo.updateMeta({ achMemo: memo });
    }

    if (ourGames.length || st.season !== (meta.achState as AchState | undefined)?.season) this.repo.updateMeta({ achState: st });
    if (JSON.stringify([pqSt, pqMemo]) !== pqBefore) this.repo.updateMeta({ pqState: pqSt, pqMemo });
    this.record(meta, date, hits, have);
  }

  private state(meta: GameMeta): AchState {
    const cur = meta.achState as AchState | undefined;
    // 저장본 meta는 읽기 전용(캐시)이라 고칠 상태는 깊게 복사한다
    return cur && cur.season === meta.season ? { ...newState(meta.season), ...structuredClone(cur) } : newState(meta.season);
  }

  /** 우리 구단 소속 통산(시즌 시작 전까지: 생성 기록의 우리 구단 줄 + 지난 원시 기록 시즌의 우리 구단 합계) */
  private career(meta: GameMeta) {
    const season = meta.season;
    const club = meta.userClubId;
    if (this.careerCache?.season === season && this.careerCache.club === club) return this.careerCache;
    const bat = new Map<number, BattingTotals>();
    const pit = new Map<number, PitchingTotals>();
    const hld = new Map<number, number>();
    const seasons = new Map<number, Set<number>>();
    const otherClub = new Set<number>();
    const addB = (id: number, t: BattingTotals) => {
      const cur = bat.get(id) ?? { G: 0, PA: 0, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, BB: 0, HBP: 0, SO: 0, SF: 0, SB: 0, CS: 0 };
      for (const k of Object.keys(cur) as Array<keyof BattingTotals>) (cur[k] as number) = (cur[k] ?? 0) + (t[k] ?? 0);
      bat.set(id, cur);
    };
    const addP = (id: number, t: PitchingTotals) => {
      const cur = pit.get(id) ?? { G: 0, GS: 0, OUTS: 0, W: 0, L: 0, SV: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, HBP: 0, K: 0, HR: 0, pitches: 0 };
      for (const k of Object.keys(cur) as Array<keyof PitchingTotals>) cur[k] += t[k] ?? 0;
      pit.set(id, cur);
    };
    const mark = (id: number, y: number, c: ClubId) => {
      if (c === club) seasons.set(id, new Set([...(seasons.get(id) ?? []), y]));
      else otherClub.add(id);
    };
    let last = 0;
    for (const h of this.repo.getHistory({})) {
      last = Math.max(last, h.season);
      if (h.season >= season) continue;
      mark(h.playerId, h.season, h.clubId);
      if (h.clubId !== club) continue;
      if (h.kind === 'bat') addB(h.playerId, h.totals as BattingTotals);
      else addP(h.playerId, h.totals as PitchingTotals);
    }
    for (let y = last + 1; y < season; y++) {
      for (const c of this.repo.getClubs().map((x) => x.id)) {
        for (const [id, t] of this.repo.battingTotals(y, undefined, c)) (mark(id, y, c), c === club && addB(id, t));
        for (const [id, t] of this.repo.pitchingTotals(y, undefined, c)) (mark(id, y, c), c === club && addP(id, t));
      }
      for (const [id, f] of this.repo.flagTotals(y, club)) hld.set(id, (hld.get(id) ?? 0) + f.HLD);
    }
    this.careerCache = { season, club, bat, pit, hld, seasons, otherClub };
    return this.careerCache;
  }

  private players(meta: GameMeta, date: GameDate, end: boolean, judge: (s: string, v: number, d: (l: string) => string) => void, name: (id: number) => string, st: AchState, all: () => PlayerTruth[]) {
    const season = meta.season;
    const club = meta.userClubId;
    // 우리 구단 소속 기록만: 지금 선수단 + 이번 시즌 트레이드로 떠난 선수(선수별 색인으로 읽는다)
    const left = (meta.tradeHistory ?? []).filter((t) => t.season === season && (t.clubA === club || t.clubB === club)).flatMap((t) => (t.clubA === club ? t.aToB : t.bToA));
    const ids = [...new Set([...all().filter((p) => p.clubId === club).map((p) => p.id), ...left])];
    const bat = this.repo.battingTotals(season, ids, club);
    const pit = this.repo.pitchingTotals(season, ids, club);
    const flags = this.repo.flagTotals(season, club);
    // 규정·전 경기 출전은 정규시즌 마지막 날만 쓴다(매주 경기 목록 전체를 읽지 않는다)
    const games = end ? Math.round((this.repo.getGames(season, 'regular').length * 2) / Math.max(1, this.repo.getClubs().length)) : 0;
    const qualPa = games * QUALIFY_PA_PER_GAME;
    const qualOuts = games * 3;
    for (const [id, t] of bat) {
      const n = name(id);
      judge('B_hr', t.HR, (l) => `${season} ${n} ${l}홈런(${t.HR})`);
      judge('B_h', t.H, (l) => `${season} ${n} ${l}안타(${t.H})`);
      judge('B_rbi', t.RBI, (l) => `${season} ${n} ${l}타점(${t.RBI})`);
      judge('B_r', t.R, (l) => `${season} ${n} ${l}득점(${t.R})`);
      judge('B_2b', t['2B'], (l) => `${season} ${n} 2루타 ${l}(${t['2B']})`);
      judge('B_3b', t['3B'], (l) => `${season} ${n} 3루타 ${l}(${t['3B']})`);
      judge('B_sb', t.SB ?? 0, (l) => `${season} ${n} ${l}도루(${t.SB ?? 0})`);
      judge('B_bb', t.BB, (l) => `${season} ${n} 볼넷 ${l}(${t.BB})`);
      judge('B_2020', Math.min(t.HR, t.SB ?? 0), (l) => `${season} ${n} ${l}(${t.HR}홈런·${t.SB ?? 0}도루)`);
      if (end && t.PA >= qualPa) {
        const r = battingRates(t);
        judge('B_avg', r.AVG ?? 0, (l) => `${season} ${n} 타율 ${l} 이상(${r3(r.AVG ?? 0)})`);
        judge('B_obp', r.OBP ?? 0, (l) => `${season} ${n} 출루율 ${l} 이상(${r3(r.OBP ?? 0)})`);
        judge('B_slg', r.SLG ?? 0, (l) => `${season} ${n} 장타율 ${l} 이상(${r3(r.SLG ?? 0)})`);
        judge('B_ops', r.OPS ?? 0, (l) => `${season} ${n} OPS ${l} 이상(${r3(r.OPS ?? 0)})`);
        judge('B_so', t.SO, (l) => `${season} ${n} 삼진 ${l}개 이하(${t.SO})`);
        if ((r.AVG ?? 0) >= 0.3 && t.HR >= 30 && t.RBI >= 100) judge('B_33100', 1, () => `${season} ${n} 타율 ${r3(r.AVG ?? 0)}·${t.HR}홈런·${t.RBI}타점`);
      }
      if (end && t.G >= games) judge('B_allgames', 1, () => `${season} ${n} ${t.G}경기 전 경기 출전`);
    }
    // 연속 경기 안타·출루(우리 구단 경기)
    for (const [id, x] of this.streaks(season, club, ids)) {
      judge('B_hstreak', x.hit, (l) => `${season} ${name(id)} ${l}경기 연속 안타`);
      judge('B_obstreak', x.ob, (l) => `${season} ${name(id)} ${l}경기 연속 출루`);
    }
    for (const [id, t] of pit) {
      const n = name(id);
      const f = flags.get(id) ?? { HLD: 0, BS: 0, QS: 0 };
      judge('C_w', t.W, (l) => `${season} ${n} ${l}승(${t.W})`);
      judge('C_sv', t.SV, (l) => `${season} ${n} ${l}세이브(${t.SV})`);
      judge('C_hld', f.HLD, (l) => `${season} ${n} ${l}홀드(${f.HLD})`);
      judge('C_k', t.K, (l) => `${season} ${n} ${l}탈삼진(${t.K})`);
      judge('C_ip', t.OUTS / 3, (l) => `${season} ${n} ${l}이닝(${Math.floor(t.OUTS / 3)})`);
      judge('C_qs', f.QS, (l) => `${season} ${n} 퀄리티 스타트 ${l}(${f.QS})`);
      judge('C_cg', st.cg[String(id)] ?? 0, (l) => `${season} ${n} 완투 ${l}`);
      judge('C_sho', st.sho[String(id)] ?? 0, (l) => `${season} ${n} 완봉 ${l}`);
      if (end && t.OUTS >= qualOuts) {
        const r = pitchingRates(t, null);
        judge('C_era', r.ERA ?? 99, (l) => `${season} ${n} 평균자책 ${l} 이하(${(r.ERA ?? 0).toFixed(2)})`);
        judge('C_whip', r.WHIP ?? 99, (l) => `${season} ${n} WHIP ${l} 이하(${(r.WHIP ?? 0).toFixed(2)})`);
      }
      if (end && t.W >= 10 && t.L === 0) judge('C_unbeaten', 1, () => `${season} ${n} ${t.W}승 무패`);
    }
    if (end) {
      // 트리플 크라운: 리그 전체(모든 구단) 1위가 우리 선수이고 우리 구단 소속 기록으로도 1위
      const allB = this.repo.battingTotals(season);
      const allP = this.repo.pitchingTotals(season);
      const top = <T>(m: Map<number, T>, f: (t: T) => number, q: (t: T) => boolean = () => true, low = false) => {
        const v = [...m.values()].filter(q).map(f);
        return v.length ? (low ? Math.min(...v) : Math.max(...v)) : NaN;
      };
      for (const [id, t] of bat) {
        const a = allB.get(id);
        if (!a || a.PA !== t.PA || t.PA < qualPa) continue;
        const avg = battingRates(t).AVG ?? 0;
        if (avg === top(allB, (x) => battingRates(x).AVG ?? 0, (x) => x.PA >= qualPa) && t.HR === top(allB, (x) => x.HR) && t.RBI === top(allB, (x) => x.RBI)) judge('B_triple', 1, () => `${season} ${name(id)} 타율 ${r3(avg)}·${t.HR}홈런·${t.RBI}타점 1위`);
      }
      for (const [id, t] of pit) {
        const a = allP.get(id);
        if (!a || a.OUTS !== t.OUTS || t.OUTS < qualOuts) continue;
        const era = pitchingRates(t, null).ERA ?? 99;
        if (t.W === top(allP, (x) => x.W) && t.K === top(allP, (x) => x.K) && era === top(allP, (x) => pitchingRates(x, null).ERA ?? 99, (x) => x.OUTS >= qualOuts, true)) judge('C_triple', 1, () => `${season} ${name(id)} ${t.W}승·평균자책 ${era.toFixed(2)}·${t.K}탈삼진 1위`);
      }
    }
    // D 통산(우리 구단 소속)
    const c = this.career(meta);
    const players = new Map(all().map((p) => [p.id, p]));
    const careerIds = new Set([...bat.keys(), ...pit.keys(), ...c.bat.keys(), ...c.pit.keys()]);
    for (const id of careerIds) {
      const b0 = c.bat.get(id);
      const b1 = bat.get(id);
      const p0 = c.pit.get(id);
      const p1 = pit.get(id);
      const n = name(id);
      const sum = (a: number | undefined, b: number | undefined) => (a ?? 0) + (b ?? 0);
      if (b1) {
        judge('D_hr', sum(b0?.HR, b1.HR), (l) => `${date} ${n} 통산 ${l}홈런`);
        judge('D_h', sum(b0?.H, b1.H), (l) => `${date} ${n} 통산 ${l}안타`);
        judge('D_rbi', sum(b0?.RBI, b1.RBI), (l) => `${date} ${n} 통산 ${l}타점`);
        judge('D_sb', sum(b0?.SB, b1.SB), (l) => `${date} ${n} 통산 ${l}도루`);
        if (!players.get(id)?.isPitcher) judge('D_g', sum(b0?.G, b1.G), (l) => `${date} ${n} 통산 ${l}경기`);
      }
      if (p1) {
        judge('D_w', sum(p0?.W, p1.W), (l) => `${date} ${n} 통산 ${l}승`);
        judge('D_sv', sum(p0?.SV, p1.SV), (l) => `${date} ${n} 통산 ${l}세이브`);
        judge('D_k', sum(p0?.K, p1.K), (l) => `${date} ${n} 통산 ${l}탈삼진`);
        judge('D_hld', sum(c.hld.get(id), flags.get(id)?.HLD), (l) => `${date} ${n} 통산 ${l}홀드`);
      }
      if ((b1 || p1) && !c.otherClub.has(id)) {
        const years = new Set([...(c.seasons.get(id) ?? []), season]).size;
        judge('D_oneclub', years, (l) => `${season} ${n} 원클럽맨 ${l}년`);
      }
    }
  }

  /** 우리 타자별 이번 시즌 가장 긴 연속 경기 안타·출루(우리 구단 경기) */
  private streaks(season: number, club: ClubId, ids: number[]): Map<number, { hit: number; ob: number }> {
    const rows = this.repo.clubBatterGames(season, club, ids);
    const cur = new Map<number, { hit: number; ob: number; bestH: number; bestO: number }>();
    for (const r of rows) {
      const x = cur.get(r.batterId) ?? { hit: 0, ob: 0, bestH: 0, bestO: 0 };
      x.hit = r.H > 0 ? x.hit + 1 : 0;
      x.ob = r.OB > 0 ? x.ob + 1 : 0;
      x.bestH = Math.max(x.bestH, x.hit);
      x.bestO = Math.max(x.bestO, x.ob);
      cur.set(r.batterId, x);
    }
    return new Map([...cur].map(([id, x]) => [id, { hit: x.bestH, ob: x.bestO }]));
  }

  /** 8d: 그 경기가 1군 첫 출전인 우리 선수(생성 기록·지난 시즌·이번 시즌 앞 경기에 출전 없음) */
  private debuts(meta: GameMeta, g: GameResult): Set<number> {
    const club = meta.userClubId;
    const ids = [...new Set([...g.events.filter((e) => e.battingClub === club).map((e) => e.batterId), ...g.events.filter((e) => e.battingClub !== club).map((e) => e.pitcherId)])];
    const c = this.career(meta);
    const fresh = ids.filter((id) => !c.seasons.has(id) && !c.otherClub.has(id));
    if (fresh.length === 0) return new Set();
    const bat = this.repo.battingTotals(meta.season, fresh);
    const pit = this.repo.pitchingTotals(meta.season, fresh);
    return new Set(fresh.filter((id) => Math.max(bat.get(id)?.G ?? 0, pit.get(id)?.G ?? 0) === 1));
  }

  /** 시즌 끝 날 팀 합계(팀 시즌 계열과 P·Q가 함께 쓴다) */
  private teamCache: { season: number; v: ReturnType<GameRepository['teamTotals']> } | null = null;
  teamTotals(season: number) {
    if (this.teamCache?.season !== season) this.teamCache = { season, v: this.repo.teamTotals(season) };
    return this.teamCache.v;
  }

  private gamesCache: { season: number; n: number } | null = null;
  /** 팀당 정규시즌 경기 수 */
  private teamGames(season: number): number {
    if (this.gamesCache?.season === season) return this.gamesCache.n;
    const n = Math.round((this.repo.getFixtures(season).filter((f) => !f.stage || f.stage === 'regular').length * 2) / Math.max(1, this.repo.getClubs().length));
    this.gamesCache = { season, n };
    return n;
  }

  /** 재임 시즌(현재 구단): 지금 구단 재임 시작 뒤 시즌만 */
  tenureFirstSeason(meta: GameMeta): number {
    const t = (meta.tenures ?? []).filter((x) => x.clubId === meta.userClubId && x.to === null).at(-1);
    const from = t?.from ?? meta.kDate;
    const y = Number(from.slice(0, 4));
    return Number(from.slice(5, 7)) >= 10 ? y + 1 : y;
  }

  private seasonEnd(meta: GameMeta, judge: (s: string, v: number, d: (l: string) => string) => void, flag: (s: string, c: boolean, d: string) => void) {
    const club = meta.userClubId;
    const season = meta.season;
    const clubIds = this.repo.getClubs().map((c) => c.id);
    const games = this.repo.getGames(season, 'regular');
    const table = computeStandings(clubIds, games);
    const me = table.find((r) => r.clubId === club)!;
    const pct = me.wins / Math.max(1, me.wins + me.losses);
    judge('E_w', me.wins, (l) => `${season} ${me.wins}승(${l}승 이상)`);
    judge('E_pct', pct, (l) => `${season} 승률 ${r3(pct)}(${l} 이상)`);
    if (me.rank <= 5) judge('E_post', 1, () => `${season} 정규시즌 ${me.rank}위 가을야구`);
    flag('E_first', me.rank === 1, `${season} 정규시즌 1위(${me.wins}승)`);
    const home = games.filter((g) => g.home === club);
    const hw = home.filter((g) => g.homeRuns > g.awayRuns).length;
    const hl = home.filter((g) => g.homeRuns < g.awayRuns).length;
    judge('E_homepct', hw / Math.max(1, hw + hl), (l) => `${season} 홈 ${hw}승 ${hl}패(${l} 이상)`);
    const h2h = clubIds.filter((c) => c !== club).every((c) => {
      const vs = games.filter((g) => (g.home === club && g.away === c) || (g.away === club && g.home === c));
      const w = vs.filter((g) => (g.home === club ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns)).length;
      const l = vs.filter((g) => (g.home === club ? g.homeRuns < g.awayRuns : g.awayRuns < g.homeRuns)).length;
      return w > l;
    });
    flag('E_h2h', h2h, `${season} 9개 구단 상대 전적 모두 우세`);
    const prevRank = this.rankOf(season - 1, club);
    if (prevRank === 10 && me.rank <= 5) judge('E_rise', 1, () => `${season - 1} 10위 → ${season} ${me.rank}위`);
    const team = this.teamTotals(season);
    const t = team.find((x) => x.clubId === club);
    if (t) {
      const br = battingRates(t.bat);
      const pr = pitchingRates(t.pit, null);
      judge('E_thr', t.bat.HR, () => `${season} 팀 ${t.bat.HR}홈런`);
      judge('E_tavg', br.AVG ?? 0, () => `${season} 팀 타율 ${r3(br.AVG ?? 0)}`);
      judge('E_tops', br.OPS ?? 0, () => `${season} 팀 OPS ${r3(br.OPS ?? 0)}`);
      judge('E_tr', t.runsFor, () => `${season} 팀 ${t.runsFor}득점`);
      judge('E_tsb', t.bat.SB ?? 0, () => `${season} 팀 ${t.bat.SB ?? 0}도루`);
      judge('E_tera', pr.ERA ?? 99, () => `${season} 팀 평균자책 ${(pr.ERA ?? 0).toFixed(2)}`);
      judge('E_twhip', pr.WHIP ?? 99, () => `${season} 팀 WHIP ${(pr.WHIP ?? 0).toFixed(2)}`);
      judge('E_tk', t.pit.K, () => `${season} 팀 ${t.pit.K}탈삼진`);
      flag('E_minra', t.runsAgainst <= Math.min(...team.map((x) => x.runsAgainst)), `${season} 리그 최소 ${t.runsAgainst}실점`);
      flag('E_maxr', t.runsFor >= Math.max(...team.map((x) => x.runsFor)), `${season} 리그 최다 ${t.runsFor}득점`);
      const errors = this.repo.clubErrors(season);
      const myE = errors.get(club) ?? 0;
      flag('E_mine', clubIds.every((c) => myE <= (errors.get(c) ?? 0)), `${season} 리그 최소 ${myE}실책`);
    }
    // F 재임 연속(정규시즌 항목)
    const first = this.tenureFirstSeason(meta);
    const ranks = (y: number) => (y === season ? { rank: me.rank, pct } : (() => { const r = this.repo.getSeasonStandings(y).find((x) => x.clubId === club); return r ? { rank: r.rank, pct: r.wins / Math.max(1, r.wins + r.losses) } : null; })());
    const run = (cond: (r: { rank: number; pct: number }) => boolean) => {
      let n = 0;
      for (let y = season; y >= first; y--) {
        const r = ranks(y);
        if (!r || !cond(r)) break;
        n++;
      }
      return n;
    };
    judge('F_ps', run((r) => r.rank <= 5), (l) => `${season} 연속 가을야구 ${l}시즌`);
    judge('F_first', run((r) => r.rank === 1), (l) => `${season} 정규시즌 1위 ${l}시즌 연속`);
    judge('F_500', run((r) => r.pct >= 0.5), (l) => `${season} 승률 5할 이상 ${l}시즌 연속`);
    let psn = 0;
    for (let y = first; y <= season; y++) if ((ranks(y)?.rank ?? 99) <= 5) psn++;
    judge('F_psn', psn, (l) => `${season} 재임 중 가을야구 ${l}회`);
  }

  private postseasonEnd(meta: GameMeta, judge: (s: string, v: number, d: (l: string) => string) => void, flag: (s: string, c: boolean, d: string) => void) {
    const club = meta.userClubId;
    const season = meta.season;
    const ps = meta.postseason!;
    const ks = ps.series.find((x) => x.key === 'ks')!;
    const wc = ps.series.find((x) => x.key === 'wc');
    const champ = ps.champion === club;
    const seed = ps.seeds.indexOf(club) + 1;
    if (ks.high === club || ks.low === club) judge('E_post', 2, () => `${season} 한국시리즈 진출`);
    if (champ) judge('E_post', 3, () => `${season} 한국시리즈 우승`);
    if (champ && seed === 1) judge('E_post', 4, () => `${season} 정규시즌 1위 + 한국시리즈 우승`);
    flag('E_wc', (seed === 4 || seed === 5) && wc?.winner === club, `${season} ${seed}위로 와일드카드 결정전 돌파`);
    if (champ && this.rankOf(season - 1, club) === 10) judge('E_rise', 2, () => `${season - 1} 10위 → ${season} 한국시리즈 우승`);
    const first = this.tenureFirstSeason(meta);
    const won = (y: number) => (y === season ? champ : this.repo.getSeasonStandings(y).find((x) => x.clubId === club)?.postseason === '한국시리즈 우승');
    let run = 0;
    for (let y = season; y >= first && won(y); y--) run++;
    judge('F_ks', run, (l) => `${season} 한국시리즈 ${l}연패`);
    let titles = 0;
    for (let y = first; y <= season; y++) if (won(y)) titles++;
    judge('F_titles', titles, (l) => `${season} 재임 중 우승 ${l}회`);
  }

  /** 시즌 순위: 저장된 최종 순위(2026 실제) 또는 원시 경기 기록 */
  rankOf(season: number, club: ClubId): number | null {
    // 2025 시즌까지는 실제 KBO 구단 역사(D-082)
    const real = clubHistory(club)?.seasons.find((x) => x.year === season);
    if (real) return real.rank;
    const stored = this.repo.getSeasonStandings(season).find((x) => x.clubId === club);
    if (stored) return stored.rank;
    const games = this.repo.getGames(season);
    if (games.length === 0) return null;
    return computeStandings(this.repo.getClubs().map((c) => c.id), games).find((r) => r.clubId === club)?.rank ?? null;
  }

  /** 경험치: 시즌형 두 번째부터 절반, 시즌 합계 상한(넘으면 0, D-182 (2)) */
  private record(meta: GameMeta, date: GameDate, list: Hit[], have: Array<{ key: string; season: number }>) {
    if (list.length === 0) return;
    let { ownerLevel: level, ownerXp: xp } = meta;
    const season = meta.season;
    const cur = this.repo.getMeta().achievementXp ?? {};
    let used = cur[String(season)] ?? 0;
    const inbox: InboxMessage[] = [];
    for (const a of list) {
      const d = DEF.get(a.key)!;
      const base = d.repeat && have.some((h) => h.key === a.key) ? Math.floor(d.xp / 2) : d.xp;
      const gained = Math.max(0, Math.min(base, X.seasonCap - used));
      used += gained;
      this.repo.insertAchievement({ key: a.key, season: d.repeat ? season : 0, date, detail: a.detail, xp: gained });
      const before = level;
      ({ level, xp } = addXp(level, xp, gained));
      inbox.push({
        date,
        kind: 'report',
        sender: '비서',
        title: d.cat === 'Q' ? `기록: ${d.title}` : `업적 달성: ${d.title}`,
        body: `${d.category} · ${d.description}\n${a.detail}\n구단주 경험치 +${gained}${gained < base ? ` (시즌 업적 경험치 상한 ${X.seasonCap})` : ''}${level > before ? ` → 레벨 ${level} 달성! 다음 주부터 행동력이 늘어납니다.` : ` (다음 레벨까지 ${xpToNext(level) - xp})`}`,
      });
    }
    this.repo.addInbox(inbox);
    this.repo.updateMeta({ ownerLevel: level, ownerXp: xp, achievementXp: { ...cur, [String(season)]: used } });
  }
}

export const achievementDef = (key: string) => DEF.get(key) ?? null;
