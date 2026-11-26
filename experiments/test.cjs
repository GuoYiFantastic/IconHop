'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../physics'),H=require('../planner'),S=require('../scenes'),E=require('../engine');
const almost=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,'Expected '+a+' ≈ '+b);
test('one Mail target plans a taskbar crossing with intermediate icons on both sides',()=>{
  const G=require('../ground'),scene=S.get('play');
  scene.icons=[S.icon('home',2,5,.7,'Projects'),S.icon('left',4,2.4,.7,'Left'),
    S.icon('right',21,2.4,.7,'Right'),S.icon('mail',22.5,5.2,.7,'Mail')];
  for(const method of ['vi','pi','astar','dijkstra','mpc','greedy']){
    const r=new E.Run(scene,{free:true,barWidth:24,method,horizon:1,graphOptions:{solver:'arc'}});
    assert.ok(!Number.isFinite(H.plan(r.graph,'home','mail',36,method).value));
    r.select('mail',{pin:true,x:22.38});
    const path=r.plan().path;
    assert.deepEqual(path.filter(e=>e.q).map(e=>e.to).slice(-3),[G.BAR,'right','mail']);
    assert.ok(path.some(e=>e.kind==='walk'&&e.from===G.BAR));
    let walked=false;
    for(let i=0;i<1800&&!r.arrived();i++){
      if(r.mode==='Landed'&&!r.preparation&&!r.compression&&!r.dock)assert.ok(r.requestJump());
      r.advance(1/60);
      assert.equal(r.goal,'mail');assert.notEqual(r.mode,'Failed');
      if(r.current===G.BAR&&r.dock?.walk&&Math.abs(r.position().vx)>1)walked=true;
    }
    assert.ok(walked);assert.ok(r.arrived());almost(r.position().x,22.38);
  }
  const r=new E.Run({...scene,icons:scene.icons.filter(p=>p.id!=='right')},{free:true,barWidth:24});
  assert.equal(r.plan().value,Infinity);
  r.edit(scene.icons);assert.ok(r.plan().path.some(step=>step.to===G.BAR));
});
test('taskbar is a continuous walking surface and a launch surface for another icon',()=>{
  const G=require('../ground');
  for(const hz of [24,60,144]){
    const r=new E.Run(S.get('play'),{free:true,graphOptions:{solver:'arc'}}),dt=1/hz;
    function reach(){
      let steps=0;
      while((!r.arrived()||r.flight||r.compression||r.dock)&&++steps<20*hz){
        if(r.mode==='Landed'&&!r.dock&&!r.compression&&!r.preparation)assert.ok(r.requestJump());
        const before=r.position(),walking=r.dock?.walk;
        r.advance(dt);const after=r.position();
        const speed=Math.max(Math.hypot(before.vx,before.vy)+P.C.g*dt,Math.hypot(after.vx,after.vy),P.pushImpulse/P.C.mass+1.3);
        assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<=speed*dt+.0001);
        if(walking&&!r.flight){almost(before.y,after.y);almost(after.vy,0);assert.ok(Math.abs(after.vx)<=3.200001);}
      }
      assert.ok(r.arrived());
    }
    r.select(G.BAR,{pin:true,x:10});reach();almost(r.position().x,10);almost(r.position().y,0);
    const jumps=r.jumps;r.select(G.BAR,{pin:true,x:4});reach();almost(r.position().x,4);assert.equal(r.jumps,jumps);
    r.select('music',{pin:true,x:.61});reach();almost(r.position().x,.61);
    const count=r.jumps;r.select('music',{pin:true,x:99});reach();almost(r.position().x,1.12);assert.equal(r.jumps,count);
    r.select('music',{pin:true,x:.6});r.requestJump();r.advance(.12);const x=r.position().x;r.clearTarget();
    r.advance(1);almost(r.position().x,x);almost(r.position().vx,0);
  }
});
test('free play has continuous takeoff, finite contact time and one gravity-driven rebound per jump',()=>{
  for(const hz of [24,60,144]){
    const scene=S.get('play');scene.energy=0;
    scene.icons=[S.icon('home',2,4,.66,'Home'),S.icon('mail',3.5,4,.66,'Mail')];
    const run=new E.Run(scene,{free:true,graphOptions:{solver:'arc'}});
    const from=run.position();
    // A repeatable high arc between the centres, with a steep enough push to avoid slipping.
    function jumpTo(id){
      const a=run.position(),b=run.surface(id),t=1.4,vx=(b.x-a.x)/t,vy=(b.y-a.y)/t+P.C.g*t/2;
      const q={T:t,J:Math.hypot(vx,vy)*P.C.mass,theta:Math.atan2(vy,vx)};
      return {from:run.current,to:id,launchX:a.x,q:{...q,energy:q.J*P.C.kappa}};
    }
    const edge=jumpTo('mail');assert.ok(run.requestJump(edge));
    run.advance(.18);assert.deepEqual(run.position(),from);assert.equal(run.jumps,0);
    run.advance(.06);assert.ok(run.flight);almost(run.position().x,from.x);
    const impact=run.flight.hit,normal=-P.at(run.flight.f,impact.time).vy;
    run.advance(impact.time);assert.ok(run.compression);
    almost(run.position().x,impact.x);almost(run.position().y,impact.y);
    run.advance(.09);assert.ok(run.flight.rebound);const vy=run.flight.f.vy;
    almost(vy,Math.min(2.7,.34*normal));almost(run.position().y,impact.y);
    const timeToApex=vy/P.C.g;
    run.advance(timeToApex);almost(run.position().vy,0);
    almost(run.position().y,impact.y+vy*vy/(2*P.C.g));
    for(let i=0;i<2*hz;i++)run.advance(1/hz);
    assert.equal(run.mode,'Landed');assert.equal(run.current,edge.to);assert.equal(run.jumps,1);almost(run.energy,0);
    for(let i=0;i<12;i++){
      run.select(i%2?'mail':'home');
      assert.ok(run.requestJump(jumpTo(run.goal)));run.advance(10);
    }
    assert.equal(run.jumps,13);assert.equal(run.spent,0);
  }
});
test('removing support releases from rest, with exact free fall and continuous impact',()=>{
  const r=new E.Run(S.get('drop')),before=r.position(),energy=r.energy;
  r.edit(r.icons.filter(p=>p.id!==r.home));assert.equal(r.mode,'Airborne');
  assert.deepEqual(r.position(),before);assert.equal(r.jumps,0);
  for(let k=1;k<=4;k++){
    r.advance(.2);const t=k*.2,now=r.position();
    almost(now.y,before.y-.5*P.C.g*t*t);almost(now.vy,-P.C.g*t);almost(now.x,before.x);
  }
  const duration=Math.sqrt(2*5/P.C.g);r.advance(duration-.8+1e-12);
  assert.equal(r.mode,'Landed');almost(r.lastHit.speed,Math.sqrt(2*P.C.g*5));
  almost(r.position().y,2);almost(r.position().x,before.x);almost(r.energy,energy);
  r.advance(5);assert.ok(r.arrived());assert.equal(r.impacts.length,3);
  almost(r.impacts[0].before,P.C.mass*P.C.g*5);
  almost(r.impacts[0].after,r.impacts[0].before*P.C.restitution**2);
  almost(r.impacts[1].before,r.impacts[0].after);almost(r.impacts[2].before,r.impacts[1].after);
  almost(r.impacts[2].after,0);almost(r.impacts.reduce((sum,h)=>sum+h.lost,0),P.C.mass*P.C.g*5);
});
test('off-centre touchdown, ground stance and the next launch share position',()=>{
  const r=new E.Run(S.get('wind'),{seed:2});
  for(let k=0;k<2;k++){assert.ok(r.launch());r.advance(10);}
  assert.ok(r.launch());const f=r.flight,impact=f.hit;
  assert.ok(Math.abs(impact.x-r.graph.byId.get('tools').x)>.8);
  r.advance(impact.time);assert.ok(r.dock);
  almost(r.position().x,impact.x);almost(r.position().y,impact.y);assert.equal(r.launch(),false);
  let previous=r.position();
  while(r.dock){r.advance(1/240);const now=r.position();almost(now.y,previous.y);
    assert.ok(Math.abs(now.x-previous.x)<=2/240+1e-10);previous=now;}
  const launch=r.position();assert.ok(r.launch());almost(r.position().x,launch.x);almost(r.position().y,launch.y);
});
test('calm jump slows to zero at the apex and accelerates down, independent of frame rate',()=>{
  for(const fps of [24,60,144]){
    const r=new E.Run(S.get('first'));assert.ok(r.launch());
    const f=r.flight.f,apex=f.vy/P.C.g,original=r.position();
    let elapsed=0;while(elapsed+1/fps<apex){r.advance(1/fps);elapsed+=1/fps;}
    r.advance(apex-elapsed);almost(r.position().vy,0);almost(r.position().y,original.y+f.vy*f.vy/(2*P.C.g));
    r.advance(.2);almost(r.position().vy,-.2*P.C.g);almost(r.position().vx,original.vx);
  }
});
test('analytic apex, descending intersection and impact speed',()=>{
  const q={J:Math.sqrt(50),theta:Math.PI/4},a=S.icon('a',2,1,2,'A');
  const f=P.trajectory(a,q),T=10/P.C.g,b=S.icon('b',2+5*T,1,2,'B');
  almost(P.at(f,5/P.C.g).vy,0);almost(P.descendingTime(f,1),T);
  const hit=P.contact(f,[a,b]);assert.equal(hit.icon,'b');assert.ok(hit.safe);almost(hit.speed,q.J);
  assert.ok(!Number.isFinite(P.descendingTime(f,15)));
});
test('horizontal right and left launches can reach a lower icon',()=>{
  for(const angle of [0,180]) {
    const a=S.icon('a',9,3,1.5,'A'),dt=Math.sqrt(4/P.C.g);
    const b=S.icon('b',9+(angle===0?1:-1)*4*dt,1,1.5,'B');
    const scene={icons:[a,b],start:'a',goal:'b',noise:0,energy:12};
    const r=new E.Run(scene);assert.ok(r.manual(4,angle));r.advance(4);
    assert.equal(r.current,'b');almost(r.energy,12-P.C.kappa*4);
  }
});
test('all controllers filter impossible height and preserve stiffness-free flight dynamics',()=>{
  const a=S.icon('a',2,1,2,'A'),b=S.icon('b',5,2,1.8,'B'),high={...b,y:24};
  for(const method of ['gn','gd','grid','exposure']) {
    const solve=(v)=>method==='exposure'?P.exposureShot(a,v,1):P.shoot(a,v,method);
    assert.equal(solve(high),null);const q=solve(b);assert.ok(q);
    const hit=P.contact(P.trajectory(a,q),[a,b]);assert.ok(hit.safe);assert.equal(hit.icon,'b');
    assert.ok(q.J<=P.C.maxJ && q.theta>=0 && q.theta<=Math.PI);
  }
});
test('wrong platform is the first descending contact, a hard impact fails',()=>{
  const a=S.icon('a',2,2,1,'A'),b=S.icon('b',7,2,1.5,'B'),q=P.shoot(a,b);
  const f=P.trajectory(a,q),spot=P.at(f,.82*q.T),block=S.icon('x',spot.x,spot.y,1,'X');
  assert.equal(P.contact(f,[a,b,block]).icon,'x');
  const high={x:0,y:9,vx:0,vy:0,ax:0,ay:-P.C.g},low=S.icon('low',0,1,2,'Low');
  assert.equal(P.contact(high,[low]).reason,'hard impact');
});
test('energy is debited once, rests saturate and a new goal keeps the budget',()=>{
  const r=new E.Run(S.get('first'));const e=r.plan().path[0],before=r.energy;
  assert.ok(r.launch());assert.equal(r.launch(),false);almost(r.energy,before-e.q.energy);
  r.advance(.3);assert.equal(r.rest(),false);r.advance(5);r.select('home');
  almost(r.energy,before-e.q.energy);assert.equal(r.rest(),true);r.advance(100);almost(r.energy,P.C.capacity);
  r.wake();r.advance(1);almost(r.energy,P.C.capacity);
  const poor=new E.Run(S.get('rest'));assert.equal(poor.launch(),false);assert.equal(poor.jumps,0);
  assert.equal(poor.manual(6,45),false);almost(poor.energy,2);
});
test('in-flight edit keeps instantaneous position and velocity and cannot refund a jump',()=>{
  const r=new E.Run(S.get('first'));r.launch();r.advance(.16);const before=r.position(),energy=r.energy;
  r.edit(r.icons.filter(p=>p.id!=='mail'));const after=r.position();
  for(const field of ['x','y','vx','vy'])almost(before[field],after[field]);
  almost(r.energy,energy);assert.equal(r.goal,null);r.advance(5);assert.equal(r.mode,'Failed');assert.ok(r.recover());
  almost(r.energy,energy);
});
test('late removal of an already passed platform does not move a past collision into the future',()=>{
  const r=new E.Run(S.get('first'));r.launch();
  const original=r.flight.hit;r.advance(original.time*.8);
  r.edit(r.icons.filter(p=>p.id!=='home'));r.advance(5);
  assert.equal(r.current,'mail');almost(r.lastHit.speed,original.speed);
});
test('an explicit target survives deletion, a same-name replacement, restoration and arrivals',()=>{
  const r=new E.Run(S.get('first'),{free:true});
  const mail=r.graph.byId.get('mail'),home=r.graph.byId.get('home');
  assert.ok(r.select(mail.id,{pin:true}));assert.equal(r.select(home.id),false);
  r.edit([home,{...mail,id:'copy'}]);assert.equal(r.goal,'mail');assert.equal(r.plan().path.length,0);
  r.edit([home,{...mail,name:'Inbox'}]);assert.equal(r.pinnedGoalName,'Inbox');
  assert.ok(r.requestJump());r.advance(10);assert.equal(r.current,'mail');assert.equal(r.goal,'mail');
  assert.ok(r.select(home.id,{pin:true}));assert.equal(r.goal,'home');
  assert.ok(r.requestJump());r.clearTarget();assert.equal(r.preparation,null);
  r.advance(10);assert.equal(r.goal,null);assert.equal(r.jumps,1);
});
test('a file created before or during a jump preserves preparation, flight and the requested destination',()=>{
  const r=new E.Run(S.get('first'),{free:true,graphOptions:{solver:'arc'}});
  r.select('mail',{pin:true});assert.ok(r.requestJump());r.advance(.12);
  r.edit([...r.icons,S.icon('elsewhere',17,1,1,'Draft')]);almost(r.preparation.elapsed,.12);
  r.advance(.18);const before=r.position(),f=r.flight.f;
  const intercept=P.at(f,.82*r.flight.hit.time);
  r.edit([...r.icons,S.icon('step',intercept.x,intercept.y,1,'New file')]);
  for(const field of ['x','y','vx','vy'])almost(r.position()[field],before[field]);
  r.advance(10);assert.equal(r.current,'step');assert.equal(r.goal,'mail');
  assert.ok(r.requestJump());r.advance(.4);const air=r.position();r.clearTarget();
  assert.deepEqual(r.position(),air);r.advance(10);assert.equal(r.current,'mail');assert.equal(r.goal,null);
});
test('building the stairs restores connectivity and local updates equal full rebuilds',()=>{
  const s=S.get('tower'),graph=new H.Graph(s.icons,{noise:0}),r=new E.Run(s,{graph});
  assert.equal(r.plan().path.length,0);
  for(const [i,x,y] of [[1,5.8,3],[2,9.3,4.5],[3,12.6,6]]) {
    r.edit([...r.icons,S.icon('s'+i,x,y,2,'Step '+i)]);
    const full=new H.Graph(r.icons,graph.options);
    for(const [key,e] of full.edges)assert.deepEqual(graph.edges.get(key),e);
    assert.equal(graph.edges.size,full.edges.size);
  }
  assert.deepEqual(r.plan().path.map(e=>e.to),['s1','s2','s3','archive']);
  while(r.launch())r.advance(10);
  assert.equal(r.current,'archive');
});
test('nominal success can be blocked by an edited third icon unrelated to either endpoint',()=>{
  const s=S.get('first'),g=new H.Graph(s.icons,{noise:1}),key=H.edgeKey(s.start,s.goal);
  const e=g.edges.get(key),z=P.at(P.trajectory(s.icons[0],e.q),.85*e.q.T);
  g.update([...s.icons,S.icon('block',z.x,z.y,2,'X')]);assert.ok(!g.edges.has(key));
  g.update(s.icons);assert.deepEqual(g.edges.get(key),e);
});
test('PI and VI give the same expected cost, certainty VI and A* agree',()=>{
  for(let seed=0;seed<40;seed++) {
    const s=S.generate(88100+seed,seed%2?'standard':'stress'),g=new H.Graph(s.icons,{samples:24});
    const plans=Object.fromEntries(['vi','pi','no-risk','astar'].map(m=>[m,H.plan(g,s.start,s.goal,s.energy,m)]));
    for(const [a,b] of [['vi','pi'],['no-risk','astar']]) {
      if(Number.isFinite(plans[a].value))almost(plans[a].value,plans[b].value,1e-7);
      else assert.equal(plans[a].value,plans[b].value);
    }
    assert.ok(plans.vi.path.reduce((v,e)=>v+e.q.energy,0)<=s.energy+1e-8);
  }
});
test('repeated seeds replay exactly and zero-wind trajectories certify every landed arc',()=>{
  const s=S.get('wind');
  assert.deepEqual(E.episode(s,{seed:2}),E.episode(s,{seed:2}));
  assert.equal(E.episode(s,{seed:2,method:'astar'}).reached,0);
  assert.equal(E.episode(s,{seed:2,method:'vi'}).reached,1);
  const r=new E.Run(S.get('route'));while(r.launch())r.advance(10);
  assert.equal(r.current,r.goal);assert.ok(r.history.every(e=>e.actual===e.to && e.safe));
});

