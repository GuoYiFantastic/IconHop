/* One-way icon tops, SI units, and an impulsive unit-mass pet. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HopPhysics = api;
})(globalThis, function () {
  'use strict';
  const C = Object.freeze({
    g: 9.81, mass: 1, maxJ: 8.35, safeSpeed: 9.2, minDescent: 0.18,
    kappa: 0.72, capacity: 36, bin: 0.5, recharge: 1.8, footMargin: 0.07, contactEpsilon:1e-9,
    minTime: 0.13, maxTime: 2.15, crouchTime:.24, compressionTime:.09,
    restitution:.34, bodyRadius:.49, wallRestitution:.65, maxRebound:2.7, minRebound:.7, failCost: 90, energyWeight: 0.45,
    noise: 1, samples: 64, windX: 1.15, windY: 0.40
  });
  // Desktop actuator: the leg adds a triangular force pulse above the
  // normal force supporting body weight. Integrating the pulse gives net J.
  const pushOff=Object.freeze({peakForce:69,duration:C.crouchTime,friction:.16});
  const pushImpulse=pushOff.peakForce*pushOff.duration/2;
  function pushForce(impulse){
    return impulse*2/pushOff.duration;
  }
  // The foot sticks tangentially on touchdown. Vertically the contact has
  // coefficient of restitution e. Tiny rebounds are absorbed by the support.
  function landingResponse(vx,vy){
    const rebound=C.restitution*Math.max(0,-vy);
    const speed=rebound>C.minRebound?rebound:0;
    const before=.5*C.mass*(vx*vx+vy*vy),after=.5*C.mass*speed*speed;
    return {speed,before,after,lost:before-after};
  }
  function settlingTime(normalSpeed){
    let time=0;
    for(let speed=landingResponse(0,-normalSpeed).speed;speed;speed=landingResponse(0,-speed).speed){
      time+=C.compressionTime+2*speed/C.g;
    }
    return time;
  }
  function canPush(jx,jy){
    const normalImpulse=jy+C.mass*C.g*pushOff.duration/2;
    return jy>=-1e-9&&pushForce(Math.hypot(jx,jy))<=pushOff.peakForce+1e-7&&
      Math.abs(jx)<=pushOff.friction*normalImpulse+1e-9;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function hash(...parts) {
    let h = 2166136261;
    for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let a = Math.imul(state ^ (state >>> 15), 1 | state);
      a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
      return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wind(rng, noise = 1) {
    // Box-Muller draws are shared by the simulator and MC model, with distinct seeds.
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng())));
    const phi = 2 * Math.PI * rng();
    return { ax: noise * C.windX * r * Math.cos(phi), ay: noise * C.windY * r * Math.sin(phi) };
  }
  function trajectory(from, q, gust = {ax:0, ay:0}) {
    return { x: from.x, y: from.y, vx: (from.vx||0) + q.J / C.mass * Math.cos(q.theta),
      vy: q.J / C.mass * Math.sin(q.theta), ax: gust.ax, ay: gust.ay - C.g };
  }
  function at(f, t) {
    const pos={x:f.x+t*(f.vx+.5*t*f.ax),y:f.y+t*(f.vy+.5*t*f.ay),vx:f.vx+t*f.ax,vy:f.vy+t*f.ay};
    if(!f.walls)return pos;
    // Solve the first outward crossing of each side. Rebound dissipates
    // normal kinetic energy; gravity and the vertical state are unchanged.
    let x=f.x,v=f.vx,left=t;
    while(left>0){
      let next=Infinity,wall;
      for(const dir of [-1,1]){
        const plane=f.walls[dir<0?0:1],d=plane-x,disc=v*v+2*f.ax*d;
        if(disc<0)continue;
        const out=dir*Math.sqrt(disc);
        if(dir*out<1e-9){
          if(Math.abs(d)<1e-9&&Math.abs(v)<1e-8&&dir*f.ax>0){pos.x=plane;pos.vx=0;return pos;}
          continue;
        }
        const hit=Math.abs(v+out)>1e-12?2*d/(v+out):f.ax?(out-v)/f.ax:Infinity;
        if(hit>=-1e-12&&hit<next){next=Math.max(0,hit);wall=plane;}
      }
      if(next>left){x+=left*(v+.5*left*f.ax);v+=left*f.ax;break;}
      x=wall;v=-C.wallRestitution*(v+next*f.ax);left-=next;
      if(Math.abs(v)<1e-8&&((x===f.walls[0]&&f.ax<=0)||(x===f.walls[1]&&f.ax>=0))){v=0;break;}
    }
    pos.x=x;pos.vx=v;return pos;
  }
  function descendingTime(f, height) {
    const disc = f.vy*f.vy - 2*f.ay*(f.y-height);
    if (disc < 0) return Infinity;
    if (Math.abs(f.ay)<1e-9) {
      const t = (height-f.y)/f.vy;
      return f.vy < -1e-6 && t > 1e-5 ? t : Infinity;
    }
    const t = (-f.vy - Math.sqrt(disc))/f.ay;
    return t > 1e-5 && f.vy+t*f.ay < -1e-6 ? t : Infinity;
  }
  function contact(f, icons, impactLimit=C.safeSpeed) {
    const floorTime = descendingTime(f, 0);
    let time = Math.min(4, floorTime);
    let icon = null;
    for (const p of icons) {
      const t = descendingTime(f, p.y);
      if (t > time || !Number.isFinite(t)) continue;
      const x = f.walls?at(f,t).x:f.x+t*(f.vx+0.5*t*f.ax);
      if (Math.abs(x-p.x) <= p.w/2-C.footMargin+C.contactEpsilon &&
          (t < time || !icon || String(p.id) < String(icon.id))) { time = t; icon = p; }
    }
    const state = at(f,time);
    const speed = Math.hypot(state.vx,state.vy);
    const safe=!!icon && speed<=impactLimit+1e-9;
    return {time, icon:icon ? icon.id : null, speed, safe,
      x:state.x, y:state.y, reason:icon ? (safe ? 'landed' : 'hard impact') : 'fall'};
  }
  function check(from, target, q) {
    const f = trajectory(from,q);
    const t = descendingTime(f,target.y);
    if (!Number.isFinite(t)) return null;
    const p = at(f,t);
    const speed = Math.hypot(p.vx,p.vy);
    const error = Math.abs(p.x-target.x);
    if (q.J>C.maxJ+1e-8 || error>target.w/2-C.footMargin || speed>C.safeSpeed || p.vy>-C.minDescent) return null;
    return {...q, T:t, error, speed, energy:C.kappa*q.J};
  }

  // Least squares in scaled polar impulse and time u = (J/Jmax, theta/pi, T).
  function residual(u, dx, dy, jacobian) {
    const [a,b,t]=u, j=a*C.maxJ, c=Math.cos(b*Math.PI), s=Math.sin(b*Math.PI);
    const vx=j*c, vy=j*s, endVy=vy-C.g*t;
    const excessive=Math.max(0,(Math.hypot(vx,endVy)-C.safeSpeed)/2);
    const ascent=Math.max(0,(endVy+C.minDescent)/2);
    const r=[(vx*t-dx)/0.32,(vy*t-0.5*C.g*t*t-dy)/0.32,
      0.19*a,0.075*vx/C.safeSpeed,0.075*endVy/C.safeSpeed,excessive,ascent];
    if (!jacobian) return {r,cost:r.reduce((v,x)=>v+x*x/2,0)};
    const dvx=[C.maxJ*c,-Math.PI*vy,0], dvy=[C.maxJ*s,Math.PI*vx,0];
    const dEnd=[dvy[0],dvy[1],-C.g], speed=Math.hypot(vx,endVy) || 1;
    const rows=[dvx.map((d,k)=>(d*t+(k===2?vx:0))/0.32),
      dvy.map((d,k)=>(d*t+(k===2?endVy:0))/0.32),[0.19,0,0],
      dvx.map(d=>0.075*d/C.safeSpeed), dEnd.map(d=>0.075*d/C.safeSpeed),
      dvx.map((d,k)=>excessive ? (vx*d+endVy*dEnd[k])/(2*speed):0),
      dEnd.map(d=>ascent?d/2:0)];
    return {r,rows,cost:r.reduce((v,x)=>v+x*x/2,0)};
  }
  function solve3(a,b) {
    const m=a.map((row,i)=>[...row,b[i]]);
    for(let i=0;i<3;i++) {
      let pivot=i;
      for(let k=i+1;k<3;k++) if(Math.abs(m[k][i])>Math.abs(m[pivot][i])) pivot=k;
      [m[i],m[pivot]]=[m[pivot],m[i]];
      if(Math.abs(m[i][i])<1e-12) return null;
      const v=m[i][i]; for(let j=i;j<4;j++) m[i][j]/=v;
      for(let k=0;k<3;k++) if(k!==i) {
        const v=m[k][i]; for(let j=i;j<4;j++) m[k][j]-=v*m[i][j];
      }
    }
    return m.map(row=>row[3]);
  }
  function shoot(from,target,method='gn',trace=null) {
    const armijo=method.endsWith('-armijo');
    if(armijo)method=method.slice(0,-7);
    const dx=target.x-from.x, dy=target.y-from.y;
    const distance=Math.hypot(dx,dy);
    // Closed-form lower bounds over all flight times. Width matters at the boundary.
    const closest=Math.max(0,Math.abs(dx)-target.w/2+C.footMargin);
    if(C.g*(Math.hypot(closest,dy)+dy)>C.maxJ*C.maxJ+1e-6 ||
       C.g*(Math.hypot(closest,dy)-dy)>C.safeSpeed*C.safeSpeed+1e-6) return null;
    const t0=clamp(Math.sqrt(2*Math.max(distance,0.01)/C.g)*0.90,C.minTime,C.maxTime);
    const vx=dx/t0, vy=dy/t0+0.5*C.g*t0;
    const proj=v=>[clamp(v[0],0.005,1),clamp(v[1],0,1),clamp(v[2],C.minTime,C.maxTime)];
    let u=proj([Math.hypot(vx,vy)/C.maxJ,Math.atan2(vy,vx)/Math.PI,t0]);
    let evals=0, best=null, bestCost=Infinity;
    function record(v,cost) {
      if(cost>=bestCost) return;
      const candidate=check(from,target,{J:v[0]*C.maxJ,theta:v[1]*Math.PI,T:v[2]});
      if(candidate) {bestCost=cost; best={...candidate, objective:cost};}
    }
    if(method==='grid') {
      // Enumerate launch controls. The descending plane crossing supplies T exactly.
      for(let i=1;i<=32;i++) for(let k=0;k<=60;k++) {
        const a=i/32,b=k/60;
        const q={J:a*C.maxJ,theta:b*Math.PI};
        const t=descendingTime(trajectory(from,q),target.y);
        evals++;
        if(t<C.minTime || t>C.maxTime || !Number.isFinite(t)) continue;
        const v=[a,b,t];record(v,residual(v,dx,dy,false).cost);
      }
    } else {
      if(!['gn','gd'].includes(method)) throw new Error('Unknown shooting method: '+method);
      let damping=0.006;
      for(let iter=0;iter<(method==='gn'?22:90);iter++) {
        const {rows,r,cost}=residual(u,dx,dy,true);evals++;record(u,cost);
        const grad=[0,0,0], h=[[0,0,0],[0,0,0],[0,0,0]];
        for(let k=0;k<rows.length;k++) for(let i=0;i<3;i++) {
          grad[i]+=rows[k][i]*r[k];
          for(let j=0;j<3;j++) h[i][j]+=rows[k][i]*rows[k][j];
        }
        for(let i=0;i<3;i++) h[i][i]+=damping;
        if(trace)trace.push({iteration:iter,cost,gradient:Math.hypot(...grad),u:[...u],damping,step:0});
        const d=method==='gn'?solve3(h,grad.map(x=>-x)):grad.map(x=>-x);
        if(!d || Math.hypot(...d)<1e-8) break;
        let accepted=false;
        for(let alpha=1;alpha>=1/65536;alpha*=0.5) {
          const v=proj(u.map((x,i)=>x+alpha*d[i]));
          const next=residual(v,dx,dy,false).cost;evals++;
          const slope=armijo?grad.reduce((sum,g,k)=>sum+g*(v[k]-u[k]),0):0;
          if(next<cost-1e-13 && (!armijo || (slope<0 && next<=cost+1e-4*slope))) {
            if(trace)trace[trace.length-1].step=alpha;
            record(v,next);u=v;accepted=true;damping=Math.max(0.00001,damping/2);break;
          }
        }
        if(!accepted) break;
      }
    }
    return best?{...best,evals}:null;
  }
  // Linearized uncertainty at the descending event. Holding T fixed would
  // miss horizontal landing error caused by a vertical gust changing flight time.
  function normalCDF(x) {
    const t=1/(1+0.2316419*Math.abs(x));
    const tail=0.3989422804014327*Math.exp(-x*x/2)*t*
      (0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    return x>=0?1-tail:tail;
  }
  function exposureShot(from,target,noise) {
    const half=target.w/2-C.footMargin,dx=target.x-from.x,dy=target.y-from.y;
    // Eliminate endpoint equalities analytically and search time and landing offset.
    // This is a separate experimental controller; the default is Gauss–Newton shooting.
    let best=null,bestCost=Infinity;
    for(let i=0;i<=70;i++) {
      const t=C.minTime+(C.maxTime-C.minTime)*i/70;
      const vy=dy/t+0.5*C.g*t,endVy=vy-C.g*t;
      if(vy<0||endVy>-C.minDescent)continue;
      for(const fraction of [0,-.35,.35,-.70,.70]) {
        const offset=half*fraction,vx=(dx+offset)/t,j=C.mass*Math.hypot(vx,vy);
        const speed=Math.hypot(vx,endVy);
        if(j>C.maxJ||speed>C.safeSpeed)continue;
        const sigmaX=.5*t*t*noise*Math.hypot(C.windX,vx/endVy*C.windY);
        const sigmaSpeed=noise*Math.hypot(vx*t*C.windX,(endVy*t+.5*C.g*t*t)*C.windY)/speed;
        const pWidth=sigmaX>1e-8?normalCDF((half-offset)/sigmaX)-normalCDF((-half-offset)/sigmaX):1;
        const pImpact=sigmaSpeed>1e-8?normalCDF((C.safeSpeed-speed)/sigmaSpeed):1;
        const objective=t+C.energyWeight*C.kappa*j+C.failCost*(1-pWidth*pImpact);
        if(objective>=bestCost)continue;
        const q={J:j,theta:Math.atan2(vy,vx),T:t};
        const hit=contact(trajectory(from,q),[from,target]);
        if(hit.icon!==target.id||!hit.safe)continue;
        bestCost=objective;best={...q,speed,error:Math.abs(offset),energy:C.kappa*j,objective};
      }
    }
    return best;
  }
  // Choose a visible apex, solve the two endpoint equations, then certify the launch.
  function arcingShot(from,to){
    const dx=to.x-from.x,dy=to.y-from.y;
    const preferred=Math.max(0,dy)+clamp(.85+.24*Math.abs(dx),.9,2.45);
    for(let i=0;i<22;i++){
      const rise=preferred-i*.1;
      if(rise<=Math.max(0,dy))break;
      const vy=Math.sqrt(2*C.g*rise),T=vy/C.g+Math.sqrt(2*(rise-dy)/C.g);
      if(T>C.maxTime||T<C.minTime)continue;
      const vx=dx/T,q=check(from,to,{J:C.mass*Math.hypot(vx,vy),theta:Math.atan2(vy,vx),T});
      if(q)return q;
    }
    return shoot(from,to,'gn');
  }
  return {C,pushOff,pushImpulse,pushForce,canPush,landingResponse,settlingTime,clamp,hash,random,wind,trajectory,at,descendingTime,contact,check,shoot,arcingShot,exposureShot,shootingResidual:residual};
});

