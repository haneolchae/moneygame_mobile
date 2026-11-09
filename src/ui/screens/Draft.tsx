// 신인 드래프트: 후보 보드(스카우트 평가·아마추어 업적), 지명 우선순위, 결과 (07 문서, D-084)
import { useEffect, useState } from 'react';
import type { DraftView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { POSITION_LABELS } from '../format';

export function Draft({ nav }: { nav: Nav }) {
  const [v, setV] = useState<DraftView | null>(null);
  const [filter, setFilter] = useState<'all' | '고교' | '대학' | 'honors'>('all');
  useEffect(() => {
    api('draft.view')
      .then(setV)
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async (ids: number[]) => {
    try {
      setV(await api('draft.setBoard', { ids }));
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    }
  };
  if (!v) return <div className="page muted">불러오는 중…</div>;
  const byId = new Map(v.candidates.map((c) => [c.id, c]));
  const list = v.candidates.filter((c) => (filter === 'all' ? true : filter === 'honors' ? c.honors.length > 0 : c.level === filter));
  const move = (id: number, d: number) => {
    const b = [...v.board];
    const i = b.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= b.length) return;
    [b[i], b[j]] = [b[j]!, b[i]!];
    void save(b);
  };
  return (
    <div className="page">
      <h1>{v.year} 신인 드래프트</h1>
      <p className="muted small">
        {v.date} (정규시즌 종료 다음 월요일) · 5라운드, 정규시즌 역순 지명{v.myOrder ? ` · 우리 구단 현재 ${v.myOrder}번째 순서` : ''} · 지명 선수는 한국시리즈 뒤 입단 · 우선순위가 비면 스카우트 평가 순으로 지명합니다.
      </p>
      {v.done && (
        <section className="panel">
          <div className="panel-head">
            <h2>지명 결과</h2>
            <span className="meta">50명</span>
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="grid dense">
              <thead>
                <tr>
                  <th className="num">순위</th>
                  <th>라운드</th>
                  <th>구단</th>
                  <th>선수</th>
                  <th>출신</th>
                  <th>포지션</th>
                </tr>
              </thead>
              <tbody>
                {v.picks.map((p) => (
                  <tr key={p.pick} className={p.mine ? 'mine' : ''}>
                    <td className="num">{p.pick}</td>
                    <td>{p.round}라운드</td>
                    <td>{p.club.shortName}</td>
                    <td>{p.name}</td>
                    <td>{p.school}</td>
                    <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!v.done && (
        <section className="panel">
          <div className="panel-head">
            <h2>우리 지명 우선순위 ({v.board.length})</h2>
            <span className="meta">위에서부터 남아 있는 선수를 지명합니다 · 행동력 없음</span>
          </div>
          <table className="grid dense">
            <tbody>
              {v.board.map((id, i) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <tr key={id}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <strong>{c.name}</strong> <span className="muted small">{c.school} {c.level} {c.grade}학년</span>
                    </td>
                    <td>{POSITION_LABELS[c.position] ?? c.position}</td>
                    <td className="num">{c.scoutGrade}</td>
                    <td>잠재 {c.scoutPotentialGrade}</td>
                    <td>
                      <button className="small" onClick={() => move(id, -1)}>
                        ▲
                      </button>{' '}
                      <button className="small" onClick={() => move(id, 1)}>
                        ▼
                      </button>{' '}
                      <button className="small" onClick={() => void save(v.board.filter((x) => x !== id))}>
                        빼기
                      </button>
                    </td>
                  </tr>
                );
              })}
              {v.board.length === 0 && (
                <tr>
                  <td className="muted">아래 후보에서 [추가]를 눌러 순위를 정하세요.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>후보 보드 ({v.candidates.length}명)</h2>
          <span className="meta">고교 3학년(프로 신청자)·대학 4학년 · 평가와 잠재 등급은 우리 스카우트 판단 · 업적은 상위 10%만</span>
        </div>
        <div className="toolbar" style={{ padding: '8px 12px' }}>
          <div className="seg">
            {(
              [
                ['all', '전체'],
                ['고교', '고교'],
                ['대학', '대학'],
                ['honors', '업적 보유'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 560, overflow: 'auto' }}>
          <table className="grid dense">
            <thead>
              <tr>
                <th>선수</th>
                <th>학교</th>
                <th>포지션</th>
                <th className="num">나이</th>
                <th className="num">평가</th>
                <th>잠재</th>
                <th>최근 시즌</th>
                <th>개인 업적</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.priority ? 'mine' : ''}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    {c.school} <span className="muted small">{c.level}</span>
                  </td>
                  <td>{POSITION_LABELS[c.position] ?? c.position}</td>
                  <td className="num">{c.age}</td>
                  <td className="num">{c.scoutGrade}</td>
                  <td>{c.scoutPotentialGrade}</td>
                  <td className="small">{c.lastSeason}</td>
                  <td className="small" style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                    {c.honors.slice(-4).join(', ')}
                  </td>
                  <td>
                    {!v.done && (c.priority ? <span className="muted small">{c.priority}순위</span> : <button className="small" onClick={() => void save([...v.board, c.id])}>추가</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
