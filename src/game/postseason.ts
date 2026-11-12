// 포스트시즌 (01 문서 포스트시즌, D-081): 와일드카드 → 준플레이오프 → 플레이오프 → 한국시리즈.
// 대진과 시리즈 상태는 메타에 저장하고, 다음 경기는 앞 경기 결과가 확정된 뒤 일정에 추가한다.
import { addDays, weekday, type GameDate } from '../engine/calendar';
import type { GameResult } from '../engine/gamesim';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import type { ClubId, Fixture, GameStage } from '../engine/types';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

export type SeriesKey = Exclude<GameStage, 'regular'>;

export interface SeriesState {
  key: SeriesKey;
  /** 상위 시드(홈 우선) */
  high: ClubId | null;
  low: ClubId | null;
  winsNeeded: number;
  highWins: number;
  lowWins: number;
  ties: number;
  /** 계획된 경기 날짜(재경기 없음, D-225 (2)) */
  dates: GameDate[];
  fixtureIds: number[];
  winner: ClubId | null;
}

export interface PostseasonState {
  season: number;
  /** 정규시즌 1~5위 */
  seeds: ClubId[];
  series: SeriesState[];
  champion: ClubId | null;
  finishedDate: GameDate | null;
}

export const SERIES_LABEL: Record<SeriesKey, string> = { wc: '와일드카드 결정전', semi: '준플레이오프', po: '플레이오프', ks: '한국시리즈' };

/** 01 문서: 와일드카드 1차전을 D0으로 둔 경기 일차 */
const DAY_OFFSETS: Record<SeriesKey, number[]> = {
  wc: [0, 1],
  semi: [3, 4, 6, 7, 9],
  po: [11, 12, 14, 15, 17],
  ks: [19, 20, 22, 23, 24, 26, 27],
};

/** 상위 시드 홈 경기 차수(1부터). 와일드카드는 모두 4위 홈 */
const HIGH_HOME: Record<SeriesKey, number[]> = { wc: [1, 2], semi: [1, 2, 5], po: [1, 2, 5], ks: [1, 2, 6, 7] };

/** D-081·D-225 (2): 포스트시즌 연장 15회(끝나면 무승부). 시리즈의 마지막 예정 경기만 무제한 이닝, 재경기 없음 */
export const POSTSEASON_MAX_INNINGS = 15;
/** 무제한 이닝을 엔진에 넘기는 값(실제로 닿지 않는 이닝 수) */
export const UNLIMITED_INNINGS = 99;

/** 그 경기의 연장 한도: 시리즈 마지막 예정 경기(와일드카드 2차전·준PO/PO 5차전·KS 7차전)는 무제한 */
export function postseasonMaxInnings(stage: string, gameInSeries: number | undefined): number {
  const n = DAY_OFFSETS[stage as SeriesKey]?.length;
  return n !== undefined && gameInSeries === n ? UNLIMITED_INNINGS : POSTSEASON_MAX_INNINGS;
}

/** 정규시즌 종료 주 다음 목요일 (01 문서) */
export function postseasonStart(regularSeasonEnd: GameDate): GameDate {
  let d = addDays(regularSeasonEnd, 1);
  while (weekday(d) !== 4) d = addDays(d, 1);
  return d;
}

export class Postseason {
  constructor(private readonly repo: GameRepository) {}

  state(meta: GameMeta): PostseasonState | null {
    return meta.postseason && meta.postseason.season === meta.season ? meta.postseason : null;
  }

  /** 정규시즌 마지막 날 처리 뒤: 대진을 만들고 와일드카드 1차전을 일정에 넣는다. */
  begin(meta: GameMeta): { state: PostseasonState; inbox: InboxMessage[]; nextFixtureId: number } {
    const table = computeStandings(this.repo.getClubs().map((c) => c.id), this.repo.getGames(meta.season));
    const seeds = table.slice(0, 5).map((r) => r.clubId);
    const d0 = postseasonStart(seasonKeyDates(meta.season).regularSeasonEnd);
    const mk = (key: SeriesKey, high: ClubId | null, low: ClubId | null): SeriesState => ({
      key,
      high,
      low,
      winsNeeded: key === 'ks' ? 4 : key === 'wc' ? 2 : 3,
      // 와일드카드: 4위가 1승을 안고 시작한다.
      highWins: key === 'wc' ? 1 : 0,
      lowWins: 0,
      ties: 0,
      dates: DAY_OFFSETS[key].map((o) => addDays(d0, o)),
      fixtureIds: [],
      winner: null,
    });
    const state: PostseasonState = {
      season: meta.season,
      seeds,
      series: [mk('wc', seeds[3]!, seeds[4]!), mk('semi', seeds[2]!, null), mk('po', seeds[1]!, null), mk('ks', seeds[0]!, null)],
      champion: null,
      finishedDate: null,
    };
    const nextId = this.schedule(state.series[0]!, meta.season, meta.nextFixtureId);
    const name = (id: ClubId) => this.repo.getClubs().find((c) => c.id === id)?.shortName ?? `#${id}`;
    const mine = seeds.indexOf(meta.userClubId);
    return {
      state,
      nextFixtureId: nextId,
      inbox: [
        {
          date: seasonKeyDates(meta.season).regularSeasonEnd,
          kind: 'news',
          sender: 'KBO 소식',
          title: `${meta.season} 포스트시즌 대진 확정`,
          body: `1위 ${name(seeds[0]!)} · 2위 ${name(seeds[1]!)} · 3위 ${name(seeds[2]!)} · 4위 ${name(seeds[3]!)} · 5위 ${name(seeds[4]!)}\n와일드카드 결정전은 ${d0}에 시작합니다(4위가 1승을 안고 시작).${mine >= 0 ? `\n우리 구단은 ${mine + 1}위로 가을야구에 나갑니다.` : '\n우리 구단은 포스트시즌에 나가지 못했습니다.'}`,
        },
      ],
    };
  }

  /** 시리즈의 다음 경기를 일정에 넣는다. 반환값은 다음 경기 ID */
  private schedule(s: SeriesState, season: number, nextId: number): number {
    const n = s.fixtureIds.length; // 지금까지 잡힌 경기 수
    const gameNo = n + 1;
    const highHome = HIGH_HOME[s.key].includes(gameNo);
    const f: Fixture = { id: nextId, season, date: s.dates[n]!, home: highHome ? s.high! : s.low!, away: highHome ? s.low! : s.high!, seriesId: 0, gameInSeries: gameNo, stage: s.key };
    this.repo.addFixtures([f], { nextFixtureId: nextId + 1 });
    s.fixtureIds.push(nextId);
    return nextId + 1;
  }

  /** 하루 경기 결과를 시리즈에 반영하고 다음 경기를 잡는다. */
  onResults(meta: GameMeta, date: GameDate, results: GameResult[]): { state: PostseasonState; inbox: InboxMessage[]; nextFixtureId: number; finished: boolean } | null {
    // 저장본 meta는 읽기 전용(캐시)이라 진행할 대진은 복사해서 고친다
    const cur = this.state(meta);
    if (!cur || cur.champion !== null) return null;
    const state = structuredClone(cur);
    let nextId = meta.nextFixtureId;
    const inbox: InboxMessage[] = [];
    const name = (id: ClubId) => this.repo.getClubs().find((c) => c.id === id)?.shortName ?? `#${id}`;
    let changed = false;
    for (const s of state.series) {
      for (const r of results) {
        if (!s.fixtureIds.includes(r.fixtureId) || s.winner !== null) continue;
        changed = true;
        const highRuns = r.home === s.high ? r.homeRuns : r.awayRuns;
        const lowRuns = r.home === s.high ? r.awayRuns : r.homeRuns;
        if (highRuns > lowRuns) s.highWins++;
        else if (lowRuns > highRuns) s.lowWins++;
        else if (s.key === 'wc') s.highWins++; // 와일드카드: 4위는 무승부만으로도 올라간다
        else s.ties++;
        if (s.highWins >= s.winsNeeded) s.winner = s.high;
        else if (s.lowWins >= s.winsNeeded) s.winner = s.low;
        // D-225 (2): 예정 경기를 다 치르면 승수가 많은 팀, 같으면 상위 시드가 올라간다(재경기 없음)
        else if (s.fixtureIds.length >= DAY_OFFSETS[s.key].length) s.winner = s.lowWins > s.highWins ? s.low : s.high;
        if (s.winner === null) {
          nextId = this.schedule(s, state.season, nextId);
          continue;
        }
        const loser = s.winner === s.high ? s.low! : s.high!;
        const score = s.key === 'wc' ? '' : ` (${Math.max(s.highWins, s.lowWins)}승 ${Math.min(s.highWins, s.lowWins)}패${s.ties ? ` ${s.ties}무` : ''})`;
        inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${SERIES_LABEL[s.key]}: ${name(s.winner)} 승리${score}`, body: `${name(s.winner)}이 ${name(loser)}을 꺾었습니다.` });
        const idx = state.series.indexOf(s);
        const next = state.series[idx + 1];
        if (next) {
          next.low = s.winner;
          // 재경기가 없어 다음 시리즈 시작일은 고정이다(01 문서)
          nextId = this.schedule(next, state.season, nextId);
        } else {
          state.champion = s.winner;
          state.finishedDate = date;
          inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${state.season} 한국시리즈 우승: ${name(s.winner)}`, body: `${name(s.winner)}이 ${state.season} 시즌 정상에 올랐습니다. 준우승 ${name(loser)}.` });
        }
      }
    }
    if (!changed) return null;
    if (state.champion !== null) this.recordFinal(state);
    return { state, inbox, nextFixtureId: nextId, finished: state.champion !== null };
  }

  /** 한국시리즈가 끝나면 시즌 최종 순위(정규시즌 순위 + 포스트시즌 결과)를 기록한다. */
  private recordFinal(state: PostseasonState) {
    const table = computeStandings(this.repo.getClubs().map((c) => c.id), this.repo.getGames(state.season));
    const result = new Map<ClubId, string>();
    const [wc, semi, po, ks] = state.series;
    const loserOf = (s: SeriesState | undefined) => (s && s.winner !== null ? (s.winner === s.high ? s.low : s.high) : null);
    const set = (id: ClubId | null | undefined, label: string) => id != null && result.set(id, label);
    set(loserOf(wc), '와일드카드 탈락');
    set(loserOf(semi), '준플레이오프 탈락');
    set(loserOf(po), '플레이오프 탈락');
    set(loserOf(ks), '한국시리즈 준우승');
    set(ks?.winner, '한국시리즈 우승');
    this.repo.saveSeasonStandings(table.map((r) => ({ season: state.season, clubId: r.clubId, rank: r.rank, wins: r.wins, losses: r.losses, ties: r.ties, postseason: result.get(r.clubId) ?? '' })));
  }

  /** 우리 구단 포스트시즌 결과 문구 (업적·보고용) */
  resultOf(state: PostseasonState, club: ClubId): string {
    const s = this.repo.getSeasonStandings(state.season).find((x) => x.clubId === club);
    return s?.postseason ?? '';
  }
}
