// 다음 경기 카드(D-140 MatchCard): 구단 현황과 일정이 같이 쓴다. DashboardView.nextGame만 표시하고 따로 조회·명령하지 않는다.
// 다음 경기가 없거나 예상 선발이 미정이면 그대로 알린다. 배경 그림은 장식이라 접근성 트리에서 뺀다.
import type { DashboardView } from '../shared/protocol';
import type { Nav, Route } from './App';
import stadium from './assets/diamond-office/stadium_lights.svg';
import { Emblem } from './Emblem';
import { dateKo } from './format';
import { Icon } from './icons';

export function NextGameCard({ d, nav, back }: { d: DashboardView; nav: Nav; back: Route }) {
  const g = d.nextGame;
  if (!g) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>다음 경기</h2>
          <span className="meta">{d.phase === 'stove' ? '스토브리그' : `개막 ${dateKo(d.openingDay)}`}</span>
        </div>
        <div className="panel-body muted">예정된 경기가 없습니다.</div>
      </section>
    );
  }
  const f = g.fixture;
  const home = f.home.id === d.userClub.id;
  return (
    <section className="panel match-card" style={{ backgroundImage: `linear-gradient(rgba(16,32,51,0.35), rgba(16,32,51,0.92)), url(${stadium})` }}>
      <div className="panel-head">
        <h2>다음 경기</h2>
        <span className="meta">
          {f.stageLabel ?? (d.phase === 'preseason' ? '정규시즌 개막전' : '정규시즌')} | {dateKo(f.date)} | {f.home.name} 홈 ({home ? '우리 구장' : '원정'})
        </span>
      </div>
      <div className="matchup">
        <div className="team">
          <Emblem club={f.away} size={72} />
          <div>
            <strong>{f.away.name}</strong>
            <span className="muted">({g.awayRecord || '첫 경기'})</span>
          </div>
        </div>
        <div className="vs">VS</div>
        <div className="team away">
          <Emblem club={f.home} size={72} />
          <div>
            <strong>{f.home.name}</strong>
            <span className="muted">({g.homeRecord || '첫 경기'})</span>
          </div>
        </div>
      </div>
      <div className="starters">
        {[g.awayStarter, g.homeStarter].map((s, i) => (
          <div key={i} className="starter" onClick={() => s && nav.go({ name: 'player', playerId: s.id, back })} style={{ cursor: s ? 'pointer' : 'default' }}>
            <div className="portrait">
              <Icon name="users" size={30} />
            </div>
            <div>
              <span className="tag">예상 선발</span> <strong>{s?.name ?? '미정'}</strong> {s && <span className="muted">({s.throws})</span>}
              <div className="muted small">{s?.line ?? '로테이션이 정해지지 않았습니다.'}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-body muted small">{home ? '홈 경기' : '원정 경기'} · 예상 선발은 로테이션 기준이며 경기 당일 바뀔 수 있습니다.</div>
    </section>
  );
}
