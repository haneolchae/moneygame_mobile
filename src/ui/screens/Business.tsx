// 사업·시설(6a, D-141): 관중·티켓 가격 정책과 시설 투자. 가능 여부·비용·사유는 게임 로직(business.view)이 계산한 값을 그대로 보여 준다.
import { useEffect, useState } from 'react';
import type { BusinessView, FacilityKindView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { dateKo, won } from '../format';
import { Icon } from '../icons';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function Business({ nav }: { nav: Nav }) {
  const [v, setV] = useState<BusinessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<FacilityKindView | null>(null);
  const [result, setResult] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  useEffect(() => {
    api('business.view').then(setV).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);

  const run = async (fn: () => Promise<{ message: string; view: BusinessView }>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setV(r.view);
      setResult({ text: r.message, kind: 'ok' });
      setConfirm(null);
      await nav.sync();
    } catch (e) {
      setResult({ text: e instanceof ApiError ? e.message : String(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!v) return <div className="page muted">불러오는 중…</div>;
  const cur = v.seasons[0];
  return (
    <div className="page">
      <h1>
        사업·시설 <span className="muted small">{v.club.name} · 좌석 {v.club.capacity.toLocaleString('ko-KR')}석</span>
      </h1>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="kpi">
          <Icon name="do-roster" size={24} />
          <span className="label">{cur ? `${cur.season} 평균 관중` : '평균 관중'}</span>
          <span className="value">{cur ? `${cur.average.toLocaleString('ko-KR')}명` : '—'}</span>
        </div>
        <div className="kpi">
          <span className="label">좌석 점유율 (리그 평균 {pct(cur?.leagueOccupancy ?? null)})</span>
          <span className="value">{pct(cur?.occupancy ?? null)}</span>
        </div>
        <div className="kpi">
          <Icon name="do-finance" size={24} />
          <span className="label">{cur ? `${cur.season} 입장 수입` : '입장 수입'}</span>
          <span className="value">{cur ? won(cur.ticketWon) : '—'}</span>
        </div>
        <div className="kpi">
          <span className="label">팬 만족도 (0~100){v.fans.backlash ? ' · 팬 반발' : ''}</span>
          <span className="value" style={{ color: v.fans.backlash ? 'var(--do-danger)' : undefined }}>{v.fans.satisfaction.toFixed(1)}</span>
        </div>
        <div className="kpi">
          <span className="label">현금 (남은 공사 지급 {v.committedWon > 0 ? won(v.committedWon) : '없음'})</span>
          <span className="value">{won(v.cashWon)}</span>
        </div>
      </div>

      {result && (
        <p role="status" className={`action-result ${result.kind}`} style={{ color: result.kind === 'error' ? 'var(--do-danger)' : 'var(--do-mint)' }}>
          {result.kind === 'error' ? '실행하지 않음: ' : '결과: '}
          {result.text}
        </p>
      )}

      {v.fans.backlash && (
        <p className="reason" role="alert">
          <Icon name="do-warning" size={16} /> 팬 반발 상태입니다(관중 −20%).{v.fans.dismissDate ? ` ${dateKo(v.fans.dismissDate)}까지 만족도 ${v.fans.recoverAt} 이상으로 회복하지 못하면 해임됩니다.` : ''}
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>마케팅 캠페인</h2>
          <span className="meta">착수 행동력 {v.campaignAp} · 비용은 착수 때 지급 · 종류마다 1건 · 합계 상한 수요 +8%·만족도 목표 +8</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
          {v.campaigns.map((c) => (
            <div key={c.kind} className="approval-row" style={{ flexWrap: 'wrap' }}>
              <div className="txt">
                <strong>
                  {c.label} {c.active && <span className="badge rec">진행 중 ~{dateKo(c.active.end)}</span>}
                </strong>
                <div className="muted small">
                  {c.weeks}주 · {won(c.costWon)}
                  {c.demandPct > 0 ? ` · 관중 수요 +${c.demandPct}%` : ''}
                  {c.satisfaction > 0 ? ` · 만족도 목표 +${c.satisfaction}` : ''}
                </div>
                {!c.active && c.startReason && <div className="small reason">불가: {c.startReason}</div>}
              </div>
              {!c.active && (
                <button disabled={busy || !!c.startReason} onClick={() => void run(() => api('business.startCampaign', { kind: c.kind }))}>
                  실행 (행동력 {v.campaignAp})
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="panel-body muted small">
          팬 만족도는 시즌 중 매주 월요일 성적·충성도·캠페인으로 정한 목표 쪽으로 조금씩 움직이고, 관중 수요에 ±15%까지 반영됩니다. 캠페인이 끝나면 효과도 사라집니다.
        </div>
      </section>

      <div className="columns even">
        <section className="panel">
          <div className="panel-head">
            <h2>티켓 가격</h2>
            <span className="meta">변경은 행동력 0 · 다음 홈경기부터</span>
          </div>
          <div className="panel-body">
            <div className="seg" role="group" aria-label="티켓 가격 정책">
              {v.ticket.options.map((o) => (
                <button key={o.key} className={v.ticket.policy === o.key ? 'active' : ''} aria-pressed={v.ticket.policy === o.key} disabled={busy} onClick={() => v.ticket.policy !== o.key && void run(() => api('business.setTicketPolicy', { policy: o.key }))}>
                  {o.label} · 평균 {o.priceWon.toLocaleString('ko-KR')}원 · 수요 ×{o.demand}
                </button>
              ))}
            </div>
            <p className="muted small">
              관중은 시장 규모·팬 충성도·성적·요일·상대·가격·구장 편의시설로 정해지고 좌석 수를 넘지 않습니다. 매점 수입은 관중에 비례하고, 입장수입의 10%는 구장 관람료로 나갑니다.
            </p>
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>시즌</th>
                <th className="num">홈경기</th>
                <th className="num">관중 합계</th>
                <th className="num">평균</th>
                <th className="num">점유율</th>
                <th className="num">매진</th>
                <th className="num">입장 수입</th>
              </tr>
            </thead>
            <tbody>
              {v.seasons.map((s) => (
                <tr key={s.season}>
                  <td>{s.season}</td>
                  <td className="num">{s.games}</td>
                  <td className="num">{s.total.toLocaleString('ko-KR')}</td>
                  <td className="num">{s.average.toLocaleString('ko-KR')}</td>
                  <td className="num">{pct(s.occupancy)}</td>
                  <td className="num">{s.sellouts}</td>
                  <td className="num amount-pos">{won(s.ticketWon)}</td>
                </tr>
              ))}
              {v.seasons.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    아직 치른 홈경기가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>시설 투자</h2>
            <span className="meta">착수 행동력 {v.startAp} · 공사비는 착공 30%·중간 40%·완공 30% 지급 · 효과는 완공 뒤</span>
          </div>
          <div className="panel-body">
            {v.facilities.map((f) => (
              <div key={f.kind} className="approval-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                <div className="txt">
                  <strong>
                    {f.label} <span className="badge rec">{f.level}/{f.maxLevel}단계</span> {f.needsApproval && <span className="badge">지자체 승인 4주</span>}
                  </strong>
                  <div className="muted small">
                    {f.effect} · 유지비 연 {won(f.upkeepWon)}
                  </div>
                  {f.project && (
                    <div className="small">
                      {f.project.toLevel}단계 공사 {f.project.started ? '진행 중' : '착공 대기'} · {dateKo(f.project.start)} 착공 → {dateKo(f.project.end)} 완공 · 지급 {won(f.project.paidWon)} / {won(f.project.costWon)}
                    </div>
                  )}
                  {f.next && (
                    <div className="small">
                      다음 {f.next.level}단계: 공사비 {won(f.next.costWon)} · {f.next.weeks}주 · 착공 때 {won(f.next.firstPaymentWon)}
                      {f.startReason && <span className="reason"> · 불가: {f.startReason}</span>}
                    </div>
                  )}
                  {confirm === f.kind && f.next && (
                    <div className="offer-form confirm" style={{ marginTop: 6 }}>
                      <span>
                        {f.label} {f.next.level}단계 · 공사비 {won(f.next.costWon)} · {dateKo(f.next.startDate)} 착공 → {dateKo(f.next.endDate)} 완공
                      </span>
                      <button className="primary" disabled={busy} onClick={() => void run(() => api('business.startFacility', { kind: f.kind }))}>
                        착수 확정 (행동력 {v.startAp})
                      </button>
                      <button className="small" disabled={busy} onClick={() => setConfirm(null)}>
                        취소
                      </button>
                    </div>
                  )}
                </div>
                {f.next && confirm !== f.kind && (
                  <button disabled={busy || !!f.startReason} onClick={() => setConfirm(f.kind)}>
                    투자 검토
                  </button>
                )}
                {f.project && (
                  <button className="danger" disabled={busy} onClick={() => void run(() => api('business.cancelFacility', { kind: f.kind }))} title={f.project.paidWon > 0 ? '이미 지급한 공사비는 돌아오지 않습니다' : '착공 전 취소는 비용이 없습니다'}>
                    공사 취소
                  </button>
                )}
              </div>
            ))}
            <p className="muted small">시즌권·좌석 증설·시설 노후도·스폰서·굿즈는 다음 차수에서 추가됩니다.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
