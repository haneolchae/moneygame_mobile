// D-250: '끝까지' 진행의 카드 기본 선택 옵션, 첫 안건 패널은 취임 첫 시즌에만
import { afterEach, describe, expect, it } from 'vitest';
import { call, cleanup, makeDispatcher, tempDir } from './helpers';

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
  while (dirs.length) cleanup(dirs.pop()!);
});

describe('진행 옵션 (D-250)', () => {
  it('카드 기본 선택: 시작 때 떠 있던 카드는 그대로 막고, 진행 중 새 카드는 기본 선택으로 넘기며 스토리·중대 사건에서만 멈춘다', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const d = makeDispatcher(dir);
    closers.push(() => d.close());
    await call(d, 'game.new', { clubId: 8, saveName: 't', seed: 'advance-options', start: 'camp' });
    const first = (await call(d, 'game.dashboard')).firstAgenda;
    expect(first).not.toBeNull();

    // 시작 때 이미 떠 있는 카드: 옵션을 켜도 고르기 전에는 진행하지 않는다
    const pending = (await call(d, 'game.dashboard')).card;
    expect(pending).not.toBeNull();
    const blocked = await d.respond('game.advance', { mode: 'untilSeasonEnd', defaultCards: true });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('DECISION_PENDING');

    // 옵션 없이: 카드를 고른 뒤 끝까지 진행하면 다음 카드에서 멈춘다
    await call(d, 'events.choose', { choiceId: pending!.choices[0]!.id });
    const plain = await d.respond('game.advance', { mode: 'untilSeasonEnd' });
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.result.phase).not.toBe('postseason');

    // 옵션을 켜면 일반 결정 카드는 기본 선택으로 넘어가고, 멈추는 곳은 구단 스토리·중대 사건뿐이다
    let defaulted = 0;
    let stops = 0;
    for (let guard = 0; guard < 40; guard++) {
      const dash = await call(d, 'game.dashboard');
      if (dash.phase === 'postseason') break;
      if (dash.card) {
        if (guard > 0) expect(dash.card.major || dash.card.category === 'story', `멈춘 카드 ${dash.card.cardId}`).toBe(true);
        await call(d, 'events.choose', { choiceId: dash.card.choices[0]!.id });
        stops++;
        continue;
      }
      const r = await d.respond('game.advance', { mode: 'untilSeasonEnd', defaultCards: true });
      expect(r.ok).toBe(true);
      if (r.ok) defaulted += r.result.defaultedCards ?? 0;
    }
    expect((await call(d, 'game.dashboard')).phase).toBe('postseason');
    expect(defaulted).toBeGreaterThanOrEqual(10);
    expect(stops).toBeLessThan(12);
    // 기본 선택으로 넘긴 카드는 구단주 선택으로 뉴스 로그에 남는다
    const log = d.saves.repository().getEventLog({ season: 2027 });
    expect(log.filter((x) => x.by === 'owner').length).toBeGreaterThanOrEqual(defaulted);

    // 첫 안건 패널은 취임 첫 시즌에만
    d.saves.repository().updateMeta({ season: 2028 });
    expect((await call(d, 'game.dashboard')).firstAgenda).toBeNull();
  }, 300_000);
});
