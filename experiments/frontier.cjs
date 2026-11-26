// Minimize expected stamina subject to a modelled route-reach threshold.
// Keep every generated layout, including those where the threshold is unavailable.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine'),F=require('../frontier');
const dir=path.join(__dirname,'../results');
const firstSeed=980000,layouts=240,trials=96,modelSamples=128;
const rows=[];

for(let i=0;i<layouts;i++) {
  const seed=firstSeed+i,scene=S.generate(seed,'standard');
  const options={noise:1,samples:modelSamples,seed:P.hash('frontier-training',seed)};
  const gn=new H.Graph(scene.icons,{...options,solver:'gn'}),expo=new H.Graph(scene.icons,{...options,solver:'exposure'});
  const one=F.solve([gn],scene.start,scene.goal,scene.energy);
  const two=F.solve([gn,expo],scene.start,scene.goal,scene.energy);
  const runs=[['GN A*',gn,'astar'],['GN greedy',gn,'greedy'],['GN VI',gn,'vi'],['Exposure VI',expo,'vi']];
  for(const threshold of [.70,.85,.95,.98]) {
    if(threshold===.85)runs.push(['GN frontier 85%',gn,'fixed',F.choose(one,threshold),threshold]);
    runs.push(['Both frontier '+Math.round(threshold*100)+'%',gn,'fixed',F.choose(two,threshold),threshold]);
  }
  for(const [method,graph,mode,route,threshold] of runs){
    const cache=new Map();let reached=0,spent=0,successEnergy=0,jumps=0;
    for(let j=0;j<trials;j++){
      const testSeed=P.hash('frontier-execution',seed,j);
      const out=mode==='fixed'?F.execute(scene,graph,route.path,testSeed):E.episode(scene,{graph,cache,method:mode,seed:testSeed});
      reached+=out.reached;spent+=out.energy;successEnergy+=out.reached*out.energy;jumps+=out.jumps;
    }
    rows.push({seed,method,trials,reached,spent,successEnergy,jumps,threshold:threshold??'',meetsTarget:route?+route.meetsTarget:'',
      modelReach:route?.reach??'',modelEnergy:route?.energy??'',noRoute:route?+!route.hasRoute:'',
      plannedJumps:route?.path.length??'',labelsAtStart:mode==='fixed'?(method.startsWith('Both')?two:one).frontier.length:''});
  }
}
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function interval(values){
  const rng=P.random(194071),means=[];
  for(let b=0;b<2000;b++){let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(rng()*values.length)];means.push(sum/values.length);}
  means.sort((a,b)=>a-b);return [means[49],means[1949]];
}
const baseline=rows.filter(r=>r.method==='GN VI'),summary=[];
for(const method of [...new Set(rows.map(r=>r.method))]){
  const group=rows.filter(r=>r.method===method),sum=k=>group.reduce((s,r)=>s+r[k],0);
  const reachDelta=group.map((r,i)=>(r.reached-baseline[i].reached)/trials);
  const energyDelta=group.map((r,i)=>(r.spent-baseline[i].spent)/trials);
  const compared={method,layouts,trials:layouts*trials,reach:sum('reached')/sum('trials'),energy:sum('spent')/sum('trials'),
    energyOnSuccess:sum('successEnergy')/sum('reached'),deltaReachVsGN:mean(reachDelta),reachDeltaInterval:interval(reachDelta),
    deltaEnergyVsGN:mean(energyDelta),energyDeltaInterval:interval(energyDelta)};
  if(group[0].threshold!==''){
    const feasible=group.filter(r=>r.meetsTarget);
    Object.assign(compared,{threshold:group[0].threshold,modelFeasibleLayouts:sum('meetsTarget'),noRouteLayouts:sum('noRoute'),
      predictedReach:sum('modelReach')/layouts,expectedEnergy:sum('modelEnergy')/layouts,
      conditionalRealizedReach:feasible.length?mean(feasible.map(r=>r.reached/trials)):null});
  }
  summary.push(compared);
}
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'frontier-layouts.csv'),[Object.keys(rows[0]).join(','),...rows.map(r=>Object.values(r).join(','))].join('\n')+'\n');
fs.writeFileSync(path.join(dir,'frontier.json'),JSON.stringify({firstSeed,layouts,trials,modelSamples,summary},null,2)+'\n');
console.table(summary.map(({method,reach,energy,energyOnSuccess,modelFeasibleLayouts})=>({method,reach,energy,energyOnSuccess,modelFeasibleLayouts})));
