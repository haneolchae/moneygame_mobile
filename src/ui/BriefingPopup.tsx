// EV-1 턴 브리핑 팝업(D-192·D-203 (10)): 매주 시작에 결재 팝업보다 먼저. 저장된 줄만 보여 준다(난수 없음).
import type { BriefingView } from '../shared/protocol';

export const BRIEFING_KIND: Record<BriefingView['lines'][number]['kind'], { mark: string; label: string; cls: string }> = {
  warn: { mark: '!', label: '경고', cls: 'reason' },
  good: { mark: '★', label: '성과', cls: 'ok' },
  game: { mark: '●', label: '경기', cls: '' },
  money: { mark: '₩', label: '재정', cls: '' },
  health: { mark: '+', label: '건강', cls: '' },
  result: { mark: '↩', label: '결과', cls: '' },
  league: { mark: '·', label: '리그', cls: 'muted' },
  decide: { mark: '?', label: '결정', cls: 'reason' },
};

export function BriefingLines({ b }: { b: BriefingView }) {
  return (
    <ul className="briefing-lines" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {b.lines.map((l, i) => {
        const k = BRIEFING_KIND[l.kind] ?? BRIEFING_KIND.league;
        return (
          <li key={i} className={k.cls} style={{ padding: '3px 0' }}>
            <span className="badge" title={k.label}>{k.mark} {k.label}</span> {l.text}
          </li>
        );
      })}
    </ul>
  );
}

export function BriefingPopup({ briefing, onClose }: { briefing: BriefingView; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="panel modal">
        <div className="panel-head">
          <h2>주간 브리핑 · {briefing.date.slice(5).replace('-', '/')} 주</h2>
          <span className="meta">지난주 결과 요약 · 다시 보기는 [뉴스 로그]</span>
        </div>
        <div className="modal-body">
          <BriefingLines b={briefing} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
