// Fixed held-out evaluation. Node 18+, zero runtime dependencies.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine');
const outdir=path.join(__dirname,'../results');fs.mkdirSync(outdir,{recursive:true});
const csv=(file,rows)=>fs.writeFileSync(path.join(outdir,file),[Object.keys(rows[0]).join(','),
  ...rows.map(o=>Object.values(o).map(v=>typeof v==='string'&&/[,"\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v).join(','))].join('\n')+'\n');
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function quantile(a,q) {const sorted=[...a].sort((x,y)=>x-y),i=(sorted.length-1)*q,lo=Math.floor(i);
  return sorted[lo]+(sorted[Math.ceil(i)]-sorted[lo])*(i-lo);}
function interval(values,seed) {
  const rng=P.random(seed),est=[];
  for(let j=0;j<2000;j++) {let v=0;
    for(let i=0;i<values.length;i++)v+=values[Math.floor(rng()*values.length)];est.push(v/values.length);}
  return [quantile(est,.025),quantile(est,.975)];
}
const methods=['vi','pi','astar','greedy','no-risk','no-stamina'];
const metrics=['reached','fallen','stranded','energy','jumps','cost','time'];
const layoutRows=[],summary=[],timing=[],edits=[],shooting=[];
const layouts=120,episodes=64;
for(const [profile,noise,offset] of [['standard',0,100000],['standard',1,100000],['standard',1.7,100000],
  ['sparse',1,200000],['stress',1,300000]]) {
  for(let i=0;i<layouts;i++) {
    const seed=offset+i,scene=S.generate(seed,profile);
    const t0=performance.now(),graph=new H.Graph(scene.icons,{samples:64,noise,seed:P.hash('heldout-mc',seed)});
    const buildMs=performance.now()-t0,cache=new Map();
    for(const method of methods) {
      const sums=Object.fromEntries(metrics.map(x=>[x,0]));let successEnergy=0;
      const t1=performance.now();const route=H.plan(graph,scene.start,scene.goal,scene.energy,method);
      timing.push({profile,noise,seed,method,buildMs,planMs:performance.now()-t1,sweeps:route.sweeps||0});
      for(let j=0;j<episodes;j++) {
        const r=E.episode(scene,{method,graph,cache,noise,seed:P.hash('heldout-flight',seed,j)});
        for(const k of metrics) sums[k]+=r[k];if(r.reached)successEnergy+=r.energy;
      }
      layoutRows.push({profile,noise,seed,method,episodes,...scene.strata,...sums,successEnergy});
    }
  }
  const group=layoutRows.filter(r=>r.profile===profile&&r.noise===noise);
  for(const method of methods) {
    const rows=group.filter(r=>r.method===method),tot=Object.fromEntries(metrics.map(k=>[k,mean(rows.map(r=>r[k]/episodes))]));
    const [lo,hi]=interval(rows.map(r=>r.reached/episodes),8293);
    const base=group.filter(r=>r.method==='astar');
    const diff=rows.map((r,i)=>(r.reached-base[i].reached)/episodes);
    const ci=interval(diff,9283);
    summary.push({profile,noise,method,layouts,episodes:rows.length*episodes,...tot,reachLo:lo,reachHi:hi,
      vsAstar:mean(diff),deltaLo:ci[0],deltaHi:ci[1],
      energyOnSuccess:rows.reduce((s,r)=>s+r.successEnergy,0)/Math.max(1,rows.reduce((s,r)=>s+r.reached,0))});
  }
}
csv('layouts.csv',layoutRows);csv('policies.csv',summary);csv('timings.csv',timing);
// Low-level comparison on a separate geometry corpus. Each solver sees every pair.
for(let i=0;i<500;i++) {
  const rng=P.random(P.hash('shooting-benchmark',i)),a=S.icon('a',0,4,2,'A'),
    b=S.icon('b',(rng()<.5?-1:1)*(.5+8*rng()),.8+6.5*rng(),.55+2.4*rng(),'B');
  for(const method of ['grid','gd','gn']) {
    const start=performance.now();const q=P.shoot(a,b,method);const ms=performance.now()-start;
    const hit=q?P.contact(P.trajectory(a,q),[a,b]):null;
    shooting.push({pair:i,method,dx:b.x,dy:b.y-a.y,width:b.w,feasible:+!!q,
      certified:+!!(hit?.safe && hit.icon==='b'),ms,error:q?.error??'',energy:q?.energy??'',
      speed:q?.speed??'',evaluations:q?.evals??''});
  }
}
csv('shooting.csv',shooting);
// Each edit changes the physical scene for both policies. Stale planning keeps the OLD graph.
for(let i=0;i<120;i++) {
  const seed=400000+i,scene=S.generate(seed,'standard'),opts={noise:1,samples:64,seed:P.hash('edit-mc',seed)};
  const original=new H.Graph(scene.icons,opts);
  const nominal=H.plan(original,scene.start,scene.goal,scene.energy).path;
  const victim=nominal.find(e=>e.to!==scene.goal)?.to||scene.icons[1].id;
  const p=scene.icons.find(x=>x.id===victim);
  const type=['add','move','delete'][i%3];
  let next=scene.icons.map(x=>({...x}));
  if(type==='delete') next=next.filter(x=>x.id!==victim);
  else if(type==='move') next=next.map(x=>x.id===victim?{...x,x:x.x+.6,y:x.y+1.4}:x);
  else if(nominal.length) {
    const f=P.trajectory(original.byId.get(nominal[0].from),nominal[0].q);
    const s=P.at(f,.87*nominal[0].q.T);
    next.push(S.icon('new',s.x,s.y,1.8,'New icon'));
  } else next.push(S.icon('new',p.x+.7,p.y+1,1.8,'New icon'));
  const incremental=new H.Graph(scene.icons,opts), t=performance.now();
  const stats=incremental.update(next);const newRoute=H.plan(incremental,scene.start,scene.goal,scene.energy);
  const incrementalMs=performance.now()-t,t2=performance.now(), rebuilt=new H.Graph(next,opts);
  const fullRoute=H.plan(rebuilt,scene.start,scene.goal,scene.energy),fullMs=performance.now()-t2;
  const match=incremental.edges.size===rebuilt.edges.size && [...rebuilt.edges].every(([k,e])=>incremental.edges.get(k)?.p===e.p);
  if(!match || newRoute.value!==fullRoute.value) throw new Error('Incremental mismatch at '+seed);
  for(const mode of ['updated','frozen']) {
    let reached=0,fallen=0,stranded=0;
    const graph=mode==='updated'?incremental:original,cache=new Map();
    for(let j=0;j<32;j++) {
      const r=new E.Run(scene,{graph,cache,seed:P.hash('edited-flight',seed,j)});
      // Only the ablation uses stale transitions. Both executions collide with the edited icons.
      r.icons=next;
      while(r.mode==='Landed'&&r.current!==r.goal&&r.jumps<40&&r.launch()) r.advance(10);
      if(r.mode==='Failed')fallen++;else if(r.current===r.goal)reached++;else stranded++;
    }
    edits.push({seed,type,mode,episodes:32,reached,fallen,stranded,incrementalMs,fullMs,
      affectedSolves:stats.solves,fullSolves:next.length*(next.length-1),matched:+match});
  }
}
csv('edits.csv',edits);
const low=['grid','gd','gn'].map(method=>{
  const a=shooting.filter(r=>r.method===method),ok=a.filter(r=>r.certified);
  return {method,pairs:a.length,certified:ok.length,violations:a.filter(r=>r.feasible&&!r.certified).length,
    medianMs:quantile(a.map(r=>r.ms),.5),p95Ms:quantile(a.map(r=>r.ms),.95),
    error:mean(ok.map(r=>r.error)),energy:mean(ok.map(r=>r.energy))};
});
const dynamic=['updated','frozen'].map(mode=>{const a=edits.filter(e=>e.mode===mode);
  return {mode,layouts:a.length,episodes:a.length*32,reached:mean(a.map(e=>e.reached/32)),
    fallen:mean(a.map(e=>e.fallen/32)),stranded:mean(a.map(e=>e.stranded/32)),
    medianMs:quantile(a.map(e=>e.incrementalMs),.5),p95Ms:quantile(a.map(e=>e.incrementalMs),.95),
    fullMedianMs:quantile(a.map(e=>e.fullMs),.5),fullP95Ms:quantile(a.map(e=>e.fullMs),.95),
    matches:a.reduce((s,e)=>s+e.matched,0)};});
const results={layouts,episodes,summary,low,dynamic,environment:{node:process.version,platform:process.platform,
  cpu:require('node:os').cpus()[0]?.model}};
fs.writeFileSync(path.join(outdir,'benchmark.json'),JSON.stringify(results,null,2)+'\n');
console.table(summary.filter(r=>r.profile==='standard'&&r.noise===1).map(({method,reached,fallen,stranded,energy})=>({method,reached,fallen,stranded,energy})));
console.table(low);console.table(dynamic);

