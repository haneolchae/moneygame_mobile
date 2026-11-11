// 8e 올스타전(D-189·D-190·25 문서): 팬 투표·감독 추천·대체, 홈런 레이스, 올스타전, 결과 편지, 투표 캠페인·유치 신청.
// 올스타 결과는 올스타 표에만 저장하고 경기·타석 표, 순위, 정규 기록에는 넣지 않는다.
import { allStarDates, allStarDayKind, ALLSTAR_TEAMS, BEST_SLOTS, boxLines, hrRace, isPitcherSlot, mvpNoise, mvpPoints, rotationHost, SLOT_LABEL, SLOT_SIZE, TEAM_LABEL, teamOfClub, voteNoise, type AllStarLine, type AllStarTeam, type BestSlot } from '../engine/allStar';
import { hitterPoints, isStarter, pitcherPoints, type PitLine } from '../engine/awards';
import { startSatisfaction } from '../engine/business';
import { addDays, diffDays, type GameDate } from '../engine/calendar';
import { ALLSTAR as AS, ATTENDANCE } from '../engine/config';
import { inflate, type LedgerEntry } from '../engine/finance';
import { simulateGame, type LineupSpot, type TeamSetup } from '../engine/gamesim';
import { injuredOn } from '../engine/health';
import type { ManagerProfile } from '../engine/manager';
import { EOK } from '../engine/money';
import { NEUTRAL_ENVIRONMENT, type LeagueEnvironment } from '../engine/probability';
import { Rng } from '../engine/rng';
import type { BattingTotals } from '../engine/stats';
import type { ClubId, ClubProfile, PlayerId, PlayerTruth, Position } from '../engine/types';
import { pitcherOverall } from '../engine/worldgen';
import { GameError } from '../shared/protocol';
import type { BudgetGuard } from './budget';
import type { AllStarBallotRow, AllStarPick, AllStarSeason, GameMeta, GameRepository, InboxMessage } from './ports';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);
const md = (d: GameDate) => d.slice(5).replace('-', '/');
const OF = new Set(['LF', 'CF', 'RF']);
type RecKind = 'SP' | 'RP' | 'F';
const recKind = (slot: string): RecKind => (slot === 'SP' ? 'SP' : isPitcherSlot(slot) ? 'RP' : 'F');

/** 투표 후보 한 명(자격자만) */
export interface AllStarCandidate {
  player: PlayerTruth;
  team: AllStarTeam;
  slot: BestSlot;
  perf: number;
  votes: number;
  homeRuns: number;
}

type FormsFor = (season: number, date: GameDate, players: PlayerTruth[], env: LeagueEnvironment) => NonNullable<Parameters<typeof simulateGame>[6]>['forms'];

export class AllStarOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly managerOf: (clubId: ClubId) => ManagerProfile,
    private readonly formsFor: FormsFor,
    private readonly budget: BudgetGuard,
  ) {}

  private inflation(meta: GameMeta, season = meta.season): number {
    return inflate(EOK, season, meta.inflationBp) / EOK;
  }

  // ───────── 후보·투표 ─────────

  /** 팬 기반(0~1): 시장 규모 ÷ 최대 시장 × 0.5 + 팬 만족도 ÷ 100 × 0.5 */
  private fanBase(meta: GameMeta, clubId: ClubId): number {
    const maxMarket = Math.max(...[...this.clubs.values()].map((c) => c.marketSize));
    const c = this.clubs.get(clubId)!;
    const sat = meta.fans?.[String(clubId)]?.satisfaction ?? startSatisfaction(c.loyalty);
    return (c.marketSize / maxMarket) * 0.5 + (sat / 100) * 0.5;
  }

  /** 자격자 후보와 득표(그날까지 기록). 같은 시드·같은 기록이면 같은 값 */
  candidates(meta: GameMeta, season: number, upTo: GameDate): AllStarCandidate[] {
    const d = allStarDates(season);
    const { batting, pitching } = this.repo.awardLines(season, { from: d.opening, to: upTo });
    const games = new Map<ClubId, number>();
    for (const g of this.repo.getGames(season, 'regular')) {
      if (g.date > upTo) continue;
      games.set(g.home, (games.get(g.home) ?? 0) + 1);
      games.set(g.away, (games.get(g.away) ?? 0) + 1);
    }
    const outs = new Map<PlayerId, Map<string, number>>();
    for (const r of this.repo.positionOuts(season)) {
      if (r.position === 'P') continue;
      const m = outs.get(r.playerId) ?? new Map<string, number>();
      const pos = OF.has(r.position) ? 'OF' : r.position;
      m.set(pos, (m.get(pos) ?? 0) + r.outs);
      outs.set(r.playerId, m);
    }
    const campaignDate = meta.allStarCampaign?.[String(season)];
    const campaign = campaignDate && campaignDate <= upTo ? meta.userClubId : null;
    const base: Array<{ player: PlayerTruth; team: AllStarTeam; slot: BestSlot }> = [];
    for (const p of this.repo.getPlayers()) {
      if (p.clubId === null || !this.clubs.has(p.clubId)) continue;
      const team = teamOfClub(p.clubId);
      if (p.isPitcher) {
        const pl = pitching.get(p.id);
        if (!pl) continue;
        const slot: BestSlot = isStarter(pl) ? 'SP' : pl.SV >= 1 && pl.SV >= pl.HLD ? 'CL' : 'MRP';
        if (slot === 'SP' ? pl.GS < AS.minStarts : pl.G < AS.minRelief) continue;
        base.push({ player: p, team, slot });
      } else {
        const b = batting.get(p.id);
        if (!b || b.G < (games.get(p.clubId) ?? 0) * AS.fielderGameShare || b.G === 0) continue;
        const m = outs.get(p.id);
        const slot = (m && m.size ? [...m.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]))[0]![0] : 'DH') as BestSlot;
        base.push({ player: p, team, slot: BEST_SLOTS.includes(slot) ? slot : 'DH' });
      }
    }
    // 성적 점수: 같은 팀·같은 자리 후보 안에서 부문 순위 점수 합 ÷ 만점
    const perf = new Map<PlayerId, number>();
    for (const team of ALLSTAR_TEAMS) {
      for (const slot of BEST_SLOTS) {
        const group = base.filter((c) => c.team === team && c.slot === slot);
        if (!group.length) continue;
        if (isPitcherSlot(slot)) {
          const lines = new Map<number, PitLine>(group.map((c) => [c.player.id, pitching.get(c.player.id)!]));
          const pts = pitcherPoints(lines, () => true, () => true);
          for (const c of group) perf.set(c.player.id, slot === 'SP' ? (pts.starter.get(c.player.id) ?? 0) / 60 : (pts.reliever.get(c.player.id) ?? 0) / 50);
        } else {
          const lines = new Map<number, BattingTotals>(group.map((c) => [c.player.id, batting.get(c.player.id)!]));
          const pts = hitterPoints(lines, () => true);
          for (const c of group) perf.set(c.player.id, (pts.get(c.player.id) ?? 0) / 90);
        }
      }
    }
    return base.map((c) => {
      const pf = perf.get(c.player.id) ?? 0;
      const score = pf * AS.perfWeight + this.fanBase(meta, c.player.clubId!) * AS.fanWeight + voteNoise(meta.seed, season, c.player.id) + (campaign === c.player.clubId ? AS.campaignBonus : 0);
      return { ...c, perf: Math.round(pf * 1000) / 1000, votes: Math.max(0, Math.round(score * AS.voteScale)), homeRuns: batting.get(c.player.id)?.HR ?? 0 };
    });
  }

  /** 자리별 득표 순(동률은 선수 번호) */
  private ranked(cands: AllStarCandidate[], team: AllStarTeam, slot: string): AllStarCandidate[] {
    return cands.filter((c) => c.team === team && c.slot === slot).sort((a, b) => b.votes - a.votes || a.player.id - b.player.id);
  }

  private ballotRows(cands: AllStarCandidate[], top?: (slot: string) => number): AllStarBallotRow[] {
    const rows: AllStarBallotRow[] = [];
    for (const team of ALLSTAR_TEAMS) for (const slot of BEST_SLOTS) for (const c of this.ranked(cands, team, slot).slice(0, top ? top(slot) : undefined)) rows.push({ team, slot, playerId: c.player.id, clubId: c.player.clubId!, votes: c.votes, perf: c.perf });
    return rows;
  }

  /** 선정: 베스트 12(투표) → 감독 추천 12. 부상 선수는 차순위로 바꾸고 선정 이력은 남긴다 */
  select(meta: GameMeta, season: number, date: GameDate, ballot: AllStarBallotRow[]): AllStarPick[] {
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const hurt = (id: PlayerId) => injuredOn(players.get(id)?.health?.injury, date);
    const picks: AllStarPick[] = [];
    const taken = new Set<PlayerId>();
    const add = (row: AllStarBallotRow, kind: 'best' | 'rec', slot: string, extra: Partial<AllStarPick> = {}) => {
      taken.add(row.playerId);
      const pick: AllStarPick = { team: row.team, kind, slot, playerId: row.playerId, clubId: row.clubId, votes: kind === 'best' ? row.votes : null, perf: row.perf, status: 'ok', date, ...extra };
      picks.push(pick);
      return pick;
    };
    for (const team of ALLSTAR_TEAMS) {
      // 베스트 12
      for (const slot of BEST_SLOTS) {
        const list = ballot.filter((r) => r.team === team && r.slot === slot);
        for (const row of list.slice(0, SLOT_SIZE(slot))) {
          const p = add(row, 'best', slot);
          if (hurt(row.playerId)) {
            p.status = 'injured';
            const sub = list.find((r) => !taken.has(r.playerId) && !hurt(r.playerId));
            if (sub) add(sub, 'best', slot, { replaces: row.playerId });
          }
        }
      }
      // 감독 추천 12: 투수 선발 3·구원 3, 야수 6
      const room: Record<RecKind, number> = { SP: AS.recPitchers.SP, RP: AS.recPitchers.RP, F: AS.recFielders };
      const pool = ballot.filter((r) => r.team === team && !taken.has(r.playerId) && !hurt(r.playerId));
      const byPerf = (a: AllStarBallotRow, b: AllStarBallotRow) => b.perf - a.perf || a.playerId - b.playerId;
      const take = (r: AllStarBallotRow) => {
        if (taken.has(r.playerId) || room[recKind(r.slot)] <= 0) return false;
        room[recKind(r.slot)] -= 1;
        add(r, 'rec', recKind(r.slot));
        return true;
      };
      // ① 같은 팀 구단 중 아직 선정 선수가 없는 구단에서 최고 성적 1명
      const teamClubs = [...this.clubs.keys()].filter((c) => teamOfClub(c) === team).sort((a, b) => a - b);
      for (const c of teamClubs) {
        if (picks.some((p) => p.clubId === c)) continue;
        for (const r of pool.filter((x) => x.clubId === c).sort(byPerf)) if (take(r)) break;
      }
      // ② 득표가 자리 마지막 선정자의 runnerUpShare 이상인 차점자
      const runners: Array<{ r: AllStarBallotRow; ratio: number }> = [];
      for (const slot of BEST_SLOTS) {
        const list = ballot.filter((r) => r.team === team && r.slot === slot);
        const last = list[SLOT_SIZE(slot) - 1];
        const next = list[SLOT_SIZE(slot)];
        if (last && next && last.votes > 0 && next.votes >= last.votes * AS.runnerUpShare) runners.push({ r: next, ratio: next.votes / last.votes });
      }
      for (const { r } of runners.sort((a, b) => b.ratio - a.ratio || a.r.playerId - b.r.playerId)) if (!hurt(r.playerId)) take(r);
      // ③ 성적 순
      for (const r of [...pool].sort(byPerf)) take(r);
    }
    return picks;
  }

  /** 홈런 레이스 날: 부상 선수 대체(같은 자리 차순위) */
  private replaceInjured(row: AllStarSeason, date: GameDate): string[] {
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const hurt = (id: PlayerId) => injuredOn(players.get(id)?.health?.injury, date);
    const taken = new Set(row.picks.map((p) => p.playerId));
    const notes: string[] = [];
    for (const p of [...row.picks]) {
      if (p.status !== 'ok' || !hurt(p.playerId)) continue;
      p.status = 'injured';
      const cand = row.ballot.filter((r) => r.team === p.team && !taken.has(r.playerId) && !hurt(r.playerId) && (p.kind === 'best' ? r.slot === p.slot : recKind(r.slot) === p.slot));
      const sub = p.kind === 'best' ? cand[0] : [...cand].sort((a, b) => b.perf - a.perf || a.playerId - b.playerId)[0];
      const name = players.get(p.playerId)?.name ?? '';
      if (sub) {
        taken.add(sub.playerId);
        row.picks.push({ team: p.team, kind: p.kind, slot: p.slot, playerId: sub.playerId, clubId: sub.clubId, votes: p.kind === 'best' ? sub.votes : null, perf: sub.perf, status: 'ok', replaces: p.playerId, date });
        notes.push(`${name} 부상 → ${players.get(sub.playerId)?.name ?? ''} 대체`);
      } else notes.push(`${name} 부상(대체 선수 없음)`);
    }
    return notes;
  }

  // ───────── 경기 ─────────

  /** 올스타 팀 경기 준비: 베스트 12 야수가 선발, 추천 야수는 벤치, 선발 투수는 베스트 12 선발(휴식이면 추천 선발) */
  private setup(row: AllStarSeason, team: AllStarTeam, players: Map<PlayerId, PlayerTruth>): TeamSetup {
    const ok = row.picks.filter((p) => p.team === team && p.status === 'ok' && players.has(p.playerId));
    const P = (id: PlayerId) => players.get(id)!;
    const hitters = ok.filter((p) => !isPitcherSlot(p.slot) && p.slot !== 'SP');
    const pitchers = ok.filter((p) => isPitcherSlot(p.slot) || p.slot === 'SP');
    const used = new Set<PlayerId>();
    const field: Array<{ player: PlayerTruth; position: Position | 'DH' }> = [];
    const skill = (pl: PlayerTruth, pos: Position) => pl.positions[pos] ?? 0;
    const fill = (pos: Position | 'DH', from: AllStarPick[]) => {
      const pool = from.filter((p) => !used.has(p.playerId)).map((p) => P(p.playerId));
      const best = pos === 'DH' ? pool[0] : [...pool].sort((a, b) => skill(b, pos) - skill(a, pos) || a.id - b.id)[0];
      if (!best) return false;
      used.add(best.id);
      field.push({ player: best, position: pos });
      return true;
    };
    const bestOf = (slot: string) => hitters.filter((p) => p.kind === 'best' && p.slot === slot);
    for (const pos of ['C', '1B', '2B', '3B', 'SS'] as const) if (!fill(pos, bestOf(pos))) fill(pos, hitters);
    for (const pos of ['CF', 'LF', 'RF'] as const) if (!fill(pos, bestOf('OF'))) fill(pos, hitters);
    if (!fill('DH', bestOf('DH'))) fill('DH', hitters);
    const offense = (p: PlayerTruth) => 0.35 * p.batting.contact + 0.25 * p.batting.eye + 0.32 * p.batting.power + 0.08 * p.batting.speed;
    const sorted = [...field].sort((a, b) => offense(b.player) - offense(a.player) || a.player.id - b.player.id);
    const lineup: LineupSpot[] = [1, 3, 0, 2, 4, 5, 6, 7, 8].map((i) => sorted[i]!).filter(Boolean).map((s) => ({ player: s.player, position: s.position }) as LineupSpot);
    const bench = hitters.filter((p) => !used.has(p.playerId)).map((p) => P(p.playerId));
    const bestSp = pitchers.find((p) => p.kind === 'best' && p.slot === 'SP');
    const recSp = pitchers.filter((p) => p.kind === 'rec' && p.slot === 'SP').sort((a, b) => b.perf - a.perf || a.playerId - b.playerId);
    const starterPick = bestSp ?? recSp[0] ?? pitchers[0]!;
    const closerPick = pitchers.find((p) => p.kind === 'best' && p.slot === 'CL' && p.playerId !== starterPick.playerId) ?? null;
    const bullpen = pitchers.filter((p) => p.playerId !== starterPick.playerId && p.playerId !== closerPick?.playerId).map((p) => P(p.playerId)).sort((a, b) => pitcherOverall(b) - pitcherOverall(a) || a.id - b.id);
    const catcher = field.find((f) => f.position === 'C')?.player;
    return {
      clubId: AS.engineClub[team],
      lineup,
      starter: P(starterPick.playerId),
      bullpen,
      closer: closerPick ? P(closerPick.playerId) : null,
      defense: { framing: catcher?.catcher?.framing ?? 30 },
      bench,
      manager: this.managerOf(row.managers[team]),
    };
  }

  /** 올스타전 실행(정규 기록에 쓰지 않는다) */
  playGame(meta: GameMeta, row: AllStarSeason, date: GameDate): NonNullable<AllStarSeason['game']> {
    const season = row.season;
    // 선발 투수가 올스타전 전 2일 안에 정규 등판했으면 던지지 않는다
    const started = new Set(this.repo.getRecentPitcherUsage(addDays(date, -AS.starterRestDays), date).filter((u) => u.started).map((u) => u.pitcherId));
    for (const p of row.picks) if (p.status === 'ok' && started.has(p.playerId)) p.status = 'rested';
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const home = teamOfClub(row.host);
    const away: AllStarTeam = home === 'dream' ? 'nanum' : 'dream';
    const env = meta.leagueEnvironment?.[String(season)] ?? NEUTRAL_ENVIRONMENT;
    const hs = this.setup(row, home, players);
    const as = this.setup(row, away, players);
    const all = [...hs.lineup.map((s) => s.player), ...(hs.bench ?? []), hs.starter, ...hs.bullpen, ...(hs.closer ? [hs.closer] : []), ...as.lineup.map((s) => s.player), ...(as.bench ?? []), as.starter, ...as.bullpen, ...(as.closer ? [as.closer] : [])];
    const forms = this.formsFor(season, date, all, env);
    const r = simulateGame(AS.fixtureBase + season, hs, as, Rng.derive(meta.seed, 'allstar', season), AS.innings, env, { forms, allStar: { maxOuts: AS.maxOuts, regularsOutFrom: AS.regularsOutFrom } });
    const teamOf = (club: ClubId): AllStarTeam => (club === AS.engineClub.dream ? 'dream' : 'nanum');
    const lines = boxLines(r, teamOf);
    const winners: AllStarTeam[] = r.outcome === 'tie' ? ['dream', 'nanum'] : [r.outcome === 'home' ? home : away];
    const scored = lines.filter((l) => winners.includes(l.team)).map((l) => ({ id: l.playerId, v: mvpPoints(l) + mvpNoise(meta.seed, season, l.playerId) }));
    const top = Math.max(...scored.map((s) => s.v));
    const mvp = scored.filter((s) => s.v === top).map((s) => s.id).sort((a, b) => a - b);
    return {
      date,
      home,
      score: { [home]: r.homeRuns, [away]: r.awayRuns } as Record<AllStarTeam, number>,
      line: { [home]: r.lineScore.home, [away]: r.lineScore.away } as Record<AllStarTeam, number[]>,
      innings: r.innings,
      lines,
      mvp,
      mvpScore: Math.round(top * 10) / 10,
    };
  }

  // ───────── 하루 처리 ─────────

  /** 개최 구단 결정: 유치 신청 구단 중 최고점, 없으면 순환(D-190 (2)) */
  hostFor(meta: GameMeta, season: number): { host: ClubId; by: 'rotation' | 'application'; applicants: ClubId[] } {
    const rotation = rotationHost(season, this.clubs.size);
    const applicants: ClubId[] = [];
    for (const c of [...this.clubs.keys()].sort((a, b) => a - b)) {
      if (c === meta.userClubId) {
        if (meta.allStarApply?.[String(season)]) applicants.push(c);
        continue;
      }
      const stadium = meta.facilities?.[String(c)]?.levels.stadium ?? 1;
      if (stadium >= AS.aiApplyMinStadium && Rng.derive(meta.seed, 'allstar-apply', season, c).next() < AS.aiApplyChance) applicants.push(c);
    }
    if (!applicants.length) return { host: rotation, by: 'rotation', applicants };
    const maxCap = Math.max(...[...this.clubs.values()].map((c) => c.stadiumCapacity));
    const score = (c: ClubId) => {
      const club = this.clubs.get(c)!;
      const att = meta.attendance?.[String(season - 1)]?.[String(c)];
      const occ = att && att.games > 0 ? att.total / (att.games * club.stadiumCapacity) : 0;
      const stadium = meta.facilities?.[String(c)]?.levels.stadium ?? 1;
      return occ * AS.hostScore.occupancy + (stadium / 5) * AS.hostScore.stadium + (club.stadiumCapacity / maxCap) * AS.hostScore.capacity;
    };
    const dist = (c: ClubId) => (c - rotation + this.clubs.size) % this.clubs.size;
    const host = [...applicants].sort((a, b) => score(b) - score(a) || dist(a) - dist(b))[0]!;
    return { host, by: 'application', applicants };
  }

  /** 감독: 직전 시즌 한국시리즈 두 팀(같은 쪽이면 다른 쪽은 직전 시즌 순위가 가장 높은 그쪽 구단) */
  managersFor(meta: GameMeta, season: number): Record<AllStarTeam, ClubId> {
    const ps = meta.postseason?.season === season - 1 ? meta.postseason : null;
    const ks = ps?.series.find((s) => s.key === 'ks');
    const ksClubs = ks ? [ks.high, ks.low].filter((c): c is ClubId => c !== null) : [];
    const ranks = this.repo.getSeasonStandings(season - 1).sort((a, b) => a.rank - b.rank).map((s) => s.clubId);
    const order = [...ksClubs, ...ranks, ...[...this.clubs.keys()].sort((a, b) => a - b)];
    const pick = (t: AllStarTeam) => order.find((c) => teamOfClub(c) === t)!;
    return { dream: pick('dream'), nanum: pick('nanum') };
  }

  /** 하루 처리(정규시즌 모드). 받은 편지함 소식을 돌려준다 */
  onDay(meta: GameMeta, date: GameDate): InboxMessage[] {
    if (meta.mode !== 'season') return [];
    const season = meta.season;
    const kind = allStarDayKind(season, date);
    if (!kind) return [];
    const players = () => new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const name = (m: Map<PlayerId, PlayerTruth>, id: PlayerId) => m.get(id)?.name ?? `#${id}`;
    const clubName = (c: ClubId) => this.clubs.get(c)?.shortName ?? '';
    const d = allStarDates(season);
    let row = this.repo.getAllStar(season);
    if (kind === 'voteStart' || !row) {
      if (row) return [];
      const h = this.hostFor(meta, season);
      row = { season, host: h.host, hostBy: h.by, applicants: h.applicants, managers: this.managersFor(meta, season), interim: [], ballot: [], picks: [] };
      this.repo.putAllStar(row);
      if (kind !== 'voteStart') return [];
      const hostNote = h.by === 'application' ? `유치 신청(${h.applicants.map(clubName).join('·')}) 심사로 ${clubName(h.host)} 홈구장` : `순환 순서에 따라 ${clubName(h.host)} 홈구장`;
      return [{ date, kind: 'news', sender: 'KBO 소식', title: `${season} 올스타 팬 투표 시작`, body: `${season} 올스타 팬 투표가 ${md(d.voteStart)}~${md(d.close)} 진행됩니다. 드림(홀수 번호 구단)·나눔(짝수 번호 구단) 자리별 1위가 베스트 12로 뽑히고, 감독 추천 12명이 더해집니다.\n올스타전 ${md(d.game)}(토), 홈런 레이스 ${md(d.hrRace)}(금): ${hostNote}.\n감독: 드림 ${clubName(row.managers.dream)}, 나눔 ${clubName(row.managers.nanum)}.\n투표 기간에 [올스타] 화면에서 투표 캠페인(행동력 ${AS.campaignAp})을 실행할 수 있습니다.` }];
    }
    const mine = meta.userClubId;
    if (kind === 'interim') {
      if (row.interim.some((x) => x.date === date)) return [];
      const rows = this.ballotRows(this.candidates(meta, season, date), (s) => SLOT_SIZE(s) + 1);
      row.interim.push({ date, rows });
      this.repo.putAllStar(row);
      const m = players();
      const lead = (team: AllStarTeam) => BEST_SLOTS.map((s) => `${SLOT_LABEL[s]} ${rows.filter((r) => r.team === team && r.slot === s).slice(0, SLOT_SIZE(s)).map((r) => `${name(m, r.playerId)}(${clubName(r.clubId)}${r.clubId === mine ? '★' : ''})`).join('·') || '-'}`).join(', ');
      const ours = rows.filter((r) => r.clubId === mine);
      return [{ date, kind: 'news', sender: 'KBO 소식', title: `올스타 팬 투표 중간 집계(${row.interim.length}차)`, body: `드림: ${lead('dream')}\n나눔: ${lead('nanum')}\n우리 선수 상위권: ${ours.map((r) => `${name(m, r.playerId)} ${SLOT_LABEL[r.slot]} ${r.votes.toLocaleString('ko-KR')}표`).join(', ') || '없음'}` }];
    }
    if (kind === 'close') {
      if (row.picks.length) return [];
      const cands = this.candidates(meta, season, date);
      row.ballot = this.ballotRows(cands);
      row.picks = this.select(meta, season, date, row.ballot);
      const camp = meta.allStarCampaign?.[String(season)];
      if (camp) row.campaign = { date: camp, clubId: mine };
      this.repo.putAllStar(row);
      // 8e-2(D-190 (4)): 선정 인원에 비례한 팬 만족도
      const fans = { ...(meta.fans ?? {}) };
      for (const c of this.clubs.keys()) {
        const n = row.picks.filter((p) => p.clubId === c).length;
        if (!n) continue;
        const cur = fans[String(c)] ?? { satisfaction: startSatisfaction(this.clubs.get(c)!.loyalty) };
        fans[String(c)] = { ...cur, satisfaction: Math.min(100, Math.round((cur.satisfaction + Math.min(AS.satisfactionCap, n * AS.satisfactionPerPick)) * 10) / 10) };
      }
      this.repo.updateMeta({ fans });
      const m = players();
      const list = (team: AllStarTeam, k: 'best' | 'rec') => row!.picks.filter((p) => p.team === team && p.kind === k).map((p) => `${p.status === 'injured' ? '(부상)' : ''}${name(m, p.playerId)}(${clubName(p.clubId)}·${SLOT_LABEL[p.slot]}${p.votes !== null ? ` ${p.votes.toLocaleString('ko-KR')}표` : ''})`).join(', ');
      const ours = row.picks.filter((p) => p.clubId === mine);
      return [{
        date,
        kind: 'report',
        sender: '홍보팀',
        title: `${season} 올스타 명단 발표 — 우리 선수 ${ours.length}명`,
        body: `${ALLSTAR_TEAMS.map((t) => `[${TEAM_LABEL[t]} 베스트 12] ${list(t, 'best')}\n[${TEAM_LABEL[t]} 감독 추천] ${list(t, 'rec')}`).join('\n')}\n우리 선수: ${ours.map((p) => `${name(m, p.playerId)}(${p.kind === 'best' ? '베스트 12' : '감독 추천'})`).join(', ') || '없음'}${ours.length ? `\n선정 소식으로 팬 만족도가 ${Math.min(AS.satisfactionCap, ours.length * AS.satisfactionPerPick)} 올랐습니다.` : ''}`,
      }];
    }
    if (kind === 'hrRace') {
      if (row.hrRace || !row.picks.length) return [];
      const notes = this.replaceInjured(row, date);
      const m = players();
      const { batting } = this.repo.awardLines(season, { from: d.opening, to: date });
      const hr = (id: PlayerId) => batting.get(id)?.HR ?? 0;
      const entrants = (team: AllStarTeam) => row!.picks.filter((p) => p.team === team && p.status === 'ok' && recKind(p.slot) === 'F' && m.has(p.playerId)).sort((a, b) => hr(b.playerId) - hr(a.playerId) || a.playerId - b.playerId).slice(0, AS.hrRace.perTeam).map((p) => m.get(p.playerId)!);
      const dream = entrants('dream');
      const nanum = entrants('nanum');
      const res = hrRace(meta.seed, season, dream, nanum, hr);
      if (res) row.hrRace = { date, matches: res.matches, champion: res.champion, entrants: [...dream, ...nanum].map((p) => p.id) };
      this.repo.putAllStar(row);
      if (!res) return [];
      const champ = m.get(res.champion);
      const round = ['', '8강', '4강', '결승'];
      return [{ date, kind: 'news', sender: 'KBO 소식', title: `홈런 레이스 우승: ${champ?.name ?? ''}(${clubName(champ?.clubId ?? 0)})`, body: `${res.matches.map((x) => `${round[x.round]} ${name(m, x.a)} ${x.hrA} : ${x.hrB} ${name(m, x.b)}${x.tiebreak.length ? ` (연장 ${x.tiebreak.map((t) => t.join(':')).join(', ')})` : ''}`).join('\n')}${notes.length ? `\n부상 대체: ${notes.join(', ')}` : ''}` }];
    }
    if (kind === 'game') {
      if (row.game || !row.picks.length) return [];
      row.game = this.playGame(meta, row, date);
      this.repo.putAllStar(row);
      const g = row.game;
      const m = players();
      // 8e-2(D-190 (3)): 개최 구단 입장 수입·행사 비용·팬 만족도
      const host = this.clubs.get(row.host)!;
      const inf = this.inflation(meta, season);
      const ledger: LedgerEntry[] = [
        { clubId: row.host, date, category: 'ticketRevenue', amount: Math.round(host.stadiumCapacity * ATTENDANCE.ticketPriceWon * AS.hostTicketMultiplier * inf), memo: '올스타전 입장 수입' },
        { clubId: row.host, date, category: 'gameOps', amount: -Math.round((AS.hostCostWon * inf) / 1_000_000) * 1_000_000, memo: '올스타전 행사 비용' },
      ];
      this.repo.addLedger(ledger);
      const fresh = this.repo.getMeta();
      const cur = fresh.fans?.[String(row.host)] ?? { satisfaction: startSatisfaction(host.loyalty) };
      this.repo.updateMeta({ fans: { ...(fresh.fans ?? {}), [String(row.host)]: { ...cur, satisfaction: Math.min(100, cur.satisfaction + AS.hostSatisfaction) } } });
      const mvp = g.mvp.map((id) => `${name(m, id)}(${clubName(row!.picks.find((p) => p.playerId === id)?.clubId ?? 0)})`).join('·');
      return [{ date, kind: 'news', sender: 'KBO 소식', title: `${season} 올스타전: 드림 ${g.score.dream} : ${g.score.nanum} 나눔 — 미스터 올스타 ${mvp}`, body: `${clubName(row.host)} 홈구장에서 열린 올스타전에서 ${g.score.dream === g.score.nanum ? '무승부' : `${g.score.dream > g.score.nanum ? '드림' : '나눔'} 승리`}(${g.innings}회). 미스터 올스타 ${mvp}(점수 ${g.mvpScore}).\n올스타전 기록은 정규시즌 기록과 따로 남습니다.` }];
    }
    if (kind === 'letter') {
      const g = row.game;
      if (!g) return [];
      const m = players();
      const ours = row.picks.filter((p) => p.clubId === mine);
      const lines = g.lines.filter((l) => ours.some((p) => p.playerId === l.playerId));
      const champ = row.hrRace ? m.get(row.hrRace.champion) : null;
      return [{
        date,
        kind: 'report',
        sender: '홍보팀',
        title: `${season} 올스타전 결과 보고`,
        body: `최종 스코어 드림 ${g.score.dream} : ${g.score.nanum} 나눔. 미스터 올스타 ${g.mvp.map((id) => name(m, id)).join('·')}. 홈런 레이스 우승 ${champ?.name ?? '-'}.\n우리 선수 기록: ${lines.map((l) => `${name(m, l.playerId)} ${lineText(l)}`).join(' / ') || '출전 없음'}${row.host === mine ? `\n우리 홈구장 개최: 입장 수입과 행사 비용이 장부에 반영됐고 팬 만족도가 ${AS.hostSatisfaction} 올랐습니다.` : ''}`,
      }];
    }
    return [];
  }

  // ───────── 8e-2 구단주 행동 ─────────

  /** 투표 캠페인 가능 여부(무료 검증) */
  campaignCheck(meta: GameMeta): { costWon: number; reason: string | null } {
    const season = meta.season;
    const d = allStarDates(season);
    const costWon = Math.round((AS.campaignCostWon * this.inflation(meta)) / 1_000_000) * 1_000_000;
    if (meta.gameOver) return { costWon, reason: '종료된 게임입니다.' };
    if (meta.mode !== 'season' || diffDays(meta.currentDate, d.voteStart) < 0 || diffDays(meta.currentDate, d.close) > 0) return { costWon, reason: `투표 기간(${md(d.voteStart)}~${md(d.close)})에만 실행할 수 있습니다.` };
    if (meta.allStarCampaign?.[String(season)]) return { costWon, reason: '이번 시즌 투표 캠페인을 이미 실행했습니다.' };
    if (this.repo.cashBalance(meta.userClubId) < costWon) return { costWon, reason: `현금이 부족합니다. 캠페인 비용 ${won(costWon)}.` };
    const over = this.budget.spendError(meta, 'marketing', costWon);
    if (over) return { costWon, reason: over };
    return { costWon, reason: null };
  }

  campaign(meta: GameMeta, weekId: string): string {
    const c = this.campaignCheck(meta);
    if (c.reason) throw new GameError('INVALID', c.reason);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, AS.campaignAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(투표 캠페인 행동력 ${AS.campaignAp}).`);
      }
      const cur = this.repo.getMeta();
      this.repo.updateMeta({ allStarCampaign: { ...(cur.allStarCampaign ?? {}), [String(meta.season)]: meta.currentDate } });
      this.repo.addLedger([{ clubId: meta.userClubId, date: meta.currentDate, category: 'marketing', amount: -c.costWon, memo: '올스타 투표 캠페인' }]);
      return `올스타 투표 캠페인을 시작했습니다. 비용 ${won(c.costWon)}, 마감(${md(allStarDates(meta.season).close)})까지 우리 선수 투표 점수가 오릅니다.`;
    });
  }

  /** 유치 신청 가능 여부: 스토브리그, 다음 시즌 대상, 1회 */
  applyCheck(meta: GameMeta): { season: number; reason: string | null } {
    const season = meta.season + 1;
    if (meta.gameOver) return { season, reason: '종료된 게임입니다.' };
    if (meta.mode !== 'stove') return { season, reason: '유치 신청은 스토브리그에만 할 수 있습니다.' };
    if (meta.allStarApply?.[String(season)]) return { season, reason: `${season} 올스타전 유치를 이미 신청했습니다.` };
    return { season, reason: null };
  }

  apply(meta: GameMeta, weekId: string): string {
    const c = this.applyCheck(meta);
    if (c.reason) throw new GameError('INVALID', c.reason);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, AS.applyAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(유치 신청 행동력 ${AS.applyAp}).`);
      }
      const cur = this.repo.getMeta();
      this.repo.updateMeta({ allStarApply: { ...(cur.allStarApply ?? {}), [String(c.season)]: true } });
      return `${c.season} 올스타전 유치를 신청했습니다. 투표 시작일(${md(allStarDates(c.season).voteStart)})에 신청 구단 중 관중·구장 시설·수용 인원 점수가 가장 높은 곳으로 정해집니다.`;
    });
  }

  // ───────── 다른 기능이 읽는 값 ─────────

  /** 그 시즌 올스타 선정 선수(부상 대체 포함 선정 이력) */
  selected(season: number): Set<PlayerId> {
    return new Set(this.repo.getAllStar(season)?.picks.map((p) => p.playerId) ?? []);
  }
}

/** 기록 한 줄 문장 */
export function lineText(l: AllStarLine): string {
  const parts: string[] = [];
  if (l.PA > 0) parts.push(`${l.AB}타수 ${l.H}안타${l.HR ? ` ${l.HR}홈런` : ''}${l.RBI ? ` ${l.RBI}타점` : ''}${l.R ? ` ${l.R}득점` : ''}${l.SB ? ` ${l.SB}도루` : ''}`);
  if (l.OUTS > 0 || l.pitches > 0) parts.push(`${Math.floor(l.OUTS / 3)}${l.OUTS % 3 ? `.${l.OUTS % 3}` : ''}이닝 ${l.PR}실점 ${l.PK}탈삼진`);
  return parts.join(', ') || '출전';
}

/** 8e-2(D-190 (7)) 피로: 그 기간의 올스타 출전(홈런 레이스 타자·올스타전 타석·투구) */
export function allStarAppearances(rows: AllStarSeason[], from: GameDate, endExclusive: GameDate): { batters: Array<{ date: GameDate; batterId: PlayerId }>; pitchers: Array<{ date: GameDate; pitcherId: PlayerId; pitches: number }> } {
  const batters: Array<{ date: GameDate; batterId: PlayerId }> = [];
  const pitchers: Array<{ date: GameDate; pitcherId: PlayerId; pitches: number }> = [];
  const inRange = (d: GameDate) => d >= from && d < endExclusive;
  for (const r of rows) {
    if (r.hrRace && inRange(r.hrRace.date)) for (const id of r.hrRace.entrants) batters.push({ date: r.hrRace.date, batterId: id });
    if (r.game && inRange(r.game.date)) {
      for (const l of r.game.lines) {
        if (l.PA > 0) batters.push({ date: r.game.date, batterId: l.playerId });
        if (l.OUTS > 0 || l.pitches > 0) pitchers.push({ date: r.game.date, pitcherId: l.playerId, pitches: l.pitches });
      }
    }
  }
  return { batters, pitchers };
}
