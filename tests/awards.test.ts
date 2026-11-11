// 8a 리그 시상(D-180·D-181): ① 같은 기록이면 같은 수상자, 불러와도 같고 중복 시상 없음 ② 타이틀 = 선수 기록 화면 부문 1위
// ③ 자격 미달 수상 0건·포지션 수비 아웃 합(규칙 검사)
import { describe, expect, it } from 'vitest';
import { avg, era, obp, slg } from '../src/engine/awards';
import { AWARDS } from '../src/engine/config';
import { goldenGloveDate } from '../src/game/awards';
import { checkAwards } from '../src/host/invariants';
import type { PlayerListItem } from '../src/shared/protocol';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

describe('리그 시상 (8a)', () => {
  it('시즌 시상·골든글러브·월간 시상, 타이틀 = 기록 화면 1위, 재계산·불러오기 일치, 자격·포지션 아웃 검사', async () => {
    const dir = tempDir();
    const d = makeDispatcher(dir);
    try {
      await call(d, 'game.new', { clubId: 1, saveName: 't', seed: 'awards-8a' });
      const repo = d.saves.repository();
      // 2027 정규시즌·포스트시즌을 마치고 스토브리그로
      for (let i = 0; i < 80; i++) {
        const db = await call(d, 'game.dashboard');
        if (db.season === 2027 && db.phase === 'stove') break;
        await call(d, 'game.advance', { mode: db.phase === 'stove' ? 'week' : 'untilSeasonEnd' });
      }
      // 시즌 원시 기록이 있는 동안: 포지션 수비 아웃 규칙 검사
      expect(checkAwards(repo)).toEqual([]);
      const ksAwards = repo.getAwards({ season: 2027 });
      expect(ksAwards.some((a) => a.award === 'ks_mvp')).toBe(true);
      // 골든글러브 시상식 다음 날까지
      const gg = goldenGloveDate(2026 + 1);
      for (let i = 0; i < 12 && (await call(d, 'game.dashboard')).date <= gg; i++) await call(d, 'game.advance', { mode: 'week' });
      const all = repo.getAwards({ season: 2027 });
      const has = (k: string) => all.filter((a) => a.award === k);
      for (const k of ['mvp', 'pitcher', 'manager', 'front', 'title_HR', 'title_AVG', 'title_ERA', 'title_SV', 'title_HLD', 'platinum']) expect(has(k).length, k).toBeGreaterThan(0);
      expect(has('gg').filter((a) => a.slot === 'OF').length).toBeGreaterThanOrEqual(3);
      expect(new Set(has('gg').map((a) => a.slot)).size).toBeGreaterThanOrEqual(6);
      expect(has('defense').length).toBeGreaterThanOrEqual(5);
      // 수비상은 포지션마다 한 명(점수 동률은 수비 범위로 가른다)
      expect(new Set(has('defense').map((a) => a.slot)).size).toBe(has('defense').length);
      expect(new Set(has('monthly_bat').map((a) => a.slot)).size).toBeGreaterThanOrEqual(4);
      expect(has('best1').length).toBeGreaterThanOrEqual(15);
      // 상 하나에 공동 수상이 아니면 대상은 한 명. 골든글러브 수상자는 베스트 1팀
      for (const a of has('gg').filter((x) => x.slot !== 'P')) expect(has('best1').some((b) => b.playerId === a.playerId), `gg ${a.slot}`).toBe(true);

      // ② 타이틀 = 기록 화면(선수 목록·상세가 쓰는 시즌 합계)의 부문 1위
      const hitters = await call(d, 'game.players', { scope: 'all', group: 'hitters', level: 'all' });
      const pitchers = await call(d, 'game.players', { scope: 'all', group: 'pitchers', level: 'all' });
      const teamGames = Math.round((repo.getGames(2027, 'regular').length * 2) / 10);
      const top = (list: PlayerListItem[], key: string, low = false, q: (i: PlayerListItem) => boolean = () => true) => {
        const v = list.filter(q).map((i) => i.stats[key]).filter((x): x is number => typeof x === 'number');
        return low ? Math.min(...v) : Math.max(...v);
      };
      const listVal = (list: PlayerListItem[], id: number, key: string) => list.find((i) => i.id === id)?.stats[key];
      const titleList: Array<[string, PlayerListItem[], string, boolean, (i: PlayerListItem) => boolean]> = [
        ['title_HR', hitters, 'HR', false, () => true],
        ['title_RBI', hitters, 'RBI', false, () => true],
        ['title_AVG', hitters, 'AVG', false, (i) => Number(i.stats.PA) >= teamGames * AWARDS.qualPaPerGame],
        ['title_W', pitchers, 'W', false, () => true],
        ['title_SV', pitchers, 'SV', false, () => true],
        ['title_K', pitchers, 'K', false, () => true],
        ['title_ERA', pitchers, 'ERA', true, (i) => Number(i.stats.IP) >= teamGames],
      ];
      for (const [award, list, key, low, q] of titleList) for (const a of has(award)) expect(listVal(list, a.playerId!, key), award).toBeCloseTo(top(list, key, low, q), 9);
      // 목록에 없는 부문은 같은 시즌 합계(선수 상세 기록)로 대조
      const bat = repo.battingTotals(2027);
      const pit = repo.pitchingTotals(2027);
      const qual = [...bat].filter(([, b]) => b.PA >= teamGames * AWARDS.qualPaPerGame);
      const best = (vals: number[]) => Math.max(...vals);
      expect(bat.get(has('title_R')[0]!.playerId!)!.R).toBe(best([...bat.values()].map((b) => b.R)));
      expect(bat.get(has('title_H')[0]!.playerId!)!.H).toBe(best([...bat.values()].map((b) => b.H)));
      expect(bat.get(has('title_SB')[0]!.playerId!)!.SB).toBe(best([...bat.values()].map((b) => b.SB ?? 0)));
      expect(obp(bat.get(has('title_OBP')[0]!.playerId!)!)).toBeCloseTo(best(qual.map(([, b]) => obp(b))), 9);
      expect(slg(bat.get(has('title_SLG')[0]!.playerId!)!)).toBeCloseTo(best(qual.map(([, b]) => slg(b))), 9);
      expect(avg(bat.get(has('title_AVG')[0]!.playerId!)!)).toBeCloseTo(best(qual.map(([, b]) => avg(b))), 9);
      expect(era(pit.get(has('title_ERA')[0]!.playerId!)!)).toBeLessThanOrEqual(Math.min(...[...pit.values()].filter((p) => p.OUTS >= teamGames * 3).map(era)) + 1e-9);

      // ① 같은 기록이면 같은 수상자: 저장 기록으로 다시 계산하면 같다(시드에서 파생한 투표 편차 포함)
      const svc = (d as unknown as { game(): { awards: { computeSeason(m: unknown, k: string): unknown[]; computeGoldenGlove(m: unknown, date: string): unknown[]; seasonCeremony(m: unknown, k: string): void } } }).game();
      const meta = repo.getMeta();
      // 대상(선수·감독·구단)으로 대조한다. 선수 소속은 시상 뒤 이적으로 바뀔 수 있다
      const strip = (rows: unknown[]) => JSON.stringify((rows as Array<{ award: string; slot: string; playerId: number | null; staffId: number | null; clubId: number }>).map((r) => [r.award, r.slot, r.playerId, r.staffId, r.playerId === null && r.staffId === null ? r.clubId : 0]).sort());
      const kbo = all.filter((a) => !a.award.startsWith('monthly_') && a.award !== 'gg' && a.award !== 'platinum' && !a.award.startsWith('best'));
      // 시즌 마감 뒤 프로 연차·소속이 바뀌기 전 값으로 선정하므로, 그때와 같은 결과인 항목(타이틀·구원상·수비상·기록 달성상)을 대조
      const stable = (rows: unknown[]) => (rows as Array<{ award: string }>).filter((r) => /^(title_|closer|setup|defense|milestone)/.test(r.award));
      expect(strip(stable(svc.awards.computeSeason({ ...meta, season: 2027 }, meta.kDate)))).toBe(strip(stable(kbo)));
      expect(strip(svc.awards.computeGoldenGlove({ ...meta, season: 2027 }, gg))).toBe(strip(all.filter((a) => a.award === 'gg' || a.award === 'platinum' || a.award.startsWith('best'))));
      // 다시 처리해도 중복 시상하지 않는다
      svc.awards.seasonCeremony(meta, meta.kDate);
      expect(repo.getAwards({ season: 2027 }).length).toBe(all.length);
      // 저장 후 불러와도 같다
      await call(d, 'save.save', { slot: 'aw' });
      await call(d, 'save.load', { slot: 'aw' });
      expect(JSON.stringify(d.saves.repository().getAwards({ season: 2027 }))).toBe(JSON.stringify(all));
      expect(checkAwards(d.saves.repository())).toEqual([]);
    } finally {
      d.close();
      cleanup(dir);
    }
  }, 300_000);
});
