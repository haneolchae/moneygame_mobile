// 구단 엠블럼: 가상 구단의 상징색과 이름 첫 글자로 그린 방패. 실제 구단 로고를 쓰지 않는다(D-032).
import type { ClubRef } from '../shared/protocol';

export function Emblem({ club, size = 44 }: { club: Pick<ClubRef, 'shortName' | 'primaryColor' | 'secondaryColor'>; size?: number }) {
  const initial = club.shortName.slice(0, 1);
  const light = club.secondaryColor.toUpperCase() === '#FFFFFF' || club.secondaryColor.toUpperCase() === '#FFC72C' || club.secondaryColor.toUpperCase() === '#C0C0C0' || club.secondaryColor.toUpperCase() === '#C8A165' || club.secondaryColor.toUpperCase() === '#C9A24B';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-label={`${club.shortName} 엠블럼`} role="img">
      <path d="M24 3l17 6v13c0 11-7.5 19-17 23C14.5 41 7 33 7 22V9z" fill={club.primaryColor} stroke={club.secondaryColor} strokeWidth="2.5" />
      <path d="M24 9l11 4v9c0 7.4-4.8 12.8-11 15.6C17.8 34.8 13 29.4 13 22v-9z" fill="none" stroke={club.secondaryColor} strokeOpacity="0.55" strokeWidth="1.2" />
      <text x="24" y="30" textAnchor="middle" fontSize="16" fontWeight="800" fill={light ? club.secondaryColor : '#FFFFFF'} fontFamily="'Malgun Gothic', sans-serif">
        {initial}
      </text>
    </svg>
  );
}
