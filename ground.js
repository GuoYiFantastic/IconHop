/* Ground stance and ballistic transfers between the desktop icons and the taskbar. */
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./physics'));
  else root.HopGround=factory(root.HopPhysics);
})(globalThis,function(P){
  'use strict';
  const BAR='@taskbar',speed=1.3,acceleration=P.pushOff.friction*P.C.g,tolerance=1e-5;
  function surface(run,id){
    if(run.desktop&&id===BAR)return {id:BAR,name:'Taskbar',x:run.barWidth/2,y:0,w:run.barWidth,walls:walls(run)};
    return run.graph.byId.get(id);
  }
  function onSurface(p,x){
    const [left,right]=p.walls||[-Infinity,Infinity];
    return P.clamp(x,Math.max(left,p.x-p.w/2+P.C.footMargin),Math.min(right,p.x+p.w/2-P.C.footMargin));
  }
  function contact(run,f){
    if(run.desktop&&!f.walls)f.walls=walls(run);
    return P.contact(f,run.desktop?[...run.icons,surface(run,BAR)]:run.icons,run.impactLimit);
  }
  function walls(run){
    // Keep saved icons in the world if the browser viewport becomes narrower.
    const r=P.C.bodyRadius;
    return [Math.min(r,...run.icons.map(p=>p.x-p.w/2+P.C.footMargin)),
      Math.max(run.barWidth-r,...run.icons.map(p=>p.x+p.w/2-P.C.footMargin))];
  }
  function walk(from,to,x,target){
    return {kind:'walk',from,to,x,target,cost:walkTime(x,target)};
  }
  function walkTime(x,target){
    const distance=Math.abs(target-x);
    if(distance<1e-9)return 0;
    const peak=Math.min(speed,Math.sqrt(distance*acceleration));
    return distance/peak+peak/acceleration;
  }
  function movement(p,target){
    const distance=Math.abs(target-p.x),peak=Math.min(speed,Math.sqrt(distance*acceleration));
    const ramp=peak/acceleration,duration=distance/peak+ramp;
    return {walk:true,x:p.x,y:p.y,target,elapsed:0,duration,ramp,peak};
  }
  function sample(d){
    if(d.runup){
      const t=d.elapsed,a=2*(d.target-d.x)/(d.duration*d.duration);
      return {x:d.x+a*t*t/2,y:d.y,vx:a*t,vy:0};
    }
    const t=d.elapsed,tail=d.duration-t,dir=Math.sign(d.target-d.x),a=d.peak/d.ramp;
    if(t<d.ramp)return {x:d.x+dir*a*t*t/2,y:d.y,vx:dir*a*t,vy:0};
    if(tail<d.ramp)return {x:d.target-dir*a*tail*tail/2,y:d.y,vx:dir*a*tail,vy:0};
    return {x:d.x+dir*d.peak*(t-d.ramp/2),y:d.y,vx:dir*d.peak,vy:0};
  }
  // The standing-launch impulse bound is quadratic in T².
  // A running launch adds a horizontal velocity term to the impulse constraint.
  function flightInterval(dx,dy,carry){
    const {g,mass,minTime,maxTime,minDescent}=P.C;
    const maxJ=P.pushImpulse;
    let low=Math.max(minTime**2,-2*dy/g),high=maxTime**2;
    const d2=dx*dx+dy*dy,a=g*g/4;
    const descentDisc=minDescent**2+2*g*dy;
    if(descentDisc>=0)low=Math.max(low,((minDescent+Math.sqrt(descentDisc))/g)**2);
    if(!carry){
      const bound=(maxJ/mass)**2-g*dy,disc=bound*bound-4*a*d2;
      if(bound<=0||disc<0)return null;
      const sum=bound+Math.sqrt(disc);
      low=Math.max(low,2*d2/sum);high=Math.min(high,sum/(2*a));
    }
    if(low>high)return null;
    let lo=Math.sqrt(low),hi=Math.sqrt(high);
    if(!carry)return [lo,hi];
    // Impulse is m*(v_after - v_before). For fixed endpoints its squared
    // norm has one minimum: the derivative has the sign of
    // (g²/4)*T⁴ + dx*carry*T - (dx²+dy²) for T>0 and dx*carry >= 0.
    const derivative=t=>a*t**4+dx*carry*t-d2;
    const within=t=>(dx/t-carry)**2+(dy/t+g*t/2)**2<=(maxJ/mass)**2;
    function bisect(left,right,isRight){
      for(let i=0;i<34;i++){
        const middle=(left+right)/2;
        if(isRight(middle))right=middle;else left=middle;
      }
      return [left,right];
    }
    if(within(lo)&&within(hi))return [lo,hi];
    const best=derivative(lo)>=0?lo:derivative(hi)<=0?hi:bisect(lo,hi,t=>derivative(t)>=0)[1];
    if(!within(best))return null;
    if(!within(lo))lo=bisect(lo,best,within)[1];
    if(!within(hi))hi=bisect(best,hi,t=>!within(t))[0];
    return [lo,hi];
  }
  // Coulomb friction at the peak of the pulse: |Fx| <= mu*(mg+Fy).
  // After multiplying by flight time T, each side is a quadratic in T.
  // Its real roots partition the time interval into constant-feasibility regions.
  function tractionEvents(dx,dy,carry,add){
    const mu=P.pushOff.friction,g=P.C.g,a=mu*g/2;
    for(const sign of [-1,1]){
      const b=mu*g*P.pushOff.duration/2+sign*carry,c=mu*dy-sign*dx;
      const disc=b*b-4*a*c;
      if(disc<0)continue;
      const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(disc));
      if(q){add(q/a);add(c/q);}
      else add(-b/(2*a));
    }
  }
  function ballisticEdge(from,to,supports,side=null){
    // Unfold a single reflection: T*vx = (wall-x0) + (wall-x1)/e.
    // The return leg runs at e times the outgoing horizontal speed.
    const ratio=side?P.C.wallRestitution:1,wall=side?.wall;
    const dx=side?wall-from.x+(wall-to.x)/ratio:to.x-from.x,dy=to.y-from.y;
    if(side&&(dx===0||(wall-from.x)/dx<=0||(wall-from.x)/dx>=1))return null;
    const {g,restitution,minRebound,crouchTime}=P.C;
    const carry=from.vx||0,verticalBound=P.pushImpulse/P.C.mass;
    // An optimistic ballistic envelope only avoids expensive solves. The
    // actual shared force and contact constraints are checked below.
    const disc=verticalBound**2-2*g*dy;
    if(disc<0)return null;
    const latest=(verticalBound+Math.sqrt(disc))/g;
    const horizontalBound=Math.abs(carry)+P.pushOff.friction*(verticalBound+g*P.pushOff.duration/2);
    if(Math.abs(dx)>horizontalBound*latest+1e-8)return null;
    const interval=flightInterval(dx,dy,carry);if(!interval)return null;
    const [lo,hi]=interval;
    function certify(t){
      const vx=dx/t,vy=dy/t+g*t/2,J=P.C.mass*Math.hypot(vx-carry,vy);
      if(!P.canPush(P.C.mass*(vx-carry),P.C.mass*vy))return null;
      // A horizontal departure stays supported until its feet clear the edge.
      // The generic flight integrator ignores t=0 so that normal upward
      // launches can leave their origin. Check the near-zero return separately.
      const returnTime=2*Math.max(0,vy)/g;
      if(returnTime<=1e-5){
        const x=from.x+vx*returnTime;
        for(const p of supports){
          if(p.y!==from.y)continue;
          const half=p.w/2-P.C.footMargin,left=p.x-half,right=p.x+half;
          if(x<left-1e-9||x>right+1e-9)continue;
          if(!(vx<0&&x<=left+1e-9)&&!(vx>0&&x>=right-1e-9))return null;
        }
      }
      const q={T:t,J,theta:Math.atan2(Math.max(0,vy),vx-carry),energy:P.C.kappa*J};
      const f=P.trajectory(from,q);
      if(side)f.walls=side.walls;
      const hit=P.contact(f,supports,Infinity);
      if(!hit.safe||hit.icon!==to.id||Math.abs(hit.time-t)>1e-6||Math.abs(hit.x-to.x)>1e-6)return null;
      const rebound=P.landingResponse(vx,vy-g*t).speed;
      if(rebound>minRebound){
        const bounce={x:hit.x,y:to.y,vx:0,vy:rebound,ax:0,ay:-g};
        if(P.contact(bounce,supports).icon!==to.id)return null;
      }
      const cost=crouchTime+t+P.settlingTime(g*t-vy);
      const edge={from:from.id,to:to.id,launchX:from.x,landX:to.x,q,cost};
      if(side){edge.wall=wall;edge.walls=side.walls;}
      return edge;
    }
    const fastest=certify(lo);if(fastest)return fastest;
    // At horizontal fraction u, height = y0 + u*dy + g*T²*u*(1-u)/2.
    // A blocker can start or stop intercepting only at one of its ends or
    // when the apex touches its height. Between events the contact order is fixed.
    const events=[lo,hi];
    function event(t){if(t>lo&&t<hi)events.push(t);}
    tractionEvents(dx,dy,carry,event);
    for(const p of supports){
      const h=p.y-from.y;
      const above=p.y-to.y;
      if(above>0&&Math.abs(to.x-p.x)<=p.w/2-P.C.footMargin+1e-9){
        const normal=Math.max(minRebound,Math.sqrt(2*g*above))/restitution;
        event((normal+Math.sqrt(normal**2+2*g*dy))/g);
      }
      if(h>=0&&h>=dy){
        event((Math.sqrt(2*g*h)+Math.sqrt(2*g*(h-dy)))/g);
        event((Math.sqrt(2*g*h)-Math.sqrt(2*g*(h-dy)))/g);
      }
      if(dx===0)continue;
      for(const side of [-1,1]){
        const x=p.x+side*(p.w/2-P.C.footMargin+P.C.contactEpsilon),u=(x-from.x)/dx;
        const reflected=wall!==undefined,turn=reflected?(wall-from.x)/dx:1;
        if(u>0&&u<turn)event(Math.sqrt(2*(h-u*dy)/(g*u*(1-u))));
        if(reflected){
          const v=turn+(wall-x)/(ratio*dx);
          if(v>turn&&v<1)event(Math.sqrt(2*(h-v*dy)/(g*v*(1-v))));
        }
      }
    }
    events.sort((a,b)=>a-b);
    for(let i=1;i<events.length;i++){
      const a=events[i-1],b=events[i];if(b<=a)continue;
      const interior=certify(a+Math.min(1e-7,(b-a)/2))||certify((a+b)/2);
      if(interior)return interior;
      const boundary=certify(b);if(boundary)return boundary;
    }
    return null;
  }

  // A state is a resting point (support ID, x). Same-support edges are walks,
  // and all other edges are certified ballistic jumps, including taskbar jumps.
  function shortestPath(run,spacing){
    const supports=[...run.icons,surface(run,BAR)],nodes=[],bounds=walls(run);
    let start,goal;
    for(const p of supports){
      const half=p.w/2-P.C.footMargin;
      const radius=Math.max(0,half),divisions=Math.max(2,2*Math.ceil(radius/spacing));
      const points=[];
      function add(x){
        let node=points.find(n=>Math.abs(n.x-x)<1e-8);
        if(!node){node={id:p.id,x,y:p.y,index:nodes.length};points.push(node);nodes.push(node);}
        return node;
      }
      // Certify the first action from the actual foot position. A rounded
      // sample a few nanometres away can be on the other side of a lip.
      if(p.id===run.current)start=add(run.position().x);
      if(p.id===run.goal)goal=add(run.goalPoint());
      for(let j=0;j<=divisions;j++)add(onSurface(p,p.x-radius+2*radius*j/divisions));
      for(const a of points){
        a.takeoffs=[a];
        for(const direction of [-1,1]){
          const end=onSurface(p,a.x+direction*speed**2/(2*acceleration));
          const distance=Math.abs(end-a.x);
          if(distance<tolerance)continue;
          const steps=Math.ceil(distance/spacing);
          for(let j=1;j<=steps;j++){
            const length=distance*j/steps,duration=Math.sqrt(2*length/acceleration);
            a.takeoffs.push({id:a.id,x:a.x+direction*length,y:a.y,vx:direction*duration*acceleration,duration});
          }
        }
      }
    }
    if(!start||!goal)return {path:[],value:Infinity};
    const n=nodes.length,dist=new Float64Array(n).fill(Infinity),done=new Uint8Array(n);
    const previous=new Int32Array(n).fill(-1),actions=new Array(n);
    dist[start.index]=0;
    for(;;){
      let k=-1,minimum=Infinity;
      for(let i=0;i<n;i++)if(!done[i]&&dist[i]<minimum){k=i;minimum=dist[i];}
      if(k<0||k===goal.index)break;
      done[k]=1;const a=nodes[k];
      for(const b of nodes){
        if(done[b.index])continue;
        let edge;
        if(a.id===b.id){
          edge=walk(a.id,b.id,a.x,b.x);
        }else{
          for(const launch of a.takeoffs){
            const dt=launch.duration||0;
            if(dt&&dt+P.C.crouchTime+P.C.minTime>=(edge?.cost??Infinity))continue;
            const key=launch.id+'|'+launch.x+'|'+(launch.vx||0)+'>'+b.id+'|'+b.x;
            if(!run.motionEdges.has(key)){
              let best=!dt||(b.x-launch.x)*launch.vx>0?ballisticEdge(launch,b,supports):null;
              for(const wall of bounds){
                if(dt&&(wall-launch.x)*launch.vx<=0)continue;
                const bounce=ballisticEdge(launch,b,supports,{wall,walls:bounds});
                if(bounce&&(!best||bounce.cost<best.cost))best=bounce;
              }
              run.motionEdges.set(key,best);
            }
            const jump=run.motionEdges.get(key);
            if(!jump||jump.cost+dt>=(edge?.cost??Infinity))continue;
            edge=dt?{...jump,cost:jump.cost+dt,runup:{x:a.x,vx:launch.vx,duration:dt}}:jump;
          }
          if(!edge)continue;
        }
        const total=minimum+edge.cost;
        if(total>=dist[b.index]-1e-10)continue;
        dist[b.index]=total;previous[b.index]=k;actions[b.index]=edge;
      }
    }
    const path=[];
    for(let k=goal.index;previous[k]>=0;k=previous[k])path.push(actions[k]);
    return {path:path.reverse(),value:dist[goal.index],spacing,states:n};
  }
  function route(run){
    if(!surface(run,run.goal))return {path:[],value:Infinity};
    for(const spacing of [.5,.25,.125]){
      const result=shortestPath(run,spacing);
      if(Number.isFinite(result.value)||spacing===.125)return result;
    }
  }
  // Direct shooting in a measured horizontal gust. Inverting the two
  // displacement equations for T gives the impulse required at takeoff.
  function explore(run,attempt){
    const src=surface(run,run.current),here=run.position(),goal=surface(run,run.goal);
    if(!src||!goal)return null;
    const supports=[...run.icons,surface(run,BAR)],bounds=walls(run);
    const windRandom=P.random(P.hash('exploration wind',run.seed,attempt));
    const gust={ax:(2*windRandom()-1)*.30,ay:0};
    const random=P.random(P.hash('foot placement',run.seed,attempt));
    const left=onSurface(src,-Infinity),right=onSurface(src,Infinity);
    let best=null,score=Infinity;
    function candidate(base,launch,carry,target,x,t){
      const vx=(x-launch)/t-.5*gust.ax*t,vy=(target.y-src.y)/t+.5*P.C.g*t;
      if(vy<0||vy-P.C.g*t>-P.C.minDescent)return;
      if(2*vy/P.C.g<=1e-5)return;
      const jx=P.C.mass*(vx-carry),jy=P.C.mass*vy;
      if(!P.canPush(jx,jy))return;
      const q={J:Math.hypot(jx,jy),theta:Math.atan2(jy,jx),T:t};
      q.energy=P.C.kappa*q.J;
      const f=P.trajectory({x:launch,y:src.y,vx:carry},q,gust);f.walls=bounds;
      const hit=P.contact(f,supports,Infinity);
      if(!hit.safe||hit.icon!==target.id||Math.abs(hit.time-t)>1e-7||Math.abs(hit.x-x)>1e-7)return;
      const impact=P.at(f,t),rebound=P.landingResponse(impact.vx,impact.vy).speed;
      if(rebound>P.C.minRebound&&P.contact({x:hit.x,y:target.y,vx:0,vy:rebound,ax:0,ay:-P.C.g},supports).icon!==target.id)return;
      const duration=carry?Math.abs(carry)/acceleration:0;
      const cost=walkTime(here.x,base)+P.C.crouchTime+duration+t+P.settlingTime(-impact.vy);
      const visits=run.exploredSupports.get(target.id)||0;
      const rank=cost+Math.hypot(goal.x-x,goal.y-target.y)/speed+3*visits;
      if(rank>=score)return;
      score=rank;best={from:src.id,to:target.id,launchX:launch,landX:x,q,gust,walls:bounds,exploratory:true,cost};
      if(carry)best.runup={x:base,vx:carry,duration};
    }
    for(const target of supports){
      if(target.id===src.id||target.y-src.y>P.pushImpulse**2/(2*P.C.mass**2*P.C.g))continue;
      const dir=Math.sign(target.x-src.x)||1,lip=dir>0?right:left;
      const base=onSurface(src,lip-dir*speed**2/(2*acceleration));
      const carry=dir*Math.sqrt(2*acceleration*Math.abs(lip-base));
      const near=onSurface(target,lip),far=onSurface(target,target.x+dir*target.w/2);
      const ends=[near,near+(far-near)*random(),onSurface(target,target.id===run.goal?run.goalPoint():target.x)];
      if(target.id===BAR)ends.push(onSurface(target,lip+dir*2*random()));
      const launches=[[here.x,here.x,0],[base,lip,carry]];
      for(const [start,launch,v] of launches)for(const x of ends){
        const phase=random();
        for(let i=0;i<160;i++){
          const t=P.C.minTime+(P.C.maxTime-P.C.minTime)*(i+phase)/160;
          candidate(start,launch,v,target,x,t);
        }
      }
    }
    if(best)return best;
    // Probe a new stance with a short hop on the current support. If a
    // blocker intercepts the probe, remain in contact and walk instead.
    const end=here.x<(left+right)/2?right:left;
    const x=here.x+(end-here.x)*(.35+.6*random());
    for(let i=0;i<12;i++)candidate(here.x,here.x,0,src,x,.32+.28*random());
    return best||(Math.abs(x-here.x)>tolerance?{...walk(src.id,src.id,here.x,x),exploratory:true}:null);
  }
  return {BAR,surface,onSurface,contact,walk,movement,sample,route,ballisticEdge,explore,tolerance};
});
