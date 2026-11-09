// 시즌 마감과 두 번째 스토브리그 전환 (22 문서, D-043·D-044·D-085).
// 한국시리즈가 끝난 날 같은 트랜잭션 안에서 실행한다.
import { addDays, diffDays, type GameDate } from '../engine/calendar';
import { advanceSchoolYear, asTruth, prospectScore } from '../engine/amateur';
import { UNDRAFTED_FA, WORLDGEN } from '../engine/config';
import { publicOverall } from '../engine/contracts';
import type { LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { addXp } from '../engine/owner';
import { Rng, type RngState } from '../engine/rng';
import { generateSchedule, seasonKeyDates, validateSchedule } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import { stoveEvents } from '../engine/stove';
import type { ClubId, PlayerTruth } from '../engine/types';
import { generateOverseasPool, overall } from '../engine/worldgen';
import { GameError } from '../shared/protocol';
import type { Draft } from './draft';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

/** ASSUMPTION(D-043·D-085): 목표·해임·파산·은퇴 수치 */
export const CLOSE_RULES = {
  /** 성적 기본·도전 목표, 포스트시즌 경험치 (02 문서) */
  xp: { base: 150, challenge: 100, postseason: 50, ksFinal: 50, ksTitle: 100 },
  warnAfterMisses: 2,
  dismissAfterMisses: 3,
  warnSupportCutBp: 1000,
  rebuildSeasons: 2,
  rebuildCooldown: 5,
  rebuildAp: 2,
  bankruptcyDays: 30,
  emergencyMin: 30 * EOK,
  /** FA 자격: 1군 출전 기준(정규시즌) */
  serviceMinPa: 150,
  serviceMinOuts: 120,
  faServiceYears: 8,
  reFaSeasons: 4,
  persuadeAp: 1,
  persuadeDays: 7,
} as const;

/**
 * ASSUMPTION(D-085): 파산 판정 적용 여부. 입장·스폰서·굿즈 등 사업 수입이 구현되기 전에는 모기업이 없는 구단이
 * 구조적으로 적자라서 판정을 보류한다(경고·기한 안내·긴급 지원은 동작). 사업 단계에서 true로 바꾼다.
 */
export const BANKRUPTCY = { enforced: false };

/** 나이별 기본 은퇴 확률 */
function ageRetireChance(age: number): number {
  if (age <= 30) return 0.003;
  if (age <= 33) return 0.03;
  const table: Record<number, number> = { 34: 0.08, 35: 0.15, 36: 0.25, 37: 0.4, 38: 0.55 };
  return table[age] ?? 0.75;
}

export class SeasonClose {
  constructor(
    private readonly repo: GameRepository,
    private readonly draft: Draft,
  ) {}

  /** 예상 순위: 직전 시즌 순위와 공개 전력(상위 9명 타자·투수)의 평균 (02 문서) */
  expectedRank(meta: GameMeta, clubId: ClubId, season: number): number {
    const clubs = this.repo.getClubs().map((c) => c.id);
    const players = this.repo.getPlayers();
    const strength = clubs.map((id) => {
      const mine = players.filter((p) => p.clubId === id);
      const top = (pitch: boolean) =>
        mine
          .filter((p) => p.isPitcher === pitch)
          .map((p) => publicOverall(meta.seed, p))
          .sort((a, b) => b - a)
          .slice(0, 9);
      const all = [...top(true), ...top(false)];
      return { id, s: all.reduce((a, b) => a + b, 0) / Math.max(1, all.length) };
    });
    strength.sort((a, b) => b.s - a.s || a.id - b.id);
    const sRank = strength.findIndex((x) => x.id === clubId) + 1;
    const prev = this.repo.getSeasonStandings(season - 1).find((s) => s.clubId === clubId)?.rank ?? sRank;
    return Math.max(1, Math.min(10, Math.round((sRank + prev) / 2)));
  }

  /** 한국시리즈가 끝난 날: 시즌 마감 → 스토브리그 */
  close(meta: GameMeta, date: GameDate): void {
    const season = meta.season;
    const inbox: InboxMessage[] = [];
    const ledger: LedgerEntry[] = [];
    const update: Partial<GameMeta> = {};
    const clubIds = this.repo.getClubs().map((c) => c.id);
    const table = computeStandings(clubIds, this.repo.getGames(season));
    const myRank = table.find((r) => r.clubId === meta.userClubId)!.rank;

    // 1) 시즌 목표 정산 (02 문서): 성적·포스트시즌 경험치, 연속 미달 경고·해임
    const expected = meta.seasonGoal?.season === season ? meta.seasonGoal.expectedRank : this.expectedRank(meta, meta.userClubId, season);
    const ps = meta.postseason;
    let xp = 0;
    const lines: string[] = [`정규시즌 ${myRank}위 (목표 ${expected}위 이내)`];
    const met = myRank <= expected;
    if (met) xp += CLOSE_RULES.xp.base;
    if (myRank <= expected - 2) xp += CLOSE_RULES.xp.challenge;
    if (ps?.seeds.includes(meta.userClubId)) xp += CLOSE_RULES.xp.postseason;
    const ks = ps?.series.find((s) => s.key === 'ks');
    if (ks && (ks.high === meta.userClubId || ks.low === meta.userClubId)) xp += CLOSE_RULES.xp.ksFinal;
    if (ps?.champion === meta.userClubId) xp += CLOSE_RULES.xp.ksTitle;
    const rebuilding = meta.rebuild && season >= meta.rebuild.from && season <= meta.rebuild.until;
    let misses = meta.goalMisses ?? 0;
    if (met || rebuilding) misses = 0;
    else misses += 1;
    update.goalMisses = misses;
    lines.push(met ? '성적 기본 목표 달성' : rebuilding ? '리빌딩 기간: 성적 목표 미달을 해임 판정에 넣지 않습니다' : `성적 기본 목표 미달 (연속 ${misses}시즌)`);
    const lv = addXp(meta.ownerLevel, meta.ownerXp, xp);
    update.ownerLevel = lv.level;
    update.ownerXp = lv.xp;
    lines.push(`시즌 목표 경험치 +${xp}${lv.level > meta.ownerLevel ? ` → 레벨 ${lv.level}` : ''}`);
    if (misses >= CLOSE_RULES.dismissAfterMisses) {
      update.gameOver = { kind: 'dismissed', date, reason: `성적 기본 목표를 ${misses}시즌 연속 달성하지 못해 모기업이 경영 책임을 물었습니다.` };
      inbox.push({ date, kind: 'task', sender: '모기업', title: '해임 통보', body: `${update.gameOver.reason}\n재임 기록은 명예의 전당에 남습니다.` });
    } else if (misses >= CLOSE_RULES.warnAfterMisses) {
      update.supportCutBp = { ...(meta.supportCutBp ?? {}), [String(season + 1)]: CLOSE_RULES.warnSupportCutBp };
      inbox.push({ date, kind: 'task', sender: '모기업', title: '최후통첩: 다음 시즌 지원 10% 삭감', body: `성적 기본 목표를 ${misses}시즌 연속 달성하지 못했습니다. 다음 시즌 모기업 지원금을 10% 줄입니다. 한 시즌 더 미달하면 해임합니다.\n스토브리그에 리빌딩을 선언하면 2시즌 동안 성적 판정을 유예합니다.` });
    }

    // 2) 선수 연차·FA 자격 (D-085)
    const players = this.repo.getPlayers();
    const bat = this.repo.battingTotals(season);
    const pit = this.repo.pitchingTotals(season);
    const changed: PlayerTruth[] = [];
    for (const p of players) {
      if (p.clubId === null || p.retired) continue;
      p.career.proSeasons += 1;
      if (p.origin === 'domestic') {
        const served = (bat.get(p.id)?.PA ?? 0) >= CLOSE_RULES.serviceMinPa || (pit.get(p.id)?.OUTS ?? 0) >= CLOSE_RULES.serviceMinOuts;
        if (served) p.career.faServiceYears += 1;
        p.career.faEligible = p.contractYears === 0 && p.career.faServiceYears >= CLOSE_RULES.faServiceYears && (p.career.lastFaSeason === undefined || season + 1 - p.career.lastFaSeason >= CLOSE_RULES.reFaSeasons);
      }
      p.career.franchise = false;
      changed.push(p);
    }
    // 우리 구단 간판: FA 자격자 중 가장 뛰어난 선수
    const star = changed.filter((p) => p.clubId === meta.userClubId && p.career.faEligible).sort((a, b) => overall(b) - overall(a))[0];
    if (star) star.career.franchise = true;

    // 3) 은퇴 (D-044): 다른 구단은 바로, 우리 구단은 1주 설득 기회
    const rng = Rng.derive(meta.seed, 'retire', season);
    const pending: NonNullable<GameMeta['retirementPending']> = [];
    const retiredNews: string[] = [];
    for (const p of changed) {
      if (p.origin !== 'domestic' || p.career.proSeasons <= 1) continue;
      const age = season - Number(p.birthDate.slice(0, 4));
      const ovr = overall(p);
      const pa = bat.get(p.id)?.PA ?? 0;
      const outs = pit.get(p.id)?.OUTS ?? 0;
      let chance = ageRetireChance(age);
      let reason = age >= 34 ? '자연 은퇴(나이)' : '개인 사유';
      if (age >= 30 && ovr < 42) (chance += 0.15), (reason = '기량 하락');
      if (age >= 29 && pa < 30 && outs < 30) (chance += 0.1), (reason = reason === '기량 하락' ? reason : '출전 기회 부족');
      chance += 0.004;
      if (p.contractYears > 0) chance *= 0.25;
      if (!rng.chance(Math.min(0.95, chance))) continue;
      if (p.clubId === meta.userClubId) {
        pending.push({ playerId: p.id, reason, deadline: addDays(date, CLOSE_RULES.persuadeDays) });
      } else {
        retiredNews.push(`${p.name}(${this.repo.getClubs().find((c) => c.id === p.clubId)?.shortName}, ${age}세, ${reason})`);
        p.retired = { season, reason };
        p.clubId = null;
        p.career.faEligible = false;
      }
    }
    this.repo.savePlayers(changed);
    if (pending.length) {
      update.retirementPending = pending;
      const byId = new Map(changed.map((p) => [p.id, p]));
      inbox.push({ date, kind: 'task', sender: '단장', title: `은퇴 고민 선수 ${pending.length}명`, body: `${pending.map((x) => `· ${byId.get(x.playerId)?.name} (${x.reason})`).join('\n')}\n${CLOSE_RULES.persuadeDays}일 안에 면담(행동력 ${CLOSE_RULES.persuadeAp})으로 한 시즌 더 뛰도록 설득할 수 있습니다. [계약·이적 > 선수단 정리]` });
    }
    if (retiredNews.length) inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${season} 시즌 은퇴 선수 ${retiredNews.length}명`, body: retiredNews.join('\n') });

    // 4) 신인 입단, 학년도 넘김, 해외 선수 풀 보충
    const rookies = this.draft.joinRookies(meta, date);
    ledger.push(...rookies.ledger);
    const myRookies = rookies.players.filter((p) => p.clubId === meta.userClubId);
    if (myRookies.length) inbox.push({ date, kind: 'report', sender: '스카우트팀', title: `신인 ${myRookies.length}명 입단`, body: myRookies.map((p) => `· ${p.draft?.round}라운드 ${p.name} (${p.draft?.school}, ${p.position})${p.honors?.length ? ` — ${p.honors.slice(-2).join(', ')}` : ''}`).join('\n') });
    let aid = this.repo.nextAmateurId();
    const school = advanceSchoolYear(meta.seed, this.repo.getAmateurs('active'), season + 1, () => aid++);
    this.repo.saveAmateurs(school.pool);
    const maxId = Math.max(0, ...this.repo.getPlayers().map((p) => p.id));
    this.repo.savePlayers(generateOverseasPool(Rng.derive(meta.seed, 'overseas', season), season, maxId + 1).slice(0, 18));
    // 국내 무소속 선수(D-099): 1년 동안 계약하지 못한 선수는 은퇴하고, 미지명 졸업자가 FA로 등록된다(포지션 최소 인원 보충의 공급원).
    const unsigned = this.repo.getPlayers().filter((p) => p.clubId === null && p.origin === 'domestic' && !p.retired);
    for (const p of unsigned) p.retired = { season, reason: '미계약' };
    this.repo.savePlayers(unsigned);
    let pid = maxId + 19;
    const undrafted = school.pool
      .filter((a) => a.status === 'gone' && !a.draft && prospectScore(a) >= (a.level === '대학' ? UNDRAFTED_FA.colMinScore : UNDRAFTED_FA.hsMinScore))
      .map((a): PlayerTruth => ({ ...asTruth(a), id: pid++, clubId: null, level: '2군', salary: WORLDGEN.minSalary, contractYears: 0, honors: a.honors.map((h) => h.title) }));
    this.repo.savePlayers(undrafted);
    const catchers = undrafted.filter((p) => p.position === 'C' && !p.isPitcher).length;
    inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${season} 미지명 선수 FA 등록 ${undrafted.length}명`, body: `드래프트에서 지명받지 못한 졸업자 ${undrafted.length}명(투수 ${undrafted.filter((p) => p.isPitcher).length}, 포수 ${catchers}, 야수 ${undrafted.length - catchers - undrafted.filter((p) => p.isPitcher).length})이 소속 없는 FA로 등록됐습니다. 1년 동안 계약하지 못한 무소속 선수 ${unsigned.length}명은 은퇴했습니다.` });

    // 5) 다음 시즌 일정·스토브리그 달력, 11월분 연봉 기준
    const next = season + 1;
    const scheduleRng = new Rng(meta.rngStreams.schedule as RngState);
    const fixtures = generateSchedule(next, scheduleRng, meta.nextFixtureId);
    const problems = validateSchedule(fixtures, next);
    if (problems.length) throw new GameError('SCHEDULE_INVALID', `일정 생성 오류: ${problems.slice(0, 3).join(', ')}`);
    const key = seasonKeyDates(next);
    this.repo.addCalendarEvents([
      ...stoveEvents(date),
      { date: key.opening, kind: 'opening', title: `${next} 정규시즌 개막`, body: '정규시즌이 개막합니다.' },
      { date: key.allStar, kind: 'allStar', title: '올스타전', body: '올스타전이 열립니다(기록 미반영).' },
      { date: key.regularSeasonEnd, kind: 'regularSeasonEnd', title: '정규시즌 종료', body: '정규시즌 마지막 날입니다.' },
    ]);
    const now = this.repo.getPlayers();
    update.salarySnapshot = Object.fromEntries(clubIds.map((id) => [String(id), now.filter((p) => p.clubId === id).map((p) => p.salary)]));
    this.repo.addFixtures(fixtures, { nextFixtureId: meta.nextFixtureId + fixtures.length, rngStreams: { ...meta.rngStreams, schedule: scheduleRng.state() } });
    update.mode = 'stove';
    update.kDate = date;
    update.draftBoard = [];
    inbox.push({ date, kind: 'report', sender: '비서', title: `${season} 시즌 결산 — 스토브리그 시작`, body: `${lines.join('\n')}\n은퇴 ${retiredNews.length}명(다른 구단), 신인 입단 ${rookies.players.length}명, 고교 졸업생 대학 진학 ${school.toCollege}명.\n내일부터 ${next} 시즌을 준비하는 스토브리그가 시작됩니다. FA 공시는 5일 뒤입니다.` });
    this.repo.addLedger(ledger);
    this.repo.addInbox(inbox);
    this.repo.updateMeta(update);
  }

  /** 매일: 은퇴 설득 기한, 파산 감시 (스토브리그 포함) */
  onDay(meta: GameMeta, date: GameDate): void {
    const update: Partial<GameMeta> = {};
    const inbox: InboxMessage[] = [];
    const pending = meta.retirementPending ?? [];
    const due = pending.filter((x) => diffDays(date, x.deadline) >= 0);
    if (due.length) {
      const players = this.repo.getPlayers();
      const gone: PlayerTruth[] = [];
      for (const x of due) {
        const p = players.find((q) => q.id === x.playerId);
        if (!p || p.clubId !== meta.userClubId) continue;
        p.retired = { season: meta.season, reason: x.reason };
        p.clubId = null;
        p.career.faEligible = false;
        gone.push(p);
      }
      this.repo.savePlayers(gone);
      update.retirementPending = pending.filter((x) => !due.includes(x));
      if (gone.length) inbox.push({ date, kind: 'report', sender: '단장', title: `은퇴 ${gone.length}명`, body: gone.map((p) => `· ${p.name} (${p.retired!.reason})`).join('\n') });
    }
    // 파산 (02 문서): 현금 0 미만 30일 미회복
    const cash = this.repo.cashBalance(meta.userClubId);
    if (cash < 0 && !meta.cashCrisisSince) {
      update.cashCrisisSince = date;
      inbox.push({ date, kind: 'task', sender: '사업본부장', title: '자금 위기: 현금이 0 아래로 내려갔습니다', body: `${CLOSE_RULES.bankruptcyDays}일 안에 현금을 0 이상으로 회복하지 못하면 파산합니다${BANKRUPTCY.enforced ? '' : '(사업 수입 구현 전까지 파산 판정은 보류 중)'}. 모기업 긴급 지원(시즌당 1회)을 요청하거나 비용을 줄이세요. [조직·위임 > 구단주 결정]` });
    } else if (cash >= 0 && meta.cashCrisisSince) {
      update.cashCrisisSince = null;
    } else if (BANKRUPTCY.enforced && cash < 0 && meta.cashCrisisSince && diffDays(date, meta.cashCrisisSince) >= CLOSE_RULES.bankruptcyDays && !meta.gameOver) {
      update.gameOver = { kind: 'bankrupt', date, reason: `현금이 ${CLOSE_RULES.bankruptcyDays}일 동안 0 아래에 머물러 구단이 파산했습니다.` };
      inbox.push({ date, kind: 'task', sender: '모기업', title: '파산', body: update.gameOver.reason });
    }
    if (inbox.length) this.repo.addInbox(inbox);
    if (Object.keys(update).length) this.repo.updateMeta(update);
  }

  persuade(meta: GameMeta, weekId: string, playerId: number) {
    const x = (meta.retirementPending ?? []).find((y) => y.playerId === playerId);
    if (!x) throw new GameError('NOT_AVAILABLE', '은퇴를 고민하는 선수가 아닙니다.');
    const p = this.repo.getPlayer(playerId)!;
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, CLOSE_RULES.persuadeAp);
      } catch {
        throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다.');
      }
      p.career.persuadedSeason = meta.season + 1;
      this.repo.savePlayers([p]);
      this.repo.updateMeta({ retirementPending: (meta.retirementPending ?? []).filter((y) => y.playerId !== playerId) });
      return { result: 'accept' as const, message: `${p.name} 선수가 한 시즌 더 뛰기로 했습니다.` };
    });
  }

  /** 모기업 긴급 지원 (시즌당 1회, 다음 시즌 지원금에서 차감) */
  emergency(meta: GameMeta, parentSupport: number) {
    if (parentSupport <= 0) throw new GameError('NOT_AVAILABLE', '모기업이 없는 구단은 긴급 지원을 받을 수 없습니다.');
    if (meta.emergencyUsedSeason === meta.season) throw new GameError('NOT_AVAILABLE', '이번 시즌 긴급 지원은 이미 받았습니다.');
    const cash = this.repo.cashBalance(meta.userClubId);
    const amount = Math.max(CLOSE_RULES.emergencyMin, Math.ceil((-cash + CLOSE_RULES.emergencyMin) / EOK) * EOK);
    this.repo.transaction(() => {
      this.repo.addLedger([{ clubId: meta.userClubId, date: meta.currentDate, category: 'parentSupport', amount, memo: '모기업 긴급 지원(다음 시즌 지원금에서 차감)' }]);
      const key = String(meta.season + 1);
      this.repo.updateMeta({ emergencyUsedSeason: meta.season, supportDeduction: { ...(meta.supportDeduction ?? {}), [key]: (meta.supportDeduction?.[key] ?? 0) + amount } });
    });
    return { result: 'accept' as const, message: `모기업이 ${Math.round(amount / EOK)}억을 긴급 지원했습니다. 다음 시즌 지원금에서 같은 금액을 줄입니다.` };
  }

  /** 리빌딩 선언 (스토브리그, 2시즌 성적 판정 유예, 5시즌 쿨다운) */
  declareRebuild(meta: GameMeta, weekId: string) {
    if (meta.mode !== 'stove') throw new GameError('NOT_AVAILABLE', '리빌딩은 스토브리그에만 선언할 수 있습니다.');
    if (meta.rebuild && meta.season + 1 - meta.rebuild.declaredSeason < CLOSE_RULES.rebuildCooldown) throw new GameError('NOT_AVAILABLE', `리빌딩은 ${CLOSE_RULES.rebuildCooldown}시즌에 한 번만 선언할 수 있습니다.`);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, CLOSE_RULES.rebuildAp);
      } catch {
        throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다.');
      }
      const from = meta.season + 1;
      this.repo.updateMeta({ rebuild: { declaredSeason: from, from, until: from + CLOSE_RULES.rebuildSeasons - 1 } });
      return { result: 'accept' as const, message: `${from}~${from + CLOSE_RULES.rebuildSeasons - 1} 시즌 리빌딩을 선언했습니다. 이 기간 성적 목표 미달은 해임 판정에 넣지 않습니다.` };
    });
  }
}
