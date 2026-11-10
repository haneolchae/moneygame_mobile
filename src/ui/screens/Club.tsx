// 구단 화면(3e, 18b 2·3장, D-121·D-122): 공개 프로필·순위·팀 기록·최근 경기·선수단, 타 구단은 전력 비교(우리 실제 vs 상대 추정),
// 우리 구단은 기존 운영 화면으로 가는 허브. 구단 메모·라이벌 표시는 세이브에 저장한다. 모든 조회는 행동력 0.
import { useEffect, useRef, useState } from 'react';
import type { ClubView, PlayerListItem } from '../../shared/protocol';
import type { Nav, Route } from '../App';
import { api } from '../api';
import { Emblem } from '../Emblem';
import { dateKo, fixed2, innings, int, POSITION_LABELS, rate3, won } from '../format';
import { ratingText } from '../PlayerAbilities';
import { leaveGuard } from '../playerFocus';

const range = (r: { low: number; high: number }) => (r.low === r.high ? String(r.low) : `${r.low}–${r.high}`);

export function Club({ nav, clubId }: { nav: Nav; clubId: number }) {
  const [v, setV] = useState<ClubView | null>(null);
  const [text, setText] = useState('');
  const [rival, setRival] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setV(null);
    api('club.view', { clubId })
      .then((x) => {
        setV(x);
        setText(x.note.text);
        setRival(x.note.rival);
      })
      .catch((e: Error) => setError(e.message));
  }, [clubId]);

  // 메뉴 이동·날짜 진행 전에 미저장 구단 메모를 저장한다(선수 메모와 같은 규칙).
  const latest = useRef({ text, saved: '', rival, clubId });
  latest.current.text = text;
  latest.current.rival = rival;
  useEffect(() => {
    const run = async () => {
      const cur = latest.current;
      if (cur.text === cur.saved) return true;
      try {
        await api('club.note', { clubId: cur.clubId, text: cur.text, rival: cur.rival });
        cur.saved = cur.text;
        return true;
      } catch {
        return false;
      }
    };
    leaveGuard.run = run;
    return () => { if (leaveGuard.run === run) leaveGuard.run = null; };
  }, []);
  useEffect(() => { if (v) latest.current.saved = v.note.text; }, [v]);

  const saveNote = async (nextRival = rival) => {
    if (!v || saving) return;
    setSaving(true);
    setError('');
    try {
      const note = await api('club.note', { clubId, text, rival: nextRival });
      setV({ ...v, note });
      setRival(note.rival);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!v) return <div className="page">{error || '불러오는 중…'}</div>;
  const back: Route = { name: 'club', clubId };
  const openPlayer = (p: PlayerListItem, list: PlayerListItem[]) => nav.go({ name: 'player', playerId: p.id, list: list.map((x) => x.id), back });
  const active = v.roster.filter((p) => p.level === '1군');
  const minors = v.roster.filter((p) => p.level !== '1군');
  const s = v.standing;
  const dirty = text !== v.note.text;

  const RosterTable = ({ rows }: { rows: PlayerListItem[] }) => (
    <div className="table-wrap">
      <table className="grid dense">
        <thead>
          <tr>
            <th>이름</th>
            <th>포지션</th>
            <th className="num">나이</th>
            <th className="num">연봉</th>
            <th>{v.mine ? '능력(실제)' : '능력(우리 추정)'}</th>
            <th>시즌 기록</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => openPlayer(p, rows)}>
              <td>{p.name}</td>
              <td>{POSITION_LABELS[p.position] ?? p.position}</td>
              <td className="num">{p.age}</td>
              <td className="num">{won(p.salaryWon)}</td>
              <td className="small">
                {p.isPitcher
                  ? `구위 ${ratingText(p, 'stuff')} 제구 ${ratingText(p, 'control')}`
                  : `컨택 ${ratingText(p, 'contact')} 장타 ${ratingText(p, 'power')} 수비 ${ratingText(p, 'def_fielding')}`}
              </td>
              <td className="small">
                {!p.stats.G ? '기록 없음' : p.isPitcher ? `${int(p.stats.G)}경기 ${innings(p.stats.IP)}이닝 ERA ${fixed2(p.stats.ERA)}` : `${int(p.stats.G)}경기 AVG ${rate3(p.stats.AVG)} HR ${int(p.stats.HR)} OPS ${rate3(p.stats.OPS)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      <div className="toolbar">
        <Emblem club={v.club} size={48} />
        <h1 style={{ margin: 0 }}>
          {v.club.name} {v.mine && <span className="badge star">우리 구단</span>} {v.note.rival && <span className="badge req">라이벌</span>}
        </h1>
      </div>
      <div className="cards">
        <div className="card">
          <div className="label">연고·구장</div>
          <div className="value">{v.profile.city}</div>
          {v.profile.stadium} ({v.profile.stadiumCapacity.toLocaleString('ko-KR')}석)
        </div>
        <div className="card">
          <div className="label">{v.season} 순위</div>
          <div className="value">{s ? `${s.rank}위` : '—'}</div>
          {s ? `${s.wins}승 ${s.losses}패${s.ties ? ` ${s.ties}무` : ''}` : ''}
        </div>
        <div className="card">
          <div className="label">모기업·팬</div>
          <div className="value">{v.profile.parentIndustry}</div>팬 충성도 {v.profile.loyalty}
        </div>
        <div className="card">
          <div className="label">선수단 연봉 합계(공개)</div>
          <div className="value">{won(v.payrollWon)}</div>
          {v.roster.length}명
        </div>
      </div>

      {v.mine && (
        <section className="panel">
          <h2>운영 바로가기</h2>
          <div className="toolbar">
            {([['roster', '선수단 운영'], ['players', '선수단'], ['market', '계약·이적'], ['org', '조직·위임'], ['finance', '재정'], ['team', '팀 기록']] as const).map(([name, label]) => (
              <button key={name} onClick={() => nav.go({ name })}>
                {label}
              </button>
            ))}
            <button onClick={() => nav.go({ name: 'hof', clubId })}>명예의 전당</button>
          </div>
        </section>
      )}

      {!v.mine && (
        <section className="panel">
          <h2>트레이드</h2>
          <div className="toolbar">
            <button className="primary" onClick={() => nav.go({ name: 'trade', clubId })}>
              트레이드 협상
            </button>
            <span className="muted small">교환안 작성·미리보기는 무료 · 이 구단과 그 주 첫 제안 때 행동력 1, 같은 주 제안 3회까지</span>
          </div>
        </section>
      )}

      {v.comparison && (
        <section className="panel">
          <h2>
            전력 비교 <span className="muted small">우리 = 실제 능력 · 상대 = 우리 스카우트 추정 범위(저장된 보고서), 1군 기준, 행동력 0</span>
          </h2>
          <table className="grid dense">
            <thead>
              <tr>
                <th>묶음</th>
                <th className="num">우리</th>
                <th className="num">{v.club.shortName}</th>
                <th>판단</th>
                <th className="num">관측 신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {v.comparison.map((g) => {
                const verdict = g.n === 0 ? '비교 불가' : g.theirs.high < g.ours.low ? '우리 우세' : g.theirs.low > g.ours.high ? '상대 우세' : '추정 범위가 겹침';
                return (
                  <tr key={g.key}>
                    <td>
                      {g.label} <span className="muted small">({g.n}명)</span>
                    </td>
                    <td className="num">{range(g.ours)}</td>
                    <td className="num">{range(g.theirs)}</td>
                    <td>{verdict}</td>
                    <td className="num">{g.theirConfidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">추정 범위는 조사할수록 좁아집니다(선수 상세 [능력치]의 스카우트 조사). 범위가 겹치면 우열을 단정하지 않습니다.</p>
        </section>
      )}

      <div className="columns">
        <section className="panel">
          <h2>{v.season} 팀 기록 <span className="muted small">(10개 구단 중 순위)</span></h2>
          {v.team.length === 0 ? (
            <p className="muted">이번 시즌 경기 기록이 없습니다.</p>
          ) : (
            <table className="grid dense">
              <tbody>
                {v.team.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num">{r.value}</td>
                    <td className="num">{r.rank}위</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!v.mine && (
            <button className="small" onClick={() => nav.go({ name: 'hof', clubId })}>
              구단 역사·명예의 전당
            </button>
          )}
        </section>
        <section className="panel">
          <h2>최근 경기</h2>
          {v.recent.length === 0 ? (
            <p className="muted">치른 경기가 없습니다.</p>
          ) : (
            <ul className="small">
              {v.recent.map((g, i) => (
                <li key={i}>
                  {dateKo(g.date)} {g.home ? 'vs' : '@'} {g.opponent} {g.us}:{g.them} {g.us > g.them ? '승' : g.us < g.them ? '패' : '무'}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>
          구단 메모 <span className="muted small">세이브별 저장 · 영입·조사 업무를 만들지 않음</span>
        </h2>
        <label>
          <input
            type="checkbox"
            checked={rival}
            disabled={saving}
            onChange={(e) => {
              setRival(e.target.checked);
              void saveNote(e.target.checked);
            }}
          />{' '}
          라이벌로 표시
        </label>
        <textarea aria-label="구단 메모" maxLength={2000} value={text} disabled={saving} onChange={(e) => setText(e.target.value)} rows={4} style={{ width: '100%', resize: 'vertical' }} />
        <div className="toolbar">
          <span className="small">
            {text.length}/2,000자 · {saving ? '저장 중' : dirty ? '미저장' : '저장됨'}
          </span>
          <button disabled={saving || !dirty} onClick={() => void saveNote()}>
            메모 저장
          </button>
        </div>
        {error && <p role="alert">저장 실패: {error}</p>}
      </section>

      <section className="panel">
        <h2>1군 {active.length}명</h2>
        <RosterTable rows={active} />
      </section>
      <section className="panel">
        <h2>2군 {minors.length}명</h2>
        <RosterTable rows={minors} />
      </section>
    </div>
  );
}
