import { useEffect, useState } from 'react';
import type { FinanceView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo, won } from '../format';
import { Icon } from '../icons';

const signed = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `-${won(-n)}` : '0');

export function Finance({ nav }: { nav: Nav }) {
  const [f, setF] = useState<FinanceView | null>(null);
  useEffect(() => {
    api('game.finance').then(setF).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);
  if (!f) return <div className="page muted">불러오는 중…</div>;
  return (
    <div className="page">
      <h1>재정</h1>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi">
          <Icon name="coins" size={26} />
          <span className="label">현금</span>
          <span className="value">{won(f.cashWon)}</span>
        </div>
        <div className="kpi">
          <span className="label">{f.seasonYear} 시즌 수입</span>
          <span className="value">{won(f.seasonRevenueWon)}</span>
        </div>
        <div className="kpi">
          <span className="label">{f.seasonYear} 시즌 지출</span>
          <span className="value">{won(-f.seasonExpenseWon)}</span>
        </div>
      </div>
      <div className="columns even">
        <section className="panel">
          <div className="panel-head">
            <h2>{f.seasonYear} 시즌 항목별 합계</h2>
            <span className="meta">{f.inflationNote}</span>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>항목</th>
                <th className="num">금액</th>
              </tr>
            </thead>
            <tbody>
              {f.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.label}</td>
                  <td className={`num ${c.amountWon >= 0 ? 'amount-pos' : 'amount-neg'}`}>{signed(c.amountWon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="panel-body muted small">
            시즌 연도는 2월~다음 해 1월입니다. 선수 연봉은 2~11월에 10회로 나눠 지급하고, 직원 급여와 고정비는 매월 말에 지급합니다.
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>최근 장부</h2>
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
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
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="panel plain">
        <strong>아직 장부에 들어오지 않는 항목</strong>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          {f.notImplemented.join(' · ')} — 해당 기능을 개발하는 단계에서 추가됩니다. 지금 보이는 현금 흐름에는 이 수입·지출이 빠져 있습니다.
        </p>
      </section>
    </div>
  );
}
