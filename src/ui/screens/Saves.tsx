import { useEffect, useState } from 'react';
import type { SaveSlotInfo } from '../../shared/protocol';
import type { Nav } from '../App';
import { api, ApiError } from '../api';
import { dateKo } from '../format';

const SLOT_RE = /^[a-z0-9_-]{1,40}$/;

export function Saves({ nav }: { nav: Nav }) {
  const [slots, setSlots] = useState<SaveSlotInfo[]>([]);
  const [newSlot, setNewSlot] = useState('slot1');
  const [working, setWorking] = useState(false);

  const reload = () => api('save.list').then(setSlots).catch((e: Error) => nav.notify(e.message, 'error'));
  useEffect(() => {
    void reload();
  }, []);

  const save = async (slot: string) => {
    if (!SLOT_RE.test(slot)) return nav.notify('슬롯 이름은 영문 소문자·숫자·-·_ 로 40자 이내여야 합니다.', 'error');
    setWorking(true);
    try {
      const info = await api('save.save', { slot });
      nav.setDashboard(await api('game.dashboard'));
      nav.notify(`'${info.slot}' 슬롯에 저장했습니다. (${(info.sizeBytes / 1e6).toFixed(1)}MB)`);
      await reload();
    } catch (e) {
      // 저장 실패 시 기존 저장본은 그대로 남는다(저장 계층이 보장). 안내만 한다.
      nav.notify(e instanceof ApiError ? `${e.message}` : String(e), 'error');
    } finally {
      setWorking(false);
    }
  };

  const load = async (slot: string, backupIndex?: number) => {
    if (nav.dashboard && nav.dashboard.unsavedDays > 0 && !window.confirm(`저장하지 않은 ${nav.dashboard.unsavedDays}일의 진행이 사라집니다. 불러올까요?`)) return;
    setWorking(true);
    try {
      nav.setDashboard(await api('save.load', { slot, backupIndex }));
      nav.notify(backupIndex ? `'${slot}' 백업 ${backupIndex}을 불러왔습니다.` : `'${slot}'을 불러왔습니다.`);
      nav.go({ name: 'dashboard' });
    } catch (e) {
      nav.notify(e instanceof ApiError ? e.message : String(e), 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="page">
      <h1>저장·불러오기</h1>
      <section className="panel">
        <h2>새 슬롯에 저장</h2>
        <div className="row">
          <input value={newSlot} onChange={(e) => setNewSlot(e.target.value.toLowerCase())} />
          <button className="primary" disabled={working} onClick={() => save(newSlot)}>저장</button>
        </div>
        <p className="muted small">
          진행 내용은 매일 처리될 때마다 세션에 기록되어 강제 종료에도 마지막으로 처리된 날짜까지 보존됩니다. 저장본은 검증을 거친 뒤에만 교체되고, 이전 저장본 2개(자동 저장은 3개)를 백업으로 보관합니다.
        </p>
      </section>
      <section className="panel">
        <h2>저장본</h2>
        <table className="grid">
          <thead>
            <tr><th>슬롯</th><th>이름</th><th>구단</th><th>게임 날짜</th><th>저장 시각</th><th className="num">크기</th><th>상태</th><th>백업</th><th /></tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.slot}>
                <td>{s.slot}{s.slot === 'autosave' ? ' (자동)' : ''}</td>
                <td>{s.name}</td>
                <td>{s.clubName}</td>
                <td>{s.date ? dateKo(s.date) : '—'}</td>
                <td>{s.savedAt ? new Date(s.savedAt).toLocaleString('ko-KR') : '—'}</td>
                <td className="num">{(s.sizeBytes / 1e6).toFixed(1)}MB</td>
                <td>{s.status === 'ok' ? '정상' : <span className="error-text">{s.message}</span>}</td>
                <td>
                  {s.backups.map((b) => (
                    <button key={b.index} className="small" disabled={working} title={`저장 ${new Date(b.savedAt).toLocaleString('ko-KR')}`} onClick={() => load(s.slot, b.index)}>
                      백업{b.index} ({dateKo(b.date)})
                    </button>
                  ))}
                </td>
                <td>
                  {s.slot !== 'autosave' && <button disabled={working} onClick={() => save(s.slot)}>덮어쓰기</button>}
                  {s.status === 'ok' && <button disabled={working} onClick={() => load(s.slot)}>불러오기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
