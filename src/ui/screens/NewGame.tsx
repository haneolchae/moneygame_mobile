import { useEffect, useState } from 'react';
import type { ClubOption } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { Emblem } from '../Emblem';
import { won } from '../format';

export function NewGame({ nav }: { nav: Nav }) {
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubId, setClubId] = useState<number | null>(null);
  const [saveName, setSaveName] = useState('나의 구단');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api('game.clubOptions').then(setClubs).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);

  const start = async () => {
    if (!clubId) return;
    setCreating(true);
    try {
      nav.setDashboard(await api('game.new', { clubId, saveName }));
      nav.go({ name: 'dashboard' });
    } catch (e) {
      nav.notify((e as Error).message, 'error');
      setCreating(false);
    }
  };

  return (
    <div className="start wide">
      <h1>새 게임 — 구단 선택</h1>
      <p className="muted">
        2027년 2월 1일 스프링캠프에서 구단주로 취임합니다. 첫 스토브리그(2026년 11월~2027년 1월)는 전임 경영진이 꾸렸고, 결과는 「지난겨울 보고서」로 넘겨받습니다. 구단마다 시작 자금, 모기업 지원, 시장 규모, 팬 충성도, 시작 전력이 다르고, 구단 선택이 곧 난이도 선택입니다.
      </p>
      <table className="grid selectable" style={{ background: 'var(--paper)' }}>
        <thead>
          <tr>
            <th>구단</th><th>2026 시즌</th><th>난이도</th><th>연고지·구장</th><th className="num">좌석</th><th>모기업</th>
            <th className="num">시작 자금</th><th className="num">모기업 지원(연)</th><th className="num">시장 규모</th><th>팬 충성도</th><th>시작 전력</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((c) => (
            <tr key={c.id} className={clubId === c.id ? 'selected' : ''} onClick={() => setClubId(c.id)}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Emblem club={c} size={34} />
                  <div>
                    <strong>{c.name}</strong>
                    <div className="muted small">
                      {c.colors}
                      {c.founded ? ` · ${c.founded}년 창단` : ''}
                      {c.ksTitles ? ` · 우승 ${c.ksTitles}회` : ''}
                    </div>
                  </div>
                </div>
              </td>
              <td>{c.lastSeason}</td>
              <td><span className={`badge diff-${c.difficulty.replace(' ', '')}`}>{c.difficulty}</span></td>
              <td>{c.stadium}</td>
              <td className="num">{c.stadiumCapacity.toLocaleString('ko-KR')}</td>
              <td>{c.parentIndustry}</td>
              <td className="num">{won(c.startCashWon)}</td>
              <td className="num">{c.parentSupportWon > 0 ? won(c.parentSupportWon) : `없음 (명명권 ${won(c.namingRightsWon)})`}</td>
              <td className="num">{c.marketSize.toFixed(1)}</td>
              <td>{c.loyalty}</td>
              <td>{c.strength}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">2026 시즌 순위와 한국시리즈 결과는 실제 KBO 결과를 가상 구단에 대응시킨 것입니다. 시작 전력은 이 순위에 맞춰 선수 능력 분포에 반영됩니다.</p>
      <div className="row">
        <label>
          저장 이름 <input value={saveName} maxLength={40} onChange={(e) => setSaveName(e.target.value)} />
        </label>
        <button onClick={() => nav.go({ name: 'start' })}>뒤로</button>
        <button className="primary" disabled={!clubId || creating} onClick={start}>
          {creating ? '세계 생성 중…' : '이 구단으로 시작'}
        </button>
      </div>
    </div>
  );
}
