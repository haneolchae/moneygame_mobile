// 9b-1 기록 증분 집계: 압축 전 시즌의 정규시즌 원시 기록을 날짜·선수·구단별 줄로 한 번 읽어 두고,
// 경기일 확정(commitDay) 때 그날 줄만 더한다. 선수 합계·시상 기간 합계를 매번 원시 기록 전체에서 다시 세지 않는다.
// 값과 순서(선수 ID 오름차순)는 원시 기록 SQL 집계와 같다(시험 `tests/seasonStats.test.ts`).
import type { DatabaseSync } from 'node:sqlite';
import type { GameDate } from '../engine/calendar';
import type { BattingTotals, PitchingTotals } from '../engine/stats';
import type { ClubId, PlayerId } from '../engine/types';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

/** 타자 한 줄(구단 = 공격 구단). G는 그날 그 구단으로 나온 경기 수 */
interface BatLine {
  G: number;
  PA: number;
  AB: number;
  H: number;
  D: number;
  T: number;
  HR: number;
  RBI: number;
  R: number;
  BB: number;
  HBP: number;
  SO: number;
  SF: number;
  SB: number;
  CS: number;
}
/** 투수 한 줄(구단 = 수비 구단). OUTS는 타석 아웃, PO는 주루 사건 아웃 */
interface PitLine {
  G: number;
  OUTS: number;
  PO: number;
  BF: number;
  H: number;
  BB: number;
  HBP: number;
  K: number;
  HR: number;
  P: number;
  R: number;
  ER: number;
}
/** 구단과 무관하게 경기 표에서 세는 투수 기록(선발·승·패·세이브)과 홀드·블론·QS */
interface DecLine {
  GS: number;
  W: number;
  L: number;
  SV: number;
  HLD: number;
  BS: number;
  QS: number;
}
interface DayStats {
  bat: Map<PlayerId, Map<ClubId, BatLine>>;
  pit: Map<PlayerId, Map<ClubId, PitLine>>;
  dec: Map<PlayerId, DecLine>;
}

const BAT_KEYS = ['G', 'PA', 'AB', 'H', 'D', 'T', 'HR', 'RBI', 'R', 'BB', 'HBP', 'SO', 'SF', 'SB', 'CS'] as const;
const PIT_KEYS = ['G', 'OUTS', 'PO', 'BF', 'H', 'BB', 'HBP', 'K', 'HR', 'P', 'R', 'ER'] as const;
const DEC_KEYS = ['GS', 'W', 'L', 'SV', 'HLD', 'BS', 'QS'] as const;
const zeroBat = (): BatLine => ({ G: 0, PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, RBI: 0, R: 0, BB: 0, HBP: 0, SO: 0, SF: 0, SB: 0, CS: 0 });
const zeroPit = (): PitLine => ({ G: 0, OUTS: 0, PO: 0, BF: 0, H: 0, BB: 0, HBP: 0, K: 0, HR: 0, P: 0, R: 0, ER: 0 });
const zeroDec = (): DecLine => ({ GS: 0, W: 0, L: 0, SV: 0, HLD: 0, BS: 0, QS: 0 });
const emptyDay = (): DayStats => ({ bat: new Map(), pit: new Map(), dec: new Map() });

function lineOf<L>(m: Map<PlayerId, Map<ClubId, L>>, id: PlayerId, club: ClubId, zero: () => L): L {
  let byClub = m.get(id);
  if (!byClub) m.set(id, (byClub = new Map()));
  let l = byClub.get(club);
  if (!l) byClub.set(club, (l = zero()));
  return l;
}
function decOf(m: Map<PlayerId, DecLine>, id: PlayerId): DecLine {
  let l = m.get(id);
  if (!l) m.set(id, (l = zeroDec()));
  return l;
}
function addInto<L extends object>(dst: L, src: L, keys: readonly (keyof L)[]): void {
  for (const k of keys) (dst[k] as number) += src[k] as number;
}
function mergeDay(dst: DayStats, src: DayStats): void {
  for (const [id, byClub] of src.bat) for (const [c, l] of byClub) addInto(lineOf(dst.bat, id, c, zeroBat), l, BAT_KEYS);
  for (const [id, byClub] of src.pit) for (const [c, l] of byClub) addInto(lineOf(dst.pit, id, c, zeroPit), l, PIT_KEYS);
  for (const [id, l] of src.dec) addInto(decOf(dst.dec, id), l, DEC_KEYS);
}

/** 수비 구단: 공격 구단이 홈이면 원정, 아니면 홈 */
const DEF = 'CASE WHEN x.batting_club = g.home THEN g.away ELSE g.home END';

/** 정규시즌 원시 기록을 날짜별 줄로 읽는다. games가 있으면 그 경기만(기본키 game_id로 찾는다) */
function loadDays(db: DatabaseSync, season: number, games?: readonly number[]): Map<GameDate, DayStats> {
  const days = new Map<GameDate, DayStats>();
  const day = (d: unknown) => {
    const k = String(d);
    let s = days.get(k);
    if (!s) days.set(k, (s = emptyDay()));
    return s;
  };
  const list = games?.map((x) => Math.trunc(x)).join(',');
  const only = (col: string) => (list === undefined ? '' : ` AND ${col} IN (${list || 'NULL'})`);
  // 경기 지정 때는 시즌 색인 대신 기본키(game_id)를 타게 시즌 조건 앞에 +를 붙인다(값은 같다)
  const all = (sql: string) => db.prepare(list === undefined ? sql : sql.replace(/([\w.]*season) = \?1/g, '+$1 = ?1')).all(season) as Row[];
  for (const r of all(
    `SELECT date AS d, batter_id AS id, batting_club AS c, COUNT(DISTINCT game_id) AS G, COUNT(*) AS PA,
            SUM(outcome NOT IN ('BB','HBP','SF','SH')) AS AB, SUM(outcome IN ('1B','2B','3B','HR')) AS H,
            SUM(outcome = '2B') AS D, SUM(outcome = '3B') AS T, SUM(outcome = 'HR') AS HR, SUM(rbi) AS RBI,
            SUM(outcome = 'BB') AS BB, SUM(outcome = 'HBP') AS HBP, SUM(outcome = 'K') AS SO, SUM(outcome = 'SF') AS SF
       FROM plate_appearances WHERE stage = 'regular' AND season = ?1${only('game_id')} GROUP BY date, batter_id, batting_club`,
  )) {
    const l = lineOf(day(r.d).bat, num(r.id), num(r.c), zeroBat);
    for (const k of ['G', 'PA', 'AB', 'H', 'D', 'T', 'HR', 'RBI', 'BB', 'HBP', 'SO', 'SF'] as const) l[k] += num(r[k]);
  }
  for (const r of all(
    `SELECT g.date AS d, x.runner_id AS id, x.batting_club AS c, COUNT(*) AS R
       FROM runs x JOIN games g ON g.fixture_id = x.game_id WHERE x.stage = 'regular' AND x.season = ?1${only('x.game_id')} GROUP BY g.date, x.runner_id, x.batting_club`,
  ))
    lineOf(day(r.d).bat, num(r.id), num(r.c), zeroBat).R += num(r.R);
  for (const r of all(
    `SELECT date AS d, runner_id AS id, batting_club AS c, SUM(kind = 'SB') AS SB, SUM(kind = 'CS') AS CS
       FROM plays WHERE stage = 'regular' AND season = ?1 AND kind IN ('SB','CS')${only('game_id')} GROUP BY date, runner_id, batting_club`,
  )) {
    const l = lineOf(day(r.d).bat, num(r.id), num(r.c), zeroBat);
    l.SB += num(r.SB);
    l.CS += num(r.CS);
  }
  for (const r of all(
    `SELECT x.date AS d, x.pitcher_id AS id, ${DEF} AS c, COUNT(DISTINCT x.game_id) AS G, SUM(x.outs_on_play) AS OUTS, COUNT(*) AS BF,
            SUM(x.outcome IN ('1B','2B','3B','HR')) AS H, SUM(x.outcome = 'BB') AS BB, SUM(x.outcome = 'HBP') AS HBP,
            SUM(x.outcome = 'K') AS K, SUM(x.outcome = 'HR') AS HR, SUM(x.pitches) AS P
       FROM plate_appearances x JOIN games g ON g.fixture_id = x.game_id WHERE x.stage = 'regular' AND x.season = ?1${only('x.game_id')} GROUP BY x.date, x.pitcher_id, c`,
  )) {
    const l = lineOf(day(r.d).pit, num(r.id), num(r.c), zeroPit);
    for (const k of ['G', 'OUTS', 'BF', 'H', 'BB', 'HBP', 'K', 'HR', 'P'] as const) l[k] += num(r[k]);
  }
  for (const r of all(
    `SELECT g.date AS d, x.pitcher_id AS id, ${DEF} AS c, COUNT(*) AS R, SUM(x.earned) AS ER
       FROM runs x JOIN games g ON g.fixture_id = x.game_id WHERE x.stage = 'regular' AND x.season = ?1${only('x.game_id')} GROUP BY g.date, x.pitcher_id, c`,
  )) {
    const l = lineOf(day(r.d).pit, num(r.id), num(r.c), zeroPit);
    l.R += num(r.R);
    l.ER += num(r.ER);
  }
  for (const r of all(
    `SELECT x.date AS d, x.pitcher_id AS id, ${DEF} AS c, SUM(x.outs_on_play) AS O
       FROM plays x JOIN games g ON g.fixture_id = x.game_id WHERE x.stage = 'regular' AND x.season = ?1${only('x.game_id')} GROUP BY x.date, x.pitcher_id, c`,
  ))
    lineOf(day(r.d).pit, num(r.id), num(r.c), zeroPit).PO += num(r.O);
  for (const r of all(
    `SELECT d, id, SUM(gs) AS GS, SUM(w) AS W, SUM(l) AS L, SUM(s) AS SV FROM (
       SELECT date AS d, home_sp AS id, 1 AS gs, 0 AS w, 0 AS l, 0 AS s FROM games WHERE stage = 'regular' AND season = ?1${only('fixture_id')}
       UNION ALL SELECT date, away_sp, 1, 0, 0, 0 FROM games WHERE stage = 'regular' AND season = ?1${only('fixture_id')}
       UNION ALL SELECT date, wp, 0, 1, 0, 0 FROM games WHERE stage = 'regular' AND season = ?1 AND wp IS NOT NULL${only('fixture_id')}
       UNION ALL SELECT date, lp, 0, 0, 1, 0 FROM games WHERE stage = 'regular' AND season = ?1 AND lp IS NOT NULL${only('fixture_id')}
       UNION ALL SELECT date, sv, 0, 0, 0, 1 FROM games WHERE stage = 'regular' AND season = ?1 AND sv IS NOT NULL${only('fixture_id')}
     ) GROUP BY d, id`,
  )) {
    const l = decOf(day(r.d).dec, num(r.id));
    l.GS += num(r.GS);
    l.W += num(r.W);
    l.L += num(r.L);
    l.SV += num(r.SV);
  }
  for (const r of all(
    `SELECT date AS d, pitcher_id AS id, SUM(hld) AS HLD, SUM(bs) AS BS, SUM(qs) AS QS
       FROM pitcher_flags WHERE stage = 'regular' AND season = ?1${only('game_id')} GROUP BY date, pitcher_id`,
  )) {
    const l = decOf(day(r.d).dec, num(r.id));
    l.HLD += num(r.HLD);
    l.BS += num(r.BS);
    l.QS += num(r.QS);
  }
  return days;
}

const toBatting = (l: BatLine): BattingTotals => ({ G: l.G, PA: l.PA, AB: l.AB, H: l.H, '2B': l.D, '3B': l.T, HR: l.HR, RBI: l.RBI, R: l.R, BB: l.BB, HBP: l.HBP, SO: l.SO, SF: l.SF, SB: l.SB, CS: l.CS });
const toPitching = (l: PitLine, d: DecLine | undefined): PitchingTotals => ({
  G: l.G,
  GS: d?.GS ?? 0,
  OUTS: l.OUTS + l.PO,
  W: d?.W ?? 0,
  L: d?.L ?? 0,
  SV: d?.SV ?? 0,
  BF: l.BF,
  H: l.H,
  R: l.R,
  ER: l.ER,
  BB: l.BB,
  HBP: l.HBP,
  K: l.K,
  HR: l.HR,
  pitches: l.P,
});

/** 한 선수의 구단별 줄을 합친다. club이 있으면 그 구단 줄만 */
function pick<L extends object>(byClub: Map<ClubId, L> | undefined, club: ClubId | undefined, zero: () => L, keys: readonly (keyof L)[]): L | null {
  if (!byClub) return null;
  if (club !== undefined) return byClub.get(club) ?? null;
  if (byClub.size === 1) return byClub.values().next().value ?? null;
  const sum = zero();
  for (const l of byClub.values()) addInto(sum, l, keys);
  return sum;
}

/** 대상 선수 ID(오름차순, 중복 제거). ids가 없으면 기록이 있는 모든 선수 */
function targetIds(present: Iterable<PlayerId>, ids?: readonly PlayerId[]): PlayerId[] {
  const out = ids ? [...new Set(ids.map((x) => Math.trunc(Number(x))))] : [...present];
  return out.sort((a, b) => a - b);
}

/** 한 시즌(압축 전) 정규시즌 기록의 날짜별 줄과 누적 합계 */
export class SeasonStatsCache {
  private readonly days: Map<GameDate, DayStats>;
  private readonly total: DayStats = emptyDay();
  private first: GameDate | null = null;
  private last: GameDate | null = null;

  constructor(
    private readonly db: DatabaseSync,
    readonly season: number,
  ) {
    this.days = loadDays(db, season);
    for (const [d, s] of [...this.days].sort((a, b) => (a[0] < b[0] ? -1 : 1))) this.note(d, s);
  }

  private note(date: GameDate, s: DayStats): void {
    mergeDay(this.total, s);
    if (this.first === null || date < this.first) this.first = date;
    if (this.last === null || date > this.last) this.last = date;
  }

  /** 그날 확정한 정규시즌 경기 기록을 더한다(commitDay 안, 원시 기록을 넣은 뒤) */
  addDay(date: GameDate, fixtureIds: readonly number[]): void {
    const s = loadDays(this.db, this.season, fixtureIds).get(date);
    if (!s) return;
    const prev = this.days.get(date);
    if (prev) mergeDay(prev, s);
    else this.days.set(date, s);
    this.note(date, s);
  }

  /** 기간 [from, to]의 합계. 기록 전체를 덮으면 누적 합계를 그대로 쓴다 */
  private range(range?: { from: GameDate; to: GameDate }): DayStats {
    if (!range || this.first === null || (range.from <= this.first && range.to >= (this.last ?? range.to))) return this.total;
    const out = emptyDay();
    for (const [d, s] of this.days) if (d >= range.from && d <= range.to) mergeDay(out, s);
    return out;
  }

  batting(playerIds?: readonly PlayerId[], clubId?: ClubId, range?: { from: GameDate; to: GameDate }): Map<PlayerId, BattingTotals> {
    const src = this.range(range).bat;
    const out = new Map<PlayerId, BattingTotals>();
    for (const id of targetIds(src.keys(), playerIds)) {
      const l = pick(src.get(id), clubId, zeroBat, BAT_KEYS);
      // 원시 기록 집계는 타석이 있는 선수만 낸다(대주자 득점만 있는 줄은 빠진다)
      if (l && l.PA > 0) out.set(id, toBatting(l));
    }
    return out;
  }

  pitching(playerIds?: readonly PlayerId[], clubId?: ClubId, range?: { from: GameDate; to: GameDate }): Map<PlayerId, PitchingTotals> {
    const src = this.range(range);
    const out = new Map<PlayerId, PitchingTotals>();
    for (const id of targetIds(src.pit.keys(), playerIds)) {
      const l = pick(src.pit.get(id), clubId, zeroPit, PIT_KEYS);
      // 선발·승패·세이브는 구단과 무관하게 그 선수 전체 기록(원시 기록 집계와 같다)
      if (l && l.BF > 0) out.set(id, toPitching(l, src.dec.get(id)));
    }
    return out;
  }

  /** 시상용: 투수 합계 + 홀드·블론·QS */
  pitchingWithFlags(playerIds?: readonly PlayerId[], range?: { from: GameDate; to: GameDate }): Map<PlayerId, PitchingTotals & { HLD: number; BS: number; QS: number }> {
    const src = this.range(range);
    const out = new Map<PlayerId, PitchingTotals & { HLD: number; BS: number; QS: number }>();
    for (const id of targetIds(src.pit.keys(), playerIds)) {
      const l = pick(src.pit.get(id), undefined, zeroPit, PIT_KEYS);
      const d = src.dec.get(id);
      if (l && l.BF > 0) out.set(id, { ...toPitching(l, d), HLD: d?.HLD ?? 0, BS: d?.BS ?? 0, QS: d?.QS ?? 0 });
    }
    return out;
  }
}
