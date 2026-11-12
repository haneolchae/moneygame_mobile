// 조직·위임 (03 문서, D-020~D-028, D-076, D-095): 직원 채용·해고, 팀 처리량, 위임 정책, 업무 큐, 결재, 마감일 있는 의무 안건.
// 위임 실행은 Market의 같은 도메인 로직을 호출하고, 비용 출처(행동력 대신 처리량)만 다르다.
import { diffDays, weekday, type GameDate } from '../engine/calendar';
import { LEAGUE, ROSTER_OBLIGATION } from '../engine/config';
import { compensationFor, offerTotal, type ContractOffer } from '../engine/contracts';
import type { LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { Rng } from '../engine/rng';
import {
  generateCandidates,
  generateOrganization,
  observedAbility,
  scoutingSdScale,
  secretaryLookaheadDays,
  severance,
  TASK_WP,
  teamCapacity,
  teamDef,
  TEAMS,
  COACH_SLOTS,
  type StaffMember,
  type StaffTitle,
  type TeamKey,
} from '../engine/staff';
import type { ClubId } from '../engine/types';
import { GameError } from '../shared/protocol';
import { stoveDates, type ActionSource, type Market } from './market';
import { scoutingBoost } from '../engine/business';
import { apPeriodId, weekIdFor } from './week';
import type { ApprovalRequest, DelegationPolicy, GameMeta, GameRepository, InboxMessage, WorkTask } from './ports';

const won = (n: number) => `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억`;
const round1m = (n: number) => Math.max(0, Math.round(n / 1_000_000) * 1_000_000);

/** ASSUMPTION(D-076): 행동력 비용. 직접 채용 2는 03 문서, 해고 1은 초기안 */
export const ORG_AP = { hire: 2, fire: 1 } as const;

/** 구단주 직접 행동이 쓰는 담당 팀 처리량: 기본 처리량의 50%(올림) */
export const directWpCost = (fullCost: number) => Math.ceil(fullCost / 2);

/** 위임 가능한 팀(이번 단계). 나머지 팀은 해당 기능 단계에서 연다. */
export const DELEGABLE_TEAMS: readonly TeamKey[] = ['ops', 'admin'];

/** ASSUMPTION(D-076): 기본 위임 정책. 운영·경영지원은 '제안 후 승인'으로 시작한다. */
export function defaultPolicy(team: TeamKey): DelegationPolicy {
  return {
    team,
    mode: DELEGABLE_TEAMS.includes(team) ? 'approve' : 'direct',
    faMaxTotal: 50 * EOK,
    faMaxYears: 4,
    salaryMaxRatioBp: 10_000,
    cashFloor: 30 * EOK,
    hireMaxSalary: 150_000_000,
  };
}

/** 한 자리만 있는 직책 */
const UNIQUE_TITLES: StaffTitle[] = ['비서', '단장', '사업본부장', '감독', '수석코치'];

export class Organization {
  constructor(
    private readonly repo: GameRepository,
    private readonly market: Market,
  ) {}

  // ───────── 생성·조회 ─────────

  /** 새 게임용 조직: 10개 구단 + 첫 달 채용 후보 */
  static generateAll(seed: string, clubIds: ClubId[], year: number, date: GameDate): StaffMember[] {
    let id = 1;
    const next = () => id++;
    const out: StaffMember[] = [];
    for (const clubId of clubIds) out.push(...generateOrganization(Rng.derive(seed, 'staff', clubId), clubId, next, year));
    out.push(...generateCandidates(Rng.derive(seed, 'staff-market', date), next, year));
    return out;
  }

  /** 2b 저장본을 불러온 경우: 직원이 없으면 시드로 결정론적으로 만든다. */
  ensureStaff(meta: GameMeta, clubIds: ClubId[]): void {
    if (this.repo.getStaff().length > 0) return;
    this.repo.saveStaff(Organization.generateAll(meta.seed, clubIds, Number(meta.currentDate.slice(0, 4)), meta.currentDate));
  }

  staff(clubId: ClubId): StaffMember[] {
    return this.repo.getStaff(clubId);
  }

  payrollByClub(): Map<ClubId, number> {
    const out = new Map<ClubId, number>();
    for (const s of this.repo.getStaff()) if (s.clubId !== null) out.set(s.clubId, (out.get(s.clubId) ?? 0) + s.salary);
    return out;
  }

  policy(team: TeamKey): DelegationPolicy {
    return { ...defaultPolicy(team), ...(this.repo.getPolicies().find((p) => p.team === team) ?? {}) };
  }

  /** EV-2(D-205 (4)): 팀 역량(0~1) = 팀 직원 전문성 평균/100, 아무도 없으면 0.3 */
  teamQuality(clubId: number, team: TeamKey): number {
    const staff = this.staff(clubId).filter((s) => s.team === team);
    if (staff.length === 0) return 0.3;
    return Math.max(0, Math.min(1, staff.reduce((a, s) => a + (s.abilities.expertise ?? 50), 0) / staff.length / 100));
  }

  /** 컨디셔닝·메디컬팀 역량(0~1): 팀장·트레이너 전문성 평균, 아무도 없으면 0.3 (4b-1, D-126) */
  medicalQuality(clubId: number): number {
    const staff = this.staff(clubId).filter((s) => s.team === 'medical');
    if (staff.length === 0) return 0.3;
    return Math.max(0, Math.min(1, staff.reduce((a, s) => a + (s.abilities.expertise ?? 50), 0) / staff.length / 100));
  }

  /** 6e(D-177): 분석·스카우트 운영비 배수의 추정 오차 배율. 서비스가 연결한다 */
  scoutingBudget: (meta: GameMeta) => number = () => 1;

  scoutingScale(meta: GameMeta): number {
    // 6a 분석·스카우팅 사무실(D-141): 완공 단계당 추정 오차 −3%
    return scoutingSdScale(this.staff(meta.userClubId)) * scoutingBoost(meta.facilities?.[String(meta.userClubId)]) * this.scoutingBudget(meta);
  }

  lookaheadDays(meta: GameMeta): number {
    return secretaryLookaheadDays(this.staff(meta.userClubId).find((s) => s.title === '비서') ?? null);
  }

  // ───────── 주간 처리량 ─────────

  /** 새 주의 팀 처리량을 지급한다. 정기 업무를 먼저 차감한다(D-027). 이미 있으면 그대로 둔다. */
  ensureWeek(meta: GameMeta, weekId: string, mode: 'season' | 'stove' = meta.mode): void {
    if (this.repo.getWp(weekId).length > 0) return;
    const staff = this.staff(meta.userClubId);
    this.repo.insertWp(
      TEAMS.map((t) => {
        const cap = teamCapacity(staff, t.key, mode);
        return { weekId, team: t.key, granted: cap.weeklyWp, upkeep: cap.upkeep, used: Math.min(cap.weeklyWp, cap.upkeep) };
      }),
    );
  }

  /** Market에서 호출: 직접 행동은 처리량 50%를 큐 최우선으로 차감(부족해도 진행), 위임은 준비 때 이미 차감했다. */
  charge(meta: GameMeta, source: ActionSource, team: TeamKey, fullCost: number): void {
    if (source.kind !== 'direct') return;
    this.ensureWeek(meta, source.weekId);
    this.repo.spendWp(source.weekId, team, directWpCost(fullCost), true);
  }

  /** 위임 업무 담당자와 역량(0~1). 팀장 → 본부장 겸임(×0.7) → 없음 */
  teamDelegate(clubId: ClubId, team: TeamKey): { who: StaffMember; quality: number } | null {
    return this.delegate(team, this.staff(clubId));
  }

  /** 위임 업무 처리량 차감: 이번 주 남은 처리량이 모자라면 비용 없이 거부한다 */
  spendDelegatedWp(meta: GameMeta, weekId: string, team: TeamKey, cost: number): void {
    this.ensureWeek(meta, weekId);
    const left = this.wpLeft(weekId, team);
    if (left < cost) throw new GameError('WP_SHORT', `${teamDef(team).name} 이번 주 처리량이 부족합니다(필요 ${cost}, 남음 ${Math.max(0, left)}).`);
    this.repo.spendWp(weekId, team, cost);
  }

  /** 팀 이번 주 남은 처리량(화면 안내용, 조회만 — 주간 지급 전이면 지급 예정값) */
  wpRemaining(meta: GameMeta, weekId: string, team: TeamKey): number {
    const w = this.repo.getWp(weekId).find((x) => x.team === team);
    if (w) return Math.max(0, w.granted - w.used);
    const cap = teamCapacity(this.staff(meta.userClubId), team, meta.mode);
    return Math.max(0, cap.weeklyWp - Math.min(cap.weeklyWp, cap.upkeep));
  }

  private wpLeft(weekId: string, team: TeamKey): number {
    const w = this.repo.getWp(weekId).find((x) => x.team === team);
    return w ? w.granted - w.used : 0;
  }

  /** 위임 업무 담당자: 팀장 → 본부장 겸임(×0.7) → 없음(재량 업무 정지) */
  private delegate(team: TeamKey, staff: StaffMember[]): { who: StaffMember; quality: number } | null {
    const leader = staff.find((s) => s.title === '팀장' && s.team === team);
    if (leader) return { who: leader, quality: ((leader.abilities.expertise ?? 50) + (leader.abilities.judgment ?? 50)) / 200 };
    const def = teamDef(team);
    const head = staff.find((s) => s.title === (def.division === 'baseball' ? '단장' : '사업본부장'));
    if (head) return { who: head, quality: (((head.abilities.expertise ?? 50) + (head.abilities.judgment ?? 50)) / 200) * 0.7 };
    return null;
  }

  // ───────── 채용·해고 (공통 도메인 로직) ─────────

  private vacancyError(staff: StaffMember[], c: StaffMember): string | null {
    if (UNIQUE_TITLES.includes(c.title) && staff.some((s) => s.title === c.title)) return `${c.title} 자리가 이미 차 있습니다. 먼저 현재 ${c.title}을 내보내야 합니다.`;
    if (c.title === '팀장' && staff.some((s) => s.title === '팀장' && s.team === c.team)) return `${teamDef(c.team!).name} 팀장 자리가 이미 차 있습니다.`;
    if (c.title === '팀원') {
      const def = teamDef(c.team!);
      const n = staff.filter((s) => s.title === '팀원' && s.team === c.team).length;
      if (n >= def.defaultMembers * 2) return `${def.name} 인원 상한(${def.defaultMembers * 2}명)에 도달했습니다.`;
    }
    if (c.title === '코치' && staff.some((s) => s.title === '코치' && s.part === c.part)) return `${c.part} 코치 자리가 이미 차 있습니다.`;
    return null;
  }

  private hireCore(meta: GameMeta, candidateId: number, date: GameDate): { staff: StaffMember; message: string } {
    const c = this.repo.getStaff(null).find((s) => s.id === candidateId);
    if (!c) throw new GameError('NOT_AVAILABLE', '채용 시장에 없는 후보입니다.');
    const err = this.vacancyError(this.staff(meta.userClubId), c);
    if (err) throw new GameError('NO_VACANCY', err);
    c.clubId = meta.userClubId;
    this.repo.saveStaff([c]);
    const where = c.team ? `${teamDef(c.team).name} ${c.title}` : c.part && c.title === '코치' ? `${c.part} 코치` : c.title;
    const message = `${c.name} ${where} 채용 (연봉 ${won(c.salary)}, ${c.contractYears}년)`;
    this.repo.addInbox([{ date, kind: 'report', sender: '경영지원팀', title: `신규 채용: ${c.name} ${where}`, body: `${message}. 처리량 변화는 다음 주부터 반영됩니다.` }]);
    return { staff: c, message };
  }

  /** 직접 채용: 행동력 2 + 경영지원팀 처리량 50% */
  hire(meta: GameMeta, weekId: string, candidateId: number) {
    const c = this.repo.getStaff(null).find((s) => s.id === candidateId);
    if (!c) throw new GameError('NOT_AVAILABLE', '채용 시장에 없는 후보입니다.');
    const err = this.vacancyError(this.staff(meta.userClubId), c);
    if (err) throw new GameError('NO_VACANCY', err);
    return this.repo.transaction(() => {
      this.spendAp(weekId, ORG_AP.hire);
      this.charge(meta, { kind: 'direct', weekId }, 'admin', TASK_WP.hire);
      return { result: 'accept' as const, message: this.hireCore(meta, candidateId, meta.currentDate).message };
    });
  }

  /** 해고: 행동력 1 + 보상금(남은 계약 연봉의 50%) 즉시 지급 */
  /** EV-4(D-210 (7)) 사건 카드 감독 경질: 보상금 장부, 감독 공석(선임은 조직 화면). 카드 선택이라 행동력 없음 */
  dismissManager(meta: GameMeta, clubId: number, date: GameDate): string | null {
    const s = this.staff(clubId).find((x) => x.title === '감독');
    if (!s) return null;
    const pay = severance(s);
    this.repo.addLedger([{ clubId, date, category: 'staffSeverance', amount: -pay, memo: `${s.name} 감독 경질 보상금` }]);
    this.repo.deleteStaff([s.id]);
    return `${s.name} 감독 경질(보상금 ${won(pay)})`;
  }

  fire(meta: GameMeta, weekId: string, staffId: number) {
    const s = this.staff(meta.userClubId).find((x) => x.id === staffId);
    if (!s) throw new GameError('NOT_AVAILABLE', '우리 구단 직원이 아닙니다.');
    const pay = severance(s);
    if (this.repo.cashBalance(meta.userClubId) < pay) throw new GameError('CASH_SHORT', `보상금 ${won(pay)}이 필요합니다.`);
    return this.repo.transaction(() => {
      this.spendAp(weekId, ORG_AP.fire);
      const ledger: LedgerEntry[] = [{ clubId: meta.userClubId, date: meta.currentDate, category: 'staffSeverance', amount: -pay, memo: `${s.name} ${s.title} 해고 보상금` }];
      this.repo.addLedger(ledger);
      this.repo.deleteStaff([s.id]);
      // 해임된 팀장·본부장이 맡던 위임 업무는 새 착수를 멈추고 대기열로 돌린다(03 문서).
      for (const a of this.repo.getApprovals('pending')) {
        this.repo.updateApproval(a.id, 'expired');
        this.repo.updateTask(a.taskId, { status: 'queued', note: '담당자 변경으로 재검토 대기', updated: meta.currentDate });
      }
      return { result: 'accept' as const, message: `${s.name} ${s.title}을 내보냈습니다. 보상금 ${won(pay)}을 지급했습니다.` };
    });
  }

  private spendAp(weekId: string, amount: number) {
    try {
      this.repo.spendAp(weekId, amount);
    } catch {
      throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다.');
    }
  }

  // ───────── 위임 설정·업무 등록 ─────────

  setPolicy(meta: GameMeta, p: DelegationPolicy) {
    if (!TEAMS.some((t) => t.key === p.team)) throw new GameError('INVALID', '알 수 없는 팀입니다.');
    if (p.mode !== 'direct' && !DELEGABLE_TEAMS.includes(p.team)) throw new GameError('NOT_AVAILABLE', '이 팀의 위임은 해당 기능 단계에서 열립니다.');
    if (p.faMaxYears < 1 || p.faMaxYears > 6 || p.faMaxTotal < 0 || p.cashFloor < 0 || p.salaryMaxRatioBp < 8_000 || p.salaryMaxRatioBp > 12_000 || p.hireMaxSalary < 0) {
      throw new GameError('INVALID', '정책 값이 범위를 벗어났습니다. (FA 기간 1~6년, 연봉 협상 한도 80~120%)');
    }
    this.repo.savePolicy({ ...defaultPolicy(p.team), ...p });
    // 위임 모드로 바꾸면 결재 대기 안건을 새 정책으로 다시 준비한다.
    if (p.mode !== 'direct') for (const t of this.repo.getTasks({ status: ['waiting'] }).filter((x) => x.team === p.team)) this.requeue(t, meta.currentDate);
    // 직접 운영으로 바꾸면 대기 중인 위임 업무를 멈춘다. 이미 맺은 계약은 되돌리지 않는다.
    // 마감일 있는 의무 안건(D-095)은 취소하지 않고 비서 할 일로 남긴다(마감일 자동 적용은 그대로).
    if (p.mode === 'direct') {
      for (const a of this.repo.getApprovals('pending').filter((x) => x.team === p.team)) this.repo.updateApproval(a.id, 'expired');
      for (const t of this.repo.getTasks({ status: ['queued', 'waiting'] }).filter((x) => x.team === p.team)) {
        if (t.kind === 'roster') this.repo.updateTask(t.id, { status: 'queued', note: '직접 운영 — 비서 할 일로 등록', updated: meta.currentDate });
        else this.repo.updateTask(t.id, { status: 'cancelled', note: '직접 운영으로 전환', updated: meta.currentDate });
      }
    }
    return { result: 'accept' as const, message: `${teamDef(p.team).name} 위임 정책을 저장했습니다.` };
  }

  /** 결재 대기 업무를 다시 준비 상태로 돌린다(대기 결재는 만료). */
  private requeue(t: WorkTask, date: GameDate) {
    if (t.status !== 'waiting') return;
    for (const a of this.repo.getApprovals('pending').filter((x) => x.taskId === t.id)) this.repo.updateApproval(a.id, 'expired');
    this.repo.updateTask(t.id, { status: 'queued', params: { ...t.params, lastWeek: '' }, note: '조건 변경으로 다시 준비', updated: date });
  }

  private requireDelegable(team: TeamKey) {
    const pol = this.policy(team);
    if (pol.mode === 'direct') throw new GameError('DIRECT_MODE', `${teamDef(team).name}이 직접 운영 모드입니다. [조직·위임]에서 '제안 후 승인' 또는 '완전 위임'으로 바꾸세요.`);
    return pol;
  }

  private activeTask(targetId: number, kind: WorkTask['kind']) {
    return this.repo.getTasks({ status: ['queued', 'waiting'], targetId, kind })[0];
  }

  /** FA 위임 대상 검증(실행·조회 공용, D-118): 운영팀 위임 모드 + 신청·승인된 FA */
  faDelegationTarget(meta: GameMeta, playerId: number) {
    const pol = this.requireDelegable('ops');
    const e = this.repo.getFa(Number(meta.kDate.slice(0, 4))).find((x) => x.playerId === playerId);
    if (!e || !['applied', 'approved'].includes(e.status)) throw new GameError('NOT_AVAILABLE', '협상할 수 있는 FA 선수가 아닙니다.');
    return pol;
  }

  /** 연봉 협상 위임 대상 검증(한 선수): 운영팀 위임 모드 + 협상 중 + 진행 중 위임 없음 */
  salaryDelegationTarget(meta: GameMeta, playerId: number) {
    this.requireDelegable('ops');
    const t = this.repo.getSalaryTalks(Number(meta.kDate.slice(0, 4))).find((x) => x.clubId === meta.userClubId && x.status === 'open' && x.playerId === playerId);
    if (!t) throw new GameError('NOT_AVAILABLE', '협상 중인 연봉 대상이 아닙니다.');
    if (this.activeTask(playerId, 'salary')) throw new GameError('DUPLICATE', '이미 운영팀이 연봉 협상을 진행 중입니다.');
  }

  /**
   * FA 위임. 스토브리그에서 구단주가 맡기면 협상 지시서(D-218): 금액 상·하한·기간·마감 범위 안의 왕복은 결재 없이 운영팀 처리량만 쓴다.
   * 범위 밖 응답(한도에서 합의 실패)은 구간 진행 멈춤 사유가 된다(D-219).
   */
  delegateFa(meta: GameMeta, playerId: number, maxTotal?: number, maxYears?: number, directive?: { minTotal?: number; deadline?: GameDate }) {
    const pol = this.faDelegationTarget(meta, playerId);
    const isDirective = meta.mode === 'stove' || !!directive;
    const params = { maxTotal: maxTotal ?? pol.faMaxTotal, maxYears: maxYears ?? pol.faMaxYears, round: 0, lastWeek: '', lastRatio: 0, counter: null as ContractOffer | null, directive: isDirective, minTotal: directive?.minTotal ?? 0, deadline: directive?.deadline ?? '' };
    if (params.maxTotal <= 0 || params.maxYears < 1 || params.minTotal > params.maxTotal) throw new GameError('INVALID', '한도를 확인하세요. (하한 ≤ 상한)');
    // 이미 진행 중인 위임(담당 팀 자체 안건 포함)이 있으면 한도만 바꾼다.
    const existing = this.activeTask(playerId, 'fa');
    if (existing) {
      this.requeue(existing, meta.currentDate);
      this.repo.updateTask(existing.id, { params: { ...existing.params, maxTotal: params.maxTotal, maxYears: params.maxYears, directive: params.directive, minTotal: params.minTotal, deadline: params.deadline, lastWeek: '' }, note: `${params.directive ? '협상 지시서' : '한도'} 변경: 총액 ${won(params.maxTotal)}·${params.maxYears}년 이내`, updated: meta.currentDate });
      return { result: 'accept' as const, message: `진행 중인 위임의 한도를 총액 ${won(params.maxTotal)}, ${params.maxYears}년으로 바꿨습니다.` };
    }
    this.repo.insertTask({ team: 'ops', kind: 'fa', targetId: playerId, params, status: 'queued', created: meta.currentDate, updated: meta.currentDate, note: `${params.directive ? '협상 지시서 · ' : ''}총액 ${params.minTotal ? `${won(params.minTotal)}~` : ''}${won(params.maxTotal)}·${params.maxYears}년 이내${params.deadline ? ` · 마감 ${params.deadline.slice(5).replace('-', '/')}` : ''}` });
    return { result: 'accept' as const, message: params.directive ? `협상 지시서를 운영팀에 넘겼습니다. 총액 ${won(params.maxTotal)}, ${params.maxYears}년 안에서는 결재 없이 매주 협상하고, 범위를 넘는 응답이 오면 진행을 멈추고 보고합니다.` : `운영팀에 맡겼습니다. 총액 ${won(params.maxTotal)}, ${params.maxYears}년 이내에서 매주 한 번 협상합니다.` };
  }

  /** 연봉 협상 위임. 스토브리그 구단주 위임은 협상 지시서(D-218): 요구액 대비 maxRatioBp 안에서 결재 없이 제시한다 */
  delegateSalary(meta: GameMeta, playerId?: number, maxRatioBp?: number) {
    const pol = this.requireDelegable('ops');
    const directive = meta.mode === 'stove';
    const ratio = maxRatioBp ?? pol.salaryMaxRatioBp;
    if (ratio < 8_000 || ratio > 12_000) throw new GameError('INVALID', '연봉 협상 한도는 요구액의 80~120%입니다.');
    const talks = this.repo.getSalaryTalks(Number(meta.kDate.slice(0, 4))).filter((t) => t.clubId === meta.userClubId && t.status === 'open' && (playerId === undefined || t.playerId === playerId));
    let n = 0;
    this.repo.transaction(() => {
      for (const t of talks) {
        if (this.activeTask(t.playerId, 'salary')) continue;
        this.repo.insertTask({ team: 'ops', kind: 'salary', targetId: t.playerId, params: { round: 0, lastWeek: '', directive, maxRatioBp: ratio }, status: 'queued', created: meta.currentDate, updated: meta.currentDate, note: directive ? `협상 지시서 · 요구액의 ${ratio / 100}% 이내` : '' });
        n++;
      }
    });
    if (n === 0) {
      if (talks.some((t) => this.activeTask(t.playerId, 'salary'))) return { result: 'accept' as const, message: '남은 연봉 협상은 이미 운영팀이 진행 중입니다.' };
      throw new GameError('NOT_AVAILABLE', '새로 맡길 연봉 협상 대상이 없습니다.');
    }
    return { result: 'accept' as const, message: `연봉 협상 ${n}명을 운영팀에 맡겼습니다. 1명당 처리량 ${TASK_WP.salaryTalk}을 쓰며 매주 한 번씩 제시합니다.` };
  }

  delegateHire(meta: GameMeta, team: TeamKey, title: '팀장' | '팀원', maxSalary?: number) {
    const pol = this.requireDelegable('admin');
    if (!TEAMS.some((t) => t.key === team)) throw new GameError('INVALID', '알 수 없는 팀입니다.');
    const probe = { title, team, part: null } as unknown as StaffMember;
    const err = this.vacancyError(this.staff(meta.userClubId), probe);
    if (err) throw new GameError('NO_VACANCY', err);
    if (this.repo.getTasks({ status: ['queued', 'waiting'], kind: 'hire' }).some((t) => t.params.team === team && t.params.title === title)) throw new GameError('DUPLICATE', '같은 자리 채용을 이미 진행 중입니다.');
    const params = { team, title, maxSalary: maxSalary ?? pol.hireMaxSalary };
    this.repo.insertTask({ team: 'admin', kind: 'hire', targetId: 0, params, status: 'queued', created: meta.currentDate, updated: meta.currentDate, note: `연봉 ${won(params.maxSalary)} 이하` });
    return { result: 'accept' as const, message: `${teamDef(team).name} ${title} 채용을 경영지원팀에 맡겼습니다.` };
  }

  cancelTask(meta: GameMeta, taskId: number) {
    const t = this.repo.getTasks({ status: ['queued', 'waiting'] }).find((x) => x.id === taskId);
    if (!t) throw new GameError('NOT_AVAILABLE', '진행 중인 업무가 아닙니다.');
    if (t.kind === 'roster') throw new GameError('OBLIGATION', '마감일이 있는 의무 안건은 취소할 수 없습니다. 직접 방출해 40명 이하로 맞추면 안건이 끝납니다.');
    this.repo.transaction(() => {
      this.repo.updateTask(t.id, { status: 'cancelled', note: '구단주 취소', updated: meta.currentDate });
      for (const a of this.repo.getApprovals('pending').filter((x) => x.taskId === t.id)) this.repo.updateApproval(a.id, 'rejected');
    });
    return { result: 'accept' as const, message: '위임을 취소했습니다.' };
  }

  // ───────── 업무 큐 처리 (하루 처리 트랜잭션 안에서 호출) ─────────

  onDay(meta: GameMeta, date: GameDate): InboxMessage[] {
    const inbox: InboxMessage[] = [];
    // 매달 1일 채용 시장 후보 교체. 진행 중인 채용 결재는 후보가 바뀌므로 만료한다.
    if (date.slice(8, 10) === '01') this.refreshCandidates(meta, date);
    const weekId = weekIdFor(date);
    this.ensureWeek(meta, weekId);
    // D-220: 결재 기한은 시즌은 주, 스토브리그는 턴(턴 회의에서 지난 구간 결재를 처리할 수 있게)
    this.expireApprovals(date, meta);
    this.expireStaleFaApprovals(meta, date);
    this.fillRosterNeedsIfDelegated(meta, date, inbox);
    this.proposeOwnAgenda(meta, date);
    this.enforceRosterDeadline(meta, date, inbox);
    const staff = this.staff(meta.userClubId);
    // 큐 우선순위(03 문서): 마감 의무 안건 → FA → 연봉 협상 → 채용. FA는 간판 선수, 큰 계약 순.
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const kindOrder: Record<string, number> = { roster: -1, fa: 0, salary: 1, hire: 2 };
    const weight = (t: WorkTask) => (t.kind === 'fa' ? (players.get(t.targetId)?.career.franchise ? 1e15 : 0) + Number(t.params.maxTotal ?? 0) : 0);
    const queue = this.repo.getTasks({ status: ['queued'] }).sort((a, b) => kindOrder[a.kind]! - kindOrder[b.kind]! || weight(b) - weight(a) || a.id - b.id);
    for (const t of queue) {
      const pol = this.policy(t.team);
      if (pol.mode === 'direct') continue;
      const d = this.delegate(t.team, staff);
      if (!d) {
        if (t.note !== '담당자 없음 — 재량 업무 정지') this.repo.updateTask(t.id, { note: '담당자 없음 — 재량 업무 정지', updated: date });
        continue;
      }
      try {
        if (t.kind === 'fa') this.runFa(meta, date, weekId, t, pol, d, inbox);
        else if (t.kind === 'salary') this.runSalary(meta, date, weekId, t, pol, d, inbox);
        else if (t.kind === 'hire') this.runHire(meta, date, weekId, t, pol);
        else if (t.kind === 'roster') this.runRoster(meta, date, weekId, t, pol, inbox);
      } catch (e) {
        // 실행 시점 검증 실패(규정·현금·자리)는 업무 실패로 기록하고 다른 업무는 계속한다.
        this.repo.updateTask(t.id, { status: 'failed', note: e instanceof GameError ? e.message : String(e), updated: date });
      }
    }
    return inbox;
  }

  /**
   * 담당 팀 자체 안건(D-077): 직접 운영이 아니면 구단주가 맡기지 않아도 안건을 올린다.
   * 우리 FA 잔류(시장 개장일), 보류 선수 연봉 협상(12/1), 팀장 공석 채용(게임 첫날·매달 1일).
   */
  private proposeOwnAgenda(meta: GameMeta, date: GameDate) {
    this.proposeRosterObligation(meta, date);
    const ops = this.policy('ops');
    const off = Number(meta.kDate.slice(0, 4));
    const sd = stoveDates(meta.kDate);
    const note = '담당 팀 자체 안건';
    if (ops.mode !== 'direct' && meta.mode === 'stove' && date === sd.faMarketOpen) {
      // D-215: 자동 실행의 간판 외야수는 첫 안건으로 남긴다(운영팀 자체 안건에서 뺀다)
      for (const e of this.repo.getFa(off).filter((x) => x.originClub === meta.userClubId && x.status === 'approved' && meta.autoRun?.franchiseId !== x.playerId)) {
        if (this.repo.getTasks({ targetId: e.playerId, kind: 'fa' }).length > 0) continue;
        const maxTotal = Math.min(ops.faMaxTotal, round1m(offerTotal(e.demand) * 1.15));
        this.repo.insertTask({ team: 'ops', kind: 'fa', targetId: e.playerId, params: { maxTotal, maxYears: ops.faMaxYears, round: 0, lastWeek: '', lastRatio: 0, counter: null }, status: 'queued', created: date, updated: date, note: `${note} · 총액 ${won(maxTotal)} 이내` });
      }
    }
    if (ops.mode !== 'direct' && meta.mode === 'stove' && date === sd.salaryTalksOpen) {
      for (const t of this.repo.getSalaryTalks(off).filter((x) => x.clubId === meta.userClubId && x.status === 'open')) {
        if (this.repo.getTasks({ targetId: t.playerId, kind: 'salary' }).length > 0) continue;
        this.repo.insertTask({ team: 'ops', kind: 'salary', targetId: t.playerId, params: { round: 0, lastWeek: '' }, status: 'queued', created: date, updated: date, note });
      }
    }
    const admin = this.policy('admin');
    if (admin.mode !== 'direct' && (date === meta.kDate || date.slice(8, 10) === '01')) {
      const staff = this.staff(meta.userClubId);
      const active = this.repo.getTasks({ status: ['queued', 'waiting'], kind: 'hire' });
      for (const t of TEAMS) {
        if (staff.some((x) => x.title === '팀장' && x.team === t.key)) continue;
        if (active.some((x) => x.params.team === t.key && x.params.title === '팀장')) continue;
        this.repo.insertTask({ team: 'admin', kind: 'hire', targetId: 0, params: { team: t.key, title: '팀장', maxSalary: admin.hireMaxSalary }, status: 'queued', created: date, updated: date, note });
      }
    }
  }

  /** 기간(시즌 주·스토브리그 턴)이 바뀌면 지난 기간 결재 대기는 만료하고 업무를 취소한다(조건 변화 없이 재상정하지 않는다). */
  expireApprovals(date: GameDate, meta?: GameMeta): void {
    const period = (d: GameDate) => (meta && meta.mode === 'stove' && d >= meta.kDate ? apPeriodId(meta, d) : weekIdFor(d));
    const weekId = period(date);
    for (const a of this.repo.getApprovals('pending')) {
      if (period(a.date) === weekId) continue;
      this.repo.updateApproval(a.id, 'expired');
      if (a.kind === 'roster') this.repo.updateTask(a.taskId, { status: 'queued', note: '결재 기한(주·턴) 경과 — 정리안을 다시 상정', updated: date });
      else this.repo.updateTask(a.taskId, { status: 'cancelled', note: '결재 기한(주·턴) 경과', updated: date });
    }
  }

  /** FA 결재 대상 선수가 이미 다른 구단과 계약했거나 시장에서 빠졌으면 결재를 만료하고 업무를 끝낸다(승인해도 실행할 수 없는 안건을 남기지 않음). */
  private expireStaleFaApprovals(meta: GameMeta, date: GameDate) {
    const pending = this.repo.getApprovals('pending').filter((a) => a.kind === 'fa');
    if (!pending.length) return;
    const fa = new Map(this.repo.getFa(Number(meta.kDate.slice(0, 4))).map((e) => [e.playerId, e]));
    for (const a of pending) {
      const e = fa.get(Number(a.payload.playerId));
      if (e && (e.status === 'applied' || e.status === 'approved')) continue;
      this.repo.updateApproval(a.id, 'expired');
      this.repo.updateTask(a.taskId, { status: 'cancelled', note: e?.signedClub ? '선수가 다른 구단과 계약해 결재 만료' : '선수가 FA 시장에서 빠져 결재 만료', updated: date });
    }
  }

  private refreshCandidates(meta: GameMeta, date: GameDate) {
    const old = this.repo.getStaff(null);
    this.repo.deleteStaff(old.map((s) => s.id));
    let id = this.repo.nextStaffId();
    this.repo.saveStaff(generateCandidates(Rng.derive(meta.seed, 'staff-market', date), () => id++, Number(date.slice(0, 4))));
    for (const a of this.repo.getApprovals('pending').filter((x) => x.kind === 'hire')) {
      this.repo.updateApproval(a.id, 'expired');
      this.repo.updateTask(a.taskId, { status: 'queued', note: '후보 교체로 다시 찾는 중', updated: date });
    }
  }

  private spendTaskWp(weekId: string, team: TeamKey, cost: number, t: WorkTask, date: GameDate): boolean {
    if (this.wpLeft(weekId, team) < cost) {
      if (!t.note.startsWith('처리량 부족')) this.repo.updateTask(t.id, { note: `처리량 부족 — 다음 주 대기 (필요 ${cost})`, updated: date });
      return false;
    }
    this.repo.spendWp(weekId, team, cost);
    return true;
  }

  private runFa(meta: GameMeta, date: GameDate, weekId: string, t: WorkTask, pol: DelegationPolicy, d: { who: StaffMember; quality: number }, inbox: InboxMessage[]) {
    const params = t.params as { maxTotal: number; maxYears: number; round: number; lastWeek: string; lastRatio: number; counter: ContractOffer | null; deadline?: string; directive?: boolean; minTotal?: number };
    // 새 제시는 1주 1라운드. 받은 역제안 수용은 다음 날 바로 진행한다.
    if (params.lastWeek === weekId && !params.counter) return;
    const off = Number(meta.kDate.slice(0, 4));
    const e = this.repo.getFa(off).find((x) => x.playerId === t.targetId);
    const p = this.repo.getPlayer(t.targetId);
    if (!e || !p || e.status !== 'approved') {
      if (e && e.status === 'signed') this.repo.updateTask(t.id, { status: e.signedClub === meta.userClubId ? 'done' : 'failed', note: e.signedClub === meta.userClubId ? '계약 완료' : '다른 구단과 계약', updated: date });
      else if (e && e.status === 'applied') return; // 승인 전: 시장이 열리면 시작
      else this.repo.updateTask(t.id, { status: 'failed', note: '협상 대상이 아님', updated: date });
      return;
    }
    if (!this.market.marketOpen(meta, date)) return;
    if (params.deadline && date > String(params.deadline)) {
      this.repo.updateTask(t.id, { status: 'failed', note: `지시서 마감(${String(params.deadline).slice(5).replace('-', '/')}) 경과`, updated: date });
      return;
    }
    // 경쟁 구단 제안이 있으면 요구액 이상에서 시작한다(담당자는 시장 관심도를 안다).
    const interest = this.repo.getOffers({ playerId: p.id, status: 'pending', kind: 'fa' }).filter((o) => o.clubId !== meta.userClubId).length;
    const offer = this.prepareFaOffer(e.demand, params, d.quality, interest);
    const comp = e.originClub === meta.userClubId ? 0 : compensationFor(e.grade ?? 'C', e.priorSalary);
    const cash = this.repo.cashBalance(meta.userClubId);
    if (cash - offer.bonus - comp < pol.cashFloor) {
      this.repo.updateTask(t.id, { status: 'failed', note: `현금 하한(${won(pol.cashFloor)}) 침범 — 계약금 ${won(offer.bonus)}${comp ? ` + 보상금 ${won(comp)}` : ''}`, updated: date });
      return;
    }
    if (!this.spendTaskWp(weekId, 'ops', TASK_WP.faRound, t, date)) return;
    params.round += 1;
    params.lastWeek = weekId;
    const summary = `${p.name} FA ${offer.years}년 총액 ${won(offerTotal(offer))} (계약금 ${won(offer.bonus)}, 연봉 ${won(offer.salary)})${comp ? ` · 보상금 ${won(comp)}` : ''}`;
    // D-218: 협상 지시서 범위 안의 제시는 결재 없이 실행한다
    if (pol.mode === 'approve' && !t.params.directive) {
      this.repo.insertApproval({ taskId: t.id, team: 'ops', kind: 'fa', date, summary, payload: { playerId: p.id, offer }, status: 'pending' });
      this.repo.updateTask(t.id, { status: 'waiting', params, note: `${params.round}차 제시안 결재 대기`, updated: date });
      return;
    }
    this.executeFa(meta, date, t, params, p.id, offer, d.who, inbox);
  }

  /** 담당자 능력이 높을수록 낮게 시작하고, 역제안이 오면 한도 안에서 받는다. */
  private prepareFaOffer(demand: ContractOffer, params: { maxTotal: number; maxYears: number; round: number; lastRatio: number; counter: ContractOffer | null }, quality: number, interest: number): ContractOffer {
    let offer: ContractOffer;
    if (params.counter) offer = { ...params.counter };
    else {
      const start = interest > 0 ? 1.0 + 0.03 * Math.min(3, interest) - 0.04 * quality : 0.97 - 0.08 * quality;
      let ratio = params.round === 0 ? start : Math.max(start, params.lastRatio + 0.05);
      // 협상 지시서 하한(D-218): 첫 제시부터 하한 이상
      const min = Number((params as { minTotal?: number }).minTotal ?? 0);
      if (min > 0 && offerTotal(demand) > 0) ratio = Math.max(ratio, min / offerTotal(demand));
      params.lastRatio = ratio;
      offer = { years: demand.years, salary: round1m(demand.salary * ratio), bonus: round1m(demand.bonus * ratio) };
    }
    offer.years = Math.min(offer.years, params.maxYears);
    const total = offerTotal(offer);
    if (total > params.maxTotal) {
      const f = params.maxTotal / total;
      offer = { years: offer.years, salary: Math.max(30_000_000, Math.floor((offer.salary * f) / 1_000_000) * 1_000_000), bonus: Math.floor((offer.bonus * f) / 1_000_000) * 1_000_000 };
    }
    return offer;
  }

  private executeFa(meta: GameMeta, date: GameDate, t: WorkTask, params: Record<string, unknown> & { maxTotal: number; counter: ContractOffer | null }, playerId: number, offer: ContractOffer, who: StaffMember, inbox: InboxMessage[], followUp = true) {
    const r = this.market.faOffer({ ...meta, currentDate: date }, { kind: 'delegated' }, playerId, offer);
    const atCap = offerTotal(offer) >= params.maxTotal - 1_000_000;
    const name = this.repo.getPlayer(playerId)?.name ?? '';
    if (r.result === 'accept') {
      this.repo.updateTask(t.id, { status: 'done', params, note: `계약 합의 (${who.name} ${who.title})`, updated: date });
      inbox.push({ date, kind: 'report', sender: '운영팀', title: `위임 협상 성공: ${name}`, body: `${r.message}\n담당: ${who.name} ${who.title}` });
      return;
    }
    if (r.result === 'counter' && offerTotal(r.counter) <= params.maxTotal && r.counter.years <= Number(params.maxYears ?? 6)) {
      params.counter = r.counter;
      // 완전 위임: 한도 안의 역제안은 처리량이 남아 있으면 그 자리에서 받아들인다.
      const weekId = weekIdFor(date);
      if (followUp && (this.policy('ops').mode === 'auto' || params.directive) && this.wpLeft(weekId, 'ops') >= TASK_WP.faRound) {
        this.repo.spendWp(weekId, 'ops', TASK_WP.faRound);
        params.counter = null;
        this.executeFa(meta, date, t, params, playerId, r.counter, who, inbox, false);
        return;
      }
      this.repo.updateTask(t.id, { status: 'queued', params, note: `역제안 ${won(offerTotal(r.counter))} — 수용 준비`, updated: date });
      return;
    }
    params.counter = null;
    if (atCap) {
      this.repo.updateTask(t.id, { status: 'failed', params, note: `한도(${won(params.maxTotal)}) 안에서 합의하지 못함`, updated: date });
      inbox.push({ date, kind: 'report', sender: '운영팀', title: `위임 협상 중단: ${name}`, body: `정해 주신 한도 ${won(params.maxTotal)} 안에서는 합의가 어렵습니다. ${r.message}\n한도를 올려 다시 맡기거나 직접 협상하세요.` });
      return;
    }
    this.repo.updateTask(t.id, { status: 'queued', params, note: `${r.message}`, updated: date });
  }

  private runSalary(meta: GameMeta, date: GameDate, weekId: string, t: WorkTask, pol: DelegationPolicy, d: { who: StaffMember; quality: number }, inbox: InboxMessage[]) {
    const params = t.params as { round: number; lastWeek: string };
    if (params.lastWeek === weekId) return;
    const talk = this.repo.getSalaryTalks(Number(meta.kDate.slice(0, 4))).find((x) => x.playerId === t.targetId && x.clubId === meta.userClubId);
    if (!talk || talk.status !== 'open') {
      this.repo.updateTask(t.id, { status: talk?.status === 'agreed' ? 'done' : 'failed', note: talk ? (talk.status === 'agreed' ? '합의 완료' : '조정으로 결정') : '대상 아님', updated: date });
      return;
    }
    const maxRatio = Number(t.params.maxRatioBp ?? pol.salaryMaxRatioBp) / 10_000;
    const ratio = Math.min(maxRatio, 0.93 + 0.04 * (1 - d.quality) + 0.02 * params.round);
    const offer = Math.max(30_000_000, round1m(talk.demand * ratio));
    const name = this.repo.getPlayer(t.targetId)?.name ?? '';
    if (!this.spendTaskWp(weekId, 'ops', TASK_WP.salaryTalk, t, date)) return;
    params.round += 1;
    params.lastWeek = weekId;
    if (pol.mode === 'approve' && !t.params.directive) {
      this.repo.insertApproval({ taskId: t.id, team: 'ops', kind: 'salary', date, summary: `${name} 연봉 ${won(offer)} 제시 (요구 ${won(talk.demand)}, 직전 ${won(talk.priorSalary)})`, payload: { playerId: t.targetId, offer }, status: 'pending' });
      this.repo.updateTask(t.id, { status: 'waiting', params, note: `${params.round}차 제시안 결재 대기`, updated: date });
      return;
    }
    this.executeSalary(meta, date, t, params, offer, ratio >= maxRatio, inbox);
  }

  private executeSalary(meta: GameMeta, date: GameDate, t: WorkTask, params: Record<string, unknown>, offer: number, atCap: boolean, inbox: InboxMessage[]) {
    const r = this.market.salaryOffer({ ...meta, currentDate: date }, { kind: 'delegated' }, t.targetId, offer);
    if (r.result === 'accept') {
      this.repo.updateTask(t.id, { status: 'done', params, note: `${won(offer)}에 합의`, updated: date });
      return;
    }
    if (atCap) {
      this.repo.updateTask(t.id, { status: 'failed', params, note: '정책 한도 도달 — 1/10 조정으로 넘어감', updated: date });
      inbox.push({ date, kind: 'report', sender: '운영팀', title: '연봉 협상 한도 도달', body: `${r.message}\n정책 한도까지 올렸지만 합의하지 못했습니다. 1월 10일까지 합의하지 못하면 조정으로 정해집니다.` });
      return;
    }
    this.repo.updateTask(t.id, { status: 'queued', params, note: r.message, updated: date });
  }

  // ───────── 마감일 있는 의무 안건: 40인 초과 정리 (D-095) ─────────

  /**
   * 포지션 최소 인원 보충(D-098): 완전 위임이면 캠프 명단 마감일에 운영팀이 AI 구단과 같은 함수(Market.fillRosterNeeds)로 보충한다.
   * 40명을 넘기면 같은 날 의무 안건 마감 처리(정리안)가 남는 쪽에서 정리한다.
   */
  private fillRosterNeedsIfDelegated(meta: GameMeta, date: GameDate, inbox: InboxMessage[]) {
    if (meta.mode !== 'stove' || date !== stoveDates(meta.kDate).campRoster || this.policy('ops').mode !== 'auto') return;
    const notes = this.market.fillRosterNeeds(meta, meta.userClubId);
    if (notes.length) inbox.push({ date, kind: 'report', sender: '운영팀', title: '위임 처리: 포지션 최소 인원 보충', body: notes.join('\n') });
  }

  /** 다음 명단 마감일(보류선수 명단 → 캠프 명단). 둘 다 지났으면 오늘 */
  private rosterDeadline(meta: GameMeta, date: GameDate): GameDate {
    const sd = stoveDates(meta.kDate);
    return [sd.reserveList, sd.campRoster].find((d) => d >= date) ?? date;
  }

  private activeRosterTask(): WorkTask | undefined {
    return this.repo.getTasks({ status: ['queued', 'waiting'], kind: 'roster' })[0];
  }

  /** 스토브리그에 우리 선수단이 40명을 넘으면 운영팀이 의무 안건을 만든다(위임 모드와 무관). 40명 이하가 되면 안건을 닫는다. */
  private proposeRosterObligation(meta: GameMeta, date: GameDate) {
    const active = this.activeRosterTask();
    // 시즌 중에는 영입 단계에서 40명을 막으므로 매일 선수 목록을 읽지 않는다.
    if (meta.mode !== 'stove' && !active) return;
    const count = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId).length;
    if (count <= LEAGUE.rosterMax) {
      if (active) {
        for (const a of this.repo.getApprovals('pending').filter((x) => x.taskId === active.id)) this.repo.updateApproval(a.id, 'expired');
        this.repo.updateTask(active.id, { status: 'done', note: `선수단 ${count}명 — 40명 이하가 되어 안건 종료`, updated: date });
      }
      return;
    }
    if (active || meta.mode !== 'stove') return;
    const deadline = this.rosterDeadline(meta, date);
    this.repo.insertTask({ team: 'ops', kind: 'roster', targetId: 0, params: { deadline, hold: false }, status: 'queued', created: date, updated: date, note: `선수단 ${count}명 → 40명 이하로 정리 (마감 ${deadline})` });
  }

  /** 운영팀 정리안: AI 구단 명단 정리와 같은 규칙(Market.trimPlan) */
  rosterProposal(meta: GameMeta): { ids: number[]; names: string[] } {
    const plan = this.market.trimPlan(meta, meta.userClubId);
    return { ids: plan.map((p) => p.id), names: plan.map((p) => p.name) };
  }

  /** 위임 실행: 마감 전 일정 기간 안에 들어오면 정리안을 실행(완전 위임)하거나 상정(승인)한다. 직접 운영은 큐에서 건너뛴다. */
  private runRoster(meta: GameMeta, date: GameDate, weekId: string, t: WorkTask, pol: DelegationPolicy, inbox: InboxMessage[]) {
    const params = t.params as { deadline: GameDate; hold?: boolean };
    if (params.hold) return;
    if (diffDays(params.deadline, date) > ROSTER_OBLIGATION.actWindowDays) {
      const note = `마감 ${params.deadline} — ${ROSTER_OBLIGATION.actWindowDays}일 전부터 정리안 준비`;
      if (t.note !== note) this.repo.updateTask(t.id, { note, updated: date });
      return;
    }
    const plan = this.rosterProposal({ ...meta, currentDate: date });
    if (plan.ids.length === 0) {
      this.repo.updateTask(t.id, { status: 'done', note: '이미 40명 이하', updated: date });
      return;
    }
    if (!this.spendTaskWp(weekId, 'ops', TASK_WP.rosterTrim, t, date)) return;
    if (pol.mode === 'approve') {
      const summary = `40인 명단 정리: ${plan.ids.length}명 방출안 (${plan.names.join(', ')}) — 마감 ${params.deadline}`;
      this.repo.insertApproval({ taskId: t.id, team: 'ops', kind: 'roster', date, summary, payload: { playerIds: plan.ids, names: plan.names }, status: 'pending' });
      this.repo.updateTask(t.id, { status: 'waiting', note: '명단 정리안 결재 대기', updated: date });
      return;
    }
    const notes = this.market.releaseForRoster({ ...meta, currentDate: date }, date, meta.userClubId, plan.ids);
    inbox.push({ date, kind: 'report', sender: '운영팀', title: `위임 처리: 40인 명단 정리 (${notes.length}명 방출)`, body: `완전 위임 정책에 따라 계약이 끝난 선수, 평가가 낮은 선수 순으로 정리했습니다.\n${notes.join('\n')}` });
    this.repo.updateTask(t.id, { status: 'done', note: `위임 정리 ${notes.length}명 방출`, updated: date });
  }

  /** 승인된 정리안 실행. 실행 시점의 초과 인원만큼만 방출한다. */
  private executeRosterApproval(meta: GameMeta, t: WorkTask, playerIds: number[], inbox: InboxMessage[]) {
    const count = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId).length;
    const ids = playerIds.slice(0, Math.max(0, count - LEAGUE.rosterMax));
    const notes = this.market.releaseForRoster(meta, meta.currentDate, meta.userClubId, ids);
    inbox.push({ date: meta.currentDate, kind: 'report', sender: '운영팀', title: `결재 처리: 40인 명단 정리 (${notes.length}명 방출)`, body: notes.join('\n') || '이미 40명 이하라 방출하지 않았습니다.' });
    const after = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId).length;
    if (after <= LEAGUE.rosterMax) this.repo.updateTask(t.id, { status: 'done', note: `승인 정리 ${notes.length}명 방출`, updated: meta.currentDate });
    else this.repo.updateTask(t.id, { status: 'queued', note: `아직 ${after}명 — 정리안을 다시 준비`, updated: meta.currentDate });
  }

  /** 마감일까지 처리되지 않으면 어떤 모드든 운영팀 제안안을 자동 적용하고 구단주에게 알린다(D-095). */
  private enforceRosterDeadline(meta: GameMeta, date: GameDate, inbox: InboxMessage[]) {
    const t = this.activeRosterTask();
    if (!t || String(t.params.deadline) > date) return;
    for (const a of this.repo.getApprovals('pending').filter((x) => x.taskId === t.id)) this.repo.updateApproval(a.id, 'expired');
    const plan = this.rosterProposal({ ...meta, currentDate: date });
    const notes = this.market.releaseForRoster({ ...meta, currentDate: date }, date, meta.userClubId, plan.ids);
    inbox.push({
      date,
      kind: 'report',
      sender: '운영팀',
      title: `마감 자동 적용: 40인 명단 정리 (${notes.length}명 방출)`,
      body: `명단 마감일(${date})까지 정리되지 않아 운영팀 제안안을 자동 적용했습니다.\n${notes.join('\n')}`,
    });
    this.repo.updateTask(t.id, { status: 'done', note: `마감 자동 적용 ${notes.length}명 방출`, updated: date });
  }

  private runHire(meta: GameMeta, date: GameDate, weekId: string, t: WorkTask, pol: DelegationPolicy) {
    const params = t.params as { team: TeamKey; title: '팀장' | '팀원'; maxSalary: number };
    const mine = this.staff(meta.userClubId);
    const probe = { title: params.title, team: params.team, part: null } as unknown as StaffMember;
    const err = this.vacancyError(mine, probe);
    if (err) {
      this.repo.updateTask(t.id, { status: 'failed', note: err, updated: date });
      return;
    }
    // 담당자는 평판(관찰 능력)으로 고른다. 판단력이 낮으면 평판 오차가 큰 후보를 고를 수 있다.
    const pick = this.repo
      .getStaff(null)
      .filter((c) => c.title === params.title && c.team === params.team && c.salary <= params.maxSalary)
      .map((c) => ({ c, score: reputation(meta.seed, c) }))
      .sort((a, b) => b.score - a.score || a.c.id - b.c.id)[0];
    if (!pick) {
      if (!t.note.startsWith('조건에 맞는 후보 없음')) this.repo.updateTask(t.id, { note: '조건에 맞는 후보 없음 — 다음 달 후보 교체 때 다시 찾음', updated: date });
      return;
    }
    if (!this.spendTaskWp(weekId, 'admin', TASK_WP.hire, t, date)) return;
    const summary = `${teamDef(params.team).name} ${params.title} 후보 ${pick.c.name} (연봉 ${won(pick.c.salary)}, ${pick.c.contractYears}년, 평판 ${Math.round(pick.score)})`;
    if (pol.mode === 'approve') {
      this.repo.insertApproval({ taskId: t.id, team: 'admin', kind: 'hire', date, summary, payload: { candidateId: pick.c.id, name: pick.c.name }, status: 'pending' });
      this.repo.updateTask(t.id, { status: 'waiting', note: '채용안 결재 대기', updated: date });
      return;
    }
    const r = this.hireCore(meta, pick.c.id, date);
    this.repo.updateTask(t.id, { status: 'done', note: r.message, updated: date });
  }

  // ───────── 결재 ─────────

  /** 승인: 행동력 없이 실행한다. 실행 시점에 규정·현금·자리를 다시 검증한다. */
  approve(meta: GameMeta, approvalId: number) {
    const a = this.repo.getApprovals('pending').find((x) => x.id === approvalId);
    if (!a) throw new GameError('NOT_AVAILABLE', '결재 대기 중인 안건이 아닙니다.');
    const t = this.repo.getTasks({ status: ['waiting'] }).find((x) => x.id === a.taskId);
    if (!t) throw new GameError('NOT_AVAILABLE', '연결된 업무가 없습니다.');
    const inbox: InboxMessage[] = [];
    return this.repo.transaction(() => {
      this.repo.updateApproval(a.id, 'approved');
      const staff = this.staff(meta.userClubId);
      const d = this.delegate(t.team, staff);
      if (a.kind === 'fa') {
        const pol = this.policy('ops');
        const offer = a.payload.offer as ContractOffer;
        const e = this.repo.getFa(Number(meta.kDate.slice(0, 4))).find((x) => x.playerId === t.targetId);
        const comp = e && e.originClub !== meta.userClubId ? compensationFor(e.grade ?? 'C', e.priorSalary) : 0;
        if (this.repo.cashBalance(meta.userClubId) - offer.bonus - comp < pol.cashFloor) throw new GameError('CASH_FLOOR', `승인하면 현금이 하한(${won(pol.cashFloor)}) 아래로 내려갑니다.`);
        this.executeFa(meta, meta.currentDate, t, t.params as never, t.targetId, offer, d?.who ?? staff[0]!, inbox);
      } else if (a.kind === 'salary') {
        const pol = this.policy('ops');
        const offer = Number(a.payload.offer);
        const talk = this.repo.getSalaryTalks(Number(meta.kDate.slice(0, 4))).find((x) => x.playerId === t.targetId);
        this.executeSalary(meta, meta.currentDate, t, t.params, offer, talk ? offer >= round1m(talk.demand * (pol.salaryMaxRatioBp / 10_000)) : true, inbox);
      } else if (a.kind === 'roster') {
        this.executeRosterApproval(meta, t, a.payload.playerIds as number[], inbox);
      } else {
        const c = this.repo.getStaff(null).find((s) => s.id === Number(a.payload.candidateId));
        if (!c || c.name !== a.payload.name) throw new GameError('NOT_AVAILABLE', '후보가 더 이상 채용 시장에 없습니다.');
        const r = this.hireCore(meta, c.id, meta.currentDate);
        this.repo.updateTask(t.id, { status: 'done', note: r.message, updated: meta.currentDate });
      }
      this.repo.addInbox(inbox);
      const after = this.repo.getTasks({}).find((x) => x.id === t.id)!;
      return { result: 'accept' as const, message: `승인했습니다. ${after.note}` };
    });
  }

  /** 여러 안건을 한 번에 결재한다(주 시작 팝업). 각 안건의 한도·규정을 다시 검증하고, 실패한 안건은 결재함에 남는다. */
  decideMany(meta: GameMeta, ids: number[], approve: boolean) {
    const lines: string[] = [];
    let ok = 0;
    for (const id of ids) {
      try {
        const r = approve ? this.approve(meta, id) : this.reject(meta, id);
        lines.push(r.message);
        ok++;
      } catch (e) {
        lines.push(e instanceof GameError ? e.message : String(e));
      }
    }
    return { result: ok > 0 ? ('accept' as const) : ('reject' as const), message: `${approve ? '승인' : '반려'} ${ok}/${ids.length}건. ${lines.slice(0, 3).join(' / ')}${lines.length > 3 ? ' …' : ''}` };
  }

  reject(meta: GameMeta, approvalId: number) {
    const a = this.repo.getApprovals('pending').find((x) => x.id === approvalId);
    if (!a) throw new GameError('NOT_AVAILABLE', '결재 대기 중인 안건이 아닙니다.');
    if (a.kind === 'roster') {
      // 의무 안건은 반려해도 사라지지 않는다. 더 상정하지 않고, 마감일까지 직접 정리하지 않으면 제안안을 자동 적용한다(D-095).
      const t = this.repo.getTasks({ status: ['waiting', 'queued'] }).find((x) => x.id === a.taskId);
      const deadline = String(t?.params.deadline ?? '');
      this.repo.transaction(() => {
        this.repo.updateApproval(a.id, 'rejected');
        if (t) this.repo.updateTask(t.id, { status: 'queued', params: { ...t.params, hold: true }, note: `반려 — ${deadline}까지 직접 정리하지 않으면 운영팀 제안안을 자동 적용`, updated: meta.currentDate });
      });
      return { result: 'accept' as const, message: `반려했습니다. ${deadline}까지 40명 이하로 직접 정리하지 않으면 운영팀 제안안이 자동 적용됩니다.` };
    }
    this.repo.transaction(() => {
      this.repo.updateApproval(a.id, 'rejected');
      this.repo.updateTask(a.taskId, { status: 'cancelled', note: '구단주 반려', updated: meta.currentDate });
    });
    return { result: 'accept' as const, message: '반려했습니다. 같은 안건은 다시 올라오지 않습니다.' };
  }

  // ───────── 표시용 ─────────

  observed(meta: GameMeta, s: StaffMember): Array<{ key: string; value: number }> {
    return Object.keys(s.abilities).map((k) => ({ key: k, value: observedAbility(meta.seed, s, k, s.clubId === meta.userClubId) }));
  }

  coachSlots() {
    return COACH_SLOTS;
  }

  approvals(): ApprovalRequest[] {
    return this.repo.getApprovals('pending');
  }
}

/** 평판 점수: 관찰 능력 평균(20~80) */
function reputation(seed: string, s: StaffMember): number {
  const keys = Object.keys(s.abilities).filter((k) => k !== 'authority');
  return keys.reduce((a, k) => a + observedAbility(seed, s, k, false), 0) / keys.length;
}
