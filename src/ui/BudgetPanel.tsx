// 6e 예산 배분·특별 운영회의(D-177): budget.* 응답만 쓴다. 규칙(한도·행동력·회의 조건)은 게임 쪽이 판정한다.
import { useEffect, useState } from 'react';
import type { BudgetPlanInput, BudgetPlanView, BudgetView } from '../shared/protocol';
import type { Nav } from './App';
import { api, ApiError } from './api';
import { dateKo, won } from './format';

const EOK = 100_000_000;

function toInput(p: BudgetPlanView): BudgetPlanInput {
  return {
    year: p.year,
    ops: Object.fromEntries(p.ops.map((o) => [o.kind, o.multiplier])) as BudgetPlanInput['ops'],
    caps: Object.fromEntries(p.caps.map((c) => [c.kind, c.limitWon])) as BudgetPlanInput['caps'],
  };
}

function PlanEditor({ title, plan, limits, busy, onSave }: { title: string; plan: BudgetPlanView; limits: BudgetView['limits']; busy: boolean; onSave: (p: BudgetPlanInput) => Promise<void> }) {
  const [draft, setDraft] = useState<BudgetPlanInput>(toInput(plan));
  useEffect(() => setDraft(toInput(plan)), [plan]);
  const steps: number[] = [];
  for (let m = limits.minMultiplier; m <= limits.maxMultiplier + 1e-9; m += limits.step) steps.push(Math.round(m * 100) / 100);
  const changed = JSON.stringify(draft) !== JSON.stringify(toInput(plan));
  return (
    <div className="panel-body">
      <h3 style={{ margin: '0 0 6px' }}>
        {title} <span className="muted small">{plan.setBy === 'owner' ? '구단주 확정' : '경영지원팀 편성(기본)'}</span>
      </h3>
      <table className="grid dense">
        <thead>
          <tr><th>운영비</th><th className="num">배수</th><th className="num">연간</th><th>효과</th></tr>
        </thead>
        <tbody>
          {plan.ops.map((o) => (
            <tr key={o.kind}>
              <td>{o.label}</td>
              <td className="num">
                <select disabled={!plan.editable || busy} value={draft.ops[o.kind]} onChange={(e) => setDraft({ ...draft, ops: { ...draft.ops, [o.kind]: Number(e.target.value) } })}>
                  {steps.map((s) => <option key={s} value={s}>{s}배</option>)}
                </select>
              </td>
              <td className="num">{won(Math.round((o.annualWon / o.multiplier) * draft.ops[o.kind]))}</td>
              <td className="muted small">{o.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="grid dense" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>재량 지출 한도</th><th className="num">한도(억)</th><th className="num">집행·예약</th></tr>
        </thead>
        <tbody>
          {plan.caps.map((c) => (
            <tr key={c.kind}>
              <td>{c.label}</td>
              <td className="num">
                <input
                  type="number"
                  min={0}
                  step={limits.capStepWon / EOK}
                  style={{ width: 90, textAlign: 'right' }}
                  disabled={!plan.editable || busy}
                  value={Math.round(draft.caps[c.kind] / EOK)}
                  onChange={(e) => setDraft({ ...draft, caps: { ...draft.caps, [c.kind]: Math.max(0, Math.round(Number(e.target.value) || 0)) * EOK } })}
                />
              </td>
              <td className={`num ${c.usedWon > draft.caps[c.kind] ? 'amount-neg' : ''}`}>{c.kind === 'payroll' ? `현재 ${won(c.usedWon)}` : won(c.usedWon)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="primary" disabled={!plan.editable || !changed || busy} onClick={() => void onSave(draft)}>
          예산 확정
        </button>
        <span className="muted small">{plan.editNote}</span>
      </div>
    </div>
  );
}

export function BudgetPanel({ nav }: { nav: Nav }) {
  const [v, setV] = useState<BudgetView | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
  useEffect(() => {
    api('budget.view').then(setV).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!v) return null;
  const save = async (p: BudgetPlanInput) => {
    setBusy(true);
    try {
      const r = await api('budget.set', p);
      setV(r.view);
      nav.notify(r.message);
      await nav.sync();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const convene = async () => {
    setBusy(true);
    try {
      const r = await api('meeting.convene');
      setV(r.view);
      nav.notify(r.message);
      await nav.sync();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const m = v.meeting.latest;
  return (
    <div className="columns even">
      <section className="panel">
        <div className="panel-head">
          <h2>예산</h2>
          <span className="meta">예산 연도는 2월 시즌 시작 ~ 다음 해 1월</span>
        </div>
        <PlanEditor title={`${v.current.year} 예산(집행 중)`} plan={v.current} limits={v.limits} busy={busy} onSave={save} />
        {v.planning && <PlanEditor title={`${v.planning.year} 시즌 예산안`} plan={v.planning} limits={v.limits} busy={busy} onSave={save} />}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>특별 운영회의</h2>
          <span className="meta">행동력 {v.meeting.ap} · 주 1회</span>
        </div>
        <div className="panel-body">
          <div className="row" style={{ marginTop: 0 }}>
            <button disabled={busy || v.meeting.heldThisWeek} onClick={() => void convene()}>
              {v.meeting.heldThisWeek ? '이번 주 회의 완료' : '운영회의 소집'}
            </button>
            <span className="muted small">감독·단장·재무 책임자의 안건을 한 번에 받고, 이번 주에 이번 예산을 고칠 수 있습니다.</span>
          </div>
          {m ? (
            <>
              <p className="muted small" style={{ margin: '10px 0 6px' }}>최근 회의 {dateKo(m.date)}</p>
              <ul className="meeting-items">
                {m.items.map((it, i) => (
                  <li key={i}>
                    <strong>{it.who}</strong> {it.text}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted small">아직 연 회의가 없습니다. 주간 보고와 결재는 회의 없이도 그대로 이용할 수 있습니다.</p>
          )}
        </div>
      </section>
    </div>
  );
}
