import { PlayerAbilities } from '../PlayerAbilities';
import { leaveGuard, playerFocus } from '../playerFocus';
import { PlayerActionsPanel } from '../PlayerActionsPanel';
import { useEffect, useRef, useState } from 'react';
import type { FieldingLineView, PlayerDetailView, PlayerRecordView, StatValue } from '../../shared/protocol';
import type { Nav, Route } from '../App';
import { api } from '../api';
import { SprayChart } from '../SprayChart';
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

/** 수비 기록 표(시즌별): 기회 = 자살 + 보살 + 실책 */
export function FieldingTable({ lines, first }: { lines: Array<FieldingLineView & { name?: string; position?: string; playerId?: number }>; first: 'season' | 'player' }) {
  return (
    <table className="grid dense">
      <thead>
        <tr>
          <th>{first === 'season' ? '시즌' : '선수'}</th>
          {first === 'player' && <th>주 포지션</th>}
          <th className="num">자살</th><th className="num">보살</th><th className="num">실책</th><th className="num">기회</th><th className="num">수비율</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={first === 'season' ? l.season : l.playerId}>
            <td>{first === 'season' ? l.season : l.name}</td>
            {first === 'player' && <td>{POSITION_LABELS[l.position ?? ''] ?? l.position}</td>}
            <td className="num">{l.PO}</td><td className="num">{l.A}</td><td className="num">{l.E}</td><td className="num">{l.TC}</td><td className="num">{rate3(l.FPCT)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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

const TABS = ['개요', '능력치', '시즌 기록', '계약·이력', '메모'] as const;
const BACK_LABEL: Partial<Record<Route['name'], string>> = { players: '선수단', market: '계약·이적', dashboard: '구단 현황', boxScore: '박스스코어', draft: '신인 드래프트', team: '팀 기록' };
export function PlayerDetail({ nav, playerId, list, back }: { nav: Nav; playerId: number; list?: number[]; back?: Route }) {
  const [p, setP] = useState<PlayerDetailView | null>(null);
  const [tab, setTab] = useState(0);
  const [text, setText] = useState('');
  const [watched, setWatched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const notify = nav.notify;
  // 화면 이탈 확인에 쓰는 최신 메모 상태(렌더 사이 비동기 저장에서도 같은 값을 본다)
  const latest = useRef({ text: '', watched: false, savedText: '', savedWatched: false });
  latest.current.text = text;
  latest.current.watched = watched;
  useEffect(() => {
    let alive = true;
    setP(null); setError('');
    api('game.player', { playerId }).then(v => { if (alive) { setP(v); setText(v.note.text); setWatched(v.note.watched); latest.current = { text: v.note.text, watched: v.note.watched, savedText: v.note.text, savedWatched: v.note.watched }; closeButton.current?.focus(); } }).catch((e: Error) => { if (alive) { setError(e.message); notify(e.message, 'error'); } });
    return () => { alive = false; };
  }, [playerId, notify]);
  async function save(): Promise<boolean> {
    const cur = latest.current;
    if (cur.text === cur.savedText && cur.watched === cur.savedWatched) return true;
    if (saving) return false;
    setSaving(true); setError('');
    try {
      const note = await api('player.note', { playerId, text: cur.text, watched: cur.watched });
      latest.current.savedText = note.text; latest.current.savedWatched = note.watched;
      setP(old => old ? { ...old, note, watched: note.watched } : old);
      return true;
    }
    catch (e) { setError((e as Error).message); return false; }
    finally { setSaving(false); }
  }
  // 메뉴 이동·날짜 진행·저장 화면 이동 전에 미저장 메모를 저장한다(18a 4장).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const run = () => saveRef.current();
    leaveGuard.run = run;
    return () => { if (leaveGuard.run === run) leaveGuard.run = null; };
  }, []);
  const order = list && list.includes(playerId) ? list : null;
  const previousId = order ? (order[order.indexOf(playerId) - 1] ?? null) : (p?.previousId ?? null);
  const nextId = order ? (order[order.indexOf(playerId) + 1] ?? null) : (p?.nextId ?? null);
  async function leave(id: number | null) {
    if (!(await save())) return;
    if (id === null) playerFocus.id = playerId;
    nav.go(id === null ? (back ?? { name: 'players' }) : { name: 'player', playerId: id, list, back });
  }
  async function reload() {
    const v = await api('game.player', { playerId });
    setP(v);
    await nav.sync();
  }
  async function scout() {
    if (!await save()) return;
    setSaving(true); setError('');
    try { const v = await api('player.scout', { playerId }); setP(v); await nav.sync(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); void leave(null); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  if (!p) return <div className="page">{error || '불러오는 중…'}</div>;
  const dirty = text !== p.note.text || watched !== p.note.watched;
  return <div className="page">
    <div className="toolbar">
      <button ref={closeButton} onClick={() => void leave(null)} disabled={saving}>닫기 · {BACK_LABEL[(back ?? { name: 'players' }).name] ?? '이전 화면'}</button>
      <button disabled={saving || previousId === null} onClick={() => void leave(previousId)}>이전 선수</button>
      <button disabled={saving || nextId === null} onClick={() => void leave(nextId)}>다음 선수</button>
      {order && <span className="muted small">목록 {order.indexOf(playerId) + 1}/{order.length}</span>}
      <label><input type="checkbox" checked={watched} disabled={saving} onChange={async e => {
        const next = e.target.checked; setWatched(next); setSaving(true); setError('');
        try { const note = await api('player.note', { playerId, text, watched: next }); latest.current.savedText = note.text; latest.current.savedWatched = note.watched; setP(old => old ? { ...old, note, watched: next } : old); }
        catch (e) { setWatched(p.note.watched); setError((e as Error).message); }
        finally { setSaving(false); }
      }} /> 관심 등록</label>
    </div>
    <h1>{p.name} <span className="muted">{p.club?.name ?? 'FA'} · {POSITION_LABELS[p.position] ?? p.position} · {p.level}</span></h1>
    <div className="cards">
      <div className="card"><div className="label">나이·생년월일</div><div className="value">{p.age}세</div>{dateKo(p.birthDate)}</div>
      <div className="card"><div className="label">투타</div><div className="value">{p.throws}투 {p.bats === 'S' ? '양' : p.bats}타</div></div>
      <div className="card"><div className="label">경력</div><div className="value">프로 {p.proSeasons}년차</div></div>
      <div className="card"><div className="label">연봉</div><div className="value">{won(p.salaryWon)}</div></div>
    </div>
    {error && <p role="alert">저장·처리 실패: {error}</p>}
    <PlayerActionsPanel playerId={playerId} playerName={p.name} nav={nav} beforeAct={save} onChanged={reload} />
    <div className="seg" role="tablist" aria-label="선수 상세">
      {TABS.map((label,i) => <button key={label} id={'player-tab-'+i} role="tab" aria-selected={tab===i} aria-controls={'player-panel-'+i} tabIndex={tab===i ? 0 : -1} className={tab===i ? 'active' : ''} onClick={() => setTab(i)} onKeyDown={e => {
        const next = e.key === 'ArrowRight' ? (i+1)%TABS.length : e.key === 'ArrowLeft' ? (i+TABS.length-1)%TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length-1 : null;
        if (next !== null) { e.preventDefault(); setTab(next); document.getElementById('player-tab-'+next)?.focus(); }
      }}>{label}</button>)}
    </div>
    <div role="tabpanel" id={'player-panel-'+tab} aria-labelledby={'player-tab-'+tab}>
      {tab===0 && <section className="panel"><h2>이번 시즌 주요 성적</h2>{p.battingStats && <StatTable stats={p.battingStats} spec={BATTING_SPEC.slice(0,9)} />}{p.pitchingStats && <StatTable stats={p.pitchingStats} spec={PITCHING_SPEC.slice(0,10)} />}{!p.battingStats && !p.pitchingStats && <p>이번 시즌 출전 기록이 없습니다.</p>}<p className="muted small">컨디션·부상·기분·코칭 의견은 해당 모델 구현 후 제공됩니다.</p></section>}
      {tab===1 && <><section className="panel"><button disabled={saving || !!p.retired || p.scouting.nextDate > (nav.dashboard?.date ?? '')} onClick={() => void scout()}>스카우트 조사 · 행동력 {p.scouting.apCost}</button><span className="muted small"> · 조사 {p.scouting.reports}회 · 다음 조사 {p.scouting.nextDate}</span></section><PlayerAbilities p={p} /></>}
      {tab===2 && <><section className="panel"><h2>기간별 기록</h2><RecordTable r={p.record} />{p.record.recent.some(l=>l.preGame) && <p className="muted small">2026 시즌까지는 게임 시작 이전 시즌 합계 기록입니다.</p>}</section><section className="panel"><h2>이번 시즌 상세 기록</h2>{p.battingStats && <StatTable stats={p.battingStats} spec={BATTING_SPEC} />}{p.pitchingStats && <StatTable stats={p.pitchingStats} spec={PITCHING_SPEC} />}</section><div className="columns">{p.spray && <section className="panel"><h2>타구 분포</h2><SprayChart spray={p.spray} /></section>}<section className="panel"><h2>수비 기록</h2>{p.fielding.length ? <FieldingTable lines={p.fielding} first="season" /> : <p>수비 기록이 없습니다.</p>}</section></div></>}
      {tab===3 && <section className="panel"><h2>계약·경력</h2><p>연봉 {won(p.salaryWon)} · {p.contractYears===0 ? '이번 시즌 계약 만료' : '계약 잔여 '+p.contractYears+'년'}</p><p>FA 자격 연수 {p.faServiceYears}년 {p.faEligible ? '· 이번 스토브리그 FA 자격' : ''}</p>{p.draftInfo && <p>{p.draftInfo}</p>}{p.retired && <p>{p.retired}</p>}{p.honors.length>0 && <p>아마추어 업적: {p.honors.join(' · ')}</p>}</section>}
      {tab===4 && <section className="panel"><h2>선수 메모</h2><textarea aria-label="선수 메모" maxLength={2000} value={text} disabled={saving} onChange={e=>setText(e.target.value)} rows={10} style={{width:'100%',resize:'vertical'}} /><div className="toolbar"><span>{text.length}/2,000자 · {saving ? '저장 중' : dirty ? '미저장' : '저장됨'}{p.note.updatedAt ? ' · '+new Date(p.note.updatedAt).toLocaleString('ko-KR') : ''}</span><button disabled={saving || !dirty} onClick={()=>void save()}>메모 저장</button></div><p className="muted small">이전·다음 선수 또는 닫기를 누르면 메모를 저장합니다.</p></section>}
    </div>
  </div>;
}
