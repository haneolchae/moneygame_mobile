// 4c-2b 감독 능력치·신뢰도·AI 구단 감독 교체(03·10a 11장·19 문서, D-162·D-163·D-166·D-172).
// 경기 계산에 쓸 감독 프로필을 만들고, 경기 결과의 감독 결정으로 신뢰도를 갱신하며, 시즌 마감 때 되돌림·AI 감독 교체를 한다.
import type { GameDate } from '../engine/calendar';
import { MANAGER as M } from '../engine/config';
import type { GameResult } from '../engine/gamesim';
import { conditionFactor, developmentFactor, MANAGER_KEYS, NEUTRAL_MANAGER, nextTrust, regressTrust, type ManagerProfile } from '../engine/manager';
import { Rng } from '../engine/rng';
import { makeStaff, observedAbility, type ManagerState, type StaffMember } from '../engine/staff';
import type { ClubId, ClubProfile } from '../engine/types';
import type { GameMeta, GameRepository, InboxMessage } from './ports';
import type { SeasonClose } from './seasonClose';

export const newManagerState = (rng: Rng): ManagerState => ({ smallBall: rng.int(0, 100), quickHook: rng.int(0, 100), trust: M.trust.start, baseOff: 0, baseDef: 0, recent: [] });

export class ManagerOps {
  private cache: Map<ClubId, ManagerProfile> | null = null;

  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly seasonClose: SeasonClose,
  ) {}

  /** 하루 처리 시작·직원 변경 뒤 프로필 캐시를 버린다 */
  reset(): void {
    this.cache = null;
  }

  managerOf(clubId: ClubId): StaffMember | null {
    return this.repo.getStaff(clubId).find((s) => s.title === '감독') ?? null;
  }

  private build(): Map<ClubId, ManagerProfile> {
    const out = new Map<ClubId, ManagerProfile>();
    for (const s of this.repo.getStaff().filter((x) => x.title === '감독' && x.clubId !== null)) {
      const ratings = { ...NEUTRAL_MANAGER.ratings };
      for (const k of MANAGER_KEYS) ratings[k] = s.abilities[k] ?? 50;
      out.set(s.clubId!, { ratings, smallBall: s.manager?.smallBall ?? 50, quickHook: s.manager?.quickHook ?? 50, trust: s.manager?.trust ?? M.trust.start });
    }
    return out;
  }

  /** 경기 계산용 감독 프로필(감독이 없으면 평균 감독 — 수석코치 대행은 후속) */
  profileOf(clubId: ClubId): ManagerProfile {
    this.cache ??= this.build();
    return this.cache.get(clubId) ?? NEUTRAL_MANAGER;
  }

  conditionFactor = (clubId: ClubId) => conditionFactor(this.profileOf(clubId));
  developmentFactor = (clubId: ClubId) => developmentFactor(this.profileOf(clubId));

  /** 경기 뒤 신뢰도 갱신(D-163): 결정 점수 = 그 결정 타석의 승리 확률 변화 − 팀 기준선. 기준선은 경기의 타석 변화로 갱신 */
  afterGames(date: GameDate, results: GameResult[]): void {
    if (!results.length) return;
    const changed = new Map<number, StaffMember>();
    const a = 1 - Math.pow(0.5, 1 / M.trust.baselineHalfLife);
    for (const r of results) {
      for (const track of r.wpTrack ?? []) {
        const s = changed.get(track.clubId) ?? this.managerOf(track.clubId);
        if (!s) continue;
        const st = s.manager ?? { smallBall: 50, quickHook: 50, trust: M.trust.start, baseOff: 0, baseDef: 0, recent: [] };
        for (const d of (r.managerDecisions ?? []).filter((x) => x.clubId === track.clubId)) {
          const delta = d.wpAfter - d.wpBefore;
          const base = d.side === 'off' ? st.baseOff : st.baseDef;
          st.trust = nextTrust(st.trust, delta, base);
          st.recent = [...st.recent, { date, side: d.side, kinds: d.kinds, inning: d.inning, delta: Math.round(delta * 1000) / 1000, score: Math.round((delta - base) * 1000) / 1000 }].slice(-M.trust.recentMax);
        }
        // 기준선: 이 경기 타석 변화 평균을 타석 수만큼 반영(지수이동평균)
        if (track.offN) st.baseOff += (1 - Math.pow(1 - a, track.offN)) * (track.offSum / track.offN - st.baseOff);
        if (track.defN) st.baseDef += (1 - Math.pow(1 - a, track.defN)) * (track.defSum / track.defN - st.baseDef);
        s.manager = st;
        changed.set(track.clubId, s);
      }
    }
    if (changed.size) this.repo.saveStaff([...changed.values()]);
    this.reset();
  }

  /**
   * 시즌 마감(D-163·D-166): 모든 감독 신뢰도를 50 쪽으로 절반 되돌리고, AI 구단 감독을 교체·재계약한다.
   * 교체: 예상 순위 기준 성적 목표 2시즌 연속 미달 또는 신뢰도 30 미만, 계약이 끝났고 신뢰도 50 미만.
   */
  closeSeason(meta: GameMeta, date: GameDate): InboxMessage[] {
    const inbox: InboxMessage[] = [];
    const season = meta.season;
    const standings = this.repo.getSeasonStandings(season);
    const misses = { ...(meta.aiGoalMisses ?? {}) };
    const saved: StaffMember[] = [];
    const rng = Rng.derive(meta.seed, 'manager-replace', season);
    let market = this.repo.getStaff(null).filter((s) => s.title === '감독');
    let nextId = this.repo.nextStaffId();
    for (const club of [...this.clubs.values()].sort((x, y) => x.id - y.id)) {
      const m = this.managerOf(club.id);
      if (!m) continue;
      const st = m.manager ?? newManagerState(rng);
      const trustBefore = st.trust;
      st.trust = regressTrust(st.trust);
      m.manager = st;
      if (club.id === meta.userClubId) {
        saved.push(m);
        continue;
      }
      const rank = standings.find((s) => s.clubId === club.id)?.rank;
      const expected = this.seasonClose.expectedRank(meta, club.id, season);
      const key = String(club.id);
      misses[key] = rank !== undefined && rank > expected ? (misses[key] ?? 0) + 1 : 0;
      m.contractYears = Math.max(0, m.contractYears - 1);
      const R = M.replace;
      const fire = misses[key]! >= R.missSeasons || trustBefore < R.trustBelow || (m.contractYears === 0 && trustBefore < R.renewAtLeast);
      if (!fire) {
        if (m.contractYears === 0) m.contractYears = rng.int(1, 3);
        saved.push(m);
        continue;
      }
      // 새 감독: 그 구단이 아는 평판(추정) 합이 가장 높은 후보. 리빌딩·긴축은 육성, 우승 경쟁은 작전·투수 운용에 가중
      const stance = meta.clubStance?.[key]?.stance;
      const weight = (k: string) => ((stance === 'rebuild' || stance === 'austerity') && k === 'development' ? 2 : stance === 'contend' && (k === 'tactics' || k === 'pitching') ? 1.5 : 1);
      const score = (c: StaffMember) => MANAGER_KEYS.reduce((a, k) => a + weight(k) * observedAbility(meta.seed, c, k, false), 0);
      market = market.sort((x, y) => score(y) - score(x) || x.id - y.id);
      let next = market[0];
      if (next) market = market.slice(1);
      else next = makeStaff(rng, nextId++, '감독', null, { part: '감독', mean: M.candidateMean, year: season });
      const reason = misses[key]! >= R.missSeasons ? `성적 목표 ${R.missSeasons}시즌 연속 미달` : trustBefore < R.trustBelow ? `감독 신뢰도 ${Math.round(trustBefore)}` : '계약 만료';
      m.clubId = null;
      m.manager = { ...st, trust: M.trust.start, recent: [] };
      next.clubId = club.id;
      next.contractYears = rng.int(1, 3);
      next.manager = { ...(next.manager ?? newManagerState(rng)), trust: M.trust.start, baseOff: 0, baseDef: 0, recent: [] };
      misses[key] = 0;
      saved.push(m, next);
      inbox.push({ date, kind: 'news', sender: 'KBO 소식', title: `${club.shortName} 감독 교체`, body: `${club.name}이(가) ${m.name} 감독과 결별하고 ${next.name} 감독을 선임했습니다(${reason}).` });
    }
    this.repo.saveStaff(saved);
    this.repo.updateMeta({ aiGoalMisses: misses });
    this.reset();
    return inbox;
  }
}
