// 팀 기록: 현재 팀 통계(리그 순위)와 업적 (24 문서). 구단 역사·기록·레전드는 명예의 전당(HallOfFame)
import { useEffect, useState } from 'react';
import { CareerPanel } from '../Career';
import type { AchievementView, TeamRecordsView, TeamStatItem } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { Icon } from '../icons';
import { FieldingTable } from './PlayerDetail';

type Tab = 'stats' | 'fielding' | 'achievements';

function StatGrid({ title, items }: { title: string; items: TeamStatItem[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="meta">괄호는 10개 구단 중 순위</span>
      </div>
      <table className="grid dense">
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <td>{i.label}</td>
              <td className="num">
                <strong>{i.value}</strong>
              </td>
              <td className="num" style={{ color: i.rank === 1 ? 'var(--green-2)' : i.rank !== null && i.rank >= 9 ? 'var(--error)' : undefined }}>
                {i.rank === null ? '' : `${i.rank}위`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TeamRecords({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState<Tab>('stats');
  const [v, setV] = useState<TeamRecordsView | null>(null);
  useEffect(() => {
    api('game.team')
      .then(setV)
      .catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);
  if (!v) return <div className="page muted">불러오는 중…</div>;
  const achieved = v.achievements.filter((a) => a.achieved.length > 0).length;
  return (
    <div className="page">
      <h1>팀 기록</h1>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="kpi" title={v.titles.ks.join(', ')}>
          <span className="label">한국시리즈 우승</span>
          <span className="value">{v.titles.ks.length}회</span>
        </div>
        <div className="kpi">
          <span className="label">창단</span>
          <span className="value">{v.founded ?? '—'}</span>
        </div>
        <div className="kpi">
          <Icon name="trophy" size={24} />
          <span className="label">업적</span>
          <span className="value">
            {achieved}/{v.achievements.length}
          </span>
        </div>
        <div className="kpi">
          <span className="label">구단주 레벨</span>
          <span className="value">Lv.{v.owner.level}</span>
        </div>
        <div className="kpi">
          <span className="label">경험치</span>
          <span className="value">
            {v.owner.xp} / {v.owner.xpToNext}
          </span>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg">
          {(
            [
              ['stats', '팀 통계'],
              ['fielding', '수비 기록'],
              ['achievements', `업적 (${achieved})`],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">{v.statsLabel}</span>
        <button className="small" style={{ marginLeft: 'auto' }} onClick={() => nav.go({ name: 'hof' })}>
          명예의 전당 →
        </button>
      </div>

      {tab === 'stats' && <CareerPanel refreshKey={nav.refreshKey} />}
      {tab === 'stats' && (
        <div className="columns even">
          <StatGrid title="팀 타격" items={v.batting} />
          <StatGrid title="팀 투구" items={v.pitching} />
        </div>
      )}

      {tab === 'fielding' && (
        <section className="panel">
          <div className="panel-head">
            <h2>선수별 수비 기록</h2>
            <span className="meta">정규시즌 · 이 구단 소속으로 쌓은 기록 · 기회순</span>
          </div>
          {v.fielding.length > 0 ? <FieldingTable lines={v.fielding} first="player" /> : <p className="muted">이 시즌 수비 기록이 없습니다(시작 이전 기록에는 수비 기록이 없습니다).</p>}
          <p className="muted small">기회 = 자살 + 보살 + 실책, 수비율 = (자살 + 보살) / 기회. 삼진 자살은 포수에게 기록됩니다.</p>
        </section>
      )}

      {tab === 'achievements' && <AchievementBoard list={v.achievements} />}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { once: '1회', season: '시즌마다', cumulative: '재임 누적', legacy: '' };

/** 8b(D-182): 분류별 계열 표. 단계는 칩으로, 달성한 단계는 강조 */
function AchievementBoard({ list }: { list: AchievementView[] }) {
  const cats = [...new Set(list.map((a) => a.category))];
  const [cat, setCat] = useState(cats[0] ?? '');
  const series = [...new Map(list.filter((a) => a.category === cat).map((a) => [a.series === 'legacy' ? a.key : a.series, a])).keys()];
  const xpTotal = list.reduce((a, x) => a + x.achieved.reduce((b, y) => b + y.xp, 0), 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>업적</h2>
        <span className="meta">실제 기록으로 판정 · 상위 단계를 넘으면 아래 단계도 함께 · 시즌마다 업적은 두 번째부터 경험치 절반 · 업적 경험치 시즌 상한 300 · 받은 경험치 합 {xpTotal}</span>
      </div>
      <div className="panel-body">
        <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {cats.map((c) => {
            const n = list.filter((a) => a.category === c && a.achieved.length > 0).length;
            const t = list.filter((a) => a.category === c).length;
            return (
              <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
                {c} <span className="muted small">{n}/{t}</span>
              </button>
            );
          })}
        </div>
        <table className="grid dense">
          <thead>
            <tr>
              <th>계열</th>
              <th>단계</th>
              <th>조건</th>
              <th>최근 달성</th>
            </tr>
          </thead>
          <tbody>
            {series.map((id) => {
              const stages = list.filter((a) => (a.series === 'legacy' ? a.key === id : a.series === id)).sort((a, b) => a.stage - b.stage);
              const first = stages[0]!;
              const got = stages.flatMap((a) => a.achieved.map((x) => ({ ...x, title: a.title }))).sort((a, b) => (a.date < b.date ? 1 : -1));
              return (
                <tr key={id} className={got.length ? 'mine' : ''}>
                  <td>
                    {first.seriesTitle}
                    {TYPE_LABEL[first.type] && <span className="muted small"> · {TYPE_LABEL[first.type]}</span>}
                  </td>
                  <td>
                    <div className="seg" style={{ flexWrap: 'wrap' }}>
                      {stages.map((a) => (
                        <span key={a.key} className={`badge ${a.achieved.length ? 'rec' : ''}`} title={`경험치 ${a.xp}${a.achieved.length ? ` · 달성 ${a.achieved.length}회` : ''}`}>
                          {a.achieved.length ? '★ ' : ''}
                          {a.stageLabel || '달성'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{first.description}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{got.length ? `${got[0]!.detail} (+${got[0]!.xp})` : <span className="muted">미달성</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
