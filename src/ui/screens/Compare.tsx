// 선수 비교(3e, 18a 3.1·D-122): 같은 시즌·같은 지표로 나란히 본다. 우리 선수는 실제 능력, 타 선수는 스카우트 추정 범위.
// 서버의 선수 상세 응답을 그대로 쓰므로 공개 규칙이 선수 상세와 같다. 비교 목록은 화면용 임시 선택이다.
import { useEffect, useState } from 'react';
import type { PlayerDetailView, StatValue } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { compareList } from '../compareList';
import { dateKo, fixed2, innings, int, POSITION_LABELS, RATING_LABELS, rate3, won } from '../format';
import { ratingText } from '../PlayerAbilities';

const HIT_KEYS = ['contact', 'eye', 'power', 'speed', 'def_fielding'];
const PIT_KEYS = ['stuff', 'control', 'groundball', 'stamina'];

export function Compare({ nav }: { nav: Nav }) {
  const [ids, setIds] = useState<number[]>(compareList.ids);
  const [rows, setRows] = useState<PlayerDetailView[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    compareList.ids = ids;
    Promise.all(ids.map((playerId) => api('game.player', { playerId })))
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [ids]);

  if (ids.length === 0)
    return (
      <div className="page">
        <h1>선수 비교</h1>
        <p className="muted">선수 상세의 [비교에 추가]로 최대 4명까지 고를 수 있습니다. 비교 목록은 세이브에 저장하지 않습니다.</p>
      </div>
    );
  const anyHitter = rows.some((p) => !p.isPitcher);
  const anyPitcher = rows.some((p) => p.isPitcher);
  const stat = (p: PlayerDetailView, key: string, f: (v: StatValue | undefined) => string, pitcher: boolean) => {
    const s = pitcher ? p.pitchingStats : p.battingStats;
    return s ? f(s[key]) : '—';
  };
  const line = (label: string, f: (p: PlayerDetailView) => string) => (
    <tr key={label}>
      <th>{label}</th>
      {rows.map((p) => (
        <td key={p.id} className="num">
          {f(p)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="page">
      <h1>
        선수 비교 <span className="muted small">{rows.length}명 · 행동력 0 · 우리 선수 = 실제 능력, 타 선수 = 우리 스카우트 추정 범위</span>
      </h1>
      {error && <p role="alert">{error}</p>}
      <div className="toolbar">
        <button onClick={() => setIds([])}>비교 목록 비우기</button>
      </div>
      <div className="table-wrap">
        <table className="grid dense">
          <thead>
            <tr>
              <th />
              {rows.map((p) => (
                <th key={p.id}>
                  <span className="clickable" onClick={() => nav.go({ name: 'player', playerId: p.id, list: ids, back: { name: 'compare' } })}>
                    {p.name}
                  </span>{' '}
                  <button className="small" onClick={() => setIds(ids.filter((x) => x !== p.id))}>
                    빼기
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line('소속', (p) => p.club?.shortName ?? 'FA')}
            {line('포지션', (p) => POSITION_LABELS[p.position] ?? p.position)}
            {line('나이·투타', (p) => `${p.age}세 · ${p.throws}투 ${p.bats === 'S' ? '양' : p.bats}타`)}
            {line('연봉·계약', (p) => `${won(p.salaryWon)} · ${p.contractYears === 0 ? '만료' : `${p.contractYears}년`}`)}
            {line('능력 근거', (p) => (p.exactRatings ? '실제 능력' : `추정 · 신뢰도 ${p.scouting.confidence} · ${p.scouting.confidence > 0 ? dateKo(p.scouting.date) : '조사 전'}${p.scouting.confidence > 0 && p.scouting.stale ? ' (오래됨)' : ''}`))}
            {anyHitter && HIT_KEYS.map((k) => line(RATING_LABELS[k] ?? k, (p) => (p.isPitcher ? '—' : ratingText(p, k))))}
            {anyPitcher && PIT_KEYS.map((k) => line(RATING_LABELS[k] ?? k, (p) => (p.isPitcher ? ratingText(p, k) : '—')))}
            {anyHitter && (
              <>
                {line('타석', (p) => stat(p, 'PA', int, false))}
                {line('타율', (p) => stat(p, 'AVG', rate3, false))}
                {line('출루율', (p) => stat(p, 'OBP', rate3, false))}
                {line('장타율', (p) => stat(p, 'SLG', rate3, false))}
                {line('OPS', (p) => stat(p, 'OPS', rate3, false))}
                {line('홈런', (p) => stat(p, 'HR', int, false))}
              </>
            )}
            {anyPitcher && (
              <>
                {line('이닝', (p) => stat(p, 'IP', innings, true))}
                {line('평균자책', (p) => stat(p, 'ERA', fixed2, true))}
                {line('WHIP', (p) => stat(p, 'WHIP', fixed2, true))}
                {line('K/9', (p) => stat(p, 'K/9', fixed2, true))}
                {line('BB/9', (p) => stat(p, 'BB/9', fixed2, true))}
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">시즌 기록은 이번 시즌 정규시즌 1군 기록입니다(시범경기·포스트시즌 제외). 추정 범위는 실제 능력을 반드시 포함하지는 않습니다.</p>
    </div>
  );
}
