// 6d 굿즈(15 문서, D-153): 제작업체 선택, 발주·입고, 홈경기·온라인 판매, 이동평균 원가, 상품팀 자동 재주문.
// 모든 구단이 같은 수요·입고·판매 규칙을 쓴다. 발주 지급과 판매 수입은 현금 장부에, 매출원가·재고는 굿즈 상태에 남긴다.
import { addDays, weekday, type GameDate } from '../engine/calendar';
import { brandsFor } from '../engine/brands';
import { ALLSTAR, MERCH as M, SPONSOR } from '../engine/config';
import { allStarWindow } from '../engine/allStar';
import { inflate, type LedgerEntry } from '../engine/finance';
import { baselineWeekly, gameDemand, newMerch, receive, reorderQty, rollWeek, sell, SKUS, unitCost, unitPrice, VENDOR_KINDS, type MerchState, type Sku, type Vendor, type VendorKind } from '../engine/merch';
import { EOK } from '../engine/money';
import { seasonKeyDates } from '../engine/schedule';
import type { ClubId, ClubProfile } from '../engine/types';
import { GameError } from '../shared/protocol';
import type { BusinessOps } from './business';
import type { Organization } from './organization';
import type { GameMeta, GameRepository, InboxMessage } from './ports';
import { NO_GUARD, type BudgetGuard } from './budget';

const won = (n: number) => (Math.abs(n) >= EOK ? `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`);
const md = (d: GameDate) => d.slice(5).replace('-', '/');

export class MerchOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly org: Organization,
    private readonly business: BusinessOps,
  ) {}

  stateOf(meta: GameMeta, clubId: ClubId): MerchState {
    const s = meta.merch?.[String(clubId)];
    return s ? (structuredClone(s) as MerchState) : newMerch(meta.season);
  }

  private inflation(meta: GameMeta, season = meta.season): number {
    return inflate(EOK, season, meta.inflationBp) / EOK;
  }

  private save(clubId: ClubId, s: MerchState) {
    const cur = this.repo.getMeta();
    this.repo.updateMeta({ merch: { ...(cur.merch ?? {}), [String(clubId)]: s } });
  }

  /** 스토브리그 업체 선택 기간(스폰서 제안 기간과 같다: 12/7~1/31) */
  private vendorWindow(meta: GameMeta): boolean {
    const k = Number(meta.kDate.slice(0, 4));
    return meta.mode === 'stove' && meta.currentDate >= `${k}-${SPONSOR.offerMonthDay}` && meta.currentDate <= `${k + 1}-${SPONSOR.defaultMonthDay}`;
  }

  /** 6e(D-177): 우리 구단 굿즈 발주 한도. 서비스가 연결한다 */
  budget: BudgetGuard = NO_GUARD;

  /** 우리 구단 자동 재주문 담당자(상품팀장, 없으면 사업본부장). AI 구단은 항상 가능 */
  private canAuto(meta: GameMeta, clubId: ClubId): boolean {
    return clubId !== meta.userClubId || this.org.teamDelegate(clubId, 'merch') !== null;
  }

  private placeOrder(meta: GameMeta, s: MerchState, clubId: ClubId, sku: Sku, qty: number, date: GameDate): LedgerEntry {
    const unitCostWon = unitCost(sku, s.vendor.kind, this.inflation(meta));
    s.orders.push({ sku, qty, unitCostWon, arrive: addDays(date, M.vendors[s.vendor.kind].leadDays) });
    return { clubId, date, category: 'merchOrder', amount: -qty * unitCostWon, memo: `${M.skus[sku].label} ${qty.toLocaleString('ko-KR')}개 발주` };
  }

  /** 매일(모든 구단): 시즌 업체 전환, 입고, 판매(홈경기·온라인), 월요일 주간 정리와 자동 재주문 */
  onDay(meta: GameMeta, date: GameDate): { ledger: LedgerEntry[]; inbox: InboxMessage[] } {
    const ledger: LedgerEntry[] = [];
    const inbox: InboxMessage[] = [];
    if (meta.mode !== 'season') return { ledger, inbox };
    const key = seasonKeyDates(meta.season);
    const selling = date >= key.opening && date <= key.regularSeasonEnd;
    const ordering = date >= addDays(key.opening, -M.firstOrderDaysBeforeOpening) && date <= key.regularSeasonEnd;
    const inflation = this.inflation(meta);
    const all: Record<string, MerchState> = {};
    const blocked: string[] = [];
    const win = allStarWindow(meta.season);
    const asRow = date >= win.from && date <= win.to ? this.repo.getAllStar(meta.season) : null;
    const allStarFactor = (clubId: number) => (asRow ? 1 + ALLSTAR.merchPerPick * asRow.picks.filter((p) => p.clubId === clubId).length : 0);
    for (const club of this.clubs.values()) {
      const s = this.stateOf(meta, club.id);
      // 새 시즌: 스토브리그에 고른 업체(없으면 국내 전문 제작사)로 바꾼다
      if (s.vendor.season !== meta.season) {
        s.vendor = s.nextVendor?.season === meta.season ? s.nextVendor : { kind: 'standard', season: meta.season };
        delete s.nextVendor;
        s.recent = [];
      }
      receive(s, date, meta.season);
      if (selling) {
        const attendance = this.business.gateToday.get(club.id);
        const sat = this.business.fanOf(meta, club.id).satisfaction;
        let revenue = 0;
        for (const sku of SKUS) {
          let demand: number;
          // 8e-2(D-190 (8)): 올스타 유니폼은 판매 기간에만, 그 구단 선정 인원에 비례
          const factor = sku === 'allstar' ? allStarFactor(club.id) : 1;
          if (factor === 0) demand = 0;
          else if (attendance !== undefined) {
            demand = Math.round(gameDemand(meta.seed, `${date}-${club.id}`, sku, attendance, s.vendor.kind, sat) * factor);
            s.lastDemand[sku] = demand;
          } else demand = Math.round(s.lastDemand[sku] * M.onlineShare);
          revenue += sell(s, sku, demand, unitPrice(sku, inflation), meta.season);
        }
        if (revenue > 0) ledger.push({ clubId: club.id, date, category: 'merchSales', amount: revenue, memo: attendance !== undefined ? '홈경기 굿즈 판매' : '온라인 굿즈 판매' });
      }
      if (weekday(date) === 1 && ordering) {
        if (selling) rollWeek(s);
        if (s.auto && this.canAuto(meta, club.id)) {
          const placed: string[] = [];
          const mine = club.id === meta.userClubId;
          // 6e(D-177 (3)): 우리 구단 자동 재주문은 굿즈 발주 한도 안까지만(오늘 넣은 발주 포함)
          let orderedToday = 0;
          for (const sku of SKUS) {
            const qty = reorderQty(s, sku, baselineWeekly(sku, club.stadiumCapacity, s.vendor.kind));
            if (qty <= 0) continue;
            const cost = qty * unitCost(sku, s.vendor.kind, inflation);
            if (mine && this.budget.spendError(meta, 'merch', orderedToday + cost)) {
              blocked.push(M.skus[sku].label);
              continue;
            }
            if (mine) orderedToday += cost;
            ledger.push(this.placeOrder(meta, s, club.id, sku, qty, date));
            placed.push(`${M.skus[sku].label} ${qty.toLocaleString('ko-KR')}개`);
          }
          if (placed.length && club.id === meta.userClubId && date < key.opening) inbox.push({ date, kind: 'report', sender: '상품팀', title: '개막 대비 굿즈 발주', body: `${placed.join(', ')}을(를) 발주했습니다(${M.vendors[s.vendor.kind].label}, 입고 ${md(addDays(date, M.vendors[s.vendor.kind].leadDays))}). 시즌 중에는 목표 재고 ${s.targetWeeks}주에 맞춰 매주 자동으로 재주문합니다.` });
        }
      }
      all[String(club.id)] = s;
    }
    this.repo.updateMeta({ merch: all });
    if (blocked.length) {
      // 한도에 닿은 첫 주에만 알린다(시즌별)
      const key = `${meta.season}:merch`;
      if (!(meta.budgetAlerts ?? []).includes(key)) {
        this.repo.updateMeta({ budgetAlerts: [...(meta.budgetAlerts ?? []).slice(-20), key] });
        inbox.push({ date, kind: 'report', sender: '상품팀', title: '굿즈 발주 예산 한도 도달', body: `${meta.season} 예산의 굿즈 발주 한도에 닿아 ${blocked.join(', ')} 자동 재주문을 멈췄습니다. 품절을 막으려면 특별 운영회의에서 한도를 늘리세요.` });
      }
    }
    return { ledger, inbox };
  }

  // ───────── 구단주 명령 ─────────

  /** 제작업체 선택 검증(무료) */
  vendorTarget(meta: GameMeta, kind: VendorKind, brandId?: string): Vendor & { feeWon: number } {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if (!VENDOR_KINDS.includes(kind)) throw new GameError('INVALID', '없는 업체 유형입니다.');
    if (!this.vendorWindow(meta)) throw new GameError('NOT_AVAILABLE', '제작업체는 스토브리그 12월 7일~1월 31일에 고릅니다.');
    const season = meta.season + 1;
    const cur = this.stateOf(meta, meta.userClubId).nextVendor;
    if (cur?.season === season) throw new GameError('DUPLICATE', `${season} 시즌 제작업체를 이미 정했습니다(${cur.brand ?? M.vendors[cur.kind].label}).`);
    if (kind !== 'brand') return { kind, season, feeWon: 0 };
    const b = brandsFor('maker').find((x) => x.id === brandId);
    if (!b) throw new GameError('INVALID', '제작 파트너가 될 수 있는 브랜드가 아닙니다.');
    return { kind, brand: b.name, season, feeWon: Math.round((M.partnerFeeWon * (M.partnerTier[b.awareness] ?? 1) * this.inflation(meta, season)) / 1_000_000) * 1_000_000 };
  }

  /** 제작업체 선택: 행동력 2. 브랜드 파트너는 후원금을 바로 받는다 */
  chooseVendor(meta: GameMeta, weekId: string, kind: VendorKind, brandId?: string): string {
    const v = this.vendorTarget(meta, kind, brandId);
    return this.repo.transaction(() => {
      try {
        this.repo.spendAp(weekId, M.vendorAp);
      } catch {
        throw new GameError('AP_SHORT', `이번 주 행동력이 부족합니다(제작업체 선택 행동력 ${M.vendorAp}).`);
      }
      const s = this.stateOf(this.repo.getMeta(), meta.userClubId);
      s.nextVendor = { kind: v.kind, season: v.season, ...(v.brand ? { brand: v.brand } : {}) };
      this.save(meta.userClubId, s);
      if (v.feeWon > 0) this.repo.addLedger([{ clubId: meta.userClubId, date: meta.currentDate, category: 'merchPartner', amount: v.feeWon, memo: `${v.brand} 제작 파트너 후원금(${v.season})` }]);
      const def = M.vendors[kind];
      return `${v.season} 시즌 제작업체: ${v.brand ? `${v.brand}(${def.label})` : def.label}. 원가율 ${Math.round(def.costRate * 100)}%, 공급 ${def.leadDays / 7}주${v.feeWon ? `, 후원금 ${won(v.feeWon)} 수령` : ''}.`;
    });
  }

  /** 수동 발주(행동력 0): 지급은 지금, 입고는 공급 기간 뒤 */
  order(meta: GameMeta, sku: Sku, qty: number): string {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if (!SKUS.includes(sku)) throw new GameError('INVALID', '없는 상품입니다.');
    if (meta.mode !== 'season') throw new GameError('NOT_AVAILABLE', '발주는 시즌 모드(2월~)에 합니다.');
    const s = this.stateOf(meta, meta.userClubId);
    if (s.vendor.season !== meta.season) throw new GameError('NOT_AVAILABLE', '새 시즌 업체가 적용되는 내일부터 발주할 수 있습니다.');
    const min = M.vendors[s.vendor.kind].minOrder[sku];
    if (!Number.isInteger(qty) || qty < min || qty > M.maxManualOrder) throw new GameError('INVALID', `발주 수량은 ${min.toLocaleString('ko-KR')}~${M.maxManualOrder.toLocaleString('ko-KR')}개입니다(${M.vendors[s.vendor.kind].label} 최소 발주량).`);
    const cost = qty * unitCost(sku, s.vendor.kind, this.inflation(meta));
    if (this.repo.cashBalance(meta.userClubId) < cost) throw new GameError('CASH_SHORT', `현금이 부족합니다. 발주 금액 ${won(cost)}.`);
    const over = this.budget.spendError(meta, 'merch', cost);
    if (over) throw new GameError('BUDGET_OVER', over);
    return this.repo.transaction(() => {
      const entry = this.placeOrder(meta, s, meta.userClubId, sku, qty, meta.currentDate);
      this.save(meta.userClubId, s);
      this.repo.addLedger([entry]);
      return `${M.skus[sku].label} ${qty.toLocaleString('ko-KR')}개를 발주했습니다. ${won(cost)} 지급, ${md(s.orders[s.orders.length - 1]!.arrive)} 입고 예정.`;
    });
  }

  /** 자동 재주문 정책(행동력 0) */
  setPolicy(meta: GameMeta, auto: boolean, targetWeeks: number): string {
    if (meta.gameOver) throw new GameError('GAME_OVER', '종료된 게임입니다.');
    if (typeof auto !== 'boolean' || !Number.isInteger(targetWeeks) || targetWeeks < M.targetWeeksMin || targetWeeks > M.targetWeeksMax) throw new GameError('INVALID', `목표 재고는 ${M.targetWeeksMin}~${M.targetWeeksMax}주입니다.`);
    const s = this.stateOf(meta, meta.userClubId);
    s.auto = auto;
    s.targetWeeks = targetWeeks;
    this.save(meta.userClubId, s);
    return `굿즈 재주문: ${auto ? `상품팀 자동(목표 재고 ${targetWeeks}주)` : '수동 발주만'}.`;
  }

  /** 화면용 */
  view(meta: GameMeta) {
    const s = this.stateOf(meta, meta.userClubId);
    const inflation = this.inflation(meta);
    const t = s.totals[String(meta.season)];
    const vendorLabel = (v: Vendor) => (v.brand ? `${v.brand} (${M.vendors[v.kind].label})` : M.vendors[v.kind].label);
    const window = this.vendorWindow(meta);
    const reasonOf = (kind: VendorKind, brandId?: string) => {
      try {
        this.vendorTarget(meta, kind, brandId);
        return null;
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
        return e.message;
      }
    };
    const nextInflation = this.inflation(meta, meta.season + 1);
    return {
      vendor: vendorLabel(s.vendor),
      vendorSeason: s.vendor.season,
      nextVendor: s.nextVendor ? vendorLabel(s.nextVendor) : null,
      vendorAp: M.vendorAp,
      vendorOptions: [
        ...(['budget', 'standard'] as const).map((kind) => ({ kind: kind as VendorKind, brandId: null as string | null, label: M.vendors[kind].label, costPct: Math.round(M.vendors[kind].costRate * 100), demandNote: kind === 'budget' ? '수요 ×0.85' : '수요 ×1.0', leadWeeks: M.vendors[kind].leadDays / 7, feeWon: 0, reason: reasonOf(kind) })),
        ...brandsFor('maker').map((b) => ({ kind: 'brand' as VendorKind, brandId: b.id as string | null, label: `${b.name} (${M.vendors.brand.label})`, costPct: Math.round(M.vendors.brand.costRate * 100), demandNote: '유니폼 수요 ×1.3', leadWeeks: M.vendors.brand.leadDays / 7, feeWon: Math.round((M.partnerFeeWon * (M.partnerTier[b.awareness] ?? 1) * nextInflation) / 1_000_000) * 1_000_000, reason: reasonOf('brand', b.id) })),
      ],
      vendorOpen: window,
      auto: s.auto,
      autoAvailable: this.canAuto(meta, meta.userClubId),
      targetWeeks: s.targetWeeks,
      targetWeeksRange: [M.targetWeeksMin, M.targetWeeksMax] as [number, number],
      canOrder: meta.mode === 'season' && s.vendor.season === meta.season,
      skus: SKUS.map((sku) => {
        const onOrder = s.orders.filter((o) => o.sku === sku);
        const x = t?.[sku];
        return {
          sku,
          label: M.skus[sku].label,
          priceWon: unitPrice(sku, inflation),
          unitCostWon: unitCost(sku, s.vendor.kind, inflation),
          minOrder: M.vendors[s.vendor.kind].minOrder[sku],
          stock: s.stock[sku].qty,
          avgCostWon: s.stock[sku].avgCostWon,
          onOrder: onOrder.reduce((a, o) => a + o.qty, 0),
          nextArrival: onOrder.map((o) => o.arrive).sort()[0] ?? null,
          sold: x?.sold ?? 0,
          revenueWon: x?.revenueWon ?? 0,
          cogsWon: x?.cogsWon ?? 0,
          lastWeekSold: s.recent[s.recent.length - 1]?.[sku] ?? 0,
          note: sku === 'allstar' ? `판매 기간 ${allStarWindow(meta.season).from.slice(5)}~${allStarWindow(meta.season).to.slice(5)}(올스타전 ±${ALLSTAR.merchWindowDays}일), 자동 재주문 없음` : null,
        };
      }),
      inventoryWon: SKUS.reduce((a, sku) => a + s.stock[sku].qty * s.stock[sku].avgCostWon, 0),
      season: meta.season,
    };
  }

  /** 검증용: 그 시즌 리그 합계 */
  leagueTotals(meta: GameMeta, season: number) {
    let revenue = 0;
    let cogs = 0;
    let sold = 0;
    let stock = 0;
    for (const club of this.clubs.values()) {
      const s = meta.merch?.[String(club.id)];
      if (!s) continue;
      const t = s.totals[String(season)];
      for (const sku of SKUS) {
        revenue += t?.[sku].revenueWon ?? 0;
        cogs += t?.[sku].cogsWon ?? 0;
        sold += t?.[sku].sold ?? 0;
        stock += s.stock[sku].qty;
      }
    }
    return { revenue, cogs, sold, stock };
  }

}
