// 9b-2(D-247): 연봉 시세 지수, AI FA 지출(현금 가산·샐러리캡 준수), 샐러리캡 초과 제재(제재금·드래프트 순서),
// 외국인 무소속 풀 정리, AI 시설 투자 규칙, 다시드 장기 실행 도구의 시드 평균 판정(D-248)
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_CLUB, CAP_SANCTION, FACILITY } from '../src/engine/config';
import { aiCashBonus, aiOffer, capPayroll, faDemand, offerTotal, salaryCap, salaryDemand } from '../src/engine/contracts';
import { domesticSalary, salaryIndex } from '../src/engine/worldgen';
import { CLUB_PROFILES } from '../src/engine/clubs';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const EOK = 100_000_000;
const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
  while (dirs.length) cleanup(dirs.pop()!);
});

describe('밸런스 장치 (9b-2, D-247)', () => {
  it('연봉 시세 지수: 첫 시즌 1, 해마다 5%, 요구 연봉·FA 요구가 계약 시즌 지수를 따른다', () => {
    expect(salaryIndex(2026)).toBe(1);
    expect(salaryIndex(2027)).toBe(1);
    expect(salaryIndex(2028)).toBeCloseTo(1.05, 10);
    expect(salaryIndex(2037)).toBeCloseTo(1.05 ** 10, 10);
    // 능력 60·28세·프로 5년: 3,000만 + 1.4억 × e^(10/7.5) = 5.61억 → 2028 시세 5.89억
    expect(domesticSalary(60, 28, 5)).toBe(561_000_000);
    expect(domesticSalary(60, 28, 5, salaryIndex(2028))).toBe(589_000_000);
    // 샐러리캡도 같은 비율이라 시세 / 상한 비율이 유지된다
    expect(domesticSalary(60, 28, 5, salaryIndex(2036)) / salaryCap(2036)).toBeCloseTo(561_000_000 / salaryCap(2027), 3);
  });

  it('AI FA 지출: 현금 배수 1.2 이하 가산 0, 2.0 이상 최대 가산, 리빌딩 구단은 가산 없음', () => {
    const F = AI_CLUB.faCash;
    expect(aiCashBonus(1.0)).toBe(0);
    expect(aiCashBonus(F.from)).toBe(0);
    expect(aiCashBonus((F.from + F.to) / 2)).toBeCloseTo(F.maxBonus / 2, 10);
    expect(aiCashBonus(3)).toBe(F.maxBonus);
  });

  it('한 시즌: 드래프트 순서 제재 → 샐러리캡 제재금 → 외국인 무소속 풀 정리 → 캡 초과 구단은 FA 제안을 하지 않는다', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    closers.push(() => d.close());
    await call(d, 'game.new', { clubId: 7, saveName: 't', seed: 'balance-9b2', start: 'camp' });
    const repo = d.saves.repository();

    // 요구 연봉은 계약 시즌 지수를 따른다(같은 선수, 2027 대비 2029 약 1.1025배 — 100만 원 반올림)
    const star = repo.getPlayers().filter((p) => p.clubId === 5 && p.origin === 'domestic').sort((a, b) => b.salary - a.salary)[0]!;
    const seed = repo.getMeta().seed;
    expect(salaryDemand(seed, star, 2029) / salaryDemand(seed, star, 2027)).toBeCloseTo(1.05 ** 2, 2);
    // AI 제안: 우승 경쟁 구단의 현금 가산 0.1 → 총액 (1.03 + 0.1) / 1.03배, 리빌딩 구단은 그대로
    const demand = faDemand(seed, star, 2028);
    const club = CLUB_PROFILES.find((c) => c.id === 5)!;
    expect(offerTotal(aiOffer(seed, club, star, demand, 2028, true, false, 0.1)) / offerTotal(aiOffer(seed, club, star, demand, 2028, true, false))).toBeCloseTo(1.13 / 1.03, 2);
    expect(offerTotal(aiOffer(seed, club, star, demand, 2028, false, true, 0.1))).toBe(offerTotal(aiOffer(seed, club, star, demand, 2028, false, true)));

    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 정규시즌 끝
    // 드래프트 순서 제재: 최하위 구단(1라운드 1순위)이 3회 연속 초과 구단이면 1라운드만 맨 뒤로 간다
    const last = (await call(d, 'game.standings')).at(-1)!.club.id;
    repo.updateMeta({ capDraftPenalty: { '2027': [last] } });
    while (!(await call(d, 'draft.view')).done) await call(d, 'game.advance', { mode: 'day' });
    const picks = (await call(d, 'draft.view')).picks;
    expect(picks.filter((p) => p.round === 1).at(-1)!.club.id).toBe(last);
    expect(picks.filter((p) => p.round === 1)[0]!.club.id).not.toBe(last);
    expect(picks.filter((p) => p.round === 2)[0]!.club.id).toBe(last);

    // 샐러리캡 제재: 구단 5의 산정액을 상한 + 40억으로 만든다 → 1회 초과분의 50% = 20억, 연속 횟수 1
    const cap = salaryCap(2027);
    const mine = repo.getPlayers().find((p) => p.id === star.id)!;
    mine.salary += cap - capPayroll(repo.getPlayers(), 5, 2027) + 40 * EOK;
    repo.savePlayers([mine]);
    expect(capPayroll(repo.getPlayers(), 5, 2027)).toBe(cap + 40 * EOK);
    const freeForeign = repo.getPlayers().filter((p) => p.clubId === null && p.origin !== 'domestic' && !p.retired).map((p) => p.id);
    expect(freeForeign.length).toBeGreaterThan(0);
    await call(d, 'game.advance', { mode: 'untilSeasonEnd' }); // 포스트시즌 → 시즌 마감
    expect(repo.getMeta().mode).toBe('stove');
    const fine = [2027, 2028].flatMap((y) => repo.ledgerByCategory(5, y)).filter((r) => r.category === 'capPenalty').reduce((a, r) => a + r.amount, 0);
    expect(fine).toBe(-(40 * EOK * CAP_SANCTION.rateBpByStreak[0]!) / 10_000);
    expect(repo.getMeta().capOverStreak).toEqual({ '5': 1 });
    expect(repo.getMeta().capDraftPenalty?.['2028']).toBeUndefined();
    // 다른 구단은 제재금이 없다
    expect([2027, 2028].flatMap((y) => repo.ledgerByCategory(7, y)).some((r) => r.category === 'capPenalty')).toBe(false);

    // 외국인 무소속 풀: 1년 미계약 선수는 떠나고(은퇴 표시), 새 후보 36명(외국인 26·아시아쿼터 10)이 들어온다
    const after = repo.getPlayers();
    for (const id of freeForeign) expect(after.find((p) => p.id === id)!.retired?.reason).toBe('해외 리그 이적');
    const pool = after.filter((p) => p.clubId === null && p.origin !== 'domestic' && !p.retired);
    expect(pool).toHaveLength(36);
    expect(pool.filter((p) => p.origin === 'asia')).toHaveLength(10);
    expect((await call(d, 'market.view')).foreign.pool.every((f) => pool.some((p) => p.id === f.playerId))).toBe(true);
    // 떠난 선수에게는 제안할 수 없다
    const gone = await d.respond('market.foreignOffer', { playerId: freeForeign[0]!, salaryUsd: 500_000 });
    expect(gone.ok).toBe(false);

    // 캡 초과 구단(구단 5)은 FA 시장에서 제안하지 않는다. 다른 구단은 제안한다.
    for (let i = 0; i < 5; i++) await call(d, 'game.advance', { mode: 'week' });
    // 첫 스토브리그 자동 실행(2026) 때의 제안은 빼고 이번 스토브리그 제안만 본다
    const offers = repo.getOffers({ kind: 'fa' }).filter((o) => o.date >= '2027-10-01');
    expect(offers.filter((o) => o.clubId !== 7).length).toBeGreaterThan(0);
    expect(offers.filter((o) => o.clubId === 5)).toHaveLength(0);
  }, 400_000);

  it('AI 시설 투자: 새 공사비의 aiCommitShare만 확보되면 착공한다', () => {
    expect(FACILITY.aiCommitShare).toBeGreaterThan(FACILITY.paymentsBp[0]! / 10_000);
    expect(FACILITY.aiCommitShare).toBeLessThan(1);
  });

  it('다시드 판정: 시드 평균으로 기준을 판정하고 같은 시드 결과 지문은 시간 측정값을 빼고 비교한다', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../scripts/sim-seeds.mjs')).href)) as {
      aggregate: (sims: Array<{ seed: string; sim: unknown }>, seasons: number) => { average: Record<string, unknown>; verdicts: Array<{ key: string; ok: boolean }>; errors: string[] };
      fingerprint: (sim: unknown) => string;
    };
    const sim = (champs: number[], level: number, cash: number, major: number, simSec: number) => ({
      seed: 's',
      seasons: 10,
      startDate: '2027-02-01',
      rows: champs.map((champion, i) => ({
        season: 2027 + i,
        cashRatio: cash,
        aiCashRatio: 1.5,
        invariantErrors: 0,
        firstErrors: [],
        simSec,
        obs: { champion, mvpClub: (i % 5) + 1, awardsByClub: { '1': 10, '2': 10, '3': 10, '4': 10, '5': 10 }, majorOurs: i < major ? 1 : 0, majorLeague: 4, cards: 25, level: i === 9 ? level : 5, clubs: [] },
      })),
    });
    // 시드 A: 한 구단 7회 우승·레벨 16·현금 2.2배, 시드 B: 3회·18·1.4배 → 평균 5회·17·1.8배(통과), 우리 사건 (5 + 5) / 20 = 0.5
    const a = sim([5, 5, 5, 5, 5, 5, 5, 1, 2, 3], 16, 2.2, 5, 3);
    const b = sim([1, 1, 1, 2, 2, 3, 3, 4, 4, 5], 18, 1.4, 5, 9);
    const agg = mod.aggregate([{ seed: 'a', sim: a }, { seed: 'b', sim: b }], 10);
    expect(agg.average).toMatchObject({ champMax: 5, lastLevel: 17, cashLast: 1.8, majorOurs: 0.5, awardTopShare: 0.2 });
    expect(agg.errors).toEqual([]);
    expect(agg.verdicts.map((v) => v.key)).toEqual(['champMax', 'awardTopShare', 'mvpMax', 'majorOurs', 'lastLevel', 'cashEach', 'cashLast', 'aiCashLast']);
    // 한 시드만 보면 미달(우승 7회, 현금 2.2배)
    const solo = mod.aggregate([{ seed: 'a', sim: a }], 10);
    expect(solo.verdicts.filter((v) => !v.ok).map((v) => v.key)).toEqual(['champMax', 'lastLevel', 'cashEach', 'cashLast']);
    // 10시즌 미만은 판정하지 않는다
    expect(mod.aggregate([{ seed: 'a', sim: { ...a, rows: a.rows.slice(0, 2) } }], 2).verdicts).toEqual([]);
    // 지문: 시간 측정값만 다르면 같고, 결과가 다르면 다르다
    expect(mod.fingerprint(a)).toBe(mod.fingerprint(sim([5, 5, 5, 5, 5, 5, 5, 1, 2, 3], 16, 2.2, 5, 99)));
    expect(mod.fingerprint(a)).not.toBe(mod.fingerprint(b));
  });
});
