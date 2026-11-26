// In-flight edits are checked against the original takeoff parabola, independently
// of the engine's method of restarting the trajectory segment at the edit time.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const P=require('../physics'),S=require('../scenes'),E=require('../engine');
const args=Object.fromEntries(process.argv.slice(2).map(t=>t.slice(2).split('=')));
const total=Number(args.layouts||360);
if(!Number.isSafeInteger(total)||total<1)throw new Error('Provide a positive layout count');
const dest=path.resolve(args.out||path.join(__dirname,'../results/flight-edits-audit-local.json'));
fs.mkdirSync(path.dirname(dest),{recursive:true});
const audit={started:new Date().toISOString(),firstSeed:2200000,requested:total,layouts:0,noFirstAction:0,
  flights:0,edits:0,states:0,landed:0,failed:0,groups:{},maxStateError:0,maxTimeError:0,maxSpeedError:0};
function snapshot(){
  audit.updated=new Date().toISOString();fs.writeFileSync(dest,JSON.stringify(audit,null,2)+'\n');
}
function compare(a,b,tag,seed){
  const err=Math.abs(a-b);
  if(!(err<1e-7))throw new Error(tag+' mismatch in layout '+seed+' ('+a+' versus '+b+')');
  return err;
}
function futureContact(f,platforms,after){
  function crossing(y){
    const c=f.y-y,disc=f.vy*f.vy-2*f.ay*c;
    if(disc<0)return Infinity;
    const root=Math.sqrt(disc);
    const roots=Math.abs(f.ay)<1e-9?[-c/f.vy]:[(-f.vy+root)/f.ay,(-f.vy-root)/f.ay];
    return roots.find(t=>t>after+1e-5 && f.vy+f.ay*t< -1e-6)??Infinity;
  }
  let time=Math.min(after+4,crossing(0)),id=null;
  for(const p of platforms){
    const t=crossing(p.y);
    if(!Number.isFinite(t)||t>time)continue;
    const x=f.x+f.vx*t+.5*f.ax*t*t;
    if(Math.abs(x-p.x)>p.w/2-P.C.footMargin)continue;
    if(t<time||id===null||p.id<id){time=t;id=p.id;}
  }
  const speed=Math.hypot(f.vx+f.ax*time,f.vy+f.ay*time);
  return {time,id,speed,safe:id!==null&&speed<=P.C.safeSpeed};
}
function alter(run,original,kind,stage,rng) {
  const icons=run.icons.map(p=>({...p})),f=run.flight;
  const last=f.segmentStart+f.hit.time;
  const selected=icons.find(p=>p.id===f.hit.icon)||icons[Math.floor(rng()*icons.length)];
  if(kind==='delete'&&selected)return icons.filter(p=>p.id!==selected.id);
  if(kind==='move'&&selected){
    selected.x+=2*rng()-1;selected.y=Math.max(.3,selected.y+1.4*rng()-.7);selected.w=.45+2.7*rng();return icons;
  }
  // Sample a new support along or beside the current ballistic path. Some probes
  // lie behind the current state to exercise already-passed descending crossings.
  const probe=stage%2?f.elapsed*(.3+.6*rng()):f.elapsed+(last-f.elapsed)*(.2+.6*rng());
  const pos=P.at(original,probe);
  icons.push(S.icon('probe-'+stage,pos.x+(rng()-.5)*.8,Math.max(.2,pos.y),.55+2*rng(),'Probe'));
  return icons;
}
let lastWrite=Date.now();
for(let i=0;i<total;i++){
  const seed=audit.firstSeed+i,profile=['standard','sparse','stress'][i%3],s=S.generate(seed,profile);
  const noise=[.5,1,1.7][Math.floor(i/9)%3],run=new E.Run(s,{noise,seed:P.hash('flight-edit-execution',seed),
    graphOptions:{noise:1,samples:24,seed:P.hash('flight-edit-graph',seed)}});
  const edge=run.plan().path[0]||run.graph.out.get(s.start).find(e=>e.q.energy<=s.energy);
  audit.layouts++;
  if(!edge){audit.noFirstAction++;continue;}
  audit.flights++;run.fire(edge);
  const original={...run.flight.f},rng=P.random(P.hash('flight-edit-probes',seed));
  let expected;
  for(let stage=0;stage<3;stage++){
    const f=run.flight,remaining=f.segmentStart+f.hit.time-f.elapsed;
    if(remaining<.0001)break;
    run.advance(remaining*(.16+.48*rng()));
    const t=f.elapsed,before=run.position(),kind=['add','move','delete'][(Math.floor(i/3)+stage)%3];
    const next=alter(run,original,kind,stage,rng);
    run.edit(next);
    const after=run.position(),truth=P.at(original,t);
    for(const key of ['x','y','vx','vy']){
      audit.maxStateError=Math.max(audit.maxStateError,compare(before[key],after[key],key,seed),compare(truth[key],after[key],key,seed));
    }
    audit.states++;audit.edits++;const group=profile+'/'+kind;
    audit.groups[group]=(audit.groups[group]||0)+1;
    expected=futureContact(original,next,t);
    const actual=run.flight.hit;
    if(actual.icon!==expected.id||actual.safe!==expected.safe)throw new Error('Contact mismatch in '+seed+' at edit '+stage);
    audit.maxTimeError=Math.max(audit.maxTimeError,compare(t+actual.time,expected.time,'contact time',seed));
    audit.maxSpeedError=Math.max(audit.maxSpeedError,compare(actual.speed,expected.speed,'contact speed',seed));
  }
  expected=expected||futureContact(original,run.icons,0);
  run.advance(10);
  const landed=expected.safe&&expected.id===edge.to;
  if((run.mode==='Landed')!==landed||(run.mode==='Landed'&&run.current!==edge.to))throw new Error('Wrong terminal outcome '+seed);
  compare(run.energy,s.energy-edge.q.energy,'stamina debit',seed);
  if(landed)audit.landed++;else audit.failed++;
  if(Date.now()-lastWrite>30000){snapshot();lastWrite=Date.now();}
}
snapshot();console.log(JSON.stringify(audit));
