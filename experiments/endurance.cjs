// A bounded, resumable randomized audit. Each block exercises both planning and edits.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine');
const args=Object.fromEntries(process.argv.slice(2).map(token=>token.replace(/^--/,'').split('=')));
const blocks=args.blocks===undefined?Infinity:Number(args.blocks);
const seconds=args.seconds===undefined?(args.blocks===undefined?60:Infinity):Number(args.seconds);
const end=args.until?Date.parse(args.until):Date.now()+seconds*1000;
if(Number.isNaN(end)||!(seconds>0)||!(blocks>0)||(Number.isFinite(blocks)&&!Number.isInteger(blocks)))
  throw new Error('Specify a positive duration or integer number of blocks');
const dest=path.resolve(args.out||path.join(__dirname,'../results/endurance-local.json'));
fs.mkdirSync(path.dirname(dest),{recursive:true});
const signature=crypto.createHash('sha256');
for(const f of ['physics.js','control.js','planner.js','scenes.js','engine.js','experiments/endurance.cjs'])
  signature.update(fs.readFileSync(path.join(__dirname,'..',f)));
const version=signature.digest('hex').slice(0,16);
const prior=fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):null;
if(prior && prior.version!==version) throw new Error('Resume requires the same model. Choose a new output path.');
const audit=prior||{version,started:new Date().toISOString(),blocks:0,episodes:0,editChecks:0,
  mdpChecks:0,violations:0,examples:[],cells:{},activeMilliseconds:0};
const modes=['standard','sparse','stress'],windScale=[0.5,1,1.5,2],samples=[24,64,128];
let last=Date.now(),lastSave=last;
function save() {
  const now=Date.now();audit.updated=new Date(now).toISOString();audit.activeMilliseconds+=now-last;last=now;
  fs.writeFileSync(dest+'.tmp',JSON.stringify(audit,null,2)+'\n');fs.renameSync(dest+'.tmp',dest);lastSave=now;
}
function violation(seed,what) {
  audit.violations++;if(audit.examples.length<24) audit.examples.push({seed,what});
}
function checkSame(a,b,seed) {
  if(a.edges.size!==b.edges.size) {violation(seed,'edge count after edit');return;}
  for(const [k,e] of a.edges) {
    const other=b.edges.get(k);
    if(!other||e.successes!==other.successes||Math.abs(e.q.J-other.q.J)>1e-8) {violation(seed,'edge mismatch '+k);return;}
  }
}
function edit(scene,index,rng) {
  const items=scene.icons.map(p=>({...p}));
  const between=items.filter(p=>p.id!==scene.start&&p.id!==scene.goal);
  const p=between[Math.floor(between.length*rng())];
  if(index%3===0) items.push(S.icon('added',2+rng()*14,0.8+rng()*6,0.45+rng()*2.5,'Added'));
  if(index%3===1) {p.x+=2*rng()-1;p.y=Math.max(.4,p.y+2*rng()-1);p.w=.4+3*rng();}
  if(index%3===2) return items.filter(it=>it.id!==p.id);
  return items;
}
function block(index) {
  const seed=7000000+index,profile=modes[index%modes.length],
    scale=windScale[Math.floor(index/modes.length)%windScale.length],
    n=samples[Math.floor(index/(modes.length*windScale.length))%samples.length];
  const scene=S.generate(seed,profile),opts={noise:1,samples:n,seed:P.hash('audit-mc',seed)};
  const graph=new H.Graph(scene.icons,opts), cache=new Map();
  const vi=H.plan(graph,scene.start,scene.goal,scene.energy,'vi');
  const pi=H.plan(graph,scene.start,scene.goal,scene.energy,'pi');
  if(vi.value!==pi.value && !(Math.abs(vi.value-pi.value)<1e-7)) violation(seed,'VI / PI disagreement');
  audit.mdpChecks++;
  for(const method of ['vi','astar']) {
    const key=[profile,scale,n,method].join('/'),c=audit.cells[key]||={layouts:0,episodes:0,reached:0,fallen:0,stranded:0,
      energy:0,cost:0,squaredLayoutReach:0};
    c.layouts++;let wins=0;
    for(let k=0;k<12;k++) {
      const out=E.episode(scene,{graph,cache,method,seed:P.hash('audit-rollout',seed,k),noise:scale});
      c.episodes++;audit.episodes++;wins+=out.reached;
      for(const m of ['reached','fallen','stranded','energy','cost']) c[m]+=out[m];
      if(out.energy>scene.energy+1e-8||out.reached+out.fallen+out.stranded!==1)
        violation(seed,'physical budget or terminal partition');
    }
    c.squaredLayoutReach+=(wins/12)**2;
  }
  const next=edit(scene,index,P.random(P.hash('audit-edit',seed)));
  graph.update(next);const rebuilt=new H.Graph(next,opts);
  checkSame(graph,rebuilt,seed);audit.editChecks++;audit.blocks++;
}
try {
  while(audit.blocks<blocks && Date.now()<end) {
    block(audit.blocks);
    if(Date.now()-lastSave>30000||audit.blocks===1) save();
  }
} finally {save();}
console.log(JSON.stringify({blocks:audit.blocks,episodes:audit.episodes,violations:audit.violations,updated:audit.updated}));

