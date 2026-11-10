// 상단 주 메뉴(D-140 Diamond Office). 기존 메뉴 배열과 go 경로를 그대로 쓰고, 폭이 모자라면 남는 항목을 [더보기]로 옮긴다.
// 더보기는 키보드로 열고(Enter·Space·↓), 항목 사이를 ↑↓로 움직이며, Esc나 바깥 클릭으로 닫고 버튼으로 포커스를 돌려준다.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './icons';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  badge: number;
  onSelect: () => void;
}

const MORE_WIDTH = 104;

export function PrimaryNav({ items, platform, platformDetail }: { items: NavItem[]; platform: string; platformDetail: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(items.length);
  const [open, setOpen] = useState(false);

  // 숨겨 둔 측정용 줄에서 항목 폭을 재고, 실제 줄 폭에 들어가는 만큼만 보인다.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      const widths = [...measure.children].map((c) => (c as HTMLElement).offsetWidth + 2);
      const avail = row.clientWidth;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) return setVisible(items.length);
      let used = MORE_WIDTH;
      let n = 0;
      for (const w of widths) {
        if (used + w > avail) break;
        used += w;
        n++;
      }
      setVisible(Math.max(1, n));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [items.length, items.map((i) => i.label + i.badge).join('|')]);

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !moreRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) (menuRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus();
  }, [open]);

  const shown = items.slice(0, visible);
  const rest = items.slice(visible);
  const restActive = rest.some((i) => i.active);
  const restBadge = rest.reduce((a, i) => a + i.badge, 0);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) moreRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(menuRef.current?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const button = (m: NavItem, inMenu = false) => (
    <button
      key={m.key}
      className={`nav ${m.active ? 'active' : ''}`}
      aria-current={m.active ? 'page' : undefined}
      role={inMenu ? 'menuitem' : undefined}
      onClick={() => {
        if (inMenu) close(false);
        m.onSelect();
      }}
    >
      <Icon name={m.icon} size={18} />
      {m.label}
      {m.badge > 0 && <span className="badge-count" aria-label={`${m.badge}건`}>{m.badge}</span>}
    </button>
  );

  return (
    <nav className="primary-nav" aria-label="주 메뉴">
      <div className="items" ref={rowRef}>
        {shown.map((m) => button(m))}
      </div>
      {rest.length > 0 && (
        <div className="more">
          <button
            ref={moreRef}
            className={`nav ${restActive ? 'active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            더보기 ▾{restBadge > 0 && <span className="badge-count">{restBadge}</span>}
          </button>
          {open && (
            <div className="more-menu" role="menu" ref={menuRef} onKeyDown={onMenuKey}>
              {rest.map((m) => button(m, true))}
            </div>
          )}
        </div>
      )}
      <span className="platform" title={platformDetail}>
        Steam: {platform}
      </span>
      {/* 측정용(보이지 않음, 접근성 트리 제외) */}
      <div ref={measureRef} aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: 2, left: 0, top: 0, height: 0, overflow: 'hidden' }}>
        {items.map((m) => (
          <button key={m.key} className="nav" tabIndex={-1}>
            <Icon name={m.icon} size={18} />
            {m.label}
            {m.badge > 0 && <span className="badge-count">{m.badge}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
