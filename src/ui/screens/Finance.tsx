// 재정(D-140 Diamond Office 배치): game.finance 응답만 쓴다. 현금·시즌 수입·지출·수지, 항목별 합계(수입/지출), 최근 장부.
// 비중은 같은 시즌·같은 분모(시즌 운영 수입 또는 지출 합계)일 때만 보여 주고 분모가 0이면 숨긴다.
// 예산·전년비·인사이트처럼 원천 데이터가 없는 값은 만들지 않는다. 기초 현금은 운영 수입이 아니라 비중에서 뺀다.
import { useEffect, useState } from 'react';
import type { FinanceView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo, won } from '../format';
import { Icon } from '../icons';

const signed = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `-${won(-n)}` : '0');

function CategoryTable({ title, rows, total, sign }: { title: string; rows: FinanceView['byCategory']; total: number; sign: 'pos' | 'neg' }) {
  return (
    <>
      <h3 style={{ margin: '12px 16px 6px' }}>{title}</h3>
      <table className="grid" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: '44%' }}>항목</th>
            <th className="num" style={{ width: '22%' }}>금액</th>
            <th className="num" title="같은 시즌 운영 합계 대비">비중</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const share = total !== 0 && c.category !== 'startCash' ? Math.abs(c.amountWon / total) : null;
            return (
              <tr key={c.category}>
                <td>
                  {c.label}
                  {c.category === 'startCash' && <span className="muted small"> (운영 수입 아님)</span>}
                </td>
                <td className={`num ${c.amountWon >= 0 ? 'amount-pos' : 'amount-neg'}`}>{signed(c.amountWon)}</td>
                <td className="num">
                  {share === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <span className={`share ${sign}`} aria-hidden="true">
                        <span style={{ width: `${Math.min(100, share * 100).toFixed(1)}%` }} />
                      </span>
                      {(share * 100).toFixed(1)}%
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                아직 기록이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

export function Finance({ nav }: { nav: Nav }) {
  const [f, setF] = useState<FinanceView | null>(null);
  useEffect(() => {
    api('game.finance').then(setF).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);
  if (!f) return <div className="page muted">불러오는 중…</div>;
  const income = f.byCategory.filter((c) => c.amountWon > 0);
  const expense = f.byCategory.filter((c) => c.amountWon < 0);
  const net = f.seasonRevenueWon + f.seasonExpenseWon;
  return (
    <div className="page">
      <h1>
        재정 <span className="muted small">{f.clubName}</span>
      </h1>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi">
          <Icon name="do-finance" size={26} />
          <span className="label">현금</span>
          <span className="value">{won(f.cashWon)}</span>
        </div>
        <div className="kpi">
          <Icon name="do-arrow-up" size={22} />
          <span className="label">{f.seasonYear} 시즌 수입</span>
          <span className="value">{won(f.seasonRevenueWon)}</span>
        </div>
        <div className="kpi">
          <Icon name="do-arrow-down" size={22} />
          <span className="label">{f.seasonYear} 시즌 지출</span>
          <span className="value" style={{ color: 'var(--do-danger)' }}>{won(-f.seasonExpenseWon)}</span>
        </div>
        <div className="kpi">
          <span className="label">{f.seasonYear} 시즌 수지(수입 − 지출)</span>
          <span className="value" style={{ color: net < 0 ? 'var(--do-danger)' : undefined }}>{signed(net)}</span>
        </div>
      </div>
      <div className="columns even">
        <section className="panel">
          <div className="panel-head">
            <h2>{f.seasonYear} 시즌 항목별 합계</h2>
            <span className="meta">{f.inflationNote}</span>
          </div>
          <CategoryTable title="수입" rows={income} total={f.seasonRevenueWon} sign="pos" />
          <CategoryTable title="지출" rows={expense} total={f.seasonExpenseWon} sign="neg" />
          <div className="panel-body muted small">
            시즌 연도는 2월~다음 해 1월입니다. 선수 연봉은 2~11월에 10회로 나눠 지급하고, 직원 급여와 고정비는 매월 말에 지급합니다. 비중은 같은 시즌 운영 수입·지출 합계 대비입니다.
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>최근 장부</h2>
            <span className="meta">{f.recent.length}건</span>
          </div>
          <div style={{ maxHeight: 560, overflow: 'auto' }}>
            <table className="grid dense">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>항목</th>
                  <th>내용</th>
                  <th className="num">금액</th>
                </tr>
              </thead>
              <tbody>
                {f.recent.map((e, i) => (
                  <tr key={i}>
                    <td>{dateKo(e.date)}</td>
                    <td>{e.label}</td>
                    <td className="muted">{e.memo}</td>
                    <td className={`num ${e.amountWon >= 0 ? 'amount-pos' : 'amount-neg'}`}>{signed(e.amountWon)}</td>
                  </tr>
                ))}
                {f.recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      아직 장부 기록이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="panel plain">
        <strong>
          <Icon name="do-warning" size={16} /> 아직 장부에 들어오지 않는 항목
        </strong>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          {f.notImplemented.join(' · ')} — 해당 기능을 개발하는 단계에서 추가됩니다. 지금 보이는 현금 흐름에는 이 수입·지출이 빠져 있습니다.
        </p>
      </section>
    </div>
  );
}
