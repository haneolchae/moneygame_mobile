// 4b-2 집중 훈련(11 문서, D-128): 계획 지시·변경·중단·육성팀 위임, AI 구단 계획, 월간 반영용 훈련 강도 계산, 화면용 보기.
// 직접 지시와 위임은 같은 계획 저장 함수를 쓰고 비용 출처(행동력·처리량)만 다르다. 검증 실패는 비용이 없다.
import { addDays, ageOn, diffDays, type GameDate } from '../engine/calendar';
import { TRAINING as T } from '../engine/config';
import { DEV_LABEL, devKeys } from '../engine/development';
import { Rng } from '../engine/rng';
import type { StaffMember } from '../engine/staff';
import { activePlan, coachCapacity, coachFactor, coachPart, overloadFactor, planError, planStrength, trainingKeys } from '../engine/training';
import type { PlayerId, PlayerTruth, TrainingIntensity, TrainingPlan } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { Organization } from './organization';
import type { GameMeta, GameRepository } from './ports';
import { weekIdFor } from './week';

/** 이 나이 이하는 잠재 여유, 넘으면 현재 강점 유지를 우선한다(육성팀 판단, 히든 정점 나이를 쓰지 않음) */
const YOUNG_AGE = 26;

export interface TrainingRequest {
  primary: string;
  secondary: string | null;
  intensity: TrainingIntensity;
}

export class TrainingOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly org: Organization,
  ) {}

  private hurt(p: PlayerTruth, date: GameDate): boolean {
    const inj = p.health?.injury;
    return !!inj && diffDays(date, inj.returnDate) < 0;
  }

  // ───────── 코치·담당 ─────────

  private coachMap(clubId: number): Map<string, StaffMember> {
    const out = new Map<string, StaffMember>();
    for (const s of this.org.staff(clubId)) if ((s.title === '코치' || s.title === '수석코치') && s.part) out.set(s.part, s);
    return out;
  }

  /** 구단 코치 파트별 담당 인원(주 목표 기준) */
  private loads(clubId: number, players: PlayerTruth[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of players) {
      if (p.clubId !== clubId) continue;
      const plan = activePlan(p);
      if (!plan) continue;
      const part = coachPart(p, plan.primary);
      out.set(part, (out.get(part) ?? 0) + 1);
    }
    return out;
  }

  /**
   * 지난 30일 중 계획이 유효하고 부상이 아니었던 날의 강도 효과 합 / 30.
   * 강도를 바꾼 기록(log)으로 날마다 그날 강도를 쓴다(반영일 직전 강도 변경으로 한 달 효과를 얻지 못함).
   */
  coverage(p: PlayerTruth, plan: TrainingPlan, date: GameDate): number {
    const start = addDays(date, -T.periodDays);
    const log = plan.log?.length ? plan.log : [{ from: plan.since, intensity: plan.intensity }];
    const injuries = [...(p.health?.history ?? []), ...(p.health?.injury ? [p.health.injury] : [])];
    let sum = 0;
    for (let d = start; diffDays(date, d) > 0; d = addDays(d, 1)) {
      if (diffDays(d, plan.since) < 0) continue;
      if (injuries.some((i) => diffDays(d, i.date) > 0 && diffDays(d, i.returnDate) < 0)) continue;
      const seg = [...log].reverse().find((x) => diffDays(d, x.from) >= 0);
      if (seg) sum += T.intensity[seg.intensity].effect;
    }
    return sum / T.periodDays;
  }

  /** 월간 반영일: 선수별 능력 훈련 강도(유효 계획만) */
  strengths(date: GameDate, players: PlayerTruth[]): Map<PlayerId, Record<string, number>> {
    const out = new Map<PlayerId, Record<string, number>>();
    const byClub = new Map<number, PlayerTruth[]>();
    for (const p of players) if (activePlan(p)) byClub.set(p.clubId!, [...(byClub.get(p.clubId!) ?? []), p]);
    for (const [clubId, list] of byClub) {
      const coaches = this.coachMap(clubId);
      const loads = this.loads(clubId, list);
      for (const p of list) {
        const plan = activePlan(p)!;
        const part = coachPart(p, plan.primary);
        const coach = coaches.get(part);
        const factor = coachFactor(coach?.abilities.coaching ?? T.vacantCoaching, p.hidden.coachability) * overloadFactor(loads.get(part) ?? 0, coachCapacity(coach?.abilities.communication ?? 0));
        const s = planStrength(plan, factor, this.coverage(p, plan, date));
        if (Object.keys(s).length) out.set(p.id, s);
      }
    }
    return out;
  }

  // ───────── 계획 저장(직접·위임 공통) ─────────

  private write(p: PlayerTruth, req: TrainingRequest, date: GameDate, source: TrainingPlan['source']): void {
    const cur = activePlan(p);
    const sameTargets = !!cur && cur.primary === req.primary && cur.secondary === req.secondary;
    if (sameTargets) {
      // 강도만 변경: 시작일 유지, 강도 기록 추가(30일 넘은 기록은 정리)
      const keepFrom = addDays(date, -T.periodDays - 1);
      const log = (cur.log?.length ? cur.log : [{ from: cur.since, intensity: cur.intensity }]).filter((x) => x.from !== date);
      const pruned = log.filter((x, i) => i === log.length - 1 || diffDays(log[i + 1]!.from, keepFrom) > 0);
      p.training = { ...cur, intensity: req.intensity, log: [...pruned, { from: date, intensity: req.intensity }], source };
    } else {
      p.training = { clubId: p.clubId!, primary: req.primary, secondary: req.secondary, intensity: req.intensity, since: date, source, log: [{ from: date, intensity: req.intensity }] };
    }
    this.repo.savePlayers([p]);
  }

  /** 직접 지시 검증: 비용(행동력)과 변경 종류를 돌려준다. 실패하면 아무것도 바꾸지 않는다. */
  setTarget(meta: GameMeta, playerId: PlayerId, req: TrainingRequest): { p: PlayerTruth; ap: number; targetsChanged: boolean } {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.retired || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수에게만 훈련을 지시할 수 있습니다.');
    const err = planError(p, req.primary, req.secondary, req.intensity);
    if (err) throw new GameError('INVALID', err);
    const cur = activePlan(p);
    const targetsChanged = !cur || cur.primary !== req.primary || cur.secondary !== req.secondary;
    if (!targetsChanged && cur!.intensity === req.intensity) throw new GameError('DUPLICATE', '지금과 같은 훈련 계획입니다.');
    if (this.hurt(p, meta.currentDate)) {
      if (targetsChanged) throw new GameError('NOT_AVAILABLE', '부상 중인 선수에게는 새 훈련을 지시할 수 없습니다(중단·강도 낮춤만 가능).');
      if (T.intensity[req.intensity].effect > T.intensity[cur!.intensity].effect) throw new GameError('NOT_AVAILABLE', '부상 중에는 훈련 강도를 높일 수 없습니다.');
    }
    return { p, ap: targetsChanged ? T.directAp : 0, targetsChanged };
  }

  /** 직접 지시: 새 지시·목표 변경 행동력 1 + 육성팀 처리량 2, 강도만 변경 행동력 0 */
  set(meta: GameMeta, weekId: string, playerId: PlayerId, req: TrainingRequest): string {
    const t = this.setTarget(meta, playerId, req);
    return this.repo.transaction(() => {
      if (t.ap > 0) {
        try {
          this.repo.spendAp(weekId, t.ap);
        } catch {
          throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다.');
        }
        this.org.charge(meta, { kind: 'direct', weekId }, 'dev', T.planWp);
      }
      this.write(t.p, req, meta.currentDate, 'owner');
      const what = `${DEV_LABEL[req.primary]}${req.secondary ? ` · 보조 ${DEV_LABEL[req.secondary]}` : ''}`;
      return t.targetsChanged
        ? `${t.p.name} 집중 훈련: ${what}, 강도 ${T.intensity[req.intensity].label}. 다음 월간 반영부터 지난 기간 비율만큼 효과가 납니다.`
        : `${t.p.name} 훈련 강도를 ${T.intensity[req.intensity].label}(으)로 바꿨습니다(부상 위험 ×${T.intensity[req.intensity].injury}).`;
    });
  }

  stopTarget(meta: GameMeta, playerId: PlayerId): PlayerTruth {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수만 훈련을 중단할 수 있습니다.');
    if (!activePlan(p)) throw new GameError('NOT_AVAILABLE', '진행 중인 집중 훈련이 없습니다.');
    return p;
  }

  /** 중단: 행동력 0. 기본 훈련(4a 성장)만 남는다 */
  stop(meta: GameMeta, playerId: PlayerId): string {
    const p = this.stopTarget(meta, playerId);
    delete p.training;
    this.repo.savePlayers([p]);
    return `${p.name} 집중 훈련을 중단했습니다. 기본 훈련만 진행합니다.`;
  }

  /** 육성팀 목표 선택: 26세 이하는 잠재 여유 추정, 그 위는 현재 강점 유지. 역량이 낮을수록 추정 오차가 크다 */
  choose(p: PlayerTruth, quality: number, seed: string, date: GameDate): { primary: string; secondary: string | null } {
    const rng = Rng.derive(seed, 'train-pick', p.id, date);
    const sd = T.delegateNoiseBase + T.delegateNoiseSpan * (1 - quality);
    const young = ageOn(p.birthDate, date) <= YOUNG_AGE;
    const scored = devKeys(p)
      .map((k) => {
        const cur = k.get(p);
        const pot = (p.hidden.potential as Record<string, number | undefined>)[k.key] ?? cur;
        return { key: k.key, score: (young ? pot - cur : cur) + rng.normal(0, sd) };
      })
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    return { primary: scored[0]!.key, secondary: scored[1]?.key ?? null };
  }

  delegateTarget(meta: GameMeta, playerId: PlayerId): PlayerTruth {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.retired || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수만 육성팀에 맡길 수 있습니다.');
    if (this.hurt(p, meta.currentDate)) throw new GameError('NOT_AVAILABLE', '부상 중인 선수의 훈련 계획은 복귀 뒤에 세웁니다.');
    if (!this.org.teamDelegate(meta.userClubId, 'dev')) throw new GameError('NOT_AVAILABLE', '육성팀장과 단장이 모두 없어 맡길 수 없습니다.');
    return p;
  }

  /** 육성팀에 맡기기: 행동력 0, 육성팀 처리량 4. 육성팀이 목표를 고르고 강도는 보통 */
  delegate(meta: GameMeta, weekId: string, playerId: PlayerId): string {
    const p = this.delegateTarget(meta, playerId);
    const d = this.org.teamDelegate(meta.userClubId, 'dev')!;
    const pick = this.choose(p, d.quality, meta.seed, meta.currentDate);
    const cur = activePlan(p);
    if (cur && cur.primary === pick.primary && cur.secondary === pick.secondary && cur.intensity === 'normal') throw new GameError('DUPLICATE', `육성팀(${d.who.name}) 판단도 지금 계획과 같습니다.`);
    return this.repo.transaction(() => {
      this.org.spendDelegatedWp(meta, weekId, 'dev', T.planWp);
      this.write(p, { ...pick, intensity: 'normal' }, meta.currentDate, 'dev');
      return `육성팀(${d.who.name}) 계획: ${p.name} ${DEV_LABEL[pick.primary]}${pick.secondary ? ` · 보조 ${DEV_LABEL[pick.secondary]}` : ''}, 강도 보통.`;
    });
  }

  /** AI 구단: 스프링캠프 시작에 정점 전(26세 이하) 유망주 6명 계획(육성팀 판단, 강도 보통). 우리 구단은 건드리지 않는다 */
  planAi(meta: GameMeta, date: GameDate): void {
    const players = this.repo.getPlayers();
    const changed: PlayerTruth[] = [];
    for (const c of this.repo.getClubs()) {
      if (c.id === meta.userClubId) continue;
      const mine = players.filter((p) => p.clubId === c.id && !p.retired);
      for (const p of mine) if (p.training) {
        delete p.training;
        changed.push(p);
      }
      const quality = this.org.teamDelegate(c.id, 'dev')?.quality ?? 0.3;
      const rng = Rng.derive(meta.seed, 'train-ai', c.id, date);
      const young = mine
        .filter((p) => ageOn(p.birthDate, date) <= YOUNG_AGE && !this.hurt(p, date))
        .map((p) => ({ p, room: devKeys(p).reduce((a, k) => a + Math.max(0, ((p.hidden.potential as Record<string, number | undefined>)[k.key] ?? k.get(p)) - k.get(p)), 0) / devKeys(p).length + rng.normal(0, 3) }))
        .sort((a, b) => b.room - a.room || a.p.id - b.p.id)
        .slice(0, T.aiPlans);
      for (const { p } of young) {
        const pick = this.choose(p, quality, meta.seed, date);
        p.training = { clubId: c.id, primary: pick.primary, secondary: pick.secondary, intensity: 'normal', since: date, source: 'dev', log: [{ from: date, intensity: 'normal' }] };
        if (!changed.includes(p)) changed.push(p);
      }
    }
    if (changed.length) this.repo.savePlayers(changed);
  }

  // ───────── 화면 ─────────

  /** 선수 상세용(우리 선수만). 코칭 수용도는 모르는 범위로 예상 효과를 보여 준다 */
  view(meta: GameMeta, p: PlayerTruth) {
    const plan = activePlan(p);
    const players = this.repo.getPlayers();
    const coaches = this.coachMap(p.clubId!);
    const loads = this.loads(p.clubId!, players);
    const coachInfo = (key: string) => {
      const part = coachPart(p, key);
      const c = coaches.get(part) ?? null;
      const observed = c ? (this.org.observed(meta, c).find((x) => x.key === 'coaching')?.value ?? null) : null;
      return { part, name: c?.name ?? null, coaching: observed, load: loads.get(part) ?? 0, capacity: coachCapacity(c?.abilities.communication ?? 0) };
    };
    const primaryKey = plan?.primary ?? trainingKeys(p)[0]!;
    const coach = coachInfo(primaryKey);
    const over = overloadFactor(coach.load + (plan ? 0 : 1), coach.capacity);
    const coaching = coach.coaching ?? T.vacantCoaching;
    // 보통 강도 기준(화면이 고른 강도의 효과 배수를 곱한다)
    const pct = (cb: number) => T.growthBonus * coachFactor(coaching, cb) * over * 100;
    return {
      plan: plan
        ? { primary: plan.primary, primaryLabel: DEV_LABEL[plan.primary] ?? plan.primary, secondary: plan.secondary, secondaryLabel: plan.secondary ? (DEV_LABEL[plan.secondary] ?? plan.secondary) : null, intensity: plan.intensity, intensityLabel: T.intensity[plan.intensity].label, since: plan.since, source: plan.source === 'owner' ? '구단주 지시' : '육성팀 계획' }
        : null,
      keys: trainingKeys(p).map((k) => ({ key: k, label: DEV_LABEL[k] ?? k })),
      coach,
      expected: { growthPctLow: pct(0), growthPctHigh: pct(100) },
      intensities: (['low', 'normal', 'high'] as const).map((k) => ({ key: k, label: T.intensity[k].label, effect: T.intensity[k].effect, injury: T.intensity[k].injury })),
      devWpLeft: this.org.wpRemaining(meta, weekIdFor(meta.currentDate), 'dev'),
      delegateName: this.org.teamDelegate(meta.userClubId, 'dev')?.who.name ?? null,
    };
  }

  /** 선수단 운영 화면: 우리 구단 계획 표와 코치별 담당 인원 */
  rosterTable(meta: GameMeta) {
    const players = this.repo.getPlayers().filter((p) => p.clubId === meta.userClubId && !p.retired);
    const coaches = this.coachMap(meta.userClubId);
    const loads = this.loads(meta.userClubId, players);
    const rows = players
      .filter((p) => activePlan(p))
      .map((p) => {
        const plan = activePlan(p)!;
        const part = coachPart(p, plan.primary);
        return {
          playerId: p.id,
          name: p.name,
          level: p.level,
          primaryLabel: DEV_LABEL[plan.primary] ?? plan.primary,
          secondaryLabel: plan.secondary ? (DEV_LABEL[plan.secondary] ?? plan.secondary) : null,
          intensityLabel: T.intensity[plan.intensity].label,
          since: plan.since,
          source: plan.source === 'owner' ? '구단주' : '육성팀',
          coachPart: part,
          coachName: coaches.get(part)?.name ?? null,
          injured: this.hurt(p, meta.currentDate),
        };
      });
    const loadRows = [...loads.entries()].map(([part, load]) => ({ part, name: coaches.get(part)?.name ?? null, load, capacity: coachCapacity(coaches.get(part)?.abilities.communication ?? 0) })).sort((a, b) => a.part.localeCompare(b.part));
    return { rows, loads: loadRows };
  }

  /** 월간 성장 보고에 붙일 훈련 표시 */
  static mark(p: PlayerTruth, key: string): string {
    const plan = activePlan(p);
    return plan && (plan.primary === key || plan.secondary === key) ? '(훈련)' : '';
  }
}
