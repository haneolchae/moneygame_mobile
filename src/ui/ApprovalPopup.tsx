// 주 시작 결재 팝업 (18 문서, D-077). 결재는 행동력을 쓰지 않는다.
import { useState } from 'react';
import type { ApprovalView } from '../shared/protocol';
import type { Nav } from './App';
import { api, ApiError } from './api';

export function ApprovalPopup({ approvals, nav, onClose }: { approvals: ApprovalView[]; nav: Nav; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  const decide = async (ids: number[], approve: boolean) => {
    setSending(true);
    try {
      const r = await api('org.decideMany', { approvalIds: ids, approve });
      nav.notify(r.message, r.result === 'reject' ? 'error' : 'info');
      await nav.sync();
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  const single = approvals.filter((a) => a.kind !== 'salary');
  const salary = approvals.filter((a) => a.kind === 'salary');
  if (approvals.length === 0) return null;
  return (
    <div className="modal-backdrop">
      <div className="panel modal">
        <div className="panel-head">
          <h2>이번 주 결재 ({approvals.length}건)</h2>
          <span className="meta">결재는 행동력을 쓰지 않습니다 · 이번 주 안에 결재하지 않으면 만료</span>
        </div>
        <div className="modal-body">
          {single.map((a) => (
            <div key={a.id} className="approval-row">
              <span className="badge">{a.kindLabel}</span>
              <span className="txt">
                {a.summary}
                <span className="muted small"> · {a.teamName}</span>
              </span>
              <button className="primary small" disabled={sending} onClick={() => void decide([a.id], true)}>
                승인
              </button>
              <button className="small" disabled={sending} onClick={() => void decide([a.id], false)}>
                반려
              </button>
            </div>
          ))}
          {salary.length > 0 && (
            <div className="approval-row">
              <span className="badge">연봉 협상</span>
              <span className="txt">
                보류 선수 {salary.length}명 제시안
                <span className="muted small" style={{ display: 'block' }}>
                  {salary
                    .slice(0, 4)
                    .map((a) => a.summary.replace(/ \(.*\)$/, ''))
                    .join(' / ')}
                  {salary.length > 4 ? ' …' : ''}
                </span>
              </span>
              <button className="primary small" disabled={sending} onClick={() => void decide(salary.map((a) => a.id), true)}>
                일괄 승인
              </button>
              <button className="small" disabled={sending} onClick={() => void decide(salary.map((a) => a.id), false)}>
                일괄 반려
              </button>
            </div>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 14px' }}>
          <button className="small" onClick={() => (onClose(), nav.go({ name: 'org' }))}>
            결재함에서 자세히
          </button>
          <button onClick={onClose}>나중에</button>
        </div>
      </div>
    </div>
  );
}
