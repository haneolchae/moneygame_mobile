// 업적 (24 문서, D-080). 원시 경기 기록·순위·장부·조직 상태로만 판정하고, 하루 처리 트랜잭션 안에서 기록한다.
import { weekday, type GameDate } from '../engine/calendar';
import type { GameResult } from '../engine/gamesim';
import { addXp, xpToNext } from '../engine/owner';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import { battingRates, pitchingRates } from '../engine/stats';
import type { ClubId } from '../engine/types';
import { EOK } from '../engine/money';
import { clubHistory } from '../engine/data/history';
import { TEAMS } from '../engine/staff';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

export type AchievementCategory = '경기' | '선수' | '시즌' | '왕조' | '운영';

export interface AchievementDef {
  key: string;
  title: string;
  category: AchievementCategory;
  description: string;
  xp: number;
  /** 시즌마다 다시 달성할 수 있는 업적(경험치 절반) */
  repeat: boolean;
}

/** ASSUMPTION(D-080): 업적 목록과 경험치 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { key: 'first_win', title: '첫 승리', category: '경기', description: '구단주 취임 후 첫 승리', xp: 20, repeat: false },
  { key: 'streak5', title: '5연승', category: '경기', description: '정규시즌 5연승', xp: 20, repeat: false },
  { key: 'streak10', title: '10연승', category: '경기', description: '정규시즌 10연승', xp: 60, repeat: false },
  { key: 'runs15', title: '타선 폭발', category: '경기', description: '한 경기 15득점 이상', xp: 20, repeat: false },
  { key: 'walkoff', title: '끝내기 승리', category: '경기', description: '홈 경기 마지막 공격에서 끝내기 승리', xp: 20, repeat: false },
  { key: 'no_hitter', title: '팀 노히트 노런', category: '경기', description: '상대에게 안타를 하나도 내주지 않고 승리', xp: 80, repeat: false },
  { key: 'cycle', title: '사이클링 히트', category: '경기', description: '한 선수가 한 경기에서 단타·2루타·3루타·홈런', xp: 60, repeat: false },
  { key: 'hr30', title: '30홈런 타자', category: '선수', description: '우리 선수가 한 시즌 30홈런', xp: 40, repeat: false },
  { key: 'win15', title: '15승 투수', category: '선수', description: '우리 투수가 한 시즌 15승', xp: 40, repeat: false },
  { key: 'sv30', title: '30세이브 마무리', category: '선수', description: '우리 투수가 한 시즌 30세이브', xp: 40, repeat: false },
  { key: 'k150', title: '탈삼진 머신', category: '선수', description: '우리 투수가 한 시즌 150탈삼진', xp: 30, repeat: false },
  { key: 'hitter300', title: '3할 타자', category: '선수', description: '규정 타석을 채운 우리 타자가 타율 3할로 시즌 종료', xp: 30, repeat: false },
  { key: 'batting_title', title: '타격왕 배출', category: '선수', description: '규정 타석 타율 리그 1위', xp: 50, repeat: false },
  { key: 'hr_king', title: '홈런왕 배출', category: '선수', description: '홈런 리그 1위(공동 포함)', xp: 50, repeat: false },
  { key: 'wins80', title: '시즌 80승', category: '시즌', description: '정규시즌 80승 이상', xp: 60, repeat: true },
  { key: 'first_place', title: '정규시즌 1위', category: '시즌', description: '정규시즌 1위로 마감', xp: 100, repeat: true },
  { key: 'postseason', title: '가을야구 진출', category: '시즌', description: '정규시즌 5위 이내', xp: 60, repeat: true },
  { key: 'team_hr180', title: '홈런 군단', category: '시즌', description: '팀 홈런 180개 이상', xp: 30, repeat: true },
  { key: 'team_era', title: '마운드 왕국', category: '시즌', description: '팀 평균자책 4.00 미만으로 시즌 종료', xp: 40, repeat: true },
  { key: 'ks_final', title: '한국시리즈 진출', category: '시즌', description: '한국시리즈 무대에 오름', xp: 80, repeat: true },
  { key: 'ks_title', title: '한국시리즈 우승', category: '시즌', description: '한국시리즈 우승', xp: 200, repeat: true },
  { key: 'ps_series_win', title: '가을의 승자', category: '경기', description: '포스트시즌 시리즈 첫 승리', xp: 40, repeat: false },
  { key: 'dynasty3', title: '3년 연속 가을야구', category: '왕조', description: '3시즌 연속 정규시즌 5위 이내', xp: 150, repeat: true },
  { key: 'franchise_kept', title: '간판을 지켜라', category: '운영', description: '간판 선수와 FA 잔류 계약', xp: 40, repeat: false },
  { key: 'no_vacancy', title: '완성된 프런트', category: '운영', description: '11개 팀 팀장 공석 0', xp: 30, repeat: false },
  { key: 'approvals50', title: '결재의 달인', category: '운영', description: '결재 50건 승인', xp: 20, repeat: false },
  { key: 'cash500', title: '500억 구단', category: '운영', description: '보유 현금 500억 돌파', xp: 40, repeat: false },
];

const def = (key: string) => ACHIEVEMENTS.find((a) => a.key === key)!;

/** KBO 규정 타석: 경기 수 × 3.1 */
export const QUALIFY_PA_PER_GAME = 3.1;

export class Achievements {
  constructor(private readonly repo: GameRepository) {}

  /** 하루 처리 뒤 판정. 새로 달성한 업적을 기록하고 편지함·경험치를 반영한다. */
  onDay(meta: GameMeta, date: GameDate, results: GameResult[]): void {
    const have = this.repo.getAchievements();
    const done = (key: string, season: number) => have.some((a) => a.key === key && a.season === season);
    const hits: Array<{ key: string; detail: string }> = [];
    const once = (key: string, cond: boolean, detail: string) => {
      if (cond && !done(key, 0) && !hits.some((h) => h.key === key)) hits.push({ key, detail });
    };
    const club = meta.userClubId;
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const name = (id: number) => players.get(id)?.name ?? `#${id}`;

    // 경기 업적
    for (const g of results) {
      if (g.home !== club && g.away !== club) continue;
      const home = g.home === club;
      const mine = home ? g.homeRuns : g.awayRuns;
      const won = (g.outcome === 'home') === home && g.outcome !== 'tie';
      once('first_win', won, `${date} ${mine}-${home ? g.awayRuns : g.homeRuns} 승리`);
      once('runs15', mine >= 15, `${date} ${mine}득점`);
      const last = g.events[g.events.length - 1];
      once('walkoff', won && home && last?.half === 'B', `${date} ${last ? name(last.batterId) : ''} 끝내기`);
      const oppHits = g.events.filter((e) => e.battingClub !== club && ['1B', '2B', '3B', 'HR'].includes(e.outcome)).length;
      once('no_hitter', won && oppHits === 0, `${date} 상대 무안타`);
      const byBatter = new Map<number, Set<string>>();
      for (const e of g.events) if (e.battingClub === club) byBatter.set(e.batterId, (byBatter.get(e.batterId) ?? new Set()).add(e.outcome));
      for (const [id, set] of byBatter) once('cycle', ['1B', '2B', '3B', 'HR'].every((o) => set.has(o)), `${date} ${name(id)}`);
    }

    const season = meta.season;
    const wonToday = results.some((g) => (g.home === club && g.homeRuns > g.awayRuns) || (g.away === club && g.awayRuns > g.homeRuns));
    if (meta.mode === 'season' && wonToday) {
      // 연승: 이긴 날만, 이번 시즌 우리 경기 결과의 끝에서부터 센다.
      const games = this.repo.getGames(season).filter((g) => g.home === club || g.away === club);
      let streak = 0;
      for (let i = games.length - 1; i >= 0; i--) {
        const g = games[i]!;
        const my = g.home === club ? g.homeRuns : g.awayRuns;
        const their = g.home === club ? g.awayRuns : g.homeRuns;
        if (my > their) streak++;
        else break;
      }
      once('streak5', streak >= 5, `${date} 5연승`);
      once('streak10', streak >= 10, `${date} 10연승`);
    }
    // 선수 기록 업적: 성능을 위해 매주 일요일과 정규시즌 마지막 날에 판정한다(최대 6일 늦게 기록).
    if (meta.mode === 'season' && (weekday(date) === 0 || date === seasonKeyDates(season).regularSeasonEnd)) {
      const ids = [...players.values()].filter((p) => p.clubId === club).map((p) => p.id);
      const bat = this.repo.battingTotals(season, ids);
      const pit = this.repo.pitchingTotals(season, ids);
      for (const [id, t] of bat) once('hr30', t.HR >= 30, `${season} ${name(id)} ${t.HR}홈런`);
      for (const [id, t] of pit) {
        once('win15', t.W >= 15, `${season} ${name(id)} ${t.W}승`);
        once('sv30', t.SV >= 30, `${season} ${name(id)} ${t.SV}세이브`);
        once('k150', t.K >= 150, `${season} ${name(id)} ${t.K}탈삼진`);
      }
    }

    // 시즌 종료 업적
    const seasonHits: Array<{ key: string; detail: string }> = [];
    if (meta.mode === 'season' && date === seasonKeyDates(season).regularSeasonEnd) this.seasonEnd(meta, seasonHits, once, name);

    // 포스트시즌 업적: 한국시리즈가 끝난 날 판정
    const ps = meta.postseason;
    if (ps && ps.season === season) {
      const wonSeries = ps.series.some((x) => x.winner === club);
      once('ps_series_win', wonSeries, `${season} 포스트시즌 시리즈 승리`);
      if (ps.finishedDate === date) {
        const ks = ps.series.find((x) => x.key === 'ks')!;
        if (ks.high === club || ks.low === club) seasonHits.push({ key: 'ks_final', detail: `${season} 한국시리즈 진출` });
        if (ps.champion === club) seasonHits.push({ key: 'ks_title', detail: `${season} 한국시리즈 우승` });
      }
    }

    // 운영 업적: 매주 일요일 판정
    if (weekday(date) === 0) {
      const fa = this.repo.getFa(Number(meta.kDate.slice(0, 4)));
      once('franchise_kept', fa.some((e) => e.originClub === club && e.signedClub === club && players.get(e.playerId)?.career.franchise), '간판 선수 잔류 계약');
      const staff = this.repo.getStaff(club);
      once('no_vacancy', TEAMS.every((t) => staff.some((s) => s.title === '팀장' && s.team === t.key)), `${date} 팀장 공석 0`);
      once('approvals50', this.repo.getApprovals('approved').length >= 50, `${date} 결재 승인 50건`);
      once('cash500', this.repo.cashBalance(club) >= 500 * EOK, `${date} 현금 500억`);
    }

    this.record(meta, date, [...hits.map((h) => ({ ...h, season: 0 })), ...seasonHits.map((h) => ({ ...h, season }))], have.map((a) => a.key));
  }

  private seasonEnd(meta: GameMeta, seasonHits: Array<{ key: string; detail: string }>, once: (k: string, c: boolean, d: string) => void, name: (id: number) => string) {
    const club = meta.userClubId;
    const season = meta.season;
    const clubIds = this.repo.getClubs().map((c) => c.id);
    const table = computeStandings(clubIds, this.repo.getGames(season));
    const me = table.find((r) => r.clubId === club)!;
    const each = (key: string, cond: boolean, detail: string) => {
      if (cond) seasonHits.push({ key, detail });
    };
    each('wins80', me.wins >= 80, `${season} ${me.wins}승`);
    each('first_place', me.rank === 1, `${season} 정규시즌 1위`);
    each('postseason', me.rank <= 5, `${season} 정규시즌 ${me.rank}위`);
    const team = this.repo.teamTotals(season).find((t) => t.clubId === club);
    if (team) {
      each('team_hr180', team.bat.HR >= 180, `${season} 팀 ${team.bat.HR}홈런`);
      const era = pitchingRates(team.pit, null).ERA;
      each('team_era', era !== null && era < 4, `${season} 팀 평균자책 ${era?.toFixed(2)}`);
    }
    const ranks = [this.rankOf(season - 2, club), this.rankOf(season - 1, club), me.rank];
    each('dynasty3', ranks.every((r) => r !== null && r <= 5), `${season - 2}~${season} 연속 5위 이내`);
    // 개인 타이틀 (규정 타석)
    const qualify = Math.floor(teamGames(this.repo, season) * QUALIFY_PA_PER_GAME);
    const players = this.repo.getPlayers();
    const bat = this.repo.battingTotals(season);
    const qualified = [...bat.entries()].filter(([, t]) => t.PA >= qualify).map(([id, t]) => ({ id, avg: battingRates(t).AVG ?? 0, hr: t.HR }));
    const mineIds = new Set(players.filter((p) => p.clubId === club).map((p) => p.id));
    const topAvg = [...qualified].sort((a, b) => b.avg - a.avg)[0];
    once('batting_title', !!topAvg && mineIds.has(topAvg.id), `${season} ${topAvg ? name(topAvg.id) : ''} 타율 ${topAvg?.avg.toFixed(3)}`);
    const maxHr = Math.max(0, ...[...bat.values()].map((t) => t.HR));
    const hrKing = [...bat.entries()].find(([id, t]) => t.HR === maxHr && maxHr > 0 && mineIds.has(id));
    once('hr_king', !!hrKing, `${season} ${hrKing ? name(hrKing[0]) : ''} ${maxHr}홈런`);
    const three = qualified.find((q) => mineIds.has(q.id) && q.avg >= 0.3);
    once('hitter300', !!three, `${season} ${three ? name(three.id) : ''} 타율 ${three?.avg.toFixed(3)}`);
  }

  /** 시즌 순위: 저장된 최종 순위(2026 실제) 또는 원시 경기 기록 */
  rankOf(season: number, club: ClubId): number | null {
    // 2025 시즌까지는 실제 KBO 구단 역사(D-082)
    const real = clubHistory(club)?.seasons.find((x) => x.year === season);
    if (real) return real.rank;
    const stored = this.repo.getSeasonStandings(season).find((s) => s.clubId === club);
    if (stored) return stored.rank;
    const games = this.repo.getGames(season);
    if (games.length === 0) return null;
    return computeStandings(this.repo.getClubs().map((c) => c.id), games).find((r) => r.clubId === club)?.rank ?? null;
  }

  private record(meta: GameMeta, date: GameDate, list: Array<{ key: string; detail: string; season: number }>, earlierKeys: string[]) {
    if (list.length === 0) return;
    let { ownerLevel: level, ownerXp: xp } = meta;
    const inbox: InboxMessage[] = [];
    for (const a of list) {
      const d = def(a.key);
      const gained = d.repeat && earlierKeys.includes(a.key) ? Math.floor(d.xp / 2) : d.xp;
      this.repo.insertAchievement({ key: a.key, season: a.season, date, detail: a.detail, xp: gained });
      const before = level;
      ({ level, xp } = addXp(level, xp, gained));
      inbox.push({
        date,
        kind: 'report',
        sender: '비서',
        title: `업적 달성: ${d.title}`,
        body: `${d.description}\n${a.detail}\n구단주 경험치 +${gained}${level > before ? ` → 레벨 ${level} 달성! 다음 주부터 행동력이 늘어납니다.` : ` (다음 레벨까지 ${xpToNext(level) - xp})`}`,
      });
    }
    this.repo.addInbox(inbox);
    this.repo.updateMeta({ ownerLevel: level, ownerXp: xp });
  }
}

/** 팀당 경기 수 = 리그 경기 수 × 2 ÷ 구단 수 */
function teamGames(repo: GameRepository, season: number): number {
  const n = repo.getGames(season).length;
  return Math.round((n * 2) / Math.max(1, repo.getClubs().length));
}
