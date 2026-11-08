// 규칙 위반 검사. 장기 실행·테스트·자체 점검에서 같은 검사를 쓴다.
import { seasonKeyDates } from '../engine/schedule';
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

  errors.push(...checkRegularSeasons(repo));

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

/**
 * 정규시즌 경기 수: 정규시즌 마지막 날 시즌 ID별로 기록한 값(meta.regularSeasons)이
 * 전 경기 완료(played = total)이고, 포스트시즌·다음 시즌 일정이 생긴 뒤에도 실제 기록과 같아야 한다.
 */
export function checkRegularSeasons(repo: GameRepository): string[] {
  const errors: string[] = [];
  const meta = repo.getMeta();
  const recorded = meta.regularSeasons ?? {};
  for (const [key, r] of Object.entries(recorded)) {
    const season = Number(key);
    const now = repo.countFixtures(season);
    const games = repo.getGames(season, 'regular').length;
    if (r.played !== r.total) errors.push(`${season} 정규시즌 미완료로 기록됨 (${r.played}/${r.total})`);
    if (now.total !== r.total || now.played !== r.played) errors.push(`${season} 정규시즌 경기 수가 기록 후 바뀜 (기록 ${r.played}/${r.total}, 현재 ${now.played}/${now.total})`);
    if (games !== r.played) errors.push(`${season} 정규시즌 경기 기록 ${games}건 ≠ 기록된 완료 경기 ${r.played}`);
  }
  // 정규시즌 마지막 날을 지난 시즌은 기록이 있어야 한다.
  for (let season = meta.season - (meta.mode === 'stove' ? 0 : 1); season >= meta.season - 1; season--) {
    if (repo.countFixtures(season).total === 0) continue;
    if (meta.currentDate > seasonKeyDates(season).regularSeasonEnd && !recorded[String(season)]) errors.push(`${season} 정규시즌이 끝났는데 경기 수 기록이 없음`);
  }
  return errors;
}

/** 40인 보유 한도: 모든 구단(우리 구단 포함)이 지켜야 한다. 스토브리그 명단 마감 뒤·시즌 중 검사용 */
export function checkRosterLimits(repo: GameRepository): string[] {
  const players = repo.getPlayers();
  return repo
    .getClubs()
    .map((c) => ({ c, n: players.filter((p) => p.clubId === c.id).length }))
    .filter((x) => x.n > LEAGUE.rosterMax)
    .map((x) => `${x.c.name} 보유 ${x.n}명 > ${LEAGUE.rosterMax}`);
}
