// 5a 트레이드 협상 화면(09·18b·D-131). 구단 상세 '트레이드 협상'과 선수 상세 '트레이드 문의'가 같은 화면·세션을 연다.
// 교환안 작성·미리보기는 무료이고, 상대 반응은 실제 제안에서만 받는다. 제안·역제안 수락은 명령 식별자를 붙여 두 번 처리되지 않게 한다.
import { useCallback, useEffect, useState } from 'react';
import type { TradePlayerView, TradePreviewView, TradeResultView, TradeView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { dateKo, POSITION_LABELS, won } from '../format';
import { ratingText } from '../PlayerAbilities';

const EOK = 100_000_000;
const newCommandId = () => (globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function PlayerTable({ rows, picked, toggle, max, own, nav, list }: { rows: TradePlayerView[]; picked: number[]; toggle: (id: number) => void; max: number; own: boolean; nav: Nav; list: number[] }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 420 }}>
      <table className="grid dense">
        <thead>
          <tr>
            <th></th>
            <th>이름</th>
            <th>포지션</th>
            <th>1·2군</th>
            <th className="num">나이</th>
            <th className="num">연봉</th>
            <th className="num">계약</th>
            <th className="num" title={own ? '실제 능력' : '스카우트 추정 범위'}>주요 능력</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item: p, tradable, reason }) => {
            const on = picked.includes(p.id);
            const keys = p.isPitcher ? ['stuff', 'control'] : ['contact', 'power'];
            return (
              <tr key={p.id} className={tradable ? '' : 'muted'} title={reason ?? ''}>
                <td>
                  <input type="checkbox" aria-label={`${p.name} 선택`} checked={on} disabled={!tradable || (!on && picked.length >= max)} onChange={() => toggle(p.id)} />
                </td>
                <td>
                  <span className="clickable" onClick={() => nav.go({ name: 'player', playerId: p.id, list })}>
                    {p.name}
                  </span>{' '}
                  {p.healthStatus && <span className="badge req">{p.healthStatus}</span>} {p.franchise && <span className="badge star">간판</span>}
                  {!tradable && (
                    <span className="badge" title={reason ?? ''}>
                      거래 불가
                    </span>
                  )}
                </td>
                <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                <td>{p.level}</td>
                <td className="num">{p.age}</td>
                <td className="num">{won(p.salaryWon)}</td>
                <td className="num">{p.contractYears === 0 ? '만료' : `${p.contractYears}년`}</td>
                <td className="num">{keys.map((k) => ratingText(p, k)).join(' / ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Trade({ nav, clubId, want }: { nav: Nav; clubId: number; want?: number }) {
  const [view, setView] = useState<TradeView | null>(null);
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>(want ? [want] : []);
  const [cashEok, setCashEok] = useState(0);
  const [cashDir, setCashDir] = useState<'we' | 'they'>('we');
  const [preview, setPreview] = useState<TradePreviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: 'ok' | 'warn' | 'error' } | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: 'propose' | 'counter' } | null>(null);

  const load = useCallback(async () => setView(await api('trade.view', { clubId })), [clubId]);
  useEffect(() => {
    load().catch((e: Error) => setResult({ text: e.message, kind: 'error' }));
  }, [load]);

  const cashWon = Math.round(cashEok * EOK) * (cashDir === 'we' ? 1 : -1);
  useEffect(() => {
    if (!view || give.length + get.length === 0) {
      setPreview(null);
      return;
    }
    let alive = true;
    api('trade.preview', { clubId, give, get, cashWon })
      .then((p) => alive && setPreview(p))
      .catch((e: Error) => alive && setResult({ text: e.message, kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [clubId, give, get, cashWon, view]);

  const done = async (r: TradeResultView) => {
    setView(r.view);
    setResult({ text: r.message, kind: r.result === 'accept' ? 'ok' : 'warn' });
    if (r.result === 'accept') {
      setGive([]);
      setGet([]);
      setCashEok(0);
    }
    await nav.sync();
  };

  /** 같은 명령을 다시 보내면(응답 유실·이중 클릭) 같은 식별자를 써서 서버가 저장된 결과를 돌려준다 */
  const send = async (kind: 'propose' | 'counter') => {
    if (busy) return;
    const id = pending?.kind === kind ? pending.id : newCommandId();
    setPending({ id, kind });
    setBusy(true);
    setResult(null);
    try {
      await done(kind === 'propose' ? await api('trade.propose', { clubId, give, get, cashWon, commandId: id }) : await api('trade.acceptCounter', { clubId, commandId: id }));
      setPending(null);
    } catch (e) {
      setPending(null);
      setResult({ text: e instanceof ApiError ? e.message : String(e), kind: 'error' });
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <div className="page"><p className="muted">{result?.text ?? '불러오는 중…'}</p></div>;
  const toggle = (set: (f: (x: number[]) => number[]) => void) => (id: number) => set((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const names = (ids: number[], rows: TradePlayerView[]) => ids.map((id) => rows.find((r) => r.item.id === id)?.item.name ?? `#${id}`).join(', ') || '없음';
  const errors = preview?.errors ?? [];
  const canPropose = !view.windowReason && view.session.proposalsLeft > 0 && give.length + get.length > 0 && errors.length === 0 && !busy;
  const cashText = (c: number) => (c > 0 ? `우리가 현금 ${won(c)}` : c < 0 ? `상대가 현금 ${won(-c)}` : '현금 없음');

  return (
    <div className="page">
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>트레이드 협상 · {view.club.name}</h1>
        <button className="small" onClick={() => nav.go({ name: 'club', clubId })}>구단 정보</button>
      </div>
      <p className="small">
        {view.windowReason ? <span className="reason">거래 불가: {view.windowReason}</span> : view.session.open ? `이번 주 협상 중 · 남은 제안 ${view.session.proposalsLeft}/${view.limits.proposalsPerSession}회(추가 행동력 없음)` : `이번 주 첫 제안 때 행동력 ${view.session.apCost} + 운영팀 처리량 5 · 같은 주 제안 ${view.limits.proposalsPerSession}회까지`}
        {' · '}이번 주 남은 행동력 {view.apRemaining} · 우리 현금 {won(view.cashWon)}
      </p>

      <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section className="panel">
          <h2>
            보낼 선수 {give.length}/{view.limits.maxPlayers} <span className="muted small">우리 선수 · 실제 능력</span>
          </h2>
          <PlayerTable rows={view.ours} picked={give} toggle={toggle(setGive)} max={view.limits.maxPlayers} own nav={nav} list={view.ours.map((r) => r.item.id)} />
        </section>
        <section className="panel">
          <h2>
            받을 선수 {get.length}/{view.limits.maxPlayers} <span className="muted small">{view.club.shortName} · 스카우트 추정 범위</span>
          </h2>
          <PlayerTable rows={view.theirs} picked={get} toggle={toggle(setGet)} max={view.limits.maxPlayers} own={false} nav={nav} list={view.theirs.map((r) => r.item.id)} />
        </section>
      </div>

      <section className="panel">
        <h2>교환안</h2>
        <p>
          보냄: {names(give, view.ours)} · 받음: {names(get, view.theirs)}
        </p>
        <div className="toolbar">
          <label>
            현금{' '}
            <select value={cashDir} onChange={(e) => setCashDir(e.target.value as 'we' | 'they')}>
              <option value="we">우리가 낸다</option>
              <option value="they">상대가 낸다</option>
            </select>{' '}
            <input type="number" min={0} max={view.limits.maxCashWon / EOK} step={0.1} value={cashEok} onChange={(e) => setCashEok(Math.max(0, Number(e.target.value)))} style={{ width: 80 }} />억 (최대 {view.limits.maxCashWon / EOK}억)
          </label>
        </div>
        {preview && (
          <p className="small">
            미리보기(무료): 우리 선수단 {preview.ours.before} → {preview.ours.after}명 · 연봉 {preview.ours.salaryDelta >= 0 ? '+' : '−'}
            {won(Math.abs(preview.ours.salaryDelta))} · 상대 선수단 {preview.theirs.before} → {preview.theirs.after}명 · {cashText(cashWon)}
          </p>
        )}
        {errors.length > 0 && (
          <ul className="small reason">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="toolbar">
          <button className="primary" disabled={!canPropose} onClick={() => void send('propose')}>
            제안 보내기 ({view.session.open ? '추가 행동력 없음' : `행동력 ${view.session.apCost}`})
          </button>
          <span className="muted small">받은 선수는 2군으로 들어오고, 빠진 1군 자리는 같은 쪽 건강한 선수로 채웁니다.</span>
        </div>
        {result && (
          <p role="status" className={`action-result ${result.kind}`}>
            {result.kind === 'error' ? '실행하지 않음: ' : '결과: '}
            {result.text}
          </p>
        )}
        {view.counter && (
          <div className="offer-form">
            <strong>상대 역제안(이번 주까지 유효)</strong>
            <span>
              보냄 {names(view.counter.give, view.ours)} · 받음 {names(view.counter.get, view.theirs)} · {cashText(view.counter.cashWon)}
            </span>
            <button className="primary" disabled={busy} onClick={() => void send('counter')}>
              역제안 수락 (추가 행동력 없음)
            </button>
          </div>
        )}
      </section>

      {view.log.length > 0 && (
        <section className="panel">
          <h2>이번 시즌 협상 기록</h2>
          <ul className="small">
            {view.log.map((l, i) => (
              <li key={i}>
                {dateKo(l.date)} · {l.kind} · 보냄 {l.give.join(', ') || '없음'} / 받음 {l.get.join(', ') || '없음'} · {cashText(l.cashWon)} — {l.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.history.length > 0 && (
        <section className="panel">
          <h2>이 구단과의 트레이드</h2>
          <ul className="small">
            {view.history.map((h, i) => (
              <li key={i}>
                {dateKo(h.date)} · 보냄 {h.sent.join(', ') || '없음'} / 받음 {h.received.join(', ') || '없음'} · {cashText(h.cashWon)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
