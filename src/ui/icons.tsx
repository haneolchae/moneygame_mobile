// 간단한 선 아이콘 모음 (외부 아이콘 라이브러리 없이 SVG로 그린다).
import type { ReactElement } from 'react';

const paths: Record<string, ReactElement> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 14.6c2.7.2 4.6 1.9 5.3 5.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  coins: (
    <>
      <ellipse cx="9" cy="7" rx="6" ry="2.5" />
      <path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M3 11v4c0 1.4 2.7 2.5 6 2.5" />
      <ellipse cx="16" cy="15" rx="5" ry="2.2" />
      <path d="M11 15v3c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-3" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M8 3v5h7V3M8 21v-7h8v7" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.5 5.5c2 2 2.5 4 2.5 6.5s-.5 4.5-2.5 6.5M17.5 5.5c-2 2-2.5 4-2.5 6.5s.5 4.5 2.5 6.5" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8 13h8M8 17h6" />
    </>
  ),
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  handshake: (
    <>
      <path d="M2 12l4-5 4 2 3-2 5 2 4 4" />
      <path d="M6 7l-4 5 6 6 3-1 2 2 2-1 2 1 5-6" />
      <path d="M10 9l-2 3 2 2 3-3" />
    </>
  ),
  org: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  play: <path d="M7 4l12 8-12 8z" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
};

/**
 * Diamond Office 에셋 키트 아이콘(D-140, diamond_office_ui_assets_v1/assets/icons, 128 격자).
 * 키트 SVG의 고정 밝은 stroke 대신 currentColor로 그려 테마 색을 따르게 한다.
 */
const kit: Record<string, ReactElement> = {
  'do-home': <path d="m18 54 46-38 46 38M32 51v57h64V51M54 108V74h20v34" />,
  'do-roster': (
    <>
      <circle cx="47" cy="39" r="17" />
      <circle cx="85" cy="47" r="14" />
      <path d="M15 103V91c0-27 64-27 64 0v12ZM79 69c19-2 34 7 34 25v9H90" />
    </>
  ),
  'do-game': <path d="M33 23h62v30c0 32-12 45-31 45S33 85 33 53V23ZM33 32H18v11c0 19 11 29 27 30M95 32h15v11c0 19-11 29-27 30M64 98v15M46 114h36" />,
  'do-operations': (
    <>
      <rect x="20" y="22" width="88" height="85" rx="9" />
      <path d="M41 43h45M41 63h45M41 83h27" />
    </>
  ),
  'do-scout': (
    <>
      <circle cx="53" cy="51" r="29" />
      <path d="m76 75 31 31M43 52l9 9 17-20" />
    </>
  ),
  'do-development': <path d="M19 101 47 71 65 82 105 33M80 33h25v25" />,
  'do-market': <path d="M20 49h88l-10-30H30L20 49ZM27 50v58h74V50M49 108V73h30v35" />,
  'do-finance': (
    <>
      <ellipse cx="64" cy="33" rx="39" ry="15" />
      <path d="M25 33v48c0 22 78 22 78 0V33M25 49c0 20 78 20 78 0M25 65c0 20 78 20 78 0" />
    </>
  ),
  'do-calendar': (
    <>
      <rect x="18" y="28" width="92" height="84" rx="8" />
      <path d="M18 51h92M43 16v25M83 16v25M43 72h10M70 72h10M43 91h10" />
    </>
  ),
  'do-star': <path d="m64 13 15 32 35 5-26 24 7 37-31-17-31 17 7-37-26-24 35-5Z" />,
  'do-search': (
    <>
      <circle cx="53" cy="53" r="32" />
      <path d="m77 77 34 34" />
    </>
  ),
  'do-filter': <path d="M19 25h90L75 65v35L53 113V65Z" />,
  'do-sort': <path d="M39 102V23m-17 17 17-17 17 17M89 23v79m-17-17 17 17 17-17" />,
  'do-compare': <path d="M64 21v86M26 45h76M26 45 9 79h34L26 45ZM102 45 85 79h34l-17-34ZM12 79q14 16 28 0M88 79q14 16 28 0" />,
  'do-edit': <path d="M25 102 34 73 89 18l21 21-55 55-30 8ZM78 29l21 21" />,
  'do-contract': (
    <>
      <rect x="23" y="15" width="76" height="98" rx="7" />
      <path d="M42 41h40M42 60h40M42 80h24M83 95l22 21" />
    </>
  ),
  'do-injury': <path d="M45 26V13h38v13M18 48h92v62H18V48ZM64 59v39M44 78h40" />,
  'do-warning': <path d="M64 15 118 110H10L64 15ZM64 49v28M64 91v3" />,
  'do-check': <path d="m23 65 27 27 55-58" />,
  'do-arrow-up': <path d="M64 105V20M32 52l32-32 32 32" />,
  'do-arrow-down': <path d="M64 20v85M32 73l32 32 32-32" />,
  'do-bell': <path d="M22 95h84L94 79V50c0-19-12-32-30-32S34 31 34 50v29ZM55 108q9 15 18 0" />,
  'do-settings': (
    <>
      <circle cx="64" cy="64" r="15" />
      <path d="M55 14h18l4 15 12 5 13-8 12 13-9 13 5 12 15 4v18l-15 4-5 12 9 13-12 12-13-9-12 5-4 15H55l-4-15-12-5-13 9-12-12 9-13-5-12-15-4V68l15-4 5-12-9-13 12-13 13 8 12-5Z" />
    </>
  ),
  'do-baseball': (
    <>
      <circle cx="64" cy="64" r="49" />
      <path d="M27 32q39 32 0 64M101 32q-39 32 0 64M32 46l12 6m-15 7 13 5m-13 10 13-3m-10 17 12-6m52-36-12 6m15 7-13 5m13 10-13-3m10 17-12-6" />
    </>
  ),
};

export function Icon({ name, size = 20, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  const k = kit[name];
  if (k)
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 128 128" fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {k}
      </svg>
    );
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.ball}
    </svg>
  );
}
