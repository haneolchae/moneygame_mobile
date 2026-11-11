// 4c-3 경기 관전·승부처 참여(D-160·D-174). 화면은 서버의 미리보기를 보여 주고 결정을 보낼 뿐, 경기 규칙은 없다.
// 문자 중계 속도·일시정지는 화면에서만 조절한다(결과에 영향 없음).
import { useEffect, useRef, useState } from 'react';
import type { LiveChoice, LiveDecisionView, LiveGameView, PlayerListItem } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { Emblem } from '../Emblem';
import { dateKo, RATING_LABELS } from '../format';

type Speed = 'instant' | 'fast' | 'normal';
const SPEED_MS: Record<Speed, number> = { instant: 0, fast: 180, normal: 700 };
const SPEED_LABEL: Record<Speed, string> = { instant: '즉시', fast: '빠름', normal: '보통' };

export function Live({ nav, onAdvanceDay }: { nav: Nav; onAdvanceDay: (fixtureId: number) => Promise<void> }) {
  const [view, setView] = useState<LiveGameView | null>(null);
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState<Speed>('fast');
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);
  const feedEnd = useRef<HTMLDivElement | null>(null);

  const fail = (e: unknown) => nav.notify(e instanceof ApiError ? e.message : String(e), 'error');

  useEffect(() => {
    // 관전 시작은 상단 '경기 보기' 버튼이 한다. 여기서는 지금 상태만 읽는다(하루 진행 뒤 다시 그려질 때 다음 날 경기를 시작하지 않도록)
    api('live.view').then(setView).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feed = view?.game?.feed ?? [];
  // 문자 중계 재생
  useEffect(() => {
    if (shown >= feed.length || paused) return;
    if (speed === 'instant') {
      setShown(feed.length);
      return;
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), SPEED_MS[speed]);
    return () => window.clearTimeout(t);
  }, [shown, feed.length, paused, speed]);
  useEffect(() => {
    // scrollIntoView가 Promise를 돌려주는 환경이 있어 정리 함수로 넘기지 않는다
    void feedEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [shown]);

  if (!view) return <div className="page muted">불러오는 중…</div>;
  const g = view.game;
  if (!view.active || !g) {
    return (
      <div className="page">
        <h1>경기 보기</h1>
        <p className="muted">{view.available ? '상단의 \'경기 보기\'로 오늘 우리 경기를 관전할 수 있습니다.' : '오늘은 관전할 우리 경기가 없습니다.'}</p>
        <button onClick={() => nav.go({ name: 'dashboard' })}>구단 현황으로</button>
      </div>
    );
  }

  const caughtUp = shown >= feed.length;
  const last = feed[Math.min(shown, feed.length) - 1];
  // 재생 중에는 마지막으로 보인 점수 항목을 쓴다(교체·투수 항목은 점수가 비어 있다)
  const lastScored = [...feed.slice(0, shown)].reverse().find((f) => f.score);
  const scoreShown = caughtUp ? `${g.score.away} : ${g.score.home}` : (lastScored?.score.replace(':', ' : ') ?? '0 : 0');
  const inningShown = caughtUp ? `${g.inning}회${g.half === 'T' ? '초' : '말'}` : last ? `${last.inning}회${last.half === 'T' ? '초' : '말'}` : '경기 전';
  const innings = Math.max(9, g.lineScore.away.length, g.lineScore.home.length);

  const send = async (choice: LiveChoice) => {
    setSending(true);
    try {
      const v = await api('live.decide', { choice });
      setView(v);
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };
  const toggleParticipate = async () => {
    try {
      setView(await api('live.settings', { participate: !view.participate }));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="page live">
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>경기 보기</h1>
        <span className="muted">{dateKo(g.date)}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted small">중계 속도</span>
        <div className="seg">
          {(Object.keys(SPEED_LABEL) as Speed[]).map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
              {SPEED_LABEL[s]}
            </button>
          ))}
        </div>
        <button disabled={caughtUp} onClick={() => setPaused((p) => !p)}>{paused ? '계속' : '일시정지'}</button>
        <label className="small" title="끄면 승부처에서 멈추지 않고 감독이 모두 결정합니다">
          <input type="checkbox" checked={view.participate} onChange={toggleParticipate} /> 승부처 참여
        </label>
      </div>

      <section className="panel live-board">
        <div className="panel-body">
          <div className="live-score">
            <div className="team">
              <Emblem club={g.away} size={40} />
              <span>{g.away.name}</span>
            </div>
            <div className="center">
              <strong className="runs">{scoreShown}</strong>
              <span className="muted">{g.over && caughtUp ? `경기 종료 · ${g.result}` : inningShown}</span>
            </div>
            <div className="team right">
              <span>{g.home.name}</span>
              <Emblem club={g.home} size={40} />
            </div>
          </div>
          {caughtUp && (
            <table className="grid dense linescore">
              <thead>
                <tr><th />{Array.from({ length: innings }, (_, i) => <th key={i} className="num">{i + 1}</th>)}<th className="num">R</th></tr>
              </thead>
              <tbody>
                {(['away', 'home'] as const).map((s) => (
                  <tr key={s} className={g.userSide === s ? 'mine' : ''}>
                    <td>{g[s].name}</td>
                    {Array.from({ length: innings }, (_, i) => <td key={i} className="num">{g.lineScore[s][i] ?? ''}</td>)}
                    <td className="num"><strong>{g.score[s]}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {caughtUp && !g.over && (
            <div className="row small">
              <Bases bases={g.bases} />
              <span>{g.outs}아웃</span>
              <span className="muted">승부처 참여 {g.participation.used}/{g.participation.max}{g.participation.enabled ? '' : ' (참여 꺼짐)'}</span>
            </div>
          )}
        </div>
      </section>

      <div className="columns">
        <section className="panel">
          <div className="panel-head"><h2>문자 중계</h2><span className="meta">{shown}/{feed.length}</span></div>
          <div className="panel-body live-feed">
            <ol className="plays">
              {feed.slice(0, shown).map((f, i) => (
                <li key={i} className={f.scoring ? 'scoring' : f.kind !== 'pa' ? 'muted' : ''}>
                  <span className="muted">{f.inning}회{f.half === 'T' ? '초' : '말'}</span> {f.text}
                  {f.score && f.kind === 'pa' && f.scoring && <span className="badge rec" style={{ marginLeft: 6 }}>{f.score}</span>}
                  {f.pitches && <div className="muted small">투구: {f.pitches}</div>}
                </li>
              ))}
            </ol>
            <div ref={feedEnd} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{g.decision && caughtUp ? g.decision.title : g.over ? '경기 종료' : '진행'}</h2></div>
          <div className="panel-body">
            {!caughtUp && <p className="muted">중계를 따라가는 중입니다.</p>}
            {caughtUp && g.decision && <DecisionPanel key={`${g.decision.kind}-${g.decision.key}-${g.decision.balls ?? ''}-${g.decision.strikes ?? ''}`} d={g.decision} sending={sending} onSend={send} />}
            {caughtUp && !g.decision && g.over && (
              <>
                <p>{g.away.name} {g.score.away} : {g.score.home} {g.home.name} · <strong>{g.result}</strong></p>
                <p className="muted small">경기를 확정하면 같은 지시로 오늘 하루가 처리됩니다(다른 경기·사업·장부 포함).</p>
              </>
            )}
            <div className="row">
              {g.over && caughtUp ? (
                <button className="primary" onClick={() => void onAdvanceDay(g.fixtureId)}>경기 확정</button>
              ) : (
                <button onClick={() => void onAdvanceDay(g.fixtureId)} title="남은 결정은 감독 추천대로 하고 오늘 하루를 처리합니다">감독에게 맡기고 하루 진행</button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Bases({ bases }: { bases: boolean[] }) {
  const on = (b: boolean) => (b ? 'var(--do-mint)' : 'transparent');
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" aria-label="주자">
      <rect x="18" y="2" width="9" height="9" transform="rotate(45 22.5 6.5)" fill={on(bases[1]!)} stroke="#a7bdd2" />
      <rect x="31" y="14" width="9" height="9" transform="rotate(45 35.5 18.5)" fill={on(bases[0]!)} stroke="#a7bdd2" />
      <rect x="5" y="14" width="9" height="9" transform="rotate(45 9.5 18.5)" fill={on(bases[2]!)} stroke="#a7bdd2" />
    </svg>
  );
}

function PlayerLine({ label, p }: { label: string; p: PlayerListItem }) {
  const keys = p.isPitcher ? ['stuff', 'control', 'breaking', 'stamina'] : ['contact', 'power', 'eye', 'speed'];
  const own = Object.keys(p.ratings).length > 0;
  return (
    <div className="small" style={{ marginBottom: 6 }}>
      <span className="muted">{label}</span> <strong>{p.name}</strong> <span className="muted">{p.club?.name ?? ''}</span>
      <div>
        {keys.map((k) => {
          const r = p.ratingRanges[k];
          const v = own ? p.ratings[k] : undefined;
          const text = v !== undefined ? String(Math.round(v)) : r ? `${Math.round(r.low)}~${Math.round(r.high)}` : '—';
          return <span key={k} style={{ marginRight: 10 }}>{RATING_LABELS[k] ?? k} {text}</span>;
        })}
        {!own && <span className="muted">(스카우트 추정)</span>}
      </div>
    </div>
  );
}

function DecisionPanel({ d, sending, onSend }: { d: LiveDecisionView; sending: boolean; onSend: (c: LiveChoice) => Promise<void> }) {
  const rec = d.recommendation;
  const [tactic, setTactic] = useState(rec.kind === 'count' ? rec.tactic : 'none');
  const r = rec.kind === 'prePa' ? rec : null;
  const [pitcher, setPitcher] = useState(r?.pitcherId ? String(r.pitcherId) : 'keep');
  const [ibb, setIbb] = useState(r?.ibb ?? false);
  const [infield, setInfield] = useState(r?.align?.infield ?? 'normal');
  const [outfield, setOutfield] = useState(r?.align?.outfield ?? 'normal');
  const [lines, setLines] = useState(r?.align?.lines ?? false);
  const [ph, setPh] = useState(r?.pinchHitter ? String(r.pinchHitter) : 'keep');
  const [runners, setRunners] = useState<Record<number, string>>(Object.fromEntries((r?.pinchRunners ?? []).map((x) => [x.base, String(x.playerId)])));
  const [play, setPlay] = useState(r?.play ?? 'none');

  const custom = (): LiveChoice => {
    if (d.kind === 'count') return { kind: 'count', paSeq: d.paSeq!, balls: d.balls!, strikes: d.strikes!, tactic };
    if (d.role === 'def') return { kind: 'prePa', key: d.key, pitcherId: pitcher === 'keep' ? null : Number(pitcher), ibb, align: { infield, outfield, lines } };
    return {
      kind: 'prePa',
      key: d.key,
      pinchHitter: ph === 'keep' ? null : Number(ph),
      pinchRunners: Object.entries(runners).filter(([, v]) => v && v !== 'keep').map(([b, v]) => ({ base: Number(b), playerId: Number(v) })),
      play,
    };
  };
  const baseName = ['1루', '2루', '3루'];

  return (
    <div className="live-decision">
      <PlayerLine label="타자" p={d.batter} />
      <PlayerLine label="투수" p={d.pitcher} />
      <p className="small">
        우리 승리 확률 <strong>{d.winProb}%</strong> · 레버리지 <strong>{d.leverage}</strong>
        {d.kind === 'count' && <> · {d.balls}볼 {d.strikes}스트라이크{d.pitchLog ? <span className="muted"> ({d.pitchLog})</span> : null}</>}
      </p>
      <p className="muted small">{d.managerNote}</p>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="small muted">감독 추천</div>
        <strong>{d.recommended}</strong>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={sending} onClick={() => void onSend(rec)}>추천대로</button>
        </div>
      </div>

      <div className="small muted" style={{ marginBottom: 6 }}>직접 지시(행동력 0, 되돌릴 수 없음)</div>
      {d.kind === 'count' && (
        <div className="seg">
          {d.tactics!.map((t) => (
            <button key={t.key} className={tactic === t.key ? 'active' : ''} disabled={!!t.disabled} title={t.disabled ?? ''} onClick={() => setTactic(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {d.kind === 'prePa' && d.role === 'def' && (
        <div className="live-form">
          <label>투수 <select value={pitcher} onChange={(e) => setPitcher(e.target.value)}>{d.pitchers!.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label><input type="checkbox" checked={ibb} onChange={(e) => setIbb(e.target.checked)} /> 고의사구</label>
          <label>내야 <select value={infield} onChange={(e) => setInfield(e.target.value as typeof infield)}><option value="normal">기본</option><option value="in">전진</option><option value="dp">병살 대비</option></select></label>
          <label>외야 <select value={outfield} onChange={(e) => setOutfield(e.target.value as typeof outfield)}><option value="normal">기본</option><option value="in">전진</option><option value="back">후진</option></select></label>
          <label><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> 선상 수비</label>
        </div>
      )}
      {d.kind === 'prePa' && d.role === 'off' && (
        <div className="live-form">
          {d.opponentIbb && <p className="small warn">상대가 고의사구를 냅니다. 작전은 걸 수 없습니다.</p>}
          <label>타자 <select value={ph} onChange={(e) => setPh(e.target.value)}>{d.pinchHitters!.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          {d.pinchRunners!.map((pr) => (
            <label key={pr.base}>
              {baseName[pr.base]} 주자({pr.runner}){' '}
              <select value={runners[pr.base] ?? 'keep'} onChange={(e) => setRunners((x) => ({ ...x, [pr.base]: e.target.value }))}>
                <option value="keep">그대로</option>
                {pr.options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          ))}
          <label>작전 <select value={play} onChange={(e) => setPlay(e.target.value)}>{d.plays!.map((o) => <option key={o.key} value={o.key} disabled={!!o.disabled}>{o.label}{o.disabled ? ` — ${o.disabled}` : ''}</option>)}</select></label>
        </div>
      )}
      <div className="row">
        <button disabled={sending} onClick={() => void onSend(custom())}>지시 확정</button>
      </div>
    </div>
  );
}
