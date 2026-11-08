// 개발용 점검: 사용자 개입 없이 스토브리그를 끝까지 진행하고 시장 결과를 요약한다.
// 실행: npx esbuild scripts/market-report.ts --bundle --platform=node --outfile=dist/market-report.js && node dist/market-report.js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { overall } from '../src/engine/worldgen';
import { Dispatcher } from '../src/host/dispatcher';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'fo-market-'));
  const d = new Dispatcher({ baseDir: dir, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: '' }, appVersion: 'dev' }) });
  const seed = process.argv[2] ?? 'market-check';
  const r = await d.respond('game.new', { clubId: 7, saveName: 'm', seed });
  if (!r.ok) throw new Error(r.error.message);
  const repo = d.saves.repository();
  const before = repo.getPlayers().filter((p) => p.clubId !== null);
  const payrollBefore = new Map<number, number>();
  for (const c of repo.getClubs()) payrollBefore.set(c.id, before.filter((p) => p.clubId === c.id && p.origin === 'domestic').reduce((a, p) => a + p.salary, 0));
  let weeks = 0;
  for (;;) {
    const dash = await d.respond('game.dashboard', undefined as never);
    if (!dash.ok || dash.result.phase !== 'stove') break;
    const a = await d.respond('game.advance', { mode: 'week' });
    if (!a.ok) throw new Error(a.error.message);
    weeks++;
    if (a.result.stoppedReason && !a.result.stoppedReason.startsWith('스토브리그 종료')) console.log('멈춤:', a.result.stoppedReason);
  }
  const meta = repo.getMeta();
  const fa = repo.getFa(2026);
  const players = repo.getPlayers();
  const byId = new Map(players.map((p) => [p.id, p]));
  const club = (id: number | null) => repo.getClubs().find((c) => c.id === id)?.shortName ?? '—';
  console.log(`스토브리그 ${weeks}주, 현재 ${meta.currentDate} (${meta.mode})`);
  console.log(`FA: 자격 ${fa.length}, 상태별 ${JSON.stringify(fa.reduce((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), {} as Record<string, number>))}`);
  for (const e of fa.filter((x) => x.status === 'signed' || x.status === 'unsigned').sort((a, b) => b.priorSalary - a.priorSalary)) {
    const p = byId.get(e.playerId)!;
    const c = e.contract;
    console.log(
      `  ${p.name.padEnd(5)} ovr ${overall(p).toFixed(0)} ${e.grade} 직전 ${(e.priorSalary / 1e8).toFixed(1)}억 요구 ${e.demand.years}년 ${((e.demand.salary * e.demand.years + e.demand.bonus) / 1e8).toFixed(0)}억 → ${e.status === 'signed' ? `${club(e.originClub)}→${club(e.signedClub)} ${e.signedDate} ${c!.years}년 ${((c!.salary * c!.years + c!.bonus) / 1e8).toFixed(0)}억` : '미계약'}`,
    );
  }
  console.log('구단별: 인원 / 외국인 / 국내 연봉 총액(전→후) / 현금');
  for (const c of repo.getClubs()) {
    const roster = players.filter((p) => p.clubId === c.id);
    const payroll = roster.filter((p) => p.origin === 'domestic').reduce((a, p) => a + p.salary, 0);
    const foreign = roster.filter((p) => p.origin !== 'domestic');
    console.log(`  ${c.shortName.padEnd(6)} ${roster.length}명 / 외${foreign.filter((p) => p.origin === 'foreign').length}+아${foreign.filter((p) => p.origin === 'asia').length} / ${((payrollBefore.get(c.id) ?? 0) / 1e8).toFixed(0)}→${(payroll / 1e8).toFixed(0)}억 / ${(repo.cashBalance(c.id) / 1e8).toFixed(0)}억`);
  }
  const talks = repo.getSalaryTalks(2026).filter((t) => t.clubId === 7);
  console.log(`사용자 구단 연봉 협상: ${talks.length}명, 상태 ${JSON.stringify(talks.reduce((a, t) => ((a[t.status] = (a[t.status] ?? 0) + 1), a), {} as Record<string, number>))}`);
  const offers = repo.getOffers({});
  console.log(`제안 총 ${offers.length}건, 상태 ${JSON.stringify(offers.reduce((a, o) => ((a[o.status] = (a[o.status] ?? 0) + 1), a), {} as Record<string, number>))}`);
  d.close();
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
