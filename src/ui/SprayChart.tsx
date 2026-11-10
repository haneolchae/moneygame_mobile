// 스프레이 차트: 10b 구역(방향 7 × 깊이 4)별 인플레이 타구 수·안타율. 홈런·파울 뜬공은 그림 밖에 따로 적는다.
import { useState } from 'react';
import type { SprayView } from '../shared/protocol';
import { rate3 } from './format';

const DEPTHS = [
  { key: 'IN', label: '내야', r0: 0, r1: 72 },
  { key: 'SH', label: '얕은 외야', r0: 72, r1: 132 },
  { key: 'DP', label: '깊은 외야', r0: 132, r1: 182 },
  { key: 'WL', label: '펜스 앞', r0: 182, r1: 206 },
] as const;
const DIR_LABELS = ['좌측 선상', '좌중간 쪽 좌측', '좌중간', '중앙', '우중간', '우중간 쪽 우측', '우측 선상'];
const HOME = { x: 160, y: 222 };
/** 안타율이 의미 있다고 보는 최소 타구 수(이보다 적으면 회색) */
const MIN_BALLS_FOR_RATE = 5;

const point = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(HOME.x + r * Math.sin(a)).toFixed(1)},${(HOME.y - r * Math.cos(a)).toFixed(1)}`;
};
const angleOf = (dir: number) => [-45 + ((dir - 1) * 90) / 7, -45 + (dir * 90) / 7] as const;

function cellPath(dir: number, r0: number, r1: number): string {
  const [a0, a1] = angleOf(dir);
  if (r0 === 0) return `M${HOME.x},${HOME.y} L${point(a0, r1)} A${r1},${r1} 0 0 1 ${point(a1, r1)} Z`;
  return `M${point(a0, r0)} L${point(a0, r1)} A${r1},${r1} 0 0 1 ${point(a1, r1)} L${point(a1, r0)} A${r0},${r0} 0 0 0 ${point(a0, r0)} Z`;
}

type Metric = 'balls' | 'rate';

export function SprayChart({ spray }: { spray: SprayView }) {
  const [metric, setMetric] = useState<Metric>('balls');
  const byZone = new Map(spray.zones.map((z) => [z.zone, z]));
  const maxN = Math.max(1, ...spray.zones.filter((z) => !z.zone.startsWith('FO')).map((z) => z.n));
  const foul = (side: string) => byZone.get(`FO-${side}`)?.n ?? 0;
  const typeLabel = { GB: '땅볼', LD: '라인드라이브', FB: '뜬공' } as const;
  return (
    <div className="spray">
      <div className="seg" style={{ marginBottom: 6 }}>
        <button className={metric === 'balls' ? 'active' : ''} onClick={() => setMetric('balls')}>타구 수</button>
        <button className={metric === 'rate' ? 'active' : ''} onClick={() => setMetric('rate')}>안타율</button>
      </div>
      <svg viewBox="0 0 320 232" width="100%" style={{ maxWidth: 420 }} role="img" aria-label={`${spray.season} 시즌 스프레이 차트`}>
        {DEPTHS.map((d) =>
          [1, 2, 3, 4, 5, 6, 7].map((dir) => {
            const z = byZone.get(`S${dir}-${d.key}`);
            const n = z?.n ?? 0;
            const rate = z && n > 0 ? z.h / n : null;
            const enough = n >= MIN_BALLS_FOR_RATE;
            const alpha = metric === 'balls' ? (n / maxN) * 0.85 : rate !== null && enough ? Math.min(1, rate / 0.6) * 0.85 : 0;
            const fill = metric === 'rate' && n > 0 && !enough ? 'rgba(156,178,201,0.12)' : `rgba(103,231,205,${alpha.toFixed(3)})`;
            const [a0, a1] = angleOf(dir);
            const mid = (a0 + a1) / 2;
            const rText = d.r0 === 0 ? 56 : (d.r0 + d.r1) / 2;
            const [tx, ty] = point(mid, rText).split(',');
            const text = n === 0 ? '' : metric === 'balls' ? String(n) : enough ? rate3(rate) : '';
            return (
              <g key={`${dir}-${d.key}`}>
                <path d={cellPath(dir, d.r0, d.r1)} fill={fill} stroke="#30455c" strokeWidth={1}>
                  <title>{`${DIR_LABELS[dir - 1]} · ${d.label}: 타구 ${n}${z ? ` · 안타 ${z.h}(장타 ${z.xbh}) · 안타율 ${rate3(rate)}` : ''}`}</title>
                </path>
                {text && (
                  <text x={tx} y={ty} fontSize={d.key === 'WL' ? 8 : 9} textAnchor="middle" dominantBaseline="middle" fill={alpha > 0.5 ? '#062a28' : '#dbe8f3'} pointerEvents="none">
                    {text}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
      <p className="muted small">
        {spray.season} 시즌 정규시즌 인플레이 타구 {spray.balls}개(홈런 제외, 수비 기준 방향: 왼쪽이 3루 쪽). 파울 지역 뜬공: 좌 {foul('L')} · 포수 뒤 {foul('C')} · 우 {foul('R')}.
        {metric === 'rate' && ` 타구 ${MIN_BALLS_FOR_RATE}개 미만 구역은 안타율을 표시하지 않습니다.`}
      </p>
      <p className="small">
        {spray.types.map((t) => `${typeLabel[t.type]} ${t.n}개(안타율 ${rate3(t.n > 0 ? t.h / t.n : null)})`).join(' · ')}
      </p>
    </div>
  );
}
