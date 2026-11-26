// Interventions during real flights or after touchdown, with identical pre-edit histories.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine');
const rows=[],summary=[];
function change(r,kind,edge) {
  let icons=r.icons.map(p=>({...p}));
  const target=icons.find(p=>p.id===edge.to);
  // Preserve the selected task goal so the target-reaching metric is defined.
  if(kind==='delete'&&target.id===r.goal) return null;
  if(kind==='move')return icons.map(p=>p.id===edge.to?{...p,x:p.x+.8,y:p.y+1.0}:p);
  if(kind==='delete')return icons.filter(p=>p.id!==edge.to);
  const f=P.trajectory(r.graph.byId.get(edge.from),edge.q),p=P.at(f,.88*edge.q.T);
  icons.push(S.icon('insert',p.x,p.y,1.5,'Added'));return icons;
}
const N=90,K=16;
for(let i=0;i<N;i++) {
  const seed=610000+i,s=S.generate(seed),kind=['add','move','delete'][i%3];
  const opts={noise:1,seed:P.hash('intervention',seed),samples:64};
  for(const phase of ['airborne','after landing'])for(const mode of ['updated','frozen']) {
    const row={seed,kind,phase,mode,episodes:K,triggered:0,reached:0,fallen:0,stranded:0,reachedTriggered:0,changedVelocity:0};
    for(let k=0;k<K;k++) {
      const r=new E.Run(s,{graphOptions:opts,seed:P.hash('online-flight',seed,k)});
      let edited=false;
      while(r.mode==='Landed'&&r.current!==r.goal&&r.jumps<40) {
        if(phase==='after landing'&&r.jumps===1) {
          const edge=r.plan().path[0],next=edge?change(r,kind,edge):null;
          if(next){r.edit(next,{freezeGraph:mode==='frozen'});edited=true;}
        }
        if(!r.launch())break;
        if(phase==='airborne'&&r.jumps===1) {
          r.advance(.35*r.flight.hit.time);
          const next=change(r,kind,r.flight.edge),pre=r.position();
          if(next) {
            r.edit(next,{freezeGraph:mode==='frozen'});edited=true;
            const post=r.position();
            if(['x','y','vx','vy'].some(v=>Math.abs(pre[v]-post[v])>1e-9))row.changedVelocity++;
          }
        }
        r.advance(10);
      }
      const win=r.current===r.goal&&r.mode==='Landed';
      row.triggered+=+edited;row.reached+=+win;row.fallen+=+(r.mode==='Failed');
      row.stranded+=+(!win&&r.mode!=='Failed');row.reachedTriggered+=+(edited&&win);
    }
    rows.push(row);
  }
}
for(const phase of ['airborne','after landing'])for(const mode of ['updated','frozen']) {
  const sub=rows.filter(r=>r.phase===phase&&r.mode===mode),total=k=>sub.reduce((v,r)=>v+r[k],0);
  summary.push({phase,mode,episodes:total('episodes'),triggered:total('triggered'),reached:total('reached'),
    fallen:total('fallen'),stranded:total('stranded'),reachedTriggered:total('reachedTriggered'),
    continuityViolations:total('changedVelocity')});
}
const dir=path.join(__dirname,'../results');
fs.writeFileSync(path.join(dir,'online-edits.csv'),[Object.keys(rows[0]).join(','),...rows.map(r=>Object.values(r).join(','))].join('\n')+'\n');
fs.writeFileSync(path.join(dir,'online-edits.json'),JSON.stringify(summary,null,2)+'\n');
console.table(summary);

