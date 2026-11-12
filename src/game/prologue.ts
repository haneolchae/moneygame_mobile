// ③ 구단별 취임 프롤로그(27b v0.2, D-223·D-224·D-238).
// 처음 고른 구단: 시즌편(P1~P13 중 9장, 2/1 캠프 ~ 개막 뒤 첫 달) + 첫 겨울편(W1~W4, 첫 실제 스토브리그 4턴). 두 번째 구단부터는 부임 장면 3개.
// 원칙: 실제 게임 위에서 진행한다. 미션은 실제 명령이 성공했거나(사실 기록) 실제 상태가 바뀌었을 때만 완료다.
// 건너뛰기·기한 경과는 사용자가 할 수 있는 같은 명령(또는 게임 원래 기본 흐름)으로 처리해 결과가 실제 진행과 같다.
// 프롤로그는 진행을 막지 않고, 난수를 쓰지 않는다(회견 답변 효과는 결정적 효과만).
import { diffDays, type GameDate } from '../engine/calendar';
import { MARKETING } from '../engine/config';
import type { CardEffect } from '../engine/events/cards';
import { PROLOGUE, prologueChapter, prologueDate, type PrologueChapterDef, type SceneLine } from '../engine/events/prologue';
import { arcOf } from '../engine/events/story';
import { EOK } from '../engine/money';
import { Rng } from '../engine/rng';
import { stoveTurns } from '../engine/stove';
import type { ClubId, ClubProfile } from '../engine/types';
import { GameError, type PrologueActionResult, type PrologueHistoryView, type PrologueMissionView, type PrologueSceneView, type PrologueView } from '../shared/protocol';
import type { EventState, GameMeta, GameRepository, InboxMessage, PrologueState } from './ports';
import { CLOSE_RULES } from './seasonClose';

/** 미션 사실(실제 명령 성공) 이름 */
export type PrologueFact = 'policy' | 'franchise' | 'advance' | 'approval' | 'scout' | 'roster' | 'cardDelegation' | 'ownFa' | 'hire' | 'budget' | 'live';

export interface PrologueDeps {
  rankOf: () => Map<ClubId, number>;
  managerName: (clubId: ClubId) => string;
  vacancies: (meta: GameMeta) => number;
  pendingApprovals: () => number;
  /** EventOps.applyEffects(같은 효과 모델) */
  apply: (effects: readonly CardEffect[], ctx: { meta: GameMeta; date: GameDate; clubId: ClubId; playerId: null; rng: Rng; week: number; cardId: string; state: EventState }) => string[];
  describe: (meta: GameMeta, e: CardEffect) => string | null;
  /** 간판 외야수 협상을 운영팀에 맡기는 실제 명령(구단주 [운영팀에 맡기기]와 같은 경로) */
  delegateFranchise: (meta: GameMeta, playerId: number) => string;
}

const md = (d: GameDate) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const short = (d: GameDate) => d.slice(5).replace('-', '/');
const weekNo = (date: GameDate) => Math.floor(diffDays(date, '2000-01-03') / 7);

/** 장 건너뛰기 기본 처리 설명 */
const DEFAULT_NOTE: Record<string, string> = {
  answer: '기본 답변(신중)으로 답합니다',
  delegateFranchise: '운영팀에 협상을 맡깁니다(운영팀 기본 한도)',
};
const FLOW_NOTE: Record<string, string> = {
  ack: '확인한 것으로 넘어갑니다',
  policy: '지금 위임 정책을 그대로 둡니다',
  advance: '다음 진행 때 그대로 넘어갑니다(결재 대기는 기한에 만료)',
  scout: '조사하지 않습니다',
  roster: '감독 자동 운영 엔트리로 개막합니다',
  cardLive: '결정 카드는 그대로 답해야 하고, 관전은 하지 않습니다',
  cardDelegation: '지금 위임 설정을 그대로 둡니다',
  ownFa: '운영팀이 정책대로 우리 FA 안건을 올립니다',
  sponsorMain: '사업제휴팀 기본 계약 흐름대로 갑니다',
  hireBudget: '공석은 그대로, 예산안은 시즌 시작 때 경영지원팀이 편성합니다',
  campRoster: '4턴 끝에 감독 추천안으로 캠프 명단을 확정합니다',
};

export class PrologueOps {
  constructor(
    private readonly repo: GameRepository,
    private readonly clubs: Map<ClubId, ClubProfile>,
    private readonly deps: PrologueDeps,
  ) {}

  private state(): PrologueState | null {
    return this.repo.getMetaValue<PrologueState | null>('prologue') ?? null;
  }

  private save(st: PrologueState): void {
    this.repo.updateMeta({ prologue: st });
  }

  private active(st: PrologueState | null, meta: GameMeta): st is PrologueState {
    return !!st && !st.ended && st.clubId === meta.userClubId && !meta.gameOver;
  }

  // ───────── 시작 ─────────

  /** 새 게임(처음 고른 구단): 2/1 캠프 취임과 함께 시즌편 시작 */
  startFull(meta: GameMeta): void {
    if (!PROLOGUE) return;
    this.save({ kind: 'full', clubId: meta.userClubId, startSeason: meta.season, startDate: meta.currentDate, hints: true, parts: { season: 'active', winter: 'pending' }, winterStart: null, chapters: {}, seen: {}, facts: {}, answer: null, ended: null });
  }

  /** 해임 뒤 다른 구단 부임: 부임 장면 3개(조작은 이미 배웠다고 본다). 이전 프롤로그는 다시 보기용으로 남긴다 */
  startArrival(meta: GameMeta): void {
    if (!PROLOGUE) return;
    const prev = this.state();
    const past = [...(meta.prologuePast ?? [])];
    if (prev) past.push(prev.ended ? prev : { ...prev, ended: { date: meta.currentDate, reason: 'clubChange' } });
    this.repo.updateMeta({
      prologuePast: past,
      prologue: { kind: 'arrival', clubId: meta.userClubId, startSeason: meta.season, startDate: meta.currentDate, hints: prev?.hints ?? true, parts: { season: 'none', winter: 'none' }, winterStart: null, chapters: {}, seen: {}, facts: {}, answer: null, ended: null },
    });
  }

  // ───────── 사실 기록·판정 ─────────

  /** 실제 명령이 성공한 뒤 부른다(서비스 명령 경로). 진행 중이 아니면 아무것도 하지 않는다 */
  note(fact: PrologueFact): void {
    const meta = this.repo.getMeta();
    const st = this.state();
    if (!this.active(st, meta) || st.kind !== 'full') return;
    st.facts[fact] = meta.currentDate;
    this.save(st);
    this.refresh();
  }

  /** 하루 처리 끝·명령 뒤: 첫 겨울편 시작, 미션 판정(실제 상태), 기한 경과 처리, 편 종료 */
  refresh(): void {
    const meta = this.repo.getMeta();
    const st = this.state();
    if (!this.active(st, meta)) return;
    const date = meta.currentDate;
    // 진행 중인 편이 없고 첫 겨울편을 시작할 때도 아니면 할 일이 없다(매일 부르므로 저장하지 않는다)
    const winterDue = st.parts.winter === 'pending' && meta.mode === 'stove';
    if (st.kind === 'full' && st.parts.season !== 'active' && st.parts.winter !== 'active' && !winterDue) return;
    const before = JSON.stringify(st);
    const inbox: InboxMessage[] = [];
    if (st.kind === 'arrival') {
      if (PROLOGUE!.arrival.every((a) => st.seen[a.id])) {
        st.ended = { date, reason: 'complete' };
        this.save(st);
      }
      return;
    }
    // 첫 겨울편: 첫 시즌 뒤 스토브리그 1턴부터
    if (st.parts.winter === 'pending' && meta.mode === 'stove' && Number(meta.kDate.slice(0, 4)) === st.startSeason) {
      if (st.parts.season === 'active') this.finishPart(st, 'season', date, inbox);
      st.parts.winter = 'active';
      st.winterStart = stoveTurns(meta.kDate)[0]!.start;
      inbox.push({ date, kind: 'task', sender: '비서', title: '프롤로그 첫 겨울편 시작', body: '첫 실제 스토브리그입니다. 구단 현황의 프롤로그 안내에서 장면과 미션을 볼 수 있습니다. 설명만 끄거나, 장 또는 첫 겨울편 전체를 건너뛸 수 있습니다.' });
    }
    for (const part of ['season', 'winter'] as const) {
      if (st.parts[part] !== 'active') continue;
      for (const ch of this.chaptersOf(part)) {
        if (st.chapters[ch.id]) continue;
        const w = this.window(st, meta, ch);
        if (!w || date < w.from) continue;
        if (this.satisfied(st, meta, ch, w.from)) st.chapters[ch.id] = { status: 'done', date, how: this.doneHow(ch) };
        else if (date > w.until || this.unreachable(meta, ch)) {
          // 기한 경과: 회견 답변만 기본 답변을 적용하고, 나머지는 게임 원래 기본 흐름(이미 적용됨)에 맡긴다
          const how = ch.default === 'answer' ? this.applyAnswer(st, meta, PROLOGUE!.answerDefault) : FLOW_NOTE[ch.mission] ?? '기본 흐름';
          st.chapters[ch.id] = { status: 'missed', date, how: `기한 경과 — ${how}` };
        }
      }
      if (this.chaptersOf(part).every((ch) => st.chapters[ch.id])) this.finishPart(st, part, date, inbox);
    }
    if (JSON.stringify(st) !== before) this.save(st);
    if (inbox.length) this.repo.addInbox(inbox);
  }

  private finishPart(st: PrologueState, part: 'season' | 'winter', date: GameDate, inbox: InboxMessage[]): void {
    for (const ch of this.chaptersOf(part)) st.chapters[ch.id] ??= { status: 'missed', date, how: `편 종료 — ${FLOW_NOTE[ch.mission] ?? '기본 흐름'}` };
    if (st.parts[part] === 'active') st.parts[part] = 'done';
    if (part === 'season') {
      inbox.push({ date, kind: 'report', sender: '비서', title: '프롤로그 시즌편 끝', body: '시즌편이 끝났습니다. 첫 겨울편은 이번 시즌이 끝난 뒤 첫 스토브리그 1턴에 시작합니다. 본 장면은 명예의 전당 \'구단 서사\'에서 다시 볼 수 있습니다.' });
      return;
    }
    const complete = st.parts.season === 'done' && st.parts.winter === 'done';
    st.ended = { date, reason: complete ? 'complete' : 'skipped' };
    inbox.push({ date, kind: 'report', sender: '비서', title: '프롤로그 끝 — 첫 겨울을 넘기다', body: complete ? '시즌편과 첫 겨울편을 모두 마쳤습니다. 업적 \'첫 겨울을 넘기다\'가 다음 판정일에 기록됩니다.\n이제부터는 구단 스토리 본편이 이어집니다.' : '프롤로그가 끝났습니다(건너뛴 편이 있어 업적은 없습니다. 게임상 불이익은 없습니다).\n이제부터는 구단 스토리 본편이 이어집니다.' });
  }

  private chaptersOf(part: 'season' | 'winter'): PrologueChapterDef[] {
    return PROLOGUE!.chapters.filter((c) => c.part === part);
  }

  /** 장 시기(날짜). 첫 겨울편은 그 턴 첫날 ~ untilTurn(없으면 같은 턴) 끝 */
  private window(st: PrologueState, meta: GameMeta, ch: PrologueChapterDef): { from: GameDate; until: GameDate } | null {
    if (ch.part === 'season') return { from: prologueDate(ch.from!, st.startSeason), until: prologueDate(ch.until!, st.startSeason) };
    if (st.parts.winter !== 'active' || meta.mode !== 'stove') return null;
    const turns = stoveTurns(meta.kDate);
    return { from: turns[ch.turn! - 1]!.start, until: turns[(ch.untilTurn ?? ch.turn!) - 1]!.end };
  }

  /** 미션 판정: 실제 명령 사실(이 편 시작 뒤) 또는 실제 상태 */
  private satisfied(st: PrologueState, meta: GameMeta, ch: PrologueChapterDef, from: GameDate): boolean {
    const since = ch.part === 'winter' ? (st.winterStart ?? from) : st.startDate;
    const fact = (k: PrologueFact) => !!st.facts[k] && st.facts[k]! >= since;
    const club = meta.userClubId;
    switch (ch.mission) {
      case 'answer':
        return st.answer !== null;
      case 'ack':
        return !!st.seen[ch.id];
      case 'policy':
        return fact('policy');
      case 'franchise':
        return fact('franchise') || !meta.firstAgenda;
      case 'advance':
        return fact('advance') && (fact('approval') || this.deps.pendingApprovals() === 0);
      case 'scout':
        return fact('scout');
      case 'roster':
        return fact('roster');
      case 'cardLive': {
        const week = prologueDate(ch.from!, st.startSeason);
        const card = this.repo.getEventLog({ season: st.startSeason }).some((r) => r.weekId >= week);
        // 관전: [경기 보기]로 본 우리 경기가 그날 확정된 사실(개막 주 이후)
        return card && !!st.facts.live && st.facts.live >= week;
      }
      case 'cardDelegation':
        return fact('cardDelegation');
      case 'ownFa': {
        if (fact('ownFa')) return true;
        // FA 공시 뒤 우리 FA(신청·승인)가 없으면 할 일이 없다
        const fa = this.repo.getFa(Number(meta.kDate.slice(0, 4)));
        return fa.length > 0 && !fa.some((e) => e.originClub === club && (e.status === 'applied' || e.status === 'approved'));
      }
      case 'sponsorMain':
        return (meta.sponsors?.[String(club)] ?? []).some((s) => s.season === st.startSeason + 1 && s.slot === 'main');
      case 'hireBudget':
        return (fact('hire') || this.deps.vacancies(meta) === 0) && fact('budget');
      case 'campRoster':
        return !!st.seen[ch.id] && this.repo.getPlayers().filter((p) => p.clubId === club && !p.retired).length <= 40;
    }
  }

  /** 기한 전이라도 더는 할 수 없는 미션(간판 외야수가 이미 계약·시장 재진입) */
  private unreachable(meta: GameMeta, ch: PrologueChapterDef): boolean {
    return ch.mission === 'franchise' && !!meta.firstAgenda && meta.firstAgenda.status !== 'open';
  }

  private doneHow(ch: PrologueChapterDef): string {
    const how: Record<string, string> = {
      answer: '회견 답변', ack: '확인', policy: '위임 정책 저장', franchise: '간판 외야수 협상·위임', advance: '진행·결재', scout: '선수 조사', roster: '선수단 운영 저장',
      cardLive: '결정 카드 처리·경기 관전', cardDelegation: '결정 카드 위임 설정', ownFa: '우리 FA 협상·지시서', sponsorMain: '메인 스폰서 계약', hireBudget: '채용·예산안', campRoster: '캠프 명단 확인',
    };
    return how[ch.mission] ?? '완료';
  }

  /** 회견 답변: 결정적 효과(팬 만족도·언론 관계)를 결정 카드와 같은 효과 모델로 적용한다 */
  private applyAnswer(st: PrologueState, meta: GameMeta, answerId: string): string {
    const a = PROLOGUE!.answers.find((x) => x.id === answerId)!;
    const state = structuredClone(meta.eventState ?? ({} as EventState));
    this.deps.apply(a.effects, { meta, date: meta.currentDate, clubId: meta.userClubId, playerId: null, rng: Rng.derive(meta.seed, 'prologue'), week: weekNo(meta.currentDate), cardId: 'PROLOGUE-P1', state });
    st.answer = a.id;
    return `답변 '${a.label}'`;
  }

  // ───────── 구단주 조작(행동력 0) ─────────

  /** 장면 확인(다음). P1은 답변을 고른다 */
  ack(chapterId: string, answerId?: string): PrologueActionResult {
    const meta = this.repo.getMeta();
    const st = this.state();
    if (!this.active(st, meta)) throw new GameError('NOT_AVAILABLE', '진행 중인 프롤로그가 없습니다.');
    const scene = this.sceneQueue(st, meta)[0];
    if (!scene || scene.id !== chapterId) throw new GameError('NOT_AVAILABLE', '지금 볼 장면이 아닙니다.');
    let message = '다음 장면으로 넘어갑니다.';
    return this.repo.transaction(() => {
      if (st.kind === 'full' && prologueChapter(chapterId)?.mission === 'answer' && st.answer === null) {
        if (!answerId || !PROLOGUE!.answers.some((a) => a.id === answerId)) throw new GameError('INVALID', '답변을 고르세요.');
        message = `${this.applyAnswer(st, meta, answerId)}으로 답했습니다.`;
      }
      st.seen[chapterId] = meta.currentDate;
      this.save(st);
      this.refresh();
      return { message, summary: [], view: this.view(this.repo.getMeta()) };
    });
  }

  /** 건너뛰기: chapter = 그 장 미션을 담당자 기본 처리로, part = 이 편 남은 미션 전체를 기본 처리(요약 1장) */
  skip(scope: 'chapter' | 'part', chapterId?: string): PrologueActionResult {
    const meta = this.repo.getMeta();
    const st = this.state();
    if (!this.active(st, meta)) throw new GameError('NOT_AVAILABLE', '진행 중인 프롤로그가 없습니다.');
    return this.repo.transaction(() => {
      const summary: string[] = [];
      if (st.kind === 'arrival') {
        for (const a of PROLOGUE!.arrival) st.seen[a.id] ??= meta.currentDate;
        st.ended = { date: meta.currentDate, reason: 'skipped' };
        this.save(st);
        return { message: '부임 장면을 건너뛰었습니다.', summary, view: null };
      }
      const part = st.parts.winter === 'active' ? 'winter' : st.parts.season === 'active' ? 'season' : null;
      if (!part) throw new GameError('NOT_AVAILABLE', '건너뛸 편이 없습니다.');
      const targets = scope === 'part' ? this.chaptersOf(part).filter((c) => !st.chapters[c.id]) : this.chaptersOf(part).filter((c) => c.id === chapterId && !st.chapters[c.id]);
      if (!targets.length) throw new GameError('NOT_AVAILABLE', '건너뛸 장이 없습니다.');
      if (scope === 'chapter') {
        const w = this.window(st, meta, targets[0]!);
        if (!w || meta.currentDate < w.from) throw new GameError('NOT_AVAILABLE', '아직 시작하지 않은 장입니다.');
      }
      for (const ch of targets) {
        const how = this.applyDefault(st, meta, ch);
        st.chapters[ch.id] = { status: 'skipped', date: meta.currentDate, how };
        summary.push(`${ch.id} ${ch.title}: ${how}`);
      }
      if (scope === 'part') {
        st.parts[part] = 'skipped';
        const inbox: InboxMessage[] = [];
        if (part === 'winter') this.finishPart(st, 'winter', meta.currentDate, inbox);
        this.save(st);
        if (inbox.length) this.repo.addInbox(inbox);
      } else this.save(st);
      this.refresh();
      const label = scope === 'part' ? (part === 'season' ? '시즌편' : '첫 겨울편') : `${targets[0]!.id} ${targets[0]!.title}`;
      return { message: `${label}을 건너뛰었습니다.${part === 'season' && scope === 'part' ? ' 첫 겨울편은 첫 스토브리그에서 따로 보거나 건너뛸 수 있습니다.' : ''}`, summary, view: this.view(this.repo.getMeta()) };
    });
  }

  /** 담당자 기본 처리: 사용자가 할 수 있는 같은 명령. 명령이 없거나 못 하면 게임 기본 흐름에 맡긴다 */
  private applyDefault(st: PrologueState, meta: GameMeta, ch: PrologueChapterDef): string {
    if (ch.default === 'answer') return st.answer === null ? this.applyAnswer(st, meta, PROLOGUE!.answerDefault) : '이미 답변함';
    if (ch.default === 'delegateFranchise') {
      const fa = meta.firstAgenda;
      if (!fa || fa.status !== 'open') return '첫 안건이 이미 끝났습니다';
      if (this.repo.getTasks({ status: ['queued', 'waiting'], kind: 'fa' }).some((t) => t.targetId === fa.playerId)) return '이미 운영팀이 협상 중입니다';
      try {
        return this.deps.delegateFranchise(meta, fa.playerId);
      } catch (e) {
        return `운영팀에 맡기지 못했습니다(${(e as Error).message}) — 마감 규칙대로 처리됩니다`;
      }
    }
    return FLOW_NOTE[ch.mission] ?? '기본 흐름';
  }

  /** 설명 끄기·켜기(스토리 장면은 유지) */
  setHints(hints: boolean): PrologueActionResult {
    const meta = this.repo.getMeta();
    const st = this.state();
    if (!this.active(st, meta)) throw new GameError('NOT_AVAILABLE', '진행 중인 프롤로그가 없습니다.');
    st.hints = hints === true;
    this.save(st);
    return { message: st.hints ? '설명을 켰습니다.' : '설명을 껐습니다. 스토리 장면과 미션은 그대로 나옵니다.', summary: [], view: this.view(meta) };
  }

  // ───────── 화면 응답 ─────────

  /** 아직 보지 않은 장면(시기가 된 장, 건너뛰거나 기한이 지난 장 제외) */
  private sceneQueue(st: PrologueState, meta: GameMeta): Array<{ id: string; title: string; lines: readonly SceneLine[]; answer: boolean }> {
    if (st.kind === 'arrival') return PROLOGUE!.arrival.filter((a) => !st.seen[a.id]).map((a) => ({ id: a.id, title: a.title, lines: a.lines, answer: false }));
    const club = PROLOGUE!.clubs[String(st.clubId)];
    const out: Array<{ id: string; title: string; lines: readonly SceneLine[]; answer: boolean }> = [];
    for (const part of ['season', 'winter'] as const) {
      if (st.parts[part] !== 'active') continue;
      for (const ch of this.chaptersOf(part)) {
        if (st.seen[ch.id]) continue;
        const done = st.chapters[ch.id];
        if (done && done.status !== 'done') continue;
        const w = this.window(st, meta, ch);
        if (!w || meta.currentDate < w.from) continue;
        out.push({ id: ch.id, title: ch.title, lines: club?.scenes[ch.id] ?? ch.lines, answer: ch.mission === 'answer' && st.answer === null });
      }
    }
    return out;
  }

  /** 대사 자리표시자 채우기(현재 데이터, 난수 없음) */
  private fill(meta: GameMeta, st: PrologueState, text: string): string {
    const club = this.clubs.get(st.clubId)!;
    const def = PROLOGUE!.clubs[String(st.clubId)]!;
    const arc = arcOf(st.clubId);
    const story = meta.stories?.[String(st.clubId)];
    const franchiseId = meta.firstAgenda?.playerId ?? story?.cast.franchise ?? null;
    const values: Record<string, () => string> = {
      club: () => club.shortName,
      clubFull: () => club.name,
      city: () => club.city,
      player: () => (franchiseId !== null ? (this.repo.getPlayer(franchiseId)?.name ?? '간판 외야수') : '간판 외야수'),
      manager: () => this.deps.managerName(st.clubId) || '',
      chairman: () => def.chairman,
      chairmanLine: () => def.chairmanLine,
      arrivalLine: () => def.arrivalLine,
      question: () => def.question,
      reporter: () => PROLOGUE!.reporter,
      goal: () => String(meta.seasonGoal?.season === meta.season ? meta.seasonGoal.expectedRank : '?'),
      arc: () => arc?.title ?? '',
      task: () => arc?.task ?? '',
      cash: () => `${Math.round(this.repo.cashBalance(st.clubId) / EOK)}억`,
      date: () => md(meta.currentDate),
      deadline: () => (meta.firstAgenda ? short(meta.firstAgenda.deadline) : ''),
      dismissMisses: () => String(CLOSE_RULES.dismissAfterMisses),
      fanFloor: () => String(MARKETING.backlashBelow),
      fanWeeks: () => String(MARKETING.dismissWeeks),
      rank: () => String(this.deps.rankOf().get(st.clubId) ?? '?'),
      roster: () => String(this.repo.getPlayers().filter((p) => p.clubId === st.clubId && !p.retired).length),
      act: () => String(!story ? 1 : story.ending ? 3 : story.seasons.length >= 1 ? 2 : 1),
    };
    let out = text;
    for (let pass = 0; pass < 2 && /\{\w+\}/.test(out); pass++) out = out.replace(/\{(\w+)\}/g, (m, k: string) => values[k]?.() ?? m);
    return out.replace(/^ 감독/, '감독').trim();
  }

  private lines(meta: GameMeta, st: PrologueState, lines: readonly SceneLine[]) {
    return lines.map(([speaker, text]) => ({ speaker: this.fill(meta, st, speaker).trim(), text: this.fill(meta, st, text) }));
  }

  view(meta: GameMeta = this.repo.getMeta()): PrologueView | null {
    const st = this.state();
    if (!this.active(st, meta) || !PROLOGUE) return null;
    const def = PROLOGUE.clubs[String(st.clubId)];
    const queue = this.sceneQueue(st, meta);
    const head = queue[0];
    const scene: PrologueSceneView | null = head
      ? {
          id: head.id,
          title: head.title,
          lines: this.lines(meta, st, head.lines),
          answers: head.answer ? PROLOGUE.answers.map((a) => ({ id: a.id, label: a.label, text: this.fill(meta, st, a.text), effects: a.effects.map((e) => this.deps.describe(meta, e)).filter((x): x is string => !!x), isDefault: a.id === PROLOGUE!.answerDefault })) : null,
        }
      : null;
    if (st.kind === 'arrival') {
      return { kind: 'arrival', part: 'arrival', partTitle: PROLOGUE.parts.arrival, clubTitle: def?.title ?? '', hints: st.hints, scene, missions: [], progress: { done: PROLOGUE.arrival.filter((a) => st.seen[a.id]).length, total: PROLOGUE.arrival.length }, next: null };
    }
    const part = st.parts.winter === 'active' ? 'winter' : st.parts.season === 'active' ? 'season' : null;
    if (!part) return null;
    const chapters = this.chaptersOf(part);
    const missions: PrologueMissionView[] = [];
    let next: PrologueView['next'] = null;
    for (const ch of chapters) {
      const w = this.window(st, meta, ch);
      const rec = st.chapters[ch.id];
      if (!w || meta.currentDate < w.from) {
        if (!rec && !next && w) next = { title: `${ch.id} ${ch.title}`, when: md(w.from) };
        if (!rec && !next && !w) next = { title: `${ch.id} ${ch.title}`, when: `${ch.turn}턴` };
        if (!rec) continue;
      }
      // 완료된 장은 이번 편 진행 목록에 남기고, 시작 전 장은 다음 장 안내로만
      missions.push({
        id: ch.id,
        title: ch.title,
        mission: this.fill(meta, st, ch.missionText),
        status: rec?.status ?? 'active',
        how: rec?.how ?? null,
        until: w ? short(w.until) : null,
        learn: st.hints ? ch.learn.map((l) => this.fill(meta, st, l)) : [],
        targets: st.hints ? ch.targets : [],
        defaultNote: ch.default ? DEFAULT_NOTE[ch.default]! : (FLOW_NOTE[ch.mission] ?? ''),
      });
    }
    return { kind: 'full', part, partTitle: PROLOGUE.parts[part], clubTitle: def?.title ?? '', hints: st.hints, scene, missions, progress: { done: chapters.filter((c) => st.chapters[c.id]).length, total: chapters.length }, next };
  }

  /** 본 장면 다시 보기(지금·이전 구단). 난수를 쓰지 않고 결과도 바꾸지 않는다 */
  history(meta: GameMeta = this.repo.getMeta()): PrologueHistoryView {
    if (!PROLOGUE) return { entries: [] };
    const all = [...(meta.prologuePast ?? []), ...(this.state() ? [this.state()!] : [])];
    const entries: PrologueHistoryView['entries'] = [];
    for (const st of all) {
      const def = PROLOGUE.clubs[String(st.clubId)];
      const club = this.clubs.get(st.clubId);
      if (!def || !club) continue;
      const scenes = st.kind === 'arrival' ? PROLOGUE.arrival.map((a) => ({ id: a.id, title: a.title, part: PROLOGUE!.parts.arrival, lines: a.lines as readonly SceneLine[] })) : PROLOGUE.chapters.map((c) => ({ id: c.id, title: c.title, part: PROLOGUE!.parts[c.part], lines: def.scenes[c.id] ?? c.lines }));
      for (const s of scenes) {
        if (!st.seen[s.id]) continue;
        const ans = s.id === 'P1' && st.answer ? PROLOGUE.answers.find((a) => a.id === st.answer) : null;
        entries.push({ clubTitle: def.title, club: club.shortName, part: s.part, id: s.id, title: s.title, date: st.seen[s.id]!, lines: this.lines(meta, st, s.lines), answer: ans ? `${ans.label} — ${this.fill(meta, st, ans.text)}` : null, status: st.chapters[s.id]?.how ?? null });
      }
    }
    return { entries };
  }

  /** 개막 주 결정 카드 공란 없음(27b P12, 튜토리얼 예외). 프롤로그를 건너뛰어도 같게 적용해 결과가 진행 방식과 무관하다(D-238) */
  guaranteedCardWeek(meta: GameMeta, monday: GameDate): boolean {
    const st = meta.prologue ?? meta.prologuePast?.find((p) => p.kind === 'full') ?? null;
    if (!st || st.kind !== 'full' || meta.season !== st.startSeason) return false;
    return monday === prologueDate('openingWeek', st.startSeason);
  }
}
