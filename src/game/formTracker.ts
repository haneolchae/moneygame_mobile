// 성적 혼합(3b) 표본 관리 (10a 4·7장, D-107). 저장된 원시 타석 기록에서만 만든다(화면 통계와 같은 원천).
// 이번 시즌 정규시즌 타석을 선수별로 메모리에 쌓고, 날마다 전날까지의 새 기록만 더 읽는다. 상태는 언제든 저장본에서
// 다시 만들 수 있으므로 저장·불러오기 뒤에도 같은 표본이 나온다. 그날 경기의 표본은 그날 첫 경기 전에 한 번에 고정한다.
import { addDays, diffDays, type GameDate } from '../engine/calendar';
import { NEW_GAME } from '../engine/config';
import { addCode, addTotals, buildForm, emptySamples, FORM_EVENTS, neutralizeInto, paCode, type EventSamples, type FormEvent, type FormRole, type PlayerForm } from '../engine/form';
import { batterSide, pitcherSide, type LeagueEnvironment } from '../engine/probability';
import { PROBABILITY_CONFIG } from '../engine/probabilityConfig';
import type { PlayerId, PlayerTruth } from '../engine/types';
import type { GameRepository } from './ports';

const EPOCH = '2000-01-01' as GameDate;
const dayNumber = (d: GameDate) => diffDays(d, EPOCH);

interface Track {
  days: number[];
  codes: number[];
  /** 이번 시즌 지금까지(가중치 1) */
  total: EventSamples;
}

/** 직전 시즌 한 개: 선수별 합계와 그 시즌 리그 합계, 시즌 가중치 */
interface PastSeason {
  weight: number;
  league: EventSamples;
  bat: Map<PlayerId, EventSamples>;
  pit: Map<PlayerId, EventSamples>;
}

export interface DayForms {
  batter: Map<PlayerId, PlayerForm>;
  pitcher: Map<PlayerId, PlayerForm>;
}

export class FormTracker {
  private season = -1;
  /** 이 날짜까지의 기록을 읽었다 */
  private through: GameDate | null = null;
  private bat = new Map<PlayerId, Track>();
  private pit = new Map<PlayerId, Track>();
  /** 이번 시즌 리그 합계(가중치 1) */
  private league = emptySamples();
  private past: PastSeason[] = [];

  constructor(private readonly repo: GameRepository) {}

  /** date 경기에 쓸 선수별 표본(date 전날까지 확정된 기록만, 리그 수준 중립화 뒤) */
  formsFor(season: number, date: GameDate, players: readonly PlayerTruth[], env: LeagueEnvironment): DayForms {
    this.load(season, date);
    const today = dayNumber(date);
    const out: DayForms = { batter: new Map(), pitcher: new Map() };
    const baseline = { batter: this.baseline(players, 'batter', env), pitcher: this.baseline(players, 'pitcher', env) };
    const w0 = PROBABILITY_CONFIG.form.historySeasons[0]!;
    for (const p of players) {
      const role: FormRole = p.isPitcher ? 'pitcher' : 'batter';
      const track = (p.isPitcher ? this.pit : this.bat).get(p.id);
      const pastRows = this.past.map((s) => ({ s, rows: (p.isPitcher ? s.pit : s.bat).get(p.id) })).filter((x) => x.rows);
      if (!track && pastRows.length === 0) continue; // 기록 없음: 능력치만(100:0:0)
      const raw = track ? buildForm(track.days, track.codes, track.days.length, today, role, track.total) : { recent: emptySamples(), history: emptySamples() };
      const form: PlayerForm = { recent: emptySamples(), history: emptySamples() };
      neutralizeInto(form.recent, raw.recent, this.league, baseline[role], 1);
      neutralizeInto(form.history, raw.history, this.league, baseline[role], w0);
      for (const { s, rows } of pastRows) neutralizeInto(form.history, rows!, s.league, baseline[role], s.weight);
      out[role].set(p.id, form);
    }
    return out;
  }

  /** 엔진 기준: 그날 1군 선수 능력 기준 로짓의 평균(이번 시즌 기회 수 가중, 기록이 없으면 단순 평균) */
  private baseline(players: readonly PlayerTruth[], role: FormRole, env: LeagueEnvironment): Record<FormEvent, number> {
    const sum = { b: 0, k: 0, h: 0, x: 0 };
    const wsum = { b: 0, k: 0, h: 0, x: 0 };
    const tracks = role === 'pitcher' ? this.pit : this.bat;
    for (const p of players) {
      if (p.isPitcher !== (role === 'pitcher')) continue;
      const side = role === 'pitcher' ? pitcherSide(p, env) : batterSide(p, env);
      const t = tracks.get(p.id);
      for (const e of FORM_EVENTS) {
        const w = t ? t.total[e].opp : 0;
        sum[e] += w * side[e];
        wsum[e] += w;
      }
    }
    const out = {} as Record<FormEvent, number>;
    for (const e of FORM_EVENTS) {
      if (wsum[e] > 0) out[e] = sum[e] / wsum[e];
      else {
        // 이번 시즌 기록이 아직 없으면 단순 평균
        let s = 0;
        let n = 0;
        for (const p of players) {
          if (p.isPitcher !== (role === 'pitcher')) continue;
          s += (role === 'pitcher' ? pitcherSide(p, env) : batterSide(p, env))[e];
          n++;
        }
        out[e] = n > 0 ? s / n : 0;
      }
    }
    return out;
  }

  private load(season: number, date: GameDate): void {
    if (season !== this.season || (this.through !== null && date <= this.through)) this.reset(season);
    for (const r of this.repo.formRows(season, this.through, date)) {
      const day = dayNumber(r.date);
      const code = paCode(r.outcome);
      this.push(this.bat, r.batterId, day, code);
      this.push(this.pit, r.pitcherId, day, code);
      addCode(this.league, code, 1);
    }
    this.through = addDays(date, -1);
  }

  private push(map: Map<PlayerId, Track>, id: PlayerId, day: number, code: ReturnType<typeof paCode>): void {
    let t = map.get(id);
    if (!t) {
      t = { days: [], codes: [], total: emptySamples() };
      map.set(id, t);
    }
    t.days.push(day);
    t.codes.push(code);
    addCode(t.total, code, 1);
  }

  /** 새 시즌: 직전 2시즌 합계를 읽어 둔다. 게임 시작 이전 기록은 쓰지 않는다(D-107) */
  private reset(season: number): void {
    this.season = season;
    this.through = null;
    this.bat.clear();
    this.pit.clear();
    this.league = emptySamples();
    this.past = [];
    const weights = PROBABILITY_CONFIG.form.historySeasons;
    for (let i = 1; i < weights.length; i++) {
      const s = season - i;
      if (s <= NEW_GAME.previousSeason) continue;
      const past: PastSeason = { weight: weights[i]!, league: emptySamples(), bat: new Map(), pit: new Map() };
      for (const [id, t] of this.repo.battingTotals(s)) {
        const acc = emptySamples();
        const totals = { pa: t.PA, bb: t.BB, hbp: t.HBP, k: t.SO, hr: t.HR, h: t.H };
        addTotals(acc, totals, 1);
        addTotals(past.league, totals, 1);
        past.bat.set(id, acc);
      }
      for (const [id, t] of this.repo.pitchingTotals(s)) {
        const acc = emptySamples();
        addTotals(acc, { pa: t.BF, bb: t.BB, hbp: t.HBP, k: t.K, hr: t.HR, h: t.H }, 1);
        past.pit.set(id, acc);
      }
      this.past.push(past);
    }
  }
}
