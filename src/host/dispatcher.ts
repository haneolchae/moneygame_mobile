// 요청 처리기: 화면 요청을 게임 진행·저장 계층으로 연결한다.
// Electron 워커, 헤드리스 CLI, 테스트가 모두 이 클래스를 쓴다(실행 방식은 엔진 밖에 둔다).
import { clubById } from '../engine/clubs';
import { createNewGame, clubOptions, GameService } from '../game/service';
import { SaveError, SaveManager } from '../persistence/saves';
import { GameError, type AdvanceResult, type ApiResponse, type PlatformStatus, type ProgressEvent, type RequestMap, type RequestName, type SaveSlotInfo } from '../shared/protocol';

export interface DispatcherOptions {
  baseDir: string;
  platform: () => PlatformStatus;
  onEvent?: (e: ProgressEvent) => void;
  now?: () => string;
}

export class Dispatcher {
  readonly saves: SaveManager;
  private service: GameService | null = null;

  constructor(private readonly opts: DispatcherOptions) {
    this.saves = new SaveManager(opts.baseDir, undefined, opts.now);
  }

  private now(): string {
    return this.opts.now?.() ?? new Date().toISOString();
  }

  private game(): GameService {
    if (!this.service) {
      if (!this.saves.hasSession()) throw new GameError('NO_GAME', '진행 중인 게임이 없습니다. 새 게임을 시작하거나 저장본을 불러오세요.');
      this.service = new GameService(this.saves.repository());
    }
    return this.service;
  }

  private dashboard() {
    const repo = this.saves.repository();
    return this.game().dashboard({
      unsavedDays: repo.getMetaValue<number>('unsavedDays') ?? 0,
      lastSavedAt: repo.getMetaValue<string | null>('lastSavedAt') ?? null,
    });
  }

  private toSlotInfo(s: ReturnType<SaveManager['list']>[number]): SaveSlotInfo {
    let clubName = '';
    try {
      clubName = s.clubId ? clubById(s.clubId).name : '';
    } catch {
      clubName = '';
    }
    return { slot: s.slot, name: s.name, season: s.season, date: s.date, clubName, savedAt: s.savedAt, schemaVersion: s.schemaVersion, sizeBytes: s.sizeBytes, backups: s.backups, status: s.status, message: s.message };
  }

  async handle<K extends RequestName>(name: K, payload: RequestMap[K]['payload']): Promise<RequestMap[K]['result']> {
    type R = RequestMap[K]['result'];
    switch (name) {
      case 'app.status': {
        const rec = this.saves.hasSession() ? null : this.saves.inspectRecoverableSession();
        return {
          hasActiveGame: this.saves.hasSession(),
          recoverableSession: rec ? { saveName: rec.name, date: rec.date, clubName: clubById(rec.clubId).name } : null,
          platform: this.opts.platform(),
        } as R;
      }
      case 'game.clubOptions':
        return clubOptions() as R;
      case 'game.new': {
        const p = payload as RequestMap['game.new']['payload'];
        const name = p.saveName.trim() || '새 게임';
        const repo = this.saves.createSession();
        this.service = null;
        createNewGame(repo, { clubId: p.clubId, saveName: name.slice(0, 40), seed: p.seed, createdAt: this.now(), start: p.start, onProgress: (prog) => this.opts.onEvent?.({ type: 'advanceProgress', ...prog }) });
        this.service = new GameService(repo);
        return this.dashboard() as R;
      }
      case 'game.dashboard':
        return this.dashboard() as R;
      case 'game.advance': {
        const p = payload as RequestMap['game.advance']['payload'];
        const started = Date.now();
        const result = this.game().advance(p.mode, (prog) => this.opts.onEvent?.({ type: 'advanceProgress', ...prog }), undefined, !!p.autoCards);
        const autosaveDue = this.saves.noteDaysAdvanced(result.daysProcessed);
        let autosaved = false;
        // D-220: 스토브리그 자동 저장은 턴 단위(턴 진행이 끝날 때마다)
        const turnEnd = p.mode === 'turn' && /끝 — 구간 보고/.test(result.stoppedReason ?? '');
        if ((autosaveDue && this.game().meta().mode === 'season') || turnEnd || result.stoppedReason?.startsWith('정규시즌 종료') || result.stoppedReason?.startsWith('스토브리그 종료')) {
          this.saves.save('autosave', 'auto');
          autosaved = true;
        }
        const meta = this.game().meta();
        const out: AdvanceResult = { ...result, date: meta.currentDate, phase: this.game().phase(meta), autosaved, elapsedMs: Date.now() - started };
        return out as R;
      }
      case 'game.players':
        return this.game().players(payload as RequestMap['game.players']['payload']) as R;
      case 'game.player':
        return this.game().player((payload as RequestMap['game.player']['payload']).playerId) as R;
      case 'player.note': {
        const p = payload as RequestMap['player.note']['payload'];
        return this.game().savePlayerNote(p.playerId, p.text, p.watched, this.now()) as R;
      }
      case 'player.scout':
        return this.game().scoutPlayer((payload as RequestMap['player.scout']['payload']).playerId) as R;
      case 'club.view':
        return this.game().clubView((payload as RequestMap['club.view']['payload']).clubId) as R;
      case 'club.note': {
        const p = payload as RequestMap['club.note']['payload'];
        return this.game().saveClubNote(p.clubId, p.text, p.rival, this.now()) as R;
      }
      case 'business.view':
        return this.game().businessView() as R;
      case 'business.setTicketPolicy':
        return this.game().setTicketPolicy((payload as RequestMap['business.setTicketPolicy']['payload']).policy) as R;
      case 'business.startFacility':
        return this.game().startFacility((payload as RequestMap['business.startFacility']['payload']).kind) as R;
      case 'events.choose':
        return this.game().chooseCard((payload as RequestMap['events.choose']['payload']).choiceId) as R;
      case 'events.delegation':
        return this.game().cardDelegation() as R;
      case 'events.setDelegation': {
        const q = payload as RequestMap['events.setDelegation']['payload'];
        return this.game().setCardDelegation(q.category, q.delegate) as R;
      }
      case 'events.force': {
        // 26a D1: 개발 모드(FO_DEV=1)에서만
        if (process.env.FO_DEV !== '1') throw new GameError('NOT_AVAILABLE', '개발 모드에서만 쓸 수 있습니다.');
        const q = payload as RequestMap['events.force']['payload'];
        return this.game().forceCard(q.cardId, q.playerId ?? null) as R;
      }
      case 'events.news':
        return this.game().newsLog((payload as RequestMap['events.news']['payload']).season) as R;
      case 'allStar.view':
        return this.game().allStarView((payload as RequestMap['allStar.view']['payload']).season) as R;
      case 'allStar.campaign':
        return this.game().allStarCampaign() as R;
      case 'allStar.apply':
        return this.game().allStarApply() as R;
      case 'business.startCampaign':
        return this.game().startCampaign((payload as RequestMap['business.startCampaign']['payload']).kind) as R;
      case 'business.signSponsor':
        return this.game().signSponsor((payload as RequestMap['business.signSponsor']['payload']).offerId) as R;
      case 'business.chooseVendor': {
        const p = payload as RequestMap['business.chooseVendor']['payload'];
        return this.game().chooseVendor(p.kind, p.brandId) as R;
      }
      case 'business.orderMerch': {
        const p = payload as RequestMap['business.orderMerch']['payload'];
        return this.game().orderMerch(p.sku, p.qty) as R;
      }
      case 'business.setMerchPolicy': {
        const p = payload as RequestMap['business.setMerchPolicy']['payload'];
        return this.game().setMerchPolicy(p.auto, p.targetWeeks) as R;
      }
      case 'business.cancelFacility':
        return this.game().cancelFacility((payload as RequestMap['business.cancelFacility']['payload']).kind) as R;
      case 'trade.view':
        return this.game().tradeView((payload as RequestMap['trade.view']['payload']).clubId) as R;
      case 'trade.preview': {
        const p = payload as RequestMap['trade.preview']['payload'];
        return this.game().tradePreview(p.clubId, p) as R;
      }
      case 'trade.propose': {
        const p = payload as RequestMap['trade.propose']['payload'];
        return this.game().tradePropose(p.clubId, p, p.commandId) as R;
      }
      case 'trade.acceptCounter': {
        const p = payload as RequestMap['trade.acceptCounter']['payload'];
        return this.game().tradeAcceptCounter(p.clubId, p.commandId) as R;
      }
      case 'trade.offers':
        return this.game().tradeOffersView() as R;
      case 'live.view':
        return this.game().liveView() as R;
      case 'live.start':
        return this.game().liveStart() as R;
      case 'live.decide':
        return this.game().liveDecide((payload as RequestMap['live.decide']['payload']).choice) as R;
      case 'live.settings':
        return this.game().liveSettings((payload as RequestMap['live.settings']['payload']).participate) as R;
      case 'budget.view':
        return this.game().budgetView() as R;
      case 'budget.set':
        return this.game().budgetSet(payload as RequestMap['budget.set']['payload']) as R;
      case 'meeting.convene':
        return this.game().meetingConvene() as R;
      case 'awards.list':
        return this.game().awardsList((payload as RequestMap['awards.list']['payload'])?.season) as R;
      case 'trade.respondOffer': {
        const p = payload as RequestMap['trade.respondOffer']['payload'];
        return this.game().tradeRespondOffer(p.offerId, p.accept, p.commandId) as R;
      }
      case 'owner.career':
        return this.game().careerView() as R;
      case 'owner.acceptJob': {
        // 구단이 바뀌면 구단별로 기억한 값(스카우트 보고서 등)을 버리고 서비스를 다시 만든다
        this.game().acceptJob((payload as RequestMap['owner.acceptJob']['payload']).clubId);
        this.service = null;
        return this.dashboard() as R;
      }
      case 'roster.view':
        return this.game().rosterView() as R;
      case 'roster.move': {
        const p = payload as RequestMap['roster.move']['payload'];
        return this.game().rosterMove(p.promote, p.demote) as R;
      }
      case 'roster.setPlan': {
        const p = payload as RequestMap['roster.setPlan']['payload'];
        return this.game().rosterSetPlan(p.mode, p.plan) as R;
      }
      case 'player.rest': {
        const p = payload as RequestMap['player.rest']['payload'];
        return this.game().restPlayer(p.playerId, p.days) as R;
      }
      case 'player.medicalCheck':
        return this.game().medicalCheck((payload as RequestMap['player.medicalCheck']['payload']).playerId) as R;
      case 'player.train': {
        const p = payload as RequestMap['player.train']['payload'];
        return this.game().trainPlayer(p.playerId, p.primary, p.secondary, p.intensity) as R;
      }
      case 'player.trainDelegate':
        return this.game().trainDelegate((payload as RequestMap['player.trainDelegate']['payload']).playerId) as R;
      case 'player.trainStop':
        return this.game().trainStop((payload as RequestMap['player.trainStop']['payload']).playerId) as R;
      case 'player.actions':
        return this.game().playerActions((payload as RequestMap['player.actions']['payload']).playerId) as R;
      case 'game.standings':
        return this.game().standings() as R;
      case 'game.schedule': {
        const p = payload as RequestMap['game.schedule']['payload'];
        return this.game().schedule(p.clubId, p.month) as R;
      }
      case 'game.boxScore':
        return this.game().boxScore((payload as RequestMap['game.boxScore']['payload']).fixtureId) as R;
      case 'game.startNextSeason':
        this.game().startNextSeason();
        return this.dashboard() as R;
      case 'game.inbox':
        return this.game().inbox() as R;
      case 'game.inboxRead':
        this.game().markInboxRead((payload as RequestMap['game.inboxRead']['payload']).id);
        return { ok: true } as R;
      case 'game.finance':
        return this.game().finance() as R;
      case 'market.view':
        return this.game().marketView() as R;
      case 'market.faOffer': {
        const p = payload as RequestMap['market.faOffer']['payload'];
        return this.game().faOffer(p.playerId, p.years, p.salaryWon, p.bonusWon) as R;
      }
      case 'market.salaryOffer': {
        const p = payload as RequestMap['market.salaryOffer']['payload'];
        return this.game().salaryOffer(p.playerId, p.offerWon) as R;
      }
      case 'market.salaryAuto':
        return this.game().salaryAuto() as R;
      case 'market.foreignOffer': {
        const p = payload as RequestMap['market.foreignOffer']['payload'];
        return this.game().foreignOffer(p.playerId, p.salaryUsd) as R;
      }
      case 'market.extensionOffer': {
        const p = payload as RequestMap['market.extensionOffer']['payload'];
        return this.game().extensionOffer(p.playerId, p.years, p.salaryWon, p.bonusWon) as R;
      }
      case 'market.domesticOffer': {
        const p = payload as RequestMap['market.domesticOffer']['payload'];
        return this.game().domesticOffer(p.playerId, p.salaryWon) as R;
      }
      case 'market.release':
        return this.game().releasePlayer((payload as RequestMap['market.release']['payload']).playerId) as R;
      case 'org.view':
        return this.game().orgView() as R;
      case 'org.hire':
        return this.game().hireStaff((payload as RequestMap['org.hire']['payload']).staffId) as R;
      case 'org.fire':
        return this.game().fireStaff((payload as RequestMap['org.fire']['payload']).staffId) as R;
      case 'org.setPolicy':
        return this.game().setPolicy(payload as RequestMap['org.setPolicy']['payload']) as R;
      case 'org.delegateFa': {
        const p = payload as RequestMap['org.delegateFa']['payload'];
        return this.game().delegateFa(p.playerId, p.maxTotalWon, p.maxYears, p.minTotalWon, p.deadline) as R;
      }
      case 'org.delegateSalary': {
        const p = payload as RequestMap['org.delegateSalary']['payload'] | undefined;
        return this.game().delegateSalary(p?.playerId, p?.maxRatioBp) as R;
      }
      case 'stove.chooseCard': {
        const p = payload as RequestMap['stove.chooseCard']['payload'];
        return this.game().chooseStoveCard(p.cardId, p.choiceId) as R;
      }
      case 'game.winterReport':
        return this.game().winterReport() as R;
      case 'org.delegateHire': {
        const p = payload as RequestMap['org.delegateHire']['payload'];
        return this.game().delegateHire(p.team, p.title, p.maxSalaryWon) as R;
      }
      case 'org.cancelTask':
        return this.game().cancelTask((payload as RequestMap['org.cancelTask']['payload']).taskId) as R;
      case 'org.approve':
        return this.game().approve((payload as RequestMap['org.approve']['payload']).approvalId) as R;
      case 'org.reject':
        return this.game().reject((payload as RequestMap['org.reject']['payload']).approvalId) as R;
      case 'org.decideMany': {
        const p = payload as RequestMap['org.decideMany']['payload'];
        return this.game().decideMany(p.approvalIds, p.approve) as R;
      }
      case 'game.team':
        return this.game().teamRecords() as R;
      case 'draft.view':
        return this.game().draftView() as R;
      case 'draft.setBoard':
        return this.game().setDraftBoard((payload as RequestMap['draft.setBoard']['payload']).ids) as R;
      case 'roster.persuade':
        return this.game().persuadeRetirement((payload as RequestMap['roster.persuade']['payload']).playerId) as R;
      case 'owner.emergency':
        return this.game().emergencySupport() as R;
      case 'owner.rebuild':
        return this.game().declareRebuild() as R;
      case 'game.hallOfFame':
        return this.game().hallOfFame((payload as RequestMap['game.hallOfFame']['payload']).clubId) as R;
      case 'game.calendar': {
        const p = payload as RequestMap['game.calendar']['payload'];
        return this.game().calendar(p.from, p.to) as R;
      }
      case 'save.list':
        return this.saves.list().map((s) => this.toSlotInfo(s)) as R;
      case 'save.save': {
        const p = payload as RequestMap['save.save']['payload'];
        // 4c-3(D-174 (5)): 경기 중에는 저장하지 않는다
        if (this.service?.meta().liveGame) throw new GameError('LIVE_GAME', '경기 중에는 저장할 수 없습니다. 경기를 확정하거나 감독에게 맡긴 뒤 저장하세요.');
        const meta = this.saves.save(p.slot, 'manual');
        const listing = this.saves.list().find((s) => s.slot === meta.slot)!;
        return this.toSlotInfo(listing) as R;
      }
      case 'save.load': {
        const p = payload as RequestMap['save.load']['payload'];
        this.service = null;
        this.saves.load(p.slot, p.backupIndex ?? 0);
        return this.dashboard() as R;
      }
      case 'save.resumeSession':
        this.service = null;
        this.saves.resumeSession();
        return this.dashboard() as R;
      default:
        throw new GameError('UNKNOWN_REQUEST', `알 수 없는 요청: ${String(name)}`);
    }
  }

  /** 예외를 화면이 처리할 수 있는 응답 형식으로 바꾼다. */
  async respond<K extends RequestName>(name: K, payload: RequestMap[K]['payload']): Promise<ApiResponse<RequestMap[K]['result']>> {
    try {
      return { ok: true, result: await this.handle(name, payload) };
    } catch (e) {
      if (e instanceof GameError) return { ok: false, error: { code: e.code, message: e.message } };
      if (e instanceof SaveError) return { ok: false, error: { code: `SAVE_${e.code}`, message: e.message } };
      return { ok: false, error: { code: 'INTERNAL', message: (e as Error).message } };
    }
  }

  close(): void {
    this.saves.closeSession();
  }
}
