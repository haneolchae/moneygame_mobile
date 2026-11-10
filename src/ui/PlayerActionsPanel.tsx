// 선수 상세 행동 영역(3d, 18a 4장·D-118). 가능 여부·비용·불가 사유는 게임 로직(player.actions)이 계산하고,
// 이 화면은 그대로 보여 주고 기존 명령을 호출한다. 실행 중에는 모든 버튼을 잠가 같은 명령이 두 번 가지 않게 한다.
import { useCallback, useEffect, useState } from 'react';
import type { OfferResultView, PlayerActionKey, PlayerActionsView } from '../shared/protocol';
import type { Nav } from './App';
import { api, ApiError } from './api';
import { dateKo, won } from './format';
import { DelegateForm, OfferForm } from './screens/Market';

const EOK = 100_000_000;
const toEok = (n: number) => +(n / EOK).toFixed(2);
const usd = (n: number) => `${Math.round(n / 10_000).toLocaleString('ko-KR')}만 달러`;

interface Props {
  playerId: number;
  playerName: string;
  nav: Nav;
  /** 실행 전에 미저장 메모를 저장한다. 실패하면 실행하지 않는다. */
  beforeAct: () => Promise<boolean>;
  /** 실행 뒤 선수 상세·상단 행동력 갱신 */
  onChanged: () => Promise<void>;
}

export function PlayerActionsPanel({ playerId, playerName, nav, beforeAct, onChanged }: Props) {
  const [view, setView] = useState<PlayerActionsView | null>(null);
  const [open, setOpen] = useState<PlayerActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: 'ok' | 'warn' | 'error' } | null>(null);
  const [salaryEok, setSalaryEok] = useState(0);
  const [foreignMan, setForeignMan] = useState(0);
  const [releaseChecked, setReleaseChecked] = useState(false);

  const load = useCallback(async () => {
    const v = await api('player.actions', { playerId });
    setView(v);
    if (v.salary) setSalaryEok(toEok(v.salary.demandWon));
    if (v.foreign) setForeignMan(Math.round(v.foreign.demandUsd / 10_000));
    return v;
  }, [playerId]);

  useEffect(() => {
    setView(null);
    setOpen(null);
    setResult(null);
    setReleaseChecked(false);
    load().catch((e: Error) => setResult({ text: e.message, kind: 'error' }));
  }, [load]);

  const after = async (r: OfferResultView) => {
    setResult({ text: r.message, kind: r.result === 'accept' ? 'ok' : 'warn' });
    setOpen(null);
    setReleaseChecked(false);
    await onChanged();
    await load();
  };

  /** 공통 실행: 메모 저장 → 명령 → 결과·갱신. 검증 실패는 비용 없이 이유만 보여 준다. */
  const run = async (fn: () => Promise<OfferResultView>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      if (!(await beforeAct())) return;
      await after(await fn());
    } catch (e) {
      setResult({ text: e instanceof ApiError ? e.message : String(e), kind: 'error' });
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  /** 기존 계약·이적 화면의 입력 양식은 자체 전송을 하므로 결과만 받아 갱신한다. */
  const formDone = (r: OfferResultView) => void after(r).catch((e: Error) => setResult({ text: e.message, kind: 'error' }));

  if (!view) return <section className="panel actions-panel"><h2>선수 행동</h2><p className="muted">{result?.text ?? '불러오는 중…'}</p></section>;
  const groups = [...new Set(view.actions.map((a) => a.group))];
  const sel = view.actions.find((a) => a.key === open) ?? null;

  return (
    <section className="panel actions-panel" aria-label="선수 행동">
      <h2>
        선수 행동 <span className="muted small">이번 주 남은 행동력 {view.apRemaining} · 현금 {won(view.cashWon)}</span>
      </h2>
      {view.badges.length > 0 && (
        <p>
          {view.badges.map((b) => (
            <span key={b} className="badge fa" style={{ marginRight: 6 }}>{b}</span>
          ))}
        </p>
      )}
      {view.actions.length === 0 && <p className="muted small">지금 이 선수에게 실행할 수 있는 계약·선수 정리 행동이 없습니다. 조사는 [능력치] 탭에서 할 수 있습니다.</p>}
      {groups.map((g) => (
        <div key={g} className="action-group">
          <div className="muted small">{g}</div>
          <div className="toolbar">
            {view.actions
              .filter((a) => a.group === g)
              .map((a) => (
                <div key={a.key} className="action-item">
                  <button
                    className={a.primary ? 'primary' : a.key === 'release' ? 'danger' : ''}
                    disabled={busy || !a.enabled}
                    aria-expanded={open === a.key}
                    onClick={async () => {
                      // 입력 양식을 열기 전에 미저장 메모를 저장한다(계약 양식은 자체 전송).
                      if (open !== a.key && !(await beforeAct())) return;
                      setOpen(open === a.key ? null : a.key);
                      setReleaseChecked(false);
                      setResult(null);
                    }}
                  >
                    {a.label} · {a.apCost > 0 ? `행동력 ${a.apCost}` : '행동력 0'}
                  </button>
                  <div className="muted small">{a.executor}</div>
                  {a.reason && <div className="small reason">불가: {a.reason}</div>}
                </div>
              ))}
          </div>
        </div>
      ))}

      {sel && (
        <div className="action-form">
          {sel.costNote && <p className="muted small">비용: {sel.costNote}</p>}
          {sel.key === 'faOffer' && view.fa && <OfferForm row={view.fa} nav={nav} onDone={formDone} />}
          {sel.key === 'faDelegate' && view.fa && <DelegateForm row={view.fa} ops={view.ops} nav={nav} onDone={formDone} />}
          {sel.key === 'salaryOffer' && view.salary && (
            <div className="offer-form">
              <strong>{playerName} 연봉 제시</strong>
              <span className="muted small">
                지난 연봉 {won(view.salary.priorWon)} · 요구 {won(view.salary.demandWon)}
                {view.salary.offerWon > 0 ? ` · 최근 제시 ${won(view.salary.offerWon)}` : ''}
              </span>
              <label>
                제시액(억) <input type="number" step="0.1" min="0.3" value={salaryEok} onChange={(e) => setSalaryEok(Number(e.target.value))} style={{ width: 90 }} />
              </label>
              <button className="primary" disabled={busy} onClick={() => void run(() => api('market.salaryOffer', { playerId, offerWon: Math.round(salaryEok * EOK) }))}>
                연봉 제안 보내기 (행동력 1)
              </button>
            </div>
          )}
          {sel.key === 'salaryDelegate' && (
            <div className="offer-form">
              <span>운영팀이 정책 한도 안에서 매주 한 번 제시합니다. 진행 중인 위임은 [진행 중인 업무]에서 취소할 수 있습니다.</span>
              <button className="primary" disabled={busy} onClick={() => void run(() => api('org.delegateSalary', { playerId }))}>
                연봉 협상 맡기기 (행동력 없음)
              </button>
            </div>
          )}
          {sel.key === 'foreignOffer' && view.foreign && (
            <div className="offer-form">
              <strong>{playerName} {view.foreign.status === 'pool' ? '영입 제안' : '재계약 제안'}</strong>
              <span className="muted small">
                요구 {usd(view.foreign.demandUsd)} · {view.foreign.origin === 'asia' ? '아시아쿼터' : '외국인'} · 재계약 {view.foreign.renewals}회
              </span>
              <label>
                연봉(만 달러) <input type="number" step="1" min="1" value={foreignMan} onChange={(e) => setForeignMan(Number(e.target.value))} style={{ width: 90 }} />
              </label>
              <button className="primary" disabled={busy} onClick={() => void run(() => api('market.foreignOffer', { playerId, salaryUsd: foreignMan * 10_000 }))}>
                계약 제안 보내기 (행동력 1)
              </button>
            </div>
          )}
          {sel.key === 'persuade' && view.persuade && (
            <div className="offer-form">
              <span>
                고민 이유: {view.persuade.reason} · 설득 기한 {dateKo(view.persuade.deadline)}
              </span>
              <button className="primary" disabled={busy} onClick={() => void run(() => api('roster.persuade', { playerId }))}>
                설득 면담하기 (행동력 {sel.apCost})
              </button>
            </div>
          )}
          {sel.key === 'release' && view.release && (
            <div className="offer-form confirm">
              <strong>{playerName} 방출 확인</strong>
              <span>
                연봉 {won(view.release.salaryWon)} · 남은 계약 {view.release.contractYears}년 · 계속 지급할 잔여 연봉 {view.release.remainingWon > 0 ? won(view.release.remainingWon) : "없음"}
              </span>
              <span>
                선수단 {view.release.rosterCount}명 → {view.release.rosterCount - 1}명 (상한 {view.release.rosterMax}명)
              </span>
              {view.release.note && <span className="reason small">{view.release.note}</span>}
              <label>
                <input type="checkbox" checked={releaseChecked} onChange={(e) => setReleaseChecked(e.target.checked)} /> 되돌릴 수 없음을 확인했습니다
              </label>
              <button className="danger" disabled={busy || !releaseChecked} onClick={() => void run(() => api('market.release', { playerId }))}>
                {playerName} 방출 확정
              </button>
            </div>
          )}
          <button className="small" disabled={busy} onClick={() => setOpen(null)}>
            취소
          </button>
        </div>
      )}

      {result && (
        <p role="status" className={`action-result ${result.kind}`}>
          {result.kind === 'error' ? '실행하지 않음: ' : '결과: '}
          {result.text}
        </p>
      )}

      {view.tasks.length > 0 && (
        <div className="action-group">
          <div className="muted small">진행 중인 업무</div>
          {view.tasks.map((t) => (
            <div key={t.taskId} className="toolbar">
              <span>
                운영팀 {t.kind === 'fa' ? 'FA 협상' : '연봉 협상'} · {t.status}
                {t.note ? ` · ${t.note}` : ''}
              </span>
              <button className="small" disabled={busy} onClick={() => void run(() => api('org.cancelTask', { taskId: t.taskId }))}>
                위임 취소
              </button>
              {t.status === '결재 대기' && (
                <button className="small" disabled={busy} onClick={() => nav.go({ name: 'org' })}>
                  결재 보기
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {view.history.length > 0 && (
        <details>
          <summary className="small">최근 제안 기록 {view.history.length}건</summary>
          <ul className="small">
            {view.history.map((h, i) => (
              <li key={i}>
                {dateKo(h.date)} · {h.kind} · {h.status} · {h.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
