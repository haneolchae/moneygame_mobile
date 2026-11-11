// 7b(D-157): 받은 트레이드 제안, 재임 기록, 해임·파산 알림(재임 요약·영입 제안).
// 값은 모두 게임 쪽 응답을 그대로 보여 준다. 상대 선수 능력은 스카우트 추정 범위만 온다.
import { useCallback, useEffect, useState } from 'react';
import type { CareerView, DashboardView, PlayerListItem, TenureView, TradeOffersView } from '../shared/protocol';
import type { Nav } from './App';
import { api, ApiError } from './api';
import { dateKo, POSITION_LABELS, won } from './format';
import { ratingText } from './PlayerAbilities';

const newCommandId = () => globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function playerLine(p: PlayerListItem) {
  const keys = p.isPitcher ? ['stuff', 'control'] : ['contact', 'power'];
  return `${POSITION_LABELS[p.position] ?? p.position} · ${p.age}세 · 연봉 ${won(p.salaryWon)} · ${p.contractYears === 0 ? '계약 만료' : `계약 ${p.contractYears}년`} · 주요 능력 ${keys.map((k) => ratingText(p, k)).join(' / ')}`;
}

/** 계약·이적 화면 위: AI 구단이 먼저 보낸 제안. 없으면 그리지 않는다 */
export function TradeOffersPanel({ nav }: { nav: Nav }) {
  const [v, setV] = useState<TradeOffersView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('trade.offers')
      .then(setV)
      .catch(() => setV(null));
  }, [nav.refreshKey]);
  const respond = useCallback(
    async (offerId: number, accept: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        const r = await api('trade.respondOffer', { offerId, accept, commandId: newCommandId() });
        setV(r.view);
        nav.notify(r.message, r.result === 'accept' || !accept ? 'info' : 'error');
        await nav.sync();
      } catch (e) {
        nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, nav],
  );
  if (!v || v.offers.length === 0) return null;
  return (
    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <h2>받은 트레이드 제안</h2>
        <span className="meta">수락은 그 주 협상 비용(행동력 1, 이미 협상 중이면 0) · 거절 무료 · 남은 행동력 {v.apRemaining}</span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>구단</th>
            <th>우리가 보냄</th>
            <th>우리가 받음 (스카우트 추정)</th>
            <th>기한</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {v.offers.map((o) => (
            <tr key={o.id}>
              <td>
                <span className="clickable" onClick={() => nav.go({ name: 'club', clubId: o.club.id })}>
                  {o.club.name}
                </span>
                {o.stance && <div className="muted small">{o.stance}</div>}
              </td>
              {[o.give, o.get].map((list, i) => (
                <td key={i}>
                  {list.map((p) => (
                    <div key={p.id}>
                      <span className="clickable" onClick={() => nav.go({ name: 'player', playerId: p.id })}>
                        {p.name}
                      </span>{' '}
                      {p.healthStatus && <span className="badge req">{p.healthStatus}</span>}
                      <div className="muted small">{playerLine(p)}</div>
                    </div>
                  ))}
                </td>
              ))}
              <td>{dateKo(o.expires)}</td>
              <td>
                <button className="primary small" disabled={busy || v.apRemaining < o.apCost} title={v.apRemaining < o.apCost ? '이번 주 행동력이 부족합니다' : ''} onClick={() => void respond(o.id, true)}>
                  수락 (행동력 {o.apCost})
                </button>{' '}
                <button className="small" disabled={busy} onClick={() => void respond(o.id, false)}>
                  거절
                </button>{' '}
                <button className="small" onClick={() => nav.go({ name: 'trade', clubId: o.club.id })}>
                  협상 화면
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TenureTable({ tenures }: { tenures: TenureView[] }) {
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>구단</th>
          <th>재임</th>
          <th>시즌별 순위</th>
          <th className="num">포스트시즌</th>
          <th className="num">우승</th>
          <th className="num">현금 (시작 → 종료·현재)</th>
          <th>종료 사유</th>
        </tr>
      </thead>
      <tbody>
        {tenures.map((t, i) => (
          <tr key={i}>
            <td>{t.club.name}</td>
            <td>
              {dateKo(t.from)} ~ {t.to ? dateKo(t.to) : '현재'}
            </td>
            <td>{t.seasons.length ? t.seasons.map((s) => `${s.season} ${s.rank}위(${s.wins}승 ${s.losses}패${s.postseason ? `, ${s.postseason}` : ''})`).join(' · ') : '끝난 정규시즌 없음'}</td>
            <td className="num">{t.postseasons}회</td>
            <td className="num">{t.titles}회</td>
            <td className="num">
              {won(t.startCashWon)} → {won(t.endCashWon)}
            </td>
            <td>{t.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 팀 기록 화면: 재임 기록 */
export function CareerPanel({ refreshKey }: { refreshKey: number }) {
  const [v, setV] = useState<CareerView | null>(null);
  useEffect(() => {
    api('owner.career')
      .then(setV)
      .catch(() => setV(null));
  }, [refreshKey]);
  if (!v) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>재임 기록</h2>
        <span className="meta">구단주 Lv.{v.level}</span>
      </div>
      <TenureTable tenures={v.tenures} />
    </section>
  );
}

/** 해임·파산 알림: 사유, 재임 요약, 해임이면 영입 제안 */
export function GameOverPanel({ nav, gameOver }: { nav: Nav; gameOver: NonNullable<DashboardView['gameOver']> }) {
  const [v, setV] = useState<CareerView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('owner.career')
      .then(setV)
      .catch(() => setV(null));
  }, [gameOver.date]);
  const accept = async (clubId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api('owner.acceptJob', { clubId });
      nav.setDashboard(d);
      nav.go({ name: 'dashboard' });
      await nav.refresh();
      nav.notify("새 구단에 부임했습니다.");
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const dismissed = gameOver.kind === 'dismissed';
  return (
    <div className="panel" style={{ borderColor: 'var(--error)', marginBottom: 14 }}>
      <div className="panel-head" style={{ background: 'var(--error)' }}>
        <h2>{dismissed ? '해임되었습니다' : '구단이 파산했습니다'}</h2>
        <span className="meta" style={{ color: 'var(--text)' }}>
          {gameOver.date}
        </span>
      </div>
      <div className="panel-body">{gameOver.reason}</div>
      {v && <TenureTable tenures={v.tenures} />}
      <div className="panel-body">
        {!dismissed && '파산한 게임은 이어서 할 수 없습니다. 새 게임으로 다시 시작할 수 있습니다.'}
        {dismissed && v && v.jobOffers.length === 0 && '영입 제안이 없습니다. 새 게임으로 다시 시작할 수 있습니다.'}
        {dismissed && v && v.jobOffers.length > 0 && (
          <>
            <h3>영입 제안 {v.jobOffers.length}건 (수락 행동력 0 · 구단주 레벨 유지)</h3>
            <div className="toolbar">
              {v.jobOffers.map((o) => (
                <button key={o.club.id} className="primary" disabled={busy} onClick={() => void accept(o.club.id)}>
                  {o.club.name} 부임 · {o.city} · 기준 순위 {o.rank ?? '—'}위{o.stance ? ` · ${o.stance}` : ''} · 연봉 합계 {won(o.payrollWon)}
                </button>
              ))}
            </div>
            <p className="muted small">새 구단의 선수단·계약·직원·시설·현금을 그대로 넘겨받습니다. 성적 목표 연속 미달과 진행 중이던 협상·위임 업무는 초기화됩니다.</p>
          </>
        )}
      </div>
    </div>
  );
}
