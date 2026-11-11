// EV-1 뉴스 로그(26a U3): 시즌·주별 턴 브리핑과 결정 카드 기록
import { useEffect, useState } from 'react';
import type { NewsLogView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { BriefingLines } from '../BriefingPopup';

export function NewsLog({ nav }: { nav: Nav }) {
  const [v, setV] = useState<NewsLogView | null>(null);
  const load = (season?: number) => api('events.news', season !== undefined ? { season } : {}).then(setV).catch((e: Error) => nav.notify(e.message, 'error'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!v) return <div className="page"><p className="muted">불러오는 중…</p></div>;
  return (
    <div className="page">
      <h1>뉴스 로그</h1>
      <div className="row">
        <label>
          시즌{' '}
          <select value={v.season} onChange={(e) => void load(Number(e.target.value))}>
            {v.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <section className="panel">
        <h2>결정 카드 기록</h2>
        {v.cards.length === 0 ? <p className="muted">이 시즌에 나온 결정 카드가 없습니다. 카드 화면은 다음 개발 차수(EV-3)에서 열리고, 그 전에는 담당 팀이 기본 선택지로 처리합니다.</p> : (
          <table className="grid">
            <thead><tr><th>날짜</th><th>분류</th><th>선수</th><th>처리</th><th>내용</th></tr></thead>
            <tbody>
              {v.cards.map((c, i) => (
                <tr key={i}><td>{c.date.slice(5)}</td><td>{c.category}</td><td>{c.player ?? '—'}</td><td>{c.by}</td><td>{c.text}{c.outcome ? ` · ${c.outcome}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {v.briefings.map((b) => (
        <section className="panel" key={b.weekId}>
          <h2>{b.date.slice(5).replace('-', '/')} 주 브리핑</h2>
          <BriefingLines b={b} />
        </section>
      ))}
      {v.briefings.length === 0 && <p className="muted">턴 브리핑은 시즌 모드에서 매주 월요일에 나옵니다.</p>}
    </div>
  );
}
