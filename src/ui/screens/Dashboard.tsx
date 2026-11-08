// 구단 현황 (레퍼런스 화면 구성, D-073): 핵심 지표 줄 · 다음 경기(또는 스토브리그 일정) · 주요 선수 · 리그 순위 · 확인할 업무
import type { DashboardView, TaskView } from '../../shared/protocol';
import type { Nav } from '../App';
import { Emblem } from '../Emblem';
import { dateKo, int, POSITION_LABELS, rate3, shortDate, won } from '../format';
import { Icon } from '../icons';
import { PostseasonBracket } from '../PostseasonBracket';

const TASK_ICON: Record<string, string> = { inbox: 'mail', players: 'users', finance: 'coins', schedule: 'calendar', standings: 'chart', market: 'handshake', org: 'org', draft: 'star' };
const LEVEL_CLASS: Record<TaskView['level'], string> = { 필수: 'req', 권장: 'rec', 선택: 'opt', 정보: 'opt' };

function Kpis({ d }: { d: DashboardView }) {
  const r = d.userRecord;
  const inSeason = d.phase === 'regular' || d.phase === 'postseason' || d.phase === 'seasonComplete';
  return (
    <div className="kpis">
      <div className="kpi">
        <Icon name="trophy" size={26} />
        <span className="label">{inSeason ? '리그' : '지난 시즌'}</span>
        <span className="value">{r ? `${r.rank}위` : '—'}</span>
      </div>
      <div className="kpi">
        <Icon name="ball" size={26} />
        <span className="value">{r ? `${r.wins}승 ${r.losses}패` : '—'}</span>
      </div>
      <div className="kpi">
        <Icon name="coins" size={26} />
        <span className="label">현금</span>
        <span className="value">{won(d.cashWon)}</span>
      </div>
      <div className="kpi">
        <Icon name="users" size={26} />
        <span className="label">선수단</span>
        <span className="value">{d.rosterCount}명</span>
      </div>
      <div className="kpi">
        <Icon name="bolt" size={26} />
        <span className="label">행동력</span>
        <span className="value">
          {d.owner.apRemaining}/{d.owner.apGranted}
        </span>
      </div>
    </div>
  );
}

function NextGame({ d, nav }: { d: DashboardView; nav: Nav }) {
  const g = d.nextGame;
  if (!g) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>다음 경기</h2>
          <span className="meta">개막 {dateKo(d.openingDay)}</span>
        </div>
        <div className="panel-body muted">예정된 경기가 없습니다.</div>
      </section>
    );
  }
  const f = g.fixture;
  const home = f.home.id === d.userClub.id;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>다음 경기</h2>
        <span className="meta">
          {d.phase === 'preseason' ? '정규시즌 개막전' : '정규시즌'} | {dateKo(f.date)} | {f.home.name} 홈 ({f.home.shortName === d.userClub.shortName ? '우리 구장' : '원정'})
        </span>
      </div>
      <div className="matchup">
        <div className="team">
          <Emblem club={f.away} size={78} />
          <div>
            <strong>{f.away.name}</strong>
            <span className="muted">({g.awayRecord || '첫 경기'})</span>
          </div>
        </div>
        <div className="vs">VS</div>
        <div className="team away">
          <Emblem club={f.home} size={78} />
          <div>
            <strong>{f.home.name}</strong>
            <span className="muted">({g.homeRecord || '첫 경기'})</span>
          </div>
        </div>
      </div>
      <div className="starters">
        {[g.awayStarter, g.homeStarter].map((s, i) => (
          <div key={i} className="starter" onClick={() => s && nav.go({ name: 'player', playerId: s.id })} style={{ cursor: s ? 'pointer' : 'default' }}>
            <div className="portrait">
              <Icon name="users" size={30} />
            </div>
            <div>
              <span className="tag">예상 선발</span> <strong>{s?.name ?? '미정'}</strong> <span className="muted">({s?.throws})</span>
              <div className="muted small">{s?.line}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-body muted small">{home ? '홈 경기' : '원정 경기'} · 예상 선발은 로테이션 기준이며 경기 당일 바뀔 수 있습니다.</div>
    </section>
  );
}

function StoveWeek({ d }: { d: DashboardView }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>이번 주 스토브리그</h2>
        <span className="meta">
          {d.owner.weekLabel} | 개막 {dateKo(d.openingDay)}
        </span>
      </div>
      <div className="panel-body">
        <ul className="timeline">
          {d.upcomingEvents.slice(0, 8).map((e) => (
            <li key={e.date + e.kind}>
              <span className="when">{shortDate(e.date)}</span>
              <span>
                <strong>{e.title}</strong>
                <div className="muted small">{e.body}</div>
              </span>
            </li>
          ))}
          {d.upcomingEvents.length === 0 && <li className="muted">다가오는 리그 일정이 없습니다.</li>}
        </ul>
      </div>
    </section>
  );
}

export function Dashboard({ nav }: { nav: Nav }) {
  const d = nav.dashboard!;
  const inSeason = d.phase === 'regular' || d.phase === 'postseason' || d.phase === 'seasonComplete';
  return (
    <div className="page">
      <h1>구단 현황</h1>
      <Kpis d={d} />
      <div className="columns">
        <div>
          {d.postseason && <PostseasonBracket ps={d.postseason} userClubId={d.userClub.id} />}
          {d.phase === 'stove' ? <StoveWeek d={d} /> : <NextGame d={d} nav={nav} />}
          <section className="panel">
            <div className="panel-head">
              <h2>주요 선수단 현황</h2>
              <span className="meta">1군 주요 타자 {inSeason ? '(OPS 순)' : '(스카우트 평가 장타력 순)'}</span>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>선수</th>
                  <th>포지션</th>
                  <th className="num">나이</th>
                  <th className="num">컨택</th>
                  <th className="num">장타</th>
                  <th className="num">타율</th>
                  <th className="num">OPS</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {d.keyPlayers.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav.go({ name: 'player', playerId: p.id })}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      {p.position} ({POSITION_LABELS[p.position] ?? p.position})
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">{int(p.ratings.contact)}</td>
                    <td className="num">{int(p.ratings.power)}</td>
                    <td className="num">{rate3(p.stats.AVG)}</td>
                    <td className="num">{rate3(p.stats.OPS)}</td>
                    <td>
                      {p.franchise && <span className="badge star">간판</span>} {p.faEligible && <span className="badge fa">FA 자격</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>리그 순위</h2>
              <span className="meta">{d.standingsTitle}</span>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>팀</th>
                  <th className="num">승</th>
                  <th className="num">패</th>
                  <th className="num">승률</th>
                  <th className="num">게임차</th>
                </tr>
              </thead>
              <tbody>
                {d.standings.map((s) => (
                  <tr key={s.club.id} className={s.club.id === d.userClub.id ? 'mine' : ''} onClick={() => nav.go({ name: 'standings' })}>
                    <td>{s.rank}</td>
                    <td>
                      {s.club.name}
                      {s.postseason === '한국시리즈 우승' ? ' 🏆' : ''}
                    </td>
                    <td className="num">{s.wins}</td>
                    <td className="num">{s.losses}</td>
                    <td className="num">{rate3(s.pct)}</td>
                    <td className="num">{s.gamesBehind === 0 ? '-' : s.gamesBehind.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>확인할 업무</h2>
              <span className="meta">비서 정리</span>
            </div>
            <div className="panel-body">
              <ul className="tasks">
                {d.tasks.map((t, i) => (
                  <li key={i} onClick={() => t.target && nav.go({ name: t.target })}>
                    <span className="ico">
                      <Icon name={TASK_ICON[t.target ?? ''] ?? 'file'} />
                    </span>
                    <div className="txt">
                      <strong>
                        {t.title} <span className={`badge ${LEVEL_CLASS[t.level]}`}>{t.level}</span>
                        {t.due && <span className="muted small">{shortDate(t.due)}</span>}
                      </strong>
                      <div title={t.detail}>{t.detail}</div>
                    </div>
                    <Icon name="chevron" />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
