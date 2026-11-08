// 정규시즌 일정 생성 (01 문서, D-007·D-010·D-035).
// - 상대별 3연전 4회(홈 2·원정 2) + 2연전 2회(홈 1·원정 1) = 16경기
// - 개막 주(토·일 2연전), 일반 주 16, 혼합 주 4, 2연전 주 4(시즌 마지막 4주), 올스타 주 1 = 144경기
// - 월요일 휴식, 경기일마다 5경기, 공동 구장 구단은 같은 날 동시 홈경기 금지
import { addDays, diffDays, mondayOf, nthWeekdayOfMonth, weekday, type GameDate } from './calendar';
import { CLUB_PROFILES } from './clubs';
import { LEAGUE, SCHEDULE } from './config';
import type { Rng } from './rng';
import type { ClubId, Fixture } from './types';

interface Pairing {
  home: ClubId;
  away: ClubId;
}
/** 한 시리즈 슬롯: 모든 구단이 한 번씩 등장하는 5개 대진 */
interface Slot {
  length: 2 | 3;
  pairings: Pairing[];
}
/** 달력 위치: 시리즈가 열리는 날짜들 */
interface SlotPosition {
  length: 2 | 3;
  dates: GameDate[];
}

export function seasonKeyDates(season: number) {
  const opening = nthWeekdayOfMonth(season, SCHEDULE.openingMonth, 6, SCHEDULE.openingSaturdayOrdinal);
  const allStar = nthWeekdayOfMonth(season, SCHEDULE.allStarMonth, 6, SCHEDULE.allStarSaturdayOrdinal);
  const firstFullWeek = addDays(mondayOf(opening), 7);
  const lastDay = addDays(firstFullWeek, SCHEDULE.fullWeeks * 7 - 1);
  return { opening, allStar, openingWeekMonday: mondayOf(opening), firstFullWeek, regularSeasonEnd: lastDay };
}

/** 원형(circle) 방식 라운드로빈: 9라운드 × 5대진 */
function roundRobin(teams: ClubId[]): Array<Array<[ClubId, ClubId]>> {
  const list = [...teams];
  const n = list.length;
  const rounds: Array<Array<[ClubId, ClubId]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Array<[ClubId, ClubId]> = [];
    for (let i = 0; i < n / 2; i++) round.push([list[i] as ClubId, list[n - 1 - i] as ClubId]);
    rounds.push(round);
    list.splice(1, 0, list.pop() as ClubId);
  }
  return rounds;
}

const pairKey = (a: ClubId, b: ClubId) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 대진 슬롯을 만들고 홈·원정을 정한다. 대진별 균형은 처음부터 맞추고, 공동 구장 충돌은 교환으로 없앤다. */
function buildSlots(rng: Rng): Slot[] {
  const teams = CLUB_PROFILES.map((c) => c.id);
  const slots: Slot[] = [];
  const addRoundRobins = (count: number, length: 2 | 3) => {
    for (let k = 0; k < count; k++) {
      const rounds = roundRobin(rng.shuffle([...teams]));
      for (const round of rng.shuffle(rounds)) {
        slots.push({ length, pairings: round.map(([a, b]) => ({ home: a, away: b })) });
      }
    }
  };
  addRoundRobins(SCHEDULE.threeGameMeetingsPerPair, 3);
  addRoundRobins(SCHEDULE.twoGameMeetingsPerPair, 2);

  // 대진·시리즈 길이별 등장 목록을 모아 홈을 절반씩 배정한다.
  const meetings = new Map<string, Pairing[]>();
  for (const slot of slots) {
    for (const p of slot.pairings) {
      const key = `${pairKey(p.home, p.away)}:${slot.length}`;
      const list = meetings.get(key) ?? [];
      list.push(p);
      meetings.set(key, list);
    }
  }
  for (const list of meetings.values()) {
    const [a, b] = [Math.min(list[0]!.home, list[0]!.away), Math.max(list[0]!.home, list[0]!.away)];
    const homes = rng.shuffle(list.map((_, i) => (i < list.length / 2 ? a : b)));
    list.forEach((p, i) => {
      p.home = homes[i] as ClubId;
      p.away = p.home === a ? b : a;
    });
  }

  // 공동 구장 충돌 해소: 같은 슬롯에서 두 구단이 모두 홈이면, 같은 대진·길이의 다른 등장과 홈을 맞바꾼다.
  const groups = new Map<string, ClubId[]>();
  for (const c of CLUB_PROFILES) {
    if (c.sharedStadiumGroup) groups.set(c.sharedStadiumGroup, [...(groups.get(c.sharedStadiumGroup) ?? []), c.id]);
  }
  const conflicts = () => {
    const found: Array<{ slot: Slot; team: ClubId }> = [];
    for (const slot of slots) {
      for (const members of groups.values()) {
        const homeMembers = members.filter((m) => slot.pairings.some((p) => p.home === m));
        if (homeMembers.length > 1) found.push({ slot, team: rng.pick(homeMembers) });
      }
    }
    return found;
  };
  for (let iter = 0; iter < 10_000; iter++) {
    const found = conflicts();
    if (found.length === 0) return slots;
    const { slot, team } = rng.pick(found);
    const p = slot.pairings.find((x) => x.home === team)!;
    const siblings = meetings.get(`${pairKey(p.home, p.away)}:${slot.length}`)!.filter((x) => x !== p && x.home !== p.home);
    if (siblings.length === 0) continue;
    const other = rng.pick(siblings);
    [p.home, p.away, other.home, other.away] = [p.away, p.home, other.away, other.home];
  }
  throw new Error('공동 구장 제약을 만족하는 일정을 만들지 못함');
}

/** 26주 달력 위치를 만든다. */
function buildPositions(season: number): SlotPosition[] {
  const { opening, allStar, firstFullWeek } = seasonKeyDates(season);
  const positions: SlotPosition[] = [{ length: 2, dates: [opening, addDays(opening, 1)] }];
  const allStarWeek = mondayOf(allStar);
  const weeks = Array.from({ length: SCHEDULE.fullWeeks }, (_, i) => addDays(firstFullWeek, i * 7));
  const twoGameWeeks = new Set(weeks.slice(-SCHEDULE.twoGameWeeksAtEnd));
  // 혼합 주: 4월·5월·8월 첫 주와 올스타 다음 주 (D-007)
  const mixedWeeks = new Set<GameDate>();
  for (const month of [4, 5, 8]) {
    const w = weeks.find((m) => Number(m.slice(5, 7)) === month && !twoGameWeeks.has(m) && m !== allStarWeek);
    if (w) mixedWeeks.add(w);
  }
  mixedWeeks.add(addDays(allStarWeek, 7));

  const d = (monday: GameDate, offset: number) => addDays(monday, offset); // 0=월 1=화 …
  for (const monday of weeks) {
    if (monday === allStarWeek) {
      positions.push({ length: 2, dates: [d(monday, 1), d(monday, 2)] });
    } else if (twoGameWeeks.has(monday)) {
      positions.push({ length: 2, dates: [d(monday, 1), d(monday, 2)] });
      positions.push({ length: 2, dates: [d(monday, 3), d(monday, 4)] });
      positions.push({ length: 2, dates: [d(monday, 5), d(monday, 6)] });
    } else if (mixedWeeks.has(monday)) {
      positions.push({ length: 2, dates: [d(monday, 1), d(monday, 2)] });
      positions.push({ length: 3, dates: [d(monday, 4), d(monday, 5), d(monday, 6)] });
    } else {
      positions.push({ length: 3, dates: [d(monday, 1), d(monday, 2), d(monday, 3)] });
      positions.push({ length: 3, dates: [d(monday, 4), d(monday, 5), d(monday, 6)] });
    }
  }
  return positions;
}

/** 직전 슬롯과 같은 대진이 가장 적게 겹치는 슬롯을 고른다 (연속 시리즈 회피, 소프트 제약). */
function takeBest(pool: Slot[], previous: Slot | undefined): Slot {
  let bestIndex = 0;
  let bestScore = Infinity;
  const prevKeys = new Set(previous?.pairings.map((p) => pairKey(p.home, p.away)) ?? []);
  pool.forEach((slot, i) => {
    const score = slot.pairings.filter((p) => prevKeys.has(pairKey(p.home, p.away))).length;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  return pool.splice(bestIndex, 1)[0] as Slot;
}

export function generateSchedule(season: number, rng: Rng, firstFixtureId: number): Fixture[] {
  const slots = buildSlots(rng);
  const positions = buildPositions(season);
  const pools = { 2: slots.filter((s) => s.length === 2), 3: slots.filter((s) => s.length === 3) };
  const fixtures: Fixture[] = [];
  let id = firstFixtureId;
  let seriesId = 1;
  let previous: Slot | undefined;
  for (const pos of positions) {
    const slot = takeBest(pools[pos.length], previous);
    previous = slot;
    for (const p of slot.pairings) {
      pos.dates.forEach((date, i) => {
        fixtures.push({ id: id++, season, date, home: p.home, away: p.away, seriesId, gameInSeries: i + 1 });
      });
      seriesId++;
    }
  }
  if (pools[2].length || pools[3].length) throw new Error('일정 슬롯과 달력 위치 수가 맞지 않음');
  return fixtures;
}

/** 일정 검증 (01 문서 완료 기준). 위반 목록을 돌려준다. */
export function validateSchedule(fixtures: Fixture[], season: number): string[] {
  const errors: string[] = [];
  const total = (LEAGUE.clubs * LEAGUE.gamesPerSeason) / 2;
  if (fixtures.length !== total) errors.push(`총 경기 수 ${fixtures.length} ≠ ${total}`);
  const games = new Map<ClubId, number>();
  const homes = new Map<ClubId, number>();
  const vs = new Map<string, { a: number; b: number }>();
  const byDate = new Map<GameDate, Fixture[]>();
  for (const f of fixtures) {
    games.set(f.home, (games.get(f.home) ?? 0) + 1);
    games.set(f.away, (games.get(f.away) ?? 0) + 1);
    homes.set(f.home, (homes.get(f.home) ?? 0) + 1);
    const key = pairKey(f.home, f.away);
    const rec = vs.get(key) ?? { a: 0, b: 0 };
    if (f.home < f.away) rec.a++;
    else rec.b++;
    vs.set(key, rec);
    byDate.set(f.date, [...(byDate.get(f.date) ?? []), f]);
    if (weekday(f.date) === 1) errors.push(`월요일 경기: ${f.date}`);
  }
  for (const c of CLUB_PROFILES) {
    if (games.get(c.id) !== LEAGUE.gamesPerSeason) errors.push(`${c.name} 경기 수 ${games.get(c.id)}`);
    if (homes.get(c.id) !== LEAGUE.gamesPerSeason / 2) errors.push(`${c.name} 홈 경기 수 ${homes.get(c.id)}`);
  }
  for (const [key, rec] of vs) {
    if (rec.a + rec.b !== LEAGUE.gamesPerOpponent || rec.a !== rec.b) errors.push(`${key} 상대 전적 일정 ${rec.a}/${rec.b}`);
  }
  for (const [date, list] of byDate) {
    if (list.length !== LEAGUE.clubs / 2) errors.push(`${date} 경기 수 ${list.length}`);
    const seen = new Set<ClubId>();
    for (const f of list) {
      for (const t of [f.home, f.away]) {
        if (seen.has(t)) errors.push(`${date} 구단 ${t} 하루 2경기`);
        seen.add(t);
      }
    }
    const shared = new Map<string, number>();
    for (const f of list) {
      const g = CLUB_PROFILES.find((c) => c.id === f.home)?.sharedStadiumGroup;
      if (g) shared.set(g, (shared.get(g) ?? 0) + 1);
    }
    for (const [g, n] of shared) if (n > 1) errors.push(`${date} 공동 구장(${g}) 동시 홈경기`);
  }
  const { opening, regularSeasonEnd } = seasonKeyDates(season);
  for (const f of fixtures) {
    if (diffDays(f.date, opening) < 0 || diffDays(f.date, regularSeasonEnd) > 0) errors.push(`정규시즌 기간 밖 경기: ${f.date}`);
  }
  return errors;
}
