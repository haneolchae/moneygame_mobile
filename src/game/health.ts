// 4b-1 건강(12 문서, D-126): 피로 계산, 경기 뒤 부상 판정, 부상자 1·2군 정리, 복귀, 휴식 지시, 특별 검사, 주간 건강 보고.
// 모든 구단이 같은 규칙을 쓰고, 우리 구단만 알림을 받는다. 실제 복귀일은 화면 응답에 넣지 않는다.
import { addDays, ageOn, diffDays, weekday, type GameDate } from '../engine/calendar';
import { HEALTH } from '../engine/config';
import { allStarDates } from '../engine/allStar';
import { allStarAppearances } from './allStar';
import type { GameResult } from '../engine/gamesim';
import { estimatedDaysLeft, hitterFatigue, injuredOn, injuryChance, pitcherFatigue, riskLevel, rollInjury } from '../engine/health';
import { overall } from '../engine/worldgen';
import type { PlayerId, PlayerTruth } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { GameMeta, GameRepository, InboxMessage } from './ports';
import type { RosterOps } from './rosterOps';

const md = (d: GameDate) => d.slice(5).replace('-', '/');

export class HealthOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly roster: RosterOps,
    private readonly medicalQuality: (clubId: number) => number,
    /** 4c-2b(D-172): 감독 컨디션 관리 — 경기 사이 피로 누적 배율 */
    private readonly condition: (clubId: number) => number = () => 1,
  ) {}

  /** 그날 아직 복귀하지 않은 부상인가(부상 발생 당일 경기 뒤 ~ 복귀일 전날) */
  private hurt(p: PlayerTruth, date: GameDate): boolean {
    const inj = p.health?.injury;
    return !!inj && diffDays(date, inj.returnDate) < 0;
  }

  /** 피로 지도: date 경기 직전 기준(includeToday면 그날 경기까지 포함) */
  fatigueMap(date: GameDate, players: PlayerTruth[], includeToday = false): Map<PlayerId, number> {
    const end = includeToday ? addDays(date, 1) : date;
    const from = addDays(end, -HEALTH.fatigueDays);
    const ref = includeToday ? date : addDays(date, -1);
    const bat = new Map<PlayerId, number[]>();
    for (const g of this.repo.getRecentBatterGames(from, end)) bat.set(g.batterId, [...(bat.get(g.batterId) ?? []), diffDays(ref, g.date)]);
    const pit = new Map<PlayerId, Array<{ daysAgo: number; pitches: number }>>();
    for (const u of this.repo.getRecentPitcherUsage(from, end)) pit.set(u.pitcherId, [...(pit.get(u.pitcherId) ?? []), { daysAgo: diffDays(ref, u.date), pitches: u.pitches }]);
    // 8e-2(D-190 (7)): 홈런 레이스·올스타전 출전일도 출전으로 센다(그 기간이 올스타 일정과 겹칠 때만 읽는다)
    const year = Number(ref.slice(0, 4));
    const asd = allStarDates(year);
    if ((asd.hrRace >= from && asd.hrRace < end) || (asd.game >= from && asd.game < end)) {
      const row = this.repo.getAllStar(year);
      if (row) {
        const ap = allStarAppearances([row], from, end);
        for (const b of ap.batters) bat.set(b.batterId, [...(bat.get(b.batterId) ?? []), diffDays(ref, b.date)]);
        for (const u of ap.pitchers) pit.set(u.pitcherId, [...(pit.get(u.pitcherId) ?? []), { daysAgo: diffDays(ref, u.date), pitches: u.pitches }]);
      }
    }
    const out = new Map<PlayerId, number>();
    for (const p of players) out.set(p.id, p.isPitcher ? pitcherFatigue(pit.get(p.id) ?? []) : hitterFatigue(bat.get(p.id) ?? [], p.position === 'C'));
    return out;
  }

  /** 그날 경기에 나설 수 없는 선수: 부상 + 우리 구단 휴식 지시 */
  unavailableOn(meta: GameMeta, date: GameDate, players: PlayerTruth[]): Set<PlayerId> {
    const out = new Set<PlayerId>();
    for (const p of players) if (injuredOn(p.health?.injury, date)) out.add(p.id);
    for (const [id, until] of Object.entries(meta.restOrders ?? {})) if (diffDays(date, until) <= 0) out.add(Number(id));
    return out;
  }

  /** 감독 자동 휴식 대상(피로 높은 야수) */
  tiredOn(date: GameDate, players: PlayerTruth[]): Set<PlayerId> {
    const f = this.fatigueMap(date, players.filter((p) => !p.isPitcher));
    return new Set([...f.entries()].filter(([, v]) => v >= HEALTH.autoRestFatigue).map(([id]) => id));
  }

  /**
   * 1군 건강 핵심 인원 확보: 1군에서 내려야 할 부상자(추정 10일 이상, 또는 건강 인원이 모자랄 때 짧은 부상자)를 내리고
   * 같은 쪽 건강한 2군 최고 선수를 올린다. 모든 구단 같은 규칙. 우리 구단 변경 문장을 돌려준다.
   */
  private settleClub(meta: GameMeta, clubId: number, date: GameDate, players: PlayerTruth[]): string[] {
    const mine = players.filter((p) => p.clubId === clubId && !p.retired);
    const active = mine.filter((p) => p.level === '1군');
    const tomorrow = addDays(date, 1);
    const sick = (p: PlayerTruth) => this.hurt(p, tomorrow);
    const demote = new Set(active.filter((p) => sick(p) && estimatedDaysLeft(p.health!.injury!, date) >= HEALTH.demoteDays));
    const healthy = () => active.filter((p) => !demote.has(p) && !sick(p));
    const short = (pitcher: boolean) => active.filter((p) => p.isPitcher === pitcher && sick(p) && !demote.has(p)).sort((a, b) => estimatedDaysLeft(b.health!.injury!, date) - estimatedDaysLeft(a.health!.injury!, date));
    // 건강 인원이 모자라면 짧은 부상자도 내린다.
    for (const pitcher of [false, true]) {
      const min = pitcher ? HEALTH.healthyMinPitchers : HEALTH.healthyMinHitters;
      for (const p of short(pitcher)) {
        if (healthy().filter((x) => x.isPitcher === pitcher).length + 0 >= min && (pitcher || healthy().some((x) => x.position === 'C'))) break;
        demote.add(p);
      }
    }
    if (demote.size === 0) return [];
    const isUser = clubId === meta.userClubId;
    const pool = mine.filter((p) => p.level !== '1군' && !sick(p) && !(isUser && this.roster.reRegisterDate(meta, p.id)));
    const promote: PlayerTruth[] = [];
    const take = (pred: (p: PlayerTruth) => boolean) => {
      const pick = pool.filter((p) => !promote.includes(p) && pred(p)).sort((a, b) => overall(b) - overall(a) || a.id - b.id)[0];
      if (pick) promote.push(pick);
      return pick;
    };
    // 대체는 같은 쪽(투수↔투수, 야수↔야수)에서만. 없으면 그 부상자는 1군에 두고 출전만 제외한다(D-126).
    const down: PlayerTruth[] = [];
    for (const d of [...demote].sort((a, b) => estimatedDaysLeft(b.health!.injury!, date) - estimatedDaysLeft(a.health!.injury!, date))) {
      const needC = !d.isPitcher && d.position === 'C' && healthy().concat(promote).filter((x) => !x.isPitcher && x.position === 'C').length < 1;
      const pick = (needC ? take((p) => !p.isPitcher && p.position === 'C') : undefined) ?? take((p) => p.isPitcher === d.isPitcher);
      if (pick) down.push(d);
    }
    if (down.length === 0) return [];
    for (const p of down) p.health!.injury!.demoted = true;
    const fixed = this.roster.forceMoves(meta, players, promote, down);
    if (!isUser || down.length === 0) return [];
    return [`부상 말소: ${down.map((p) => p.name).join(', ')} → 대체 등록: ${promote.map((p) => p.name).join(', ')}${fixed ? ` · ${fixed}` : ''}`];
  }

  /** 하루 시작(경기 전): 복귀, AI·자동 운영 되돌리기, 1군 건강 인원 확보, 휴식 지시 정리, 월요일 주간 건강 보고 */
  beforeGames(meta: GameMeta, date: GameDate): InboxMessage[] {
    const inbox: InboxMessage[] = [];
    const players = this.repo.getPlayers();
    const changed = new Set<PlayerTruth>();
    const returned: string[] = [];
    for (const p of players) {
      const inj = p.health?.injury;
      if (!inj || diffDays(date, inj.returnDate) < 0) continue;
      p.health!.history.push({ date: inj.date, returnDate: inj.returnDate, part: inj.part, severity: inj.severity });
      p.health!.injury = null;
      changed.add(p);
      if (p.retired || p.clubId === null) continue;
      const isUser = p.clubId === meta.userClubId;
      // 부상으로 내렸던 1군 선수: AI 구단과 우리 구단 감독 자동 운영은 같은 쪽 가장 약한 건강 1군 선수와 바꿔 되돌린다.
      const autoReturn = inj.demoted && inj.wasActive && p.level === '2군' && meta.mode === 'season' && (!isUser || (meta.userPlan?.mode ?? 'auto') === 'auto') && !(isUser && this.roster.reRegisterDate(meta, p.id));
      if (autoReturn) {
        const sameSide = players.filter((x) => x.clubId === p.clubId && x.level === '1군' && x.isPitcher === p.isPitcher && !this.hurt(x, date) && (p.position === 'C' || x.position !== 'C'));
        const weakest = sameSide.sort((a, b) => overall(a) - overall(b) || b.id - a.id)[0];
        if (weakest && overall(weakest) < overall(p)) {
          const fixed = this.roster.forceMoves(meta, players, [p], [weakest]);
          if (isUser) returned.push(`${p.name} 복귀 → 1군 등록(${weakest.name} 2군)${fixed ? ` · ${fixed}` : ''}`);
          continue;
        }
      }
      if (isUser) returned.push(`${p.name} 복귀(${p.level}) — 출전 가능`);
    }
    if (changed.size) this.repo.savePlayers([...changed]);
    if (meta.mode === 'season') {
      for (const c of this.repo.getClubs()) {
        const lines = this.settleClub(meta, c.id, addDays(date, -1), players);
        if (lines.length) inbox.push({ date, kind: 'report', sender: '감독', title: '부상 선수 1군 정리', body: lines.join('\n') });
      }
    }
    if (returned.length) inbox.push({ date, kind: 'report', sender: '컨디셔닝·메디컬팀', title: `부상 복귀 ${returned.length}명`, body: returned.join('\n') });
    // 끝난 휴식 지시 정리
    const orders = Object.fromEntries(Object.entries(meta.restOrders ?? {}).filter(([, until]) => diffDays(date, until) <= 0));
    if (Object.keys(orders).length !== Object.keys(meta.restOrders ?? {}).length) this.repo.updateMeta({ restOrders: orders });
    if (meta.mode === 'season' && weekday(date) === 1) inbox.push(...this.weeklyReport(meta, date, players));
    return inbox;
  }

  /** 경기 뒤: 출전 선수마다 부상 판정 1회, 부상자 1군 정리. 그날 경기 기록이 저장된 뒤 호출한다. */
  afterGames(meta: GameMeta, date: GameDate, results: GameResult[]): InboxMessage[] {
    if (results.length === 0) return [];
    const appeared = new Set<PlayerId>();
    for (const r of results) for (const e of r.events) {
      appeared.add(e.batterId);
      appeared.add(e.pitcherId);
    }
    const players = this.repo.getPlayers();
    const who = players.filter((p) => appeared.has(p.id) && p.clubId !== null && !this.hurt(p, date));
    const fatigue = this.fatigueMap(date, who, true);
    const injured: PlayerTruth[] = [];
    for (const p of who) {
      const inj = rollInjury(meta.seed, date, p, (fatigue.get(p.id) ?? 0) * this.condition(p.clubId!), ageOn(p.birthDate, date), this.medicalQuality(p.clubId!), p.level === '1군');
      if (!inj) continue;
      p.health = { injury: inj, history: p.health?.history ?? [], ...(p.health?.lastCheck ? { lastCheck: p.health.lastCheck } : {}) };
      injured.push(p);
    }
    if (injured.length === 0) return [];
    this.repo.savePlayers(injured);
    const inbox: InboxMessage[] = [];
    const clubs = new Set(injured.map((p) => p.clubId!));
    const moves: string[] = [];
    for (const c of clubs) moves.push(...this.settleClub(meta, c, date, players));
    const mine = injured.filter((p) => p.clubId === meta.userClubId);
    if (mine.length) {
      const lines = mine.map((p) => {
        const inj = p.health!.injury!;
        const foreign = p.origin !== 'domestic' && estimatedDaysLeft(inj, date) >= HEALTH.foreignLongDays ? ' · 외국인 장기 부상(시즌 중 외국인 교체는 아직 지원하지 않음)' : '';
        return `· ${p.name}: ${inj.part} ${inj.severity} — 복귀 추정 ${md(inj.estimate.from)}~${md(inj.estimate.to)}${foreign}`;
      });
      inbox.push({ date, kind: 'report', sender: '컨디셔닝·메디컬팀', title: `부상 ${mine.length}명: ${mine.map((p) => p.name).join(', ')}`, body: [...lines, ...moves].join('\n') });
    }
    return inbox;
  }

  private weeklyReport(meta: GameMeta, date: GameDate, players: PlayerTruth[]): InboxMessage[] {
    const mine = players.filter((p) => p.clubId === meta.userClubId && !p.retired);
    const hurt = mine.filter((p) => this.hurt(p, date));
    const fat = this.fatigueMap(date, mine.filter((p) => p.level === '1군'));
    const tired = mine.filter((p) => (fat.get(p.id) ?? 0) >= 60).sort((a, b) => (fat.get(b.id) ?? 0) - (fat.get(a.id) ?? 0));
    if (hurt.length === 0 && tired.length === 0) return [];
    const lines = [
      `부상 ${hurt.length}명`,
      ...hurt.map((p) => `· ${p.name}(${p.level}): ${p.health!.injury!.part} ${p.health!.injury!.severity}, 복귀 추정 ${md(p.health!.injury!.estimate.from)}~${md(p.health!.injury!.estimate.to)}`),
      `피로 높은 1군 ${tired.length}명`,
      ...tired.slice(0, 8).map((p) => `· ${p.name}: 피로 ${fat.get(p.id)}`),
      '휴식 지시(행동력 0)는 선수 상세에서, 특별 검사(행동력 1)로 부상 위험이나 복귀 전망을 더 정확히 볼 수 있습니다.',
    ];
    return [{ date, kind: 'report', sender: '컨디셔닝·메디컬팀', title: `주간 건강 보고: 부상 ${hurt.length}명 · 고피로 ${tired.length}명`, body: lines.join('\n') }];
  }

  // ───────── 구단주 행동 (선수 상세) ─────────

  restTarget(meta: GameMeta, playerId: PlayerId, days: number): PlayerTruth {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수에게만 휴식을 지시할 수 있습니다.');
    if (meta.mode !== 'season') throw new GameError('NOT_AVAILABLE', '휴식 지시는 시즌 중에 합니다.');
    if (!Number.isInteger(days) || days < 1 || days > HEALTH.restMaxDays) throw new GameError('INVALID', `휴식은 1~${HEALTH.restMaxDays}일입니다.`);
    if (this.hurt(p, meta.currentDate)) throw new GameError('NOT_AVAILABLE', '부상 중인 선수는 이미 출전하지 않습니다.');
    return p;
  }

  /** 휴식 지시: 오늘부터 days일 경기 제외. 행동력 0(D-115·D-126) */
  rest(meta: GameMeta, playerId: PlayerId, days: number): string {
    const p = this.restTarget(meta, playerId, days);
    const until = addDays(meta.currentDate, days - 1);
    this.repo.updateMeta({ restOrders: { ...(meta.restOrders ?? {}), [String(playerId)]: until } });
    return `${p.name}에게 ${md(meta.currentDate)}~${md(until)} 휴식을 지시했습니다(경기 제외).`;
  }

  checkTarget(meta: GameMeta, playerId: PlayerId): PlayerTruth {
    const p = this.repo.getPlayer(playerId);
    if (!p || p.clubId !== meta.userClubId) throw new GameError('NOT_AVAILABLE', '우리 구단 선수만 특별 검사를 할 수 있습니다.');
    const last = p.health?.lastCheck;
    if (last && diffDays(meta.currentDate, last) < HEALTH.checkCooldownDays) throw new GameError('DUPLICATE', `같은 선수 특별 검사는 ${md(addDays(last, HEALTH.checkCooldownDays))}부터 다시 할 수 있습니다.`);
    return p;
  }

  /** 특별 검사(행동력 1): 부상 중이면 복귀 추정 범위를 절반 폭으로, 건강하면 부상 위험 등급 보고 */
  medicalCheck(meta: GameMeta, weekId: string, playerId: PlayerId): string {
    const p = this.checkTarget(meta, playerId);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, HEALTH.checkAp);
      } catch {
        throw new GameError('AP_SHORT', '이번 주 행동력이 부족합니다.');
      }
      p.health = p.health ?? { injury: null, history: [] };
      p.health.lastCheck = meta.currentDate;
      let msg: string;
      const inj = p.health.injury;
      if (inj && this.hurt(p, meta.currentDate)) {
        // 추정 범위를 실제 복귀일 쪽으로 절반 폭으로 좁힌다(실제 날짜는 여전히 공개하지 않음).
        const half = (d: GameDate) => addDays(inj.returnDate, Math.round(diffDays(d, inj.returnDate) / 2));
        inj.estimate = { from: half(inj.estimate.from), to: half(inj.estimate.to) };
        msg = `${p.name} 정밀 검사: ${inj.part} ${inj.severity}, 복귀 추정 ${md(inj.estimate.from)}~${md(inj.estimate.to)}로 좁혀졌습니다.`;
      } else {
        const fat = this.fatigueMap(meta.currentDate, [p]).get(p.id) ?? 0;
        const level = riskLevel(injuryChance(p, fat, ageOn(p.birthDate, meta.currentDate)));
        msg = `${p.name} 검사: 현재 피로 ${fat}, 부상 위험 ${level}. ${level === '높음' ? '휴식 지시를 검토하세요.' : '특이 소견 없음.'}`;
      }
      this.repo.savePlayers([p]);
      return msg;
    });
  }

  /** 화면용 건강 정보: 우리 선수는 부위·추정 범위·피로·휴식, 다른 구단 선수는 부상 여부만 */
  view(meta: GameMeta, p: PlayerTruth, own: boolean) {
    const date = meta.currentDate;
    const inj = p.health?.injury && this.hurt(p, date) ? p.health.injury : null;
    if (!own) return { injured: !!inj, injury: null, fatigue: null, restUntil: null, lastCheck: null, history: [] };
    const restUntil = meta.restOrders?.[String(p.id)];
    return {
      injured: !!inj,
      injury: inj ? { part: inj.part, severity: inj.severity, date: inj.date, estimateFrom: inj.estimate.from, estimateTo: inj.estimate.to } : null,
      fatigue: p.clubId !== null ? (this.fatigueMap(date, [p]).get(p.id) ?? 0) : null,
      restUntil: restUntil && diffDays(date, restUntil) <= 0 ? restUntil : null,
      lastCheck: p.health?.lastCheck ?? null,
      history: [...(p.health?.history ?? [])].reverse().slice(0, 8).map((h) => ({ date: h.date, returnDate: h.returnDate, part: h.part, severity: h.severity })),
    };
  }

  /** 목록 표시용 상태: '부상' | '휴식' | null (다른 구단도 부상 여부는 공개) */
  status(meta: GameMeta, p: PlayerTruth): string | null {
    if (this.hurt(p, meta.currentDate)) return '부상';
    const until = meta.restOrders?.[String(p.id)];
    return p.clubId === meta.userClubId && until && diffDays(meta.currentDate, until) <= 0 ? '휴식' : null;
  }
}

