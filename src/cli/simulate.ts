// 헤드리스 장기 실행: 화면 없이 같은 엔진·저장 계층으로 여러 시즌을 돌리고 성능과 일관성을 측정한다.
// 사용: npm run sim -- --seasons 10 --seed abc [--max-stall 10]
// 첫 해는 스토브리그(2026-11-08)부터 1주씩 진행해 시즌 모드로 넘어간 뒤 정규시즌을 치른다.
// 한국시리즈 뒤에는 시즌 마감 → 스토브리그를 주 단위로 지나 다음 시즌으로 간다(D-085).
// 우리 구단은 운영·경영지원팀을 완전 위임으로 두고 돌린다. 사람 대신 내리는 결정은 없고, 게임 규칙(위임·의무 안건 D-095)만 쓴다.
// 진행 요청이 0일 진행으로 끝나는 일이 연속 --max-stall회(기본 10, verify BUDGET.stallAdvances, D-096)면 즉시 실패로 끝낸다.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PROBABILITY_CONFIG } from '../engine/probabilityConfig';
import { CLOSE_RULES } from '../game/seasonClose';
import { Dispatcher } from '../host/dispatcher';
import type { GameService } from '../game/service';
import { coreAverage } from '../engine/development';
import { checkForeignQuota, checkInvariants, injuryStats, checkRegularSeasons, checkRosterComposition, checkRosterLimits } from '../host/invariants';
import type { AdvanceResult, BudgetPlanInput, BudgetView, DashboardView, DelegationPolicyView, BusinessView, OrganizationView, PlayerActionsView, PlayerListItem, RosterView, StandingView, TradeOffersView, TradeResultView, TradeView } from '../shared/protocol';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

async function main() {
  const seasons = Number(arg('seasons', '3'));
  const seed = arg('seed', 'sim-seed');
  const maxStall = Number(arg('max-stall', '10'));
  // --keep-dir: 지정한 폴더에서 돌리고 지우지 않는다. 시즌마다 정규시즌 끝 상태를 슬롯 s<시즌>으로 남긴다(원인 조사용)
  const keepDir = arg('keep-dir', '');
  const baseDir = keepDir || mkdtempSync(join(tmpdir(), 'fo-sim-'));
  const d = new Dispatcher({ baseDir, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: 'CLI' }, appVersion: 'cli' }) });
  const call = async <T>(name: string, payload?: unknown): Promise<T> => {
    const r = await d.respond(name as never, payload as never);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.result as T;
  };
  const rows: Array<Record<string, unknown>> = [];
  // 7c·9a(D-239) 장기 관측: 직전 시즌 누적값과 10시즌 판정 요약
  const obsPrev = { retired: 0, maxId: 0 };
  let summaryObs: Record<string, unknown> | null = null;
  const svc = () => (d as unknown as { game(): GameService }).game();
  // 진행 정체 감시: 0일 진행이 연속 maxStall회면 원인(멈춘 이유·날짜)을 출력하고 실패로 끝낸다.
  let stall = 0;
  const advance = async (mode: 'day' | 'week' | 'untilSeasonEnd' | 'turn') => {
    const r = await call<AdvanceResult>('game.advance', { mode, autoCards: true });
    stall = r.daysProcessed === 0 ? stall + 1 : 0;
    if (stall >= maxStall) {
      const dash = await call<DashboardView>('game.dashboard');
      console.log(JSON.stringify({ stalled: true, consecutiveZeroDayAdvances: stall, mode, date: dash.date, phase: dash.phase, reason: r.stoppedReason }));
      d.close();
      process.exit(2);
    }
    return r;
  };
  async function dailyChecked(): Promise<AdvanceResult> {
    let total: AdvanceResult | null = null;
    let prev = new Map<number, string>();
    for (;;) {
      // --save-at <날짜>: 그 날짜를 처리하기 직전 상태를 슬롯 'at'에 남긴다(--keep-dir와 함께, 원인 조사용)
      if (arg('save-at', '') && d.saves.repository().getMeta().currentDate === arg('save-at', '')) await call('save.save', { slot: 'at' });
      const r = await advance('day');
      total = total ? { ...r, daysProcessed: total.daysProcessed + r.daysProcessed, gamesPlayed: total.gamesPlayed + r.gamesPlayed } : r;
      const repo = d.saves.repository();
      const date = repo.getMeta().currentDate;
      const now = new Map(repo.getPlayers().filter((p) => p.clubId !== null && !p.retired).map((p) => [p.id, `${p.clubId}:${p.level}`]));
      const counts = new Map<number, number>();
      for (const p of repo.getPlayers()) if (p.clubId !== null && !p.retired && p.level === '1군') counts.set(p.clubId, (counts.get(p.clubId) ?? 0) + 1);
      const bad = [...counts].filter(([, n]) => n !== 26);
      if (bad.length) {
        const diff = [...now].filter(([id, v]) => prev.get(id) !== v).map(([id, v]) => `${id} ${prev.get(id) ?? '-'}→${v}`);
        console.log(JSON.stringify({ dailyActive: date, bad, diff: diff.slice(0, 20), reason: r.stoppedReason }));
      }
      prev = now;
      if ((await call<DashboardView>('game.dashboard')).phase === 'postseason' || r.daysProcessed === 0) return total;
    }
  }
  const tNew = performance.now();
  await call<DashboardView>('game.new', { clubId: 1, saveName: '장기 실행', seed });
  const newGameMs = Math.round(performance.now() - tNew);
  // ①(D-214·D-215): 새 게임은 첫 스토브리그를 자동 실행하고 2027-02-01 캠프에서 시작한다
  const startDate = (await call<DashboardView>('game.dashboard')).date;
  // 우리 구단: 위임 가능한 팀을 완전 위임으로 둔다(정책 한도는 기본값).
  const org = await call<OrganizationView>('org.view');
  for (const p of org.policies.filter((x) => x.team === 'ops' || x.team === 'admin')) await call('org.setPolicy', { ...p, mode: 'auto' } satisfies DelegationPolicyView);

  // 6c(D-149): 스토브리그 제안 기간에 주마다 스폰서 1건을 직접 체결한다(보장액이 큰 제안부터). 남은 자리는 1/31 기본 계약이 채운다.
  const trySponsor = async () => {
    const bv = await call<BusinessView>('business.view');
    const pick = bv.sponsors.offers.filter((o) => !o.signReason).sort((a, b) => b.guaranteedWon - a.guaranteedWon)[0];
    if (!pick) return;
    try {
      await call('business.signSponsor', { offerId: pick.id });
    } catch {
      // 행동력 부족 등 규칙상 거부
    }
  };
  // 6e(D-176 (2)·D-177): 위임 구단주도 스토브리그에 다음 시즌 예산안을 정한다(스카우트 1.25·2군 1.5·선수단 1.25배, 한도는 기본).
  // 시즌 중에는 특별 운영회의를 한 번 열고 굿즈 발주 한도를 25% 늘린다. 규칙상 거부(행동력 등)는 다음 주에 다시 한다.
  let budgetYear = 0;
  const budgetStats = { planned: 0, meetings: 0 };
  const tryBudget = async () => {
    const bv = await call<BudgetView>('budget.view');
    if (!bv.planning || budgetYear === bv.planning.year) return;
    const caps = Object.fromEntries(bv.planning.caps.map((c) => [c.kind, c.limitWon])) as BudgetPlanInput['caps'];
    try {
      await call('budget.set', { year: bv.planning.year, ops: { scouting: 1.25, futures: 1.5, teamOps: 1.25 }, caps });
      budgetYear = bv.planning.year;
      budgetStats.planned++;
    } catch {
      // 행동력 부족 등
    }
  };
  const tryMeeting = async () => {
    try {
      const r = await call<{ view: BudgetView }>('meeting.convene');
      const cur = r.view.current;
      const caps = Object.fromEntries(cur.caps.map((c) => [c.kind, c.limitWon])) as BudgetPlanInput['caps'];
      const ops = Object.fromEntries(cur.ops.map((o) => [o.kind, o.multiplier])) as BudgetPlanInput['ops'];
      await call('budget.set', { year: cur.year, ops, caps: { ...caps, merch: Math.round((caps.merch * 1.25) / 1e8) * 1e8 } });
      budgetStats.meetings++;
    } catch {
      // 행동력 부족, 이미 연 주 등
    }
  };
  // 7b(D-157·D-158 ④): 위임 구단주도 시즌(스토브리그 + 시즌)마다 받은 트레이드 제안 1건을 수락해 본다. 나머지는 기한까지 둔다.
  let offerAccepted = false;
  const offerStats = { tried: 0, done: 0 };
  const tryOffer = async () => {
    if (offerAccepted) return;
    const ov = await call<TradeOffersView>('trade.offers');
    const o = ov.offers[0];
    if (!o) return;
    offerStats.tried++;
    try {
      const r = await call<{ result: string }>('trade.respondOffer', { offerId: o.id, accept: true, commandId: `sim-offer-${o.id}` });
      offerAccepted = true;
      if (r.result === 'accept') offerStats.done++;
    } catch {
      // 행동력 부족 등 규칙상 거부
    }
  };
  const tStove = performance.now();
  // 두 번째 이후 스토브리그 턴 수 기록(시즌 번호를 턴마다 하나씩)
  const stoveTurns: number[] = [];
  let stoveWeeks = 0;
  while ((await call<DashboardView>('game.dashboard')).phase === 'stove') {
    await trySponsor();
    await tryOffer();
    await advance('week');
    stoveWeeks++;
  }
  const stoveMs = Math.round(performance.now() - tStove);
  const afterStove = await call<DashboardView>('game.dashboard');
  console.log(JSON.stringify({ stoveWeeks, stoveMs, date: afterStove.date, cashAfterStove: afterStove.cashWon }));

  let firstCoreMean: number | undefined;
  const tradeStats: Array<{ season: number; attempts: number; done: number }> = [];
  let aiTradesBefore = 0;
  let offersBefore = 0;
  let extensions = 0;
  let prevCore = new Map<number, number>();
  for (let s = 1; s <= seasons; s++) {
    // 두 번째 시즌부터: 한국시리즈 뒤 스토브리그를 주 단위로 지나 다음 시즌으로 간다(D-085).
    // 스토브리그를 지난 직후: 모든 구단 40인 한도(우리 구단은 의무 안건, AI는 같은 정리 규칙)
    const stoveErrors: string[] = [];
    // 위임 구단주의 판단(D-110): 최후통첩(성적 목표 2시즌 연속 미달)을 받으면 실제 플레이어처럼 리빌딩을 선언한다.
    // 규칙(2시즌 유예, 5시즌에 한 번, 행동력 소모)은 게임 쪽이 그대로 검사한다. 선언할 수 없으면 그대로 진행한다.
    let rebuildTried = false;
    if (s > 1)
      while (true) {
        const sd = await call<DashboardView>('game.dashboard');
        if (sd.phase !== 'stove') break;
        if (!rebuildTried && sd.goal.misses >= CLOSE_RULES.warnAfterMisses) {
          try {
            const r = await call<{ message: string }>('owner.rebuild');
            rebuildTried = true;
            console.log(JSON.stringify({ rebuild: r.message, date: sd.date }));
          } catch (e) {
            // 행동력 부족이면 다음 주에 다시, 그 밖(쿨다운 등)이면 포기
            if (!String((e as Error).message).includes('행동력')) rebuildTried = true;
          }
        }
        await trySponsor();
        await tryOffer();
        await tryBudget();
        // D-216: 스토브리그는 턴 단위로 진행한다
        await advance('turn');
        stoveTurns.push(s);
      }
    stoveErrors.push(...[...checkRosterLimits(d.saves.repository()), ...checkRosterComposition(d.saves.repository()), ...checkForeignQuota(d.saves.repository())].map((e) => `스토브리그 후 ${e}`));
    // 2d(D-120): 위임 구단주도 캠프 중 감독 추천을 수동 계획으로 저장하고, 계획의 지명타자를 2군 타자와 바꿔
    // 수동 경기 운영·계획 보정 경로를 시즌 내내 함께 검사한다(규칙 판정은 게임 쪽 명령이 한다).
    try {
      const rv = await call<RosterView>('roster.view');
      if (rv.editable && rv.recommended) {
        await call('roster.setPlan', { mode: 'manual', plan: rv.recommended });
        // 포수 최소 인원(2명) 규칙에 걸리지 않도록 포수가 아닌 계획 타자를 고른다(지명타자 우선).
        const isC = (id: number) => rv.players.find((p) => p.id === id)?.position === 'C';
        const lineup = [...rv.recommended.lineup].sort((a, b) => Number(b.position === 'DH') - Number(a.position === 'DH'));
        const dh = lineup.find((x) => !isC(x.playerId))?.playerId;
        const up = rv.players.find((p) => p.level !== '1군' && !p.isPitcher && p.position !== 'C');
        if (dh && up) await call('roster.move', { promote: [up.id], demote: [dh] });
      }
    } catch (e) {
      stoveErrors.push(`개막 준비 편성 실패: ${(e as Error).message}`);
    }
    // 4b-2(D-128·D-129 ②): 우리 구단 집중 훈련 — 계획 없는 젊은 선수는 육성팀에 맡기고, 2명은 직접 높은 강도로 지시한다.
    // 처리량·행동력 부족 등 규칙상 거부는 게임 쪽 판단이므로 건너뛴다.
    {
      const mine = [...(await call<PlayerListItem[]>('game.players', { scope: 'mine', group: 'hitters', sortKey: 'age', sortDesc: false })), ...(await call<PlayerListItem[]>('game.players', { scope: 'mine', group: 'pitchers', sortKey: 'age', sortDesc: false }))].sort((a, b) => a.age - b.age || a.id - b.id);
      let delegated = 0;
      let direct = 0;
      for (const p of mine.slice(0, 8)) {
        const av = await call<PlayerActionsView>('player.actions', { playerId: p.id });
        if (!av.training || av.training.plan) continue;
        try {
          if (direct < 2) {
            const keys = av.training.keys.map((k) => k.key);
            await call('player.train', { playerId: p.id, primary: keys[0], secondary: keys[1] ?? null, intensity: 'high' });
            direct++;
          } else {
            await call('player.trainDelegate', { playerId: p.id });
            delegated++;
          }
        } catch {
          // 규칙상 거부(행동력·처리량 부족, 부상 등)
        }
      }
      console.log(JSON.stringify({ training: { direct, delegated } }));
    }
    // 6a(D-141·D-142): 위임 구단주도 AI 구단과 같은 규칙(투자 뒤 현금 ≥ 시작 현금 × 0.9)으로 시설에 투자한다. 행동력 3은 게임 쪽이 차감한다.
    {
      let started = 0;
      for (let guard = 0; guard < 2; guard++) {
        const bv = await call<BusinessView>('business.view');
        const pick = bv.facilities.filter((f) => f.next && !f.startReason).sort((a, b) => a.level - b.level)[0];
        if (!pick || bv.cashWon - bv.committedWon - pick.next!.costWon < bv.startCashWon * 0.9) break;
        try {
          await call('business.startFacility', { kind: pick.kind });
          started++;
        } catch {
          break; // 행동력 부족 등 규칙상 거부
        }
      }
      console.log(JSON.stringify({ facilities: { started } }));
    }
    // 6b(D-147): 다음 주(새 행동력)에 캠페인 1건을 실행한다. 규칙상 거부는 건너뛴다. 트레이드 시도도 이 주의 행동력으로 한다.
    await advance('week');
    try {
      await call('business.startCampaign', { kind: 'online' });
    } catch {
      // 행동력·현금 부족, 종료된 게임 등
    }
    await tryMeeting();
    // 5a·5b(D-132 ⑤·D-137 ③): 위임 구단주도 시즌마다 트레이드를 시도한다. 상대 선택·제안은 게임 명령으로만 하고
    // 규칙 판정(기간·자격·선수단·현금·AI 응답)은 게임 쪽이 한다. 역제안은 받아들인다. 계약 마지막 해 선수 1명은 요구 조건으로 연장을 시도한다.
    {
      let attempts = 0;
      let done = 0;
      for (const clubId of [2 + ((s * 3) % 9), 2 + ((s * 7) % 9)]) {
        const tv = await call<TradeView>('trade.view', { clubId });
        if (tv.windowReason) break;
        const ours = tv.ours.filter((r) => r.tradable && r.item.level === '2군').sort((a, b) => b.item.salaryWon - a.item.salaryWon || a.item.id - b.item.id);
        const theirs = tv.theirs.filter((r) => r.tradable && r.item.level === '2군').sort((a, b) => a.item.salaryWon - b.item.salaryWon || a.item.id - b.item.id);
        for (let i = 0; i < Math.min(3, ours.length, theirs.length); i++) {
          const give = ours[i]!.item;
          const get = theirs.find((t) => t.item.isPitcher === give.isPitcher)?.item ?? theirs[i]!.item;
          attempts++;
          try {
            const r = await call<TradeResultView>('trade.propose', { clubId, give: [give.id], get: [get.id], cashWon: 0, commandId: `sim-${s}-${clubId}-${i}` });
            if (r.result === 'counter') {
              const c = await call<TradeResultView>('trade.acceptCounter', { clubId, commandId: `sim-${s}-${clubId}-${i}-c` });
              if (c.result === 'accept') done++;
            } else if (r.result === 'accept') done++;
            if (r.result !== 'reject') break;
          } catch {
            // 규칙상 거부(행동력·선수단·현금 등)
          }
        }
      }
      tradeStats.push({ season: s, attempts, done });
      const mineNow = await call<PlayerListItem[]>('game.players', { scope: 'mine', group: 'all', sortKey: 'salary', sortDesc: true });
      const last = mineNow.find((p) => p.contractYears === 0 && !p.faEligible && p.age <= 33);
      if (last) {
        const av = await call<PlayerActionsView>('player.actions', { playerId: last.id });
        if (av.extension) {
          try {
            const d0 = av.extension.demand;
            const r = await call<{ result: string }>('market.extensionOffer', { playerId: last.id, years: d0.years, salaryWon: d0.salaryWon, bonusWon: d0.bonusWon });
            if (r.result === 'accept') extensions++;
          } catch {
            // 규칙상 거부
          }
        }
      }
      console.log(JSON.stringify({ trades: { attempts, done }, extensions }));
    }
    const t0 = performance.now();
    // --check-daily: 정규시즌을 하루씩 진행하며 모든 구단 1군 인원을 매일 확인한다(원인 조사용, 결과는 같다)
    const adv = process.argv.includes('--check-daily') ? await dailyChecked() : await advance('untilSeasonEnd');
    const simMs = performance.now() - t0;
    const dash = await call<DashboardView>('game.dashboard');
    const q0 = performance.now();
    const hitters = await call<PlayerListItem[]>('game.players', { scope: 'all', group: 'hitters', sortKey: 'OPS', sortDesc: true });
    const q1 = performance.now();
    await call<PlayerListItem[]>('game.players', { scope: 'all', group: 'pitchers', sortKey: 'ERA' });
    const q2 = performance.now();
    const standings = await call<StandingView[]>('game.standings');
    const q3 = performance.now();
    const firstFixture = (await call<Array<{ fixtureId: number; played: boolean }>>('game.schedule', {})).find((f) => f.played);
    if (firstFixture) await call('game.boxScore', { fixtureId: firstFixture.fixtureId });
    const q4 = performance.now();
    const t5 = performance.now();
    await call('save.save', { slot: 'longrun' });
    const saveMs = performance.now() - t5;
    if (keepDir) await call('save.save', { slot: `s${dash.season}` });
    const inv = [...stoveErrors, ...checkInvariants(d.saves.repository(), dash.season)];
    // 정규시즌 경기 수는 시즌 ID별 기록에서 읽는다.
    const regular = dash.lastRegularSeason;
    // 그 시즌 리그 목표(D-100): 기준값 × (1 + 시즌 편차)
    const env = d.saves.repository().getMeta().leagueEnvironment?.[String(dash.season)] ?? { runs: 0, hr: 0 };
    const lg = hitters.reduce(
      (acc, h) => {
        acc.pa += Number(h.stats.PA ?? 0);
        acc.hr += Number(h.stats.HR ?? 0);
        return acc;
      },
      { pa: 0, hr: 0 },
    );
    // 4a 사전 등록 기준 ②·③(D-124): 구단 소속 선수 핵심 능력 평균의 10시즌 이동, 1년 변화 95% 분위수
    const rostered = d.saves.repository().getPlayers().filter((p) => p.clubId !== null && !p.retired);
    const core = new Map(rostered.map((p) => [p.id, coreAverage(p)]));
    const coreMean = +([...core.values()].reduce((a, v) => a + v, 0) / Math.max(1, core.size)).toFixed(2);
    firstCoreMean ??= coreMean;
    const yearly = [...core.entries()].filter(([id]) => prevCore.has(id)).map(([id, v]) => Math.abs(v - prevCore.get(id)!)).sort((a, b) => a - b);
    const coreP95 = yearly.length ? +yearly[Math.floor(0.95 * (yearly.length - 1))]!.toFixed(2) : null;
    prevCore = core;
    const devErrors: string[] = [];
    if (Math.abs(coreMean - firstCoreMean) > 3) devErrors.push(`사전 등록 ② 위반: 핵심 능력 평균 ${firstCoreMean} → ${coreMean}`);
    if (coreP95 !== null && coreP95 > 6) devErrors.push(`사전 등록 ③ 위반: 1년 변화 95% 분위수 ${coreP95}`);
    inv.push(...devErrors);
    // 4b-1 사전 등록 ①~④(D-127): 정규시즌 구단당 부상 통계
    const inj = injuryStats(d.saves.repository(), dash.season);
    if (inj.perClub < 10 || inj.perClub > 30) inv.push(`사전 등록 4b-1 ① 위반: 부상 ${inj.perClub}건/구단`);
    if (inj.longPerClub < 5 || inj.longPerClub > 20) inv.push(`사전 등록 4b-1 ② 위반: 10일 이상 ${inj.longPerClub}건/구단`);
    if (inj.concurrent < 1 || inj.concurrent > 5) inv.push(`사전 등록 4b-1 ③ 위반: 동시 부상 ${inj.concurrent}명/구단`);
    if (inj.seasonOutPerClub > 3) inv.push(`사전 등록 4b-1 ④ 위반: 시즌 아웃 ${inj.seasonOutPerClub}건/구단`);
    // 5b 사전 등록 ①②(D-137): 시즌 말 현금 / 시작 현금
    const repo5 = d.saves.repository();
    const userStart = repo5.getClubs().find((c) => c.id === 1)!.startCash;
    const cashRatio = +(dash.cashWon / userStart).toFixed(2);
    const aiClubs = repo5.getClubs().filter((c) => c.id !== 1 && c.parentSupport > 0);
    const aiCashRatio = +(aiClubs.reduce((a, c) => a + repo5.cashBalance(c.id) / c.startCash, 0) / aiClubs.length).toFixed(2);
    // D-151: 재무 현금 기준 전체는 마일스톤(10시즌 이상)에서만 판정한다
    if (seasons >= 10 && cashRatio > 2.0) inv.push(`사전 등록 5b ① 위반: 현금 ${cashRatio}배 > 2.0`);
    // 10시즌 측정 기준(D-137 ① 마지막 시즌·②)은 10시즌 이상 실행(최종 마일스톤)에서만 판정한다(D-143·D-146). 그 전에는 '10시즌 기준 보류'.
    const milestone = seasons >= 10;
    if (milestone && s === seasons && (cashRatio < 0.8 || cashRatio > 1.8)) inv.push(`사전 등록 5b ① 위반: 마지막 시즌 현금 ${cashRatio}배(0.8~1.8)`);
    if (milestone && s === seasons && aiCashRatio > 2.0) inv.push(`사전 등록 5b ② 위반: AI 구단 현금 평균 ${aiCashRatio}배 > 2.0`);
    // 6a 사전 등록 ②③(D-142): 리그 평균 점유율 55~85%, 구단당 입장수입 2026 기준 환산 100~200억
    const att = repo5.getMeta().attendance?.[String(dash.season)] ?? {};
    const caps = new Map(repo5.getClubs().map((c) => [String(c.id), c.stadiumCapacity]));
    const attSum = Object.entries(att).reduce((a, [id, t]) => ({ total: a.total + t.total, seats: a.seats + t.games * (caps.get(id) ?? 0), ticket: a.ticket + t.ticketWon }), { total: 0, seats: 0, ticket: 0 });
    const occupancy = attSum.seats > 0 ? +(attSum.total / attSum.seats).toFixed(3) : 0;
    const infl = Object.entries(repo5.getMeta().inflationBp).filter(([y]) => Number(y) <= dash.season).reduce((a, [, bp]) => a * (1 + bp / 10_000), 1);
    const ticketEok2026 = +(attSum.ticket / 10 / infl / 1e8).toFixed(1);
    if (occupancy < 0.55 || occupancy > 0.85) inv.push(`사전 등록 6a ② 위반: 리그 평균 점유율 ${occupancy}`);
    if (ticketEok2026 < 100 || ticketEok2026 > 200) inv.push(`사전 등록 6a ③ 위반: 구단당 입장수입(2026 기준) ${ticketEok2026}억`);
    // 6d 사전 등록 ②③(D-154): 구단당 굿즈 매출 2026 기준 10~60억, 매출총이익률 25~65%, 정규시즌 종료 재고 ≤ 시즌 판매의 50%
    const mt = Object.values(repo5.getMeta().merch ?? {}).reduce((a, m) => { const t = m.totals[String(dash.season)]; for (const k of ['uniform', 'cap', 'cheer'] as const) { a.rev += t?.[k].revenueWon ?? 0; a.cogs += t?.[k].cogsWon ?? 0; a.sold += t?.[k].sold ?? 0; a.stock += m.stock[k].qty; } return a; }, { rev: 0, cogs: 0, sold: 0, stock: 0 });
    const merchEok2026 = +(mt.rev / 10 / infl / 1e8).toFixed(1);
    const merchMargin = mt.rev > 0 ? +(1 - mt.cogs / mt.rev).toFixed(3) : 0;
    const merchStockRatio = mt.sold > 0 ? +(mt.stock / mt.sold).toFixed(3) : 9;
    if (merchEok2026 < 10 || merchEok2026 > 60) inv.push(`사전 등록 6d ② 위반: 구단당 굿즈 매출(2026 기준) ${merchEok2026}억`);
    if (merchMargin < 0.25 || merchMargin > 0.65) inv.push(`사전 등록 6d ② 위반: 매출총이익률 ${merchMargin}`);
    if (merchStockRatio > 0.5) inv.push(`사전 등록 6d ③ 위반: 시즌 종료 재고 / 판매 ${merchStockRatio}`);
    // 6c 사전 등록 ②(D-150): 정산이 끝난 시즌(직전 시즌)의 구단당 스폰서 순수입 리그 평균 2026 기준 20~70억. 현재 시즌 정산은 포스트시즌 뒤라 다음 행에서 판정한다
    const spPrev = Object.values(repo5.getMeta().sponsorTotals?.[String(dash.season - 1)] ?? {});
    const sponsorEok2026 = spPrev.length && s > 1 ? +(spPrev.reduce((a, b) => a + b, 0) / 10 / (infl / (1 + (repo5.getMeta().inflationBp[String(dash.season)] ?? 0) / 10_000)) / 1e8).toFixed(1) : null;
    if (sponsorEok2026 !== null && (sponsorEok2026 < 20 || sponsorEok2026 > 70)) inv.push(`사전 등록 6c ② 위반: 구단당 스폰서 순수입(2026 기준) ${sponsorEok2026}억`);
    // 6b 사전 등록 ②(D-148): 시즌 종료 시 리그 평균 만족도 40~60
    const fanVals = Object.values(repo5.getMeta().fans ?? {}).map((f) => f.satisfaction);
    const fanAvg = fanVals.length ? +(fanVals.reduce((a, b) => a + b, 0) / fanVals.length).toFixed(1) : null;
    if (fanAvg !== null && (fanAvg < 40 || fanAvg > 60)) inv.push(`사전 등록 6b ② 위반: 리그 평균 만족도 ${fanAvg}`);
    const facLevels = Object.values(repo5.getMeta().facilities ?? {}).map((f) => Object.values(f.levels).reduce((a, b) => a + b, 0));
    if (!tradeStats.some((t) => t.season === s && t.attempts > 0)) inv.push(`사전 등록 5b ③: 시즌 ${s} 트레이드 시도 없음`);
    // 7a 사전 등록 ②③(D-156): AI 구단 간 트레이드 시즌(스토브리그 + 시즌)마다 1건 이상, 시즌 종료 시 우승 경쟁·리빌딩 각 1개 이상,
    // 2시즌 동안 운영 상태가 바뀐 AI 구단 2개 이상. ⑤⑥은 10시즌 이상 실행(최종 마일스톤)에서만 판정한다.
    const meta7 = repo5.getMeta();
    const aiTradeTotal = (meta7.tradeHistory ?? []).filter((h) => h.ai).length;
    const aiTrades = aiTradeTotal - aiTradesBefore;
    aiTradesBefore = aiTradeTotal;
    const stanceNow = Object.values(meta7.clubStance ?? {}).map((x) => x.stance);
    const stanceCount = (k: string) => stanceNow.filter((x) => x === k).length;
    const stanceChanged = new Set((meta7.stanceLog ?? []).map((x) => x.clubId)).size;
    if (aiTrades < 1) inv.push(`사전 등록 7a ② 위반: 시즌 ${s} AI 구단 간 트레이드 ${aiTrades}건`);
    // 7b 사전 등록 ②③(D-158): 받은 제안 시즌마다 1~8건, 실제 가치 비율(받는 / 주는, 둘 다 1억 이상) 중앙값 0.4~1.6(마지막 시즌에 전체 표본으로, 3건 미만이면 보류)
    const offersAll = meta7.tradeOffers ?? [];
    const offersNow = offersAll.length - offersBefore;
    offersBefore = offersAll.length;
    if (offersNow < 1 || offersNow > 8) inv.push(`사전 등록 7b ② 위반: 시즌 ${s} 받은 트레이드 제안 ${offersNow}건`);
    const ratios = offersAll.filter((o) => o.audit.give >= 1e8 && o.audit.get >= 1e8).map((o) => o.audit.get / o.audit.give).sort((a, b) => a - b);
    const offerRatioMedian = ratios.length ? +((ratios[Math.floor((ratios.length - 1) / 2)]! + ratios[Math.ceil((ratios.length - 1) / 2)]!) / 2).toFixed(2) : null;
    if (s === seasons && ratios.length >= 3 && (offerRatioMedian! < 0.4 || offerRatioMedian! > 1.6)) inv.push(`사전 등록 7b ③ 위반: 받은 제안 실제 가치 비율 중앙값 ${offerRatioMedian}`);
    offerAccepted = false;
    // 4c-3 사전 등록 ③(D-175): 우리 구단 경기당 구단주 참여 지점(참여했다면의 수) 평균 1.0~2.0. 전체 시즌 평균으로 마지막 시즌에 판정한다
    const liveAll = Object.values(meta7.liveStats ?? {}).reduce((a, x) => ({ games: a.games + x.games, points: a.points + x.points }), { games: 0, points: 0 });
    const liveNow = meta7.liveStats?.[String(dash.season)] ?? { games: 0, points: 0 };
    const livePerGame = liveAll.games ? +(liveAll.points / liveAll.games).toFixed(2) : null;
    if (s === seasons && (livePerGame === null || livePerGame < 1 || livePerGame > 2)) inv.push(`사전 등록 4c-3 ③ 위반: 경기당 참여 지점 ${livePerGame}`);
    if (stanceCount('contend') < 1 || stanceCount('rebuild') < 1) inv.push(`사전 등록 7a ③ 위반: 우승 경쟁 ${stanceCount('contend')}·리빌딩 ${stanceCount('rebuild')}`);
    if (s === seasons && seasons >= 2 && stanceChanged < 2) inv.push(`사전 등록 7a ③ 위반: 운영 상태가 바뀐 AI 구단 ${stanceChanged}개`);
    if (milestone && s === seasons) {
      const spans = repo5.getClubs().map((c) => {
        const ranks: number[] = [];
        for (let y = dash.season - seasons + 1; y <= dash.season; y++) {
          const r = repo5.getSeasonStandings(y).find((x) => x.clubId === c.id)?.rank ?? standings.find((x) => x.club.id === c.id)?.rank;
          if (r) ranks.push(r);
        }
        return ranks.length ? Math.max(...ranks) - Math.min(...ranks) : 0;
      });
      if (spans.filter((x) => x >= 4).length < 5) inv.push(`사전 등록 7a ⑤ 위반: 순위 변동 폭 4 이상 구단 ${spans.filter((x) => x >= 4).length}개`);
      const cur = new Set<number>();
      let maxAusterity = 0;
      for (const x of meta7.stanceLog ?? []) {
        if (x.to === 'austerity') cur.add(x.clubId);
        else cur.delete(x.clubId);
        maxAusterity = Math.max(maxAusterity, cur.size);
      }
      if (maxAusterity > 3) inv.push(`사전 등록 7a ⑥ 위반: 동시 긴축 구단 ${maxAusterity}개`);
    }
    rows.push({
      season: dash.season,
      cashRatio,
      aiCashRatio,
      occupancy,
      ticketEok2026,
      fanAvg,
      sponsorEok2026,
      merchEok2026,
      merchMargin,
      merchStockRatio,
      userFan: repo5.getMeta().fans?.['1']?.satisfaction ?? null,
      facilityLevelAvg: facLevels.length ? +(facLevels.reduce((a, b) => a + b, 0) / facLevels.length).toFixed(1) : null,
      userFacilityLevels: Object.values(repo5.getMeta().facilities?.['1']?.levels ?? {}).join('/'),
      trades: tradeStats.find((t) => t.season === s) ?? null,
      aiTrades,
      offers: { received: offersNow, ratioMedian: offerRatioMedian, ratioSample: ratios.length, ...offerStats },
      live: { games: liveNow.games, points: liveNow.points, perGameAll: livePerGame },
      budget: { ...budgetStats },
      // 8b(D-183 ⑥ 참고): 이번 시즌 업적 수·경험치(정규시즌 끝 기준)
      achievements: { xp: repo5.getMeta().achievementXp?.[String(dash.season)] ?? 0, count: repo5.getAchievements().length, level: repo5.getMeta().ownerLevel },
      // 8a(D-181 ⑥ 참고): 직전 시즌 수상 분포(구단별 수, 월간 제외)
      awardsPrev: (() => { const aw = repo5.getAwards({ season: dash.season - 1 }).filter((x) => !x.award.startsWith('monthly_')); const by: Record<string, number> = {}; for (const x of aw) by[String(x.clubId)] = (by[String(x.clubId)] ?? 0) + 1; return { season: dash.season - 1, total: aw.length, byClub: by }; })(),
      stances: `우승 경쟁 ${stanceCount('contend')}·중위권 ${stanceCount('middle')}·리빌딩 ${stanceCount('rebuild')}·긴축 ${stanceCount('austerity')} (변경 구단 ${stanceChanged})`,
      coreMean,
      coreP95,
      injuries: inj,
      games: regular && regular.season === dash.season ? `${regular.played}/${regular.total}` : '0/1', // 기록이 없으면 미완료로 판정
      days: adv.daysProcessed,
      simSec: +(simMs / 1000).toFixed(2),
      msPerGame: +(simMs / Math.max(1, adv.gamesPlayed)).toFixed(2),
      hitterListMs: Math.round(q1 - q0),
      pitcherListMs: Math.round(q2 - q1),
      standingsMs: Math.round(q3 - q2),
      boxScoreMs: Math.round(q4 - q3),
      saveMs: Math.round(saveMs),
      sessionMB: +(statSync(d.saves.sessionPath).size / 1e6).toFixed(1),
      saveFileMB: +(statSync(join(d.saves.savesDir, 'longrun.db')).size / 1e6).toFixed(1),
      leagueHRperPA: lg.pa ? +(lg.hr / lg.pa).toFixed(4) : null,
      envRuns: env.runs,
      envHr: env.hr,
      targetRunsPerGame: +(PROBABILITY_CONFIG.leagueTarget.runsPerGame * (1 + env.runs)).toFixed(2),
      targetHrPerPa: +(PROBABILITY_CONFIG.leagueTarget.hrPerPa * (1 + env.hr)).toFixed(4),
      runsPerGame: +(standings.reduce((a, r) => a + (r.runsFor ?? 0), 0) / Math.max(1, dash.gamesPlayedLeague)).toFixed(2),
      cashWon: dash.cashWon,
      invariantErrors: inv.length,
      firstErrors: inv.slice(0, 3),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
    // 2d: 개막 뒤 말소한 선수를 바로 다시 올리면 거부돼야 한다(재등록 10일, D-120).
    {
      const rv = await call<RosterView>('roster.view');
      const down = rv.players.find((p) => p.level === '1군' && !p.isPitcher && p.position !== 'C');
      const up = rv.players.find((p) => p.level !== '1군' && !p.isPitcher && p.position !== 'C' && !rv.reRegister[String(p.id)]);
      const first = down && up ? await d.respond('roster.move', { promote: [up.id], demote: [down.id] }) : null;
      // 첫 교체가 규칙(부상으로 인원 부족 등)에 따라 거부되면 이번 시즌 재등록 확인은 건너뛴다.
      if (down && up && first?.ok) {
        const again = await d.respond('roster.move', { promote: [down.id], demote: [up.id] });
        if (again.ok || again.error.code !== 'RE_REGISTER') {
          const last = rows[rows.length - 1]!;
          last.invariantErrors = Number(last.invariantErrors) + 1;
          last.firstErrors = [...(last.firstErrors as string[]), '재등록 제한이 적용되지 않음'].slice(0, 3);
        }
      }
    }
    // 정규시즌 측정 뒤 포스트시즌을 마치면 시즌 마감 → 스토브리그로 넘어간다(D-085).
    await advance('untilSeasonEnd');
    // 다음 시즌 일정이 생긴 뒤에도 정규시즌 기록이 같은지 시즌마다 확인한다.
    const after = checkRegularSeasons(d.saves.repository());
    if (after.length) {
      const last = rows[rows.length - 1]!;
      last.invariantErrors = Number(last.invariantErrors) + after.length;
      last.firstErrors = [...(last.firstErrors as string[]), ...after].slice(0, 3);
      console.log(JSON.stringify({ season: dash.season, afterPostseasonErrors: after }));
    }
    // 7c·9a(D-239): 장기 관측 — 포스트시즌까지 끝난 시즌 기준
    {
      const repo = d.saves.repository();
      const meta = repo.getMeta();
      const season = dash.season;
      const players = repo.getPlayers();
      const cases = (meta.eventState?.cases ?? []).filter((c) => c.season === season);
      const aw = repo.getAwards({ season }).filter((x) => !x.award.startsWith('monthly_'));
      const awardsByClub: Record<string, number> = {};
      for (const x of aw) if (x.clubId !== null) awardsByClub[String(x.clubId)] = (awardsByClub[String(x.clubId)] ?? 0) + 1;
      const champ = repo.getSeasonStandings(season).find((x) => x.postseason === '한국시리즈 우승')?.clubId ?? null;
      const clubsById = new Map(repo.getClubs().map((c) => [c.id, c]));
      // 홈런 레이스: 참가자별 레이스 홈런 합과 장타 능력
      const race = repo.getAllStar(season)?.hrRace;
      const raceHr = new Map<number, number>();
      for (const m of race?.matches ?? []) {
        raceHr.set(m.a, (raceHr.get(m.a) ?? 0) + m.hrA);
        raceHr.set(m.b, (raceHr.get(m.b) ?? 0) + m.hrB);
      }
      const byId = new Map(players.map((p) => [p.id, p]));
      const hrRace = (race?.entrants ?? []).map((id) => ({ id, power: byId.get(id)?.batting?.power ?? null, hr: raceHr.get(id) ?? 0 })).filter((x) => x.power !== null);
      const retiredTotal = players.filter((p) => p.retired).length;
      const maxId = players.reduce((a, p) => Math.max(a, p.id), 0);
      const rostered = players.filter((p) => p.clubId !== null && !p.retired);
      const payrollEok = +(rostered.reduce((a, p) => a + p.salary, 0) / clubsById.size / 1e8).toFixed(1);
      const last = rows[rows.length - 1]!;
      last.obs = {
        cards: svc().events.report(season, meta.userClubId).cards,
        majorOurs: cases.filter((c) => c.clubId === meta.userClubId).length,
        majorLeague: cases.length,
        sanctionGames: cases.reduce((a, c) => a + c.games, 0),
        awards: aw.length,
        awardsByClub,
        mvpClub: aw.find((x) => x.award === 'mvp')?.clubId ?? null,
        champion: champ,
        championDifficulty: champ !== null ? (clubsById.get(champ)?.difficulty ?? null) : null,
        hrRace,
        retired: retiredTotal - obsPrev.retired,
        newPlayers: obsPrev.maxId ? maxId - obsPrev.maxId : null,
        // D-239 ③ 국내 무소속(국내 선수만). 외국인·아시아쿼터 무소속은 관측값
        freeAgents: players.filter((p) => p.clubId === null && !p.retired && p.origin === 'domestic').length,
        foreignFree: players.filter((p) => p.clubId === null && !p.retired && p.origin !== 'domestic').length,
        amateurs: repo.getAmateurs('active').length,
        payrollEok,
        level: meta.ownerLevel,
        xp: meta.achievementXp?.[String(season)] ?? 0,
        // ①(D-234) MLB 관심: 이 시즌 앞 스토브리그(시즌 번호 season − 1로 기록)의 카드 수·성사·이적료
        mlb: {
          cards: repo.getEventLog({ season: season - 1 }).filter((r) => r.cardId === 'MLB-01').length,
          posted: (meta.postings ?? []).filter((x) => x.season === season - 1).length,
          feeEok: +((meta.postings ?? []).filter((x) => x.season === season - 1).reduce((a, x) => a + x.feeWon, 0) / 1e8).toFixed(1),
        },
      };
      obsPrev.retired = retiredTotal;
      obsPrev.maxId = maxId;
      console.log(JSON.stringify({ season, obs: last.obs }));
    }
  }
  // 9a(D-239·D-211 ⑦·D-236 (1)): 10시즌 이상 실행(최종 마일스톤)에서만 판정하는 평균·누적 기준
  if (seasons >= 10 && rows.length) {
    const obs = rows.map((r) => r.obs as Record<string, unknown> | undefined).filter((o): o is Record<string, unknown> => !!o);
    const errs: string[] = [];
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
    const cards = mean(obs.map((o) => Number(o.cards)));
    if (cards < 22 || cards > 28) errs.push(`사전 등록 D-236 (1) 위반: 시즌 결정 카드 평균 ${cards.toFixed(1)}장(22~28)`);
    const majorOurs = mean(obs.map((o) => Number(o.majorOurs)));
    const majorLeague = mean(obs.map((o) => Number(o.majorLeague)));
    if (majorOurs < 0.4 || majorOurs > 0.6) errs.push(`사전 등록 D-211 ⑦ 위반: 우리 구단 중대 사건 평균 ${majorOurs.toFixed(2)}건(0.4~0.6)`);
    if (majorLeague < 3 || majorLeague > 6) errs.push(`사전 등록 D-211 ⑦ 위반: 리그 중대 사건 평균 ${majorLeague.toFixed(2)}건(3~6)`);
    const awardTotals: Record<string, number> = {};
    for (const o of obs) for (const [c, n] of Object.entries(o.awardsByClub as Record<string, number>)) awardTotals[c] = (awardTotals[c] ?? 0) + n;
    const awardAll = Object.values(awardTotals).reduce((a, b) => a + b, 0);
    const topShare = awardAll ? Math.max(...Object.values(awardTotals)) / awardAll : 0;
    if (topShare > 0.25) errs.push(`사전 등록 D-239 ① 위반: 수상 한 구단 몫 ${(100 * topShare).toFixed(1)}% > 25%`);
    const mvpBy: Record<string, number> = {};
    for (const o of obs) if (o.mvpClub !== null) mvpBy[String(o.mvpClub)] = (mvpBy[String(o.mvpClub)] ?? 0) + 1;
    const mvpMax = Math.max(0, ...Object.values(mvpBy));
    if (mvpMax > 4) errs.push(`사전 등록 D-239 ① 위반: 정규시즌 MVP 한 구단 ${mvpMax}회 > 4`);
    const pts = obs.flatMap((o) => o.hrRace as Array<{ power: number; hr: number }>);
    const corr = (() => {
      if (pts.length < 3) return null;
      const mx = mean(pts.map((p) => p.power));
      const my = mean(pts.map((p) => p.hr));
      const sxy = pts.reduce((a, p) => a + (p.power - mx) * (p.hr - my), 0);
      const sxx = pts.reduce((a, p) => a + (p.power - mx) ** 2, 0);
      const syy = pts.reduce((a, p) => a + (p.hr - my) ** 2, 0);
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
    })();
    if (corr === null || corr < 0.2) errs.push(`사전 등록 D-239 ② 위반: 홈런 레이스 장타–홈런 상관 ${corr === null ? '표본 없음' : corr.toFixed(2)} < 0.2`);
    const first = obs[0]!;
    const lastO = obs.at(-1)!;
    for (const k of ['freeAgents', 'amateurs'] as const) {
      const r = Number(lastO[k]) / Math.max(1, Number(first[k]));
      if (r < 0.5 || r > 2) errs.push(`사전 등록 D-239 ③ 위반: ${k === 'freeAgents' ? '국내 무소속' : '아마추어 풀'} ${first[k]} → ${lastO[k]}(50~200%)`);
    }
    const champs: Record<string, number> = {};
    for (const o of obs) if (o.champion !== null) champs[String(o.champion)] = (champs[String(o.champion)] ?? 0) + 1;
    const champMax = Math.max(0, ...Object.values(champs));
    if (champMax > 5) errs.push(`사전 등록 D-239 ④ 위반: 한국시리즈 우승 한 구단 ${champMax}회 > 5`);
    // D-183 ⑥·D-185 ⑤·D-187 ⑥(02 페이싱): 보통 운영 10시즌 뒤 구단주 레벨 17~20(업적 경험치 포함)
    const lastLevel = Number(lastO.level);
    if (seasons === 10 && (lastLevel < 17 || lastLevel > 20)) errs.push(`사전 등록 D-183 ⑥ 위반: 10시즌 뒤 구단주 레벨 ${lastLevel}(17~20)`);
    summaryObs = { cardsAvg: +cards.toFixed(2), majorOursAvg: +majorOurs.toFixed(2), majorLeagueAvg: +majorLeague.toFixed(2), awardTopShare: +topShare.toFixed(3), awardTotals, mvpBy, hrRaceCorr: corr === null ? null : +corr.toFixed(3), hrRaceSample: pts.length, champions: champs, lastLevel, errors: errs };
    const last = rows[rows.length - 1]!;
    last.invariantErrors = Number(last.invariantErrors) + errs.length;
    last.firstErrors = [...(last.firstErrors as string[]), ...errs].slice(0, 6);
    console.log(JSON.stringify({ summaryObs }));
  }
  const tLoad = performance.now();
  await call('save.load', { slot: 'longrun' });
  const loadMs = Math.round(performance.now() - tLoad);
  const report = {
    environment: { node: process.versions.node, electron: process.versions.electron ?? null, platform: process.platform, arch: process.arch },
    seed,
    seasons,
    newGameMs,
    startDate,
    stoveWeeks,
    stoveMs,
    stoveTurnsBySeason: Object.fromEntries([...new Set(stoveTurns)].map((s) => [String(s), stoveTurns.filter((x) => x === s).length])),
    loadMs,
    rows,
    summaryObs,
  };
  const out = arg('out', '');
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  d.close();
  if (!keepDir) rmSync(baseDir, { recursive: true, force: true });
  console.log(JSON.stringify({ newGameMs, loadMs }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
