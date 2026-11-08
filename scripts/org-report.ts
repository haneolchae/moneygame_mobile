// 개발용 점검: 운영팀 완전 위임으로 스토브리그를 진행하고 조직·위임 결과를 요약한다.
// 실행: npx esbuild scripts/org-report.ts --bundle --platform=node --outfile=dist/org-report.js && node dist/org-report.js [시드] [구단]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../src/host/dispatcher';
import type { RequestMap, RequestName } from '../src/shared/protocol';

const eok = (n: number) => `${(n / 1e8).toFixed(1)}억`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'fo-org-'));
  const d = new Dispatcher({ baseDir: dir, platform: () => ({ steam: { mode: 'mock', initialized: false, detail: '' }, appVersion: 'dev' }) });
  const call = async <K extends RequestName>(name: K, payload?: RequestMap[K]['payload']): Promise<RequestMap[K]['result']> => {
    const r = await d.respond(name, payload as RequestMap[K]['payload']);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.result;
  };
  const seed = process.argv[2] ?? 'org-check';
  const clubId = Number(process.argv[3] ?? 5);
  await call('game.new', { clubId, saveName: 'o', seed });
  let v = await call('org.view');
  console.log(`직원 ${v.headcount}명, 연봉 합계 ${eok(v.staffPayrollWon)}, 비서 알림 ${v.lookaheadDays}일, ${v.scoutingNote}`);
  for (const t of v.teams) console.log(`  ${t.name.padEnd(10)} 팀장 ${t.leader ? t.leader.name : `공석(${t.actingName ?? '없음'})`} 팀원 ${t.members.length}/${t.defaultMembers} WP ${t.weeklyWp} 정기 ${t.upkeep} 남음 ${t.remainingWp}`);
  const ops = v.policies.find((p) => p.team === 'ops')!;
  await call('org.setPolicy', { ...ops, mode: 'auto' });
  for (let i = 0; i < 2; i++) await call('game.advance', { mode: 'week' });
  const m = await call('market.view');
  const mine = m.fa.filter((f) => f.originClub.id === clubId && f.statusKey === 'approved');
  for (const f of mine) {
    const r = await d.respond('org.delegateFa', { playerId: f.playerId });
    console.log(`위임: ${f.name} 요구 ${eok(f.demand.totalWon)} → ${r.ok ? '접수' : r.error.message}`);
  }
  let salaryDelegated = false;
  while ((await call('game.dashboard')).phase === 'stove') {
    const dash = await call('game.dashboard');
    if (!salaryDelegated && dash.date >= '2026-12-02') {
      const r = await d.respond('market.salaryAuto');
      console.log(`연봉 협상 위임: ${r.ok ? r.result.message : r.error.message}`);
      salaryDelegated = true;
    }
    await call('game.advance', { mode: 'week' });
  }
  v = await call('org.view');
  const after = await call('market.view');
  console.log('\n[FA 위임 결과]');
  for (const t of v.tasks.filter((x) => x.kind === 'fa')) {
    const f = after.fa.find((x) => x.name === t.target);
    console.log(`  ${t.target}: ${t.status} — ${t.note} | 최종 ${f?.signedClub ? `${f.signedClub.shortName} ${eok(f.signedContract!.totalWon)} (요구 ${eok(f.demand.totalWon)})` : f?.status}`);
  }
  const repo = d.saves.repository();
  if (process.env.DEBUG_FA) {
    for (const t of repo.getTasks({ kind: 'fa' })) {
      console.log(`  업무 ${t.id} 선수 ${t.targetId} ${t.status} ${JSON.stringify(t.params)}`);
      for (const o of repo.getOffers({ playerId: t.targetId })) console.log(`    ${o.date} 구단${o.clubId} ${o.status} ${eok(o.offer.salary * o.offer.years + o.offer.bonus)} ${o.offer.years}년 ${o.response}`);
    }
  }
  const talks = after.salaryTalks;
  const agreed = talks.filter((t) => t.status === '합의');
  console.log(`\n[연봉 협상] ${talks.length}명: 합의 ${agreed.length}, 조정 ${talks.filter((t) => t.status === '조정 결정').length}`);
  const ratio = agreed.reduce((a, t) => a + (t.finalWon ?? 0) / t.demandWon, 0) / Math.max(1, agreed.length);
  console.log(`  합의 평균 요구액 대비 ${(ratio * 100).toFixed(1)}%`);
  console.log(`\n[처리량] 운영팀 이번 주 ${v.teams.find((t) => t.key === 'ops')!.usedWp}/${v.teams.find((t) => t.key === 'ops')!.weeklyWp}`);
  d.close();
  rmSync(dir, { recursive: true, force: true });
}

void main();
