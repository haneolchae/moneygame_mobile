// 업적(24 문서, D-080·D-097·D-182): 분류 → 계열 → 단계. 원시 경기 기록·순위·장부·조직 상태로만 판정하고 하루 처리 트랜잭션 안에서 기록한다.
// 우리 구단만 달성한다. 선수 업적은 우리 구단 소속으로 쌓은 기록만 센다.
import { weekday, type GameDate } from '../engine/calendar';
import { ACHIEVEMENT_XP as X } from '../engine/config';
import type { GameResult } from '../engine/gamesim';
import { addXp, xpToNext } from '../engine/owner';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import { battingRates, pitchingRates, type BattingTotals, type PitchingTotals } from '../engine/stats';
import type { ClubId } from '../engine/types';
import { EOK } from '../engine/money';
import { clubHistory } from '../engine/data/history';
import { TEAMS } from '../engine/staff';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

export type AchievementType = 'once' | 'season' | 'cumulative';

export const CATEGORY_LABEL: Record<string, string> = {
  A: 'A 경기', B: 'B 타자 시즌', C: 'C 투수 시즌', D: 'D 통산', E: 'E 시즌 성적', F: 'F 왕조·연속',
  H: 'H 선수단 운영', L: 'L 재무', M: 'M 조직·구단주',
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
}

const s = (id: string, cat: string, title: string, type: AchievementType, stages: readonly number[], desc: string, extra: Partial<SeriesDef> = {}): SeriesDef => ({ id, cat, title, type, stages, desc, ...extra });
const one = (id: string, cat: string, title: string, type: AchievementType, tier: number, desc: string): SeriesDef => s(id, cat, title, type, [1], desc, { tiers: [tier], labels: [''] });

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
  // 8c 전 임시 운영 계열(D-182 (6))
  one('H_franchise', 'H', '간판을 지켜라', 'once', 2, '간판 선수와 FA 잔류 계약'),
  one('M_novacancy', 'M', '완성된 프런트', 'once', 2, '11개 팀 팀장 공석 0'),
  s('M_approvals', 'M', '결재', 'cumulative', [50], '결재 승인 누적', { tiers: [2] }),
  s('L_cash', 'L', '현금 보유', 'once', [500], '보유 현금(억 원)', { tiers: [3] }),
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
}

const stageLabel = (sd: SeriesDef, i: number) => sd.labels?.[i] ?? String(sd.stages[i]);
export const ACHIEVEMENTS: readonly AchievementDef[] = SERIES.flatMap((sd) =>
  sd.stages.map((_, i) => {
    const tier = sd.tiers?.[i] ?? i + 1;
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
      xp: X.byTier[tier - 1] ?? X.byTier[0]!,
      repeat: sd.type === 'season',
      type: sd.type,
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
    let playerMap: Map<number, { name: string; career: { franchise: boolean } }> | null = null;
    const players = () => (playerMap ??= new Map(this.repo.getPlayers().map((p) => [p.id, p])));
    const name = (id: number) => players().get(id)?.name ?? `#${id}`;
    const hits: Hit[] = [];
    /** 계열 판정: 값이 넘은 모든 단계(아래 단계 포함)를 한 번에 */
    const judge = (series: string, value: number, detail: (label: string) => string) => {
      const sd = SER.get(series)!;
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
    // ───── A 경기(우리 경기가 있던 날만) ─────
    const ourGames = results.filter((g) => g.home === club || g.away === club);
    const todays = ourGames.length ? new Map(this.repo.getFixturesOn(date).map((f) => [f.id, f])) : new Map<number, { stage?: string; seriesId: number }>();
    for (const g of ourGames) {
      const home = g.home === club;
      const fx = todays.get(g.fixtureId);
      const regular = !fx?.stage || fx.stage === 'regular';
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

    // ───── B·C·D 선수(매주 일요일, 정규시즌 마지막 날) ─────
    const regEnd = seasonKeyDates(season).regularSeasonEnd;
    const end = date === regEnd;
    // 정규시즌이 끝나면 기록이 더 바뀌지 않는다(포스트시즌 일요일은 건너뛴다)
    if (meta.mode === 'season' && (end || (weekday(date) === 0 && date < regEnd))) this.players(meta, date, end, judge, name, st);

    // ───── E·F 시즌(정규시즌 마지막 날), 포스트시즌(한국시리즈 종료일) ─────
    if (meta.mode === 'season' && end) this.seasonEnd(meta, judge, flag);
    const ps = meta.postseason;
    if (ps && ps.season === season && ps.finishedDate === date) this.postseasonEnd(meta, judge, flag);

    // ───── 임시 운영 계열(매주 일요일, D-182 (6)) ─────
    if (weekday(date) === 0) {
      const fa = this.repo.getFa(Number(meta.kDate.slice(0, 4)));
      flag('H_franchise', fa.some((e) => e.originClub === club && e.signedClub === club && players().get(e.playerId)?.career.franchise), '간판 선수 잔류 계약');
      const staff = this.repo.getStaff(club);
      flag('M_novacancy', TEAMS.every((t) => staff.some((x) => x.title === '팀장' && x.team === t.key)), `${date} 팀장 공석 0`);
      const n = this.repo.getApprovals('approved').length;
      judge('M_approvals', n, () => `${date} 결재 승인 ${n}건`);
      const cash = this.repo.cashBalance(club) / EOK;
      judge('L_cash', cash, () => `${date} 현금 ${Math.floor(cash)}억`);
    }

    if (ourGames.length || st.season !== (meta.achState as AchState | undefined)?.season) this.repo.updateMeta({ achState: st });
    this.record(meta, date, hits, have);
  }

  private state(meta: GameMeta): AchState {
    const cur = meta.achState as AchState | undefined;
    return cur && cur.season === meta.season ? { ...newState(meta.season), ...cur, cg: { ...cur.cg }, sho: { ...cur.sho }, zero: { ...cur.zero }, swin: { ...cur.swin }, cur: cur.cur ? { ...cur.cur } : null } : newState(meta.season);
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

  private players(meta: GameMeta, date: GameDate, end: boolean, judge: (s: string, v: number, d: (l: string) => string) => void, name: (id: number) => string, st: AchState) {
    const season = meta.season;
    const club = meta.userClubId;
    // 우리 구단 소속 기록만: 지금 선수단 + 이번 시즌 트레이드로 떠난 선수(선수별 색인으로 읽는다)
    const left = (meta.tradeHistory ?? []).filter((t) => t.season === season && (t.clubA === club || t.clubB === club)).flatMap((t) => (t.clubA === club ? t.aToB : t.bToA));
    const ids = [...new Set([...this.repo.getPlayers().filter((p) => p.clubId === club).map((p) => p.id), ...left])];
    const bat = this.repo.battingTotals(season, ids, club);
    const pit = this.repo.pitchingTotals(season, ids, club);
    const flags = this.repo.flagTotals(season, club);
    const games = Math.round((this.repo.getGames(season, 'regular').length * 2) / Math.max(1, this.repo.getClubs().length));
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
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
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

  /** 재임 시즌(현재 구단): 지금 구단 재임 시작 뒤 시즌만 */
  private tenureFirstSeason(meta: GameMeta): number {
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
    const team = this.repo.teamTotals(season);
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
      const errors = (c: ClubId) => [...this.repo.fieldingByClub(season, c).values()].reduce((a, x) => a + x.E, 0);
      const myE = errors(club);
      flag('E_mine', clubIds.every((c) => myE <= errors(c)), `${season} 리그 최소 ${myE}실책`);
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
        title: `업적 달성: ${d.title}`,
        body: `${d.category} · ${d.description}\n${a.detail}\n구단주 경험치 +${gained}${gained < base ? ` (시즌 업적 경험치 상한 ${X.seasonCap})` : ''}${level > before ? ` → 레벨 ${level} 달성! 다음 주부터 행동력이 늘어납니다.` : ` (다음 레벨까지 ${xpToNext(level) - xp})`}`,
      });
    }
    this.repo.addInbox(inbox);
    this.repo.updateMeta({ ownerLevel: level, ownerXp: xp, achievementXp: { ...cur, [String(season)]: used } });
  }
}

export const achievementDef = (key: string) => DEF.get(key) ?? null;
