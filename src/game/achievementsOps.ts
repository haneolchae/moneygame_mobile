// 8c 업적 G~O 판정(D-184). 원천 기록(선수·수상·장부·관중·스폰서·결재·행동력·시설)으로만 판정한다.
// 누적 집합과 상태는 저장본 meta(achMemo)에 남긴다. 판정 함수(judge)는 achievements.ts가 넘긴다.
import type { GameDate } from '../engine/calendar';
import { weekIdFor as weekOf } from './week';
import { CLOSE_RULES } from './seasonClose';
import { FACILITY } from '../engine/config';
import { salaryCap } from '../engine/contracts';
import { FACILITY_KINDS } from '../engine/business';
import { clubHistory } from '../engine/data/history';
import { EOK } from '../engine/money';
import { battingRates } from '../engine/stats';
import { computeStandings } from '../engine/standings';
import { TEAMS } from '../engine/staff';
import type { ClubId, PlayerTruth } from '../engine/types';
import type { GameMeta, GameRepository } from './ports';

export interface AchMemo {
  draftDebut: number[];
  draftQual: number[];
  draftLate: number[];
  draftYoung: number[];
  sponsorIds: string[];
  brands: string[];
  lowSince: GameDate | null;
  crisisSeen: boolean;
  warned: boolean;
  warnedEver: boolean;
  novacancy: number[];
  budgetOk: number[];
  profit: number[];
  opProfit: number[];
  sellGames: number;
  sellCount: number;
  sellStreak: number;
  trade300: number[];
  /** 처음 본 날의 외국인 재계약 연차(재임 전 재계약은 세지 않는다) */
  foreignBase: Record<string, number>;
}
export const newMemo = (): AchMemo => ({ foreignBase: {}, trade300: [], draftDebut: [], draftQual: [], draftLate: [], draftYoung: [], sponsorIds: [], brands: [], lowSince: null, crisisSeen: false, warned: false, warnedEver: false, novacancy: [], budgetOk: [], profit: [], opProfit: [], sellGames: 0, sellCount: 0, sellStreak: 0 });

type Judge = (series: string, value: number, detail: (label: string) => string) => void;
type Flag = (series: string, cond: boolean, detail: string) => void;

export interface OpsCtx {
  repo: GameRepository;
  meta: GameMeta;
  date: GameDate;
  judge: Judge;
  flag: Flag;
  memo: AchMemo;
  /** 선수 목록(하루에 한 번만 읽는다) */
  players: () => PlayerTruth[];
  /** 우리 구단 소속 통산과 다른 구단 경력 여부(시즌 시작 전까지) */
  career: () => { seasons: Map<number, Set<number>>; otherClub: Set<number> };
  tenureFirst: number;
  sunday: boolean;
  seasonEnd: boolean;
  ksEnd: boolean;
  awardDay: boolean;
  /** 오늘 우리 홈 경기가 있었다 */
  homeGame: boolean;
  /** 장부 시즌이 막 끝났으면 그 시즌 */
  financeClosed: number | null;
}

const set = (arr: number[], v: number) => (arr.includes(v) ? arr : [...arr, v]);
const eok = (won: number) => won / EOK;

export function judgeOps(c: OpsCtx): void {
  const { repo, meta, date, judge, flag, memo } = c;
  const club = meta.userClubId;
  const season = meta.season;
  // 저장본 메타 전체는 판정하는 날에만 읽는다
  let freshCache: GameMeta | null = null;
  const F = () => (freshCache ??= repo.getMeta());
  const all = c.players;
  const games = () => Math.round((repo.getGames(season, 'regular').length * 2) / Math.max(1, repo.getClubs().length));

  // ───── 매주 일요일 ─────
  if (c.sunday) {
    // G 지명 선수 데뷔(우리 구단 소속 1군 출전)
    const drafted = all().filter((p) => p.draft?.clubId === club);
    if (drafted.length && F().mode === 'season') {
      const ids = drafted.map((p) => p.id);
      const bat = repo.battingTotals(season, ids, club);
      const pit = repo.pitchingTotals(season, ids, club);
      for (const p of drafted) if ((bat.get(p.id)?.G ?? 0) + (pit.get(p.id)?.G ?? 0) > 0) memo.draftDebut = set(memo.draftDebut, p.id);
    }
    judge('G_debut', memo.draftDebut.length, (l) => `${date} 지명 선수 1군 데뷔 ${l}명`);
    // H 트레이드·FA
    const trades = (F().tradeHistory ?? []).filter((t) => !t.ai && (t.clubA === club || t.clubB === club));
    judge('H_trade', trades.length, (l) => `${date} 트레이드 ${l}건`);
    const fa = faAll(repo, season);
    const external = fa.filter((e) => e.signedClub === club && e.originClub !== club);
    const stayed = fa.filter((e) => e.signedClub === club && e.originClub === club);
    judge('H_fa', external.length, (l) => `${date} 외부 FA 영입 ${l}명`);
    judge('H_stay', stayed.length, (l) => `${date} 내부 FA 잔류 ${l}명`);
    flag('H_franchise', stayed.some((e) => all().find((p) => p.id === e.playerId)?.career.franchise), '간판 선수 잔류 계약');
    const foreign = all().filter((p) => p.clubId === club && p.origin !== 'domestic');
    for (const p of foreign) if (memo.foreignBase[String(p.id)] === undefined) memo.foreignBase = { ...memo.foreignBase, [String(p.id)]: p.career.foreignRenewals };
    const renew = Math.max(0, ...foreign.map((p) => p.career.foreignRenewals - (memo.foreignBase[String(p.id)] ?? 0)));
    judge('H_foreign', renew, (l) => `${date} 외국인 선수 ${l}년 연속 재계약`);
    judge('H_persuade', all().filter((p) => p.career.persuadedSeason !== undefined && (p.clubId === club || p.retired)).length, (l) => `${date} 은퇴 설득 ${l}명`);
    const cr = c.career();
    // 재임 중 은퇴한 선수만
    const oneClub = all().filter((p) => p.retired && p.retired.season >= c.tenureFirst && !cr.otherClub.has(p.id) && (cr.seasons.get(p.id)?.size ?? 0) > 0);
    judge('H_oneclubRetire', oneClub.length, (l) => `${date} 원클럽맨 은퇴 ${l}명`);
    // I 시설
    const f = F().facilities?.[String(club)];
    if (f) {
      const levels = FACILITY_KINDS.reduce((a, k) => a + (f.levels[k] - 1), 0);
      flag('I_start', levels > 0 || f.projects.some((p) => p.payments.some((x) => x.paid)), `${date} 시설 첫 착공`);
      flag('I_done', levels > 0, `${date} 시설 첫 완공`);
      judge('I_levels', levels, (l) => `${date} 시설 완공 ${l}단계`);
      flag('I_max', FACILITY_KINDS.every((k) => f.levels[k] >= FACILITY.maxLevel), `${date} 모든 시설 최고 단계`);
      judge('I_approval', f.levels.stadium - 1, (l) => `${date} 지자체 승인 공사 완공 ${l}단계`);
    }
    // J 팬 반발 회복·캠페인
    const fan = F().fans?.[String(club)];
    if (fan?.lowSince) memo.lowSince = memo.lowSince ?? fan.lowSince;
    else if (memo.lowSince) {
      const days = (Date.parse(date) - Date.parse(memo.lowSince)) / 86_400_000;
      flag('J_recover', days <= 56, `${date} 팬 반발 ${Math.round(days / 7)}주 만에 회복`);
      memo.lowSince = null;
    }
    const campaigns = Object.values(F().campaignCounts ?? {}).reduce((a, m) => a + (m[String(club)] ?? 0), 0);
    judge('J_campaigns', campaigns, (l) => `${date} 캠페인 ${l}건`);
    // K 굿즈 누적·스폰서
    const merch = F().merch?.[String(club)];
    if (merch) {
      const sold: Record<string, number> = {};
      for (const t of Object.values(merch.totals)) for (const [k, v] of Object.entries(t)) sold[k] = (sold[k] ?? 0) + v.sold;
      const best = Math.max(0, ...Object.values(sold));
      judge('K_sku', best, (l) => `${date} 한 상품군 누적 ${best.toLocaleString('ko-KR')}개(${l})`);
    }
    for (const s of F().sponsors?.[String(club)] ?? []) {
      const id = `${s.signed}:${s.brand}:${s.slot}`;
      if (!memo.sponsorIds.includes(id)) memo.sponsorIds = [...memo.sponsorIds, id];
      if (!memo.brands.includes(s.brand)) memo.brands = [...memo.brands, s.brand];
    }
    judge('K_sponsorN', memo.sponsorIds.length, (l) => `${date} 스폰서 계약 ${l}건`);
    judge('K_brands', memo.brands.length, (l) => `${date} 계약 브랜드 ${l}곳`);
    // L 현금·위기·매각 수입
    const cash = eok(repo.cashBalance(club));
    judge('L_cash', cash, (l) => `${date} 현금 ${Math.floor(cash)}억(${l})`);
    if (F().cashCrisisSince) memo.crisisSeen = true;
    else if (memo.crisisSeen) {
      flag('L_crisis', true, `${date} 자금 위기 해제`);
      memo.crisisSeen = false;
    }
    let sales = 0;
    for (let y = c.tenureFirst - 1; y <= season; y++) for (const r of repo.ledgerByCategory(club, y)) if ((r.category === 'tradeCash' || r.category === 'faCompensation') && r.amount > 0) sales += r.amount;
    judge('L_sales', eok(sales), (l) => `${date} 선수 매각·이적료 수입 ${Math.round(eok(sales))}억(${l})`);
    // M 결재·레벨·행동력·조사·위기
    const approved = repo.getApprovals('approved').length;
    const rejected = repo.getApprovals('rejected').length;
    judge('M_approvals', approved + rejected, (l) => `${date} 결재 ${l}건 처리`);
    judge('M2_reject', rejected, (l) => `${date} 결재 반려 ${l}건`);
    judge('M_level', F().ownerLevel, (l) => `${date} 구단주 레벨 ${l}`);
    const weeks = repo.apWeeks().filter((w) => w.weekId < weekOf(date));
    judge('M2_ap', weeks.reduce((a, w) => a + w.used, 0), (l) => `${date} 행동력 누적 ${l}`);
    judge('M2_full', weeks.filter((w) => w.granted > 0 && w.used >= w.granted).length, (l) => `${date} 행동력을 다 쓴 주 ${l}주`);
    judge('M2_zero', weeks.filter((w) => w.used === 0).length, (l) => `${date} 완전 위임 ${l}주`);
    judge('M2_scout', repo.scoutingObservations(club), (l) => `${date} 직접 선수 조사 ${l}회`);
    judge('M2_oneRound', oneRoundSignings(repo, club), (l) => `${date} 첫 제안으로 FA 계약 ${l}건`);
    if ((F().goalMisses ?? 0) >= CLOSE_RULES.warnAfterMisses) memo.warned = memo.warnedEver = true;
    else if (memo.warned && (F().goalMisses ?? 0) === 0) {
      flag('M_escape', true, `${date} 성적 목표 경고 해제`);
      memo.warned = false;
    }
    const tenureSeasons = tenureCount(F());
    flag('M2_lv20in7', F().ownerLevel >= 20 && tenureSeasons <= 7, `${date} 재임 ${tenureSeasons}시즌 만에 레벨 ${F().ownerLevel}`);
  }

  // ───── 연속 매진(우리 홈 경기가 있던 날, 관중 집계 차이로) ─────
  const att = c.homeGame ? repo.getMetaValue<GameMeta['attendance']>('attendance')?.[String(season)]?.[String(club)] : undefined;
  if (att && att.games !== memo.sellGames) {
    if (att.games < memo.sellGames) memo.sellStreak = 0;
    else memo.sellStreak = att.sellouts - memo.sellCount === att.games - memo.sellGames ? memo.sellStreak + (att.games - memo.sellGames) : att.sellouts > memo.sellCount ? 1 : 0;
    memo.sellGames = att.games;
    memo.sellCount = att.sellouts;
    judge('J_sellStreak', memo.sellStreak, (l) => `${date} 홈 ${l}경기 연속 매진`);
  }

  // ───── 정규시즌 마지막 날 ─────
  if (c.seasonEnd) {
    const g = games();
    const qualPa = g * 3.1;
    const qualOuts = g * 3;
    const mine = all().filter((p) => p.clubId === club);
    const ids = mine.map((p) => p.id);
    const bat = repo.battingTotals(season, ids, club);
    const pit = repo.pitchingTotals(season, ids, club);
    // G 규정 진입·5라운드 이하·1~3년차·1순위
    for (const p of mine.filter((x) => x.draft?.clubId === club)) {
      const b = bat.get(p.id);
      const q = (b?.PA ?? 0) >= qualPa || (pit.get(p.id)?.OUTS ?? 0) >= qualOuts;
      if (q) memo.draftQual = set(memo.draftQual, p.id);
      if (q && p.draft!.round >= 5) memo.draftLate = set(memo.draftLate, p.id);
      if (season - p.draft!.year <= 3 && ((b?.HR ?? 0) >= 20 || (pit.get(p.id)?.W ?? 0) >= 10)) memo.draftYoung = set(memo.draftYoung, p.id);
      if (p.draft!.round === 1 && p.draft!.pick === 1) flag('G_first1', ((b?.PA ?? 0) >= qualPa && (battingRates(b!).OPS ?? 0) >= 0.85) || (pit.get(p.id)?.W ?? 0) >= 15, `${season} ${p.name} 1순위 활약`);
    }
    judge('G_qual', memo.draftQual.length, (l) => `${season} 지명 선수 규정 진입 ${l}명`);
    judge('G_late', memo.draftLate.length, (l) => `${season} 5라운드 이하 지명 선수 주전 ${l}명`);
    judge('G_young', memo.draftYoung.length, (l) => `${season} 1~3년차 활약 ${l}명`);
    // H 외국인 15승·30홈런, 트레이드 영입 즉시 효과, 방출 0
    for (const p of mine.filter((x) => x.origin !== 'domestic')) {
      flag('H_f15', (pit.get(p.id)?.W ?? 0) >= 15, `${season} ${p.name} ${pit.get(p.id)?.W ?? 0}승`);
      flag('H_f30', (bat.get(p.id)?.HR ?? 0) >= 30, `${season} ${p.name} ${bat.get(p.id)?.HR ?? 0}홈런`);
    }
    const acquired = new Set(acquiredIn(F(), club, season));
    const hit = [...acquired].filter((id) => ((bat.get(id)?.PA ?? 0) >= qualPa && (battingRates(bat.get(id)!).AVG ?? 0) >= 0.3) || (pit.get(id)?.W ?? 0) >= 10);
    for (const id of hit) memo.trade300 = set(memo.trade300, id);
    judge('H_trade300', memo.trade300.length, (l) => `${season} 트레이드 영입 즉시 효과 ${l}명`);
    const released = repo.getObligations().filter((o) => o.clubId === club && o.seasons.includes(season)).length;
    flag('H_noRelease', released === 0, `${season} 방출 0건`);
    // J 관중·매진·만족도·평균 관중 1위
    const attAll = F().attendance?.[String(season)] ?? {};
    const a = attAll[String(club)];
    if (a) {
      judge('J_att', a.total / 10_000, (l) => `${season} 홈 관중 ${Math.round(a.total / 10_000)}만(${l})`);
      judge('J_sellouts', a.sellouts, (l) => `${season} 매진 ${a.sellouts}경기(${l})`);
      const avg = (x: { total: number; games: number }) => x.total / Math.max(1, x.games);
      flag('J_avgTop', Object.values(attAll).every((x) => avg(a) >= avg(x)), `${season} 홈 평균 관중 ${Math.round(avg(a)).toLocaleString('ko-KR')}명 1위`);
      judge('K_ticket', eok(a.ticketWon), (l) => `${season} 입장 수입 ${Math.round(eok(a.ticketWon))}억(${l})`);
    }
    const sat = F().fans?.[String(club)]?.satisfaction;
    if (sat !== undefined) judge('J_sat', sat, (l) => `${season} 팬 만족도 ${Math.round(sat)}(${l})`);
    // K 굿즈 매출
    const mt = F().merch?.[String(club)]?.totals[String(season)];
    if (mt) {
      const rev = Object.values(mt).reduce((s, v) => s + v.revenueWon, 0);
      judge('K_merch', eok(rev), (l) => `${season} 굿즈 매출 ${Math.round(eok(rev))}억(${l})`);
    }
    // L 저비용 가을야구
    const table = computeStandings(repo.getClubs().map((x) => x.id), repo.getGames(season, 'regular'));
    const me = table.find((r) => r.clubId === club)!;
    const payroll = (id: ClubId) => all().filter((p) => p.clubId === id && !p.retired).reduce((s, p) => s + p.salary, 0);
    const cheap = [...repo.getClubs()].map((x) => x.id).sort((x, y) => payroll(x) - payroll(y)).slice(0, 3);
    flag('L_cheapPs', me.rank <= 5 && cheap.includes(club), `${season} 연봉 총액 하위 3개 구단으로 ${me.rank}위`);
    // M 공석 0·예산·재임·리빌딩·어려운 구단·세 구단
    const staff = repo.getStaff(club);
    if (TEAMS.every((t) => staff.some((x) => x.title === '팀장' && x.team === t.key))) memo.novacancy = set(memo.novacancy, season);
    judge('M_novacancy', memo.novacancy.length, (l) => `${season} 팀장 공석 0 ${l}시즌`);
    const plan = F().budgets?.[String(season)];
    const budgetOk = !plan || (['facility', 'marketing', 'merch'] as const).every((k) => 0 - (repo.ledgerByCategory(club, season).find((r) => r.category === ({ facility: 'facilityConstruction', marketing: 'marketing', merch: 'merchOrder' } as const)[k])?.amount ?? 0) <= plan.caps[k]) && payroll(club) <= plan.caps.payroll;
    if (budgetOk) memo.budgetOk = set(memo.budgetOk, season);
    judge('M2_budget', memo.budgetOk.length, (l) => `${season} 예산 안 시즌 ${l}`);
    const ts = tenureCount(F());
    judge('M_seasons', ts, (l) => `${season} 재임 ${l}시즌`);
    flag('M2_50', ts >= 50, `${season} 재임 ${ts}시즌`);
    const diff = repo.getClubs().find((x) => x.id === club)!.difficulty;
    const hard = diff === '어려움' || diff === '매우 어려움';
    flag('M2_hard10', hard && seasonsWith(F(), club) >= 10, `${season} ${diff} 구단 ${seasonsWith(F(), club)}시즌`);
    flag('M2_noWarn', ts >= 10 && !memo.warnedEver, `${season} 재임 ${ts}시즌 해임 경고 0`);
    const rb = F().rebuild?.declaredSeason ?? null;
    flag('M_rebuildPs', me.rank <= 5 && rb !== null && season - rb <= 3 && season > rb, `${season} 리빌딩 선언(${rb}) 뒤 ${me.rank}위`);
    const psClubs = new Set<number>(me.rank <= 5 ? [club] : []);
    for (const t of F().tenures ?? []) for (const st of allStandings(repo, t.clubId)) if (st.rank <= 5 && inTenure(t, st.season)) psClubs.add(t.clubId);
    flag('M2_threeClubs', psClubs.size >= 3, `${season} 가을야구 구단 ${psClubs.size}곳`);
    // N 창단 이래 최다승·최고 승률, 구단 기록
    const hist = clubHistory(club)?.seasons ?? [];
    const past = [...hist.map((h) => ({ w: h.wins ?? 0, pct: h.wins !== null && h.losses !== null ? h.wins / Math.max(1, h.wins + h.losses) : 0, y: h.year })), ...allStandings(repo, club).filter((s) => s.season < season).map((s) => ({ w: s.wins, pct: s.wins / Math.max(1, s.wins + s.losses), y: s.season }))];
    const pct = me.wins / Math.max(1, me.wins + me.losses);
    flag('N_mostW', past.length > 0 && past.every((p) => me.wins > p.w), `${season} ${me.wins}승 창단 이래 최다`);
    flag('N_bestPct', past.length > 0 && past.every((p) => pct > p.pct), `${season} 승률 ${pct.toFixed(3)} 창단 이래 최고`);
  }

  // ───── 한국시리즈 종료일 ─────
  if (c.ksEnd) {
    const champ = F().postseason?.champion === club;
    const payroll = all().filter((p) => p.clubId === club && p.origin === 'domestic').reduce((s, p) => s + p.salary, 0);
    flag('L_capTitle', champ && payroll <= salaryCap(season), `${season} 국내 연봉 ${Math.round(eok(payroll))}억으로 우승`);
    const sp = F().sponsorTotals?.[String(season)]?.[String(club)];
    if (sp !== undefined) judge('K_sponsorRev', eok(sp), (l) => `${season} 스폰서 수입 ${Math.round(eok(sp))}억(${l})`);
    if (champ) {
      const diff = repo.getClubs().find((x) => x.id === club)!.difficulty;
      flag('M_hardTitle', diff === '어려움' || diff === '매우 어려움', `${season} ${diff} 구단으로 우승`);
      flag('M_otherTitle', (F().tenures ?? []).length > 1, `${season} 두 번째 구단에서 우승`);
      const rb = F().rebuild?.declaredSeason ?? null;
      flag('M2_rebuildTitle', rb !== null && season - rb <= 5 && season > rb, `${season} 리빌딩 선언(${rb}) 뒤 우승`);
      const titles = allStandings(repo, club).filter((s) => s.postseason === '한국시리즈 우승' && s.season < season && s.season >= c.tenureFirst).map((s) => s.season);
      const last = titles.length ? Math.max(...titles) : null;
      flag('M2_dynasty2', last !== null && season - last >= 5, `${last} 우승 뒤 ${season} 다시 우승`);
      const realTitles = (clubHistory(club)?.seasons ?? []).filter((h) => h.postseason.includes('우승') && h.postseason.includes('한국시리즈')).length;
      flag('N_firstTitle', realTitles === 0 && titles.length === 0 && allStandings(repo, club).every((s) => s.season >= season || s.postseason !== '한국시리즈 우승'), `${season} 구단 첫 한국시리즈 우승`);
    }
  }

  // ───── 장부 시즌 마감(새 시즌 모드 시작일) ─────
  if (c.financeClosed !== null && c.financeClosed >= c.tenureFirst) {
    const y = c.financeClosed;
    const rows = repo.ledgerByCategory(club, y);
    const net = rows.filter((r) => r.category !== 'startCash').reduce((s, r) => s + r.amount, 0);
    const op = net - (rows.find((r) => r.category === 'parentSupport')?.amount ?? 0);
    // 재임 전 장부 시즌(시작 때의 짧은 2026 시즌)은 세지 않는다
    if (net > 0 && y >= c.tenureFirst) memo.profit = set(memo.profit, y);
    if (op > 0 && y >= c.tenureFirst) memo.opProfit = set(memo.opProfit, y);
    let run = 0;
    for (let s = y; s >= c.tenureFirst && memo.profit.includes(s); s--) run++;
    judge('L_profitRun', run, (l) => `${y} 장부 시즌 흑자 ${l}시즌 연속`);
    judge('L_op', eok(op), (l) => `${y} 영업이익 ${Math.round(eok(op))}억(${l})`);
    judge('L_noParent', memo.opProfit.length, (l) => `${y} 모기업 지원 없이 흑자 ${l}시즌`);
    const since = Math.max(c.tenureFirst, (F().emergencyUsedSeason ?? -1) + 1);
    judge('L_noEmergency', y - since + 1, (l) => `${y} 긴급 지원 없이 ${l}시즌`);
  }

  // ───── 수상(월요일·KBO 시상식 발표일) ─────
  if (c.awardDay) {
    const aw = repo.getAwards({ clubId: club });
    const count = (f: (k: string) => boolean) => aw.filter((a) => f(a.award)).length;
    const seasonAw = aw.filter((a) => a.season === season);
    const drafted = new Set(all().filter((p) => p.draft?.clubId === club).map((p) => p.id));
    const byDrafted = aw.filter((a) => a.playerId !== null && drafted.has(a.playerId));
    judge('G_roy', byDrafted.filter((a) => a.award === 'roy').length, (l) => `${date} 지명 선수 신인왕 ${l}명`);
    judge('G_title', byDrafted.filter((a) => a.award.startsWith('title_')).length, (l) => `${date} 지명 선수 타이틀 ${l}개`);
    judge('G_mvp', byDrafted.filter((a) => a.award === 'mvp').length, (l) => `${date} 지명 선수 MVP ${l}회`);
    const titles = aw.filter((a) => a.award.startsWith('title_'));
    const tradeTitles = titles.filter((a) => a.playerId !== null && acquiredIn(F(), club, a.season).includes(a.playerId)).length;
    judge('H_tradeTitle', tradeTitles, (l) => `${date} 트레이드 영입 선수 타이틀 ${l}`);
    const ext = faAll(repo, season).filter((e) => e.signedClub === club && e.originClub !== club);
    const faTitles = titles.filter((a) => ext.some((e) => e.playerId === a.playerId && a.season > e.offseason)).length;
    judge('H_faTitle', faTitles, (l) => `${date} FA 영입 선수 타이틀 ${l}개`);
    judge('O_titles', titles.length, (l) => `${date} 타이틀 ${l}개`);
    const st = seasonAw.filter((a) => a.award.startsWith('title_'));
    const batT = st.filter((a) => /^title_(AVG|HR|RBI|R|H|SB|OBP|SLG)$/.test(a.award)).length;
    const pitT = st.length - batT;
    flag('O_sweepBat', batT >= 4, `${season} 타자 타이틀 ${batT}개`);
    flag('O_sweepPit', pitT >= 3, `${season} 투수 타이틀 ${pitT}개`);
    flag('O_sweepAll', st.length >= 8, `${season} 타이틀 ${st.length}개`);
    judge('O_gg', count((k) => k === 'gg'), (l) => `${date} 골든글러브 ${l}명`);
    judge('O_ggSeason', seasonAw.filter((a) => a.award === 'gg').length, (l) => `${season} 골든글러브 ${l}명`);
    judge('O_mvp', count((k) => k === 'mvp'), (l) => `${date} MVP ${l}회`);
    judge('O_roy', count((k) => k === 'roy'), (l) => `${date} 신인왕 ${l}회`);
    judge('O_ksmvp', count((k) => k === 'ks_mvp'), (l) => `${date} 한국시리즈 MVP ${l}회`);
    flag('O_mvpRoy', seasonAw.some((a) => a.award === 'mvp') && seasonAw.some((a) => a.award === 'roy'), `${season} MVP·신인왕 동시 배출`);
    judge('O_mvpRepeat', longestRun(aw.filter((a) => a.award === 'mvp'), (a) => a.season), (l) => `${date} 같은 선수 MVP ${l}연속`);
    judge('O_defense', count((k) => k === 'defense'), (l) => `${date} 수비상 ${l}명`);
    judge('O_platinum', count((k) => k === 'platinum'), (l) => `${date} 플래티넘 글러브 ${l}회`);
    judge('O_pitcher', count((k) => k === 'pitcher'), (l) => `${date} 최우수 투수 ${l}회`);
    judge('O_reliever', count((k) => k === 'closer' || k === 'setup'), (l) => `${date} 최우수 구원 투수 ${l}회`);
    judge('O_comeback', count((k) => k === 'comeback'), (l) => `${date} 재기상 ${l}회`);
    judge('O_manager', count((k) => k === 'manager'), (l) => `${date} 감독상 ${l}회`);
    judge('O_front', count((k) => k === 'front'), (l) => `${date} 올해의 프런트 ${l}회`);
    judge('O_best', count((k) => k === 'best1' || k === 'best2'), (l) => `${date} 베스트 팀 ${l}명`);
    judge('O_best1Season', seasonAw.filter((a) => a.award === 'best1').length, (l) => `${season} 베스트 1팀 ${l}명`);
    judge('O_monthly', count((k) => k.startsWith('monthly_')), (l) => `${date} 월간 시상 ${l}회`);
    const monthIdx = (a: { slot: string }) => Number(a.slot.slice(0, 4)) * 12 + Number(a.slot.slice(5, 7));
    judge('O_monthlyRepeat', longestRun(aw.filter((a) => a.award === 'monthly_bat' || a.award === 'monthly_pit'), monthIdx), (l) => `${date} 같은 선수 월간 MVP ${l}개월 연속`);
    judge('O_milestone', count((k) => k === 'milestone'), (l) => `${date} 기록 달성상 ${l}회`);
    flag('O_grand', ['mvp', 'pitcher', 'roy', 'manager', 'front'].every((k) => seasonAw.some((a) => a.award === k)), `${season} MVP·최우수 투수·신인왕·감독상·올해의 프런트 모두 우리 구단`);
  }
}

/** 모든 스토브리그 FA 기록(게임 시작 스토브리그부터) */
function faAll(repo: GameRepository, season: number) {
  const out = [];
  for (let y = 2026; y <= season; y++) out.push(...repo.getFa(y));
  return out;
}

/** 그 시즌(앞 스토브리그 포함)에 트레이드로 데려온 선수 */
function acquiredIn(meta: GameMeta, club: ClubId, season: number): number[] {
  return (meta.tradeHistory ?? [])
    .filter((t) => !t.ai && (t.clubA === club || t.clubB === club) && (t.season === season || (t.period === 'stove' && t.season === season - 1)))
    .flatMap((t) => (t.clubA === club ? t.bToA : t.aToB));
}

/** 재임 시즌 합(정규시즌을 치른 시즌): 재임 기간 시작 연도 기준 */
function tenureCount(meta: GameMeta): number {
  let n = 0;
  for (const t of meta.tenures ?? []) {
    const first = firstSeasonOf(t.from);
    const last = t.to ? firstSeasonOf(t.to) - 1 : meta.season - (meta.mode === 'season' ? 0 : 0);
    n += Math.max(0, last - first + 1);
  }
  return n || meta.season - firstSeasonOf(meta.kDate) + 1;
}
const firstSeasonOf = (d: GameDate) => (Number(d.slice(5, 7)) >= 10 ? Number(d.slice(0, 4)) + 1 : Number(d.slice(0, 4)));
const inTenure = (t: { from: GameDate; to: GameDate | null }, season: number) => season >= firstSeasonOf(t.from) && (t.to === null || season < firstSeasonOf(t.to));
function seasonsWith(meta: GameMeta, club: ClubId): number {
  return (meta.tenures ?? []).filter((t) => t.clubId === club).reduce((a, t) => a + Math.max(0, (t.to ? firstSeasonOf(t.to) - 1 : meta.season) - firstSeasonOf(t.from) + 1), 0);
}
function allStandings(repo: GameRepository, club: ClubId) {
  const out = [];
  for (let y = 2027; y < 2200; y++) {
    const r = repo.getSeasonStandings(y);
    if (r.length === 0) break;
    const m = r.find((x) => x.clubId === club);
    if (m) out.push(m);
  }
  return out;
}

/** 같은 선수의 연속(시즌·월) 최장 */
function longestRun<T extends { playerId: number | null }>(rows: T[], idx: (r: T) => number): number {
  const by = new Map<number, number[]>();
  for (const r of rows) if (r.playerId !== null) by.set(r.playerId, [...(by.get(r.playerId) ?? []), idx(r)]);
  let best = 0;
  for (const list of by.values()) {
    const s = [...new Set(list)].sort((a, b) => a - b);
    let run = 1;
    for (let i = 0; i < s.length; i++) {
      run = i > 0 && s[i] === s[i - 1]! + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
  }
  return best;
}

/** 첫 제안으로 성사된 FA 계약 수(같은 오프시즌 그 선수에게 우리 제안이 하나뿐인데 수락) */
function oneRoundSignings(repo: GameRepository, club: ClubId): number {
  const offers = repo.getOffers({ clubId: club, kind: 'fa' });
  const accepted = offers.filter((o) => o.status === 'accepted');
  return accepted.filter((a) => offers.filter((o) => o.playerId === a.playerId && Math.abs(Date.parse(o.date) - Date.parse(a.date)) < 200 * 86_400_000).length === 1).length;
}

