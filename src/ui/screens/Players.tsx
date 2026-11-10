import { ratingText } from '../PlayerAbilities';
import { playerFocus, playersMemory } from '../playerFocus';
import { useEffect, useMemo, useState } from 'react';
import type { PlayerListItem, PlayerQuery } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { fixed2, innings, int, POSITION_LABELS, rate3, won } from '../format';

interface Column {
  key: string;
  label: string;
  render: (p: PlayerListItem) => string;
  title?: string;
}

const HITTER_COLUMNS: Column[] = [
  { key: 'contact', label: '컨택', render: (p) => ratingText(p, 'contact') },
  { key: 'eye', label: '선구', render: (p) => ratingText(p, 'eye') },
  { key: 'power', label: '장타', render: (p) => ratingText(p, 'power') },
  { key: 'speed', label: '주력', render: (p) => ratingText(p, 'speed') },
  { key: 'def_fielding', label: '수비', render: (p) => ratingText(p, 'def_fielding') },
  { key: 'G', label: 'G', render: (p) => int(p.stats.G) },
  { key: 'PA', label: 'PA', render: (p) => int(p.stats.PA) },
  { key: 'AVG', label: 'AVG', render: (p) => rate3(p.stats.AVG), title: '타율 = H / AB' },
  { key: 'HR', label: 'HR', render: (p) => int(p.stats.HR) },
  { key: 'RBI', label: 'RBI', render: (p) => int(p.stats.RBI) },
  { key: 'OPS', label: 'OPS', render: (p) => rate3(p.stats.OPS), title: '출루율 + 장타율' },
];

const PITCHER_COLUMNS: Column[] = [
  { key: 'stuff', label: '구위', render: (p) => ratingText(p, 'stuff') },
  { key: 'control', label: '제구', render: (p) => ratingText(p, 'control') },
  { key: 'groundball', label: '땅볼', render: (p) => ratingText(p, 'groundball') },
  { key: 'stamina', label: '지구력', render: (p) => ratingText(p, 'stamina') },
  { key: 'G', label: 'G', render: (p) => int(p.stats.G) },
  { key: 'IP', label: 'IP', render: (p) => innings(p.stats.IP) },
  { key: 'W', label: 'W', render: (p) => int(p.stats.W) },
  { key: 'L', label: 'L', render: (p) => int(p.stats.L) },
  { key: 'SV', label: 'SV', render: (p) => int(p.stats.SV) },
  { key: 'K', label: 'K', render: (p) => int(p.stats.K) },
  { key: 'ERA', label: 'ERA', render: (p) => fixed2(p.stats.ERA), title: '평균자책점 = 27 × ER / 아웃' },
];

export function Players({ nav }: { nav: Nav }) {
  const [query, setQuery] = useState<PlayerQuery>(playersMemory.query);
  const [rows, setRows] = useState<PlayerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [watchedOnly, setWatchedOnly] = useState(playersMemory.watchedOnly);
  useEffect(() => {
    playersMemory.query = query;
    playersMemory.watchedOnly = watchedOnly;
  }, [query, watchedOnly]);
  const clubs = useMemo(() => nav.dashboard?.standings.map((s) => s.club).sort((a, b) => a.id - b.id) ?? [], [nav.dashboard]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t0 = performance.now();
    api('game.players', query)
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setElapsed(performance.now() - t0);
      })
      .catch((e: Error) => nav.notify(e.message, 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, nav]);

  const columns = query.group === 'pitchers' ? PITCHER_COLUMNS : HITTER_COLUMNS;
  useEffect(() => {
    if (loading || rows.length === 0 || playerFocus.id === null) return;
    const row = document.getElementById(`player-row-${playerFocus.id}`);
    if (row) { row.focus(); playerFocus.id = null; }
  }, [rows, loading]);
  // 상세의 이전·다음은 지금 보이는 목록 순서를 따른다(검색·정렬·관심 필터 반영).
  const visible = rows.filter((p) => !watchedOnly || p.watched);
  const open = (id: number) => nav.go({ name: 'player', playerId: id, list: visible.map((p) => p.id), back: { name: 'players' } });
  const sortBy = (key: string) => setQuery((q) => ({ ...q, sortKey: key, sortDesc: q.sortKey === key ? !q.sortDesc : key !== 'name' && key !== 'ERA' && key !== 'age' }));
  const arrow = (key: string) => (query.sortKey === key ? (query.sortDesc ? ' ▼' : ' ▲') : '');

  return (
    <div className="page">
      <h1>선수단</h1>
      <div className="toolbar">
        <select value={String(query.scope)} onChange={(e) => setQuery((q) => ({ ...q, scope: e.target.value === 'mine' || e.target.value === 'all' ? e.target.value : Number(e.target.value) }))}>
          <option value="mine">우리 구단</option>
          <option value="all">리그 전체</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="seg">
          <button className={query.group === 'hitters' ? 'active' : ''} onClick={() => setQuery((q) => ({ ...q, group: 'hitters', sortKey: 'OPS', sortDesc: true }))}>타자</button>
          <button className={query.group === 'pitchers' ? 'active' : ''} onClick={() => setQuery((q) => ({ ...q, group: 'pitchers', sortKey: 'ERA', sortDesc: false }))}>투수</button>
        </div>
        <div className="seg">
          {(['all', '1군', '2군'] as const).map((lv) => (
            <button key={lv} className={query.level === lv ? 'active' : ''} onClick={() => setQuery((q) => ({ ...q, level: lv }))}>
              {lv === 'all' ? '전체' : lv}
            </button>
          ))}
        </div>
        <input placeholder="이름 검색" value={query.search ?? ''} onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))} />
        <label><input type="checkbox" checked={watchedOnly} onChange={e => setWatchedOnly(e.target.checked)} /> 관심 선수만</label>
        <span className="muted small">
          {rows.length}명 · {loading ? '불러오는 중' : `${elapsed.toFixed(0)}ms`} · 능력(1~100): 우리 선수는 실제 능력치, 타 구단 선수는 스카우트 추정 범위
        </span>
      </div>
      <div className="table-wrap">
        <table className="grid dense">
          <thead>
            <tr>
              <th className="sticky clickable" onClick={() => sortBy('name')}>이름{arrow('name')}</th>
              <th>구단</th>
              <th>포지션</th>
              <th>1·2군</th>
              <th className="num clickable" onClick={() => sortBy('age')}>나이{arrow('age')}</th>
              <th className="num clickable" onClick={() => sortBy('salary')}>연봉{arrow('salary')}</th>
              <th className="num" title="현재 시즌 이후 남은 계약 연수">계약</th>
              {columns.map((c) => (
                <th key={c.key} className="num clickable" title={c.title} onClick={() => sortBy(c.key)}>
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} id={`player-row-${p.id}`} tabIndex={0} className="clickable" onClick={() => open(p.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p.id); } }}>
                <td className="sticky">
                  {p.watched ? "★ " : ""}{p.name} {p.healthStatus && <span className="badge req">{p.healthStatus}</span>} {p.franchise && <span className="badge star">간판</span>} {p.faEligible && <span className="badge fa">FA</span>}
                </td>
                <td>{p.club?.shortName ?? 'FA'}</td>
                <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                <td>{p.level}</td>
                <td className="num">{p.age}</td>
                <td className="num">{won(p.salaryWon)}</td>
                <td className="num">{p.contractYears === 0 ? '만료' : `${p.contractYears}년`}</td>
                {columns.map((c) => (
                  <td key={c.key} className="num">{c.render(p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
