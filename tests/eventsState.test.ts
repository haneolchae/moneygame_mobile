// EV-2 카드 효과의 상태 모델 연결(D-205·D-206): ① 기분 ② 컨디션 ③ 부상 위험 ④ 팬·언론 ⑤ 장부·수요 ⑥ 성장 ⑦ 만료
// (⑧ 한 시즌 실행의 카드 발생은 tests/events.test.ts)
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/engine/calendar';
import { EVENTS, HEALTH, MARKETING } from '../src/engine/config';
import { pressureLoss } from '../src/engine/form';
import { createGame, runGame } from '../src/engine/gamesim';
import { injuryChance } from '../src/engine/health';
import { prepareTeam } from '../src/engine/lineup';
import { intensityInjury } from '../src/engine/training';
import { Rng } from '../src/engine/rng';
import { conditionLogits, demandBoost, demandWith, fanDropFactor, growthMultiplier, injuryMultiplier, merchMultiplier, newEventState, satisfactionBoost, weekNumber } from '../src/game/events';
import type { GameService } from '../src/game/service';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const svcOf = (d: unknown) => (d as { game(): GameService }).game();

describe('카드 효과의 상태 모델 연결 (EV-2)', () => {
  it('순수 규칙: 압박 손실의 기분, 부상 배율 상한, 팬 목표·수요·굿즈 합 상한, 여론 완화', () => {
    // ① 같은 압박에서 손실은 기분 30 > 50 > 80, 압박 0이면 0
    expect(pressureLoss(0.6, 50, 50, 30)).toBeGreaterThan(pressureLoss(0.6, 50, 50, 50));
    expect(pressureLoss(0.6, 50, 50, 50)).toBeGreaterThan(pressureLoss(0.6, 50, 50, 80));
    expect(pressureLoss(0.6, 50, 50, undefined)).toBe(pressureLoss(0.6, 50, 50, 50));
    expect(pressureLoss(0, 50, 50, 10)).toBe(0);
    // ④ 팬 목표 가산은 캠페인과 합쳐 상한 8, 여론 완화: 언론 관계가 높을수록 덜 떨어진다
    expect(satisfactionBoost(6, 5)).toBe(MARKETING.maxSatisfactionBoost);
    expect(satisfactionBoost(4, -3)).toBe(1);
    expect(fanDropFactor(20, 0.5)).toBeGreaterThan(fanDropFactor(80, 0.5));
    expect(fanDropFactor(50, 0)).toBeCloseTo(1.0, 9);
    expect(fanDropFactor(50, 1)).toBeCloseTo(0.8, 9);
    // ⑤ 수요: 캠페인 + 카드 합을 −0.2 ~ +0.08로
    expect(demandWith(0.06, 0.08)).toBe(MARKETING.maxDemandBoost);
    expect(demandWith(0, -0.5)).toBe(EVENTS.demandMin);
    // ②③⑤⑥⑦ 기간 효과 조회와 만료
    const s = newEventState();
    s.effects = [
      { type: 'COND', clubId: 1, playerId: 9, value: 4, untilWeek: 101 },
      { type: 'COND', clubId: 1, playerId: 9, value: 4, untilWeek: 102 },
      { type: 'INJ_RISK', clubId: 1, playerId: 9, value: 2, untilWeek: 101 },
      { type: 'INJ_RISK', clubId: 1, playerId: 9, value: 2, untilWeek: 101 },
      { type: 'DEMAND', clubId: 1, playerId: null, value: 0.95, untilWeek: 101 },
      { type: 'MERCH', clubId: 1, playerId: null, value: 1.2, untilWeek: 101 },
      { type: 'MERCH', clubId: 1, playerId: null, value: 1.2, untilWeek: 101 },
      { type: 'GROWTH', clubId: 1, playerId: 9, value: 1.1, untilWeek: 200 },
    ];
    expect(conditionLogits(s, 100).get(9)).toBeCloseTo(EVENTS.condMax * EVENTS.condLogitPerPoint, 9); // 8점 → 상한 5점
    expect(conditionLogits(s, 101).get(9)).toBeCloseTo(4 * EVENTS.condLogitPerPoint, 9);
    expect(conditionLogits(s, 102).size).toBe(0);
    expect(injuryMultiplier(s, 100, 9)).toBe(4);
    expect(injuryMultiplier(s, 101, 9)).toBe(1);
    expect(demandBoost(s, 100, 1)).toBeCloseTo(-0.05, 9);
    expect(merchMultiplier(s, 100, 1)).toBe(EVENTS.merchMax); // 1.44 → 1.3
    expect(merchMultiplier(s, 101, 1)).toBe(1);
  });

  it('게임 안 연결: 기분·분위기·회복, 컨디션 로짓, 부상 확률, 여론 완화·언론 회복, 반복 지출, 훈련 배율', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'events-ev2' });
      for (let i = 0; i < 40 && (await call(d, 'game.dashboard')).phase === 'stove'; i++) await call(d, 'game.advance', { mode: 'week' });
      const repo = d.saves.repository();
      const svc = svcOf(d);
      const meta = repo.getMeta();
      expect(meta.mode).toBe('season');
      const monday = meta.currentDate; // 시즌 모드 첫 월요일(아직 처리 전)
      const week = weekNumber(monday);
      const state = newEventState();
      const ours = repo.getPlayers().filter((p) => p.clubId === 1 && p.level === '1군');
      const target = ours[0]!;
      const ctx = { meta, date: monday, clubId: 1, playerId: target.id, rng: new Rng(Rng.derive('ev2', 'x').state()), week, cardId: 'TEST', state };

      // ① 기분 ±, 분위기 = 1군 전원 ±n/2, 주간 20% 회복
      svc.events.applyEffects([{ type: 'MOOD', value: 20 }, { type: 'CLUBHOUSE', value: 6 }], ctx);
      expect(repo.getPlayer(target.id)!.mood).toBe(73);
      expect(repo.getPlayer(ours[1]!.id)!.mood).toBe(53);
      // 선수 상세는 우리 선수 기분만 보낸다
      expect((await call(d, 'game.player', { playerId: target.id })).mood).toBe(73);
      const other = repo.getPlayers().find((p) => p.clubId === 2)!;
      expect((await call(d, 'game.player', { playerId: other.id })).mood).toBeNull();

      // ④ 여론 완화: 언론 관계 80에서 −10 → −10 × 완화식
      repo.updateMeta({ press: { '1': 80 }, fans: { ...(repo.getMeta().fans ?? {}), '1': { satisfaction: 60 } } });
      const fan0 = 60;
      svc.events.applyEffects([{ type: 'FAN_NOW', value: -10 }], ctx);
      const q = svc.org.teamQuality(1, 'pr');
      expect(Math.round((fan0 - repo.getMeta().fans!['1']!.satisfaction) * 10) / 10).toBe(Math.round(10 * fanDropFactor(80, q) * 10) / 10);

      // ⑤ 반복 지출: 지금 1번 + 다음 주 시작 2번, 그 뒤 멈춤
      const ev = () => repo.ledgerEntries(1, 400).filter((e) => e.category === 'event' && e.memo.includes('반복')).length;
      svc.events.applyEffects([{ type: 'RECUR', won: -50_000_000, weeks: 3 }, { type: 'COND', value: 3, weeks: 1 }, { type: 'INJ_RISK', value: 2, weeks: 2 }, { type: 'GROWTH', value: 1.1 }], ctx);
      expect(ev()).toBe(1);
      // ② 컨디션 로짓이 같은 경기 키에서 그 선수 수행 편차에만 더해진다
      const cond = conditionLogits(state, week);
      expect(cond.get(target.id)).toBeCloseTo(3 * EVENTS.condLogitPerPoint, 9);
      const active = repo.getActivePlayers([1, 2]);
      const team = (c: number) => prepareTeam(c, active.filter((p) => p.clubId === c), [], null);
      const a = createGame(1, team(1), team(2), Rng.derive('ev2', 'g'), 9);
      const b = createGame(1, team(1), team(2), Rng.derive('ev2', 'g'), 9, undefined, { condition: cond });
      runGame(a);
      runGame(b);
      if (a.perf.has(target.id)) expect(b.perf.get(target.id)! - a.perf.get(target.id)!).toBeCloseTo(3 * EVENTS.condLogitPerPoint, 9);
      for (const [id, v] of a.perf) if (id !== target.id && b.perf.has(id)) expect(b.perf.get(id)).toBe(v);
      // ③ 부상 확률 배율(훈련 강도와 곱해 ×3.0 상한)
      expect(injuryMultiplier(state, week, target.id)).toBe(2);
      const p = repo.getPlayer(target.id)!;
      const i = intensityInjury(p);
      expect(injuryChance(p, 30, 28, 2) / injuryChance(p, 30, 28)).toBeCloseTo(Math.min(HEALTH.maxRiskMult, 2 * i) / i, 9);
      expect(injuryChance(p, 30, 28, 50) / injuryChance(p, 30, 28)).toBeCloseTo(HEALTH.maxRiskMult / i, 9);
      // ⑥ 훈련 효과 배율이 훈련 계산에 연결
      repo.updateMeta({ eventState: state });
      expect(svc.training.playerFactor(repo.getPlayer(target.id)!, monday)).toBeCloseTo(1.1, 9);
      expect(growthMultiplier(state, week, ours[1]!)).toBe(1);

      // 주 시작 처리 두 번: 반복 지출 2·3번째, 기분 20% 회복, 언론 관계 5% 회복, 컨디션(1주) 만료
      svc.events.weekStart(repo.getMeta(), addDays(monday, 7));
      expect(ev()).toBe(2);
      expect(repo.getPlayer(target.id)!.mood).toBe(68.4);
      expect(repo.getMeta().press!['1']).toBe(78.5);
      expect(conditionLogits(repo.getMeta().eventState, week + 1).size).toBe(0);
      expect((repo.getMeta().eventState!.effects ?? []).some((e) => e.type === 'COND')).toBe(false);
      svc.events.weekStart(repo.getMeta(), addDays(monday, 14));
      svc.events.weekStart(repo.getMeta(), addDays(monday, 21));
      expect(ev()).toBe(3);
      expect((repo.getMeta().eventState!.effects ?? []).some((e) => e.type === 'RECUR' || e.type === 'INJ_RISK')).toBe(false);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);
});
