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

export function prepareTeam(clubId: ClubId, activePlayers: PlayerTruth[], usage: PitcherUsage[], lastStarterId: PlayerId | null): TeamSetup {
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
