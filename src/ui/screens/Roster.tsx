// 선수단 운영(2d, 09·10 문서, D-119·D-120): 1·2군 교체, 경기 운영 계획(타순·수비 위치·로테이션·마무리), 시범경기 기록.
// 규칙 판정은 게임 로직(roster.move·roster.setPlan)이 하고, 이 화면은 입력을 모아 보내고 결과를 보여 준다.
import { useEffect, useMemo, useState } from 'react';
import type { GamePlanView, PlayerListItem, RosterView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { dateKo, fixed2, innings, POSITION_LABELS, rate3 } from '../format';
import { ratingText } from '../PlayerAbilities';

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const md = (d: string) => d.slice(5).replace('-', '/');

export function Roster({ nav }: { nav: Nav }) {
  const [v, setV] = useState<RosterView | null>(null);
  const [promote, setPromote] = useState<number[]>([]);
  const [demote, setDemote] = useState<number[]>([]);
  const [draft, setDraft] = useState<GamePlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  const apply = (view: RosterView) => {
    setV(view);
    setPromote([]);
    setDemote([]);
    setDraft(view.plan ?? view.recommended);
  };
  useEffect(() => {
    api('roster.view').then(apply).catch((e: Error) => setMsg({ text: e.message, kind: 'error' }));
  }, []);

  const run = async (fn: () => Promise<{ message: string; view: RosterView }>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      apply(r.view);
      setMsg({ text: r.message, kind: 'ok' });
      await nav.sync();
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : String(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const byId = useMemo(() => new Map((v?.players ?? []).map((p) => [p.id, p])), [v]);
  if (!v) return <div className="page">{msg?.text ?? '불러오는 중…'}</div>;
  const active = v.players.filter((p) => p.level === '1군');
  const minors = v.players.filter((p) => p.level !== '1군');
  const afterCount = active.length + promote.length - demote.length;
  const toggle = (list: number[], set: (x: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const activeHitters = active.filter((p) => !p.isPitcher);
  const activePitchers = active.filter((p) => p.isPitcher);
  const name = (id: number | null) => (id === null ? '감독 판단' : (byId.get(id)?.name ?? `#${id}`));

  const statText = (p: PlayerListItem) => {
    const ex = v.exhibition?.lines[String(p.id)];
    const season = !p.stats.G ? '시즌 기록 없음' : p.isPitcher ? `ERA ${fixed2(p.stats.ERA)} · ${innings(p.stats.IP)}이닝` : `OPS ${rate3(p.stats.OPS)} · HR ${p.stats.HR ?? 0}`;
    const exText = ex ? (p.isPitcher ? (ex.GP ? ` · 시범 ${ex.GP}경기 ${Math.floor(ex.OUTS / 3)}.${ex.OUTS % 3}이닝 자책 ${ex.ER}` : '') : ex.PA ? ` · 시범 ${ex.H}/${ex.AB} HR ${ex.HR}` : '') : '';
    return season + exText;
  };
  const ratingsText = (p: PlayerListItem) =>
    p.isPitcher ? `구위 ${ratingText(p, 'stuff')} 제구 ${ratingText(p, 'control')} 지구 ${ratingText(p, 'stamina')}` : `컨택 ${ratingText(p, 'contact')} 장타 ${ratingText(p, 'power')} 수비 ${ratingText(p, 'def_fielding')}`;

  const Table = ({ rows, side }: { rows: PlayerListItem[]; side: '1군' | '2군' }) => (
    <div className="table-wrap">
    <table className="grid dense">
      <thead>
        <tr>
          <th>{side === '1군' ? '말소' : '등록'}</th>
          <th>이름</th>
          <th>포지션</th>
          <th className="num">나이</th>
          <th>능력</th>
          <th>기록</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const until = v.reRegister[String(p.id)];
          const list = side === '1군' ? demote : promote;
          return (
            <tr key={p.id} className={list.includes(p.id) ? 'mine' : ''}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${p.name} ${side === '1군' ? '2군 말소' : '1군 등록'}`}
                  disabled={!v.editable || busy || (side === '2군' && !!until)}
                  checked={list.includes(p.id)}
                  onChange={() => (side === '1군' ? toggle(demote, setDemote, p.id) : toggle(promote, setPromote, p.id))}
                />
              </td>
              <td>
                <span className="clickable" onClick={() => nav.go({ name: 'player', playerId: p.id, list: rows.map((r) => r.id), back: { name: 'roster' } })}>
                  {p.name}
                </span>
                {until && <span className="badge req" title="1군 재등록 제한"> {md(until)}부터</span>}
              </td>
              <td>{POSITION_LABELS[p.position] ?? p.position}</td>
              <td className="num">{p.age}</td>
              <td className="small">{ratingsText(p)}</td>
              <td className="small">{statText(p)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );

  const setSpot = (i: number, patch: Partial<GamePlanView['lineup'][number]>) => draft && setDraft({ ...draft, lineup: draft.lineup.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setRot = (i: number, id: number) => draft && setDraft({ ...draft, rotation: draft.rotation.map((x, j) => (j === i ? id : x)) });

  return (
    <div className="page">
      <h1>
        선수단 운영 <span className="muted">개막 {dateKo(v.openingDate)}</span>
      </h1>
      {!v.editable && <p className="panel reason-box">{v.lockReason}</p>}
      {msg && (
        <p role="status" className={msg.kind === 'error' ? 'error-text' : 'gold'}>
          {msg.kind === 'error' ? '변경하지 않음: ' : ''}
          {msg.text}
        </p>
      )}

      <section className="panel">
        <h2>
          1·2군 명단{' '}
          <span className="muted small">
            1군 {v.counts.active}/{v.counts.activeMax}명 · 투수 {v.counts.activePitchers} · 야수 {v.counts.activeHitters} (포수 {v.counts.activeCatchers})
          </span>
        </h2>
        <div className="toolbar">
          <span>
            등록 {promote.length}명 · 말소 {demote.length}명 → 1군 <strong className={afterCount === v.counts.activeMax ? '' : 'error-text'}>{afterCount}명</strong>
          </span>
          <button className="primary" disabled={!v.editable || busy || promote.length + demote.length === 0} onClick={() => void run(() => api('roster.move', { promote, demote }))}>
            1군 교체 확정 (행동력 0)
          </button>
          <button disabled={busy || promote.length + demote.length === 0} onClick={() => { setPromote([]); setDemote([]); }}>
            선택 해제
          </button>
        </div>
        <div className="columns">
          <div>
            <h3>1군 {active.length}명</h3>
            <Table rows={[...activePitchers, ...activeHitters]} side="1군" />
          </div>
          <div>
            <h3>2군 {minors.length}명</h3>
            <Table rows={[...minors.filter((p) => p.isPitcher), ...minors.filter((p) => !p.isPitcher)]} side="2군" />
          </div>
        </div>
        <ul className="small muted">
          {v.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>
          경기 운영 <span className="muted small">현재: {v.mode === 'manual' ? '구단주 수동 계획' : '감독 자동 운영'}</span>
        </h2>
        {v.planProblems.length > 0 && <p className="error-text small">저장된 계획 문제: {v.planProblems.join(' ')}</p>}
        <div className="toolbar">
          <button disabled={!v.editable || busy || v.mode === 'auto'} onClick={() => void run(() => api('roster.setPlan', { mode: 'auto' }))}>
            감독 자동 운영으로
          </button>
          <button disabled={busy || !v.recommended} onClick={() => setDraft(v.recommended)}>
            감독 추천 불러오기
          </button>
          <button className="primary" disabled={!v.editable || busy || !draft} onClick={() => draft && void run(() => api('roster.setPlan', { mode: 'manual', plan: draft }))}>
            수동 계획 저장 (행동력 0)
          </button>
        </div>
        {draft && (
          <div className="columns">
            <div>
              <h3>타순·수비 위치</h3>
              <table className="grid dense">
                <tbody>
                  {draft.lineup.map((s, i) => (
                    <tr key={i}>
                      <td className="num">{i + 1}번</td>
                      <td>
                        <select aria-label={`${i + 1}번 타자`} value={s.playerId} onChange={(e) => setSpot(i, { playerId: Number(e.target.value) })}>
                          {!byId.get(s.playerId) && <option value={s.playerId}>{name(s.playerId)}</option>}
                          {activeHitters.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name} ({POSITION_LABELS[h.position] ?? h.position})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select aria-label={`${i + 1}번 수비 위치`} value={s.position} onChange={(e) => setSpot(i, { position: e.target.value })}>
                          {POSITIONS.map((pos) => (
                            <option key={pos} value={pos}>
                              {pos === 'DH' ? '지명타자' : (POSITION_LABELS[pos] ?? pos)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>선발 로테이션·마무리</h3>
              <table className="grid dense">
                <tbody>
                  {draft.rotation.map((id, i) => (
                    <tr key={i}>
                      <td>{i + 1}선발</td>
                      <td>
                        <select aria-label={`${i + 1}선발`} value={id} onChange={(e) => setRot(i, Number(e.target.value))}>
                          {!byId.get(id) && <option value={id}>{name(id)}</option>}
                          {activePitchers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({POSITION_LABELS[p.position] ?? p.position})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>마무리</td>
                    <td>
                      <select aria-label="마무리" value={draft.closer ?? ''} onChange={(e) => setDraft({ ...draft, closer: e.target.value === '' ? null : Number(e.target.value) })}>
                        <option value="">감독 판단</option>
                        {activePitchers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({POSITION_LABELS[p.position] ?? p.position})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small">로테이션 밖 1군 투수는 불펜으로 나갑니다. 낯선 수비 위치는 포지션 숙련도만큼 수비 능력이 떨어집니다.</p>
            </div>
          </div>
        )}
      </section>

      {v.exhibition && (
        <section className="panel">
          <h2>
            시범경기 {v.exhibition.record.w}승 {v.exhibition.record.l}패 {v.exhibition.record.t}무{' '}
            <span className="muted small">
              {md(v.exhibition.dates[0]!)}~{md(v.exhibition.dates[v.exhibition.dates.length - 1]!)} · 정규시즌 기록·순위에 넣지 않음
            </span>
          </h2>
          {v.exhibition.games.length === 0 ? (
            <p className="muted">아직 치른 시범경기가 없습니다.</p>
          ) : (
            <p className="small">
              {v.exhibition.games.map((g) => `${md(g.date)} ${g.home ? 'vs' : '@'} ${g.opponent} ${g.us}:${g.them}`).join(' · ')}
            </p>
          )}
        </section>
      )}

      {v.moves.length > 0 && (
        <section className="panel">
          <h2>이번 시즌 1·2군 이동</h2>
          <ul className="small">
            {v.moves.slice(0, 20).map((m, i) => (
              <li key={i}>
                {dateKo(m.date)} · {m.name} → {m.to}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
