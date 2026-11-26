'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../physics'),U=require('../control'),H=require('../planner'),S=require('../scenes'),E=require('../engine'),T=require('../tracking');
const F=require('../frontier');
function close(a,b,eps=1e-7){assert.ok(Math.abs(a-b)<=eps,a+' versus '+b);}
test('chance-constrained labels match exhaustive routes including parallel jumps and repeated icons',()=>{
  const s=S.get('wind'),graphs=['gn','exposure'].map(solver=>new H.Graph(s.icons,{solver,samples:12}));
  const energy=26,all=[];
  function visit(id,b,p,e){
    if(id===s.goal){all.push({p,e});return;}
    for(const g of graphs)for(const action of g.out.get(id))if(action.bins<=b)
      visit(action.to,b-action.bins,p*action.p,e+p*action.q.energy);
  }
  visit(s.start,H.budget(energy),1,0);assert.ok(all.length>1);
  const solution=F.solve(graphs,s.start,s.goal,energy);
  for(const floor of [0,.3,.7,.85,.99,1]){
    const q=F.choose(solution,floor),within=all.filter(a=>a.p+1e-12>=floor);
    if(within.length){assert.ok(q.meetsTarget);close(q.energy,Math.min(...within.map(a=>a.e)));}
    else {assert.ok(!q.meetsTarget);close(q.reach,Math.max(...all.map(a=>a.p)));}
    close(q.path.reduce((p,action)=>p*action.p,1),q.reach);
    assert.ok(q.path.reduce((b,action)=>b+action.bins,0)<=H.budget(energy));
  }
  assert.equal(F.choose(F.solve(graphs,s.start,s.goal,0),.85).hasRoute,false);
});
test('analytic residual Jacobian matches centred differences off hinge boundaries',()=>{
  const u=[.75,.31,.88],dx=3.2,dy=.8,{rows}=P.shootingResidual(u,dx,dy,true);
  for(let k=0;k<3;k++){
    const a=u.slice(),b=u.slice();a[k]+=1e-6;b[k]-=1e-6;
    const plus=P.shootingResidual(a,dx,dy,false).r,minus=P.shootingResidual(b,dx,dy,false).r;
    for(let j=0;j<rows.length;j++)close((plus[j]-minus[j])/2e-6,rows[j][k],2e-5);
  }
});
test('projected Armijo accepts only sufficient decrease',()=>{
  const [a,b]=S.get('first').icons;
  for(const method of ['gd-armijo','gn-armijo']){
    const trace=[];assert.ok(P.shoot(a,b,method,trace));assert.ok(trace.length>1);
    for(let i=1;i<trace.length;i++){
      const prev=trace[i-1],cur=trace[i],{r,rows}=P.shootingResidual(prev.u,b.x-a.x,b.y-a.y,true);
      const gd=r.reduce((sum,val,j)=>sum+val*rows[j].reduce((v,d,k)=>v+d*(cur.u[k]-prev.u[k]),0),0);
      assert.ok(gd<0&&cur.cost<=prev.cost+1e-4*gd+1e-12);
    }
  }
});
test('scalar KKT optimum satisfies endpoint, impulse, primal and dual conditions under wind',()=>{
  for(let i=0;i<180;i++) {
    const rand=P.random(i),a=S.icon('a',0,3,2,'A'),b=S.icon('b',1+4*rand(),1+4*rand(),2,'B');
    const options={ax:rand()-.5,ay:rand()-.5,available:4+3*rand(),timeWeight:32*rand()};
    const q=U.constrainedShot(a,b,options);if(!q)continue;
    const end=P.at(P.trajectory(a,q,options),q.T);
    close(end.x,b.x);close(end.y,b.y);assert.ok(end.vy<=-P.C.minDescent+1e-7);
    assert.ok(q.energy<=options.available+1e-7&&q.speed<=P.C.safeSpeed+1e-7);
    const c=q.certificate;assert.ok(c.stationarity<1e-7&&c.complementarity<1e-7&&c.muLow>=0&&c.muHigh>=0);
  }
});
test('Dijkstra cost matches A* and a full remaining horizon matches exact VI',()=>{
  for(let i=0;i<18;i++){
    const s=S.generate(890000+i,i%2?'standard':'stress'),g=new H.Graph(s.icons,{samples:16});
    const get=(m,h)=>H.plan(g,s.start,s.goal,s.energy,m,{horizon:h});
    for(const [a,b] of [[get('astar'),get('dijkstra')],[get('vi'),get('mpc',H.budget(s.energy)+1)]]){
      if(Number.isFinite(a.value))close(a.value,b.value);else assert.equal(a.value,b.value);
    }
  }
});
test('Kalman scalar update equals a batch posterior; decorrelation resets the prior',()=>{
  const f=new U.WindFilter(2),obs=[[.25,.04],[.60,.22],[.92,.43]],R=.01;
  let precision=.5,weighted=0;
  for(const [t,z] of obs){const h=.5*t*t;precision+=h*h/R;weighted+=h*z/R;f.observe(z,t,R);}
  close(f.mean,weighted/precision);close(f.variance,1/precision);
  f.predict(0,2);close(f.mean,0);close(f.variance,2);
});
test('LQR launch correction solves the unconstrained one-step quadratic objective',()=>{
  const q={T:.8,J:5,theta:Math.PI/4},r=.04,wx=.3,wy=-.4,c=U.launchFeedback(q,wx,wy,r);
  assert.ok(!c.saturated);
  for(const [delta,w] of [[c.deltaX,wx],[c.deltaY,wy]])close(q.T*(.5*q.T*q.T*w+q.T*delta)+r*delta,0);
  const horizontal=U.launchFeedback({T:1,J:2,theta:0},0,2);
  assert.ok(horizontal.saturated);close(horizontal.theta,0);close(horizontal.J,2);
});
test('independent gusts give no prelaunch Kalman advantage and common-noise controls replay',()=>{
  const a=T.shuttle(17,{rho:0,method:'open'}),b=T.shuttle(17,{rho:0,method:'kalman'});
  for(let i=0;i<a.records.length;i++){close(a.records[i].J,b.records[i].J);assert.deepEqual(a.records[i].actual,b.records[i].actual);}
  const c=T.shuttle(17,{rho:0,method:'kalman',modelRho:.9});
  assert.deepEqual(c.records.map(r=>r.actual),b.records.map(r=>r.actual));
  assert.ok(c.records.some((r,i)=>Math.abs(r.J-b.records[i].J)>1e-6));
});
test('empirical edge updates are confined to unchanged geometry and automatic shots',()=>{
  const r=new E.Run(S.get('first'),{learning:true});
  const e=r.plan().path[0];r.launch();r.advance(10);
  assert.equal(r.observations.serialize()[0][2],1);assert.ok(e.p<1);
  r.setLearning(false);assert.equal(e.p,1);r.setLearning(true);
  r.select('home');r.launch();r.advance(.1);r.edit(r.icons.map(p=>p.id==='home'?{...p,w:p.w+.1}:p));r.advance(10);
  assert.equal(r.observations.serialize().length,0);
  r.select('mail');r.manual(4,25);r.advance(10);assert.equal(r.observations.serialize().length,0);
});

