// 8e 올스타전 화면(D-189·D-190): 투표 집계, 명단, 홈런 레이스, 경기 결과, 투표 캠페인·유치 신청, 역대 기록
import { useEffect, useState } from 'react';
import type { AllStarView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { dateKo, won } from '../format';

const TEAM = { dream: '드림', nanum: '나눔' } as const;
const STAGE = { before: '투표 전', voting: '팬 투표 중', announced: '명단 발표', done: '올스타전 종료' } as const;

export function AllStar({ nav }: { nav: Nav }) {
  const [v, setV] = useState<AllStarView | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const load = (season?: number) => api('allStar.view', season !== undefined ? { season } : {}).then(setV).catch((e: Error) => nav.notify(e.message, 'error'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (fn: () => Promise<{ message: string; view: AllStarView }>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setV(r.view);
      setResult({ text: r.message, kind: 'ok' });
      await nav.sync();
    } catch (e) {
      setResult({ text: e instanceof ApiError ? e.message : String(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  if (!v) return <div className="page"><p className="muted">불러오는 중…</p></div>;
  const goPlayer = (id: number) => nav.go({ name: 'player', playerId: id, back: { name: 'allStar' } });
  return (
    <div className="page">
      <h1>
        {v.season} 올스타전 <span className="muted small">{STAGE[v.stage]}</span>
      </h1>
      <div className="row">
        <label>
          시즌{' '}
          <select value={v.season} onChange={(e) => void load(Number(e.target.value))}>
            {v.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <section className="panel">
        <h2>일정·개최</h2>
        <p>팬 투표 {dateKo(v.dates.voteStart)} ~ {dateKo(v.dates.close)} · 홈런 레이스 {dateKo(v.dates.hrRace)} · 올스타전 {dateKo(v.dates.game)}</p>
        {v.host && <p>개최: {v.host.club.name} 홈구장 ({v.host.by === 'application' ? `유치 신청 심사 — 신청 ${v.host.applicants.join('·')}` : '순환 순서'})</p>}
        {v.managers && <p>감독: 드림 {v.managers.dream.shortName} · 나눔 {v.managers.nanum.shortName}</p>}
        <p className="muted small">드림 = 홀수 번호 구단, 나눔 = 짝수 번호 구단. 올스타 기록은 정규시즌 기록·순위·타이틀에 넣지 않습니다.</p>
      </section>
      <section className="panel">
        <h2>구단주 행동</h2>
        <div className="row">
          <div>
            <b>올스타 투표 캠페인</b> — 비용 {won(v.campaign.costWon)} · 행동력 {v.campaign.ap} · 마감까지 우리 선수 득표 약 +{v.campaign.bonusVotes.toLocaleString('ko-KR')}표
            {v.campaign.done ? <div className="muted small">{dateKo(v.campaign.done)} 실행함</div> : v.campaign.reason ? <div className="reason small">{v.campaign.reason}</div> : null}
          </div>
          <button disabled={busy || !!v.campaign.reason} onClick={() => void run(() => api('allStar.campaign', {}))}>캠페인 실행</button>
        </div>
        <div className="row">
          <div>
            <b>{v.hosting.season} 올스타전 유치 신청</b> — 행동력 {v.hosting.ap} · 신청 구단 중 직전 시즌 관중 점유율·구장 시설·수용 인원 점수 1위가 개최
            {v.hosting.applied ? <div className="muted small">신청함</div> : v.hosting.reason ? <div className="reason small">{v.hosting.reason}</div> : null}
          </div>
          <button disabled={busy || !!v.hosting.reason} onClick={() => void run(() => api('allStar.apply', {}))}>유치 신청</button>
        </div>
        {result && <p className={result.kind === 'error' ? 'reason' : 'ok'}>{result.text}</p>}
      </section>
      {v.ballot && (
        <section className="panel">
          <h2>{v.ballot.final ? '최종 투표 결과' : `중간 집계 (${dateKo(v.ballot.date)})`}</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {(['dream', 'nanum'] as const).map((t) => (
              <table className="grid" key={t}>
                <thead><tr><th colSpan={4}>{TEAM[t]}</th></tr><tr><th>자리</th><th>순위</th><th>선수</th><th className="num">득표</th></tr></thead>
                <tbody>
                  {v.ballot!.rows.filter((r) => r.team === t).map((r) => (
                    <tr key={`${r.slotLabel}-${r.playerId}`} className={r.mine ? 'mine' : ''}>
                      <td>{r.slotLabel}</td><td>{r.rank}</td>
                      <td><span className="clickable" onClick={() => goPlayer(r.playerId)}>{r.name}</span> <span className="muted small">{r.club?.shortName}</span></td>
                      <td className="num">{r.votes.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </section>
      )}
      {v.roster.length > 0 && (
        <section className="panel">
          <h2>올스타 명단</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {(['dream', 'nanum'] as const).map((t) => (
              <table className="grid" key={t}>
                <thead><tr><th colSpan={4}>{TEAM[t]}</th></tr><tr><th>구분</th><th>자리</th><th>선수</th><th>비고</th></tr></thead>
                <tbody>
                  {v.roster.filter((r) => r.team === t).map((r) => (
                    <tr key={r.playerId} className={r.mine ? 'mine' : ''}>
                      <td>{r.kind === 'best' ? '베스트 12' : '감독 추천'}</td><td>{r.slotLabel}</td>
                      <td><span className="clickable" onClick={() => goPlayer(r.playerId)}>{r.name}</span> <span className="muted small">{r.club?.shortName}</span></td>
                      <td className="small">{r.status === 'injured' ? '부상(대체)' : r.status === 'rested' ? '선발 휴식' : r.replacesName ? `${r.replacesName} 대체` : r.votes !== null ? `${r.votes.toLocaleString('ko-KR')}표` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </section>
      )}
      {v.hrRace && (
        <section className="panel">
          <h2>홈런 레이스 — 우승 {v.hrRace.champion}</h2>
          <table className="grid">
            <thead><tr><th>라운드</th><th>대결</th><th className="num">홈런</th><th>연장</th><th>승자</th></tr></thead>
            <tbody>
              {v.hrRace.matches.map((m, i) => (
                <tr key={i} className={m.mine ? 'mine' : ''}><td>{m.round}</td><td>{m.a} vs {m.b}</td><td className="num">{m.hrA} : {m.hrB}</td><td>{m.tiebreak || '—'}</td><td>{m.winner}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {v.game && (
        <section className="panel">
          <h2>올스타전 — 드림 {v.game.score.dream} : {v.game.score.nanum} 나눔 · 미스터 올스타 {v.game.mvp.join('·')}</h2>
          <table className="grid">
            <thead><tr><th>팀</th>{v.game.line.dream.map((_, i) => <th key={i} className="num">{i + 1}</th>)}<th className="num">R</th></tr></thead>
            <tbody>
              {(v.game.home === 'dream' ? (['nanum', 'dream'] as const) : (['dream', 'nanum'] as const)).map((t) => (
                <tr key={t}><td>{TEAM[t]}{v.game!.home === t ? ' (홈)' : ''}</td>{v.game!.line[t].map((r, i) => <td key={i} className="num">{r}</td>)}<td className="num"><b>{v.game!.score[t]}</b></td></tr>
              ))}
            </tbody>
          </table>
          <table className="grid">
            <thead><tr><th>팀</th><th>선수</th><th>기록</th></tr></thead>
            <tbody>
              {v.game.lines.map((l) => (
                <tr key={l.playerId} className={l.mine ? 'mine' : ''}><td>{TEAM[l.team]}</td><td><span className="clickable" onClick={() => goPlayer(l.playerId)}>{l.name}</span> <span className="muted small">{l.club?.shortName}</span></td><td>{l.text}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {v.history.length > 0 && (
        <section className="panel">
          <h2>역대 올스타전</h2>
          <table className="grid">
            <thead><tr><th>시즌</th><th>개최</th><th>결과</th><th>미스터 올스타</th><th>홈런 레이스</th><th className="num">우리 선수</th></tr></thead>
            <tbody>
              {v.history.map((h) => (
                <tr key={h.season}><td>{h.season}</td><td>{h.host}</td><td>{h.score}</td><td>{h.mvp}</td><td>{h.hrChampion}</td><td className="num">{h.ours}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
