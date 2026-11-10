// D-114 사전 등록: 엔진 분리 실험. 실제 경기 엔진·FormTracker를 고정 로스터로 비교한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { addDays } from '../src/engine/calendar';
import { simulateGame } from '../src/engine/gamesim';
import { prepareTeam } from '../src/engine/lineup';
import { NEUTRAL_ENVIRONMENT } from '../src/engine/probability';
import { Rng } from '../src/engine/rng';
import { generateSchedule } from '../src/engine/schedule';
import { generateWorld } from '../src/engine/worldgen';
import type { BattingTotals, PitchingTotals } from '../src/engine/stats';
import { FormTracker } from '../src/game/formTracker';
import type { GameRepository } from '../src/game/ports';

type Totals = { pa: number; ab: number; h: number; tb: number; bb: number; hbp: number; k: number; hr: number; sf: number };
const empty = (): Totals => ({ pa: 0, ab: 0, h: 0, tb: 0, bb: 0, hbp: 0, k: 0, hr: 0, sf: 0 });
const ops = (t: Totals) => (t.h + t.bb + t.hbp) / Math.max(1,t.ab + t.bb + t.hbp + t.sf) + t.tb / Math.max(1,t.ab);
const sum = (rows: Totals[]) => rows.reduce((a,t) => { for(const k of Object.keys(a) as Array<keyof Totals>) a[k]+=t[k]; return a; },empty());
function add(t: Totals, outcome: string) {
  t.pa++; if(outcome==='BB')t.bb++; else if(outcome==='HBP')t.hbp++; else if(outcome==='SF')t.sf++; else t.ab++;
  if(outcome==='K')t.k++;
  const bases = ({ '1B':1, '2B':2, '3B':3, HR:4 } as Record<string,number>)[outcome] ?? 0;
  if(bases){t.h++;t.tb+=bases;} if(outcome==='HR')t.hr++;
}
function run(seed: string, mixed: boolean, seasons: number, equal = false) {
  const players = generateWorld(Rng.fromSeed(seed), 2026).filter(p=>p.level==='1군');
  if(equal) for(const p of players) if(!p.isPitcher) {
    for(const k of Object.keys(p.batting) as Array<keyof typeof p.batting>) p.batting[k]=50;
    p.hidden.consistency=50; p.hidden.pressureSensitivity=50;
  }
  const byDate = new Map<string, Array<{ batterId:number; pitcherId:number; date:string; outcome:string }>>();
  const bat = new Map<number, Map<number,Totals>>(), pit = new Map<number, Map<number,Totals>>();
  const facade = {
    formRows: (_season:number, after:string|null, before:string) => [...byDate.entries()].filter(([date])=>(!after || date>after) && date<before).flatMap(([,rows])=>rows),
    battingTotals: (season:number) => new Map([...(bat.get(season)??[])].map(([id,t])=>[id,{PA:t.pa,BB:t.bb,HBP:t.hbp,SO:t.k,HR:t.hr,H:t.h} as BattingTotals])),
    pitchingTotals: (season:number) => new Map([...(pit.get(season)??[])].map(([id,t])=>[id,{BF:t.pa,BB:t.bb,HBP:t.hbp,K:t.k,HR:t.hr,H:t.h} as PitchingTotals])),
  } as unknown as GameRepository;
  const tracker=new FormTracker(facade), rows: Array<Record<string,number>>=[];
  const early = new Map<number,Totals>(), late = new Map<number,Totals>();
  let regression: { earlyGap:number; lateGap:number; eligible:number }|null=null;
  const totals=(map:Map<number,Totals>,id:number)=>{let t=map.get(id);if(!t){t=empty();map.set(id,t);}return t;};
  for(let season=2027;season<2027+seasons;season++){
    byDate.clear();bat.set(season,new Map());pit.set(season,new Map());
    const fixtures=generateSchedule(season,Rng.derive(seed,'schedule',season),1);
    const dates=[...new Set(fixtures.map(f=>f.date))].sort();
    const wins=new Map<number,number>(), games=new Map<number,number>(); let runs=0;
    for(const date of dates){
      const forms=mixed ? tracker.formsFor(season,date,players,NEUTRAL_ENVIRONMENT) : undefined;
      const events: Array<{batterId:number;pitcherId:number;date:string;outcome:string}>=[];
      for(const f of fixtures.filter(f=>f.date===date)){
        const team=(id:number)=>prepareTeam(id,players.filter(p=>p.clubId===id),[],null);
        const game=simulateGame(f.id,team(f.home),team(f.away),Rng.derive(seed,'game',season,f.id),11,NEUTRAL_ENVIRONMENT,{forms});
        runs+=game.homeRuns+game.awayRuns;
        if(game.outcome!=='tie') {const winner=game.outcome==='home'?f.home:f.away;wins.set(winner,(wins.get(winner)??0)+1);for(const id of [f.home,f.away])games.set(id,(games.get(id)??0)+1);}
        for(const event of game.events){
          const b=totals(bat.get(season)!,event.batterId), p=totals(pit.get(season)!,event.pitcherId);
          if(equal){if(b.pa<100)add(totals(early,event.batterId),event.outcome);if(b.pa>=200)add(totals(late,event.batterId),event.outcome);}
          add(b,event.outcome);add(p,event.outcome);events.push({batterId:event.batterId,pitcherId:event.pitcherId,date,outcome:event.outcome});
        }
      }
      byDate.set(date,events);
    }
    const t=sum([...bat.get(season)!.values()]);const rates=[...games].map(([id,n])=>(wins.get(id)??0)/n);const mean=rates.reduce((a,b)=>a+b,0)/rates.length;
    rows.push({ season, avg:t.h/t.ab, ops:ops(t), runsPerGame:runs/fixtures.length, winSd:Math.sqrt(rates.reduce((a,v)=>a+(v-mean)**2,0)/rates.length) });
    if(equal){
      const ids=[...early.keys()].filter(id=>(late.get(id)?.pa??0)>=100).sort((a,b)=>ops(early.get(a)!)-ops(early.get(b)!));const n=Math.floor(ids.length/4);
      const bottom=ids.slice(0,n),top=ids.slice(-n);const group=(ids:number[],m:Map<number,Totals>)=>ops(sum(ids.map(id=>m.get(id)!)));
      regression={earlyGap:group(top,early)-group(bottom,early),lateGap:group(top,late)-group(bottom,late),eligible:ids.length};
    }
    // 다음 시즌 첫 날에도 전 시즌 합계를 읽고 날짜별 원시 기록은 새 시즌만 보관한다.
    void addDays;
  }
  return {seed,mixed,equal,rows,regression};
}
const results: ReturnType<typeof run>[]=[];
for(let i=1;i<=5;i++) {
  const seed=`3c-form-${i}`;
  for(const mixed of [false,true]){const r=run(seed,mixed,10);results.push(r);console.log(JSON.stringify({seed,mixed,done:r.rows.length}));}
  results.push(run(seed,true,1,true));
}
const average=(mixed:boolean,key:string)=>{const rows=results.filter(r=>r.mixed===mixed&&!r.equal).flatMap(r=>r.rows);return rows.reduce((a,r)=>a+r[key]!,0)/rows.length;};
const checks=[
  {name:'AVG',difference:Math.abs(average(true,'avg')-average(false,'avg')),limit:0.015},
  {name:'OPS',difference:Math.abs(average(true,'ops')-average(false,'ops')),limit:0.040},
  {name:'득점 비율',difference:Math.abs(average(true,'runsPerGame')/average(false,'runsPerGame')-1),limit:0.08},
  {name:'팀 승률 표준편차',difference:Math.abs(average(true,'winSd')-average(false,'winSd')),limit:0.04},
];
const regression=results.filter(r=>r.equal).map(r=>r.regression!);const earlyGap=regression.reduce((a,r)=>a+r.earlyGap,0)/regression.length, lateGap=regression.reduce((a,r)=>a+r.lateGap,0)/regression.length;
checks.push({name:'동일 능력 초반 행운 회귀',difference:Math.abs(lateGap)/earlyGap,limit:0.5});
const report={criteria:'D-114',scope:'fixed roster engine experiment; full lifecycle checked by verify',checks,earlyGap,lateGap,results,passed:checks.every(c=>c.difference<=c.limit)};
mkdirSync('verify-reports',{recursive:true});writeFileSync('verify-reports/3c-form-comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks,earlyGap,lateGap,passed:report.passed}));if(!report.passed)process.exitCode=1;
