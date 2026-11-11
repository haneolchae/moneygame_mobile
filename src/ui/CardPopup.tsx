// EV-3 결정 카드 화면(D-207 (1)): 닫기 없음. 확정 효과는 숫자, 지표는 방향, 확률 효과는 위험 등급만.
import { useState } from 'react';
import type { CardView } from '../shared/protocol';
import type { Nav } from './App';
import { api, ApiError } from './api';

export function CardPopup({ card, nav }: { card: CardView; nav: Nav }) {
  const [sending, setSending] = useState(false);
  const choose = async (choiceId: string) => {
    setSending(true);
    try {
      const r = await api('events.choose', { choiceId });
      nav.notify(r.message);
      await nav.sync();
      // 선택 뒤 열 화면: 시장·조직, 트레이드는 상대 구단을 고르는 순위 화면
      if (r.link === 'market') nav.go({ name: 'market' });
      else if (r.link === 'org') nav.go({ name: 'org' });
      else if (r.link === 'trade') {
        nav.go({ name: 'standings' });
        nav.notify('트레이드할 구단을 골라 구단 화면에서 협상을 여세요.');
      }
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="panel modal">
        <div className="panel-head">
          <h2>
            {card.priority ? '◆ ' : ''}결정 카드 · {card.categoryLabel}
          </h2>
          <span className="meta">즉시 선택 · 행동력 0 · 고르기 전에는 진행할 수 없습니다</span>
        </div>
        <div className="modal-body">
          <p>{card.text}</p>
          {card.player && (
            <p>
              <button className="small" onClick={() => nav.go({ name: 'player', playerId: card.player!.id, back: { name: 'dashboard' } })}>
                상세 보기: {card.player.name}
              </button>
            </p>
          )}
          {card.choices.map((c) => (
            <div key={c.id} className="approval-row" style={{ alignItems: 'flex-start' }}>
              <span className="txt">
                <b>{c.label}</b>
                {c.isDefault && <span className="muted small"> (담당 팀 기본 선택)</span>}
                <div className="small">{c.effects.length ? c.effects.join(' · ') : '변화 없음'}</div>
                {c.risks.map((r, i) => (
                  <div key={i} className="small muted">
                    가능성 {r.grade}: {r.hint}
                  </div>
                ))}
              </span>
              <button className="primary small" disabled={sending} onClick={() => void choose(c.id)}>
                선택
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
