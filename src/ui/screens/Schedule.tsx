import { useEffect, useState } from 'react';
import type { CalendarEventView, FixtureView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo } from '../format';

const MONTHS = ['03', '04', '05', '06', '07', '08', '09', '10', '11'];

export function Schedule({ nav }: { nav: Nav }) {
  const d = nav.dashboard!;
  const [onlyMine, setOnlyMine] = useState(true);
  const [month, setMonth] = useState(d.date.slice(5, 7) >= '03' && d.date.slice(5, 7) <= '11' ? d.date.slice(5, 7) : '03');
  const [rows, setRows] = useState<FixtureView[]>([]);
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const year = d.openingDay.slice(0, 4);

  useEffect(() => {
    api('game.calendar', { from: d.date, to: `${year}-12-31` }).then(setEvents).catch(() => setEvents([]));
  }, [d.date, year]);

  useEffect(() => {
    api('game.schedule', { clubId: onlyMine ? d.userClub.id : undefined, month: `${year}-${month}` })
      .then(setRows)
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyMine, month, year, d.userClub.id]);

  const byDate = new Map<string, FixtureView[]>();
  for (const f of rows) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f]);

  return (
    <div className="page">
      <h1>일정</h1>
      <section className="panel">
        <div className="panel-head">
          <h2>리그 주요 일정</h2>
          <span className="meta">{d.phaseLabel}</span>
        </div>
        <div className="panel-body">
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.date + e.kind}>
                <span className="when">{dateKo(e.date)}</span>
                <span>
                  <strong>{e.title}</strong> <span className="muted small">{e.body}</span>
                </span>
              </li>
            ))}
            {events.length === 0 && <li className="muted">남은 리그 일정이 없습니다.</li>}
          </ul>
        </div>
      </section>
      <h2 style={{ margin: '18px 0 10px' }}>{year} 경기 일정·결과</h2>
      <div className="toolbar">
        <div className="seg">
          {MONTHS.map((m) => (
            <button key={m} className={month === m ? 'active' : ''} onClick={() => setMonth(m)}>{Number(m)}월</button>
          ))}
        </div>
        <label><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> 우리 구단 경기만</label>
      </div>
      {[...byDate.entries()].map(([date, list]) => (
        <section key={date} className="panel compact">
          <h3>{dateKo(date)}</h3>
          <table className="grid">
            <tbody>
              {list.map((f) => (
                <tr key={f.fixtureId} className={`${f.played ? 'clickable' : ''} ${f.home.id === d.userClub.id || f.away.id === d.userClub.id ? 'mine' : ''}`} onClick={() => f.played && nav.go({ name: 'boxScore', fixtureId: f.fixtureId })}>
                  <td className="right">{f.away.name}</td>
                  <td className="center score">{f.played ? `${f.awayRuns} : ${f.homeRuns}` : 'vs'}</td>
                  <td>{f.home.name} <span className="muted small">(홈)</span></td>
                  <td className="muted small">{f.stageLabel && <span className="badge star">{f.stageLabel}</span>} {f.played && f.innings && f.innings > 9 ? `연장 ${f.innings}회` : ''}{f.played && f.homeRuns === f.awayRuns ? ' 무승부' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {rows.length === 0 && <p className="muted">이 달에는 경기가 없습니다.</p>}
    </div>
  );
}
