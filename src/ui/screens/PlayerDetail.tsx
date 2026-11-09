import { useEffect, useState } from 'react';
import type { PlayerDetailView, PlayerRecordView, StatValue } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo, fixed2, gradeLabel, innings, int, NON_SCALE_RATINGS, pct, POSITION_LABELS, RATING_LABELS, rate3, won } from '../format';

function StatTable({ stats, spec }: { stats: Record<string, StatValue>; spec: Array<[string, (v: StatValue | undefined) => string]> }) {
  return (
    <table className="grid dense">
      <thead>
        <tr>{spec.map(([k]) => <th key={k} className="num">{k}</th>)}</tr>
      </thead>
      <tbody>
        <tr>{spec.map(([k, f]) => <td key={k} className="num">{f(stats[k])}</td>)}</tr>
      </tbody>
    </table>
  );
}

const BATTING_SPEC: Array<[string, (v: StatValue | undefined) => string]> = [
  ['G', int], ['PA', int], ['AB', int], ['H', int], ['2B', int], ['3B', int], ['HR', int], ['RBI', int], ['R', int], ['BB', int], ['HBP', int], ['SO', int], ['SF', int],
  ['AVG', rate3], ['OBP', rate3], ['SLG', rate3], ['OPS', rate3], ['ISO', rate3], ['BABIP', rate3], ['BB%', pct], ['K%', pct],
];
const PITCHING_SPEC: Array<[string, (v: StatValue | undefined) => string]> = [
  ['G', int], ['GS', int], ['IP', innings], ['W', int], ['L', int], ['SV', int], ['BF', int], ['H', int], ['R', int], ['ER', int], ['BB', int], ['HBP', int], ['K', int], ['HR', int],
  ['ERA', fixed2], ['WHIP', fixed2], ['FIP', fixed2], ['K/9', fixed2], ['BB/9', fixed2], ['HR/9', fixed2], ['K-BB%', pct],
];

/** 기간별 기록: 현재 시즌 → 직전 3개 시즌 → 통산 (D-079) */
function RecordTable({ r }: { r: PlayerRecordView }) {
  const rows = [...(r.current ? [r.current] : []), ...r.recent, ...(r.career ? [r.career] : [])];
  if (rows.length === 0) return <p className="muted">1군 기록이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="grid dense">
        <thead>
          <tr>
            <th>구분</th>
            <th>소속</th>
            {r.columns.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.label} className={l.season === null ? 'mine' : ''}>
              <td>
                {l.label}
                {l.preGame && l.season !== null && <span className="muted small"> (시작 이전)</span>}
              </td>
              <td>{l.club ?? ''}</td>
              {r.columns.map((c) => (
                <td key={c} className="num">
                  {l.values[c] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayerDetail({ nav, playerId }: { nav: Nav; playerId: number }) {
  const [p, setP] = useState<PlayerDetailView | null>(null);
  useEffect(() => {
    api('game.player', { playerId }).then(setP).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [playerId, nav]);
  if (!p) return <div className="page muted">불러오는 중…</div>;
  return (
    <div className="page">
      <button className="link" onClick={() => nav.go({ name: 'players' })}>← 선수단</button>
      <h1>
        {p.name} <span className="muted">{p.club?.name ?? 'FA'} · {POSITION_LABELS[p.position] ?? p.position} · {p.level}</span>
      </h1>
      <div className="cards">
        <div className="card"><div className="label">나이</div><div className="value">{p.age}세</div><div className="muted small">{dateKo(p.birthDate)}생</div></div>
        <div className="card"><div className="label">투타</div><div className="value">{p.throws}투 {p.bats === 'S' ? '양' : p.bats}타</div></div>
        <div className="card"><div className="label">경력</div><div className="value">프로 {p.proSeasons}년차</div><div className="muted small">FA 자격 연수 {p.faServiceYears}년 {p.faEligible ? '· 이번 스토브리그 FA 자격' : ''}{p.franchise ? ' · 구단 간판 선수' : ''}</div></div>
        <div className="card"><div className="label">연봉</div><div className="value">{won(p.salaryWon)}</div><div className="muted small">{p.contractYears === 0 ? '이번 시즌으로 계약 만료' : `계약 잔여 ${p.contractYears}년`}</div></div>
      </div>
      {(p.honors.length > 0 || p.draftInfo || p.retired) && (
        <section className="panel">
          <h2>경력 메모</h2>
          {p.retired && <p><strong>{p.retired}</strong></p>}
          {p.draftInfo && <p>{p.draftInfo}</p>}
          {p.honors.length > 0 && <p className="small">아마추어 개인 업적: {p.honors.join(' · ')}</p>}
        </section>
      )}
      <section className="panel">
        <h2>
          {p.exactRatings ? '능력치 (1~100)' : '스카우트 평가 (1~100)'} {p.exactRatings && <span className="badge star">정확</span>}
        </h2>
        <p className="muted small">{p.observationNote}</p>
        <div className="ratings">
          {Object.entries(p.ratings).map(([k, v]) => (
            <div key={k} className="rating">
              <span className="name">{RATING_LABELS[k] ?? k}</span>
              <span className="bar">{!NON_SCALE_RATINGS.includes(k) && <span style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />}</span>
              <span className="num">{v}</span>
              <span className="muted small">{NON_SCALE_RATINGS.includes(k) ? '' : gradeLabel(v)}</span>
            </div>
          ))}
        </div>
        {!p.exactRatings && <p className="muted small">잠재력·성장·성향은 숨겨진 값이며 아직 조사하지 않았습니다.</p>}
      </section>
      <section className="panel">
        <h2>기간별 기록</h2>
        <RecordTable r={p.record} />
        {p.record.recent.some((l) => l.preGame) && <p className="muted small">2026 시즌까지는 게임 시작 이전 기록입니다(시즌 합계만, 경기별 기록 없음).</p>}
      </section>
      <section className="panel">
        <h2>이번 시즌 상세 기록</h2>
        {p.battingStats && <StatTable stats={p.battingStats} spec={BATTING_SPEC} />}
        {p.pitchingStats && <StatTable stats={p.pitchingStats} spec={PITCHING_SPEC} />}
        {!p.battingStats && !p.pitchingStats && <p className="muted">이번 시즌 출전 기록이 없습니다.</p>}
        <p className="muted small">분모가 0인 지표는 '—'로 표시합니다. FIP 상수는 리그 평균 ERA에 맞춰 시즌 중 계속 갱신됩니다(잠정치).</p>
      </section>
    </div>
  );
}
