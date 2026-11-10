// 명예의 전당: 10개 구단의 연표·구단 역사·구단 기록·레전드·구단주 업적 (24 문서, D-083)
import { useEffect, useState } from 'react';
import type { ClubOption, TeamRecordsView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { Emblem } from '../Emblem';

type Tab = 'timeline' | 'history' | 'records' | 'legends' | 'mine';

const SOURCE_LABEL: Record<string, string> = { real: '', start: ' (시작 이전)', game: '' };
const BAT_KEYS = ['G', 'H', 'HR', 'RBI', 'SB', 'AVG'];
const PIT_KEYS = ['G', 'W', 'L', 'SV', 'HLD', 'IP', 'SO', 'ERA'];

function MineBadge() {
  return <span className="badge star">구단주 달성</span>;
}

export function HallOfFame({ nav, initialClubId }: { nav: Nav; initialClubId?: number }) {
  const userClub = nav.dashboard!.userClub.id;
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubId, setClubId] = useState(initialClubId ?? userClub);
  const [tab, setTab] = useState<Tab>('timeline');
  const [v, setV] = useState<TeamRecordsView | null>(null);

  useEffect(() => {
    api('game.clubOptions')
      .then(setClubs)
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setV(null);
    api('game.hallOfFame', { clubId })
      .then(setV)
      .catch((e: Error) => nav.notify(e.message, 'error'));
    if (clubId !== userClub && tab === 'mine') setTab('timeline');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  const mineCount = v ? v.timeline.filter((t) => t.mine).length + v.history.filter((h) => h.mine).length + v.records.filter((r) => r.mine).length + v.achievements.filter((a) => a.achieved.length).length : 0;
  return (
    <div className="page">
      <h1>명예의 전당</h1>
      <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {clubs.map((c) => (
          <button key={c.id} className={clubId === c.id ? 'active' : ''} onClick={() => setClubId(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Emblem club={c} size={20} />
            {c.shortName}
            {c.id === userClub ? ' ★' : ''}
          </button>
        ))}
      </div>
      {!v ? (
        <div className="muted">불러오는 중…</div>
      ) : (
        <>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi">
              <Emblem club={v.club} size={34} />
              <span className="value" style={{ fontSize: 18 }}>
                {v.club.name}
              </span>
            </div>
            <div className="kpi">
              <span className="label">창단</span>
              <span className="value">{v.founded ?? '—'}</span>
            </div>
            <div className="kpi" title={v.titles.ks.join(', ')}>
              <span className="label">한국시리즈 우승</span>
              <span className="value">{v.titles.ks.length}회</span>
            </div>
            <div className="kpi" title={v.titles.regularFirst.join(', ')}>
              <span className="label">정규시즌 1위</span>
              <span className="value">{v.titles.regularFirst.length}회</span>
            </div>
          </div>
          <div className="toolbar">
            <div className="seg">
              {(
                [
                  ['timeline', '연표'],
                  ['history', '구단 역사'],
                  ['records', '구단 기록'],
                  ['legends', `레전드 (${v.legends.length})`],
                  ...(v.isUserClub ? ([['mine', `구단주 달성 (${mineCount})`]] as Array<[Tab, string]>) : []),
                ] as Array<[Tab, string]>
              ).map(([k, label]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="muted small">2025년까지 실제 KBO 기록(선수 이름은 가상) · 2027 시즌부터 구단주 재임 기록</span>
          </div>

          {tab === 'timeline' && (
            <section className="panel">
              <div className="panel-head">
                <h2>연표</h2>
                <span className="meta">창단 · 한국시리즈 · 정규시즌 1위</span>
              </div>
              <table className="grid dense">
                <tbody>
                  {v.timeline.map((t, i) => (
                    <tr key={`${t.year}-${t.label}-${i}`} className={t.mine ? 'mine' : ''}>
                      <td style={{ width: 90 }}>{t.year}</td>
                      <td>
                        {t.label === '한국시리즈 우승' ? '🏆 ' : ''}
                        {t.label} {t.mine && <MineBadge />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {tab === 'history' && (
            <section className="panel">
              <div className="panel-head">
                <h2>시즌별 구단 역사</h2>
                <span className="meta">2025까지 순위는 공식 최종 순위(한국시리즈 두 팀 1·2위) · 2026부터 정규시즌 순위</span>
              </div>
              <div style={{ maxHeight: 620, overflow: 'auto' }}>
                <table className="grid dense">
                  <thead>
                    <tr>
                      <th>시즌</th>
                      <th className="num">순위</th>
                      <th className="num">승</th>
                      <th className="num">패</th>
                      <th className="num">무</th>
                      <th>포스트시즌</th>
                      <th className="num">타율</th>
                      <th className="num">OPS</th>
                      <th className="num">홈런</th>
                      <th className="num">평균자책</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.history.map((h) => (
                      <tr key={h.season} className={h.mine ? 'mine' : ''}>
                        <td>
                          {h.season}
                          <span className="muted small">{SOURCE_LABEL[h.source]}</span> {h.mine && <span className="badge">재임 시즌</span>}
                        </td>
                        <td className="num">{h.rank ?? '—'}</td>
                        <td className="num">{h.wins}</td>
                        <td className="num">{h.losses}</td>
                        <td className="num">{h.ties}</td>
                        <td>{h.postseason}</td>
                        <td className="num">{h.AVG}</td>
                        <td className="num">{h.OPS}</td>
                        <td className="num">{h.HR ?? '—'}</td>
                        <td className="num">{h.ERA}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'records' && (
            <section className="panel">
              <div className="panel-head">
                <h2>구단 단일 시즌 기록</h2>
                <span className="meta">실제 KBO 기록과 게임 안 기록 중 더 좋은 쪽</span>
              </div>
              <table className="grid dense">
                <tbody>
                  {v.records.map((r) => (
                    <tr key={r.label} className={r.mine ? 'mine' : ''}>
                      <td>{r.label}</td>
                      <td>
                        <strong>{r.holder}</strong>
                      </td>
                      <td className="num">{r.value}</td>
                      <td>
                        {r.season}
                        <span className="muted small">{r.source === 'real' ? ' (KBO 기록)' : SOURCE_LABEL[r.source]}</span> {r.mine && <MineBadge />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {tab === 'legends' &&
            (['bat', 'pit'] as const).map((kind) => {
              const list = v.legends.filter((l) => (kind === 'pit' ? l.isPitcher : !l.isPitcher));
              if (list.length === 0) return null;
              const keys = kind === 'pit' ? PIT_KEYS : BAT_KEYS;
              return (
                <section className="panel" key={kind}>
                  <div className="panel-head">
                    <h2>{kind === 'pit' ? '레전드 투수' : '레전드 타자'}</h2>
                    <span className="meta">실제 KBO 통산 기록 · 이름은 가상</span>
                  </div>
                  <table className="grid dense">
                    <thead>
                      <tr>
                        <th>선수</th>
                        <th>포지션</th>
                        <th>재적</th>
                        {keys.map((k) => (
                          <th key={k} className="num">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((l) => (
                        <tr key={l.name}>
                          <td>
                            <strong>{l.name}</strong> {l.retiredNumber !== null && <span className="badge star">영구결번 {l.retiredNumber}</span>}
                          </td>
                          <td>{l.position}</td>
                          <td>{l.years}</td>
                          {keys.map((k) => (
                            <td key={k} className="num">
                              {l.career[k] ?? '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}

          {tab === 'mine' && v.isUserClub && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>구단주 재임 중 이룬 것</h2>
                  <span className="meta">2027 시즌부터</span>
                </div>
                <table className="grid dense">
                  <tbody>
                    {v.timeline
                      .filter((t) => t.mine)
                      .map((t, i) => (
                        <tr key={`t${i}`}>
                          <td style={{ width: 90 }}>{t.year}</td>
                          <td>{t.label}</td>
                        </tr>
                      ))}
                    {v.history
                      .filter((h) => h.mine)
                      .map((h) => (
                        <tr key={`h${h.season}`}>
                          <td>{h.season}</td>
                          <td>
                            재임 시즌 {h.rank}위 · {h.wins}승 {h.losses}패 {h.ties}무 {h.postseason && `· ${h.postseason}`}
                          </td>
                        </tr>
                      ))}
                    {v.records
                      .filter((r) => r.mine)
                      .map((r) => (
                        <tr key={`r${r.label}`}>
                          <td>{r.season}</td>
                          <td>
                            구단 기록 경신: {r.label} {r.holder} {r.value}
                          </td>
                        </tr>
                      ))}
                    {v.achievements
                      .filter((a) => a.achieved.length)
                      .flatMap((a) => a.achieved.map((x, i) => ({ a, x, i })))
                      .map(({ a, x, i }) => (
                        <tr key={`a${a.key}${i}`}>
                          <td>{x.date.slice(0, 4)}</td>
                          <td>
                            업적 · {a.title} — {x.detail}
                          </td>
                        </tr>
                      ))}
                    {mineCount === 0 && (
                      <tr>
                        <td className="muted">아직 없습니다. 2027 시즌부터 구단주로서 이룬 성과가 여기에 쌓입니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
