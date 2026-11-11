// 6e 예산 배분·특별 운영회의(D-176·D-177): 예산안 보관·검증, 재량 지출 한도 검사, 운영비 배수 효과, 특별 운영회의 보고.
// 한도 검사는 직접·위임 실행이 같은 함수를 부른다(지출 전에 검사하고, 실패하면 비용 없이 거부).
import type { ClubStance } from '../engine/aiClub';
import { aiOps, CAP_KINDS, defaultPlan, NEUTRAL_OPS, medicalBonus, OPS_KINDS, scoutingFactor, trainingFactor, validMultiplier, type BudgetPlan, type CapKind, type OpsKind } from '../engine/budget';
import { addDays, type GameDate } from '../engine/calendar';
import { BUDGET_PLAN as B } from '../engine/config';
import { FINANCE_BASE, inflate, scheduledEntries, type LedgerCategory } from '../engine/finance';
import { EOK } from '../engine/money';
import { compositionViolations } from '../engine/roster';
import { seasonModeStart } from '../engine/stove';
import type { ClubId, ClubProfile, PlayerTruth } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { GameMeta, GameRepository, InboxMessage, MeetingRecord } from './ports';
import { weekIdFor as weekOf } from './week';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);

export const CAP_LABEL: Record<CapKind, string> = { payroll: '선수 연봉 총액', facility: '시설 공사비', marketing: '마케팅 캠페인', merch: '굿즈 발주' };
export const OPS_LABEL: Record<OpsKind, string> = { scouting: '분석·스카우트 운영비', futures: '2군 운영비', teamOps: '선수단 운영비' };
export const OPS_BASE: Record<OpsKind, number> = { scouting: FINANCE_BASE.analysisScouting, futures: FINANCE_BASE.futuresOps, teamOps: FINANCE_BASE.teamOps };
const CAP_CATEGORY: Record<Exclude<CapKind, 'payroll'>, LedgerCategory> = { facility: 'facilityConstruction', marketing: 'marketing', merch: 'merchOrder' };

/** 다른 Ops가 지출 전에 부르는 한도 검사 */
export interface BudgetGuard {
  /** 이번 예산 연도 한도를 넘으면 사유, 아니면 null */
  spendError(meta: GameMeta, cap: Exclude<CapKind, 'payroll'>, amountWon: number): string | null;
  /** 시설 공사 지급 중 이번 예산 연도 안에 낼 몫 */
  inYear(meta: GameMeta, payments: Array<{ date: GameDate; amountWon: number }>): number;
  /** 선수 연봉 총액이 delta만큼 늘 때 한도를 넘으면 사유 */
  payrollError(meta: GameMeta, deltaWon: number): string | null;
}

export const NO_GUARD: BudgetGuard = { spendError: () => null, inYear: () => 0, payrollError: () => null };

export interface BudgetDeps {
  stance: (clubId: ClubId) => ClubStance | null;
  /** 오늘 출전 불가(부상 등)·피로 선수 */
  unavailable: (meta: GameMeta, players: PlayerTruth[]) => Set<number>;
  tired: (meta: GameMeta, players: PlayerTruth[]) => Set<number>;
  managerTrust: (clubId: ClubId) => number | null;
  /** 경영지원팀 처리량 차감(직접 50%) */
  chargeAdmin: (meta: GameMeta, weekId: string, fullWp: number) => void;
}

export class BudgetOps implements BudgetGuard {
  /** 하루 동안 쓰는 운영비 배수(구단별). 예산안을 바꾸거나 하루가 시작되면 버린다 */
  private opsCache = new Map<ClubId, Record<OpsKind, number>>();

  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly deps: BudgetDeps,
  ) {}

  reset(): void {
    this.opsCache.clear();
  }

  private inflation(meta: GameMeta, year: number): number {
    return inflate(EOK, year, meta.inflationBp) / EOK;
  }

  /** 그 예산 연도의 예산안(정하지 않았으면 기본안) */
  planFor(meta: GameMeta, year: number): BudgetPlan {
    return meta.budgets?.[String(year)] ?? defaultPlan(year, this.inflation(meta, year), meta.currentDate);
  }

  /** 지금 집행 중인 예산 연도(장부 시즌) */
  currentYear(meta: GameMeta): number {
    return meta.season;
  }

  /** 스토브리그에 정하는 다음 시즌 예산 연도. 시즌 중에는 없음 */
  planningYear(meta: GameMeta): number | null {
    return meta.mode === 'stove' ? meta.season + 1 : null;
  }

  /** 예산 연도 마지막 날(다음 시즌 모드 시작 전날) */
  private yearEnd(year: number): GameDate {
    return addDays(seasonModeStart(year), -1);
  }

  // ───────── 운영비 배수와 효과 ─────────

  ops(clubId: ClubId): Record<OpsKind, number> {
    const hit = this.opsCache.get(clubId);
    if (hit) return hit;
    // 메타 전체를 해석하지 않고 필요한 값만 읽는다(하루 처리 중 구단마다 부른다)
    const user = this.repo.getMetaValue<number>('userClubId');
    const v = clubId === user ? (this.repo.getMetaValue<Record<string, BudgetPlan>>('budgets')?.[String(this.repo.getMetaValue<number>('season'))]?.ops ?? NEUTRAL_OPS) : aiOps(this.deps.stance(clubId));
    this.opsCache.set(clubId, v);
    return v;
  }

  scoutingFactor(meta: GameMeta): number {
    return scoutingFactor(this.ops(meta.userClubId).scouting);
  }
  trainingFactor(clubId: ClubId): number {
    return trainingFactor(this.ops(clubId).futures);
  }
  medicalBonus(clubId: ClubId): number {
    return medicalBonus(this.ops(clubId).teamOps);
  }

  // ───────── 재량 지출 한도 ─────────

  /** 이번 예산 연도 집행액(시설은 그해 안에 지급할 미지급분 포함) */
  executed(meta: GameMeta, cap: Exclude<CapKind, 'payroll'>): number {
    const year = this.currentYear(meta);
    const spent = 0 - (this.repo.ledgerByCategory(meta.userClubId, year).find((r) => r.category === CAP_CATEGORY[cap])?.amount ?? 0);
    if (cap !== 'facility') return spent;
    const end = this.yearEnd(year);
    const reserved = (meta.facilities?.[String(meta.userClubId)]?.projects ?? []).reduce((a, p) => a + p.payments.filter((x) => !x.paid && x.date <= end).reduce((s, x) => s + x.amountWon, 0), 0);
    return spent + reserved;
  }

  /** 시설 공사 지급 중 이번 예산 연도 안에 지급할 몫 */
  inYear(meta: GameMeta, payments: Array<{ date: GameDate; amountWon: number }>): number {
    const end = this.yearEnd(this.currentYear(meta));
    return payments.filter((x) => x.date <= end).reduce((a, x) => a + x.amountWon, 0);
  }

  spendError(meta: GameMeta, cap: Exclude<CapKind, 'payroll'>, amountWon: number): string | null {
    const limit = this.planFor(meta, this.currentYear(meta)).caps[cap];
    const used = this.executed(meta, cap);
    if (used + amountWon <= limit) return null;
    return `${this.currentYear(meta)} 예산의 ${CAP_LABEL[cap]} 한도를 넘습니다(한도 ${won(limit)}, 집행·예약 ${won(used)}, 이번 ${won(amountWon)}). 특별 운영회의에서 예산을 고치세요.`;
  }

  /** 우리 구단 선수 연봉 총액(국내·외국인) */
  payroll(meta: GameMeta): number {
    return this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId && !p.retired).reduce((a, p) => a + p.salary, 0);
  }

  /** 연봉 한도를 판정하는 예산 연도: 스토브리그는 다음 시즌 */
  payrollYear(meta: GameMeta): number {
    return meta.mode === 'stove' ? meta.season + 1 : meta.season;
  }

  payrollError(meta: GameMeta, deltaWon: number): string | null {
    if (deltaWon <= 0) return null;
    const year = this.payrollYear(meta);
    const limit = this.planFor(meta, year).caps.payroll;
    const now = this.payroll(meta);
    if (now + deltaWon <= limit) return null;
    return `${year} 예산의 선수 연봉 총액 한도를 넘습니다(한도 ${won(limit)}, 현재 ${won(now)}, 늘어나는 연봉 ${won(deltaWon)}).${meta.mode === 'stove' && year !== meta.season ? ' 재정 화면에서 다음 시즌 예산안을 고치세요.' : ' 특별 운영회의에서 예산을 고치세요.'}`;
  }

  // ───────── 예산안 수립·수정 ─────────

  /** 예산안 검증(무료). 실패하면 사유를 던진다 */
  planTarget(meta: GameMeta, year: number, ops: Record<OpsKind, number>, caps: Record<CapKind, number>): { plan: BudgetPlan; kind: 'planning' | 'revision' } {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    const planning = this.planningYear(meta);
    const kind = year === planning ? 'planning' : year === this.currentYear(meta) ? 'revision' : null;
    if (!kind) throw new GameError('NOT_AVAILABLE', planning ? `${planning} 시즌 예산안(스토브리그) 또는 ${this.currentYear(meta)} 예산 수정만 할 수 있습니다.` : `${this.currentYear(meta)} 예산 수정만 할 수 있습니다.`);
    if (kind === 'revision' && !this.meetingThisWeek(meta)) throw new GameError('MEETING_REQUIRED', '이번 예산 연도 수정은 이번 주 특별 운영회의를 연 뒤에 할 수 있습니다.');
    for (const k of OPS_KINDS) if (!validMultiplier(ops[k])) throw new GameError('INVALID', `${OPS_LABEL[k]} 배수는 ${B.minMultiplier}~${B.maxMultiplier}, ${B.multiplierStep} 단위입니다.`);
    for (const k of CAP_KINDS) if (!Number.isInteger(caps[k]) || caps[k] < 0 || caps[k] % B.capStepWon !== 0) throw new GameError('INVALID', `${CAP_LABEL[k]} 한도는 0 이상 ${won(B.capStepWon)} 단위입니다.`);
    // 다음 시즌 예산안: 그해에 낼 이월 시설 지급분보다 시설 한도를 낮게 잡을 수 없다
    if (kind === 'planning') {
      const end = this.yearEnd(year);
      const carried = (meta.facilities?.[String(meta.userClubId)]?.projects ?? []).reduce((a, p) => a + p.payments.filter((x) => !x.paid && x.date > this.yearEnd(year - 1) && x.date <= end).reduce((s, x) => s + x.amountWon, 0), 0);
      if (caps.facility < carried) throw new GameError('BELOW_EXECUTED', `${year} 시즌에 낼 시설 공사비 ${won(carried)}보다 시설 한도를 낮게 잡을 수 없습니다.`);
    }
    if (kind === 'revision') {
      for (const k of ['facility', 'marketing', 'merch'] as const) {
        const used = this.executed(meta, k);
        if (caps[k] < used) throw new GameError('BELOW_EXECUTED', `${CAP_LABEL[k]} 한도를 이미 집행·예약한 ${won(used)}보다 낮출 수 없습니다.`);
      }
    }
    return { plan: { year, ops: { ...ops }, caps: { ...caps }, setBy: 'owner', date: meta.currentDate }, kind };
  }

  /** 예산안 확정: 다음 시즌 예산안은 그 주 첫 확정에 행동력 1 + 경영지원팀 처리량, 이번 연도 수정은 회의 뒤 무료 */
  setPlan(meta: GameMeta, weekId: string, year: number, ops: Record<OpsKind, number>, caps: Record<CapKind, number>): { message: string; apCharged: number } {
    const { plan, kind } = this.planTarget(meta, year, ops, caps);
    return this.repo.transaction(() => {
      let ap = 0;
      const cur = this.repo.getMeta();
      const paidWeeks = cur.budgetPlanWeeks ?? [];
      if (kind === 'planning' && !paidWeeks.includes(weekId)) {
        try {
          this.repo.spendAp(weekId, B.planAp);
        } catch {
          throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(예산안 수립 행동력 ${B.planAp}).`);
        }
        this.deps.chargeAdmin(meta, weekId, B.planWp);
        ap = B.planAp;
      }
      this.repo.updateMeta({
        budgets: { ...(cur.budgets ?? {}), [String(year)]: plan },
        ...(ap ? { budgetPlanWeeks: [...paidWeeks.slice(-8), weekId] } : {}),
      });
      this.reset();
      const what = kind === 'planning' ? `${year} 시즌 예산안을 확정했습니다` : `${year} 예산을 수정했습니다`;
      return { message: `${what}${ap ? `(행동력 ${ap})` : ''}. ${OPS_KINDS.map((k) => `${OPS_LABEL[k]} ${plan.ops[k]}배`).join(', ')}.`, apCharged: ap };
    });
  }

  /** 시즌 모드 시작: 새 예산 연도 예산안이 없으면 경영지원팀이 직전 예산안으로 편성한다 */
  onSeasonStart(meta: GameMeta, season: number, date: GameDate): { budgets: Record<string, BudgetPlan>; inbox: InboxMessage[] } | null {
    const all = { ...(meta.budgets ?? {}) };
    if (all[String(season)]) return null;
    const prev = all[String(season - 1)];
    const base = defaultPlan(season, this.inflation(meta, season), date);
    const plan: BudgetPlan = prev ? { ...base, ops: { ...prev.ops } } : base;
    // 이월된 시설 지급분(이번 예산 연도에 낼 몫)보다 한도가 낮으면 맞춘다
    const end = this.yearEnd(season);
    const carried = (meta.facilities?.[String(meta.userClubId)]?.projects ?? []).reduce((a, p) => a + p.payments.filter((x) => !x.paid && x.date <= end).reduce((s, x) => s + x.amountWon, 0), 0);
    plan.caps.facility = Math.max(plan.caps.facility, Math.ceil(carried / B.capStepWon) * B.capStepWon);
    all[String(season)] = plan;
    this.reset();
    return {
      budgets: all,
      inbox: [{ date, kind: 'report', sender: '경영지원팀', title: `${season} 시즌 예산 편성`, body: `구단주 예산안이 없어 ${prev ? '직전 예산안의 운영비 배수와 ' : ''}기본 한도로 편성했습니다. 연봉 총액 ${won(plan.caps.payroll)}, 시설 ${won(plan.caps.facility)}, 캠페인 ${won(plan.caps.marketing)}, 굿즈 발주 ${won(plan.caps.merch)}. 시즌 중 수정은 특별 운영회의에서 합니다.` }],
    };
  }

  // ───────── 특별 운영회의 ─────────

  meetingThisWeek(meta: GameMeta, weekId = weekOf(meta.currentDate)): MeetingRecord | null {
    return (meta.meetings ?? []).find((m) => m.weekId === weekId) ?? null;
  }

  meetingTarget(meta: GameMeta, weekId: string): void {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if (this.meetingThisWeek(meta, weekId)) throw new GameError('DUPLICATE', '이번 주 특별 운영회의를 이미 열었습니다. 보고는 재정 화면에 남아 있습니다.');
  }

  /** 특별 운영회의: 행동력 1, 주 1회. 재무·감독·단장 안건을 실제 원장·명단에서 만든다 */
  convene(meta: GameMeta, weekId: string): { message: string; meeting: MeetingRecord } {
    this.meetingTarget(meta, weekId);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, B.meetingAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(특별 운영회의 행동력 ${B.meetingAp}).`);
      }
      const meeting = this.report(meta, weekId);
      const cur = this.repo.getMeta();
      this.repo.updateMeta({ meetings: [...(cur.meetings ?? []), meeting].slice(-B.meetingKeep) });
      return { message: '특별 운영회의를 열었습니다. 이번 주에는 이번 예산 연도 예산을 고칠 수 있습니다.', meeting };
    });
  }

  /** 회의 보고(저장용 문장과 숫자) */
  report(meta: GameMeta, weekId: string): MeetingRecord {
    const club = this.clubs.get(meta.userClubId)!;
    const year = this.currentYear(meta);
    const plan = this.planFor(meta, year);
    const cash = this.repo.cashBalance(meta.userClubId);
    // 재무: 앞으로 365일 확정 항목(정기 수입·지출, 선수·직원 급여, 시설 지급) 전망. 입장·굿즈·스폰서 등 변동 수입은 넣지 않는다
    const players = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId && !p.retired);
    const staffPayroll = this.repo.getStaff(meta.userClubId).reduce((a, s) => a + s.salary, 0);
    const homeDates = new Map<string, number>();
    for (const f of this.repo.getFixtures(meta.season)) if (!f.played && f.home === meta.userClubId) homeDates.set(f.date, (homeDates.get(f.date) ?? 0) + 1);
    let fixedIn = 0;
    let fixedOut = 0;
    for (let i = 0; i < 365; i++) {
      const date = addDays(meta.currentDate, i);
      for (const e of scheduledEntries({ date, seasonYear: meta.season, inflationBp: meta.inflationBp, club, salaries: players.map((p) => p.salary), releasedSalaries: [], staffPayroll, homeGamesToday: homeDates.get(date) ?? 0, ops: plan.ops })) {
        if (e.amount > 0) fixedIn += e.amount;
        else fixedOut -= e.amount;
      }
    }
    const facilityDue = (meta.facilities?.[String(meta.userClubId)]?.projects ?? []).reduce((a, p) => a + p.payments.filter((x) => !x.paid).reduce((s, x) => s + x.amountWon, 0), 0);
    fixedOut += facilityDue;
    const execution = (['facility', 'marketing', 'merch'] as const).map((k) => ({ cap: k, label: CAP_LABEL[k], limit: plan.caps[k], used: this.executed(meta, k) }));
    const payroll = this.payroll(meta);
    // 감독: 부상·피로·1군 구성·신뢰도
    const out = this.deps.unavailable(meta, players);
    const tired = this.deps.tired(meta, players.filter((p) => p.level === '1군'));
    const trust = this.deps.managerTrust(meta.userClubId);
    // 단장: 올해 계약 만료(마지막 해)·FA 자격·연봉 총액 대비 한도
    const expiring = players.filter((p) => p.contractYears === 0 && p.origin === 'domestic');
    const fa = players.filter((p) => p.career.faEligible);
    const payrollYear = this.payrollYear(meta);
    const payrollLimit = this.planFor(meta, payrollYear).caps.payroll;
    const names = (ps: PlayerTruth[]) => (ps.length ? ps.slice(0, 6).map((p) => p.name).join(', ') + (ps.length > 6 ? ` 외 ${ps.length - 6}명` : '') : '없음');
    return {
      weekId,
      date: meta.currentDate,
      cashWon: cash,
      fixedInWon: fixedIn,
      fixedOutWon: fixedOut,
      payrollWon: payroll,
      payrollLimitWon: payrollLimit,
      execution,
      items: [
        { who: '재무 책임자', text: `현금 ${won(cash)}. 앞으로 1년 확정 수입 ${won(fixedIn)}, 확정 지출 ${won(fixedOut)}(시설 미지급 ${won(facilityDue)} 포함) → 변동 수입 없이 ${won(cash + fixedIn - fixedOut)}. 입장·굿즈·스폰서 등 변동 수입은 넣지 않았습니다.` },
        { who: '재무 책임자', text: `${year} 예산 집행: ${execution.map((x) => `${x.label} ${won(x.used)} / ${won(x.limit)}`).join(', ')}.` },
        { who: '감독', text: `출전 불가 ${out.size}명(${names(players.filter((p) => out.has(p.id)))}), 1군 피로 누적 ${tired.size}명(${names(players.filter((p) => tired.has(p.id)))}).${trust !== null ? ` 감독 신뢰도 ${Math.round(trust)}.` : ''}` },
        { who: '감독', text: (() => { const v = compositionViolations(players); return v.length ? `선수단 구성 경고: ${v.join(', ')}.` : '1군·40인 구성 최소 인원은 채웠습니다.'; })() },
        { who: '단장', text: `올해 계약이 끝나는 국내 선수 ${expiring.length}명(${names(expiring)}), FA 자격 ${fa.length}명(${names(fa)}).` },
        { who: '단장', text: `선수 연봉 총액 ${won(payroll)} / ${payrollYear} 한도 ${won(payrollLimit)}(여유 ${won(payrollLimit - payroll)}).` },
      ],
    };
  }

  // ───────── 화면 ─────────

  view(meta: GameMeta) {
    const year = this.currentYear(meta);
    const planning = this.planningYear(meta);
    const plan = this.planFor(meta, year);
    const meeting = this.meetingThisWeek(meta);
    const opsRows = (p: BudgetPlan, y: number) =>
      OPS_KINDS.map((k) => ({
        kind: k,
        label: OPS_LABEL[k],
        multiplier: p.ops[k],
        annualWon: Math.round(inflate(OPS_BASE[k], y, meta.inflationBp) * p.ops[k]),
        effect: k === 'scouting' ? `스카우트 추정 오차 ×${scoutingFactor(p.ops[k]).toFixed(3)}` : k === 'futures' ? `집중 훈련 효과 ×${trainingFactor(p.ops[k]).toFixed(3)}` : `메디컬 역량 ${medicalBonus(p.ops[k]) >= 0 ? '+' : ''}${medicalBonus(p.ops[k]).toFixed(3)}`,
      }));
    const capRows = (p: BudgetPlan, current: boolean) =>
      CAP_KINDS.map((k) => ({ kind: k, label: CAP_LABEL[k], limitWon: p.caps[k], usedWon: current ? (k === 'payroll' ? this.payroll(meta) : this.executed(meta, k)) : k === 'payroll' ? this.payroll(meta) : 0 }));
    return {
      current: { year, setBy: plan.setBy, ops: opsRows(plan, year), caps: capRows(plan, true), editable: !!meeting, editNote: meeting ? '이번 주 특별 운영회의를 열어 이번 예산을 고칠 수 있습니다.' : '이번 예산 수정은 특별 운영회의(행동력 1)를 연 주에만 할 수 있습니다.' },
      planning: planning ? (() => { const p = this.planFor(meta, planning); return { year: planning, setBy: p.setBy, ops: opsRows(p, planning), caps: capRows(p, false), editable: true, editNote: `${planning} 시즌 예산안: 그 주 첫 확정에 행동력 ${B.planAp}, 같은 주 수정은 무료.` }; })() : null,
      meeting: { heldThisWeek: !!meeting, ap: B.meetingAp, latest: (meta.meetings ?? []).at(-1) ?? null },
      limits: { minMultiplier: B.minMultiplier, maxMultiplier: B.maxMultiplier, step: B.multiplierStep, capStepWon: B.capStepWon },
    };
  }
}

