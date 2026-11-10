// 계약·이적: FA 시장, 연봉 협상, 외국인 선수, 선수단 정리(방출)
import { Fragment, useEffect, useState } from 'react';
import type { FaRowView, MarketView, OfferResultView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { POSITION_LABELS, won } from '../format';
import { Icon } from '../icons';

type Tab = 'fa' | 'salary' | 'foreign' | 'roster';
const EOK = 100_000_000;
const usd = (n: number) => `${Math.round(n / 10_000).toLocaleString('ko-KR')}만 달러`;
const toEok = (n: number) => +(n / EOK).toFixed(2);

export function OfferForm({ row, onDone, nav }: { row: FaRowView; onDone: (r: OfferResultView) => void; nav: Nav }) {
  const base = row.myOffer?.status === 'countered' ? row.myOffer.offer : row.demand;
  const [years, setYears] = useState(row.demand.years);
  const [salary, setSalary] = useState(toEok(base.salaryWon));
  const [bonus, setBonus] = useState(toEok(base.bonusWon));
  const [sending, setSending] = useState(false);
  const total = years * salary * EOK + bonus * EOK;
  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      onDone(await api('market.faOffer', { playerId: row.playerId, years, salaryWon: Math.round(salary * EOK), bonusWon: Math.round(bonus * EOK) }));
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="offer-form">
      <strong>{row.name}에게 제안</strong>
      <span className="muted small">
        요구: {row.demand.years}년 총액 {won(row.demand.totalWon)} (계약금 {won(row.demand.bonusWon)}, 연봉 {won(row.demand.salaryWon)})
      </span>
      <label>
        기간
        <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </label>
      <label>
        연봉(억) <input type="number" step="0.1" min="0.3" value={salary} onChange={(e) => setSalary(Number(e.target.value))} style={{ width: 90 }} />
      </label>
      <label>
        계약금(억) <input type="number" step="0.5" min="0" value={bonus} onChange={(e) => setBonus(Number(e.target.value))} style={{ width: 90 }} />
      </label>
      <span>
        총액 <strong className="gold">{won(total)}</strong>
        {row.compensationWon > 0 && <span className="muted small"> + 보상금 {won(row.compensationWon)}</span>}
      </span>
      <button className="primary" disabled={sending} onClick={submit}>
        제안하기 (이번 주 첫 제안만 행동력 1)
      </button>
    </div>
  );
}

/** 운영팀 위임: 총액·기간 한도를 정해 맡긴다. 행동력은 쓰지 않고 운영팀 처리량을 쓴다. */
export function DelegateForm({ row, ops, onDone, nav }: { row: FaRowView; ops: MarketView['ops']; onDone: (r: OfferResultView) => void; nav: Nav }) {
  const [maxTotal, setMaxTotal] = useState(toEok(Math.min(ops.faMaxTotal, Math.round(row.demand.totalWon * 1.15))));
  const [maxYears, setMaxYears] = useState(Math.min(ops.faMaxYears, Math.max(row.demand.years, 1)));
  const [sending, setSending] = useState(false);
  const submit = async () => {
    if (sending) return;
    setSending(true);
    try {
      onDone(await api('org.delegateFa', { playerId: row.playerId, maxTotalWon: Math.round(maxTotal * EOK), maxYears }));
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="offer-form">
      <strong>{row.name} 협상을 운영팀에 맡기기</strong>
      <span className="muted small">{ops.mode === 'approve' ? '운영팀이 제시안을 만들어 결재를 올립니다.' : '한도 안에서 운영팀이 직접 계약합니다.'} 1회 협상에 처리량 10.</span>
      <label>
        총액 한도(억) <input type="number" step="1" min="1" value={maxTotal} onChange={(e) => setMaxTotal(Number(e.target.value))} style={{ width: 90 }} />
      </label>
      <label>
        최대 기간
        <select value={maxYears} onChange={(e) => setMaxYears(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </label>
      <button className="primary" disabled={sending} onClick={submit}>
        맡기기 (행동력 없음)
      </button>
    </div>
  );
}

const MODE_LABEL: Record<string, string> = { direct: '직접 운영', approve: '제안 후 승인', auto: '완전 위임' };

/** 선수 상세에 들어갔다 돌아오면 보던 탭을 복원한다(3d). */
const marketMemory: { tab: Tab } = { tab: 'fa' };

export function Market({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState<Tab>(marketMemory.tab);
  useEffect(() => {
    marketMemory.tab = tab;
  }, [tab]);
  const [v, setV] = useState<MarketView | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [delegating, setDelegating] = useState<number | null>(null);
  const [salaryEdits, setSalaryEdits] = useState<Record<number, number>>({});
  const [usdEdits, setUsdEdits] = useState<Record<number, number>>({});

  const reload = async () => {
    try {
      setV(await api('market.view'));
    } catch (e) {
      nav.notify((e as Error).message, 'error');
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const after = async (r: OfferResultView) => {
    const extra = r.counter ? ` 역제안: ${r.counter.years}년 총액 ${won(r.counter.totalWon)} (계약금 ${won(r.counter.bonusWon)}, 연봉 ${won(r.counter.salaryWon)})` : '';
    nav.notify(`${r.result === 'accept' ? '✔ ' : r.result === 'counter' ? '↔ ' : '✕ '}${r.message}${extra}`, r.result === 'reject' ? 'error' : 'info');
    setEditing(null);
    setDelegating(null);
    await reload();
    void nav.sync();
  };
  const run = async (fn: () => Promise<OfferResultView>) => {
    try {
      await after(await fn());
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    }
  };

  if (!v) return <div className="page muted">불러오는 중…</div>;
  const overCap = v.payrollWon > v.capWon;
  return (
    <div className="page">
      <h1>계약·이적</h1>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="kpi">
          <Icon name="calendar" size={24} />
          <span className="value" style={{ fontSize: 17 }}>{v.stageLabel}</span>
        </div>
        <div className="kpi">
          <span className="label">현금</span>
          <span className="value">{won(v.cashWon)}</span>
        </div>
        <div className="kpi" title="외국인 제외 국내 선수 연봉 합계 / 샐러리캡">
          <span className="label">연봉 총액</span>
          <span className="value" style={{ color: overCap ? 'var(--error)' : undefined }}>
            {won(v.payrollWon)}
            <span className="muted small"> / {won(v.capWon)}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="label">선수단</span>
          <span className="value" style={{ color: v.rosterCount > v.rosterMax ? 'var(--error)' : undefined }}>
            {v.rosterCount}/{v.rosterMax}
          </span>
        </div>
        <div className="kpi">
          <Icon name="bolt" size={24} />
          <span className="label">행동력</span>
          <span className="value">{v.apRemaining}</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg">
          {(
            [
              ['fa', `FA 시장 (${v.fa.filter((f) => f.statusKey === 'approved').length})`],
              ['salary', `연봉 협상 (${v.salaryTalks.filter((t) => t.status === '협상 중').length})`],
              ['foreign', '외국인'],
              ['roster', '선수단 정리'],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {v.obligationsWon > 0 && <span className="muted small">방출 선수 잔여 연봉 {won(v.obligationsWon)}</span>}
      </div>

      {tab === 'fa' && (
        <section className="panel">
          <div className="panel-head">
            <h2>FA 시장</h2>
            <span className="meta">선수는 매주 일요일 받은 제안 중 가장 좋은 조건을 고릅니다. 우리 제안에는 바로 답합니다. · 운영팀: {MODE_LABEL[v.ops.mode]}</span>
          </div>
          {v.fa.length === 0 ? (
            <div className="panel-body muted">FA 자격 선수는 11월 13일에 공시됩니다.</div>
          ) : (
            <table className="grid dense">
              <thead>
                <tr>
                  <th>선수</th>
                  <th>포지션</th>
                  <th className="num">나이</th>
                  <th className="num">평가</th>
                  <th>원소속</th>
                  <th>등급</th>
                  <th className="num">직전 연봉</th>
                  <th className="num">요구</th>
                  <th className="num">보상금</th>
                  <th className="num">관심</th>
                  <th>상태</th>
                  <th>우리 제안</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.fa.map((f) => (
                  <Fragment key={f.playerId}>
                    <tr className={f.franchise ? 'mine' : ''}>
                      <td>
                        <span className="clickable" onClick={() => nav.go({ name: 'player', playerId: f.playerId, back: { name: 'market' } })}>
                          {f.name}
                        </span>{' '}
                        {f.franchise && <span className="badge star">간판</span>}
                      </td>
                      <td>{POSITION_LABELS[f.position] ?? f.position}</td>
                      <td className="num">{f.age}</td>
                      <td className="num">{f.scoutGrade}</td>
                      <td>{f.originClub.shortName}</td>
                      <td>{f.faGrade ?? '—'}</td>
                      <td className="num">{won(f.priorSalaryWon)}</td>
                      <td className="num">
                        {f.demand.years}년 {won(f.demand.totalWon)}
                      </td>
                      <td className="num">{f.compensationWon ? won(f.compensationWon) : '—'}</td>
                      <td className="num">{f.statusKey === 'approved' ? `${f.interest}곳` : '—'}</td>
                      <td>{f.signedClub ? `${f.signedClub.shortName} ${f.signedContract?.years}년 ${won(f.signedContract?.totalWon ?? 0)}` : f.status}</td>
                      <td className="small" title={f.delegation?.note ?? f.myOffer?.response}>
                        {f.delegation ? `운영팀 · ${f.delegation.status}` : f.myOffer ? `${{ pending: '대기', accepted: '합의', rejected: '거절', countered: '역제안', withdrawn: '철회', expired: '만료' }[f.myOffer.status] ?? f.myOffer.status} · ${won(f.myOffer.offer.totalWon)}` : '—'}
                      </td>
                      <td>
                        {f.statusKey === 'approved' && v.marketOpen && !(f.delegation && ['운영 중', '결재 대기'].includes(f.delegation.status)) && (
                          <>
                            <button className="small" onClick={() => (setDelegating(null), setEditing(editing === f.playerId ? null : f.playerId))}>
                              제안
                            </button>{' '}
                            <button className="small" disabled={v.ops.mode === 'direct'} title={v.ops.mode === 'direct' ? '운영팀이 직접 운영 모드입니다. [조직·위임]에서 바꾸세요.' : '한도를 정해 운영팀에 맡깁니다.'} onClick={() => (setEditing(null), setDelegating(delegating === f.playerId ? null : f.playerId))}>
                              맡기기
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {editing === f.playerId && (
                      <tr>
                        <td colSpan={13}>
                          <OfferForm row={f} nav={nav} onDone={(r) => void after(r)} />
                          {f.myOffer?.response && <div className="muted small">지난 응답: {f.myOffer.response}</div>}
                        </td>
                      </tr>
                    )}
                    {delegating === f.playerId && (
                      <tr>
                        <td colSpan={13}>
                          <DelegateForm row={f} ops={v.ops} nav={nav} onDone={(r) => void after(r)} />
                        </td>
                      </tr>
                    )}
                    {f.delegation && editing !== f.playerId && delegating !== f.playerId && (
                      <tr className="sub">
                        <td colSpan={13} className="muted small">
                          운영팀 위임 {f.delegation.status}: {f.delegation.note}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'salary' && (
        <section className="panel">
          <div className="panel-head">
            <h2>보류 선수 연봉 협상</h2>
            <span className="meta">1월 10일까지 합의하지 못하면 제시액과 요구액의 중간값으로 조정</span>
            <button className="small" style={{ marginLeft: 12 }} disabled={v.ops.mode === 'direct'} title={v.ops.mode === 'direct' ? '운영팀이 직접 운영 모드입니다.' : '남은 대상을 운영팀이 정책 한도 안에서 매주 협상합니다(1명당 처리량 4).'} onClick={() => void run(() => api('market.salaryAuto'))}>
              남은 협상 운영팀에 맡기기 ({MODE_LABEL[v.ops.mode]})
            </button>
          </div>
          {v.salaryTalks.length === 0 ? (
            <div className="panel-body muted">연봉 협상은 12월 1일에 시작됩니다.</div>
          ) : (
            <table className="grid dense">
              <thead>
                <tr>
                  <th>선수</th>
                  <th>포지션</th>
                  <th className="num">나이</th>
                  <th className="num">2026 연봉</th>
                  <th className="num">요구액</th>
                  <th className="num">구단 제시액</th>
                  <th>상태</th>
                  <th className="num">최종</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.salaryTalks.map((t) => (
                  <tr key={t.playerId}>
                    <td>{t.name}</td>
                    <td>{POSITION_LABELS[t.position] ?? t.position}</td>
                    <td className="num">{t.age}</td>
                    <td className="num">{won(t.priorWon)}</td>
                    <td className="num">{won(t.demandWon)}</td>
                    <td className="num">{won(t.offerWon)}</td>
                    <td title={t.delegation?.note}>{t.delegation && t.status === '협상 중' ? `운영팀 · ${t.delegation.status}` : t.status}</td>
                    <td className="num">{t.finalWon ? won(t.finalWon) : '—'}</td>
                    <td>
                      {t.status === '협상 중' && !(t.delegation && ['운영 중', '결재 대기'].includes(t.delegation.status)) && (
                        <>
                          <input type="number" step="0.1" style={{ width: 80 }} value={salaryEdits[t.playerId] ?? toEok(t.offerWon)} onChange={(e) => setSalaryEdits({ ...salaryEdits, [t.playerId]: Number(e.target.value) })} />
                          <button className="small" onClick={() => void run(() => api('market.salaryOffer', { playerId: t.playerId, offerWon: Math.round((salaryEdits[t.playerId] ?? toEok(t.offerWon)) * EOK) }))}>
                            제시 (이번 주 첫 제안만 행동력 1)
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'foreign' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>우리 외국인 선수</h2>
              <span className="meta">
                외국인 3명 계약 총액 {usd(v.foreign.totalUsd)} / 상한 {usd(v.foreign.capUsd)}
              </span>
            </div>
            <table className="grid dense">
              <thead>
                <tr>
                  <th>선수</th>
                  <th>구분</th>
                  <th>포지션</th>
                  <th className="num">나이</th>
                  <th className="num">평가</th>
                  <th className="num">현재 연봉</th>
                  <th className="num">재계약 요구</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.foreign.mine.map((p) => (
                  <tr key={p.playerId}>
                    <td>{p.name}</td>
                    <td>{p.origin === 'asia' ? '아시아쿼터' : '외국인'}</td>
                    <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">{p.scoutGrade}</td>
                    <td className="num">{usd(p.salaryUsd)}</td>
                    <td className="num">{p.status === 'expiring' ? usd(p.demandUsd) : '—'}</td>
                    <td>{p.status === 'expiring' ? '계약 만료' : `계약 중`}</td>
                    <td>
                      {p.status === 'expiring' && (
                        <>
                          <input type="number" step="1" style={{ width: 70 }} value={usdEdits[p.playerId] ?? Math.round(p.demandUsd / 10_000)} onChange={(e) => setUsdEdits({ ...usdEdits, [p.playerId]: Number(e.target.value) })} />
                          만$
                          <button className="small" onClick={() => void run(() => api('market.foreignOffer', { playerId: p.playerId, salaryUsd: (usdEdits[p.playerId] ?? Math.round(p.demandUsd / 10_000)) * 10_000 }))}>
                            재계약 (이번 주 첫 제안만 행동력 1)
                          </button>
                        </>
                      )}
                      <button className="small" onClick={() => window.confirm(`${p.name} 선수와 결별할까요?`) && void run(() => api('market.release', { playerId: p.playerId }))}>
                        결별
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="muted small" style={{ margin: '8px 16px 12px' }}>
              {v.foreign.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>해외 선수 풀</h2>
              <span className="meta">스카우트 해외 담당 평가 · 신규 영입은 선수별 이번 주 첫 제안만 행동력 1</span>
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="grid dense">
                <thead>
                  <tr>
                    <th>선수</th>
                    <th>구분</th>
                    <th>포지션</th>
                    <th className="num">나이</th>
                    <th className="num">평가</th>
                    <th className="num">요구 금액</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {v.foreign.pool.map((p) => (
                    <tr key={p.playerId}>
                      <td>{p.name}</td>
                      <td>{p.origin === 'asia' ? '아시아쿼터' : '외국인'}</td>
                      <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">{p.scoutGrade}</td>
                      <td className="num">{usd(p.demandUsd)}</td>
                      <td>
                        <button className="small" onClick={() => void run(() => api('market.foreignOffer', { playerId: p.playerId, salaryUsd: p.demandUsd }))}>
                          영입
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === 'roster' && v.retirementPending.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>은퇴를 고민하는 선수</h2>
            <span className="meta">기한 안에 면담(행동력 1)으로 한 시즌 더 뛰도록 설득할 수 있습니다</span>
          </div>
          <table className="grid dense">
            <tbody>
              {v.retirementPending.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    <strong>{r.name}</strong> ({r.age}세)
                  </td>
                  <td>{r.reason}</td>
                  <td>기한 {r.deadline}</td>
                  <td>
                    <button className="small" onClick={() => void run(() => api('roster.persuade', { playerId: r.playerId }))}>
                      설득 면담 (행동력 1)
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === 'roster' && (
        <section className="panel">
          <div className="panel-head">
            <h2>선수단 정리 (방출)</h2>
            <span className="meta">
              {v.rosterCount}/{v.rosterMax}명 · 보류 명단(11/30)·캠프 명단(1/31) 전 40명 이하 필수 · 계약이 남은 선수는 잔여 연봉을 계속 지급
            </span>
          </div>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="grid dense">
              <thead>
                <tr>
                  <th>선수</th>
                  <th>포지션</th>
                  <th className="num">나이</th>
                  <th>1·2군</th>
                  <th className="num">평가</th>
                  <th className="num">연봉</th>
                  <th className="num">남은 계약</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.releasable.map((p) => (
                  <tr key={p.playerId}>
                    <td>
                      {p.name} {p.origin !== 'domestic' && <span className="badge">{p.origin === 'asia' ? '아시아' : '외국인'}</span>}
                    </td>
                    <td>{POSITION_LABELS[p.position] ?? p.position}</td>
                    <td className="num">{p.age}</td>
                    <td>{p.level}</td>
                    <td className="num">{p.scoutGrade}</td>
                    <td className="num">{won(p.salaryWon)}</td>
                    <td className="num">{p.contractYears === 0 ? '만료' : `${p.contractYears}년`}</td>
                    <td>
                      <button
                        className="small"
                        onClick={() =>
                          window.confirm(`${p.name} 선수를 방출할까요?${p.contractYears > 0 ? ` 남은 ${p.contractYears}년치 연봉(연 ${won(p.salaryWon)})은 계속 지급합니다.` : ''}`) &&
                          void run(() => api('market.release', { playerId: p.playerId }))
                        }
                      >
                        방출
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
