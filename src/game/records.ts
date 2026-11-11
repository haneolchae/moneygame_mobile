// 선수 기간별 기록·팀 통계·구단 역사 (05·24 문서, D-079). 원시 기록(2027~)과 시작 이전 기록(~2026)을 합쳐 계산하고 화면별로 중복 계산하지 않는다.
import { NEW_GAME } from '../engine/config';
import { addBatting, addPitching, EMPTY_BATTING, EMPTY_PITCHING } from '../engine/history';
import { computeStandings } from '../engine/standings';
import { battingRates, formatInnings, pitchingRates, type BattingTotals, type PitchingTotals } from '../engine/stats';
import type { ClubId, PlayerTruth } from '../engine/types';
import type { AchievementView, ClubRef, FieldingLineView, PlayerRecordView, StatLineView, TeamHistoryRow, TeamRecordsView, TeamStatItem } from '../shared/protocol';
import { clubHistory } from '../engine/data/history';
import { ACHIEVEMENTS, QUALIFY_PA_PER_GAME } from './achievements';
import type { GameMeta, GameRepository } from './ports';

// 4c-2a(D-170 (10)): 도루·도루 실패
export const BAT_COLUMNS = ['G', 'PA', 'AB', 'H', '2B', '3B', 'HR', 'RBI', 'R', 'BB', 'SO', 'SB', 'CS', 'AVG', 'OBP', 'SLG', 'OPS'];
// 4c-1(D-165·D-167): 투구 수(NP)와 경기당 투구 수(NP/G = 총 투구 수 ÷ 등판 수)는 시즌·통산에 남긴다
export const PIT_COLUMNS = ['G', 'GS', 'W', 'L', 'SV', 'IP', 'ERA', 'WHIP', 'K', 'BB', 'HR', 'K/9', 'BB/9', 'NP', 'NP/G'];

/** ASSUMPTION(D-079): 시작 이전 기록의 규정 기준(144경기) */
const QUALIFY_PA = Math.floor(144 * QUALIFY_PA_PER_GAME);
const QUALIFY_OUTS = 144 * 3;

const f3 = (v: number | null) => (v === null ? null : v.toFixed(3).replace(/^0/, ''));
const f2 = (v: number | null) => (v === null ? null : v.toFixed(2));

export function batValues(t: BattingTotals): Record<string, number | string | null> {
  const r = battingRates(t);
  return { G: t.G, PA: t.PA, AB: t.AB, H: t.H, '2B': t['2B'], '3B': t['3B'], HR: t.HR, RBI: t.RBI, R: t.R, BB: t.BB, SO: t.SO, SB: t.SB ?? 0, CS: t.CS ?? 0, AVG: f3(r.AVG), OBP: f3(r.OBP), SLG: f3(r.SLG), OPS: f3(r.OPS) };
}

export function pitValues(t: PitchingTotals): Record<string, number | string | null> {
  const r = pitchingRates(t, null);
  return { G: t.G, GS: t.GS, W: t.W, L: t.L, SV: t.SV, IP: formatInnings(t.OUTS), ERA: f2(r.ERA), WHIP: f2(r.WHIP), K: t.K, BB: t.BB, HR: t.HR, 'K/9': f2(r['K/9']), 'BB/9': f2(r['BB/9']), NP: t.pitches, 'NP/G': t.G > 0 ? (t.pitches / t.G).toFixed(1) : null };
}

interface ClubSeason {
  bat: BattingTotals;
  pit: PitchingTotals;
  preGame: boolean;
}

export class Records {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubName: (id: ClubId) => string,
  ) {}

  /** 원시 기록이 있는 마지막 시즌(스토브리그에는 지난 시즌) */
  private seasonsPlayed(meta: GameMeta): number[] {
    const out: number[] = [];
    for (let y = NEW_GAME.firstSeason; y <= meta.season; y++) if (this.repo.countFixtures(y).played > 0) out.push(y);
    return out;
  }

  playerRecord(meta: GameMeta, p: PlayerTruth): PlayerRecordView {
    const kind = p.isPitcher ? 'pit' : 'bat';
    const hist = this.repo.getHistory({ playerIds: [p.id] }).filter((l) => l.kind === kind);
    const lines: Array<{ season: number; club: string | null; preGame: boolean; totals: BattingTotals | PitchingTotals }> = hist.map((l) => ({ season: l.season, club: this.clubName(l.clubId), preGame: true, totals: l.totals }));
    for (const y of this.seasonsPlayed(meta)) {
      const t = kind === 'bat' ? this.repo.battingTotals(y, [p.id]).get(p.id) : this.repo.pitchingTotals(y, [p.id]).get(p.id);
      if (t) lines.push({ season: y, club: p.clubId ? this.clubName(p.clubId) : null, preGame: false, totals: t });
    }
    lines.sort((a, b) => b.season - a.season);
    const values = (t: BattingTotals | PitchingTotals) => (kind === 'bat' ? batValues(t as BattingTotals) : pitValues(t as PitchingTotals));
    const toView = (l: (typeof lines)[number], label?: string): StatLineView => ({ label: label ?? `${l.season}`, season: l.season, club: l.club, preGame: l.preGame, values: values(l.totals) });
    const inSeason = meta.mode === 'season';
    const currentLine = inSeason ? lines.find((l) => l.season === meta.season) : undefined;
    const current: StatLineView | null = inSeason ? (currentLine ? toView(currentLine, `${meta.season} 현재`) : { label: `${meta.season} 현재`, season: meta.season, club: null, preGame: false, values: values(kind === 'bat' ? EMPTY_BATTING : EMPTY_PITCHING) }) : null;
    const recent = lines.filter((l) => l.season < (inSeason ? meta.season : meta.season + 1)).slice(0, 3).map((l) => toView(l));
    const total = lines.reduce<BattingTotals | PitchingTotals>((a, l) => (kind === 'bat' ? addBatting(a as BattingTotals, l.totals as BattingTotals) : addPitching(a as PitchingTotals, l.totals as PitchingTotals)), kind === 'bat' ? EMPTY_BATTING : EMPTY_PITCHING);
    const career: StatLineView | null = lines.length ? { label: `통산 (${lines.length}시즌)`, season: null, club: null, preGame: lines.some((l) => l.preGame), values: values(total) } : null;
    return { kind, columns: kind === 'bat' ? BAT_COLUMNS : PIT_COLUMNS, current, recent, career };
  }

  /** 구단별 시즌 팀 합계: 2027부터 원시 기록, 2026까지는 시작 이전 기록의 합 */
  clubSeasons(season: number): Map<ClubId, ClubSeason> {
    const out = new Map<ClubId, ClubSeason>();
    if (season >= NEW_GAME.firstSeason) {
      for (const t of this.repo.teamTotals(season)) out.set(t.clubId, { bat: t.bat, pit: t.pit, preGame: false });
      return out;
    }
    for (const l of this.repo.getHistory({ season })) {
      const c = out.get(l.clubId) ?? { bat: EMPTY_BATTING, pit: EMPTY_PITCHING, preGame: true };
      if (l.kind === 'bat') c.bat = addBatting(c.bat, l.totals as BattingTotals);
      else c.pit = addPitching(c.pit, l.totals as PitchingTotals);
      out.set(l.clubId, c);
    }
    return out;
  }

  private standing(season: number, club: ClubId) {
    // 2025 시즌까지는 실제 KBO 구단 역사(D-082)
    if (season < NEW_GAME.previousSeason) {
      const h = clubHistory(club)?.seasons.find((s) => s.year === season);
      return h ? { rank: h.rank, wins: h.wins ?? 0, losses: h.losses ?? 0, ties: h.ties, postseason: h.postseason } : null;
    }
    const stored = this.repo.getSeasonStandings(season).find((s) => s.clubId === club);
    if (stored) return { rank: stored.rank as number | null, wins: stored.wins, losses: stored.losses, ties: stored.ties, postseason: stored.postseason };
    const games = this.repo.getGames(season);
    if (!games.length) return null;
    const row = computeStandings(this.repo.getClubs().map((c) => c.id), games).find((r) => r.clubId === club)!;
    const done = this.repo.countFixtures(season);
    return { rank: row.rank as number | null, wins: row.wins, losses: row.losses, ties: row.ties, postseason: done.played < done.total ? '진행 중' : row.rank <= 5 ? '가을야구 진출' : '' };
  }

  /** 구단 기록·명예의 전당. clubId를 주면 다른 구단도 열람한다(D-083). */
  teamRecords(meta: GameMeta, ref: ClubRef, clubId: ClubId = meta.userClubId): TeamRecordsView {
    const club = clubId;
    const isUser = club === meta.userClubId;
    // 구단주 취임(첫 시즌) 이후 우리 구단이 이룬 것
    const mineSeason = (y: number) => isUser && y >= NEW_GAME.firstSeason;
    const statsSeason = meta.mode === 'season' && this.repo.countFixtures(meta.season).played > 0 ? meta.season : meta.mode === 'season' ? meta.season - 1 : meta.season;
    const all = this.clubSeasons(statsSeason);
    const mine = all.get(club);
    const rankOf = (fn: (c: ClubSeason) => number | null, higherBetter: boolean) => {
      const v = mine ? fn(mine) : null;
      if (v === null) return null;
      const vals = [...all.values()].map(fn).filter((x): x is number => x !== null);
      return 1 + vals.filter((x) => (higherBetter ? x > v : x < v)).length;
    };
    const item = (key: string, label: string, fn: (c: ClubSeason) => number | null, fmt: (v: number) => string, higherBetter = true): TeamStatItem => {
      const v = mine ? fn(mine) : null;
      return { key, label, value: v === null ? '—' : fmt(v), rank: rankOf(fn, higherBetter) };
    };
    const ip = (n: number) => String(Math.round(n));
    const batting: TeamStatItem[] = [
      item('AVG', '타율', (c) => battingRates(c.bat).AVG, (v) => f3(v)!),
      item('OBP', '출루율', (c) => battingRates(c.bat).OBP, (v) => f3(v)!),
      item('SLG', '장타율', (c) => battingRates(c.bat).SLG, (v) => f3(v)!),
      item('OPS', 'OPS', (c) => battingRates(c.bat).OPS, (v) => f3(v)!),
      item('HR', '홈런', (c) => c.bat.HR, ip),
      item('R', '득점', (c) => c.bat.R, ip),
      item('BB', '볼넷', (c) => c.bat.BB, ip),
      item('SO', '삼진', (c) => c.bat.SO, ip, false),
    ];
    const pitching: TeamStatItem[] = [
      item('ERA', '평균자책', (c) => pitchingRates(c.pit, null).ERA, (v) => v.toFixed(2), false),
      item('WHIP', 'WHIP', (c) => pitchingRates(c.pit, null).WHIP, (v) => v.toFixed(2), false),
      item('K', '탈삼진', (c) => c.pit.K, ip),
      item('BBa', '볼넷 허용', (c) => c.pit.BB, ip, false),
      item('HRa', '피홈런', (c) => c.pit.HR, ip, false),
      item('RA', '실점', (c) => c.pit.R, ip, false),
      item('SV', '세이브', (c) => c.pit.SV, ip),
    ];

    const hist = clubHistory(club);
    const seasons: number[] = [];
    for (let y = hist?.firstSeason ?? NEW_GAME.previousSeason; y <= meta.season; y++) seasons.push(y);
    const history: TeamHistoryRow[] = [];
    for (const y of seasons.reverse()) {
      const st = this.standing(y, club);
      const cs = y >= NEW_GAME.previousSeason ? this.clubSeasons(y).get(club) : undefined;
      if (!st && !cs) continue;
      const source: TeamHistoryRow['source'] = y < NEW_GAME.previousSeason ? 'real' : y === NEW_GAME.previousSeason ? 'start' : 'game';
      history.push({
        season: y,
        rank: st?.rank ?? null,
        wins: st?.wins ?? 0,
        losses: st?.losses ?? 0,
        ties: st?.ties ?? 0,
        postseason: st?.postseason ?? '',
        preGame: cs?.preGame ?? false,
        source,
        mine: mineSeason(y) && (st?.postseason ?? '') !== '진행 중',
        // 8a: 그 시즌 리그 수상 수(월간 시상 제외)
        awards: this.repo.getAwards({ season: y, clubId: club }).filter((a) => !a.award.startsWith('monthly_')).length,
        AVG: cs ? (f3(battingRates(cs.bat).AVG) ?? '—') : '—',
        OPS: cs ? (f3(battingRates(cs.bat).OPS) ?? '—') : '—',
        HR: cs ? cs.bat.HR : null,
        runs: cs ? cs.bat.R : null,
        ERA: cs ? (f2(pitchingRates(cs.pit, null).ERA) ?? '—') : '—',
        runsAllowed: cs ? cs.pit.R : null,
      });
    }
    const titles = { ks: history.filter((h) => h.postseason === '한국시리즈 우승').map((h) => h.season).sort((a, b) => a - b), regularFirst: [...(hist?.regularSeasonFirst ?? []), ...history.filter((h) => h.source !== 'real' && h.rank === 1 && h.postseason !== '진행 중').map((h) => h.season)].sort((a, b) => a - b) };

    // 구단 단일 시즌 기록: 우리 구단 소속으로 남긴 기록만
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const batLines: Array<{ id: number; season: number; t: BattingTotals; preGame: boolean }> = [];
    const pitLines: Array<{ id: number; season: number; t: PitchingTotals; preGame: boolean }> = [];
    for (const l of this.repo.getHistory({})) {
      if (l.clubId !== club) continue;
      if (l.kind === 'bat') batLines.push({ id: l.playerId, season: l.season, t: l.totals as BattingTotals, preGame: true });
      else pitLines.push({ id: l.playerId, season: l.season, t: l.totals as PitchingTotals, preGame: true });
    }
    for (const y of this.seasonsPlayed(meta)) {
      for (const [id, t] of this.repo.battingTotals(y, undefined, club)) batLines.push({ id, season: y, t, preGame: false });
      for (const [id, t] of this.repo.pitchingTotals(y, undefined, club)) pitLines.push({ id, season: y, t, preGame: false });
    }
    const name = (id: number) => players.get(id)?.name ?? `#${id}`;
    type RecordRow = TeamRecordsView['records'][number];
    type Candidate = { row: RecordRow; num: number };
    const best = <T>(list: Array<{ id: number; season: number; preGame: boolean; t: T }>, fn: (t: T) => number | null, fmt: (v: number) => string, higherBetter: boolean, label: string): Candidate | null => {
      const scored = list.map((l) => ({ l, v: fn(l.t) })).filter((x): x is { l: (typeof list)[number]; v: number } => x.v !== null);
      scored.sort((x, y) => (higherBetter ? y.v - x.v : x.v - y.v) || x.l.season - y.l.season);
      const top = scored[0];
      return top ? { num: top.v, row: { label, holder: name(top.l.id), value: fmt(top.v), season: top.l.season, preGame: top.l.preGame, source: top.l.preGame ? 'start' : 'game', mine: !top.l.preGame && mineSeason(top.l.season) } } : null;
    };
    // 실제 구단 기록(2025까지, D-082)과 게임 안 기록 중 더 좋은 쪽을 구단 기록으로 둔다.
    const record = (c: Candidate | null, label: string, higherBetter: boolean): RecordRow | null => {
      const real = hist?.records.find((x) => x.label === label && x.value !== null && x.year !== null);
      const realNum = real ? parseFloat(String(real.value)) : NaN;
      if (real && !Number.isNaN(realNum) && (!c || (higherBetter ? realNum >= c.num : realNum <= c.num))) {
        return { label, holder: real.holder, value: String(real.value), season: real.year!, preGame: false, source: 'real', mine: false };
      }
      return c?.row ?? null;
    };
    const spec: Array<[string, Candidate | null, boolean]> = [
      ['최다 홈런', best(batLines, (t) => t.HR, (v) => `${v}개`, true, '최다 홈런'), true],
      ['최다 타점', best(batLines, (t) => t.RBI, (v) => `${v}점`, true, '최다 타점'), true],
      ['최다 안타', best(batLines, (t) => t.H, (v) => `${v}개`, true, '최다 안타'), true],
      ['최고 타율(규정 타석)', best(batLines, (t) => (t.PA >= QUALIFY_PA ? battingRates(t).AVG : null), (v) => f3(v)!, true, '최고 타율(규정 타석)'), true],
      ['최다승', best(pitLines, (t) => t.W, (v) => `${v}승`, true, '최다승'), true],
      ['최다 세이브', best(pitLines, (t) => t.SV, (v) => `${v}개`, true, '최다 세이브'), true],
      ['최다 탈삼진', best(pitLines, (t) => t.K, (v) => `${v}개`, true, '최다 탈삼진'), true],
      ['최저 평균자책(규정 이닝)', best(pitLines, (t) => (t.OUTS >= QUALIFY_OUTS ? pitchingRates(t, null).ERA : null), (v) => v.toFixed(2), false, '최저 평균자책(규정 이닝)'), false],
    ];
    const records = spec.map(([label, c, hb]) => record(c, label, hb)).filter((x): x is RecordRow => x !== null);
    const legends = (hist?.legends ?? []).map((l) => ({
      name: l.name,
      position: l.position,
      isPitcher: l.isPitcher,
      years: l.firstYear && l.lastYear ? `${l.firstYear}~${l.lastYear}` : '',
      retiredNumber: l.retiredNumber,
      career: Object.fromEntries(Object.entries(l.career).map(([k, v]) => [k, v === null || v === undefined ? '—' : k === 'AVG' && typeof v === 'number' ? v.toFixed(3).replace(/^0/, '') : String(v)])),
    }));

    const timeline: TeamRecordsView['timeline'] = [];
    if (hist?.firstSeason) timeline.push({ year: hist.firstSeason, label: '창단(첫 시즌)', mine: false });
    const firsts = new Set(titles.regularFirst);
    for (const h of [...history].reverse()) {
      if (h.postseason === '한국시리즈 우승') timeline.push({ year: h.season, label: '한국시리즈 우승', mine: h.mine });
      else if (h.postseason === '한국시리즈 준우승') timeline.push({ year: h.season, label: '한국시리즈 준우승', mine: h.mine });
      if (firsts.has(h.season)) timeline.push({ year: h.season, label: '정규시즌 1위', mine: h.mine });
    }
    const fieldingMap = statsSeason > NEW_GAME.previousSeason ? this.repo.fieldingByClub(statsSeason, club) : new Map<number, { PO: number; A: number; E: number }>();
    const playerById = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const fielding = [...fieldingMap]
      .map(([id, t]) => ({ ...fieldingLine(statsSeason, t), playerId: id, name: playerById.get(id)?.name ?? `#${id}`, position: playerById.get(id)?.position ?? '' }))
      .filter((l) => l.TC > 0)
      .sort((a, b) => b.TC - a.TC || a.playerId - b.playerId);
    const got = isUser ? this.repo.getAchievements() : [];
    const known = new Set(ACHIEVEMENTS.map((a) => a.key));
    const achievements: AchievementView[] = [
      ...ACHIEVEMENTS.map((a) => ({ ...a, achieved: got.filter((g) => g.key === a.key).map((g) => ({ season: g.season, date: g.date, detail: g.detail, xp: g.xp })) })),
      // 이전 개발 빌드의 업적 키(D-182 (6)): 정의가 없어도 달성 기록은 보인다
      ...[...new Set(got.filter((g) => !known.has(g.key)).map((g) => g.key))].map((key) => ({ key, series: 'legacy', seriesTitle: key, stage: 1, stageLabel: '', type: 'legacy' as const, title: key, category: '이전 업적', description: '이전 개발 빌드에서 달성한 업적', xp: 0, repeat: false, achieved: got.filter((g) => g.key === key).map((g) => ({ season: g.season, date: g.date, detail: g.detail, xp: g.xp })) })),
    ];
    return {
      club: ref,
      statsSeason,
      statsLabel: statsSeason <= NEW_GAME.previousSeason ? `${statsSeason} 시즌 (시작 이전 기록)` : meta.mode === 'season' && statsSeason === meta.season && this.repo.countFixtures(statsSeason).played < this.repo.countFixtures(statsSeason).total ? `${statsSeason} 시즌 진행 중` : `${statsSeason} 시즌`,
      batting,
      pitching,
      fielding,
      history,
      records,
      founded: hist?.firstSeason ?? null,
      timeline,
      isUserClub: isUser,
      titles,
      legends,
      achievements,
      owner: { level: meta.ownerLevel, xp: meta.ownerXp, xpToNext: 0 },
    };
  }
}

/** 수비 기록 한 줄(05 문서): 기회 = 자살 + 보살 + 실책, 수비율 = (자살 + 보살) / 기회. 기회 0이면 수비율 없음 */
export function fieldingLine(season: number, t: { PO: number; A: number; E: number }): FieldingLineView {
  const TC = t.PO + t.A + t.E;
  return { season, PO: t.PO, A: t.A, E: t.E, TC, FPCT: TC > 0 ? (t.PO + t.A) / TC : null };
}
