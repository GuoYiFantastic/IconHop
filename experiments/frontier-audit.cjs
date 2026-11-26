// Cross-check two-objective route labels with an independent scalar Bellman DP.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),F=require('../frontier');
const flags=Object.fromEntries(process.argv.slice(2).map(a=>a.slice(2).split('=')));
const count=Number(flags.layouts||360);
if(!Number.isSafeInteger(count)||count<1)throw new Error('Provide a positive integer layout count');
const file=path.resolve(flags.out||path.join(__dirname,'../results/frontier-audit-local.json'));
fs.mkdirSync(path.dirname(file),{recursive:true});
const weights=[0,15,50,120],thresholds=[0,.6,.85,.95,1];
const report={firstSeed:1100000,requested:count,started:new Date().toISOString(),completed:0,
  scalarChecks:0,explicitPathChecks:0,exhaustiveChecks:0,maxValueError:0,maxLabelError:0,profiles:{}};

function difference(a,b) {
  return a===b?0:Math.abs(a-b);
}
function write() {
  report.updated=new Date().toISOString();
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
}
function scalarValue(scene,edges,budget,lambda) {
  const n=scene.icons.length,ix=new Map(scene.icons.map((p,i)=>[p.id,i]));
  const actions=edges.map(e=>({i:ix.get(e.from),j:ix.get(e.to),e}));
  const g=ix.get(scene.goal),v=new Float64Array((budget+1)*n).fill(Infinity);
  for(let b=0;b<=budget;b++){
    v[b*n+g]=0;
    for(const {i,j,e} of actions){
      if(i===g||e.bins>b)continue;
      const next=v[(b-e.bins)*n+j];
      if(!Number.isFinite(next))continue;
      const cost=e.q.energy+e.p*next+(1-e.p)*lambda;
      if(cost<v[b*n+i])v[b*n+i]=cost;
    }
  }
  return v[budget*n+ix.get(scene.start)];
}
function checkPaths(scene,budget,labels) {
  let previousP=Infinity,previousE=Infinity;
  for(const label of labels){
    if(label.reach>previousP||label.energy>=previousE)throw new Error('Dominated or unordered label '+scene.id);
    let id=scene.start,p=1,energy=0,b=budget;
    for(let node=label;node.edge;node=node.next){
      const e=node.edge;
      if(e.from!==id||e.bins>b)throw new Error('Invalid label action '+scene.id);
      energy+=p*e.q.energy;p*=e.p;b-=e.bins;id=e.to;
    }
    if(id!==scene.goal)throw new Error('Label did not end at goal '+scene.id);
    const error=Math.max(Math.abs(p-label.reach),Math.abs(energy-label.energy));
    if(error>1e-8)throw new Error('Bad label backpointer '+scene.id);
    report.maxLabelError=Math.max(report.maxLabelError,error);
    report.explicitPathChecks++;previousP=label.reach;previousE=label.energy;
  }
}
function exhaustive(scene,graphs,energy) {
  const values=thresholds.map(()=>Infinity);
  let maxP=-1,minAtMax=Infinity;
  function visit(id,b,p,used){
    if(id===scene.goal){
      if(p>maxP){maxP=p;minAtMax=used;}else if(p===maxP)minAtMax=Math.min(minAtMax,used);
      thresholds.forEach((t,j)=>{if(p+1e-12>=t)values[j]=Math.min(values[j],used);});return;
    }
    for(const g of graphs)for(const e of g.out.get(id))if(e.bins<=b)
      visit(e.to,b-e.bins,p*e.p,used+p*e.q.energy);
  }
  visit(scene.start,H.budget(energy),1,0);
  const s=F.solve(graphs,scene.start,scene.goal,energy);
  thresholds.forEach((t,j)=>{
    const actual=F.choose(s,t);
    if(actual.hasRoute!==(maxP>=0)||actual.meetsTarget!==Number.isFinite(values[j]))
      throw new Error('Exhaustive feasibility disagreement '+scene.id);
    if(maxP>=0){
      const expected=Number.isFinite(values[j])?values[j]:minAtMax;
      if(Math.abs(actual.energy-expected)>1e-8)throw new Error('Exhaustive optimum disagreement '+scene.id);
    }
    report.exhaustiveChecks++;
  });
}
let last=Date.now();
for(let i=0;i<count;i++) {
  const profile=['standard','sparse','stress'][i%3],seed=report.firstSeed+i,scene=S.generate(seed,profile);
  const options={noise:1,samples:32,seed:P.hash('frontier-verification',seed)};
  const graphs=['gn','exposure'].map(solver=>new H.Graph(scene.icons,{...options,solver}));
  const budget=H.budget(scene.energy),f=F.solve(graphs,scene.start,scene.goal,scene.energy);
  const edges=graphs.flatMap(g=>[...g.edges.values()]);
  for(const lambda of weights){
    const expected=scalarValue(scene,edges,budget,lambda);
    const best=f.frontier.reduce((v,r)=>Math.min(v,r.energy+lambda*(1-r.reach)),Infinity);
    const error=difference(expected,best);
    if(!(error<1e-8))throw new Error('Bellman disagreement '+seed+' at '+lambda);
    report.maxValueError=Math.max(report.maxValueError,error);report.scalarChecks++;
  }
  checkPaths(scene,budget,f.frontier);
  // Reduced budgets bound exhaustive enumeration while retaining infeasible cases.
  if(i<300)exhaustive(scene,graphs,Math.min(21,scene.energy));
  const group=report.profiles[profile]||={layouts:0,empty:0,labels:0,maximumLabels:0};
  group.layouts++;group.empty+=Number(!f.frontier.length);group.labels+=f.frontier.length;
  group.maximumLabels=Math.max(group.maximumLabels,f.frontier.length);
  report.completed++;
  if(Date.now()-last>30000){write();last=Date.now();}
}
write();console.log(JSON.stringify(report));
