// 규칙 위반 검사. 장기 실행·테스트·자체 점검에서 같은 검사를 쓴다.
import { seasonKeyDates } from '../engine/schedule';
import { AI_CLUB, CLUTCH, DEVELOPMENT, FACILITY, LEAGUE, ROSTER_MOVE, SPONSOR, TRADE, TRAINING } from '../engine/config';
import { STANCES } from '../engine/aiClub';
import { weekIdFor } from '../game/week';
import { FACILITY_KINDS } from '../engine/business';
import { activePlan, planError } from '../engine/training';
import { devSnapshot, VELOCITY } from '../engine/development';
import { diffDays } from '../engine/calendar';
import { planProblems } from '../engine/lineup';
import { exhibitionDates } from '../game/rosterOps';
import { compositionViolations } from '../engine/roster';
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
    // 5b에서 찾은 결함 회귀 방지: 은퇴 선수는 소속이 없어야 한다(은퇴 고민 선수가 FA로 공시된 뒤 재계약되던 문제)
    if (p.retired && p.clubId !== null) errors.push(`은퇴 선수 소속 남음: ${p.id} ${p.name}(구단 ${p.clubId})`);
  }
  for (const c of clubs) {
    const mine = players.filter((p) => p.clubId === c.id);
    const active = mine.filter((p) => p.level === '1군');
    if (mine.length > LEAGUE.rosterMax) errors.push(`${c.name} 보유 ${mine.length}명 > ${LEAGUE.rosterMax}`);
    if (active.length !== LEAGUE.activeRoster) errors.push(`${c.name} 1군 ${active.length}명 ≠ ${LEAGUE.activeRoster}`);
  }

  errors.push(...checkRegularSeasons(repo));
  errors.push(...checkRosterComposition(repo));
  errors.push(...checkUserRoster(repo, season));
  errors.push(...checkDevelopment(repo));
  errors.push(...checkHealthPlay(repo, season));
  errors.push(...checkTraining(repo));
  errors.push(...checkBusiness(repo));
  errors.push(...checkAiClubs(repo));

  // 경기 기록 일관성: 득점 = 득점 기록 수, 타석 수 = 아웃 + 출루, 이닝 아웃 수
  const games = repo.getGames(season);
  const playerClub = new Map(players.map((p) => [p.id, p.clubId]));
  // 시즌 중 트레이드로 옮긴 선수는 경기 날짜 기준 소속으로 본다(거래는 그날 경기 전에 반영된다)
  const moves = new Map<number, Array<{ date: string; from: number }>>();
  for (const h of repo.getMeta().tradeHistory ?? []) {
    for (const id of h.aToB) moves.set(id, [...(moves.get(id) ?? []), { date: h.date, from: h.clubA }]);
    for (const id of h.bToA) moves.set(id, [...(moves.get(id) ?? []), { date: h.date, from: h.clubB }]);
  }
  const clubOn = (id: number, date: string) => {
    const first = moves.get(id)?.find((m) => m.date > date);
    return first ? first.from : playerClub.get(id);
  };
  for (const g of games) {
    const { pas, runs, fielding } = repo.getGameEvents(g.fixtureId);
    const homeRuns = runs.filter((r) => r.battingClub === g.home).length;
    const awayRuns = runs.filter((r) => r.battingClub === g.away).length;
    if (homeRuns !== g.homeRuns || awayRuns !== g.awayRuns) errors.push(`경기 ${g.fixtureId} 득점 불일치 (${g.homeRuns}:${g.awayRuns} vs ${homeRuns}:${awayRuns})`);
    const lineHome = g.lineScore.home.filter((x) => x >= 0).reduce((a, b) => a + b, 0);
    const lineAway = g.lineScore.away.reduce((a, b) => a + b, 0);
    if (lineHome !== g.homeRuns || lineAway !== g.awayRuns) errors.push(`경기 ${g.fixtureId} 이닝별 점수 합 불일치`);
    const rbi = pas.reduce((a, p) => a + p.rbi, 0);
    if (rbi > runs.length) errors.push(`경기 ${g.fixtureId} 타점(${rbi}) > 득점(${runs.length})`);
    // 4c-1(D-167 (7)): 투수 총 투구 수 = 타자가 본 투구 수 합(둘 다 타석별 투구 수에서 계산), 승부처 타석은 7회 이후·종료 조건에 맞는 투구 수
    let byPitcher = 0;
    let byBatter = 0;
    const pitcherSum = new Map<number, number>();
    const batterSum = new Map<number, number>();
    for (const pa of pas) {
      if (clubOn(pa.batterId, g.date) !== pa.battingClub) errors.push(`경기 ${g.fixtureId} 타자 소속 불일치 ${pa.batterId}`);
      if (clubOn(pa.pitcherId, g.date) === pa.battingClub) errors.push(`경기 ${g.fixtureId} 투수가 같은 팀 타자 상대 ${pa.pitcherId}`);
      if (pa.pitches < 1) errors.push(`경기 ${g.fixtureId} 타석 ${pa.seq} 투구 수 ${pa.pitches}`);
      pitcherSum.set(pa.pitcherId, (pitcherSum.get(pa.pitcherId) ?? 0) + pa.pitches);
      batterSum.set(pa.batterId, (batterSum.get(pa.batterId) ?? 0) + pa.pitches);
      if (pa.clutch) {
        if (pa.inning < CLUTCH.minInning) errors.push(`경기 ${g.fixtureId} 타석 ${pa.seq} 7회 전 승부처 타석`);
        const min = pa.outcome === 'BB' ? 4 : pa.outcome === 'K' ? 3 : 1;
        if (pa.pitches < min || pa.pitches > CLUTCH.maxPitches) errors.push(`경기 ${g.fixtureId} 타석 ${pa.seq} 승부처 투구 수 ${pa.pitches}(${pa.outcome})`);
      }
    }
    for (const v of pitcherSum.values()) byPitcher += v;
    for (const v of batterSum.values()) byBatter += v;
    if (byPitcher !== byBatter) errors.push(`경기 ${g.fixtureId} 투수 투구 수 합 ${byPitcher} ≠ 타자가 본 투구 수 합 ${byBatter}`);
    // 원정팀 아웃 수: 9이닝 이상 완료 경기는 이닝 수 × 3 (끝내기·말 공격 생략은 홈팀만 해당)
    const awayOuts = pas.filter((p) => p.half === 'T').reduce((a, p) => a + p.outsOnPlay, 0);
    if (awayOuts !== g.innings * 3) errors.push(`경기 ${g.fixtureId} 원정 아웃 ${awayOuts} ≠ ${g.innings * 3}`);
    if (g.homeRuns !== g.awayRuns) {
      if (!g.winningPitcher || !g.losingPitcher) errors.push(`경기 ${g.fixtureId} 승패 투수 누락`);
    }
    errors.push(...checkFielding(g.fixtureId, g.home, g.away, pas, runs, fielding));
  }
  return errors;
}

/**
 * 수비 기록 규칙(10b §11, D-102): 아웃마다 자살 1개, 팀 자살 = 팀 아웃, 보살은 아웃이 있는 플레이에만,
 * 병살은 아웃 2개, 희생플라이는 2아웃 미만에서 득점이 있는 뜬공 아웃에만.
 */
export function checkFielding(
  fixtureId: number,
  home: number,
  away: number,
  pas: ReturnType<GameRepository['getGameEvents']>['pas'],
  runs: ReturnType<GameRepository['getGameEvents']>['runs'],
  fielding: ReturnType<GameRepository['getGameEvents']>['fielding'],
): string[] {
  const errors: string[] = [];
  const bySeq = new Map<number, { po: number; a: number }>();
  for (const f of fielding) {
    const c = bySeq.get(f.seq) ?? { po: 0, a: 0 };
    if (f.kind === 'PO') c.po++;
    else if (f.kind === 'A') c.a++;
    bySeq.set(f.seq, c);
  }
  const runSeqs = new Set(runs.map((r) => r.seq));
  const teamOuts = new Map<number, number>([
    [home, 0],
    [away, 0],
  ]);
  let outsBefore = 0;
  let half = '';
  for (const pa of pas) {
    const key = `${pa.inning}${pa.half}`;
    if (key !== half) {
      half = key;
      outsBefore = 0;
    }
    const c = bySeq.get(pa.seq) ?? { po: 0, a: 0 };
    if (c.po !== pa.outsOnPlay) errors.push(`경기 ${fixtureId} 타석 ${pa.seq} 자살 ${c.po}개 ≠ 아웃 ${pa.outsOnPlay}개`);
    if (c.a > 0 && pa.outsOnPlay === 0) errors.push(`경기 ${fixtureId} 타석 ${pa.seq} 아웃 없는 보살`);
    if (pa.outcome === 'DP' && pa.outsOnPlay !== 2) errors.push(`경기 ${fixtureId} 타석 ${pa.seq} 병살인데 아웃 ${pa.outsOnPlay}개`);
    if (pa.outcome === 'SF' && (outsBefore >= 2 || !runSeqs.has(pa.seq))) errors.push(`경기 ${fixtureId} 타석 ${pa.seq} 희생플라이 조건 위반`);
    const defClub = pa.battingClub === home ? away : home;
    teamOuts.set(defClub, (teamOuts.get(defClub) ?? 0) + pa.outsOnPlay);
    outsBefore += pa.outsOnPlay;
  }
  for (const club of [home, away]) {
    const po = fielding.filter((f) => f.clubId === club && f.kind === 'PO').length;
    if (po !== teamOuts.get(club)) errors.push(`경기 ${fixtureId} 구단 ${club} 자살 ${po} ≠ 아웃 ${teamOuts.get(club)}`);
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

/** 포지션 최소 인원(D-098): 40인 투수·야수·포수, 1군 투수·야수. 1군 편성이 임시로 채운 경우도 여기서 미달로 드러난다. */
export function checkRosterComposition(repo: GameRepository): string[] {
  const players = repo.getPlayers();
  return repo.getClubs().flatMap((c) => compositionViolations(players.filter((p) => p.clubId === c.id)).map((v) => `${c.name} 포지션 최소 인원 미달: ${v}`));
}

/**
 * 2d 사용자 편성 규칙(D-120): 수동 계획이 1군과 맞는다, 개막 뒤 말소 선수는 10일 안에 재등록되지 않았다,
 * 시범경기는 정규 기록(경기 표)에 들어가지 않았고 날짜마다 5경기씩 치렀다.
 */
export function checkUserRoster(repo: GameRepository, season: number): string[] {
  const errors: string[] = [];
  const meta = repo.getMeta();
  const mine = repo.getPlayers().filter((p) => p.clubId === meta.userClubId && p.level === '1군');
  if (meta.userPlan?.mode === 'manual' && meta.userPlan.plan) {
    for (const e of planProblems(meta.userPlan.plan, mine, ROSTER_MOVE.rotationSize)) errors.push(`수동 운영 계획 불일치: ${e}`);
  }
  if (meta.season === season && meta.mode === 'season') {
    const opening = seasonKeyDates(season).opening;
    const lastDown = new Map<number, string>();
    for (const m of meta.rosterMoves ?? []) {
      if (m.to === '2군') {
        if (diffDays(m.date, opening) >= 0) lastDown.set(m.playerId, m.date);
        continue;
      }
      const down = lastDown.get(m.playerId);
      if (down && diffDays(m.date, down) < ROSTER_MOVE.reRegisterDays) errors.push(`재등록 제한 위반: 선수 ${m.playerId} ${down} 말소 → ${m.date} 등록`);
    }
    const ex = meta.exhibition;
    if (ex && ex.season === season) {
      const played = exhibitionDates(season).filter((d) => diffDays(d, meta.currentDate) < 0);
      for (const d of played) {
        const n = ex.games.filter((g) => g.date === d).length;
        if (n !== LEAGUE.clubs / 2) errors.push(`시범경기 ${d} ${n}경기 ≠ ${LEAGUE.clubs / 2}`);
      }
    }
  }
  if (repo.getGames(season).some((g) => g.fixtureId < 0)) errors.push('시범경기가 정규 경기 기록에 들어감');
  return errors;
}

/** 4a 사전 등록 기준 ④(D-124): 시즌 중 지난 결산 뒤 누적 변화가 월 상한 × 반영 달 수를 넘지 않는다. */
export function checkDevelopment(repo: GameRepository): string[] {
  const meta = repo.getMeta();
  if (meta.mode !== 'season') return [];
  const months = DEVELOPMENT.monthlyMonths.length;
  const errors: string[] = [];
  for (const p of repo.getPlayers()) {
    const base = p.dev?.base;
    if (p.retired || !base || !(p.dev!.season === undefined || p.dev!.season === meta.season - 1)) continue;
    const now = devSnapshot(p);
    for (const [k, b] of Object.entries(base)) {
      const limit = k === VELOCITY ? DEVELOPMENT.monthlyVelocityCap * months + 0.05 : DEVELOPMENT.monthlyCap * months;
      if (now[k] !== undefined && Math.abs(now[k]! - b) > limit) errors.push(`성장 월 상한 초과: 선수 ${p.id} ${k} ${b} → ${now[k]}`);
    }
  }
  return errors;
}

/**
 * 4b-2 사전 등록 ③(D-129): 유효 계획의 목표가 선수 유형과 맞고 주·보조가 다르며, 시즌당 월간 훈련 반영은 8회 이하,
 * AI 구단 계획 수는 한도 이하, 효과를 내는 계획은 소속 구단이 세운 것뿐이다(activePlan).
 */
export function checkTraining(repo: GameRepository): string[] {
  const meta = repo.getMeta();
  const errors: string[] = [];
  const aiCount = new Map<number, number>();
  for (const p of repo.getPlayers()) {
    if ((p.dev?.trainMonths ?? 0) > DEVELOPMENT.monthlyMonths.length) errors.push(`월간 훈련 반영 초과: 선수 ${p.id} ${p.dev!.trainMonths}회`);
    const plan = activePlan(p);
    if (!plan) continue;
    const err = planError(p, plan.primary, plan.secondary, plan.intensity);
    if (err) errors.push(`훈련 계획 오류: 선수 ${p.id} ${err}`);
    if (p.clubId !== meta.userClubId) aiCount.set(p.clubId!, (aiCount.get(p.clubId!) ?? 0) + 1);
  }
  for (const [clubId, n] of aiCount) if (n > TRAINING.aiPlans) errors.push(`AI 구단 ${clubId} 훈련 계획 ${n}명 > ${TRAINING.aiPlans}`);
  return errors;
}

/**
 * 6a 사전 등록 ①⑤(D-142): 관중은 좌석 수를 넘지 않는다. 시설 단계 1~5, 시설마다 진행 공사 1건 이하,
 * 공사는 현재 단계 + 1(완공 전 단계 반영 없음), 지급 일정 합계 = 공사비.
 */
export function checkBusiness(repo: GameRepository): string[] {
  const meta = repo.getMeta();
  const errors: string[] = [];
  const cap = new Map(repo.getClubs().map((c) => [String(c.id), c.stadiumCapacity]));
  for (const [season, byClub] of Object.entries(meta.attendance ?? {})) {
    for (const [id, t] of Object.entries(byClub)) {
      const c = cap.get(id) ?? 0;
      if (t.max > c || t.total > t.games * c) errors.push(`관중이 좌석 수 초과: ${season} 구단 ${id} 최대 ${t.max} > ${c}`);
      if (t.sellouts > t.games) errors.push(`매진 수 오류: ${season} 구단 ${id}`);
    }
  }
  // 6b 사전 등록 ①(D-148): 만족도 0~100, 종류별 진행 캠페인 1건 이하
  for (const [id, fan] of Object.entries(meta.fans ?? {})) if (!(fan.satisfaction >= 0 && fan.satisfaction <= 100)) errors.push(`팬 만족도 범위 오류: 구단 ${id} ${fan.satisfaction}`);
  for (const [id, list] of Object.entries(meta.campaigns ?? {})) {
    const live = list.filter((c) => c.end >= meta.currentDate).map((c) => c.kind);
    if (new Set(live).size !== live.length) errors.push(`캠페인 중복: 구단 ${id}`);
  }
  // 6d 사전 등록 ①(D-154): 재고·입고 예정 수량 0 이상, 누적 판매 ≤ 누적 입고
  for (const [id, m] of Object.entries(meta.merch ?? {})) {
    for (const [sku, st] of Object.entries(m.stock)) {
      if (!(st.qty >= 0)) errors.push(`굿즈 재고 음수: 구단 ${id} ${sku} ${st.qty}`);
      const sold = Object.values(m.totals).reduce((a, t) => a + (t[sku as keyof typeof t]?.sold ?? 0), 0);
      const received = Object.values(m.totals).reduce((a, t) => a + (t[sku as keyof typeof t]?.received ?? 0), 0);
      if (sold > received) errors.push(`굿즈 판매가 입고보다 많음: 구단 ${id} ${sku} ${sold} > ${received}`);
      if (received - sold !== st.qty) errors.push(`굿즈 재고 불일치: 구단 ${id} ${sku} 입고 ${received} − 판매 ${sold} ≠ 재고 ${st.qty}`);
    }
    if (m.orders.some((o) => !(o.qty > 0))) errors.push(`굿즈 발주 수량 오류: 구단 ${id}`);
  }
  // 6c 사전 등록 ①(D-150): 구단당 메인 1·서브 3 이하, 업종 중복 없음, 계약 시즌은 현재 또는 다음 시즌
  for (const [id, list] of Object.entries(meta.sponsors ?? {})) {
    for (const season of new Set(list.map((c) => c.season))) {
      const same = list.filter((c) => c.season === season);
      if (season !== meta.season && season !== meta.season + 1) errors.push(`스폰서 계약 시즌 오류: 구단 ${id} ${season}`);
      if (same.filter((c) => c.slot === 'main').length > SPONSOR.mainSlots || same.filter((c) => c.slot === 'sub').length > SPONSOR.subSlots) errors.push(`스폰서 슬롯 초과: 구단 ${id} ${season}`);
      if (new Set(same.map((c) => c.industry)).size !== same.length) errors.push(`스폰서 업종 중복: 구단 ${id} ${season}`);
    }
  }
  for (const [id, f] of Object.entries(meta.facilities ?? {})) {
    for (const kind of FACILITY_KINDS) {
      const level = f.levels[kind];
      if (!(level >= 1 && level <= FACILITY.maxLevel)) errors.push(`시설 단계 오류: 구단 ${id} ${kind} ${level}`);
      const ps = f.projects.filter((p) => p.kind === kind);
      if (ps.length > 1) errors.push(`시설 중복 공사: 구단 ${id} ${kind}`);
      for (const p of ps) {
        if (p.toLevel !== level + 1) errors.push(`공사 단계 오류: 구단 ${id} ${kind} ${level} → ${p.toLevel}`);
        if (p.payments.reduce((a, x) => a + x.amountWon, 0) !== p.costWon) errors.push(`공사 지급 합계 ≠ 공사비: 구단 ${id} ${kind}`);
      }
    }
  }
  return errors;
}

/** 선수별 출전 불가 기간(부상 발생 다음 날 ~ 복귀일 전날) */
/**
 * 7a AI 구단(D-155·D-156 ①): 모든 AI 구단이 유효한 운영 상태를 가진다, 트레이드로 옮긴 선수는 60일 안에 다시 거래되지 않았다,
 * AI 구단 간 거래는 리그 주 1건·구단별 기간(스토브리그·시즌)당 2건 이하다.
 */
export function checkAiClubs(repo: GameRepository): string[] {
  const errors: string[] = [];
  const meta = repo.getMeta();
  for (const c of repo.getClubs()) {
    if (c.id === meta.userClubId) continue;
    const s = meta.clubStance?.[String(c.id)];
    if (!s || !STANCES.includes(s.stance)) errors.push(`${c.name} 운영 상태 없음`);
  }
  const history = meta.tradeHistory ?? [];
  const last = new Map<number, string>();
  for (const h of history) {
    for (const id of [...h.aToB, ...h.bToA]) {
      const prev = last.get(id);
      if (prev && diffDays(h.date, prev) < TRADE.retradeLockDays) errors.push(`재트레이드 제한 위반: 선수 ${id} ${prev} → ${h.date}`);
      last.set(id, h.date);
    }
  }
  const perWeek = new Map<string, number>();
  const perClub = new Map<string, number>();
  for (const h of history.filter((x) => x.ai)) {
    const w = weekIdFor(h.date);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    for (const club of [h.clubA, h.clubB]) {
      const k = `${club}:${h.season}:${h.period}`;
      perClub.set(k, (perClub.get(k) ?? 0) + 1);
    }
    if (h.clubA === meta.userClubId || h.clubB === meta.userClubId) errors.push(`AI 간 거래에 우리 구단 포함: ${h.date}`);
  }
  // 7b(D-157·D-158 ①): 우리 구단에는 운영 상태가 없다, 받은 제안은 주 1건·기간당 4건·열린 제안 2건 이하, 같은 구단 30일 간격
  if (meta.clubStance?.[String(meta.userClubId)]) errors.push('우리 구단에 AI 운영 상태가 남아 있음');
  const offers = meta.tradeOffers ?? [];
  const offerWeek = new Map<string, number>();
  const offerPeriod = new Map<string, number>();
  const offerClub = new Map<number, string>();
  for (const o of offers) {
    const w = weekIdFor(o.date);
    offerWeek.set(w, (offerWeek.get(w) ?? 0) + 1);
    const k = `${o.season}:${o.period}`;
    offerPeriod.set(k, (offerPeriod.get(k) ?? 0) + 1);
    if (o.period === 'season') {
      const month = Number(o.date.slice(5, 7));
      if (month < AI_CLUB.offer.seasonFromMonth || month > AI_CLUB.offer.seasonToMonth) errors.push(`받은 제안 시즌 기간 위반: ${o.date}`);
      const mk = `m:${o.date.slice(0, 7)}`;
      offerPeriod.set(mk, (offerPeriod.get(mk) ?? 0) + AI_CLUB.offer.maxPerPeriod / AI_CLUB.offer.seasonPerMonth);
    }
    const prev = offerClub.get(o.clubId);
    if (prev && diffDays(o.date, prev) < AI_CLUB.offer.clubGapDays) errors.push(`받은 제안 구단 간격 위반: 구단 ${o.clubId} ${prev} → ${o.date}`);
    offerClub.set(o.clubId, o.date);
  }
  for (const [w, n] of offerWeek) if (n > 1) errors.push(`받은 제안 주 ${n}건(${w})`);
  for (const [k, n] of offerPeriod) if (n > AI_CLUB.offer.maxPerPeriod) errors.push(`받은 제안 기간 상한 초과: ${k} ${n}건`);
  if (offers.filter((o) => o.status === 'open').length > AI_CLUB.offer.maxOpen) errors.push('열린 받은 제안이 상한을 넘음');
  for (const [w, n] of perWeek) if (n > 1) errors.push(`AI 간 거래 주 ${n}건(${w})`);
  for (const [k, n] of perClub) if (n > AI_CLUB.trade.maxPerClubPeriod) errors.push(`AI 간 거래 구단별 상한 초과: ${k} ${n}건`);
  return errors;
}

function injuryWindows(repo: GameRepository): Map<number, Array<{ date: string; returnDate: string }>> {
  const out = new Map<number, Array<{ date: string; returnDate: string }>>();
  for (const p of repo.getPlayers()) {
    const list = [...(p.health?.history ?? []), ...(p.health?.injury ? [p.health.injury] : [])].map((h) => ({ date: h.date, returnDate: h.returnDate }));
    if (list.length) out.set(p.id, list);
  }
  return out;
}

/** 4b-1 사전 등록 ⑤(D-127): 부상 중인 선수는 경기에 나서지 않는다. */
export function checkHealthPlay(repo: GameRepository, season: number): string[] {
  const windows = injuryWindows(repo);
  const errors: string[] = [];
  for (const g of repo.getGames(season)) {
    const { pas } = repo.getGameEvents(g.fixtureId);
    for (const id of new Set(pas.flatMap((pa) => [pa.batterId, pa.pitcherId]))) {
      if ((windows.get(id) ?? []).some((w) => diffDays(g.date, w.date) > 0 && diffDays(g.date, w.returnDate) < 0)) errors.push(`부상 선수 출전: 선수 ${id} 경기 ${g.fixtureId}(${g.date})`);
    }
  }
  return errors;
}

/** 4b-1 사전 등록 ①~④ 측정(D-127): 정규시즌 구단당 평균 부상 건수·10일 이상·동시 부상 인원·시즌 아웃 */
export function injuryStats(repo: GameRepository, season: number) {
  const k = seasonKeyDates(season);
  const days = diffDays(k.regularSeasonEnd, k.opening) + 1;
  const clubs = repo.getClubs().length;
  let n = 0;
  let long = 0;
  let out = 0;
  let injuredDays = 0;
  for (const list of injuryWindows(repo).values()) {
    for (const w of list) {
      const len = diffDays(w.returnDate, w.date) - 1;
      if (diffDays(w.date, k.opening) >= 0 && diffDays(w.date, k.regularSeasonEnd) <= 0) {
        n++;
        if (len >= 10) long++;
        if (len >= 91) out++;
      }
      // 출전 불가 날짜와 정규시즌의 겹침
      const from = diffDays(w.date, k.opening) + 1;
      const to = diffDays(w.returnDate, k.opening) - 1;
      const lo = Math.max(0, from);
      const hi = Math.min(days - 1, to);
      if (hi >= lo) injuredDays += hi - lo + 1;
    }
  }
  return { perClub: +(n / clubs).toFixed(1), longPerClub: +(long / clubs).toFixed(1), concurrent: +(injuredDays / days / clubs).toFixed(2), seasonOutPerClub: +(out / clubs).toFixed(2) };
}
