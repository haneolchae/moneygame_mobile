// ② 구단 스토리(27, D-222·D-237): 명예의 전당 '구단 서사' 탭과 구단주실 요약에서 쓴다.
import { useEffect, useState } from 'react';
import type { StoryView } from '../shared/protocol';
import type { Nav } from './App';
import { api } from './api';

const STATUS: Record<string, string> = { done: '완료', skipped: '지나감', pending: '결정 대기', upcoming: '예정', otherBranch: '다른 갈래' };
const KIND: Record<string, string> = { success: '성공', neutral: '보통', fail: '실패', variant: '변주' };
const ACT = (n: number) => (n >= 3 ? '결말' : `${n}막`);

export function useStory(nav: Nav, clubId: number | undefined, enabled = true) {
  const [v, setV] = useState<StoryView | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    setV(undefined);
    api('story.view', clubId === undefined ? {} : { clubId })
      .then(setV)
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, enabled, nav.dashboard?.date]);
  return v;
}

/** 구단주실 요약: 과제·현재 막·다음 장 */
export function StorySummary({ nav }: { nav: Nav }) {
  const v = useStory(nav, undefined);
  if (!v) return null;
  const next = v.chapters.find((c) => c.status === 'pending' || c.status === 'upcoming');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          구단 스토리 · 「{v.title}」 {ACT(v.act)}
          {v.branch ? ` ${v.branch}` : ''}
        </h2>
        <button className="small" onClick={() => nav.go({ name: 'hof', clubId: v.club.id, tab: 'story' })}>
          자세히
        </button>
      </div>
      <div className="panel-body small">
        <div>과제: {v.task}</div>
        {v.chairman !== null && <div className="muted">모기업 신뢰 {Math.round(v.chairman)} (50 = 기준, 0~100 → 모기업 지원금 0.9~1.1배)</div>}
        {v.ending ? (
          <div>
            결말 「{v.ending.title}」({KIND[v.ending.kind] ?? v.ending.kind}) · {v.ending.next ? `다음 과제: ${v.ending.next}` : ''}
          </div>
        ) : next ? (
          <div className="muted">
            다음 장: {next.title} ({next.when}) — 시기·조건이 맞으면 결정 카드로 옵니다
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 명예의 전당 '구단 서사' 탭 */
export function StoryDetail({ v }: { v: StoryView }) {
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>
            「{v.title}」 · {ACT(v.act)}
            {v.branch ? ` (2막 ${v.branch} 갈래)` : ''}
          </h2>
          <span className="meta">
            {v.startSeason} 시즌 캠프 시작{v.storySeason ? ` · 스토리 ${v.storySeason}시즌째` : ''}
            {v.chairman !== null ? ` · 모기업 신뢰 ${Math.round(v.chairman)}` : ''}
          </span>
        </div>
        <div className="panel-body">
          <p>{v.synopsis}</p>
          <p className="small">과제: {v.task}</p>
          {v.ending && (
            <div className="approval-row" style={{ alignItems: 'flex-start' }}>
              <span className="txt">
                <b>
                  결말 「{v.ending.title}」 ({KIND[v.ending.kind] ?? v.ending.kind}, {v.ending.season}){v.ending.owner ? ' · 구단주 달성' : ''}
                </b>
                <div className="small">{v.ending.epilogue}</div>
                {v.ending.next && <div className="small muted">다음 과제: {v.ending.next}</div>}
              </span>
            </div>
          )}
          {v.cast.length > 0 && (
            <p className="small muted">
              등장 선수: {v.cast.map((c) => `${c.label} ${c.name}${c.present ? '' : '(이탈)'}`).join(' · ')}
            </p>
          )}
          {v.seasons.length > 0 && <p className="small muted">시즌: {v.seasons.map((s) => `${s.season} ${s.rank}위 ${s.result}`).join(' · ')}</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>장 기록</h2>
        </div>
        <table className="grid dense">
          <thead>
            <tr>
              <th>막</th>
              <th>장</th>
              <th>시기</th>
              <th>상태</th>
              <th>선택</th>
            </tr>
          </thead>
          <tbody>
            {v.chapters.map((c) => (
              <tr key={c.id} className={c.status === 'otherBranch' ? 'muted' : undefined}>
                <td>
                  {c.act}
                  {c.branch ?? ''}
                </td>
                <td>{c.title}</td>
                <td className="small">{c.when}</td>
                <td>{STATUS[c.status] ?? c.status}</td>
                <td className="small">{c.choice ? `${c.choice} (${c.by}, ${c.date})` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>리그 구단 서사</h2>
        </div>
        <table className="grid dense">
          <tbody>
            {v.league.map((l) => (
              <tr key={l.club.id}>
                <td>{l.club.shortName}</td>
                <td>「{l.title}」</td>
                <td>{ACT(l.act)}</td>
                <td>{l.ending ? `${l.ending} (${KIND[l.endingKind ?? ''] ?? ''}, ${l.endingSeason})` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
