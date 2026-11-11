// 7b 재임 기록·해임 뒤 영입 제안·이어하기(02 문서, D-157).
// 영입 제안은 저장하지 않고 종료 시점 상태에서 계산한다(종료된 게임은 날짜가 진행되지 않아 결과가 같다).
// 이어하기는 우리 구단 전용 상태를 초기화하고 새 구단을 넘겨받는다. 선수·계약·직원·시설·현금은 구단에 딸려 있어 그대로 쓴다.
import { assessStance } from '../engine/aiClub';
import type { GameDate } from '../engine/calendar';
import { CAREER, NEW_GAME } from '../engine/config';
import type { ClubId, ClubProfile } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { GameMeta, GameRepository, StanceState, Tenure } from './ports';

export interface TenureSummary {
  clubId: ClubId;
  from: GameDate;
  to: GameDate | null;
  reason: string | null;
  seasons: Array<{ season: number; rank: number; wins: number; losses: number; ties: number; postseason: string }>;
  titles: number;
  postseasons: number;
  startCashWon: number;
  endCashWon: number;
}

export class CareerOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    /** 기준 순위(D-155 (1)) */
    private readonly ranks: () => Map<ClubId, number>,
  ) {}

  /** 재임 목록. 기록이 없는 저장본은 게임 시작부터 지금 구단을 맡은 것으로 본다 */
  tenures(meta: GameMeta): Tenure[] {
    if (meta.tenures?.length) return meta.tenures;
    return [{ clubId: meta.userClubId, from: NEW_GAME.startDate, to: null, reason: null, startCashWon: this.clubs.get(meta.userClubId)!.startCash, endCashWon: null }];
  }

  /** 재임 요약: 재임 중 정규시즌이 끝난 시즌의 최종 순위·포스트시즌 결과, 우승 수, 현금 */
  summaries(meta: GameMeta): TenureSummary[] {
    const list = this.tenures(meta);
    return list.map((t, i) => {
      const current = i === list.length - 1 && t.to === null;
      const to = t.to ?? (current && meta.gameOver ? meta.gameOver.date : null);
      const until = to ?? meta.currentDate;
      const seasons = Object.entries(meta.regularSeasons ?? {})
        .filter(([, r]) => r.endDate >= t.from && r.endDate <= until)
        .map(([y]) => this.repo.getSeasonStandings(Number(y)).find((s) => s.clubId === t.clubId))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .sort((a, b) => a.season - b.season)
        .map((s) => ({ season: s.season, rank: s.rank, wins: s.wins, losses: s.losses, ties: s.ties, postseason: s.postseason }));
      return {
        clubId: t.clubId,
        from: t.from,
        to,
        reason: t.reason ?? (current && meta.gameOver ? meta.gameOver.reason : null),
        seasons,
        titles: seasons.filter((s) => s.postseason === '한국시리즈 우승').length,
        postseasons: seasons.filter((s) => s.postseason !== '').length,
        startCashWon: t.startCashWon,
        endCashWon: t.endCashWon ?? this.repo.cashBalance(t.clubId),
      };
    });
  }

  /** 해임 뒤 영입 제안 구단(D-157 (3)): 파산·진행 중인 게임은 없음 */
  jobOffers(meta: GameMeta): ClubId[] {
    if (meta.gameOver?.kind !== 'dismissed') return [];
    const mine = this.summaries(meta).at(-1)!;
    const n = mine.postseasons > 0 || meta.ownerLevel >= CAREER.twoOffersLevel ? 2 : meta.ownerLevel >= CAREER.oneOfferLevel || mine.seasons.length >= CAREER.oneOfferSeasons ? 1 : 0;
    const ranks = this.ranks();
    return [...this.clubs.keys()]
      .filter((id) => id !== meta.userClubId)
      .sort((a, b) => (ranks.get(b) ?? 5) - (ranks.get(a) ?? 5) || a - b)
      .slice(0, n);
  }

  /** 영입 제안 수락: 행동력 0. 호출자가 트랜잭션을 열고, 끝나면 서비스를 다시 만든다(구단별 기억 값 초기화) */
  acceptJob(meta: GameMeta, clubId: ClubId): { message: string } {
    if (!this.jobOffers(meta).includes(clubId)) throw new GameError('NOT_AVAILABLE', '영입 제안을 받은 구단이 아닙니다.');
    const date = meta.currentDate;
    const old = meta.userClubId;
    const club = this.clubs.get(clubId)!;
    const tenures = this.tenures(meta).map((t, i, all) => (i === all.length - 1 ? { ...t, to: meta.gameOver!.date, reason: meta.gameOver!.reason, endCashWon: this.repo.cashBalance(old) } : t));
    tenures.push({ clubId, from: date, to: null, reason: null, startCashWon: this.repo.cashBalance(clubId), endCashWon: null });
    // 진행 중인 위임 업무·결재 대기는 이전 구단 일이므로 취소한다
    for (const a of this.repo.getApprovals('pending')) this.repo.updateApproval(a.id, 'expired');
    for (const t of this.repo.getTasks({ status: ['queued', 'waiting'] })) this.repo.updateTask(t.id, { status: 'cancelled', note: '구단 이동으로 취소', updated: date });
    // 운영 상태: 새 구단은 우리 구단이 되어 빠지고, 이전 구단은 AI 구단이 되어 지금 평가받는다
    const stance: Record<string, StanceState> = { ...(meta.clubStance ?? {}) };
    delete stance[String(clubId)];
    stance[String(old)] = { stance: assessStance(undefined, this.ranks().get(old) ?? 5, this.repo.cashBalance(old)), since: date, assessed: date };
    // 새 구단이 AI 구단일 때 받은 긴급 지원 차감은 우리 구단 차감으로 넘겨받는다
    const deduction: Record<string, number> = {};
    for (const [season, m] of Object.entries(meta.aiSupportDeduction ?? {})) if (m[String(clubId)]) deduction[season] = m[String(clubId)]!;
    const fans = { ...(meta.fans ?? {}) };
    if (fans[String(old)]) fans[String(old)] = { satisfaction: fans[String(old)]!.satisfaction };
    this.repo.updateMeta({
      userClubId: clubId,
      gameOver: null,
      tenures,
      goalMisses: 0,
      rebuild: null,
      seasonGoal: null,
      // 시즌 중에 옮기면 그 시즌은 성적 판정에서 미달로 세지 않는다
      goalExemptSeason: meta.mode === 'season' ? meta.season : null,
      supportCutBp: {},
      supportDeduction: deduction,
      cashCrisisSince: null,
      emergencyUsedSeason: null,
      retirementPending: [],
      draftBoard: [],
      userPlan: { mode: 'auto', plan: null },
      rosterMoves: [],
      restOrders: {},
      tradeTalks: {},
      tradeOffers: [],
      contractSessions: {},
      sponsorOffers: [],
      ticketPolicy: 'normal',
      clubStance: stance,
      fans,
    });
    this.repo.addInbox([
      {
        date,
        kind: 'welcome',
        sender: club.parentIndustry ? '모기업' : '투자자 그룹',
        title: `${club.name} 부임`,
        body: `${club.name}의 경영을 맡았습니다. 선수단·계약·직원·시설·현금을 그대로 넘겨받습니다.\n성적 목표는 다음 시즌 시작 때 정합니다.${meta.mode === 'season' ? ' 이번 시즌 성적은 해임 판정에 넣지 않습니다.' : ''}\n스카우트 보고서는 기초 자료부터 다시 쌓습니다.`,
      },
    ]);
    return { message: `${club.name}에 부임했습니다.` };
  }
}
