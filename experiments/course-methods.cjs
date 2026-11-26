// Reproduce KKT certificate checks, horizon ablations, deterministic graph search,
// and a distinct partially observed shuttle experiment from the course presentation.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),U=require('../control'),H=require('../planner'),S=require('../scenes');
const E=require('../engine'),T=require('../tracking');
const out=path.join(__dirname,'../results');fs.mkdirSync(out,{recursive:true});
const save=(name,rows)=>fs.writeFileSync(path.join(out,name),[Object.keys(rows[0]).join(','),...rows.map(r=>Object.values(r).join(','))].join('\n')+'\n');
const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
function ci(values) {
  const rng=P.random(4823901),means=[];
  for(let i=0;i<2000;i++) {let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(rng()*values.length)];means.push(sum/values.length);}
  means.sort((a,b)=>a-b);return [means[49],means[1949]];
}
const kktRows=[];let missedFeasible=0,maxStationarity=0,maxComplementarity=0,maxPrimal=0,worseThanGrid=0,example;
for(let i=0;i<600;i++) {
  const rng=P.random(P.hash('kkt-benchmark',i)),a=S.icon('a',8,3,2,'A'),
    b=S.icon('b',8+(.8+6.8*rng())*(rng()<.5?-1:1),.7+5.1*rng(),1.8,'B'),
    available=3.5+3.0*rng(),timeWeight=2+32*rng();
  const q=U.constrainedShot(a,b,{available,timeWeight});
  const dx=b.x-a.x,dy=b.y-a.y,cap=Math.min(P.C.maxJ,available/P.C.kappa);
  let best=Infinity;
  // Independent numerical oracle over time, without reusing the interval derivation.
  for(let j=0;j<=1800;j++) {
    const t=P.C.minTime+(P.C.maxTime-P.C.minTime)*j/1800,vx=dx/t,vy=dy/t+.5*P.C.g*t,endVy=vy-P.C.g*t;
    const J=P.C.mass*Math.hypot(vx,vy);
    if(vy<0||endVy> -P.C.minDescent||J>cap||Math.hypot(vx,endVy)>P.C.safeSpeed)continue;
    best=Math.min(best,.5*J*J+timeWeight*t*t);
  }
  if(!q&&Number.isFinite(best))missedFeasible++;
  if(q) {
    const a=q.certificate,primal=Math.max(0,a.low-a.s,a.s-a.high,q.J-cap,q.speed-P.C.safeSpeed);
    maxStationarity=Math.max(maxStationarity,a.stationarity);maxComplementarity=Math.max(maxComplementarity,a.complementarity);
    maxPrimal=Math.max(maxPrimal,primal);if(q.objective>best+1e-7)worseThanGrid++;
    if(!example && a.active==='stamina limit' && a.muLow>1)
      example={dx,dy,available,timeWeight,J:q.J,T:q.T,objective:q.objective,certificate:a};
  }
  kktRows.push({pair:i,dx,dy,available,timeWeight,intervalFeasible:+!!q,gridFeasible:+Number.isFinite(best),
    active:q?.certificate.active||'infeasible',T:q?.T??'',J:q?.J??'',stationarity:q?.certificate.stationarity??'',
    complementarity:q?.certificate.complementarity??'',objective:q?.objective??'',gridObjective:Number.isFinite(best)?best:''});
}
save('kkt.csv',kktRows);
const active={};for(const r of kktRows)active[r.active]=(active[r.active]||0)+1;
const kkt={pairs:kktRows.length,feasible:kktRows.filter(r=>r.intervalFeasible).length,missedFeasible,worseThanGrid,
  maxStationarity,maxComplementarity,maxPrimal,active,example};
const traces={},a=S.get('first').icons[0],b=S.get('first').icons[1];
for(const method of ['gd','gn','gd-armijo','gn-armijo']) {const trace=[];const q=P.shoot(a,b,method,trace);traces[method]={q,trace};}
// Reproduce the Bellman choice at the branch shown in the side-by-side movie.
const bellmanExample=require('../bellman-example');
const workedExample=bellmanExample.evaluate(bellmanExample.atMail(),P.C.failCost);
fs.writeFileSync(path.join(out,'bellman-example.json'),JSON.stringify(workedExample,null,2)+'\n');
const horizonRows=[],searchRows=[];
for(const [profile,offset] of [['standard',810000],['stress',820000]])for(let i=0;i<120;i++){
  const seed=offset+i,s=S.generate(seed,profile),g=new H.Graph(s.icons,{noise:1,seed:P.hash('horizon-mc',seed)});
  const cache=new Map();
  for(const solver of ['astar','dijkstra']){
    const p=H.plan(g,s.start,s.goal,s.energy,solver);
    searchRows.push({profile,seed,solver,reachable:+Number.isFinite(p.value),cost:Number.isFinite(p.value)?p.value:'',expanded:p.expanded});
  }
  for(const h of [1,2,4,8,0]){
    const method=h?'mpc':'vi',begin=performance.now(),plan=H.plan(g,s.start,s.goal,s.energy,method,{horizon:h||2});
    const ms=performance.now()-begin;
    let reached=0,fallen=0,stranded=0,cost=0,energy=0;
    for(let k=0;k<48;k++){
      const r=E.episode(s,{graph:g,cache,method,horizon:h||2,seed:P.hash('horizon-flight',seed,k)});
      reached+=r.reached;fallen+=r.fallen;stranded+=r.stranded;cost+=r.cost;energy+=r.energy;
    }
    horizonRows.push({profile,seed,method,horizon:h,episodes:48,reached,fallen,stranded,cost,energy,ms,expanded:plan.expanded??''});
  }
}
save('horizons.csv',horizonRows);save('search.csv',searchRows);
const horizons=[],search=[];
for(const profile of ['standard','stress']){
  const base=horizonRows.filter(r=>r.profile===profile&&r.method==='vi');
  const dj=searchRows.filter(r=>r.profile===profile&&r.solver==='dijkstra'),as=searchRows.filter(r=>r.profile===profile&&r.solver==='astar');
  search.push({profile,layouts:as.length,mismatches:as.filter((r,i)=>r.reachable!==dj[i].reachable||
    (r.reachable&&Math.abs(r.cost-dj[i].cost)>1e-7)).length,
    astarExpanded:median(as.map(r=>r.expanded)),dijkstraExpanded:median(dj.map(r=>r.expanded))});
  for(const h of [1,2,4,8,0]){
    const group=horizonRows.filter(r=>r.profile===profile&&r.horizon===h);
    horizons.push({profile,horizon:h,method:h?'mpc':'vi',episodes:group.length*48,
      reach:mean(group.map(r=>r.reached/48)),fallen:mean(group.map(r=>r.fallen/48)),stranded:mean(group.map(r=>r.stranded/48)),
      cost:mean(group.map(r=>r.cost/48)),energy:mean(group.map(r=>r.energy/48)),medianMs:median(group.map(r=>r.ms)),
      deltaCI:ci(group.map((r,i)=>(r.reached-base[i].reached)/48))});
  }
}
const trackingRows=[],tracking=[];
for(const [rho,noiseSD] of [[0,.10],[.60,.10],[.90,.10],[.90,.30]]) {
  const groups=new Map();
  for(const method of ['open','last','kalman','oracle']){
    const sub=[];
    for(let i=0;i<300;i++){
      const seed=910000+i,records=T.shuttle(seed,{method,rho,noiseSD}).records;
      const row={seed,method,rho,noiseSD,transfers:records.length,reached:0,windSq:0,energy:0,saturations:0};
      for(const r of records){
        row.reached+=r.reached;row.windSq+=(r.predicted[0]-r.actual[0])**2+(r.predicted[1]-r.actual[1])**2;
        row.energy+=r.energy;row.saturations+=r.saturated;
      }
      trackingRows.push(row);sub.push(row);
    }
    groups.set(method,sub);
    tracking.push({method,rho,noiseSD,sequences:sub.length,transfers:sub.length*18,reach:mean(sub.map(r=>r.reached/18)),
      prelaunchWindRMSE:Math.sqrt(mean(sub.map(r=>r.windSq/18))),energy:mean(sub.map(r=>r.energy/18)),
      saturationRate:mean(sub.map(r=>r.saturations/18)),deltaVsOpenCI:ci(sub.map((r,i)=>(r.reached-groups.get('open')[i].reached)/18))});
  }
}
save('tracking.csv',trackingRows);
fs.writeFileSync(path.join(out,'course-methods.json'),JSON.stringify({kkt,traces,horizons,search,tracking},null,2)+'\n');
console.log('KKT',JSON.stringify(kkt));console.table(search);console.table(horizons.map(({profile,horizon,reach,stranded,medianMs})=>({profile,horizon,reach,stranded,medianMs})));
console.table(tracking.filter(r=>r.noiseSD===.1).map(({method,rho,reach,prelaunchWindRMSE})=>({method,rho,reach,prelaunchWindRMSE})));

