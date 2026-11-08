// 조직·위임 (03 문서, D-020~D-028, D-076): 직원 채용·해고, 팀 처리량, 위임 정책, 업무 큐, 결재.
// 위임 실행은 Market의 같은 도메인 로직을 호출하고, 비용 출처(행동력 대신 처리량)만 다르다.
import { weekday, type GameDate } from '../engine/calendar';
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
import { weekIdFor } from './week';
import type { ApprovalRequest, DelegationPolicy, GameMeta, GameRepository, InboxMessage, WorkTask } from './ports';

const won = (n: number) => `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억`;
const round1m = (n: number) => Math.max(0, Math.round(n / 1_000_000) * 1_000_000);

/** ASSUMPTION(D-076): 행동력 비용. 직접 채용 2는 03 문서, 해고 1은 초기안 */
export const ORG_AP = { hire: 2, fire: 1 } as const;

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

  scoutingScale(meta: GameMeta): number {
    return scoutingSdScale(this.staff(meta.userClubId));
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
    this.repo.spendWp(source.weekId, team, Math.ceil(fullCost / 2), true);
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
    if (p.mode === 'direct') {
      for (const t of this.repo.getTasks({ status: ['queued', 'waiting'] }).filter((x) => x.team === p.team)) this.repo.updateTask(t.id, { status: 'cancelled', note: '직접 운영으로 전환', updated: meta.currentDate });
      for (const a of this.repo.getApprovals('pending').filter((x) => x.team === p.team)) this.repo.updateApproval(a.id, 'expired');
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

  delegateFa(meta: GameMeta, playerId: number, maxTotal?: number, maxYears?: number) {
    const pol = this.requireDelegable('ops');
    const e = this.repo.getFa(Number(meta.kDate.slice(0, 4))).find((x) => x.playerId === playerId);
    if (!e || !['applied', 'approved'].includes(e.status)) throw new GameError('NOT_AVAILABLE', '협상할 수 있는 FA 선수가 아닙니다.');
    const params = { maxTotal: maxTotal ?? pol.faMaxTotal, maxYears: maxYears ?? pol.faMaxYears, round: 0, lastWeek: '', lastRatio: 0, counter: null as ContractOffer | null };
    if (params.maxTotal <= 0 || params.maxYears < 1) throw new GameError('INVALID', '한도를 확인하세요.');
    // 이미 진행 중인 위임(담당 팀 자체 안건 포함)이 있으면 한도만 바꾼다.
    const existing = this.activeTask(playerId, 'fa');
    if (existing) {
      this.requeue(existing, meta.currentDate);
      this.repo.updateTask(existing.id, { params: { ...existing.params, maxTotal: params.maxTotal, maxYears: params.maxYears, lastWeek: '' }, note: `한도 변경: 총액 ${won(params.maxTotal)}·${params.maxYears}년 이내`, updated: meta.currentDate });
      return { result: 'accept' as const, message: `진행 중인 위임의 한도를 총액 ${won(params.maxTotal)}, ${params.maxYears}년으로 바꿨습니다.` };
    }
    this.repo.insertTask({ team: 'ops', kind: 'fa', targetId: playerId, params, status: 'queued', created: meta.currentDate, updated: meta.currentDate, note: `총액 ${won(params.maxTotal)}·${params.maxYears}년 이내` });
    return { result: 'accept' as const, message: `운영팀에 맡겼습니다. 총액 ${won(params.maxTotal)}, ${params.maxYears}년 이내에서 매주 한 번 협상합니다.` };
  }

  delegateSalary(meta: GameMeta, playerId?: number) {
    this.requireDelegable('ops');
    const talks = this.repo.getSalaryTalks(Number(meta.kDate.slice(0, 4))).filter((t) => t.clubId === meta.userClubId && t.status === 'open' && (playerId === undefined || t.playerId === playerId));
    let n = 0;
    this.repo.transaction(() => {
      for (const t of talks) {
        if (this.activeTask(t.playerId, 'salary')) continue;
        this.repo.insertTask({ team: 'ops', kind: 'salary', targetId: t.playerId, params: { round: 0, lastWeek: '' }, status: 'queued', created: meta.currentDate, updated: meta.currentDate, note: '' });
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
    if (weekday(date) === 1) this.expireApprovals(date);
    this.proposeOwnAgenda(meta, date);
    const staff = this.staff(meta.userClubId);
    // 큐 우선순위(03 문서): FA → 연봉 협상 → 채용. FA는 간판 선수, 큰 계약 순.
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const kindOrder: Record<string, number> = { fa: 0, salary: 1, hire: 2 };
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
    const ops = this.policy('ops');
    const off = Number(meta.kDate.slice(0, 4));
    const sd = stoveDates(meta.kDate);
    const note = '담당 팀 자체 안건';
    if (ops.mode !== 'direct' && meta.mode === 'stove' && date === sd.faMarketOpen) {
      for (const e of this.repo.getFa(off).filter((x) => x.originClub === meta.userClubId && x.status === 'approved')) {
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

  /** 주가 바뀌면 지난주 결재 대기는 만료하고 업무를 취소한다(조건 변화 없이 재상정하지 않는다). */
  expireApprovals(date: GameDate): void {
    const weekId = weekIdFor(date);
    for (const a of this.repo.getApprovals('pending')) {
      if (weekIdFor(a.date) === weekId) continue;
      this.repo.updateApproval(a.id, 'expired');
      this.repo.updateTask(a.taskId, { status: 'cancelled', note: '결재 기한(주) 경과', updated: date });
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
    const params = t.params as { maxTotal: number; maxYears: number; round: number; lastWeek: string; lastRatio: number; counter: ContractOffer | null };
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
    if (pol.mode === 'approve') {
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
      const ratio = params.round === 0 ? start : Math.max(start, params.lastRatio + 0.05);
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
      if (followUp && this.policy('ops').mode === 'auto' && this.wpLeft(weekId, 'ops') >= TASK_WP.faRound) {
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
    const maxRatio = pol.salaryMaxRatioBp / 10_000;
    const ratio = Math.min(maxRatio, 0.93 + 0.04 * (1 - d.quality) + 0.02 * params.round);
    const offer = Math.max(30_000_000, round1m(talk.demand * ratio));
    const name = this.repo.getPlayer(t.targetId)?.name ?? '';
    if (!this.spendTaskWp(weekId, 'ops', TASK_WP.salaryTalk, t, date)) return;
    params.round += 1;
    params.lastWeek = weekId;
    if (pol.mode === 'approve') {
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
