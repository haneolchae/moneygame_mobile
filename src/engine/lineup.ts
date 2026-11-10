// 감독 자동 운영: 경기 준비 (09·10 문서). 1군 선수로 라인업·선발·불펜을 정한다.
import { SIM } from './config';
import type { LineupSpot, TeamSetup } from './gamesim';
import type { DefenseContext } from './probability';
import type { ClubId, PlayerId, PlayerTruth, Position } from './types';
import { FIELD_POSITIONS } from './types';
import { defenseValue, pitcherOverall } from './worldgen';

/** 최근 투구 기록: 날짜 차이(1=어제)별 투구 수 */
export interface PitcherUsage {
  pitcherId: PlayerId;
  daysAgo: number;
  pitches: number;
  started: boolean;
}

const offense = (p: PlayerTruth) => {
  const b = p.batting;
  return 0.35 * b.contact + 0.25 * b.eye + 0.32 * b.power + 0.08 * b.speed;
};

const POSITION_WEIGHT: Record<string, number> = { C: 1.3, SS: 1.3, '2B': 1.15, CF: 1.15, '3B': 1, LF: 0.85, RF: 0.9, '1B': 0.7 };

/** 그 포지션에서의 수비 지수: 수비 종합 + 포지션 숙련도 보정(낯선 포지션은 같은 효율을 내지 못함, D-087) */
export function fieldingAt(p: PlayerTruth, pos: Position): number {
  const skill = p.positions[pos] ?? 0;
  return defenseValue(p.defense) + (skill - SIM.positionSkillPivot) * SIM.positionSkillWeight;
}

function buildLineup(hitters: PlayerTruth[]): { lineup: LineupSpot[]; defense: DefenseContext } {
  const used = new Set<PlayerId>();
  const field: Array<{ player: PlayerTruth; position: Position }> = [];
  for (const pos of FIELD_POSITIONS) {
    const candidates = hitters.filter((h) => !used.has(h.id));
    // 주 포지션 선수 중 공격+수비가 가장 좋은 선수, 없으면 남은 야수 중 수비가 가장 좋은 선수
    const natural = candidates.filter((h) => h.position === pos);
    const pool = natural.length > 0 ? natural : candidates;
    const value = (h: PlayerTruth) => offense(h) * 0.6 + fieldingAt(h, pos) * 0.4 * (POSITION_WEIGHT[pos] ?? 1);
    const best = [...pool].sort((a, b) => value(b) - value(a) || a.id - b.id)[0];
    if (!best) throw new Error(`라인업 구성 불가: ${pos}`);
    used.add(best.id);
    field.push({ player: best, position: pos });
  }
  const dh = hitters.filter((h) => !used.has(h.id)).sort((a, b) => offense(b) - offense(a) || a.id - b.id)[0];
  if (!dh) throw new Error('지명타자 없음');
  const spots: LineupSpot[] = [...field, { player: dh, position: 'DH' }];
  // 타순: 공격력 순으로 정렬한 뒤 2번째로 좋은 타자를 1번, 가장 좋은 타자를 3번에 둔다.
  const sorted = [...spots].sort((a, b) => offense(b.player) - offense(a.player) || a.player.id - b.player.id);
  const order = [1, 3, 0, 2, 4, 5, 6, 7, 8].map((i) => sorted[i]!);
  // 개인 수비 능력은 존 모델(10b)이 수비수별로 쓴다. 여기서는 포수 프레이밍(상황 보정)만 넘긴다.
  const catcher = field.find((f) => f.position === 'C')?.player;
  const defense: DefenseContext = { framing: catcher?.catcher?.framing ?? 30 };
  return { lineup: order, defense };
}

/** 선발 로테이션: 직전 선발 다음 순번. 충분히 쉬지 않았으면 가장 오래 쉰 선발. */
function pickStarter(starters: PlayerTruth[], usage: PitcherUsage[], lastStarterId: PlayerId | null): PlayerTruth {
  const rotation = [...starters].sort((a, b) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id);
  const restDays = (p: PlayerTruth) => {
    const last = usage.filter((u) => u.pitcherId === p.id).sort((a, b) => a.daysAgo - b.daysAgo)[0];
    return last ? last.daysAgo : 99;
  };
  const lastIndex = rotation.findIndex((p) => p.id === lastStarterId);
  const next = rotation[(lastIndex + 1) % rotation.length]!;
  if (restDays(next) > SIM.starterRestDays) return next;
  return [...rotation].sort((a, b) => restDays(b) - restDays(a) || a.id - b.id)[0]!;
}

/** 불펜 가용: 어제 30구 이상 던졌거나 이틀 연속 던졌으면 쉰다. */
function bullpenAvailable(p: PlayerTruth, usage: PitcherUsage[]): boolean {
  const mine = usage.filter((u) => u.pitcherId === p.id);
  const yesterday = mine.find((u) => u.daysAgo === 1);
  const dayBefore = mine.find((u) => u.daysAgo === 2);
  if (yesterday && yesterday.pitches >= 30) return false;
  if (yesterday && dayBefore) return false;
  return true;
}

// ───────── 사용자 경기 운영 계획 (2d, D-120) ─────────

/** 수동 운영 계획: 타순(9명, 수비 위치 포함)·선발 로테이션·마무리. 감독 자동 운영과 같은 경기 준비 로직이 읽는다. */
export interface GamePlan {
  lineup: Array<{ playerId: PlayerId; position: Position | 'DH' }>;
  rotation: PlayerId[];
  closer: PlayerId | null;
}

const LINEUP_POSITIONS: ReadonlyArray<Position | 'DH'> = [...FIELD_POSITIONS, 'DH'];

/** 선발 로테이션 추천 순서: 선발(SP) 종합 능력 순, 모자라면 나머지 투수로 채운다. */
function rotationOrder(pitchers: PlayerTruth[], size: number): PlayerTruth[] {
  const byOvr = (a: PlayerTruth, b: PlayerTruth) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id;
  const sp = pitchers.filter((p) => p.position === 'SP').sort(byOvr);
  const rest = pitchers.filter((p) => p.position !== 'SP').sort(byOvr);
  return [...sp, ...rest].slice(0, size);
}

/** 감독 추천안: 자동 운영과 같은 라인업 규칙, 종합 능력 순 로테이션, 가장 좋은 구원 투수를 마무리로 */
export function recommendPlan(activePlayers: PlayerTruth[], rotationSize: number): GamePlan {
  const hitters = activePlayers.filter((p) => !p.isPitcher);
  const pitchers = activePlayers.filter((p) => p.isPitcher);
  const { lineup } = buildLineup(hitters);
  const rotation = rotationOrder(pitchers, rotationSize);
  const closer = pitchers.filter((p) => !rotation.includes(p) && p.position === 'RP').sort((a, b) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id)[0] ?? null;
  return { lineup: lineup.map((s) => ({ playerId: s.player.id, position: s.position })), rotation: rotation.map((p) => p.id), closer: closer?.id ?? null };
}

/** 계획 검증: 1군 선수만, 타자 9명 중복 없음·8개 수비 위치와 지명타자 각 1명, 로테이션 인원·중복, 마무리는 로테이션 밖 1군 투수 */
export function planProblems(plan: GamePlan, activePlayers: PlayerTruth[], rotationSize: number): string[] {
  const byId = new Map(activePlayers.map((p) => [p.id, p]));
  const out: string[] = [];
  const ids = plan.lineup.map((s) => s.playerId);
  if (plan.lineup.length !== 9) out.push('타순은 9명이어야 합니다.');
  if (new Set(ids).size !== ids.length) out.push('타순에 같은 선수가 두 번 있습니다.');
  for (const s of plan.lineup) {
    const p = byId.get(s.playerId);
    if (!p) out.push(`타순의 선수(#${s.playerId})가 1군에 없습니다.`);
    else if (p.isPitcher) out.push(`${p.name}은 투수라 타순에 넣을 수 없습니다(지명타자 제도).`);
  }
  for (const pos of LINEUP_POSITIONS) {
    const n = plan.lineup.filter((s) => s.position === pos).length;
    if (n !== 1) out.push(`${pos} 위치는 정확히 1명이어야 합니다(현재 ${n}명).`);
  }
  if (plan.rotation.length !== rotationSize) out.push(`선발 로테이션은 ${rotationSize}명이어야 합니다.`);
  if (new Set(plan.rotation).size !== plan.rotation.length) out.push('로테이션에 같은 투수가 두 번 있습니다.');
  for (const id of plan.rotation) {
    const p = byId.get(id);
    if (!p || !p.isPitcher) out.push(`로테이션의 선수(#${id})가 1군 투수가 아닙니다.`);
  }
  if (plan.closer !== null) {
    const c = byId.get(plan.closer);
    if (!c || !c.isPitcher) out.push('마무리는 1군 투수여야 합니다.');
    else if (plan.rotation.includes(plan.closer)) out.push('선발 로테이션 투수는 마무리를 맡을 수 없습니다.');
  }
  return out;
}

/**
 * 1군에서 빠진 선수가 계획에 있으면 그 자리만 감독 추천 규칙으로 채운다(D-120). 남은 선수의 순서·위치는 유지한다.
 * 고친 내용을 문장으로 돌려준다.
 */
export function repairPlan(plan: GamePlan, activePlayers: PlayerTruth[], rotationSize: number): { plan: GamePlan; changes: string[] } {
  const byId = new Map(activePlayers.map((p) => [p.id, p]));
  const changes: string[] = [];
  const hitters = activePlayers.filter((p) => !p.isPitcher);
  const used = new Set(plan.lineup.filter((s) => byId.get(s.playerId) && !byId.get(s.playerId)!.isPitcher).map((s) => s.playerId));
  const lineup = plan.lineup.map((s) => {
    const p = byId.get(s.playerId);
    if (p && !p.isPitcher) return s;
    const pos = s.position;
    const pool = hitters.filter((h) => !used.has(h.id));
    const natural = pos === 'DH' ? pool : pool.filter((h) => h.position === pos);
    const value = (h: PlayerTruth) => (pos === 'DH' ? offense(h) : offense(h) * 0.6 + fieldingAt(h, pos) * 0.4 * (POSITION_WEIGHT[pos] ?? 1));
    const pick = [...(natural.length ? natural : pool)].sort((a, b) => value(b) - value(a) || a.id - b.id)[0];
    if (!pick) return s;
    used.add(pick.id);
    changes.push(`타순 ${pos}: ${pick.name}`);
    return { playerId: pick.id, position: pos };
  });
  const pitchers = activePlayers.filter((p) => p.isPitcher);
  const keep = plan.rotation.filter((id) => byId.get(id)?.isPitcher);
  const rotation = [...keep];
  for (const p of rotationOrder(pitchers.filter((x) => !keep.includes(x.id) && x.id !== plan.closer), rotationSize)) {
    if (rotation.length >= rotationSize) break;
    rotation.push(p.id);
    changes.push(`선발 로테이션: ${p.name}`);
  }
  let closer = plan.closer;
  if (closer !== null && (!byId.get(closer)?.isPitcher || rotation.includes(closer))) {
    closer = null;
    changes.push('마무리: 감독 판단');
  }
  return { plan: { lineup, rotation, closer }, changes };
}

/** 수동 계획으로 경기 준비: 계획 타순·위치, 로테이션 순번, 지정 마무리(쉬어야 하면 등판 없음). */
function preparePlanned(clubId: ClubId, activePlayers: PlayerTruth[], usage: PitcherUsage[], lastStarterId: PlayerId | null, plan: GamePlan): TeamSetup {
  const byId = new Map(activePlayers.map((p) => [p.id, p]));
  const lineup: LineupSpot[] = plan.lineup.map((s) => ({ player: byId.get(s.playerId)!, position: s.position }));
  const rotation = plan.rotation.map((id) => byId.get(id)!);
  const restDays = (p: PlayerTruth) => {
    const last = usage.filter((u) => u.pitcherId === p.id).sort((a, b) => a.daysAgo - b.daysAgo)[0];
    return last ? last.daysAgo : 99;
  };
  const lastIndex = rotation.findIndex((p) => p.id === lastStarterId);
  const next = rotation[(lastIndex + 1) % rotation.length]!;
  const starter = restDays(next) > SIM.starterRestDays ? next : [...rotation].sort((a, b) => restDays(b) - restDays(a) || a.id - b.id)[0]!;
  const closerP = plan.closer !== null ? byId.get(plan.closer)! : null;
  const closer = closerP && closerP.id !== starter.id && bullpenAvailable(closerP, usage) ? closerP : null;
  const bullpen = activePlayers
    .filter((p) => p.isPitcher && !plan.rotation.includes(p.id) && p.id !== plan.closer && bullpenAvailable(p, usage))
    .sort((a, b) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id);
  const catcher = lineup.find((s) => s.position === 'C')?.player;
  return { clubId, lineup, starter, bullpen, closer, defense: { framing: catcher?.catcher?.framing ?? 30 } };
}

/**
 * 경기 준비. 사용자 수동 계획이 있고 오늘 1군과 맞으면 그 계획을, 아니면 감독 자동 운영을 쓴다.
 * 계획이 어긋나는 경우는 명단 변경 때 repairPlan으로 미리 고치므로 여기서는 안전장치로만 자동 운영에 넘긴다.
 */
export function prepareTeam(clubId: ClubId, activePlayers: PlayerTruth[], usage: PitcherUsage[], lastStarterId: PlayerId | null, plan: GamePlan | null = null, rotationSize = 5): TeamSetup {
  if (plan && planProblems(plan, activePlayers, rotationSize).length === 0) return preparePlanned(clubId, activePlayers, usage, lastStarterId, plan);
  const hitters = activePlayers.filter((p) => !p.isPitcher);
  const pitchers = activePlayers.filter((p) => p.isPitcher);
  const starters = pitchers.filter((p) => p.position === 'SP');
  const starter = pickStarter(starters.length > 0 ? starters : pitchers, usage, lastStarterId);
  const relievers = pitchers
    .filter((p) => p.id !== starter.id && p.position === 'RP')
    .sort((a, b) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id);
  const closer = relievers[0] && bullpenAvailable(relievers[0], usage) ? relievers[0] : null;
  const bullpen = relievers.filter((p) => p !== relievers[0] && bullpenAvailable(p, usage));
  const { lineup, defense } = buildLineup(hitters);
  return { clubId, lineup, starter, bullpen, closer, defense };
}
