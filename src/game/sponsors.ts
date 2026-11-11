// 6c 스폰서(16·23 문서, D-149): 스토브리그 제안, 직접 체결(행동력 2), AI 선택, 기본 계약, 시즌 마감 정산.
// 모든 구단이 같은 제안 생성·정산 규칙을 쓴다. 보장액은 체결 때, 인센티브·반환은 시즌 마감 때 장부에 넣는다.
import { type GameDate } from '../engine/calendar';
import { SPONSOR as S } from '../engine/config';
import { inflate, type LedgerEntry } from '../engine/finance';
import { EOK } from '../engine/money';
import { appeal, expectedValue, generateOffers, settle, slotReason, type SponsorContract, type SponsorOffer } from '../engine/sponsors';
import type { ClubId, ClubProfile } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { BusinessOps } from './business';
import type { Organization } from './organization';
import type { GameMeta, GameRepository, InboxMessage } from './ports';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);

export class SponsorOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly org: Organization,
    private readonly business: BusinessOps,
  ) {}

  contractsOf(meta: GameMeta, clubId: ClubId): SponsorContract[] {
    return meta.sponsors?.[String(clubId)] ?? [];
  }

  /** 스토브리그에 맺는 계약의 시즌 */
  private contractSeason(meta: GameMeta): number {
    return meta.season + 1;
  }

  private kYear(meta: GameMeta): number {
    return Number(meta.kDate.slice(0, 4));
  }

  /** 스토브리그의 제안 기간(12/7~다음 해 1/31)인가 */
  private window(meta: GameMeta, date: GameDate): boolean {
    return meta.mode === 'stove' && date >= `${this.kYear(meta)}-${S.offerMonthDay}` && date <= `${this.kYear(meta) + 1}-${S.defaultMonthDay}`;
  }

  private priorPct(meta: GameMeta, clubId: ClubId): number {
    const t = meta.attendance?.[String(meta.season)]?.[String(clubId)];
    if (t && t.w + t.l > 0) return t.w / (t.w + t.l);
    const s = this.repo.getSeasonStandings(meta.season).find((x) => x.clubId === clubId);
    return s && s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0.5;
  }

  /** 그 구단이 이번 스토브리그에 받는 제안 */
  offersFor(meta: GameMeta, clubId: ClubId): SponsorOffer[] {
    const club = this.clubs.get(clubId)!;
    const staff = this.org.staff(clubId).filter((s) => s.team === 'partnership');
    const boost = staff.length ? (S.staffBoostMax * staff.reduce((a, s) => a + (s.abilities.expertise ?? 50), 0)) / staff.length / 100 : 0;
    const season = this.contractSeason(meta);
    return generateOffers(meta.seed, season, club, appeal(club, this.priorPct(meta, clubId), this.business.fanOf(meta, clubId).satisfaction), boost, inflate(EOK, season, meta.inflationBp) / EOK);
  }

  private addContract(clubId: ClubId, c: SponsorContract): LedgerEntry {
    const cur = this.repo.getMeta();
    const id = String(clubId);
    const season = String(c.season);
    this.repo.updateMeta({
      sponsors: { ...(cur.sponsors ?? {}), [id]: [...(cur.sponsors?.[id] ?? []), c] },
      sponsorTotals: { ...(cur.sponsorTotals ?? {}), [season]: { ...(cur.sponsorTotals?.[season] ?? {}), [id]: (cur.sponsorTotals?.[season]?.[id] ?? 0) + c.guaranteedWon } },
    });
    return { clubId, date: c.signed, category: 'sponsorship', amount: c.guaranteedWon, memo: `${c.brand} ${c.slot === 'main' ? '메인' : '서브'} 스폰서 보장액(${c.season})` };
  }

  /** 매일(스토브리그): 12/7 제안 도착, 12/14 AI 선택, 1/31 우리 구단 기본 계약 */
  onDay(meta: GameMeta, date: GameDate): { ledger: LedgerEntry[]; inbox: InboxMessage[] } {
    const ledger: LedgerEntry[] = [];
    const inbox: InboxMessage[] = [];
    if (meta.mode !== 'stove') return { ledger, inbox };
    const k = this.kYear(meta);
    if (date === `${k}-${S.offerMonthDay}`) {
      const offers = this.offersFor(meta, meta.userClubId);
      this.repo.updateMeta({ sponsorOffers: offers });
      const top = [...offers].sort((a, b) => b.guaranteedWon - a.guaranteedWon)[0]!;
      inbox.push({ date, kind: 'task', sender: '사업제휴팀', title: `${this.contractSeason(meta)} 시즌 스폰서 제안 ${offers.length}건 도착`, body: `메인 ${S.mainOffers}건·서브 ${S.subOffers}건이 왔습니다(최고 보장액 ${top.brand} ${won(top.guaranteedWon)}). [사업·시설]에서 보장액·인센티브·의무를 비교해 고르세요(슬롯마다 행동력 ${S.signAp}). 1월 31일까지 비워 둔 자리는 사업제휴팀이 보장액 ${Math.round(S.defaultShare * 100)}%로 기본 계약합니다.` });
    }
    if (date === `${k}-${S.aiPickMonthDay}`) {
      for (const club of this.clubs.values()) {
        if (club.id === meta.userClubId) continue;
        for (const c of this.autoPick(this.repo.getMeta(), club.id, this.offersFor(meta, club.id), date, 'ai', 1)) ledger.push(this.addContract(club.id, c));
      }
    }
    if (date === `${k + 1}-${S.defaultMonthDay}`) {
      const cur = this.repo.getMeta();
      const offers = cur.sponsorOffers ?? [];
      const lead = this.org.teamDelegate(meta.userClubId, 'partnership');
      const picked = lead ? this.autoPick(cur, meta.userClubId, offers, date, 'team', S.defaultShare) : [];
      for (const c of picked) ledger.push(this.addContract(meta.userClubId, c));
      this.repo.updateMeta({ sponsorOffers: [] });
      if (picked.length) inbox.push({ date, kind: 'report', sender: '사업제휴팀', title: `스폰서 기본 계약 ${picked.length}건`, body: `${lead!.who.name}이(가) 비어 있던 자리를 보장액 ${Math.round(S.defaultShare * 100)}%로 계약했습니다.\n${picked.map((c) => `· ${c.slot === 'main' ? '메인' : '서브'} ${c.brand}: ${won(c.guaranteedWon)} · 의무: ${S.obligations[c.obligation]}`).join('\n')}` });
      else if (!lead && offers.length) inbox.push({ date, kind: 'report', sender: '비서', title: '스폰서 자리가 비었습니다', body: '사업제휴팀장과 사업본부장이 모두 없어 기본 계약을 하지 못했습니다. 이번 시즌 남은 스폰서 자리는 비어 있습니다.' });
    }
    return { ledger, inbox };
  }

  /** 빈 슬롯을 기대 수입이 큰 제안부터 채운다(업종 독점·슬롯 한도 준수) */
  private autoPick(meta: GameMeta, clubId: ClubId, offers: SponsorOffer[], date: GameDate, by: SponsorContract['by'], share: number): SponsorContract[] {
    const have = [...this.contractsOf(meta, clubId)];
    const out: SponsorContract[] = [];
    for (const o of [...offers].sort((a, b) => expectedValue(b) - expectedValue(a) || a.id.localeCompare(b.id))) {
      if (slotReason(have, o)) continue;
      const c: SponsorContract = { ...o, guaranteedWon: Math.round((o.guaranteedWon * share) / 1_000_000) * 1_000_000, signed: date, by };
      have.push(c);
      out.push(c);
    }
    return out;
  }

  /** 직접 체결 검증(무료) */
  signTarget(meta: GameMeta, offerId: string): SponsorOffer {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if (!this.window(meta, meta.currentDate)) throw new GameError('NOT_AVAILABLE', '스폰서 계약은 스토브리그 12월 7일~1월 31일에 합니다.');
    const o = (meta.sponsorOffers ?? []).find((x) => x.id === offerId);
    if (!o) throw new GameError('NOT_AVAILABLE', '유효한 제안이 아닙니다.');
    const reason = slotReason(this.contractsOf(meta, meta.userClubId), o);
    if (reason) throw new GameError('SPONSOR_SLOT', reason);
    return o;
  }

  /** 직접 체결: 행동력 2, 보장액은 바로 수령. 고가 티켓 금지 의무면 가격 정책을 보통으로 돌린다 */
  sign(meta: GameMeta, weekId: string, offerId: string): string {
    const o = this.signTarget(meta, offerId);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, S.signAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(스폰서 체결 행동력 ${S.signAp}).`);
      }
      this.repo.addLedger([this.addContract(meta.userClubId, { ...o, signed: meta.currentDate, by: 'owner' })]);
      return `${o.brand}과(와) ${o.season} 시즌 ${o.slot === 'main' ? '메인' : '서브'} 스폰서 계약을 맺었습니다. 보장액 ${won(o.guaranteedWon)} 수령, 인센티브 ${won(o.incentive.bonusWon)}(${S.incentives[o.incentive.kind]}), 의무: ${S.obligations[o.obligation]}.`;
    });
  }

  /** 고가 티켓 정책을 고를 수 없는 이유(계약 시즌 중, 또는 다음 시즌 계약을 맺은 스토브리그) */
  highPriceBlock(meta: GameMeta): string | null {
    const season = meta.mode === 'season' ? meta.season : meta.season + 1;
    const c = this.contractsOf(meta, meta.userClubId).find((x) => x.season === season && x.obligation === 'noHighPrice');
    return c ? `${c.brand} 스폰서 계약에 고가 티켓 정책 금지 의무가 있습니다(${c.season} 시즌).` : null;
  }

  /** 시즌 마감 정산(모든 구단): 인센티브 지급, 의무 미달 반환, 계약 종료 */
  settleSeason(meta: GameMeta, date: GameDate): InboxMessage[] {
    const season = meta.season;
    const att = meta.attendance?.[String(season)] ?? {};
    const pct = (id: string) => {
      const t = att[id];
      return t && t.w + t.l > 0 ? t.w / (t.w + t.l) : 0;
    };
    const order = [...this.clubs.keys()].sort((a, b) => pct(String(b)) - pct(String(a)) || a - b);
    const seeds = meta.postseason?.season === season ? meta.postseason.seeds : [];
    const ledger: LedgerEntry[] = [];
    const sponsors: Record<string, SponsorContract[]> = {};
    const totals = { ...(meta.sponsorTotals?.[String(season)] ?? {}) };
    const lines: string[] = [];
    // 8e-2: 올스타 인센티브 정산 재료
    const allStar = this.repo.getAllStar(season);
    for (const club of this.clubs.values()) {
      const id = String(club.id);
      const all = this.contractsOf(meta, club.id);
      const t = att[id];
      const facts = { postseason: seeds.includes(club.id), rank: order.indexOf(club.id) + 1, occupancy: t && t.games > 0 ? t.total / (t.games * club.stadiumCapacity) : 0, satisfaction: this.business.fanOf(meta, club.id).satisfaction, campaigns: meta.campaignCounts?.[String(season)]?.[id] ?? 0, allStars: allStar?.picks.filter((p) => p.clubId === club.id).length ?? 0, mrAllstar: !!allStar?.game?.mvp.some((pid) => allStar.picks.some((p) => p.playerId === pid && p.clubId === club.id)) };
      for (const c of all.filter((x) => x.season === season)) {
        const r = settle(c, facts);
        if (r.incentiveWon) ledger.push({ clubId: club.id, date, category: 'sponsorship', amount: r.incentiveWon, memo: `${c.brand} 인센티브(${S.incentives[c.incentive.kind]})` });
        if (r.refundWon) ledger.push({ clubId: club.id, date, category: 'sponsorship', amount: -r.refundWon, memo: `${c.brand} 의무 미달 반환` });
        totals[id] = (totals[id] ?? 0) + r.incentiveWon - r.refundWon;
        if (club.id === meta.userClubId) lines.push(`· ${c.brand}(${c.slot === 'main' ? '메인' : '서브'}): 인센티브 ${r.incentiveWon ? `달성 +${won(r.incentiveWon)}` : '미달성'}${c.obligation === 'campaigns' ? ` · 캠페인 의무 ${r.refundWon ? `미달 −${won(r.refundWon)}` : '이행'}` : ''}`);
      }
      sponsors[id] = all.filter((x) => x.season !== season);
    }
    this.repo.addLedger(ledger);
    this.repo.updateMeta({ sponsors, sponsorTotals: { ...(meta.sponsorTotals ?? {}), [String(season)]: totals } });
    return lines.length ? [{ date, kind: 'report', sender: '사업제휴팀', title: `${season} 시즌 스폰서 정산`, body: `${lines.join('\n')}\n계약이 끝났습니다. 다음 시즌 제안은 12월 7일에 옵니다.` }] : [];
  }

  /** 화면용 */
  view(meta: GameMeta) {
    const label = (o: SponsorOffer) => ({
      id: o.id,
      slot: o.slot,
      brand: o.brand,
      industry: o.industry,
      tier: o.tier,
      style: S.styles[o.style].label,
      season: o.season,
      guaranteedWon: o.guaranteedWon,
      incentiveWon: o.incentive.bonusWon,
      incentive: S.incentives[o.incentive.kind],
      obligation: S.obligations[o.obligation],
    });
    const open = this.window(meta, meta.currentDate);
    return {
      signAp: S.signAp,
      open,
      note: open ? '1월 31일까지 유효 · 비운 자리는 사업제휴팀이 보장액 90%로 기본 계약' : meta.mode === 'stove' ? '제안은 12월 7일에 도착합니다.' : '다음 제안은 스토브리그 12월 7일에 도착합니다.',
      contracts: this.contractsOf(meta, meta.userClubId).map((c) => ({ ...label(c), by: c.by === 'owner' ? '구단주' : '사업제휴팀' })),
      offers: open
        ? (meta.sponsorOffers ?? []).map((o) => {
            let reason: string | null = null;
            try {
              this.signTarget(meta, o.id);
            } catch (e) {
              if (!(e instanceof GameError)) throw e;
              reason = e.message;
            }
            return { ...label(o), signReason: reason };
          })
        : [],
    };
  }
}
