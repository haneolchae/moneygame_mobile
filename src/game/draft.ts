// 신인 드래프트 (07 문서, D-084·D-085): 정규시즌 종료 다음 월요일, 정규시즌 역순 5라운드.
// 지명 선수는 한국시리즈 뒤 스토브리그 시작 때 입단한다.
import { addDays, weekday, type GameDate } from '../engine/calendar';
import { asTruth, awardHonors, prospectScore, seasonLine, type Amateur } from '../engine/amateur';
import { WORLDGEN } from '../engine/config';
import type { LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { observePlayer } from '../engine/observation';
import { Rng, stableNormal } from '../engine/rng';
import { needFirst } from '../engine/roster';
import { seasonKeyDates } from '../engine/schedule';
import { computeStandings } from '../engine/standings';
import type { ClubId, PlayerTruth } from '../engine/types';
import { overall } from '../engine/worldgen';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

/** ASSUMPTION(D-085): 라운드별 계약금, 신인 연봉 */
export const DRAFT = {
  rounds: 5,
  bonusByRound: [2 * EOK, 1.2 * EOK, 0.8 * EOK, 0.5 * EOK, 0.3 * EOK],
  rookieSalary: WORLDGEN.minSalary,
  /** 고교 3학년은 이 점수 이상이면 프로 진출을 신청한다(나머지는 진학 검토) */
  hsApplyScore: 29, // D-125: 아마추어 척도와 함께 38에서 9 낮춤
} as const;

/** 정규시즌 종료 다음 월요일 */
export function draftDate(season: number): GameDate {
  let d = addDays(seasonKeyDates(season).regularSeasonEnd, 1);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
}

export function isSenior(a: Amateur): boolean {
  return a.status === 'active' && ((a.level === '고교' && a.grade >= 3) || (a.level === '대학' && a.grade >= 4));
}

export class Draft {
  constructor(private readonly repo: GameRepository) {}

  /** 그해 아마추어 시즌 요약 성적과 업적(B안) */
  private settleAmateurSeason(meta: GameMeta, year: number, pool: Amateur[]) {
    for (const a of pool) {
      if (a.status !== 'active' || a.seasons.some((s) => s.year === year)) continue;
      a.seasons.push(seasonLine(Rng.derive(meta.seed, 'amateur-line', a.id, year), a, year));
    }
    awardHonors(Rng.derive(meta.seed, 'amateur-honor', year), pool, year);
  }

  /** 지명 대상: 졸업 예정자 중 프로 진출 신청자 */
  candidates(pool: Amateur[]): Amateur[] {
    return pool.filter((a) => isSenior(a) && (a.level === '대학' || prospectScore(a) >= DRAFT.hsApplyScore));
  }

  /** 구단이 보는 후보 가치: 관찰 능력 + 잠재력 추정(구단마다 다른 오차) */
  valueFor(meta: GameMeta, clubId: ClubId, a: Amateur, sdScale = 1): number {
    const t = asTruth(a);
    const obs = observePlayer(meta.seed, clubId, t, sdScale);
    const keys = a.isPitcher ? ['stuff', 'control'] : ['contact', 'eye', 'power'];
    const cur = keys.reduce((s, k) => s + (obs[k] ?? 50), 0) / keys.length;
    const pot = Object.values(a.hidden.potential).filter((v): v is number => typeof v === 'number');
    const potAvg = pot.length ? pot.reduce((x, y) => x + y, 0) / pot.length : 50;
    const potEst = 20 + potAvg * 0.6 + stableNormal(meta.seed, 'draft-pot', clubId, a.id) * 6 * sdScale;
    return cur * 0.45 + potEst * 0.55;
  }

  /**
   * 드래프트 실행. userBoard: 우리 구단 지명 우선순위(선수 ID). userScale: 우리 스카우트 오차 배율
   * 순위표가 없으면(AI 구단, 우리 구단 기본 지명) 포지션 최소 인원(D-098)이 모자란 쪽을 먼저, 그 안에서 평가 순으로 고른다.
   */
  run(meta: GameMeta, date: GameDate, userBoard: number[], userScale: number): InboxMessage[] {
    const year = meta.season;
    const pool = this.repo.getAmateurs('active');
    this.settleAmateurSeason(meta, year, pool);
    const cands = this.candidates(pool);
    const clubs = this.repo.getClubs();
    const order = computeStandings(clubs.map((c) => c.id), this.repo.getGames(year))
      .map((r) => r.clubId)
      .reverse();
    const taken = new Set<number>();
    // 구단별 예상 선수단: 현재 소속 + 이번 드래프트 지명 선수
    const projected = new Map<ClubId, PlayerTruth[]>(clubs.map((c) => [c.id, this.repo.getPlayers().filter((p) => p.clubId === c.id && !p.retired)]));
    const picks: Array<{ round: number; pick: number; clubId: ClubId; a: Amateur }> = [];
    let n = 0;
    for (let round = 1; round <= DRAFT.rounds; round++) {
      for (const clubId of order) {
        const left = cands.filter((a) => !taken.has(a.id));
        if (!left.length) break;
        let choice: Amateur | undefined;
        if (clubId === meta.userClubId) choice = userBoard.map((id) => left.find((a) => a.id === id)).find((a) => a !== undefined);
        const scale = clubId === meta.userClubId ? userScale : 1;
        const ranked = [...left].sort((x, y) => this.valueFor(meta, clubId, y, scale) - this.valueFor(meta, clubId, x, scale) || x.id - y.id);
        choice ??= needFirst(projected.get(clubId) ?? [], ranked, (a) => asTruth(a))[0]!;
        projected.get(clubId)?.push(asTruth(choice));
        taken.add(choice.id);
        n++;
        choice.status = 'drafted';
        choice.draft = { year, clubId, round, pick: n };
        picks.push({ round, pick: n, clubId, a: choice });
      }
    }
    this.repo.saveAmateurs(pool);
    const name = (id: ClubId) => clubs.find((c) => c.id === id)?.shortName ?? `#${id}`;
    const mine = picks.filter((p) => p.clubId === meta.userClubId);
    const desc = (p: (typeof picks)[number]) => `${p.round}라운드 ${p.a.name}(${p.a.school} ${p.a.position}${p.a.honors.length ? `, ${p.a.honors[p.a.honors.length - 1]!.title}` : ''})`;
    return [
      {
        date,
        kind: 'report',
        sender: '스카우트팀',
        title: `${year} 신인 드래프트 결과`,
        body: `우리 구단 지명: ${mine.map(desc).join(' / ') || '없음'}\n지명 선수는 한국시리즈가 끝나고 스토브리그가 시작될 때 입단합니다.`,
      },
      {
        date,
        kind: 'news',
        sender: 'KBO 소식',
        title: `${year} 신인 드래프트 1라운드`,
        body: picks
          .filter((p) => p.round === 1)
          .map((p) => `${p.pick}순위 ${name(p.clubId)}: ${p.a.name} (${p.a.level} ${p.a.school}, ${p.a.position})`)
          .join('\n'),
      },
    ];
  }

  /** 스토브리그 시작 때 지명 선수 입단: 프로 선수로 등록하고 계약금을 낸다. */
  joinRookies(meta: GameMeta, date: GameDate): { players: PlayerTruth[]; ledger: LedgerEntry[] } {
    const drafted = this.repo.getAmateurs('drafted').filter((a) => a.draft && a.draft.year === meta.season);
    let id = Math.max(0, ...this.repo.getPlayers().map((p) => p.id)) + 1;
    const players: PlayerTruth[] = [];
    const ledger: LedgerEntry[] = [];
    for (const a of drafted) {
      const t = asTruth(a);
      const p: PlayerTruth = {
        ...t,
        id: id++,
        clubId: a.draft!.clubId,
        level: '2군',
        salary: DRAFT.rookieSalary,
        contractYears: 1,
        honors: a.honors.map((h) => h.title),
        draft: { year: a.draft!.year, round: a.draft!.round, pick: a.draft!.pick, school: a.school },
      };
      players.push(p);
      const bonus = DRAFT.bonusByRound[a.draft!.round - 1] ?? 0;
      ledger.push({ clubId: p.clubId!, date, category: 'signingBonus', amount: -bonus, memo: `${p.name} 신인 계약금(${a.draft!.round}라운드)` });
      a.status = 'gone';
    }
    this.repo.saveAmateurs(drafted);
    this.repo.savePlayers(players);
    return { players, ledger };
  }

  /** 우리 구단이 보는 후보 보드 */
  board(meta: GameMeta, userScale: number) {
    const pool = this.repo.getAmateurs('active');
    return this.candidates(pool)
      .map((a) => ({ a, value: this.valueFor(meta, meta.userClubId, a, userScale), ovr: overall(asTruth(a)) }))
      .sort((x, y) => y.value - x.value);
  }
}
