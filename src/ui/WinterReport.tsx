// D-215 지난겨울 보고서: 전임 경영진 인수인계서. 새 게임 생성 때 자동 실행한 첫 스토브리그 결과(실제 기록)를 2/1 캠프에서 보여 준다.
import { useEffect, useState } from 'react';
import type { WinterReportView } from '../shared/protocol';
import { api } from './api';
import { won } from './format';

export function WinterReportPopup({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<WinterReportView | null>(null);
  useEffect(() => {
    void api('game.winterReport').then(setR);
  }, []);
  if (!r) return null;
  const list = (items: Array<{ name: string; how?: string; text?: string }>) => (items.length ? items.map((x) => `${x.name}${x.how ? `(${x.how})` : ''}${x.text ? `: ${x.text}` : ''}`).join(', ') : '없음');
  return (
    <div className="modal-backdrop">
      <div className="panel modal">
        <div className="panel-head">
          <h2>지난겨울 보고서</h2>
          <span className="meta">
            전임 경영진 인수인계서 · {r.from.slice(5).replace('-', '/')}~{r.to.slice(5).replace('-', '/')}
          </span>
        </div>
        <div className="modal-body">
          <ul style={{ paddingLeft: 18 }}>
            <li>들어온 선수: {list(r.incoming)}</li>
            <li>나간 선수: {list(r.outgoing)}</li>
            <li>계약: {list(r.contracts)}</li>
            <li>스폰서: {r.sponsors.length ? r.sponsors.join(', ') : '없음'}</li>
            <li>채용: {r.hires.length ? r.hires.join(', ') : '없음'}</li>
            <li>시설: {r.facilities.length ? r.facilities.join(', ') : '변동 없음'}</li>
            <li>
              현금: {won(r.cashStart)} → {won(r.cashEnd)} · 선수단 {r.rosterCount}명(외국인 {r.foreignCount}명)
            </li>
          </ul>
          <table className="grid dense">
            <thead>
              <tr>
                <th>장부 항목</th>
                <th className="num">금액</th>
              </tr>
            </thead>
            <tbody>
              {r.ledger.map((l) => (
                <tr key={l.category}>
                  <td>{l.category}</td>
                  <td className="num">{won(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.notes.map((n) => (
            <p key={n} className="reason">
              {n}
            </p>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="primary" onClick={onClose}>
            캠프 시작
          </button>
        </div>
      </div>
    </div>
  );
}
