import { useEffect, useState } from 'react';
import type { BoxScoreView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo, POSITION_LABELS } from '../format';

export function BoxScore({ nav, fixtureId }: { nav: Nav; fixtureId: number }) {
  const [b, setB] = useState<BoxScoreView | null>(null);
  const [showPlays, setShowPlays] = useState(false);
  useEffect(() => {
    api('game.boxScore', { fixtureId }).then(setB).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [fixtureId, nav]);
  if (!b) return <div className="page muted">불러오는 중…</div>;
  const f = b.fixture;
  const innings = Math.max(b.lineScore.away.length, b.lineScore.home.length);
  const cell = (v: number | undefined) => (v === undefined ? '' : v < 0 ? 'X' : String(v));
  const sides = [
    { key: 'away' as const, club: f.away, runs: f.awayRuns },
    { key: 'home' as const, club: f.home, runs: f.homeRuns },
  ];
  return (
    <div className="page">
      <button className="link" onClick={() => nav.go({ name: 'schedule' })}>← 일정·결과</button>
      <h1>{f.away.name} {f.awayRuns} : {f.homeRuns} {f.home.name}</h1>
      <p className="muted">{dateKo(f.date)}{f.innings && f.innings > 9 ? ` · 연장 ${f.innings}회` : ''}</p>
      <section className="panel">
        <table className="grid linescore">
          <thead>
            <tr><th />{Array.from({ length: innings }, (_, i) => <th key={i} className="num">{i + 1}</th>)}<th className="num">R</th><th className="num">H</th></tr>
          </thead>
          <tbody>
            {sides.map((s) => (
              <tr key={s.key}>
                <td>{s.club.name}</td>
                {Array.from({ length: innings }, (_, i) => <td key={i} className="num">{cell(b.lineScore[s.key][i])}</td>)}
                <td className="num"><strong>{s.runs}</strong></td>
                <td className="num">{b.hits ? b.hits[s.key] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!b.detailKept && <p className="muted small">지난 시즌 경기는 최종 스코어와 이닝별 점수만 보관합니다. 선수 기록은 시즌 합계로 남아 있습니다.</p>}
      </section>
      <div className="columns">
        {sides.map((s) => (
          <section key={s.key} className="panel">
            <h2>{s.club.name} 타격</h2>
            <table className="grid dense">
              <thead><tr><th>선수</th><th title="이 경기 수비 위치가 아니라 선수의 주 포지션">주 포지션</th><th className="num">타석</th><th className="num">타수</th><th className="num">득점</th><th className="num">안타</th><th className="num">홈런</th><th className="num">타점</th><th className="num">볼넷</th><th className="num">삼진</th><th className="num" title="이 경기에서 본 투구 수">투구</th></tr></thead>
              <tbody>
                {b.batting[s.key].map((l) => (
                  <tr key={l.playerId} className="clickable" onClick={() => nav.go({ name: 'player', playerId: l.playerId, back: { name: 'boxScore', fixtureId } })}>
                    <td>{l.name}</td><td>{POSITION_LABELS[l.position] ?? l.position}</td>
                    <td className="num">{l.PA}</td><td className="num">{l.AB}</td><td className="num">{l.R}</td><td className="num">{l.H}</td><td className="num">{l.HR}</td><td className="num">{l.RBI}</td><td className="num">{l.BB}</td><td className="num">{l.SO}</td><td className="num">{l.NP}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>{s.club.name} 투구</h2>
            <table className="grid dense">
              <thead><tr><th>선수</th><th /><th className="num">이닝</th><th className="num">피안타</th><th className="num">실점</th><th className="num">자책</th><th className="num">볼넷</th><th className="num">삼진</th><th className="num">피홈런</th><th className="num">투구수</th></tr></thead>
              <tbody>
                {b.pitching[s.key].map((l) => (
                  <tr key={l.playerId} className="clickable" onClick={() => nav.go({ name: 'player', playerId: l.playerId, back: { name: 'boxScore', fixtureId } })}>
                    <td>{l.name}</td><td>{l.decision === 'W' ? '승' : l.decision === 'L' ? '패' : l.decision === 'S' ? '세' : ''}</td>
                    <td className="num">{l.IP}</td><td className="num">{l.H}</td><td className="num">{l.R}</td><td className="num">{l.ER}</td><td className="num">{l.BB}</td><td className="num">{l.K}</td><td className="num">{l.HR}</td><td className="num">{l.pitches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <section className="panel">
        <button onClick={() => setShowPlays((v) => !v)}>{showPlays ? '문자 중계 접기' : '문자 중계 보기'}</button>
        {showPlays && (
          <ol className="plays">
            {b.playByPlay.map((p, i) => (
              <li key={i}><span className="muted">{p.inning}회{p.half === 'T' ? '초' : '말'}</span> {p.text}</li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
