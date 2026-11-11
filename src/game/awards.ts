// 8a 리그 시상(D-180·25 문서): 원시 기록으로 점수를 매기고 수상 표에 남긴다. 전 구단 대상, 업적·경험치는 8c에서 우리 구단 수상만.
import { addDays, weekday, type GameDate } from '../engine/calendar';
import { avg, awardTitle, crossed, era, hitterPoints, isStarter, leaders, obp, ops, pitcherPoints, POS_LABEL, rankPoints, slg, sumMaps, voteNoise, whip, type PitLine } from '../engine/awards';
import { AWARDS as A } from '../engine/config';
import type { BattingTotals, PitchingTotals } from '../engine/stats';
import type { ClubId, ClubProfile, PlayerTruth } from '../engine/types';
import type { AwardRecord, GameMeta, GameRepository, InboxMessage } from './ports';

const FIELD_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
const OF = new Set(['LF', 'CF', 'RF']);
const r1 = (n: number) => Math.round(n * 10) / 10;
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3).replace(/^0/, '') : '-');
const ip = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? `.${outs % 3}` : ''}`;
const emptyBat = (): BattingTotals => ({ G: 0, PA: 0, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, BB: 0, HBP: 0, SO: 0, SF: 0, SB: 0, CS: 0 });
const emptyPit = (): PitchingTotals => ({ G: 0, GS: 0, OUTS: 0, W: 0, L: 0, SV: 0, BF: 0, H: 0, R: 0, ER: 0, BB: 0, HBP: 0, K: 0, HR: 0, pitches: 0 });
const addBat = (a: BattingTotals, b: BattingTotals) => { for (const k of Object.keys(a) as Array<keyof BattingTotals>) (a[k] as number) = (a[k] ?? 0) + (b[k] ?? 0); };
const addPit = (a: PitchingTotals, b: PitchingTotals) => { for (const k of Object.keys(a) as Array<keyof PitchingTotals>) a[k] += b[k] ?? 0; };

/** 12월 둘째 월요일(골든글러브 시상식) */
export function goldenGloveDate(year: number): GameDate {
  let d = `${year}-12-01`;
  while (weekday(d) !== 1) d = addDays(d, 1);
  return addDays(d, 7);
}

interface SeasonData {
  season: number;
  teamGames: number;
  bat: Map<number, BattingTotals>;
  pit: Map<number, PitLine>;
  players: Map<number, PlayerTruth>;
  clubOf: (id: number) => ClubId;
  qualBat: (id: number) => boolean;
  qualPit: (id: number) => boolean;
}

export class AwardOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    /** 개막 때 기대 순위(시즌 목표와 같은 식) */
    private readonly expectedRank: (meta: GameMeta, clubId: ClubId, season: number) => number,
  ) {}

  private data(meta: GameMeta, season: number, range?: { from: GameDate; to: GameDate }): SeasonData {
    const { batting, pitching } = this.repo.awardLines(season, range);
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const posClub = new Map<number, ClubId>();
    for (const r of this.repo.positionOuts(season)) posClub.set(r.playerId, r.clubId);
    const teamGames = Math.round(this.repo.getGames(season, 'regular').length * 2 / Math.max(1, this.clubs.size));
    return {
      season,
      teamGames,
      bat: batting,
      pit: pitching,
      players,
      clubOf: (id) => players.get(id)?.clubId ?? posClub.get(id) ?? 0,
      qualBat: (id) => (batting.get(id)?.PA ?? 0) >= teamGames * A.qualPaPerGame,
      qualPit: (id) => (pitching.get(id)?.OUTS ?? 0) >= teamGames * A.qualOutsPerGame,
    };
  }

  private rec(meta: GameMeta, d: SeasonData, award: string, slot: string, playerId: number, date: GameDate, score: number, detail: string): AwardRecord {
    return { season: d.season, award, slot, playerId, clubId: d.clubOf(playerId), staffId: null, date, score: r1(score), detail };
  }

  private batDetail(b: BattingTotals | undefined) {
    return b ? `타율 ${f3(avg(b))} · ${b.HR}홈런 · ${b.RBI}타점 · OPS ${f3(ops(b))} · ${b.PA}타석` : '';
  }
  private pitDetail(p: PitLine | undefined) {
    return p ? `${p.W}승 ${p.L}패 ${p.SV}세이브 ${p.HLD}홀드 · 평균자책 ${era(p).toFixed(2)} · ${ip(p.OUTS)}이닝 · ${p.K}탈삼진` : '';
  }

  /** 시즌 시작까지의 통산(생성 기록 + 지난 원시 기록 시즌) */
  private careerCache: { season: number; v: { bat: Map<number, BattingTotals>; pit: Map<number, PitchingTotals> } } | null = null;
  private careerBefore(season: number): { bat: Map<number, BattingTotals>; pit: Map<number, PitchingTotals> } {
    // 시즌 시작 전 통산은 시즌 중 바뀌지 않는다: 시즌마다 한 번만 만든다(월간 시상이 매달 부른다)
    if (this.careerCache?.season === season) return this.careerCache.v;
    const bat = new Map<number, BattingTotals>();
    const pit = new Map<number, PitchingTotals>();
    const history = this.repo.getHistory({});
    for (const h of history) {
      if (h.season >= season) continue;
      if (h.kind === 'bat') addBat(bat.get(h.playerId) ?? (bat.set(h.playerId, emptyBat()), bat.get(h.playerId)!), h.totals as BattingTotals);
      else addPit(pit.get(h.playerId) ?? (pit.set(h.playerId, emptyPit()), pit.get(h.playerId)!), h.totals as PitchingTotals);
    }
    const first = history.reduce((m, h) => Math.max(m, h.season), 0) + 1;
    for (let y = first; y < season; y++) {
      for (const [id, b] of this.repo.battingTotals(y)) addBat(bat.get(id) ?? (bat.set(id, emptyBat()), bat.get(id)!), b);
      for (const [id, p] of this.repo.pitchingTotals(y)) addPit(pit.get(id) ?? (pit.set(id, emptyPit()), pit.get(id)!), p);
    }
    this.careerCache = { season, v: { bat, pit } };
    return { bat, pit };
  }

  /** 직전 시즌 기록(생성 기록 또는 원시 기록 시즌)과 그때 소속 구단 */
  private previous(season: number): { bat: Map<number, BattingTotals>; pit: Map<number, PitchingTotals>; clubs: Map<number, Set<ClubId>> } {
    const prev = season - 1;
    const hist = this.repo.getHistory({ season: prev });
    const clubs = new Map<number, Set<ClubId>>();
    const addClub = (id: number, c: ClubId) => clubs.set(id, new Set([...(clubs.get(id) ?? []), c]));
    if (hist.length > 0) {
      const bat = new Map<number, BattingTotals>();
      const pit = new Map<number, PitchingTotals>();
      for (const h of hist) {
        addClub(h.playerId, h.clubId);
        if (h.kind === 'bat') addBat(bat.get(h.playerId) ?? (bat.set(h.playerId, emptyBat()), bat.get(h.playerId)!), h.totals as BattingTotals);
        else addPit(pit.get(h.playerId) ?? (pit.set(h.playerId, emptyPit()), pit.get(h.playerId)!), h.totals as PitchingTotals);
      }
      return { bat, pit, clubs };
    }
    for (const c of this.clubs.keys()) {
      for (const id of this.repo.battingTotals(prev, undefined, c).keys()) addClub(id, c);
      for (const id of this.repo.pitchingTotals(prev, undefined, c).keys()) addClub(id, c);
    }
    return { bat: this.repo.battingTotals(prev), pit: this.repo.pitchingTotals(prev), clubs };
  }

  // ───────── 공통 점수 ─────────

  private scores(d: SeasonData) {
    const hit = hitterPoints(d.bat, d.qualBat);
    const relQual = (id: number) => (d.pit.get(id)?.G ?? 0) >= A.relieverRateGames;
    const { starter, reliever } = pitcherPoints(d.pit, d.qualPit, relQual);
    return { hit, starter, reliever };
  }

  /** 타이틀 홀더 14부문: 부문 1위(공동 포함). 비율 부문은 규정, 승률은 10승 이상 */
  private titles(d: SeasonData): Array<{ award: string; ids: number[]; value: (id: number) => string }> {
    const b = (f: (x: BattingTotals) => number, rate = false) => new Map([...d.bat].filter(([id]) => !rate || d.qualBat(id)).map(([id, x]) => [id, f(x)]));
    const p = (f: (x: PitLine) => number, q?: (id: number, x: PitLine) => boolean) => new Map([...d.pit].filter(([id, x]) => !q || q(id, x)).map(([id, x]) => [id, f(x)]));
    const nz = (m: Map<number, number>) => new Map([...m].filter(([, v]) => v > 0));
    const list: Array<{ award: string; m: Map<number, number>; high: boolean; fmt: (v: number) => string }> = [
      { award: 'title_AVG', m: b(avg, true), high: true, fmt: f3 },
      { award: 'title_HR', m: nz(b((x) => x.HR)), high: true, fmt: (v) => `${v}홈런` },
      { award: 'title_RBI', m: nz(b((x) => x.RBI)), high: true, fmt: (v) => `${v}타점` },
      { award: 'title_R', m: nz(b((x) => x.R)), high: true, fmt: (v) => `${v}득점` },
      { award: 'title_H', m: nz(b((x) => x.H)), high: true, fmt: (v) => `${v}안타` },
      { award: 'title_SB', m: nz(b((x) => x.SB ?? 0)), high: true, fmt: (v) => `${v}도루` },
      { award: 'title_OBP', m: b(obp, true), high: true, fmt: f3 },
      { award: 'title_SLG', m: b(slg, true), high: true, fmt: f3 },
      { award: 'title_W', m: nz(p((x) => x.W)), high: true, fmt: (v) => `${v}승` },
      { award: 'title_ERA', m: p(era, (id) => d.qualPit(id)), high: false, fmt: (v) => v.toFixed(2) },
      { award: 'title_K', m: nz(p((x) => x.K)), high: true, fmt: (v) => `${v}탈삼진` },
      { award: 'title_SV', m: nz(p((x) => x.SV)), high: true, fmt: (v) => `${v}세이브` },
      { award: 'title_HLD', m: nz(p((x) => x.HLD)), high: true, fmt: (v) => `${v}홀드` },
      { award: 'title_WPCT', m: p((x) => x.W / Math.max(1, x.W + x.L), (_id, x) => x.W >= A.ggPitcher.W), high: true, fmt: f3 },
    ];
    return list.map((t) => ({ award: t.award, ids: leaders(t.m, t.high), value: (id: number) => t.fmt(t.m.get(id)!) }));
  }

  /** MVP 후보 점수(팀 보정 전): 타자·선발·구원을 같은 표로 */
  private mvpBase(d: SeasonData, s: ReturnType<AwardOps['scores']>, titleCount: Map<number, number>): Map<number, number> {
    const out = new Map<number, number>();
    for (const [id, v] of s.hit) if (d.qualBat(id)) out.set(id, v);
    for (const [id, v] of s.starter) if (d.qualPit(id)) out.set(id, Math.max(out.get(id) ?? 0, v * A.starterScale));
    for (const [id, v] of s.reliever) {
      const p = d.pit.get(id)!;
      if (p.SV >= A.mvpReliefSv || p.HLD >= A.mvpReliefHld) out.set(id, Math.max(out.get(id) ?? 0, v * A.relieverScale));
    }
    for (const id of out.keys()) out.set(id, out.get(id)! + (titleCount.get(id) ?? 0) * A.titleBonus);
    return out;
  }

  private best(meta: GameMeta, scores: Map<number, number>, award: string, season: number, noise: boolean): number[] {
    const m = new Map([...scores].map(([id, v]) => [id, v + (noise ? voteNoise(meta.seed, season, award, id) : 0)]));
    return leaders(new Map([...m].map(([id, v]) => [id, Math.round(v * 1000) / 1000])));
  }

  // ───────── KBO 시상식(한국시리즈 종료일 선정, K+3 발표) ─────────

  /** 한국시리즈 종료일: 시즌 시상 선정(감독 교체 전). 발표일은 K+3 */
  seasonCeremony(meta: GameMeta, kDate: GameDate): void {
    const season = meta.season;
    // 같은 시즌을 두 번 시상하지 않는다(불러온 뒤 다시 처리해도)
    if (this.repo.getAwards({ season }).some((a) => !a.award.startsWith('monthly_'))) return;
    if (this.repo.isCompressed(season) || this.repo.getGames(season, 'regular').length === 0) return;
    this.repo.insertAwards(this.computeSeason(meta, kDate));
  }

  /** KBO 시상식·한국시리즈 MVP 선정(저장하지 않음). 같은 시드·같은 기록이면 같은 결과 */
  computeSeason(meta: GameMeta, kDate: GameDate): AwardRecord[] {
    const season = meta.season;
    const date = addDays(kDate, A.ceremonyAfterK);
    const d = this.data(meta, season);
    const s = this.scores(d);
    const rows: AwardRecord[] = [];
    const add = (award: string, slot: string, ids: number[], score: (id: number) => number, detail: (id: number) => string) => {
      for (const id of ids) rows.push(this.rec(meta, d, award, slot, id, date, score(id), detail(id)));
    };
    // 타이틀
    const titleCount = new Map<number, number>();
    const pitTitles = new Map<number, number>();
    for (const t of this.titles(d)) {
      add(t.award, '', t.ids, () => 0, (id) => t.value(id));
      for (const id of t.ids) {
        titleCount.set(id, (titleCount.get(id) ?? 0) + 1);
        if (/^title_(W|ERA|K|SV|HLD|WPCT)$/.test(t.award)) pitTitles.set(id, (pitTitles.get(id) ?? 0) + 1);
      }
    }
    const standings = this.repo.getSeasonStandings(season);
    const rankOf = (c: ClubId) => standings.find((x) => x.clubId === c)?.rank ?? 10;
    const detail = (id: number) => this.batDetail(d.bat.get(id)) || this.pitDetail(d.pit.get(id));
    // MVP
    const mvpBase = this.mvpBase(d, s, titleCount);
    const mvp = new Map([...mvpBase].map(([id, v]) => [id, v + (10 - rankOf(d.clubOf(id))) * A.teamBonusPerRank]));
    add('mvp', '', this.best(meta, mvp, 'mvp', season, true), (id) => mvp.get(id)!, detail);
    // 신인왕: 외국인 제외, 프로 5시즌 이내, 직전까지 통산 60타석·30이닝 이하, 규정 절반 이상
    const before = this.careerBefore(season);
    const rookieOk = (id: number) => {
      const p = d.players.get(id);
      if (!p || p.origin !== 'domestic' || p.career.proSeasons > A.rookie.maxProSeasons) return false;
      if ((before.bat.get(id)?.PA ?? 0) > A.rookie.priorPa || (before.pit.get(id)?.OUTS ?? 0) > A.rookie.priorOuts) return false;
      return (d.bat.get(id)?.PA ?? 0) >= d.teamGames * A.qualPaPerGame / 2 || (d.pit.get(id)?.OUTS ?? 0) >= d.teamGames * A.qualOutsPerGame / 2;
    };
    const rookie = new Map<number, number>();
    for (const [id, v] of s.hit) if (rookieOk(id)) rookie.set(id, v + (titleCount.get(id) ?? 0) * A.titleBonus);
    for (const [id, v] of s.starter) if (rookieOk(id)) rookie.set(id, Math.max(rookie.get(id) ?? 0, v * A.starterScale + (titleCount.get(id) ?? 0) * A.titleBonus));
    for (const [id, v] of s.reliever) if (rookieOk(id)) rookie.set(id, Math.max(rookie.get(id) ?? 0, v * A.relieverScale + (titleCount.get(id) ?? 0) * A.titleBonus));
    add('roy', '', this.best(meta, rookie, 'roy', season, true), (id) => rookie.get(id)!, detail);
    // 최우수 투수
    const pitcher = new Map<number, number>();
    for (const [id, v] of s.starter) if (d.qualPit(id)) pitcher.set(id, v * A.starterScale + (pitTitles.get(id) ?? 0) * A.titleBonus);
    for (const [id, v] of s.reliever) {
      const p = d.pit.get(id)!;
      if (p.SV >= A.mvpReliefSv || p.HLD >= A.mvpReliefHld) pitcher.set(id, Math.max(pitcher.get(id) ?? 0, v * A.relieverScale + (pitTitles.get(id) ?? 0) * A.titleBonus));
    }
    add('pitcher', '', this.best(meta, pitcher, 'pitcher', season, true), (id) => pitcher.get(id)!, (id) => this.pitDetail(d.pit.get(id)));
    // 구원상: 마무리·중간(편차 없음)
    const closers = new Map([...d.pit].filter(([, p]) => p.SV >= A.closerMinSv));
    const middles = new Map([...d.pit].filter(([, p]) => p.HLD >= A.setupMinHld));
    const rateRank = (m: Map<number, PitLine>) => sumMaps([rankPoints(new Map([...m].map(([id, p]) => [id, era(p)])), false), rankPoints(new Map([...m].map(([id, p]) => [id, whip(p)])), false)]);
    const cr = rateRank(closers);
    const closerScore = new Map([...closers].map(([id, p]) => [id, p.SV * 2 - p.BS * 3 + (cr.get(id) ?? 0)]));
    add('closer', '', leaders(closerScore), (id) => closerScore.get(id)!, (id) => this.pitDetail(d.pit.get(id)) + ` · 블론 ${d.pit.get(id)!.BS}`);
    const mr = rateRank(middles);
    const setupScore = new Map([...middles].map(([id, p]) => [id, p.HLD * 1.5 + p.G * 0.2 + (mr.get(id) ?? 0)]));
    add('setup', '', leaders(setupScore), (id) => setupScore.get(id)!, (id) => this.pitDetail(d.pit.get(id)));
    // 재기상
    const prev = this.previous(season);
    const comeback = new Map<number, number>();
    for (const [id, v] of s.hit) {
      const pb = prev.bat.get(id);
      if (!d.qualBat(id) || !pb || pb.PA <= 0 || pb.PA >= d.teamGames * A.qualPaPerGame / 2) continue;
      const gain = ops(d.bat.get(id)!) - (Number.isFinite(ops(pb)) ? ops(pb) : 0);
      if (gain > 0) comeback.set(id, gain * v);
    }
    for (const [id, v] of s.starter) {
      const pp = prev.pit.get(id);
      if (!d.qualPit(id) || !pp || pp.OUTS <= 0 || pp.OUTS >= d.teamGames * A.qualOutsPerGame / 2) continue;
      const gain = (Number.isFinite(era(pp)) ? era(pp) : 9) - era(d.pit.get(id)!);
      if (gain > 0) comeback.set(id, Math.max(comeback.get(id) ?? 0, gain * v * A.starterScale / 10));
    }
    add('comeback', '', leaders(comeback), (id) => comeback.get(id)!, detail);
    // 감독상: (실제 승수 − 예상 승수) + 순위 상승 × 3 + 가을야구 5 + 편차
    const expected = meta.awardBase?.[String(season)];
    const prevStand = this.repo.getSeasonStandings(season - 1);
    const managers = this.repo.getStaff().filter((x) => x.title === '감독' && x.clubId !== null);
    const mgr = new Map<number, number>();
    const mgrClub = new Map<number, ClubId>();
    for (const m of managers) {
      const st = standings.find((x) => x.clubId === m.clubId);
      if (!st) continue;
      const er = expected?.[String(m.clubId)] ?? this.expectedRank(meta, m.clubId!, season);
      const expWins = A.manager.baseWins + (5.5 - er) * A.manager.perRank;
      const prevRank = prevStand.find((x) => x.clubId === m.clubId)?.rank ?? er;
      mgr.set(m.id, st.wins - expWins + (prevRank - st.rank) * A.manager.rankGain + (st.rank <= 5 ? A.manager.postseason : 0) + voteNoise(meta.seed, season, 'manager', m.id));
      mgrClub.set(m.id, m.clubId!);
    }
    for (const id of leaders(new Map([...mgr].map(([k, v]) => [k, Math.round(v * 1000) / 1000])))) {
      const st = standings.find((x) => x.clubId === mgrClub.get(id))!;
      rows.push({ season, award: 'manager', slot: '', playerId: null, clubId: mgrClub.get(id)!, staffId: id, date, score: r1(mgr.get(id)!), detail: `${managers.find((x) => x.id === id)!.name} 감독 · ${st.wins}승 ${st.losses}패 ${st.rank}위` });
    }
    // 올해의 프런트
    const allPts = sumMaps([s.hit, new Map([...s.starter].map(([k, v]) => [k, v * A.starterScale])), new Map([...s.reliever].map(([k, v]) => [k, v * A.relieverScale]))]);
    const front = new Map<number, number>();
    const frontDetail = new Map<number, string>();
    for (const c of this.clubs.keys()) {
      const st = standings.find((x) => x.clubId === c);
      if (!st) continue;
      const pw = prevStand.find((x) => x.clubId === c)?.wins ?? st.wins;
      const mine = [...d.players.values()].filter((p) => p.clubId === c);
      const newcomers = mine.filter((p) => !(prev.clubs.get(p.id)?.has(c)) && !(p.draft && p.draft.year >= season - 1) && (d.bat.has(p.id) || d.pit.has(p.id)));
      const newPts = newcomers.reduce((a, p) => a + (allPts.get(p.id) ?? 0), 0);
      const draftees = mine.filter((p) => p.draft && ((d.bat.get(p.id)?.G ?? 0) >= A.front.drafteeBatG || (d.pit.get(p.id)?.G ?? 0) >= A.front.drafteePitG)).length;
      const net = this.repo.ledgerByCategory(c, season).filter((x) => x.category !== 'startCash').reduce((a, x) => a + x.amount, 0);
      front.set(c, st.wins - pw + newPts + draftees * A.front.drafteeEach + (net > 0 ? A.front.profit : 0) + voteNoise(meta.seed, season, 'front', c));
      frontDetail.set(c, `승수 ${st.wins - pw >= 0 ? '+' : ''}${st.wins - pw} · 새 선수 ${newcomers.length}명 기여 ${r1(newPts)} · 지명 선수 정착 ${draftees}명 · ${net > 0 ? '흑자' : '적자'}`);
    }
    for (const c of leaders(new Map([...front].map(([k, v]) => [k, Math.round(v * 1000) / 1000])))) rows.push({ season, award: 'front', slot: '', playerId: null, clubId: c, staffId: null, date, score: r1(front.get(c)!), detail: frontDetail.get(c)! });
    // 수비상 9
    const def = this.defenseScores(d);
    for (const [pos, m] of def.byPos) add('defense', pos, leaders(new Map([...m].map(([k, v]) => [k, Math.round(v * 1000) / 1000]))), (id) => m.get(id)!, (id) => def.detail(id, pos));
    // 기록 달성상
    for (const [id, b] of d.bat) {
      const pb = before.bat.get(id) ?? emptyBat();
      for (const [k, steps] of Object.entries(A.milestones)) {
        if (!['H', 'HR', 'RBI', 'SB'].includes(k)) continue;
        const key = k as 'H' | 'HR' | 'RBI' | 'SB';
        for (const m of crossed(pb[key] ?? 0, (pb[key] ?? 0) + (b[key] ?? 0), steps)) rows.push(this.rec(meta, d, 'milestone', `${MS_LABEL[k]} ${m}`, id, date, m, `통산 ${(pb[key] ?? 0) + (b[key] ?? 0)}`));
      }
    }
    for (const [id, p] of d.pit) {
      const pp = before.pit.get(id) ?? emptyPit();
      for (const k of ['W', 'SV', 'K'] as const) for (const m of crossed(pp[k], pp[k] + p[k], A.milestones[k]!)) rows.push(this.rec(meta, d, 'milestone', `${MS_LABEL[k]} ${m}`, id, date, m, `통산 ${pp[k] + p[k]}`));
    }
    // 한국시리즈 MVP(종료일 바로)
    rows.push(...this.ksMvp(meta, season, kDate, d));
    return rows;
  }

  /** 수비상 점수(포지션 자격자): 수비 범위·수비율 순위 점수, 포수는 도루 저지율·포일 */
  private defenseScores(d: SeasonData) {
    const outs = new Map<number, Map<string, number>>();
    for (const r of this.repo.positionOuts(d.season)) {
      const m = outs.get(r.playerId) ?? new Map<string, number>();
      m.set(r.position, (m.get(r.position) ?? 0) + r.outs);
      outs.set(r.playerId, m);
    }
    const { fielding, catcher } = this.repo.awardFielding(d.season);
    const total = (id: number) => [...(outs.get(id) ?? new Map()).entries()].filter(([p]) => p !== 'DH').reduce((a, [, v]) => a + v, 0);
    const main = (id: number) => [...(outs.get(id) ?? new Map()).entries()].filter(([p]) => p !== 'DH').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const byPos = new Map<string, Map<number, number>>();
    for (const pos of [...FIELD_POS, 'P']) {
      const q = [...outs.keys()].filter((id) => main(id) === pos && (pos === 'P' ? d.qualPit(id) || (d.pit.get(id)?.G ?? 0) >= A.pitcherDefGames : (outs.get(id)!.get(pos) ?? 0) >= A.posQualOuts));
      if (q.length === 0) continue;
      const rf = new Map(q.map((id) => { const f = fielding.get(id) ?? { PO: 0, A: 0, E: 0 }; return [id, ((f.PO + f.A) * 27) / Math.max(1, total(id))]; }));
      const fp = new Map(q.map((id) => { const f = fielding.get(id) ?? { PO: 0, A: 0, E: 0 }; const tc = f.PO + f.A + f.E; return [id, tc > 0 ? (f.PO + f.A) / tc : 1]; }));
      const parts = [rankPoints(rf), rankPoints(fp)];
      if (pos === 'C') {
        parts.push(rankPoints(new Map(q.map((id) => { const c = catcher.get(id) ?? { SB: 0, CS: 0, PB: 0 }; return [id, c.SB + c.CS > 0 ? c.CS / (c.SB + c.CS) : 0]; }))));
        parts.push(rankPoints(new Map(q.map((id) => [id, ((catcher.get(id)?.PB ?? 0) * 27) / Math.max(1, total(id))])), false));
      }
      // 순위 점수 합은 정수라 동률이 잦다: 수비 범위(9이닝당 자살 + 보살)를 1점보다 작게 더해 가른다(ASSUMPTION D-180)
      byPos.set(pos, sumMaps([...parts, new Map([...rf].map(([k, v]) => [k, v / 100]))]));
    }
    return {
      byPos,
      outs,
      detail: (id: number, pos: string) => {
        const f = fielding.get(id) ?? { PO: 0, A: 0, E: 0 };
        const c = catcher.get(id);
        return `${POS_LABEL[pos]} ${ip(outs.get(id)?.get(pos) ?? 0)}이닝 · 자살 ${f.PO} 보살 ${f.A} 실책 ${f.E}${pos === 'C' && c ? ` · 도루 저지 ${c.CS}/${c.SB + c.CS} · 포일 ${c.PB}` : ''}`;
      },
    };
  }

  /** 한국시리즈 MVP: 우승 팀 선수의 한국시리즈 기록 점수 + 편차 */
  private ksMvp(meta: GameMeta, season: number, kDate: GameDate, d: SeasonData): AwardRecord[] {
    const champ = meta.postseason?.season === season ? meta.postseason.champion : null;
    if (champ === null || champ === undefined) return [];
    const ks = this.repo.getFixtures(season).filter((f) => f.stage === 'ks' && f.played);
    const score = new Map<number, number>();
    const add = (id: number, v: number) => score.set(id, (score.get(id) ?? 0) + v);
    for (const f of ks) {
      const ev = this.repo.getGameEvents(f.id);
      const g = this.repo.getGame(f.id)!;
      for (const pa of ev.pas) {
        if (pa.battingClub === champ) {
          const tb = { '1B': 1, '2B': 2, '3B': 3, HR: 4 }[pa.outcome] ?? 0;
          add(pa.batterId, tb + pa.rbi + (pa.outcome === 'BB' ? 0.5 : 0));
        } else add(pa.pitcherId, pa.outsOnPlay * 0.5 + (pa.outcome === 'K' ? 0.5 : 0));
      }
      for (const r of ev.runs) {
        if (r.battingClub === champ) add(r.runnerId, 1);
        else if (r.earned) add(r.pitcherId, -2);
      }
      for (const p of ev.plays) if (p.battingClub === champ && p.kind === 'SB' && p.runnerId) add(p.runnerId, 1);
      if (g.winningPitcher && (g.home === champ ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns)) add(g.winningPitcher, 3);
      if (g.savePitcher && (g.home === champ ? g.homeRuns > g.awayRuns : g.awayRuns > g.homeRuns)) add(g.savePitcher, 2);
    }
    const pool = new Map([...score].filter(([id]) => d.players.get(id)?.clubId === champ));
    return this.best(meta, pool, 'ks_mvp', season, true).map((id) => ({ season, award: 'ks_mvp', slot: '', playerId: id, clubId: champ, staffId: null, date: kDate, score: r1(pool.get(id)!), detail: `한국시리즈 ${ks.length}경기 기록 점수 ${r1(pool.get(id)!)}` }));
  }

  // ───────── 골든글러브 시상식(12월 둘째 월요일) ─────────

  goldenGlove(meta: GameMeta, date: GameDate): InboxMessage[] {
    const season = meta.season;
    if (this.repo.getAwards({ season, award: 'gg' }).length > 0 || this.repo.isCompressed(season) || this.repo.getGames(season, 'regular').length === 0) return [];
    const rows = this.computeGoldenGlove(meta, date);
    this.repo.insertAwards(rows);
    return [this.ceremonyMessage(meta, date, `${season} 골든글러브 시상식`, rows)];
  }

  /** 골든글러브·플래티넘·베스트 팀 선정(저장하지 않음) */
  computeGoldenGlove(meta: GameMeta, date: GameDate): AwardRecord[] {
    const season = meta.season;
    const d = this.data(meta, season);
    const s = this.scores(d);
    const def = this.defenseScores(d);
    const rows: AwardRecord[] = [];
    const offense = s.hit;
    const pitTitle = (id: number) => this.repo.getAwards({ season, playerId: id }).filter((a) => /^title_(W|ERA|K|SV|HLD|WPCT)$/.test(a.award)).length;
    // 포지션 점수: 공격 × 0.7 + 수비상 점수 × 0.3 + 편차
    const posScore = new Map<string, Map<number, number>>();
    const qualAt = (id: number, pos: string) => {
      const o = def.outs.get(id);
      if (!o) return false;
      if (pos === 'OF') return [...OF].reduce((a, p) => a + (o.get(p) ?? 0), 0) >= A.posQualOuts;
      if (pos === 'DH') return (o.get('DH') ?? 0) >= A.dhQualOuts;
      return (o.get(pos) ?? 0) >= A.posQualOuts;
    };
    const defOf = (id: number, pos: string) => (pos === 'OF' ? Math.max(...[...OF].map((p) => def.byPos.get(p)?.get(id) ?? 0)) : (def.byPos.get(pos)?.get(id) ?? 0));
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH']) {
      const m = new Map<number, number>();
      for (const id of d.bat.keys()) if (qualAt(id, pos)) m.set(id, (offense.get(id) ?? 0) * (pos === 'DH' ? 1 : 0.7) + (pos === 'DH' ? 0 : defOf(id, pos) * 0.3) + voteNoise(meta.seed, season, `gg_${pos}`, id));
      posScore.set(pos, m);
    }
    const pScore = new Map<number, number>();
    for (const [id, v] of s.starter) if (d.qualPit(id) || (d.pit.get(id)?.W ?? 0) >= A.ggPitcher.W) pScore.set(id, v * A.starterScale + pitTitle(id) * A.titleBonus + voteNoise(meta.seed, season, 'gg_P', id));
    for (const [id, v] of s.reliever) {
      const p = d.pit.get(id)!;
      if (p.SV >= A.ggPitcher.SV || p.HLD >= A.ggPitcher.HLD) pScore.set(id, Math.max(pScore.get(id) ?? -Infinity, v * A.relieverScale + pitTitle(id) * A.titleBonus + voteNoise(meta.seed, season, 'gg_P', id)));
    }
    const round = (m: Map<number, number>) => new Map([...m].map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    const top = (m: Map<number, number>, n: number, exclude: Set<number> = new Set()) => [...round(m)].filter(([id]) => !exclude.has(id)).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n).map(([id]) => id);
    const gg = new Set<number>();
    const pick = (pos: string, m: Map<number, number>, n: number) => {
      for (const id of n === 1 ? leaders(round(m)) : top(m, n)) {
        rows.push(this.rec(meta, d, 'gg', pos, id, date, m.get(id)!, pos === 'P' ? this.pitDetail(d.pit.get(id)) : this.batDetail(d.bat.get(id))));
        gg.add(id);
      }
    };
    pick('P', pScore, 1);
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'DH']) pick(pos, posScore.get(pos)!, 1);
    pick('OF', posScore.get('OF')!, 3);
    // 플래티넘: 수비상 수상자 중 포지션 표준화 점수 1위
    const defense = this.repo.getAwards({ season, award: 'defense' });
    const z = new Map<number, number>();
    for (const a of defense) {
      const m = def.byPos.get(a.slot);
      if (!m || a.playerId === null) continue;
      const vals = [...m.values()];
      const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length) || 1;
      z.set(a.playerId, (m.get(a.playerId)! - mean) / sd + voteNoise(meta.seed, season, 'platinum', a.playerId) / 10);
    }
    for (const id of leaders(round(z))) rows.push(this.rec(meta, d, 'platinum', '', id, date, z.get(id)!, def.detail(id, defense.find((a) => a.playerId === id)!.slot)));
    // 베스트 팀 1·2: 포지션 9 + 남은 야수 최고 1 + 선발 5 + 구원 2. 골든글러브 수상자는 자동 1팀
    const posKeys = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    const used = new Set<number>();
    const team = (n: 1 | 2) => {
      const award = n === 1 ? 'best1' : 'best2';
      for (const pos of posKeys) {
        const src = OF.has(pos) ? posScore.get('OF')! : posScore.get(pos)!;
        const pref = n === 1 ? [...gg].filter((id) => src.has(id) && !used.has(id) && (OF.has(pos) ? (def.outs.get(id)?.get(pos) ?? 0) > 0 : true)) : [];
        const id = pref[0] ?? top(src, 1, used)[0];
        if (id === undefined) continue;
        used.add(id);
        rows.push(this.rec(meta, d, award, pos, id, date, src.get(id)!, this.batDetail(d.bat.get(id))));
      }
      const ut = top(new Map([...offense].filter(([id]) => d.qualBat(id))), 1, used)[0];
      if (ut !== undefined) (used.add(ut), rows.push(this.rec(meta, d, award, 'UT', ut, date, offense.get(ut)!, this.batDetail(d.bat.get(ut)))));
      const sp = new Map([...s.starter].filter(([id]) => d.qualPit(id)));
      top(sp, A.bestStarters, used).forEach((id, i) => (used.add(id), rows.push(this.rec(meta, d, award, `SP${i + 1}`, id, date, sp.get(id)!, this.pitDetail(d.pit.get(id))))));
      const rp = new Map([...s.reliever].filter(([id]) => (d.pit.get(id)?.G ?? 0) >= A.relieverRateGames));
      top(rp, A.bestRelievers, used).forEach((id, i) => (used.add(id), rows.push(this.rec(meta, d, award, `RP${i + 1}`, id, date, rp.get(id)!, this.pitDetail(d.pit.get(id))))));
    };
    team(1);
    team(2);
    return rows;
  }

  // ───────── 월간 시상(매월 첫 월요일, 전월) ─────────

  monthly(meta: GameMeta, date: GameDate): InboxMessage[] {
    if (weekday(date) !== 1 || Number(date.slice(8, 10)) > 7) return [];
    const prevDay = addDays(date.slice(0, 8) + '01', -1);
    const month = prevDay.slice(0, 7);
    const season = meta.season;
    if (Number(month.slice(0, 4)) !== season || this.repo.isCompressed(season)) return [];
    if (this.repo.getAwards({ season }).some((a) => a.award.startsWith('monthly_') && a.slot === month)) return [];
    const d = this.data(meta, season, { from: `${month}-01`, to: prevDay });
    if (d.bat.size === 0) return [];
    const qb = (id: number) => (d.bat.get(id)?.PA ?? 0) >= A.monthly.minPa;
    const qp = (id: number) => (d.pit.get(id)?.OUTS ?? 0) >= A.monthly.minOuts || (d.pit.get(id)?.G ?? 0) >= A.monthly.minG;
    // 순위 점수 합의 동률은 OPS(타자)·이닝(투수)으로 가른다(1점보다 작게)
    const hit = sumMaps([hitterPoints(new Map([...d.bat].filter(([id]) => qb(id))), qb), new Map([...d.bat].filter(([id]) => qb(id)).map(([id, b]) => [id, (Number.isFinite(ops(b)) ? ops(b) : 0) / 10]))]);
    const { starter, reliever } = pitcherPoints(new Map([...d.pit].filter(([id]) => qp(id))), qp, qp);
    const pit = new Map<number, number>([...[...starter].map(([k, v]) => [k, v * A.starterScale] as [number, number]), ...[...reliever].map(([k, v]) => [k, v * A.relieverScale] as [number, number])].map(([k, v]) => [k, v + (d.pit.get(k)?.OUTS ?? 0) / 3000] as [number, number]));
    const rows: AwardRecord[] = [];
    for (const id of leaders(hit)) rows.push(this.rec(meta, d, 'monthly_bat', month, id, date, hit.get(id)!, this.batDetail(d.bat.get(id))));
    for (const id of leaders(pit)) rows.push(this.rec(meta, d, 'monthly_pit', month, id, date, pit.get(id)!, this.pitDetail(d.pit.get(id))));
    const before = this.careerBefore(season);
    const rookie = new Map<number, number>();
    for (const [id, v] of [...hit, ...pit]) {
      const p = d.players.get(id);
      if (!p || p.origin !== 'domestic' || p.career.proSeasons > A.rookie.maxProSeasons) continue;
      if ((before.bat.get(id)?.PA ?? 0) > A.rookie.priorPa || (before.pit.get(id)?.OUTS ?? 0) > A.rookie.priorOuts) continue;
      rookie.set(id, Math.max(rookie.get(id) ?? 0, v));
    }
    for (const id of leaders(rookie)) rows.push(this.rec(meta, d, 'monthly_rookie', month, id, date, rookie.get(id)!, this.batDetail(d.bat.get(id)) || this.pitDetail(d.pit.get(id))));
    if (rows.length === 0) return [];
    this.repo.insertAwards(rows);
    return [this.ceremonyMessage(meta, date, `${Number(month.slice(5))}월 월간 시상`, rows, 'news')];
  }

  // ───────── 발표 ─────────

  /** K+3: KBO 시상식 발표(선정은 한국시리즈 종료일). 한국시리즈 MVP는 종료일에 따로 알린다 */
  announce(meta: GameMeta, date: GameDate): InboxMessage[] {
    const rows = this.repo.getAwards({ season: meta.season }).filter((a) => a.date === date && !a.award.startsWith('monthly_') && a.award !== 'gg' && a.award !== 'platinum' && !a.award.startsWith('best'));
    return rows.length ? [this.ceremonyMessage(meta, date, `${meta.season} KBO 시상식`, rows)] : [];
  }

  ksMvpMessage(meta: GameMeta, date: GameDate): InboxMessage[] {
    const rows = this.repo.getAwards({ season: meta.season, award: 'ks_mvp' });
    return rows.length ? [this.ceremonyMessage(meta, date, `${meta.season} 한국시리즈 MVP`, rows, 'news')] : [];
  }

  private ceremonyMessage(meta: GameMeta, date: GameDate, title: string, rows: AwardRecord[], kind: 'news' | 'report' = 'report'): InboxMessage {
    const players = new Map(this.repo.getPlayers().map((p) => [p.id, p]));
    const staff = new Map(this.repo.getStaff().map((s) => [s.id, s]));
    const mine = rows.filter((a) => a.clubId === meta.userClubId);
    const line = (a: AwardRecord) => {
      const who = a.playerId !== null ? (players.get(a.playerId)?.name ?? `#${a.playerId}`) : a.staffId !== null ? `${staff.get(a.staffId)?.name ?? ''} 감독` : '프런트';
      return `${a.clubId === meta.userClubId ? '★ ' : '· '}${awardTitle(a.award, a.slot)}: ${who}(${this.clubs.get(a.clubId)?.shortName ?? '-'})${a.detail ? ` — ${a.detail}` : ''}`;
    };
    return {
      date,
      kind,
      sender: 'KBO 소식',
      title: mine.length ? `${title}: 우리 구단 ${mine.length}개 수상` : title,
      body: `${rows.map(line).join('\n')}${mine.length ? '\n\n★ 표시는 우리 구단 수상입니다. 명예의 전당의 리그 시상 기록에서 다시 볼 수 있습니다.' : ''}`,
    };
  }
}

const MS_LABEL: Record<string, string> = { H: '통산 안타', HR: '통산 홈런', RBI: '통산 타점', SB: '통산 도루', W: '통산 승', SV: '통산 세이브', K: '통산 탈삼진' };

export { isStarter };
