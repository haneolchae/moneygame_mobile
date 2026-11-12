// ① 진행 구조 전환(D-214·D-215·D-230): 새 게임 생성 때 첫 스토브리그를 화면 없이 같은 엔진으로 실행하고,
// 2027-02-01 캠프에서 「지난겨울 보고서」와 첫 안건(간판 외야수 잔류 협상)으로 넘겨준다. 보고서 숫자는 모두 실제 기록에서 집계한다.
import { addDays, type GameDate } from '../engine/calendar';
import { CATEGORY_LABEL } from '../engine/finance';
import { NEW_GAME } from '../engine/config';
import { EOK } from '../engine/money';
import type { PlayerId } from '../engine/types';
import { overall } from '../engine/worldgen';
import { DELEGABLE_TEAMS, defaultPolicy } from './organization';
import type { GameMeta, GameRepository, InboxMessage, WinterReport } from './ports';

const won = (n: number) => `${(n / EOK).toFixed(1).replace(/\.0$/, '')}억`;

/** 자동 실행 시작 전 기준(보고서 비교용) */
export interface WinterBaseline {
  date: GameDate;
  roster: Array<{ id: PlayerId; name: string }>;
  staff: number[];
  cash: number;
  facilities: Record<string, number>;
}

/**
 * 자동 실행 준비(D-215): 우리 구단 완전 위임('현상 유지형' 기본 정책 — 운영팀·경영지원팀 완전 위임, 기본 한도),
 * 간판 외야수 시작 예외 표시, 외국인 1자리 공석(가장 낮게 평가된 외국인 선수와 결별, 해외 선수 풀로 돌아간다).
 */
export function beginAutoRun(repo: GameRepository): { baseline: WinterBaseline; releasedForeign: string | null } {
  const meta = repo.getMeta();
  const club = meta.userClubId;
  const mine = repo.getPlayers().filter((p) => p.clubId === club && !p.retired);
  const franchise = mine.find((p) => p.career.franchise) ?? null;
  for (const team of DELEGABLE_TEAMS) repo.savePolicy({ ...defaultPolicy(team), mode: 'auto' });
  // 외국인 1자리 공석: 우리 외국인(아시아쿼터 제외) 중 가장 낮은 선수와 결별한다
  const foreign = mine.filter((p) => p.origin === 'foreign').sort((a, b) => overall(a) - overall(b) || a.id - b.id);
  let releasedForeign: string | null = null;
  let releasedId: PlayerId | null = null;
  if (foreign.length) {
    const p = foreign[0]!;
    p.clubId = null;
    p.contractYears = 0;
    p.level = '2군';
    repo.savePlayers([p]);
    releasedForeign = p.name;
    releasedId = p.id;
  }
  const baseline: WinterBaseline = {
    date: meta.currentDate,
    roster: mine.filter((p) => p.id !== releasedId).map((p) => ({ id: p.id, name: p.name })),
    staff: repo.getStaff(club).map((s) => s.id),
    cash: repo.cashBalance(club),
    facilities: { ...(meta.facilities?.[String(club)]?.levels ?? {}) },
  };
  repo.updateMeta({ autoRun: { franchiseId: franchise?.id ?? null, foreignVacancy: true } });
  return { baseline, releasedForeign };
}

/** 자동 실행 마무리: 위임 정책을 기본값(제안 후 승인)으로 되돌리고 보고서·첫 안건·취임 편지를 만든다 */
export function finishAutoRun(repo: GameRepository, baseline: WinterBaseline, releasedForeign: string | null, clubName: string): void {
  const meta = repo.getMeta();
  const club = meta.userClubId;
  const date = meta.currentDate;
  for (const team of DELEGABLE_TEAMS) repo.savePolicy(defaultPolicy(team));
  const franchiseId = meta.autoRun?.franchiseId ?? null;
  const report = buildReport(repo, meta, baseline, releasedForeign);
  const off = Number(meta.kDate.slice(0, 4));
  const fe = franchiseId !== null ? repo.getFa(off).find((e) => e.playerId === franchiseId) : undefined;
  const firstAgenda = fe && fe.status === 'approved' ? { playerId: fe.playerId, deadline: NEW_GAME.franchiseDeadline, status: 'open' as const } : null;
  const star = franchiseId !== null ? repo.getPlayer(franchiseId) : null;
  repo.updateMeta({ autoRun: null, winterReport: report, firstAgenda });
  const dl = NEW_GAME.franchiseDeadline.slice(5).replace('-', '/');
  const inbox: InboxMessage[] = [
    { date, kind: 'welcome', sender: '모기업', title: '취임을 축하합니다', body: `오늘 스프링캠프가 시작됐습니다. 지난겨울 전임 경영진이 정리한 ${clubName}을 이제 구단주께서 이끄십니다.\n지난겨울의 영입·계약·재정은 「지난겨울 보고서」에 정리해 두었습니다.` },
    {
      date,
      kind: 'task',
      sender: '비서',
      title: firstAgenda && star ? `첫 안건: 간판 외야수 ${star.name} 잔류 협상 (${dl} 마감)` : '첫 안건 안내',
      body: firstAgenda && star
        ? `간판 외야수 ${star.name} 선수는 지난겨울 계약하지 못한 채 캠프를 맞았습니다. 다른 구단은 마감(${dl}) 전까지 영입에 나서지 않습니다.\n[계약·이적]에서 직접 협상하거나 운영팀에 맡기세요. 마감까지 계약하지 못하면 다음 날 시장에 다시 나갑니다.\n선택 안건: 비어 있는 외국인 1자리, 캠프 명단 점검.`
        : `선택 안건: 비어 있는 외국인 1자리, 캠프 명단 점검.`,
    },
  ];
  repo.addInbox(inbox);
}

function buildReport(repo: GameRepository, meta: GameMeta, base: WinterBaseline, releasedForeign: string | null): WinterReport {
  const club = meta.userClubId;
  const off = Number(meta.kDate.slice(0, 4));
  const players = repo.getPlayers();
  const byId = new Map(players.map((p) => [p.id, p]));
  const before = new Set(base.roster.map((r) => r.id));
  const now = players.filter((p) => p.clubId === club && !p.retired);
  const fa = new Map(repo.getFa(off).map((e) => [e.playerId, e]));
  const trades = (meta.tradeHistory ?? []).filter((t) => t.date >= base.date && (t.clubA === club || t.clubB === club));
  const traded = new Set(trades.flatMap((t) => [...t.aToB, ...t.bToA]));
  const incoming = now.filter((p) => !before.has(p.id)).map((p) => {
    const e = fa.get(p.id);
    const how = e?.signedClub === club ? 'FA 영입' : traded.has(p.id) ? '트레이드' : p.origin !== 'domestic' ? '외국인 계약' : '계약';
    return { playerId: p.id, name: p.name, how };
  });
  const outgoing = base.roster.filter((r) => !now.some((p) => p.id === r.id)).map((r) => {
    const p = byId.get(r.id);
    const e = fa.get(r.id);
    const how = p?.retired ? `은퇴(${p.retired.reason})` : e?.signedClub !== null && e?.signedClub !== undefined && e.signedClub !== club ? 'FA 이적' : traded.has(r.id) ? '트레이드' : '방출·결별';
    return { playerId: r.id, name: r.name, how };
  });
  if (releasedForeign) outgoing.push({ playerId: -1, name: releasedForeign, how: '외국인 결별(1자리 공석)' });
  const contracts: WinterReport['contracts'] = [];
  for (const e of fa.values()) if (e.originClub === club && e.signedClub === club && e.contract) contracts.push({ playerId: e.playerId, name: byId.get(e.playerId)?.name ?? '', text: `FA 잔류 ${e.contract.years}년 연봉 ${won(e.contract.salary)}·계약금 ${won(e.contract.bonus)}` });
  const talks = repo.getSalaryTalks(off).filter((t) => t.clubId === club);
  const agreed = talks.filter((t) => t.status === 'agreed').length;
  const arb = talks.filter((t) => t.status === 'arbitrated').length;
  if (talks.length) contracts.push({ playerId: -1, name: '보류 선수', text: `연봉 협상 ${talks.length}명: 합의 ${agreed}명, 조정 ${arb}명` });
  const sponsors = (meta.sponsors?.[String(club)] ?? []).filter((s) => s.signed >= base.date).map((s) => `${s.slot === 'main' ? '메인' : '서브'} ${s.brand}(${s.industry}) 보장 ${won(s.guaranteedWon)}`);
  const staff = repo.getStaff(club);
  const hires = staff.filter((s) => !base.staff.includes(s.id)).map((s) => `${s.name} ${s.title}`);
  const levels = meta.facilities?.[String(club)]?.levels ?? {};
  const facilities = Object.entries(levels).filter(([k, v]) => (base.facilities[k] ?? v) !== v).map(([k, v]) => `${k} ${base.facilities[k] ?? '?'} → ${v}단계`);
  const projects = (meta.facilities?.[String(club)]?.projects ?? []).map((p) => `${p.kind} 공사 중`);
  const ledger = repo.ledgerByCategory(club, meta.season - 1).filter((r) => r.category !== 'startCash' && r.amount !== 0).map((r) => ({ category: CATEGORY_LABEL[r.category] ?? r.category, amount: r.amount }));
  const fe = meta.autoRun?.franchiseId ?? null;
  const notes: string[] = [];
  if (fe !== null) notes.push(`간판 외야수 ${byId.get(fe)?.name ?? ''} 선수는 미계약 FA로 남았습니다(첫 안건).`);
  notes.push('외국인 1자리가 비어 있습니다.');
  return {
    from: base.date,
    to: addDays(meta.currentDate, -1),
    incoming,
    outgoing,
    contracts,
    sponsors,
    hires,
    facilities: [...facilities, ...projects],
    cashStart: base.cash,
    cashEnd: repo.cashBalance(club),
    ledger,
    rosterCount: now.length,
    foreignCount: now.filter((p) => p.origin === 'foreign').length,
    notes,
  };
}

