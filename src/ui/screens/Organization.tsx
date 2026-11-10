// 조직·위임: 팀별 처리량, 직원 채용·해고, 위임 정책, 결재함, 업무 큐 (03 문서)
import { Fragment, useEffect, useState } from 'react';
import type { DelegationPolicyView, OfferResultView, OrganizationView, StaffView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { won } from '../format';
import { Icon } from '../icons';

type Tab = 'teams' | 'hire' | 'delegation';
const EOK = 100_000_000;
const MODE_LABEL: Record<string, string> = { direct: '직접 운영', approve: '제안 후 승인', auto: '완전 위임' };
const MODE_HELP: Record<string, string> = {
  direct: '구단주가 지시하고 행동력을 씁니다. 담당 팀은 처리량 50%만 씁니다.',
  approve: '담당자가 안을 만들어 결재를 올립니다. 승인은 행동력 없음. 그 주 안에 결재하지 않으면 만료됩니다.',
  auto: '정책 한도 안에서 담당자가 바로 실행합니다. 행동력 없이 처리량 100%를 씁니다.',
};

function Abilities({ s }: { s: StaffView }) {
  return (
    <span className="small">
      {s.abilities.map((a) => (
        <span key={a.key} title={a.label} style={{ marginRight: 8 }}>
          {a.label.replace(/ .*$/, '')} <strong>{a.value}</strong>
        </span>
      ))}
    </span>
  );
}

function WpBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 100;
  return (
    <span style={{ display: 'inline-block', width: 90, height: 8, background: '#30445a', borderRadius: 4, verticalAlign: 'middle', marginRight: 6 }}>
      <span style={{ display: 'block', width: `${pct}%`, height: 8, borderRadius: 4, background: pct >= 100 ? 'var(--error)' : 'var(--green-2)' }} />
    </span>
  );
}

function PolicyEditor({ p, onSave }: { p: DelegationPolicyView; onSave: (p: DelegationPolicyView) => void }) {
  const [d, setD] = useState(p);
  const isOps = p.team === 'ops';
  return (
    <div className="offer-form" style={{ flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 90 }}>{isOps ? '운영팀' : '경영지원팀'}</strong>
      <div className="seg">
        {(['direct', 'approve', 'auto'] as const).map((m) => (
          <button key={m} className={d.mode === m ? 'active' : ''} onClick={() => setD({ ...d, mode: m })}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {isOps ? (
        <>
          <label>
            FA 총액 한도(억) <input type="number" step="1" min="0" value={d.faMaxTotal / EOK} onChange={(e) => setD({ ...d, faMaxTotal: Math.round(Number(e.target.value) * EOK) })} style={{ width: 70 }} />
          </label>
          <label>
            FA 최대 기간
            <select value={d.faMaxYears} onChange={(e) => setD({ ...d, faMaxYears: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </label>
          <label>
            연봉 협상 한도(요구액의 %) <input type="number" step="1" min="80" max="120" value={d.salaryMaxRatioBp / 100} onChange={(e) => setD({ ...d, salaryMaxRatioBp: Math.round(Number(e.target.value) * 100) })} style={{ width: 60 }} />
          </label>
          <label>
            현금 하한(억) <input type="number" step="5" min="0" value={d.cashFloor / EOK} onChange={(e) => setD({ ...d, cashFloor: Math.round(Number(e.target.value) * EOK) })} style={{ width: 70 }} />
          </label>
        </>
      ) : (
        <label>
          채용 연봉 상한(억) <input type="number" step="0.1" min="0" value={d.hireMaxSalary / EOK} onChange={(e) => setD({ ...d, hireMaxSalary: Math.round(Number(e.target.value) * EOK) })} style={{ width: 70 }} />
        </label>
      )}
      <button className="primary" onClick={() => onSave(d)}>
        저장
      </button>
      <span className="muted small" style={{ flexBasis: '100%' }}>
        {MODE_HELP[d.mode]}
      </span>
    </div>
  );
}

export function Organization({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState<Tab>('teams');
  const [v, setV] = useState<OrganizationView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hireFilter, setHireFilter] = useState<string>('all');

  const reload = async () => {
    try {
      setV(await api('org.view'));
    } catch (e) {
      nav.notify((e as Error).message, 'error');
    }
  };
  useEffect(() => {
    // 결재가 있으면 처음 열 때 위임·결재 탭을 보여준다.
    api('org.view')
      .then((r) => {
        setV(r);
        if (r.approvals.length > 0) setTab('delegation');
      })
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<OfferResultView>) => {
    try {
      const r = await fn();
      nav.notify(`${r.result === 'accept' ? '✔ ' : '✕ '}${r.message}`, r.result === 'reject' ? 'error' : 'info');
      await reload();
      void nav.sync();
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    }
  };

  if (!v) return <div className="page muted">불러오는 중…</div>;
  const people = [v.secretary, ...v.executives].filter((x): x is StaffView => x !== null);
  const candidateTitles = ['all', ...Array.from(new Set(v.candidates.map((c) => c.title)))];
  const candidates = v.candidates.filter((c) => hireFilter === 'all' || c.title === hireFilter);
  return (
    <div className="page">
      <h1>조직·위임</h1>
      <div className="kpis">
        <div className="kpi">
          <Icon name="users" size={24} />
          <span className="label">직원</span>
          <span className="value">{v.headcount}명</span>
        </div>
        <div className="kpi">
          <span className="label">직원 연봉 합계(연)</span>
          <span className="value">{won(v.staffPayrollWon)}</span>
        </div>
        <div className="kpi">
          <span className="label">현금</span>
          <span className="value">{won(v.cashWon)}</span>
        </div>
        <div className="kpi" title="비서 일정 관리력에 따라 할 일 목록이 일정을 미리 알리는 기간">
          <span className="label">비서 일정 알림</span>
          <span className="value">{v.lookaheadDays > 0 ? `${v.lookaheadDays}일 전` : '당일만'}</span>
        </div>
        <div className="kpi">
          <Icon name="bolt" size={24} />
          <span className="label">행동력 ({v.weekLabel})</span>
          <span className="value">{v.apRemaining}</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg">
          {(
            [
              ['teams', '조직 현황'],
              ['hire', `채용 시장 (${v.candidates.length})`],
              ['delegation', `위임·결재${v.approvals.length ? ` (${v.approvals.length})` : ''}`],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">{v.scoutingNote}</span>
      </div>

      {tab === 'teams' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>프런트 팀별 처리량 (이번 주)</h2>
              <span className="meta">처리량(WP) = 팀원 기여 합 × 팀장 관리력 × 본부장 조정. 정기 업무를 먼저 쓰고 남은 만큼 위임 업무를 처리합니다.</span>
            </div>
            <table className="grid dense">
              <thead>
                <tr>
                  <th>부문</th>
                  <th>팀</th>
                  <th>팀장</th>
                  <th className="num">인원</th>
                  <th className="num">주간 WP</th>
                  <th className="num">정기 업무</th>
                  <th>사용</th>
                  <th className="num">남음</th>
                  <th>위임</th>
                </tr>
              </thead>
              <tbody>
                {v.teams.map((t) => (
                  <Fragment key={t.key}>
                    <tr className="clickable" onClick={() => setOpen(open === t.key ? null : t.key)}>
                      <td>{t.division}</td>
                      <td>
                        <strong>{t.name}</strong>
                      </td>
                      <td>{t.leader ? `${t.leader.name} (${t.leader.overall})` : <span style={{ color: 'var(--error)' }}>공석 · {t.actingName ?? '담당 없음'} 겸임</span>}</td>
                      <td className="num">
                        {t.members.length}/{t.defaultMembers}
                      </td>
                      <td className="num">{t.weeklyWp}</td>
                      <td className="num" style={{ color: t.upkeepShort ? 'var(--error)' : undefined }}>
                        {t.upkeep}
                      </td>
                      <td>
                        <WpBar used={t.usedWp} total={t.weeklyWp} />
                        <span className="small muted">{t.usedWp}</span>
                      </td>
                      <td className="num">{t.remainingWp}</td>
                      <td>{t.delegable ? MODE_LABEL[t.mode] : <span className="muted small">다음 단계</span>}</td>
                    </tr>
                    {open === t.key && (
                      <tr>
                        <td colSpan={9}>
                          <table className="grid dense" style={{ background: 'var(--paper)' }}>
                            <tbody>
                              {[...(t.leader ? [t.leader] : []), ...t.members].map((s) => (
                                <tr key={s.id}>
                                  <td>{s.title === '팀장' ? '팀장' : t.memberLabel}</td>
                                  <td>{s.name}</td>
                                  <td className="num">{s.age}세</td>
                                  <td>
                                    <Abilities s={s} />
                                  </td>
                                  <td className="num">{won(s.salaryWon)}</td>
                                  <td className="num">{s.contractYears}년</td>
                                  <td>
                                    <button className="small" onClick={() => window.confirm(`${s.name}을(를) 내보낼까요? 보상금(남은 계약 연봉의 50%)을 지급하고 행동력 ${v.apCosts.fire}을 씁니다.`) && void run(() => api('org.fire', { staffId: s.id }))}>
                                      해고
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {t.members.length + (t.leader ? 1 : 0) === 0 && (
                                <tr>
                                  <td className="muted">인원이 없습니다.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                          <div className="row" style={{ marginTop: 6 }}>
                            <button className="small" onClick={() => (setTab('hire'), setHireFilter(t.leader ? '팀원' : '팀장'))}>
                              채용 시장에서 찾기
                            </button>
                            <span className="muted small">인원 상한 {t.maxMembers}명</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
          <div className="columns even">
            <section className="panel">
              <div className="panel-head">
                <h2>구단주 직속·본부장</h2>
                <span className="meta">평판(20~80) · 실제 능력은 일하면서 드러납니다</span>
              </div>
              <table className="grid dense">
                <tbody>
                  {people.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.title}</strong>
                      </td>
                      <td>{s.name}</td>
                      <td>
                        <Abilities s={s} />
                      </td>
                      <td className="num">{won(s.salaryWon)}</td>
                      <td>
                        <button className="small" onClick={() => window.confirm(`${s.title} ${s.name}을(를) 내보낼까요?`) && void run(() => api('org.fire', { staffId: s.id }))}>
                          해고
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!v.secretary && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--error)' }}>
                        비서 공석 — 할 일 목록이 당일 일정만 알립니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>코칭스태프 ({v.coaches.length}/15)</h2>
                <span className="meta">경기·육성 효과는 해당 기능 단계에서 연결</span>
              </div>
              <div style={{ maxHeight: 330, overflow: 'auto' }}>
                <table className="grid dense">
                  <tbody>
                    {v.coachSlots.map((c) => (
                      <tr key={c.part}>
                        <td className="muted small">{c.squad}</td>
                        <td>{c.part}</td>
                        <td>{c.coach ? c.coach.name : <span style={{ color: 'var(--error)' }}>공석</span>}</td>
                        <td className="num">{c.coach ? c.coach.overall : ''}</td>
                        <td className="num">{c.coach ? won(c.coach.salaryWon) : ''}</td>
                        <td>
                          {c.coach && (
                            <button className="small" onClick={() => window.confirm(`${c.part} ${c.coach!.name}을(를) 내보낼까요?`) && void run(() => api('org.fire', { staffId: c.coach!.id }))}>
                              해고
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {tab === 'hire' && (
        <section className="panel">
          <div className="panel-head">
            <h2>채용 시장</h2>
            <span className="meta">
              후보는 매달 1일 바뀝니다(다음 교체 {v.candidatesRefresh}) · 직접 채용 행동력 {v.apCosts.hire} · 평판은 실제 능력과 다를 수 있습니다
            </span>
          </div>
          <div className="toolbar" style={{ padding: '8px 12px' }}>
            <div className="seg">
              {candidateTitles.map((t) => (
                <button key={t} className={hireFilter === t ? 'active' : ''} onClick={() => setHireFilter(t)}>
                  {t === 'all' ? '전체' : t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="grid dense">
              <thead>
                <tr>
                  <th>직책</th>
                  <th>소속·파트</th>
                  <th>이름</th>
                  <th className="num">나이</th>
                  <th className="num">평판</th>
                  <th>능력(평판)</th>
                  <th className="num">요구 연봉</th>
                  <th className="num">기간</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.teamName ?? c.part ?? '—'}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.age}</td>
                    <td className="num">
                      <strong>{c.overall}</strong>
                    </td>
                    <td>
                      <Abilities s={c} />
                    </td>
                    <td className="num">{won(c.salaryWon)}</td>
                    <td className="num">{c.contractYears}년</td>
                    <td>
                      <button className="small" onClick={() => void run(() => api('org.hire', { staffId: c.id }))}>
                        채용 (행동력 {v.apCosts.hire})
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'delegation' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>구단주 결정</h2>
              <span className="meta">모기업 긴급 지원(시즌당 1회, 다음 시즌 지원금에서 차감) · 리빌딩 선언(스토브리그, 2시즌 성적 판정 유예, 5시즌에 1번)</span>
            </div>
            <div className="panel-body row" style={{ marginTop: 0 }}>
              <button disabled={!v.owner.emergencyAvailable} onClick={() => window.confirm('모기업에 긴급 지원을 요청할까요? 다음 시즌 지원금에서 같은 금액이 빠집니다.') && void run(() => api('owner.emergency'))}>
                모기업 긴급 지원 요청
              </button>
              <button disabled={!v.owner.canRebuild} onClick={() => window.confirm('리빌딩을 선언할까요? 2시즌 동안 성적 목표 미달이 해임 판정에 들어가지 않습니다.') && void run(() => api('owner.rebuild'))}>
                리빌딩 선언 (행동력 {v.owner.rebuildAp})
              </button>
              <span className="muted small">
                {v.owner.crisisSince ? `자금 위기 시작 ${v.owner.crisisSince}` : '자금 정상'} · {v.owner.rebuild ? `리빌딩 ${v.owner.rebuild}` : '리빌딩 없음'}
              </span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>결재함</h2>
              <span className="meta">'제안 후 승인' 모드에서 담당자가 올린 안건. 승인은 행동력 없음</span>
            </div>
            {v.approvals.length === 0 ? (
              <div className="panel-body muted">결재 대기 안건이 없습니다.</div>
            ) : (
              <table className="grid dense">
                <tbody>
                  {v.approvals.map((a) => (
                    <tr key={a.id}>
                      <td>{a.date.slice(5).replace('-', '/')}</td>
                      <td>{a.teamName}</td>
                      <td>{a.kindLabel}</td>
                      <td style={{ whiteSpace: 'normal' }}>{a.summary}</td>
                      <td>
                        <button className="primary small" onClick={() => void run(() => api('org.approve', { approvalId: a.id }))}>
                          승인
                        </button>{' '}
                        <button className="small" onClick={() => void run(() => api('org.reject', { approvalId: a.id }))}>
                          반려
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>위임 정책</h2>
              <span className="meta">이번 단계는 운영팀(FA·연봉 협상)과 경영지원팀(채용)을 위임할 수 있습니다. 위임해도 현금·규정 검증은 그대로입니다.</span>
            </div>
            <div className="panel-body">
              {v.policies.map((p) => (
                <PolicyEditor key={`${p.team}-${p.mode}-${p.faMaxTotal}-${p.hireMaxSalary}`} p={p} onSave={(np) => void run(() => api('org.setPolicy', np))} />
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>공석 채용 맡기기</h2>
              <span className="meta">경영지원팀이 연봉 상한 안에서 평판이 가장 좋은 후보를 찾습니다(채용 1건 처리량 6)</span>
            </div>
            <div className="panel-body">
              {v.vacancies.length === 0 ? (
                <span className="muted">공석이 없습니다.</span>
              ) : (
                v.vacancies.map((x) => (
                  <button key={`${x.team}-${x.title}`} className="small" style={{ margin: '0 6px 6px 0' }} onClick={() => void run(() => api('org.delegateHire', { team: x.team, title: x.title }))}>
                    {x.label} 맡기기
                  </button>
                ))
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>위임 업무</h2>
              <span className="meta">담당자가 매주 처리량 안에서 진행합니다. 실패 이유도 여기서 확인합니다.</span>
            </div>
            {v.tasks.length === 0 ? (
              <div className="panel-body muted">맡긴 업무가 없습니다. [계약·이적]의 [맡기기] 버튼이나 위 공석 채용으로 시작하세요.</div>
            ) : (
              <table className="grid dense">
                <thead>
                  <tr>
                    <th>팀</th>
                    <th>업무</th>
                    <th>대상</th>
                    <th>상태</th>
                    <th>최근 진행</th>
                    <th>갱신</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {v.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>{t.teamName}</td>
                      <td>{t.kindLabel}</td>
                      <td>{t.target}</td>
                      <td>
                        <span className={`badge ${t.statusKey === 'done' ? 'rec' : t.statusKey === 'failed' ? 'req' : t.statusKey === 'cancelled' ? 'opt' : ''}`}>{t.status}</span>
                      </td>
                      <td className="small" style={{ whiteSpace: 'normal' }}>
                        {t.note}
                      </td>
                      <td className="small">{t.updated.slice(5).replace('-', '/')}</td>
                      <td>
                        {(t.statusKey === 'queued' || t.statusKey === 'waiting') && (
                          <button className="small" onClick={() => void run(() => api('org.cancelTask', { taskId: t.id }))}>
                            취소
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
