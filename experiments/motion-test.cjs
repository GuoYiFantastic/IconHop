'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../physics'),G=require('../ground'),S=require('../scenes'),E=require('../engine');
const {C}=P;
function replay(run,hz){
  let frames=0;
  for(;frames<60*hz;frames++){
    if(!run.flight&&!run.dock&&!run.preparation&&!run.compression){
      if(run.arrived())return frames/hz;
      assert.ok(run.requestJump(),'could not continue from '+run.current+' to '+run.goal);
    }
    const before=run.position();run.advance(1/hz);
    assert.notEqual(run.mode,'Failed');
    const after=run.position();
    const speedBound=Math.max(Math.hypot(before.vx,before.vy)+C.g/hz,Math.hypot(after.vx,after.vy),C.maxJ/C.mass+Math.abs(run.lastShot?.runup?.vx||0));
    assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<speedBound/hz+.0001,'discontinuous position');
  }
  assert.fail('could not settle at the goal within 60 s');
}

test('the staggered desktop route settles at Work across frame rates',()=>{
  for(const hz of [24,60,144]){
    const r=new E.Run(S.get('work'),{free:true});r.select('work',{pin:true});
    const plan=r.plan();assert.equal(plan.path.filter(e=>e.q).length,4);
    const seconds=replay(r,hz);assert.equal(r.jumps,4);
    assert.ok(Math.abs(seconds-plan.value)<(plan.path.length+1)/hz);
    assert.ok(Math.abs(r.position().x-r.goalPoint())<1e-8);
    assert.equal(r.goal,'work');
  }
});
test('moving Step connects the taskbar to an otherwise unreachable Archive',()=>{
  const run=new E.Run(S.get('bridge'),{free:true,barWidth:18.6});
  const archive=run.surface('archive');
  run.select('archive',{pin:true,x:archive.x});
  assert.equal(run.current,G.BAR);
  assert.equal(run.position().x,archive.x);
  assert.equal(run.plan().value,Infinity);
  run.edit(run.icons.map(icon=>icon.id==='step'?{...icon,x:9.76,y:2.72}:icon));
  assert.equal(run.goal,'archive');
  assert.equal(run.pinnedGoalName,'Archive');
  assert.deepEqual(run.plan().path.filter(edge=>edge.q).map(edge=>edge.to),['step','archive']);
  replay(run,60);
  assert.deepEqual(run.history.map(landing=>landing.actual),['step','archive']);
});
test('reported desktop: a descent to the taskbar, walking and a running takeoff reach Work',()=>{
  for(const hz of [24,60,144]){
    const r=new E.Run(S.get('runup'),{free:true,barWidth:17.33});
    r.select('work',{pin:true,x:r.surface('work').x-.02});
    const actions=r.plan().path;
    const landings=[G.BAR,'notes','mail','work'];
    assert.deepEqual(actions.filter(e=>e.q).map(e=>e.to),landings);
    assert.ok(actions.some(e=>e.kind==='walk'&&e.from===G.BAR&&Math.abs(e.target-e.x)>2));
    const measured=[];
    function perform(e){
      const start=r.position();
      assert.ok(r.requestJump());r.advance(8);
      if(e.q)measured.push(Math.abs(r.position().x-(e.runup?e.launchX:start.x)));
    }
    // Execute the real prefix before checking the impulse on Notes.txt.
    for(let i=0;r.current!=='notes'&&i<8;i++)perform(r.plan().path[0]);
    assert.equal(r.current,'notes');
    if(r.plan().path[0].kind==='walk')perform(r.plan().path[0]);
    const start=r.position(),first=r.plan().path[0],u=first.runup;
    assert.ok(u&&Math.abs(u.vx)<=3.2);
    assert.ok(r.requestJump());r.advance(C.crouchTime);assert.equal(r.position().x,start.x);assert.ok(Math.abs(r.position().vx)<1e-8);
    r.advance(u.duration/2);
    assert.ok(Math.abs(r.position().x-(start.x+Math.sign(u.vx)*P.pushOff.friction*C.g*(u.duration/2)**2/2))<1e-8);
    assert.ok(Math.abs(r.position().vx-u.vx/2)<1e-8);
    r.advance(u.duration/2);assert.ok(r.flight);
    const f=r.flight.f;
    assert.ok(Math.abs(f.x-first.launchX)<1e-8);
    assert.ok(Math.abs(C.mass*Math.hypot(f.vx-u.vx,f.vy)-first.q.J)<1e-8);
    assert.ok(first.q.J<=P.pushImpulse+1e-8);
    replay(r,hz);
    assert.deepEqual(r.history.map(e=>e.actual),landings);
    assert.ok(measured.some(dx=>dx>3.2));
    assert.ok(actions.filter(e=>e.q).every(e=>P.canPush(e.q.J*Math.cos(e.q.theta),e.q.J*Math.sin(e.q.theta))));
    assert.ok(r.history.every(e=>e.safe));assert.ok(r.history[0].speed>C.safeSpeed);assert.equal(r.goal,'work');
  }
});
test('changing the target or removing the support during a run-up discards the pending impulse',()=>{
  for(const edit of ['target','support']){
    const r=new E.Run({...S.get('runup'),start:'notes',startX:15.36},{free:true});r.select('work',{pin:true});
    r.requestJump();r.advance(C.crouchTime+.08);
    const p=r.position();assert.ok(p.vx<0&&r.dock.runup);
    if(edit==='target'){
      r.select('music',{pin:true});assert.equal(r.dock,null);
      r.advance(.2);assert.equal(r.position().x,p.x);assert.equal(r.goal,'music');
    }else{
      r.edit(r.icons.filter(i=>i.id!=='notes'));
      assert.deepEqual(r.position(),p);assert.equal(r.goal,'work');assert.ok(r.flight.release);
    }
    assert.equal(r.jumps,0);
  }
});
test('an isolated vertical stack can bank off either side without a relay or falling through its starting ledge',()=>{
  for(const mirror of [false,true])for(const offset of [-.22,0,.18])for(const hz of [24,60,144]){
    const width=17.33,s=S.get('stack'),x=mirror?width-.86:.86;
    for(const p of s.icons)p.x=x;
    const r=new E.Run({...s,startX:x-offset/2},{free:true,barWidth:width});
    r.select('pc',{pin:true,x:x+offset});
    const plan=r.plan(),shots=plan.path.filter(e=>e.q);
    assert.equal(shots.length,1);const shot=shots[0],wall=mirror?width-C.bodyRadius:C.bodyRadius;
    assert.equal(shot.wall,wall);
    const from={...r.surface('bin'),x:shot.launchX,vx:shot.runup?.vx||0};
    const f=P.trajectory(from,shot.q),tw=(wall-f.x)/f.vx;
    assert.ok(tw>0&&tw<shot.q.T);
    const reflected={...f,walls:shot.walls},delta=1e-7;
    for(const at of [tw-delta,tw,tw+delta,shot.q.T]){
      const p=P.at(reflected,at),straight=P.at(f,at);
      assert.ok(Math.abs(p.x-(at<tw?straight.x:wall-C.wallRestitution*f.vx*(at-tw)))<1e-8);
      assert.equal(p.vy,straight.vy);assert.equal(p.y,straight.y);
    }
    assert.ok(Math.abs(P.at(reflected,tw-delta).vx*C.wallRestitution+P.at(reflected,tw+delta).vx)<1e-8);
    const pass=P.descendingTime(f,from.y);
    if(Number.isFinite(pass))assert.ok(Math.abs(P.at(reflected,pass).x-x)>r.surface('bin').w/2-C.footMargin);
    const hit=P.contact(reflected,r.icons);
    assert.equal(hit.icon,'pc');assert.ok(hit.safe);assert.ok(P.canPush(shot.q.J*Math.cos(shot.q.theta),shot.q.J*Math.sin(shot.q.theta)));
    replay(r,hz);assert.equal(r.jumps,1);assert.ok(Math.abs(r.position().x-x-offset)<G.tolerance);
  }
});
test('the planner uses the saved foot position even within a few nanometres of a sampled ledge',()=>{
  for(const offset of [3e-9,9e-9]){
    const r=new E.Run({...S.get('stack'),startX:.6+offset},{free:true,barWidth:17.33});
    r.select('pc',{pin:true});replay(r,60);
    assert.equal(r.current,'pc');assert.equal(r.history.length,1);assert.equal(r.history[0].actual,'pc');
  }
});
test('reflected paths keep first contact after an airborne edit, including a blocker on the return leg',()=>{
  for(const when of ['outbound','inbound']){
    const r=new E.Run(S.get('stack'),{free:true});r.select('pc',{pin:true});
    const shot=r.plan().path[0];assert.ok(r.requestJump());
    r.advance(C.crouchTime+(shot.runup?.duration||0)+.005);assert.ok(r.flight);
    const f=r.flight.f,tw=(shot.wall-f.x)/f.vx;
    if(when==='inbound')r.advance(tw+.01);
    const before=r.position(),future=P.at(f,(tw+shot.q.T)/2);
    r.edit([...r.icons,S.icon('blocker',future.x,future.y,.37,'Blocker')]);
    assert.deepEqual(r.position(),before);assert.equal(r.flight.hit.icon,'blocker');assert.equal(r.goal,'pc');
    r.advance(4);assert.equal(r.current,'blocker');assert.equal(r.history[0].actual,'blocker');
  }
  const s=S.get('stack');for(const p of s.icons)p.x=8;
  const isolated=new E.Run(s,{free:true,barWidth:17.33});
  assert.equal(isolated.plan().value,Infinity,'no reachable wall or relay in the middle of the desktop');
});
test('walking across a relay and temporarily jumping away from the goal',()=>{
  const cases=[
    [[2,3.5,2.6],[7.1,5.8,3],[12.2,8,2.5]],
    [[5,1,.66],[2.3,3.5,.66],[5.6,5.8,.66],[8.9,7.8,.66]]
  ];
  for(const [i,points] of cases.entries()){
    const icons=points.map((a,j)=>S.icon('i'+j,...a,'Folder '+j));
    const r=new E.Run({icons,desktop:true,noise:0,start:'i0',goal:icons.at(-1).id,energy:0},{free:true});
    const p=r.plan().path;
    if(i===0)assert.ok(p.some(e=>e.from==='i1'&&e.kind==='walk'&&e.target-e.x>1.5));
    else assert.ok(p[0].landX<p[0].launchX);
    replay(r,60);
  }
});
test('the reported high Recycle Bin can reach every other icon and the taskbar',()=>{
  const s=S.get('high-bin');
  for(const id of [...s.icons.map(p=>p.id).filter(id=>id!=='bin'),G.BAR]){
    const r=new E.Run(s,{free:true,barWidth:19.55});r.select(id,{pin:true});
    replay(r,60);assert.equal(r.current,id);assert.ok(r.history[0].speed>C.safeSpeed);
  }
});
test('an unreachable goal keeps the pet exploring, then a relay opens a route to the same goal',()=>{
  const s=S.get('stack');
  s.icons=[S.icon('a',5,1,.66,'Start'),S.icon('b',10,6.5,.66,'Goal')];s.start='a';s.goal='b';
  const r=new E.Run(s,{free:true});r.select('b',{pin:true});
  const positions=new Set();
  for(let i=0;i<8;i++){
    assert.equal(r.plan().value,Infinity);assert.ok(r.explore());r.advance(8);
    assert.notEqual(r.mode,'Failed');assert.equal(r.goal,'b');positions.add(r.position().x.toFixed(3));
  }
  assert.ok(positions.size>2);assert.ok(r.history.some(h=>h.safe));assert.equal(r.explorationAttempt,8);
  r.edit([...s.icons,S.icon('bridge',10,3.3,.66,'Relay')]);
  assert.ok(r.plan().path.length);replay(r,60);assert.equal(r.current,'b');
});
test('a near-limit vertical jump needs a finer takeoff position on the lower support',()=>{
  const icons=[S.icon('lower',4,4,2.14,'Lower'),S.icon('upper',4.25,7.4925,.35,'Upper')];
  const r=new E.Run({icons,desktop:true,noise:0,start:'lower',goal:'upper',energy:0},{free:true});
  assert.equal(r.plan().spacing,.25);
  replay(r,60);
  assert.equal(r.jumps,1);
});
test('the same push gives the ballistic apex, greater downhill range, and additional range from a running start',()=>{
  const a=S.icon('a',5,4,.66,'A');
  const {duration,peakForce,friction}=P.pushOff;
  const maxJ=peakForce*duration/2,vertical={J:maxJ,theta:Math.PI/2};
  const v0=maxJ/C.mass;
  assert.ok(Math.abs(P.at(P.trajectory(a,vertical),v0/C.g).y-a.y-v0*v0/(2*C.g))<1e-9);
  assert.ok(P.canPush(0,maxJ)&&!P.canPush(0,maxJ+.001));
  for(const direction of [-1,1]){
    const jy=7,jx=direction*friction*(jy+C.mass*C.g*duration/2);
    assert.ok(P.canPush(jx,jy)&&!P.canPush(jx*1.001,jy));
    const q={J:Math.hypot(jx,jy),theta:Math.atan2(jy,jx)};
    const flight=P.trajectory(a,q),running=P.trajectory({...a,vx:direction*1.3},q);
    const level=P.descendingTime(flight,a.y),lower=P.descendingTime(flight,a.y-1);
    assert.ok(Math.abs(P.at(flight,lower).x-a.x)>Math.abs(P.at(flight,level).x-a.x));
    assert.ok(Math.abs(P.at(running,level).x-P.at(flight,level).x-direction*1.3*level)<1e-8);
    const b=S.icon('b',P.at(running,level).x,a.y,.66,'B');
    assert.ok(Math.abs(b.x-a.x)>3.2&&G.ballisticEdge({...a,vx:direction*1.3},b,[a,b]));
    assert.equal(G.ballisticEdge(a,b,[a,b]),null);
  }
  const c=S.icon('c',5+2*6**2*Math.sin(Math.PI/18)*Math.cos(Math.PI/18)/C.g,4,.66,'C');
  const r=new E.Run({desktop:true,icons:[a,c],start:'a',goal:'c',noise:0},{free:true});
  assert.equal(r.manual(maxJ+.01,90),false);assert.equal(r.manual(6,45),false);
  assert.equal(r.reason,'push-off limit');assert.equal(r.preparation,null);
  assert.ok(r.manual(6,80));r.advance(5);assert.equal(r.current,'c');
});

// Independent time sweep: no interval endpoints or launch angles from the optimiser.
function sweep(from,to,supports){
  const dt=.002;
  for(let t=C.minTime;t<=C.maxTime;t+=dt){
    const vx=(to.x-from.x)/t,vy=(to.y-from.y)/t+C.g*t/2,normal=C.g*t-vy;
    const fx=2*C.mass*(vx-(from.vx||0))/P.pushOff.duration,fy=2*C.mass*vy/P.pushOff.duration;
    if(vy<0||normal<C.minDescent||Math.hypot(fx,fy)>P.pushOff.peakForce||Math.abs(fx)>P.pushOff.friction*(C.mass*C.g+fy))continue;
    const hit=P.contact({x:from.x,y:from.y,vx,vy,ax:0,ay:-C.g},supports,Infinity);
    if(!hit.safe||hit.icon!==to.id||Math.abs(hit.time-t)>1e-7)continue;
    const rebound=.34*normal;
    if(rebound>.7&&P.contact({x:to.x,y:to.y,vx:0,vy:rebound,ax:0,ay:-C.g},supports).icon!==to.id)continue;
    return t;
  }
  return Infinity;
}
test('earliest safe flight matches or improves a 2 ms independent time sweep on 600 obstructed jumps',()=>{
  const rng=P.random(76731);
  let feasible=0,blockedFastest=0;
  for(let i=0;i<600;i++){
    const a=S.icon('a',7,4,.66,'A'),b=S.icon('b',7+(rng()-.5)*7,.25+rng()*7,.66,'B');
    const obstacles=Array.from({length:4},(_,j)=>S.icon('p'+j,a.x+(b.x-a.x)*rng(),.25+rng()*7,.3+rng()*1.7,'Obstacle'));
    const supports=[a,b,...obstacles],reference=sweep(a,b,supports),edge=G.ballisticEdge(a,b,supports);
    if(Number.isFinite(reference)){
      feasible++;assert.ok(edge,'missed feasible pair '+i);
      assert.ok(edge.q.T<=reference+1e-6,'later than sweep on pair '+i);
    }
    if(!edge)continue;
    const f=P.trajectory(a,edge.q),hit=P.contact(f,supports,Infinity);
    assert.ok(hit.safe&&hit.icon===b.id);assert.ok(Math.abs(hit.x-b.x)<1e-7);
    assert.ok(edge.q.J<=C.maxJ+1e-8&&f.vy>=-1e-8&&P.at(f,hit.time).vy<=-C.minDescent+1e-7);
    if(edge.q.T>G.ballisticEdge(a,b,[a,b]).q.T+.005)blockedFastest++;
  }
  assert.ok(feasible>150&&blockedFastest>=3,'feasible='+feasible+', altered by blockers='+blockedFastest);
});
test('a level launch can leave an outward edge but cannot fall through its starting support',()=>{
  const a=S.icon('a',4,3,2,'Origin'),b=S.icon('b',4,1,1,'Below');
  assert.equal(G.ballisticEdge(a,b,[a,b]),null);
  const edge={...a,x:a.x+a.w/2-C.footMargin,vx:1.3},target={...b,x:edge.x+1.3*Math.sqrt(4/C.g)};
  const q=G.ballisticEdge(edge,target,[a,target]).q;
  assert.ok(Math.abs(P.trajectory(edge,q).vy)<1e-8);
});
test('running-launch time intervals agree with the independent sweep in both directions',()=>{
  const rng=P.random(58142);
  let possible=0;
  for(let i=0;i<500;i++){
    const dir=i%2?1:-1,dx=dir*(.2+3.5*rng());
    const a={...S.icon('a',10,4,.66,'Start'),vx:dir*(.1+3.1*rng())};
    const b=S.icon('b',10+dx,.3+6.8*rng(),.66,'Goal');
    const obstacle=S.icon('c',10+dx*rng(),1+6*rng(),.3+rng(),'Obstacle'),supports=[a,b,obstacle];
    const reference=sweep(a,b,supports),edge=G.ballisticEdge(a,b,supports);
    if(Number.isFinite(reference)){
      possible++;assert.ok(edge&&edge.q.T<=reference+1e-6,'missed running launch '+i);
    }
    if(edge){
      const hit=P.contact(P.trajectory(a,edge.q),supports,Infinity);
      assert.ok(hit.safe&&hit.icon==='b'&&Math.abs(hit.x-b.x)<1e-6&&edge.q.J<=C.maxJ+1e-8);
    }
  }
  assert.ok(possible>200);
});
test('fixed-seed layouts replay every reported route and preserve the goal during unrelated edits',t=>{
  let reached=0,unresolved=0;
  for(let seed=1;seed<=120;seed++){
    const rgen=P.random(seed);const scene=S.get('play'),used=new Set();
    for(const p of scene.icons){
      let slot;do{slot=Math.floor(rgen()*60);}while(used.has(slot));used.add(slot);
      p.x=.86+1.78*(slot%10);p.y=8.72-1.5*Math.floor(slot/10);
    }
    const r=new E.Run(scene,{free:true,graphOptions:{solver:'arc'}});
    r.select('work',{pin:true,x:r.surface('work').x+(rgen()-.5)*.5});
    if(!Number.isFinite(r.plan().value)){unresolved++;continue;}
    if(seed%5===0){
      r.requestJump();r.advance(.30);const p=r.position();
      r.edit([...r.icons,S.icon('extra',19,1,.66,'Added file')]);
      assert.equal(r.goal,'work');assert.ok(Math.hypot(r.position().x-p.x,r.position().y-p.y)<1e-7);
    }
    replay(r,60);reached++;
  }
  assert.ok(reached>80);t.diagnostic(reached+' reached, '+unresolved+' returned no route, 120 layouts');
});
