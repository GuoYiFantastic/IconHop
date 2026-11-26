// Is finite stamina lost by rounding a continuous budget onto the MDP grid?
// Positive energy costs make shortest-energy paths an independent feasibility oracle.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes');
const startSeed=4800000,layoutsPerProfile=2400,resolutions=[2,1,.5,.25,.125];
function minimum(graph,start,goal,unit){
  const distance=new Map([[start,0]]),count=new Map([[start,0]]),visited=new Set();
  for(;;){
    let id=null,lowest=Infinity;
    for(const [node,c] of distance)if(!visited.has(node)&&c<lowest){id=node;lowest=c;}
    if(id===null)return {cost:Infinity,jumps:0};
    if(id===goal)return {cost:lowest,jumps:count.get(id)};
    visited.add(id);
    for(const edge of graph.out.get(id)){
      const weight=unit?Math.max(1,Math.ceil(edge.q.energy/unit-1e-10)):edge.q.energy;
      const next=lowest+weight;
      if(next<(distance.get(edge.to)??Infinity)){distance.set(edge.to,next);count.set(edge.to,count.get(id)+1);}
    }
  }
}
const summary=[];let defaultAgreements=0,precisionNesting=0;
const quantile=(values,q)=>values[Math.floor(q*(values.length-1))];
for(const [index,profile] of ['standard','sparse','stress'].entries()){
  const bins=resolutions.map(unit=>({profile,unit,layouts:0,connected:0,exactAffordable:0,discreteAffordable:0,
    lostToRounding:0,falseAffordable:0,nearBoundaryAffordable:0,overhead:[]}));
  for(let i=0;i<layoutsPerProfile;i++){
    const seed=startSeed+index*layoutsPerProfile+i,s=S.generate(seed,profile);
    const graph=new H.Graph(s.icons,{noise:1,samples:16,seed:P.hash('stamina-grid',seed)});
    const exact=minimum(graph,s.start,s.goal,0);
    const connected=Number.isFinite(exact.cost),affordable=connected && exact.cost<=s.energy+1e-9;
    let previous=false;
    for(const row of bins){
      const unit=row.unit,rounded=minimum(graph,s.start,s.goal,unit);
      const available=Math.floor(s.energy/unit+1e-9);
      const valid=rounded.cost<=available;
      row.layouts++;row.connected+=Number(connected);row.exactAffordable+=Number(affordable);
      row.discreteAffordable+=Number(valid);
      if(valid&&!affordable)throw new Error('Unaffordable path admitted on '+seed);
      if(unit!==resolutions[0]){
        if(previous&&!valid)throw new Error('Nested resolution lost an admitted path on '+seed);
        precisionNesting++;
      }
      previous=valid;
      row.lostToRounding+=Number(affordable&&!valid);
      if(connected){
        const overhead=rounded.cost*unit-exact.cost;
        if(overhead < -1e-8 || overhead>exact.jumps*unit+1e-8)throw new Error('Path rounding bound failed on '+seed);
        row.overhead.push(Math.max(0,overhead));
        // Set a separate diagnostic budget exactly 0.5 stamina units above the
        // least-cost physical route. Keep it distinct from the natural-budget test.
        row.nearBoundaryAffordable+=Number(rounded.cost<=Math.floor((exact.cost+.5)/unit+1e-9));
      }
      if(unit===P.C.bin){
        const result=H.plan(graph,s.start,s.goal,s.energy,'vi');
        if(Number.isFinite(result.value)!==valid)throw new Error('VI and rounded feasibility disagree on '+seed);
        defaultAgreements++;
      }
    }
  }
  for(const row of bins){
    row.overhead.sort((a,b)=>a-b);
    row.medianOverhead=quantile(row.overhead,.5);row.p95Overhead=quantile(row.overhead,.95);
    row.maxOverhead=row.overhead.at(-1);delete row.overhead;
    summary.push(row);
  }
}
const dir=path.join(__dirname,'../results');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'stamina-resolution.json'),JSON.stringify({startSeed,layoutsPerProfile,resolutions,defaultAgreements,precisionNesting,summary},null,2)+'\n');
console.table(summary.map(({profile,unit,exactAffordable,lostToRounding,connected,nearBoundaryAffordable,medianOverhead})=>({profile,unit,exactAffordable,lostToRounding,connected,nearBoundaryAffordable,medianOverhead})));
