// 순위 계산 (01 문서). 경기 결과에서 매번 계산하며 따로 저장하지 않는다.
// 승률 = 승 / (승 + 패), 무승부는 분모에서 제외. 동률은 상대 전적 → 득실차 → 추첨 시드 순.
// ASSUMPTION(D-056): 추첨 시드는 아직 정하지 않아 구단 ID 순서를 쓴다. 1위·5위 결정전은 포스트시즌 단계에서 구현한다.
import type { ClubId } from './types';

export interface GameScore {
  home: ClubId;
  away: ClubId;
  homeRuns: number;
  awayRuns: number;
}

export interface StandingRow {
  rank: number;
  clubId: ClubId;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number | null;
  gamesBehind: number;
  runsFor: number;
  runsAgainst: number;
  last10: string;
  streak: string;
}

export function computeStandings(clubIds: ClubId[], games: GameScore[]): StandingRow[] {
  const rows = new Map<ClubId, StandingRow & { results: Array<'W' | 'L' | 'T'> }>();
  for (const id of clubIds) {
    rows.set(id, { rank: 0, clubId: id, games: 0, wins: 0, losses: 0, ties: 0, pct: null, gamesBehind: 0, runsFor: 0, runsAgainst: 0, last10: '', streak: '', results: [] });
  }
  const h2h = new Map<string, number>(); // "a>b" → a가 b에게 이긴 수
  for (const g of games) {
    const home = rows.get(g.home)!;
    const away = rows.get(g.away)!;
    home.games++;
    away.games++;
    home.runsFor += g.homeRuns;
    home.runsAgainst += g.awayRuns;
    away.runsFor += g.awayRuns;
    away.runsAgainst += g.homeRuns;
    if (g.homeRuns > g.awayRuns) {
      home.wins++;
      away.losses++;
      home.results.push('W');
      away.results.push('L');
      h2h.set(`${g.home}>${g.away}`, (h2h.get(`${g.home}>${g.away}`) ?? 0) + 1);
    } else if (g.awayRuns > g.homeRuns) {
      away.wins++;
      home.losses++;
      away.results.push('W');
      home.results.push('L');
      h2h.set(`${g.away}>${g.home}`, (h2h.get(`${g.away}>${g.home}`) ?? 0) + 1);
    } else {
      home.ties++;
      away.ties++;
      home.results.push('T');
      away.results.push('T');
    }
  }
  const list = [...rows.values()];
  for (const r of list) {
    r.pct = r.wins + r.losses === 0 ? null : r.wins / (r.wins + r.losses);
    const last = r.results.slice(-10);
    r.last10 = `${last.filter((x) => x === 'W').length}승 ${last.filter((x) => x === 'L').length}패 ${last.filter((x) => x === 'T').length}무`;
    const tail = r.results[r.results.length - 1];
    let n = 0;
    for (let i = r.results.length - 1; i >= 0 && r.results[i] === tail; i--) n++;
    r.streak = tail ? `${n}${tail === 'W' ? '연승' : tail === 'L' ? '연패' : '무'}` : '';
  }
  const pctOf = (r: StandingRow) => r.pct ?? 0;
  list.sort((a, b) => {
    if (pctOf(b) !== pctOf(a)) return pctOf(b) - pctOf(a);
    const aw = h2h.get(`${a.clubId}>${b.clubId}`) ?? 0;
    const bw = h2h.get(`${b.clubId}>${a.clubId}`) ?? 0;
    if (aw !== bw) return bw - aw;
    const diff = b.runsFor - b.runsAgainst - (a.runsFor - a.runsAgainst);
    if (diff !== 0) return diff;
    return a.clubId - b.clubId;
  });
  const leader = list[0];
  list.forEach((r, i) => {
    r.rank = i + 1;
    r.gamesBehind = leader ? (leader.wins - r.wins + (r.losses - leader.losses)) / 2 : 0;
  });
  return list.map(({ results: _results, ...rest }) => rest);
}
