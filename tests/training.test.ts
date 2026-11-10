// 4b-2 집중 훈련(D-128·D-129): 사전 등록 ① 효과 크기, 강도-부상 연결, 기간 비율(반영일 직전 지시로 한 달 효과 없음),
// 직접 지시·강도 변경·재지시 비용, 육성팀 위임 처리량, 부상·타 구단 제한, AI 계획, 히든 값 비공개
import { describe, expect, it } from 'vitest';
import { DEVELOPMENT, TRAINING } from '../src/engine/config';
import { applyAnnual, applyMonthly } from '../src/engine/development';
import { injuryChance } from '../src/engine/health';
import { coachFactor, planStrength } from '../src/engine/training';
import type { PlayerTruth, TrainingPlan } from '../src/engine/types';
import type { Dispatcher } from '../src/host/dispatcher';
import { checkTraining } from '../src/host/invariants';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

function hitter(id: number, birth: string): PlayerTruth {
  return {
    id, name: '평균', birthDate: birth, bats: 'R', throws: 'R', isPitcher: false, origin: 'domestic', position: 'SS', clubId: 1, level: '1군',
    salary: 1e8, contractYears: 1,
    career: {} as PlayerTruth['career'],
    batting: { contact: 45, power: 45, eye: 45, baserunning: 50, speed: 52, bunt: 40, mental: 50, stamina: 50 },
    pitching: null,
    defense: { range: 48, fielding: 48, armStrength: 50, armAccuracy: 50 },
    positions: { SS: 80 },
    hidden: {
      potential: { contact: 62, eye: 62, power: 62, speed: 56, range: 60, fielding: 60 },
      growthRate: 50, peakAge: 28, declineRate: 50, workEthic: 50, coachability: 50, adaptability: 50, consistency: 50, durability: 50,
      recoveryTendency: 50, pressureSensitivity: 50, leadership: 50, competitiveness: 50, contractPreference: '금액',
    },
  };
}

/** 한 시즌(월 8회 + 연간) 진행 뒤 컨택 변화 */
function seasonChange(p: PlayerTruth, age: number, strength?: Record<string, number>): number {
  const before = p.batting.contact;
  for (const m of DEVELOPMENT.monthlyMonths) applyMonthly(p, 'train-test', `2030-${String(m).padStart(2, '0')}-01`, age, strength);
  applyAnnual(p, 'train-test', 2030, '2030-10-31', age);
  return p.batting.contact - before;
}

const plan: TrainingPlan = { clubId: 1, primary: 'contact', secondary: 'eye', intensity: 'normal', since: '2030-01-01', source: 'owner' };

async function until(d: Dispatcher, date: string) {
  for (let i = 0; i < 400; i++) {
    const dash = await call(d, 'game.dashboard');
    if (dash.date >= date) return;
    await call(d, 'game.advance', { mode: dash.phase === 'stove' ? 'week' : 'day' });
  }
}

describe('집중 훈련 (4b-2)', () => {
  it('사전 등록 ①: 성장 비율 1.15~1.45, 정점 뒤 하락 비율 0.65~0.95 · 강도 높음 부상 위험 ×1.3', () => {
    const strength = planStrength(plan, coachFactor(50, 50), 1);
    expect(strength).toEqual({ contact: 1, eye: TRAINING.secondaryShare });
    let base = 0;
    let trained = 0;
    let baseDrop = 0;
    let trainedDrop = 0;
    for (let i = 0; i < 2000; i++) {
      base += seasonChange(hitter(i, '2008-01-01'), 22);
      trained += seasonChange(hitter(i, '2008-01-01'), 22, strength);
      const old = (id: number) => {
        const p = hitter(id, '1997-01-01');
        p.batting.contact = 62;
        return p;
      };
      baseDrop += seasonChange(old(i), 33);
      trainedDrop += seasonChange(old(i), 33, strength);
    }
    expect(trained / base).toBeGreaterThanOrEqual(1.15);
    expect(trained / base).toBeLessThanOrEqual(1.45);
    expect(baseDrop).toBeLessThan(0);
    expect(trainedDrop / baseDrop).toBeGreaterThanOrEqual(0.65);
    expect(trainedDrop / baseDrop).toBeLessThanOrEqual(0.95);

    const p = hitter(1, '2000-01-01');
    const normal = injuryChance(p, 30, 26);
    p.training = { ...plan, intensity: 'high' };
    expect(injuryChance(p, 30, 26) / normal).toBeCloseTo(TRAINING.intensity.high.injury, 6);
    p.training = { ...plan, clubId: 2 }; // 다른 구단이 세운 계획은 효과 없음
    expect(injuryChance(p, 30, 26)).toBeCloseTo(normal, 9);
  });

  it('지시·변경·재지시 비용, 위임 처리량, 기간 비율, 부상·타 구단 제한, AI 계획, 히든 비공개', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 4, saveName: 't', seed: 'train-4b2' });
      const repo = d.saves.repository();
      await until(d, '2027-02-02');
      // AI 구단: 스프링캠프 시작에 유망주 계획(한도 이하), 우리 구단은 자동 계획 없음
      const players = repo.getPlayers();
      const aiPlans = players.filter((p) => p.clubId !== null && p.clubId !== 4 && p.training);
      expect(aiPlans.length).toBeGreaterThan(30);
      expect(players.filter((p) => p.clubId === 4 && p.training)).toHaveLength(0);
      expect(checkTraining(repo)).toEqual([]);

      const own = players.filter((p) => p.clubId === 4 && !p.isPitcher && !p.health?.injury);
      const a = own[0]!;
      const av = await call(d, 'player.actions', { playerId: a.id });
      expect(av.actions.filter((x) => x.group === '육성').map((x) => x.key).sort()).toEqual(['train', 'trainDelegate']);
      expect(JSON.stringify(av)).not.toContain('coachability');
      expect(av.training!.expected.growthPctLow).toBeLessThan(av.training!.expected.growthPctHigh);

      const ap = () => call(d, 'game.dashboard').then((x) => x.owner.apRemaining);
      const ap0 = await ap();
      await call(d, 'player.train', { playerId: a.id, primary: 'power', secondary: 'contact', intensity: 'normal' });
      expect(await ap()).toBe(ap0 - TRAINING.directAp);
      // 같은 계획 재지시: 무비용 거부
      const dup = await d.respond('player.train', { playerId: a.id, primary: 'power', secondary: 'contact', intensity: 'normal' });
      expect(dup.ok).toBe(false);
      // 강도만 변경: 행동력 0, 시작일 유지
      await call(d, 'player.train', { playerId: a.id, primary: 'power', secondary: 'contact', intensity: 'high' });
      expect(await ap()).toBe(ap0 - TRAINING.directAp);
      expect(repo.getPlayer(a.id)!.training).toMatchObject({ intensity: 'high', since: '2027-02-02', clubId: 4 });
      // 형식 오류: 주·보조 같음, 투수 목표
      expect((await d.respond('player.train', { playerId: a.id, primary: 'power', secondary: 'power', intensity: 'normal' })).ok).toBe(false);
      expect((await d.respond('player.train', { playerId: a.id, primary: 'stuff', secondary: null, intensity: 'normal' })).ok).toBe(false);
      expect(await ap()).toBe(ap0 - TRAINING.directAp);

      // 다른 구단 선수에게는 지시할 수 없다(메뉴에도 없음)
      const other = players.find((p) => p.clubId === 2)!;
      expect((await d.respond('player.train', { playerId: other.id, primary: 'contact', secondary: null, intensity: 'normal' })).ok).toBe(false);
      expect((await call(d, 'player.actions', { playerId: other.id })).training).toBeNull();

      // 육성팀에 맡기기: 행동력 0, 육성팀 처리량 4
      const b = own[1]!;
      const wpBefore = (await call(d, 'player.actions', { playerId: b.id })).training!.devWpLeft;
      const apB = await ap();
      if (wpBefore >= TRAINING.planWp) {
        await call(d, 'player.trainDelegate', { playerId: b.id });
        expect(await ap()).toBe(apB);
        expect(repo.getPlayer(b.id)!.training).toMatchObject({ source: 'dev', intensity: 'normal' });
        expect((await call(d, 'player.actions', { playerId: b.id })).training!.devWpLeft).toBe(wpBefore - TRAINING.planWp);
      }

      // 부상 중: 새 지시 불가(무비용), 강도 낮춤·중단은 가능
      const c = own[2]!;
      const hurt = repo.getPlayer(c.id)!;
      hurt.health = { injury: { part: '햄스트링', severity: '보통', date: '2027-02-01', returnDate: '2027-03-10', estimate: { from: '2027-03-05', to: '2027-03-15' }, demoted: false, wasActive: false }, history: [] };
      repo.savePlayers([hurt]);
      const apC = await ap();
      expect((await d.respond('player.train', { playerId: c.id, primary: 'contact', secondary: null, intensity: 'normal' })).ok).toBe(false);
      expect(await ap()).toBe(apC);
      const ha = repo.getPlayer(a.id)!;
      ha.health = { ...hurt.health };
      repo.savePlayers([ha]);
      expect((await d.respond('player.train', { playerId: a.id, primary: 'power', secondary: 'contact', intensity: 'low' })).ok).toBe(true);
      expect((await d.respond('player.train', { playerId: a.id, primary: 'power', secondary: 'contact', intensity: 'high' })).ok).toBe(false);

      // 기간 비율: 반영일 하루 전 계획은 1/30, 부상 기간은 0
      const service = (d as unknown as { service: { training: { coverage: (p: PlayerTruth, plan: TrainingPlan, date: string) => number } } }).service;
      const fresh = repo.getPlayer(own[3]!.id)!;
      const late: TrainingPlan = { clubId: 4, primary: 'contact', secondary: null, intensity: 'normal', since: '2027-02-28', source: 'owner' };
      expect(service.training.coverage(fresh, late, '2027-03-01')).toBeCloseTo(1 / TRAINING.periodDays, 9);
      expect(service.training.coverage(fresh, { ...late, since: '2027-01-01' }, '2027-03-01')).toBeCloseTo(1, 9);
      expect(service.training.coverage(repo.getPlayer(c.id)!, { ...late, since: '2027-01-01' }, '2027-03-01')).toBeCloseTo(3 / TRAINING.periodDays, 9); // 1/30~2/1만 유효, 2/2부터 부상
      // 강도 기록: 반영일 하루 전 높음으로 올려도 그날 하루만 높음
      expect(service.training.coverage(fresh, { ...late, since: '2027-01-01', intensity: 'high', log: [{ from: '2027-01-01', intensity: 'low' }, { from: '2027-02-28', intensity: 'high' }] }, '2027-03-01')).toBeCloseTo((29 * TRAINING.intensity.low.effect + TRAINING.intensity.high.effect) / TRAINING.periodDays, 9);

      // 중단: 행동력 0
      const apS = await ap();
      await call(d, 'player.trainStop', { playerId: a.id });
      expect(repo.getPlayer(a.id)!.training).toBeUndefined();
      expect(await ap()).toBe(apS);
      expect((await call(d, 'roster.view')).training.rows.some((r) => r.playerId === a.id)).toBe(false);
      expect(checkTraining(repo)).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  });
});
