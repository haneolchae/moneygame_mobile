// ③ 프롤로그 안내(27b, D-223·D-238): 화면 오른쪽 아래에 붙는 안내 창. 진행을 막지 않는다.
// 장면(대사·회견 답변) → 미션 목록(설명·화면 안내·건너뛰기). 판정·기본 처리는 게임 진행 계층이 하고, 여기서는 요청과 표시만 한다.
import { useState } from 'react';
import type { PrologueActionResult, PrologueView } from '../shared/protocol';
import type { Nav, Route } from './App';
import { api, ApiError } from './api';

/** 화면 안내 대상 → 메뉴 이름 */
export const TARGET_LABEL: Record<string, string> = {
  dashboard: '구단 현황', inbox: '받은 편지함', news: '뉴스 로그', players: '선수단', roster: '선수단 운영', market: '계약·이적', org: '조직·위임', schedule: '일정', standings: '리그 순위', hof: '명예의 전당', business: '사업·시설', finance: '재정',
};
const STATUS: Record<string, string> = { active: '진행 중', done: '완료', skipped: '건너뜀', missed: '기한 지남' };

export function ProloguePanel({ view, nav }: { view: PrologueView; nav: Nav }) {
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);

  const run = async (p: Promise<PrologueActionResult>) => {
    setSending(true);
    try {
      const r = await p;
      nav.notify(r.message);
      if (r.summary.length > 1) setSummary(r.summary);
      await nav.sync();
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  const go = (t: string) => nav.go(t === 'hof' ? { name: 'hof', tab: 'story' } : ({ name: t } as Route));
  const active = view.missions.filter((m) => m.status === 'active');
  const finished = view.missions.filter((m) => m.status !== 'active');
  const partLabel = view.kind === 'arrival' ? '부임 장면' : view.part === 'season' ? '시즌편' : '첫 겨울편';

  if (!open) {
    return (
      <button className="prologue-tab" onClick={() => setOpen(true)} title="프롤로그 안내 열기">
        프롤로그 · {partLabel} {view.progress.done}/{view.progress.total}
        {view.scene ? ' · 새 장면' : ''}
      </button>
    );
  }
  return (
    <aside className="prologue-dock panel" aria-label="프롤로그 안내">
      <div className="panel-head">
        <h2>
          프롤로그 · 「{view.clubTitle}」
          <span className="meta"> {view.partTitle} · {view.progress.done}/{view.progress.total}</span>
        </h2>
        <button className="small" onClick={() => setOpen(false)} aria-label="접기">
          접기
        </button>
      </div>
      <div className="panel-body">
        {view.scene && (
          <div className="prologue-scene">
            <h3>{view.scene.id.startsWith('A') ? view.scene.title : `${view.scene.id} ${view.scene.title}`}</h3>
            {view.scene.lines.map((l, i) => (
              <p key={i} className={l.speaker ? 'line' : 'line narration'}>
                {l.speaker && <b>{l.speaker}</b>} {l.text}
              </p>
            ))}
            {view.scene.answers ? (
              <div className="prologue-answers">
                {view.scene.answers.map((a) => (
                  <button key={a.id} disabled={sending} className={a.isDefault ? 'primary small' : 'small'} title={a.text} onClick={() => void run(api('prologue.ack', { chapterId: view.scene!.id, answerId: a.id }))}>
                    {a.label}
                    <span className="small"> {a.effects.join(' · ')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button className="primary small" disabled={sending} onClick={() => void run(api('prologue.ack', { chapterId: view.scene!.id }))}>
                다음
              </button>
            )}
          </div>
        )}
        {active.map((m) => (
          <div key={m.id} className="prologue-mission">
            <div>
              <b>
                {m.id} {m.title}
              </b>{' '}
              <span className="muted small">{m.until ? `~${m.until}` : ''}</span>
            </div>
            <div>미션: {m.mission}</div>
            {m.learn.map((l, i) => (
              <div key={i} className="small muted">
                · {l}
              </div>
            ))}
            <div className="prologue-actions">
              {m.targets.map((t) => (
                <button key={t} className="small" onClick={() => go(t)}>
                  {TARGET_LABEL[t] ?? t} 열기
                </button>
              ))}
              <button className="small" disabled={sending} title={`건너뛰면: ${m.defaultNote}`} onClick={() => void run(api('prologue.skip', { scope: 'chapter', chapterId: m.id }))}>
                이 장 건너뛰기
              </button>
            </div>
          </div>
        ))}
        {finished.length > 0 && (
          <div className="small muted">
            {finished.map((m) => `${m.id} ${STATUS[m.status]}${m.how ? `(${m.how})` : ''}`).join(' · ')}
          </div>
        )}
        {view.next && (
          <div className="small muted">
            다음 장: {view.next.title} ({view.next.when})
          </div>
        )}
        <div className="prologue-actions">
          {view.kind === 'full' && (
            <button className="small" disabled={sending} onClick={() => void run(api('prologue.settings', { hints: !view.hints }))}>
              {view.hints ? '설명 끄기' : '설명 켜기'}
            </button>
          )}
          <button className="small" disabled={sending} title="남은 미션은 담당자 기본 처리로 넘깁니다. 게임상 불이익은 없습니다." onClick={() => void run(api('prologue.skip', { scope: 'part' }))}>
            {partLabel} 건너뛰기
          </button>
        </div>
      </div>
      {summary && (
        <div className="modal-backdrop">
          <div className="panel modal">
            <div className="panel-head">
              <h2>건너뛴 내용</h2>
              <span className="meta">남은 미션은 담당자 기본 처리 또는 게임 기본 흐름으로 넘어갔습니다</span>
            </div>
            <div className="modal-body">
              {summary.map((s, i) => (
                <div key={i} className="small">
                  {s}
                </div>
              ))}
              <p>
                <button className="primary" onClick={() => setSummary(null)}>
                  확인
                </button>
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/** 본 장면 다시 보기(명예의 전당 '구단 서사' 탭). 다시 봐도 결과는 바뀌지 않는다 */
export function PrologueHistory({ entries }: { entries: Array<{ clubTitle: string; club: string; part: string; id: string; title: string; date: string; lines: Array<{ speaker: string; text: string }>; answer: string | null; status: string | null }> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!entries.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>프롤로그 다시 보기</h2>
        <span className="meta">본 장면 {entries.length}개 · 다시 봐도 결과는 바뀌지 않습니다</span>
      </div>
      <table className="grid dense">
        <tbody>
          {entries.map((e) => {
            const key = `${e.club}-${e.id}`;
            return (
              <tr key={key}>
                <td className="small">
                  {e.club} · {e.part}
                </td>
                <td>
                  <button className="link small" onClick={() => setOpenId(openId === key ? null : key)}>
                    {e.id.startsWith('A') ? e.title : `${e.id} ${e.title}`}
                  </button>
                  {openId === key && (
                    <div className="small">
                      {e.lines.map((l, i) => (
                        <div key={i}>
                          {l.speaker && <b>{l.speaker}: </b>}
                          {l.text}
                        </div>
                      ))}
                      {e.answer && <div className="muted">답변: {e.answer}</div>}
                      {e.status && <div className="muted">처리: {e.status}</div>}
                    </div>
                  )}
                </td>
                <td className="small">{e.date}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
