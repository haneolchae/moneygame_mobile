// 4a 성장·노화 반영(D-123·D-124): 시즌 중 매월 1일(3~10월) 소폭, 스토브리그 시즌 마감 때 1회.
// 모든 현역 선수(구단 소속·자유계약·해외 풀)를 같은 규칙으로 바꾸고, 우리 선수 변화만 보고한다(실제 능력 공개 규칙).
import { ageOn, type GameDate } from '../engine/calendar';
import { DEVELOPMENT } from '../engine/config';
import { applyAnnual, applyMonthly, coreAverage, DEV_LABEL, VELOCITY } from '../engine/development';
import { activePlan } from '../engine/training';
import type { PlayerId, PlayerTruth } from '../engine/types';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

/** 4b-2: 집중 훈련 목표 능력인가 */
const trained = (p: PlayerTruth, k: string) => {
  const t = activePlan(p);
  return !!t && (t.primary === k || t.secondary === k);
};
const fmt = (k: string, d: number, p?: PlayerTruth) => `${DEV_LABEL[k] ?? k} ${d > 0 ? '+' : ''}${k === VELOCITY ? d.toFixed(1) : d}${p && trained(p, k) ? '(훈련)' : ''}`;

export class Growth {
  constructor(private readonly repo: GameRepository) {}

  /** 월간 반영 날짜인가: 시즌 모드, 3~10월 1일 */
  isMonthlyDay(meta: GameMeta, date: GameDate): boolean {
    return meta.mode === 'season' && date.slice(8, 10) === '01' && DEVELOPMENT.monthlyMonths.includes(Number(date.slice(5, 7)));
  }

  /** strengths: 4b-2 선수별 능력 훈련 강도(TrainingOps.strengths) */
  monthly(meta: GameMeta, date: GameDate, strengths?: (players: PlayerTruth[]) => Map<PlayerId, Record<string, number>>): InboxMessage[] {
    if (!this.isMonthlyDay(meta, date)) return [];
    const players = this.repo.getPlayers().filter((p) => !p.retired);
    const own: Array<{ p: PlayerTruth; ch: Record<string, number> }> = [];
    const train = strengths?.(players) ?? new Map<PlayerId, Record<string, number>>();
    for (const p of players) {
      const ch = applyMonthly(p, meta.seed, date, ageOn(p.birthDate, date), train.get(p.id));
      if (p.clubId === meta.userClubId && Object.keys(ch).length) own.push({ p, ch });
    }
    this.repo.savePlayers(players);
    if (own.length === 0) return [];
    const up = own.filter((x) => Object.values(x.ch).some((d) => d > 0)).length;
    const down = own.filter((x) => Object.values(x.ch).some((d) => d < 0)).length;
    const lines = own.slice(0, 15).map((x) => `· ${x.p.name}: ${Object.entries(x.ch).map(([k, d]) => fmt(k, d, x.p)).join(', ')}`);
    return [
      {
        date,
        kind: 'report',
        sender: '육성팀',
        title: `${Number(date.slice(5, 7))}월 성장 보고: 상승 ${up}명 · 하락 ${down}명`,
        body: `이번 달 능력 변화(월 최대 1점, 구속 0.3km/h)입니다.\n${lines.join('\n')}${own.length > 15 ? `\n외 ${own.length - 15}명` : ''}\n큰 변화는 스토브리그 결산 때 반영됩니다. (훈련)은 집중 훈련 목표 능력입니다.`,
      },
    ];
  }

  /** 스토브리그 연간 반영(시즌 마감 때 1회) */
  annual(meta: GameMeta, date: GameDate): InboxMessage[] {
    const players = this.repo.getPlayers().filter((p) => !p.retired);
    const own: Array<{ p: PlayerTruth; core: number; ch: Record<string, number> }> = [];
    for (const p of players) {
      const before = coreAverage(p);
      const ch = applyAnnual(p, meta.seed, meta.season, date, ageOn(p.birthDate, date));
      if (p.clubId === meta.userClubId) own.push({ p, core: coreAverage(p) - before, ch });
    }
    this.repo.savePlayers(players);
    const risers = own.filter((x) => x.core > 0).sort((a, b) => b.core - a.core).slice(0, 5);
    const fallers = own.filter((x) => x.core < 0).sort((a, b) => a.core - b.core).slice(0, 5);
    const line = (x: (typeof own)[number]) => `· ${x.p.name}(${ageOn(x.p.birthDate, date)}세): ${Object.entries(x.ch).map(([k, d]) => fmt(k, d, x.p)).join(', ')}`;
    return [
      {
        date,
        kind: 'report',
        sender: '육성팀',
        title: `${meta.season} 시즌 결산 성장·노화: 상승 ${own.filter((x) => x.core > 0).length}명 · 하락 ${own.filter((x) => x.core < 0).length}명`,
        body: `한 해 성장·노화를 반영했습니다(나이·성장 시기·자기 관리에 따라 다름).\n크게 오른 선수\n${risers.map(line).join('\n') || '· 없음'}\n크게 내린 선수\n${fallers.map(line).join('\n') || '· 없음'}\n선수 상세 [능력치]에서 지난 결산 뒤 변화를 볼 수 있습니다.`,
      },
    ];
  }
}
