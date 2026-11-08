import { useEffect, useState } from 'react';
import type { InboxItemView } from '../../shared/protocol';
import type { Nav } from '../App';
import { api } from '../api';
import { dateKo } from '../format';

export function Inbox({ nav }: { nav: Nav }) {
  const [items, setItems] = useState<InboxItemView[]>([]);
  const [selected, setSelected] = useState<InboxItemView | null>(null);

  useEffect(() => {
    api('game.inbox')
      .then((list) => {
        setItems(list);
        setSelected(list[0] ?? null);
      })
      .catch((e: Error) => nav.notify(e.message, 'error'));
    // 처음 열 때 한 번만 불러온다. nav는 상단 정보 갱신 때마다 바뀌므로 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected && !selected.read) {
      api('game.inboxRead', { id: selected.id })
        .then(() => {
          setItems((list) => list.map((m) => (m.id === selected.id ? { ...m, read: true } : m)));
          void nav.sync();
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="page">
      <h1>받은 편지함</h1>
      <div className="inbox">
        <div className="list">
          {items.map((m) => (
            <div key={m.id} className={`item ${m.read ? '' : 'unread'} ${selected?.id === m.id ? 'selected' : ''}`} onClick={() => setSelected(m)}>
              <strong>{m.title}</strong>
              <div className="muted small">
                {m.sender} · {dateKo(m.date)}
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="item muted">받은 메시지가 없습니다.</div>}
        </div>
        {selected ? (
          <div className="detail">
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>{selected.title}</h2>
            <div className="muted small" style={{ marginBottom: 16 }}>
              보낸 사람: {selected.sender} · {dateKo(selected.date)}
            </div>
            {selected.body}
          </div>
        ) : (
          <div className="detail muted">메시지를 선택하세요.</div>
        )}
      </div>
    </div>
  );
}
