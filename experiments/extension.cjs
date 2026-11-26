// Independent validation of the optional wind-exposure controller.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine');
const dir=path.join(__dirname,'../results'),rows=[],summary=[];
const N=120,K=64;
function pairedCI(values) {
  const rng=P.random(23411),means=[];
  for(let b=0;b<2000;b++){let s=0;for(let i=0;i<values.length;i++)s+=values[Math.floor(rng()*values.length)];means.push(s/values.length);}
  means.sort((a,b)=>a-b);return [means[49],means[1949]];
}
for(const [profile,noise,offset] of [['standard',1,510000],['standard',1.7,510000],['sparse',1,520000],['stress',1,530000]]) {
  const condition=[];
  for(let i=0;i<N;i++) {
    const seed=offset+i,s=S.generate(seed,profile),opts={noise,seed:P.hash('factorial-mc',seed),samples:64};
    for(const solver of ['gn','exposure']) {
      const graph=new H.Graph(s.icons,{...opts,solver}),cache=new Map();
      for(const method of ['astar','vi']) {
        const row={profile,noise,seed,solver,method,episodes:K,reached:0,fallen:0,stranded:0,energy:0,cost:0,successEnergy:0};
        for(let k=0;k<K;k++) {
          const out=E.episode(s,{graph,cache,method,noise,seed:P.hash('factorial-flight',seed,k)});
          for(const m of ['reached','fallen','stranded','energy','cost'])row[m]+=out[m];
          if(out.reached)row.successEnergy+=out.energy;
        }
        rows.push(row);condition.push(row);
      }
    }
  }
  for(const solver of ['gn','exposure']) for(const method of ['astar','vi']) {
    const sub=condition.filter(r=>r.solver===solver&&r.method===method),ref=condition.filter(r=>r.solver==='gn'&&r.method===method);
    const sum=k=>sub.reduce((s,v)=>s+v[k],0);
    const paired=sub.map((v,i)=>(v.reached-ref[i].reached)/K),delta=paired.reduce((s,v)=>s+v,0)/N;
    const metric={profile,noise,solver,method,layouts:N,episodes:N*K,reached:sum('reached')/(N*K),fallen:sum('fallen')/(N*K),
      stranded:sum('stranded')/(N*K),energy:sum('energy')/(N*K),successEnergy:sum('successEnergy')/sum('reached'),
      cost:sum('cost')/(N*K),delta,deltaCI:pairedCI(paired)};
    summary.push(metric);
  }
}
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'extension-layouts.csv'),[Object.keys(rows[0]).join(','),...rows.map(r=>Object.values(r).join(','))].join('\n')+'\n');
fs.writeFileSync(path.join(dir,'extension.json'),JSON.stringify(summary,null,2)+'\n');
console.table(summary.filter(r=>r.method==='vi').map(({profile,noise,solver,reached,energy,delta})=>({profile,noise,solver,reached,energy,delta})));

