// ① 스토브리그 턴 회의(D-216·D-219·D-220): 이번 턴 할 일·결정 카드·협상 상황·턴 타임라인. 지시를 마치면 [다음 턴 진행]으로 구간을 처리한다.
import { useState } from 'react';
import type { DashboardView, StoveTurnView } from '../shared/protocol';
import { api, ApiError } from './api';
import type { Nav } from './App';
import { shortDate } from './format';

const TIER_CLASS: Record<StoveTurnView['agenda'][number]['tier'], string> = { 필수: 'req', 권장: 'rec', 선택: 'opt', 자동: 'opt' };
const LINK_ROUTE: Record<string, string> = { market: 'market', org: 'org', roster: 'roster', business: 'business', finance: 'finance', trade: 'standings', allstar: 'allStar' };

export function TurnMeeting({ d, nav }: { d: DashboardView; nav: Nav }) {
  const s = d.stove!;
  const [sending, setSending] = useState(false);
  const choose = async (cardId: string, choiceId: string) => {
    setSending(true);
    try {
      const r = await api('stove.chooseCard', { cardId, choiceId });
      nav.notify(r.message);
      await nav.sync();
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  const go = (link: string | null) => {
    const r = link ? LINK_ROUTE[link] : null;
    if (r) nav.go({ name: r } as Parameters<Nav['go']>[0]);
  };
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>턴 회의 · {s.title}</h2>
          <span className="meta">
            {shortDate(s.start)}~{shortDate(s.end)} · 끝: {s.endLabel} · 행동력 {s.apRemaining}/{s.apGranted} · 멈춤 {s.stops}/{s.maxStops}
          </span>
        </div>
        <div className="panel-body">
          <ol className="turn-timeline" style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
            {s.turns.map((t) => (
              <li key={t.index} className={t.current ? 'badge rec' : t.done ? 'badge opt' : 'badge'} title={`끝: ${t.endLabel}`}>
                {t.title} · {t.period}
              </li>
            ))}
          </ol>
          <ul className="tasks">
            {s.agenda.map((a, i) => (
              <li key={i} onClick={() => go(a.link)}>
                <div className="txt">
                  <strong>
                    {a.done === true ? '✓ ' : ''}
                    {a.title} <span className={`badge ${TIER_CLASS[a.tier]}`}>{a.tier}</span>
                    {a.deadline && <span className="muted small"> 마감 {shortDate(a.deadline)}</span>}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
          {s.defaulted.length > 0 && (
            <p className="muted small">멈춤 상한을 넘어 기본 처리: {s.defaulted.join(' / ')}</p>
          )}
          <p className="muted small">지시를 마치면 오른쪽 위 [다음 턴 진행]을 누르세요. 경쟁 구단의 최종 제안·지시서 범위 밖 응답·필수 결정에서만 멈춥니다(턴당 최대 {s.maxStops}회).</p>
        </div>
      </section>
      {s.cards.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>결정 카드 {s.cards.length}장</h2>
            <span className="meta">답하지 않으면 구간 진행 때 기본 응답 · 행동력 0</span>
          </div>
          <div className="panel-body">
            {s.cards.map((c) => (
              <div key={c.cardId} style={{ marginBottom: 12 }}>
                <p>
                  <span className="badge">{c.categoryLabel}</span> {c.text}
                  {c.player && (
                    <button className="small" style={{ marginLeft: 6 }} onClick={() => nav.go({ name: 'player', playerId: c.player!.id, back: { name: 'dashboard' } })}>
                      {c.player.name}
                    </button>
                  )}
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {c.choices.map((ch) => (
                    <button key={ch.id} disabled={sending} className={ch.isDefault ? '' : ''} onClick={() => void choose(c.cardId, ch.id)} title={[...ch.effects, ...ch.risks.map((r) => `위험 ${r.grade}: ${r.hint}`)].join(' · ')}>
                      {ch.label}
                      {ch.isDefault ? ' (기본)' : ''}
                      <span className="muted small"> {[...ch.effects, ...ch.risks.map((r) => `위험 ${r.grade}`)].join(', ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {s.negotiations.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>협상 상황</h2>
            <span className="meta">[계약·이적]에서 직접 협상하거나 협상 지시서(상·하한·기간·마감)를 운영팀에 넘깁니다</span>
          </div>
          <table className="grid dense">
            <thead>
              <tr>
                <th>선수</th>
                <th>종류</th>
                <th>방식</th>
                <th>상황</th>
              </tr>
            </thead>
            <tbody>
              {s.negotiations.map((n) => (
                <tr key={`${n.kind}-${n.playerId}`} className="clickable" onClick={() => nav.go({ name: 'market' })}>
                  <td>{n.name}</td>
                  <td>{n.kind}</td>
                  <td>{n.status}</td>
                  <td className="small">{n.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
