import { useEffect, useState } from 'react';
import type { AppStatus, DashboardView, SaveSlotInfo } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo } from '../format';

export function StartScreen({ nav, status }: { nav: Nav; status: AppStatus | null }) {
  const [slots, setSlots] = useState<SaveSlotInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('save.list').then(setSlots).catch(() => setSlots([]));
  }, []);

  const open = async (fn: () => Promise<DashboardView>) => {
    setLoading(true);
    try {
      nav.setDashboard(await fn());
      nav.go({ name: 'dashboard' });
    } catch (e) {
      nav.notify((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="start">
      <div className="hero">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M6.5 5.5c2 2 2.5 4 2.5 6.5s-.5 4.5-2.5 6.5M17.5 5.5c-2 2-2.5 4-2.5 6.5s.5 4.5 2.5 6.5" />
        </svg>
        <div>
          <h1>프런트 오피스</h1>
          <div style={{ color: '#c9d2e3' }}>프로야구 구단 경영 시뮬레이션 · 개발 빌드 2a (스토브리그·재정 기반)</div>
        </div>
      </div>
      <div className="start-actions">
        {status?.recoverableSession && (
          <button className="primary big" disabled={loading} onClick={() => open(() => api('save.resumeSession'))}>
            이어하기 — {status.recoverableSession.saveName} ({status.recoverableSession.clubName}, {dateKo(status.recoverableSession.date)})
          </button>
        )}
        <button className="big" disabled={loading} onClick={() => nav.go({ name: 'newGame' })}>새 게임</button>
      </div>
      {slots.length > 0 && (
        <section className="panel">
          <h2>저장본 불러오기</h2>
          <table className="grid">
            <thead>
              <tr><th>슬롯</th><th>이름</th><th>구단</th><th>게임 날짜</th><th>저장 시각</th><th>상태</th><th /></tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.slot}>
                  <td>{s.slot}</td>
                  <td>{s.name}</td>
                  <td>{s.clubName}</td>
                  <td>{s.date ? dateKo(s.date) : '—'}</td>
                  <td>{s.savedAt ? new Date(s.savedAt).toLocaleString('ko-KR') : '—'}</td>
                  <td>{s.status === 'ok' ? '정상' : s.message}</td>
                  <td>
                    {s.status === 'ok' && <button disabled={loading} onClick={() => open(() => api('save.load', { slot: s.slot }))}>불러오기</button>}
                    {s.status !== 'ok' && s.backups[0] && (
                      <button disabled={loading} onClick={() => open(() => api('save.load', { slot: s.slot, backupIndex: s.backups[0]!.index }))}>백업에서 복구</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="muted small">Steam: {status?.platform.steam.detail}</p>
    </div>
  );
}
