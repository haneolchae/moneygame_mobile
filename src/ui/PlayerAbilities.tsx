import type { PlayerDetailView } from '../shared/protocol';
import { POSITION_LABELS, RATING_LABELS } from './format';

export function ratingText(p: { ratings: Record<string, number>; ratingRanges: Record<string, { low: number; high: number }> }, key: string): string {
  const range = p.ratingRanges[key];
  return range ? `${range.low}–${range.high}` : p.ratings[key] === undefined ? '—' : String(p.ratings[key]);
}
export function PlayerAbilities({ p }: { p: PlayerDetailView }) {
  const keys = Object.keys(p.exactRatings ? p.ratings : p.ratingRanges).filter(k => !k.startsWith('pitch_'));
  const label = (key: string) => key.startsWith('pos_') ? `${POSITION_LABELS[key.slice(4)] ?? key.slice(4)} 숙련도` : RATING_LABELS[key] ?? key;
  const pitchLabel: Record<string, string> = { velocity: '평균 구속', quality: '구종 평가', command: '제구', movement: '움직임', mastery: '숙련도', usage: '사용 비중' };
  return <>
    <section className="panel">
      <h2>{p.exactRatings ? '현재 능력치' : '스카우트 추정 범위'}</h2>
      <p className="muted small">{p.observationNote}</p>
      {!p.exactRatings && <p>신뢰도 {Math.round(p.scouting.confidence)}% · 관측일 {p.scouting.date} · 관측자 {p.scouting.observer} {p.scouting.stale && <strong>· 오래된 정보</strong>}</p>}
      <div className="ratings">{keys.map(key => {
        const range = p.ratingRanges[key];
        const value = p.ratings[key];
        const velocity = key === 'velocityAvg' || key === 'velocityMax';
        return <div key={key} className="rating player-rating">
          <span className="name">{label(key)}</span>
          <span className="bar" style={{ position: 'relative' }}>{!velocity && <span style={range ? { position: 'absolute', left: `${range.low}%`, width: `${range.high - range.low}%` } : { width: `${value}%` }} />}</span>
          <span className="num">{ratingText(p, key)}{velocity ? ' km/h' : ''}</span>
        </div>;
      })}</div>
    </section>
    {p.pitches.length > 0 && <section className="panel"><h2>구종</h2><div className="table-wrap"><table className="grid dense"><thead><tr><th>구종</th>{Object.values(pitchLabel).map(l => <th key={l}>{l}</th>)}</tr></thead><tbody>{p.pitches.map(pitch => <tr key={pitch.type}><td>{pitch.type}</td>{Object.keys(pitchLabel).map(key => {
      const r = pitch.ranges[key]; const v = pitch.values[key];
      const fmt = (n: number) => key === 'usage' ? `${Math.round(n * 100)}%` : String(Math.round(n));
      return <td key={key}>{r ? `${fmt(r.low)}–${fmt(r.high)}` : v === undefined ? '—' : fmt(v)}{key === 'velocity' ? ' km/h' : ''}</td>;
    })}</tr>)}</tbody></table></div></section>}
    <section className="panel"><h2>성향 관찰</h2><p className="muted small">신뢰도 {Math.round(p.scouting.confidence)}% · 관측일 {p.scouting.date} · {p.scouting.observer} · 실제 히든 수치가 아닌 관찰 의견입니다.</p>{p.traits.map(t => <p key={t.label}><strong>{t.label}</strong> · {t.text}</p>)}</section>
    <section className="panel"><h2>평판 메모</h2>{p.reputation.pending ? <p className="muted">판단 유보 — 조사 신뢰도가 40 이상이면 주변 평판을 정리합니다.</p> : p.reputation.notes.length === 0 ? <p className="muted">눈에 띄는 평판 소식이 없습니다.</p> : p.reputation.notes.map((n, i) => <p key={i}>“{n.text}” <span className="muted small">· {n.source} · {n.certainty}</span></p>)}<p className="muted small">소문은 틀릴 수 있습니다. 여러 출처가 겹칠 때 참고하세요.</p></section>
    <section className="panel"><h2>최근 기록 참고</h2><p>최근 60일 내 {p.isPitcher ? '상대 타석' : '타석'} {p.recentSample.count}/{p.recentSample.limit} · 표본 {p.recentSample.sufficient ? '충분' : '부족'}</p></section>
  </>;
}
