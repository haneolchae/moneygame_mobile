// 규칙 위반 검사. 장기 실행·테스트·자체 점검에서 같은 검사를 쓴다.
import { LEAGUE } from '../engine/config';
import type { GameRepository } from '../game/ports';

export function checkInvariants(repo: GameRepository, season: number): string[] {
  const errors: string[] = [];
  const players = repo.getPlayers();
  const clubs = repo.getClubs();

  // 선수 ID 중복·소속 인원
  const ids = new Set<number>();
  for (const p of players) {
    if (ids.has(p.id)) errors.push(`선수 ID 중복: ${p.id}`);
    ids.add(p.id);
  }
  for (const c of clubs) {
    const mine = players.filter((p) => p.clubId === c.id);
    const active = mine.filter((p) => p.level === '1군');
    if (mine.length > LEAGUE.rosterMax) errors.push(`${c.name} 보유 ${mine.length}명 > ${LEAGUE.rosterMax}`);
    if (active.length !== LEAGUE.activeRoster) errors.push(`${c.name} 1군 ${active.length}명 ≠ ${LEAGUE.activeRoster}`);
  }

  // 경기 기록 일관성: 득점 = 득점 기록 수, 타석 수 = 아웃 + 출루, 이닝 아웃 수
  const games = repo.getGames(season);
  const playerClub = new Map(players.map((p) => [p.id, p.clubId]));
  for (const g of games) {
    const { pas, runs } = repo.getGameEvents(g.fixtureId);
    const homeRuns = runs.filter((r) => r.battingClub === g.home).length;
    const awayRuns = runs.filter((r) => r.battingClub === g.away).length;
    if (homeRuns !== g.homeRuns || awayRuns !== g.awayRuns) errors.push(`경기 ${g.fixtureId} 득점 불일치 (${g.homeRuns}:${g.awayRuns} vs ${homeRuns}:${awayRuns})`);
    const lineHome = g.lineScore.home.filter((x) => x >= 0).reduce((a, b) => a + b, 0);
    const lineAway = g.lineScore.away.reduce((a, b) => a + b, 0);
    if (lineHome !== g.homeRuns || lineAway !== g.awayRuns) errors.push(`경기 ${g.fixtureId} 이닝별 점수 합 불일치`);
    const rbi = pas.reduce((a, p) => a + p.rbi, 0);
    if (rbi > runs.length) errors.push(`경기 ${g.fixtureId} 타점(${rbi}) > 득점(${runs.length})`);
    for (const pa of pas) {
      if (playerClub.get(pa.batterId) !== pa.battingClub) errors.push(`경기 ${g.fixtureId} 타자 소속 불일치 ${pa.batterId}`);
      if (playerClub.get(pa.pitcherId) === pa.battingClub) errors.push(`경기 ${g.fixtureId} 투수가 같은 팀 타자 상대 ${pa.pitcherId}`);
    }
    // 원정팀 아웃 수: 9이닝 이상 완료 경기는 이닝 수 × 3 (끝내기·말 공격 생략은 홈팀만 해당)
    const awayOuts = pas.filter((p) => p.half === 'T').reduce((a, p) => a + p.outsOnPlay, 0);
    if (awayOuts !== g.innings * 3) errors.push(`경기 ${g.fixtureId} 원정 아웃 ${awayOuts} ≠ ${g.innings * 3}`);
    if (g.homeRuns !== g.awayRuns) {
      if (!g.winningPitcher || !g.losingPitcher) errors.push(`경기 ${g.fixtureId} 승패 투수 누락`);
    }
  }
  return errors;
}
