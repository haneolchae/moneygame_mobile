import { useEffect, useState } from 'react';
import type { StandingView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { rate3 } from '../format';
import { PostseasonBracket } from '../PostseasonBracket';

export function Standings({ nav }: { nav: Nav }) {
  const [rows, setRows] = useState<StandingView[]>([]);
  useEffect(() => {
    api('game.standings').then(setRows).catch((e: Error) => nav.notify(e.message, 'error'));
  }, [nav]);
  const mine = nav.dashboard?.userClub.id;
  return (
    <div className="page">
      <h1>{nav.dashboard?.standingsTitle}</h1>
      {nav.dashboard?.postseason && <PostseasonBracket ps={nav.dashboard.postseason} userClubId={nav.dashboard.userClub.id} />}
      <table className="grid">
        <thead>
          <tr>
            <th>순위</th><th>구단</th><th className="num">경기</th><th className="num">승</th><th className="num">패</th><th className="num">무</th>
            <th className="num" title="승 / (승 + 패), 무승부 제외">승률</th><th className="num">게임차</th><th className="num">득점</th><th className="num">실점</th><th className="num">득실</th><th>최근 10경기</th><th>연속·포스트시즌</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.club.id} className={`${s.club.id === mine ? 'mine' : ''} ${s.rank === 5 ? 'cutline' : ''}`}>
              <td>{s.rank}</td>
              <td>{s.club.name}</td>
              <td className="num">{s.games}</td>
              <td className="num">{s.wins}</td>
              <td className="num">{s.losses}</td>
              <td className="num">{s.ties}</td>
              <td className="num">{rate3(s.pct)}</td>
              <td className="num">{s.gamesBehind === 0 ? '—' : s.gamesBehind.toFixed(1)}</td>
              <td className="num">{s.runsFor ?? '—'}</td>
              <td className="num">{s.runsAgainst ?? '—'}</td>
              <td className="num">{s.runsFor === null || s.runsAgainst === null ? '—' : `${s.runsFor - s.runsAgainst > 0 ? '+' : ''}${s.runsFor - s.runsAgainst}`}</td>
              <td>{s.last10 || '—'}</td>
              <td>{s.streak || s.postseason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">굵은 선 위 5개 팀이 포스트시즌 진출권입니다. 스토브리그·개막 전에는 직전 시즌 최종 순위(실제 2026 KBO 결과 반영)를 보여줍니다. 동률은 상대 전적 → 득실차 순으로 정합니다. 1위·5위 결정전은 아직 없습니다(동률은 위 기준으로 정함). 포스트시즌 기록은 정규시즌 순위·통계에 넣지 않습니다.</p>
    </div>
  );
}
