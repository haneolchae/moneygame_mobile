// 포스트시즌 대진표 (01 문서 포스트시즌)
import type { PostseasonView } from '../shared/protocol';
import { Emblem } from './Emblem';

export function PostseasonBracket({ ps, userClubId }: { ps: PostseasonView; userClubId: number }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{ps.season} 포스트시즌</h2>
        <span className="meta">{ps.champion ? `우승 ${ps.champion.name}` : ps.userResult}</span>
      </div>
      <table className="grid dense">
        <tbody>
          {ps.series.map((s) => {
            const team = (c: PostseasonView['series'][number]['high'], wins: number) =>
              c ? (
                <span style={{ fontWeight: c.id === userClubId || s.winner?.id === c.id ? 700 : 400, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Emblem club={c} size={20} />
                  {c.shortName} <span className="gold">{wins}</span>
                </span>
              ) : (
                <span className="muted">미정</span>
              );
            return (
              <tr key={s.key} className={s.high?.id === userClubId || s.low?.id === userClubId ? 'mine' : ''}>
                <td>
                  <strong>{s.label}</strong>
                  <div className="muted small">{s.note}</div>
                </td>
                <td>{team(s.high, s.highWins)}</td>
                <td className="muted">vs</td>
                <td>{team(s.low, s.lowWins)}</td>
                <td className="small">{s.ties ? `무승부 ${s.ties}` : ''}</td>
                <td className="small">{s.winner ? `${s.winner.shortName} 승리` : `${s.dates[0]!.slice(5).replace('-', '/')} 시작`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
