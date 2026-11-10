// 앱 틀: 상단 진행 막대, 왼쪽 메뉴, 본문. 게임 규칙은 없고 요청과 결과 표시만 한다.
import { useCallback, useEffect, useState } from 'react';
import type { AppStatus, DashboardView, ProgressEvent } from '../shared/protocol';
import { api, ApiError, onProgress } from './api';
import { ApprovalPopup } from './ApprovalPopup';
import { Emblem } from './Emblem';
import { dateKo } from './format';
import monogram from './assets/diamond-office/diamond_monogram.svg';
import { Icon } from './icons';
import { PrimaryNav } from './PrimaryNav';
import { leaveGuard } from './playerFocus';
import { BoxScore } from './screens/BoxScore';
import { Dashboard } from './screens/Dashboard';
import { Draft } from './screens/Draft';
import { Business } from './screens/Business';
import { Finance } from './screens/Finance';
import { HallOfFame } from './screens/HallOfFame';
import { Inbox } from './screens/Inbox';
import { Market } from './screens/Market';
import { NewGame } from './screens/NewGame';
import { Organization } from './screens/Organization';
import { PlayerDetail } from './screens/PlayerDetail';
import { Players } from './screens/Players';
import { Club } from './screens/Club';
import { Compare } from './screens/Compare';
import { Roster } from './screens/Roster';
import { Saves } from './screens/Saves';
import { Schedule } from './screens/Schedule';
import { Standings } from './screens/Standings';
import { StartScreen } from './screens/StartScreen';
import { TeamRecords } from './screens/TeamRecords';
import { Trade } from './screens/Trade';

export type Route =
  | { name: 'start' }
  | { name: 'newGame' }
  | { name: 'dashboard' }
  | { name: 'inbox' }
  | { name: 'players' }
  | { name: 'roster' }
  /** list: 진입 목록의 선수 순서(이전·다음), back: 닫으면 돌아갈 화면 */
  | { name: 'player'; playerId: number; list?: number[]; back?: Route }
  | { name: 'schedule' }
  | { name: 'boxScore'; fixtureId: number }
  | { name: 'standings' }
  | { name: 'finance' }
  | { name: 'business' }
  | { name: 'market' }
  | { name: 'org' }
  | { name: 'team' }
  | { name: 'hof'; clubId?: number }
  | { name: 'club'; clubId: number }
  /** 5a 트레이드 협상: want = 처음 받을 선수(선수 상세 '트레이드 문의') */
  | { name: 'trade'; clubId: number; want?: number }
  | { name: 'compare' }
  | { name: 'draft' }
  | { name: 'saves' };

export interface Nav {
  go: (route: Route) => void;
  dashboard: DashboardView | null;
  setDashboard: (d: DashboardView) => void;
  refresh: () => Promise<void>;
  /** 화면을 다시 그리지 않고 상단·메뉴 정보만 갱신 */
  sync: () => Promise<void>;
  refreshKey: number;
  notify: (msg: string, kind?: 'info' | 'error') => void;
}

// 주 메뉴(경로·순서는 기존과 같음). 아이콘은 Diamond Office 키트(D-140), 같은 의미가 없으면 기존 아이콘
const MENU: Array<{ route: Route; label: string; icon: string }> = [
  { route: { name: 'dashboard' }, label: '구단 현황', icon: 'do-home' },
  { route: { name: 'inbox' }, label: '받은 편지함', icon: 'do-bell' },
  { route: { name: 'players' }, label: '선수단', icon: 'do-roster' },
  { route: { name: 'roster' }, label: '선수단 운영', icon: 'do-edit' },
  { route: { name: 'market' }, label: '계약·이적', icon: 'do-contract' },
  { route: { name: 'org' }, label: '조직·위임', icon: 'do-operations' },
  { route: { name: 'draft' }, label: '신인 드래프트', icon: 'do-scout' },
  { route: { name: 'schedule' }, label: '일정', icon: 'do-calendar' },
  { route: { name: 'standings' }, label: '리그 순위', icon: 'do-game' },
  { route: { name: 'compare' }, label: '선수 비교', icon: 'do-compare' },
  { route: { name: 'team' }, label: '팀 기록', icon: 'do-development' },
  { route: { name: 'hof' }, label: '명예의 전당', icon: 'do-star' },
  { route: { name: 'business' }, label: '사업·시설', icon: 'do-market' },
  { route: { name: 'finance' }, label: '재정', icon: 'do-finance' },
  { route: { name: 'saves' }, label: '저장·불러오기', icon: 'save' },
];

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'start' });
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // 주 시작 결재 팝업: 같은 주에는 한 번만 띄운다(D-077).
  const [popupWeek, setPopupWeek] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);

  const notify = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4000);
  }, []);

  useEffect(() => {
    api('app.status')
      .then(setStatus)
      .catch((e: Error) => notify(e.message, 'error'));
    return onProgress(setProgress);
  }, [notify]);

  const applyDashboard = (d: DashboardView) => {
    setDashboard(d);
    setRefreshKey((k) => k + 1);
  };

  /** 화면 이동 전 이탈 확인(선수 상세의 미저장 메모 저장). 저장에 실패하면 이동하지 않는다. */
  const canLeave = async () => {
    if (!leaveGuard.run) return true;
    const ok = await leaveGuard.run();
    if (!ok) notify('메모를 저장하지 못해 이동하지 않았습니다. 다시 시도하거나 메모를 지우세요.', 'error');
    return ok;
  };
  const go = (r: Route) => {
    void canLeave().then((ok) => ok && setRoute(r));
  };

  const nav: Nav = {
    go,
    dashboard,
    setDashboard: applyDashboard,
    refresh: async () => applyDashboard(await api('game.dashboard')),
    sync: async () => setDashboard(await api('game.dashboard')),
    refreshKey,
    notify,
  };

  const advance = async (mode: 'day' | 'week' | 'untilSeasonEnd') => {
    if (!(await canLeave())) return;
    setBusy(mode === 'day' ? '하루 진행 중' : mode === 'week' ? '한 주 진행 중' : '시즌 진행 중');
    setProgress(null);
    try {
      const r = await api('game.advance', { mode });
      const d = await api('game.dashboard');
      applyDashboard(d);
      if (d.approvals.length > 0 && d.owner.weekLabel !== popupWeek) {
        setPopupWeek(d.owner.weekLabel);
        setPopupOpen(true);
      }
      const parts = [`${r.daysProcessed}일 진행${r.gamesPlayed ? `, ${r.gamesPlayed}경기` : ''}`];
      if (r.autosaved) parts.push('자동 저장됨');
      if (r.stoppedReason) parts.push(r.stoppedReason);
      notify(parts.join(' · '));
    } catch (e) {
      notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const nextSeason = async () => {
    setBusy('다음 시즌 준비 중');
    try {
      applyDashboard(await api('game.startNextSeason'));
      notify('다음 시즌 일정이 만들어졌습니다. (임시 기능: 포스트시즌·스토브리그 생략)');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (route.name === 'start' || route.name === 'newGame' || !dashboard) {
    return (
      <div className="shell-start">
        {route.name === 'newGame' ? <NewGame nav={nav} /> : <StartScreen nav={nav} status={status} />}
        {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
      </div>
    );
  }

  const d = dashboard;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src={monogram} alt="" />
          프런트 오피스
          <span className="sub">프로야구 구단 경영 시뮬레이션</span>
        </div>
        <div className="club-chip">
          <Emblem club={d.userClub} size={34} />
          <div>
            <strong>{d.userClub.name}</strong>
            <span>{d.phaseLabel}</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="ap" title="이번 주 남은 행동력">
          <span>행동력 · Lv.{d.owner.level}</span>
          <strong>
            {d.owner.apRemaining} / {d.owner.apGranted}
          </strong>
        </div>
        <div className="date">
          <Icon name="calendar" />
          {dateKo(d.date)}
        </div>
        <div className="actions">
          <button disabled={!!busy} className={d.unsavedDays > 0 ? 'warn' : ''} onClick={() => go({ name: 'saves' })}>
            저장{d.unsavedDays > 0 ? ` (수동 저장 후 ${d.unsavedDays}일)` : ''}
          </button>
          {d.phase === 'seasonComplete' ? (
            <button disabled={!!busy} className="primary" onClick={nextSeason} title="임시 기능">
              다음 시즌 시작 (임시)
            </button>
          ) : (
            <>
              {d.canAdvanceDay && (
                <>
                  <button disabled={!!busy} onClick={() => advance('untilSeasonEnd')}>{d.phase === 'postseason' ? '포스트시즌 끝까지' : '정규시즌 끝까지'}</button>
                  <button disabled={!!busy} onClick={() => advance('day')}>하루 진행</button>
                </>
              )}
              <button disabled={!!busy} className="primary" onClick={() => advance('week')}>
                다음 주 진행 <Icon name="play" size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      <PrimaryNav
        items={[MENU[0]!, { route: { name: 'club', clubId: d.userClub.id } as Route, label: '구단 정보', icon: 'do-baseball' }, ...MENU.slice(1)].map((m) => ({
          key: m.label,
          label: m.label,
          icon: m.icon,
          active: route.name === m.route.name && (route.name !== 'club' || (m.route.name === 'club' && route.clubId === m.route.clubId)),
          badge: m.route.name === 'inbox' ? d.unreadInbox : m.route.name === 'org' ? d.pendingApprovals : 0,
          onSelect: () => go(m.route),
        }))}
        platform={status?.platform.steam.mode === 'real' ? '연결됨' : '모의'}
        platformDetail={status?.platform.steam.detail ?? ''}
      />
      <main className="content" key={refreshKey}>
        {d.gameOver && (
          <div className="panel" style={{ borderColor: 'var(--error)', marginBottom: 14 }}>
            <div className="panel-head" style={{ background: 'var(--error)' }}>
              <h2>{d.gameOver.kind === 'dismissed' ? '해임되었습니다' : '구단이 파산했습니다'}</h2>
              <span className="meta" style={{ color: 'var(--text)' }}>{d.gameOver.date}</span>
            </div>
            <div className="panel-body">
              {d.gameOver.reason} 재임 기록은 [명예의 전당]에서 볼 수 있습니다. 새 게임으로 다시 시작할 수 있습니다(다른 구단 영입 제안은 다음 단계).
            </div>
          </div>
        )}
        {route.name === 'dashboard' && <Dashboard nav={nav} />}
        {route.name === 'inbox' && <Inbox nav={nav} />}
        {route.name === 'players' && <Players nav={nav} />}
        {route.name === 'roster' && <Roster nav={nav} />}
        {route.name === 'player' && <PlayerDetail nav={nav} playerId={route.playerId} list={route.list} back={route.back} />}
        {route.name === 'schedule' && <Schedule nav={nav} />}
        {route.name === 'boxScore' && <BoxScore nav={nav} fixtureId={route.fixtureId} />}
        {route.name === 'standings' && <Standings nav={nav} />}
        {route.name === 'finance' && <Finance nav={nav} />}
        {route.name === 'business' && <Business nav={nav} />}
        {route.name === 'market' && <Market nav={nav} />}
        {route.name === 'org' && <Organization nav={nav} />}
        {route.name === 'team' && <TeamRecords nav={nav} />}
        {route.name === 'hof' && <HallOfFame nav={nav} initialClubId={route.clubId} key={route.clubId ?? 0} />}
        {route.name === 'club' && <Club nav={nav} clubId={route.clubId} key={route.clubId} />}
        {route.name === 'trade' && <Trade nav={nav} clubId={route.clubId} want={route.want} key={`${route.clubId}-${route.want ?? 0}`} />}
        {route.name === 'compare' && <Compare nav={nav} />}
        {route.name === 'draft' && <Draft nav={nav} />}
        {route.name === 'saves' && <Saves nav={nav} />}
      </main>
      {busy && (
        <div className="busy">
          <div className="spinner" />
          <div>
            <strong>{busy}</strong>
            {progress && (
              <div className="muted">
                {dateKo(progress.date)} · {progress.daysProcessed}일{progress.gamesPlayed ? ` · ${progress.gamesPlayed}경기` : ''}
              </div>
            )}
          </div>
        </div>
      )}
      {popupOpen && !busy && <ApprovalPopup approvals={d.approvals} nav={nav} onClose={() => setPopupOpen(false)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
