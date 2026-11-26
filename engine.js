(function(root,factory) {
  if(typeof module!=='undefined' && module.exports) module.exports=factory(require('./physics'),require('./planner'),require('./ground'));
  else root.HopEngine=factory(root.HopPhysics,root.HopPlan,root.HopGround);
})(globalThis,function(P,H,G) {
  'use strict';
  const {C}=P;
  class Run {
    constructor(scene, options={}) {
      this.free=!!options.free;
      this.desktop=!!scene.desktop;
      this.impactLimit=this.desktop||scene.id==='drop'?Infinity:C.safeSpeed;
      this.motionEdges=new Map();
      this.barWidth=options.barWidth||19.55;this.stanceX=scene.startX??null;this.goalOffset=0;
      this.graph=options.graph||new H.Graph(scene.icons,{noise:scene.noise,...options.graphOptions,free:this.free});
      this.icons=this.graph.icons.map(p=>({...p}));
      this.home=scene.start;this.current=scene.start;this.goal=scene.goal;
      this.pinnedGoalName=null;
      this.energy=scene.energy;this.initialEnergy=scene.energy;
      this.mode='Landed';this.method=options.method||'vi';this.reason='ready';
      this.seed=options.seed??2026;this.noise=options.noise??scene.noise;
      this.options=options;this.cache=options.cache||new Map();
      this.jumps=0;this.spent=0;this.flightTime=0;this.lastHit=null;this.lastShot=null;
      this.flight=null;this.history=[];this.route=null;
      this.dock=null;this.stoppedAt=null;
      this.preparation=null;this.compression=null;this.contactAge=Infinity;
      this.impacts=[];
      this.explorationAttempt=0;this.exploredSupports=new Map();
      this.learning=!!options.learning;this.observations=options.observations||new H.LandingHistory();
      if(this.learning)this.observations.apply(this.graph,true);
    }
    surface(id){return G.surface(this,id);}
    goalPoint(){
      const p=this.surface(this.goal);if(!p)return null;
      return G.onSurface(p,this.goal===G.BAR?this.goalOffset:p.x+this.goalOffset);
    }
    arrived(){
      return this.mode==='Landed'&&!this.compression&&!!this.goal&&this.current===this.goal&&
        (!this.desktop||Math.abs(this.position().x-this.goalPoint())<=G.tolerance);
    }
    plan() {
      if(this.mode!=='Landed' || !this.current || !this.goal) return {path:[],value:Infinity};
      if(this.desktop&&this.dock?.walk&&this.route)return this.route;
      if(this.desktop){
        const k=['ground',this.method,this.current,this.goal,this.goalOffset,this.position().x,this.barWidth,this.options.horizon,this.options.failCost].join('|');
        if(!this.cache.has(k))this.cache.set(k,G.route(this));
        this.route=this.cache.get(k);return this.route;
      }
      // In free play a path can visit every icon once. Budget bins count hops only.
      const allowance=this.free?Math.max(1,this.icons.length-1)*C.bin:this.energy;
      const k=[this.method,this.current,this.goal,H.budget(allowance),this.options.failCost??C.failCost,this.options.horizon??2].join('|');
      if(!this.cache.has(k)) this.cache.set(k,H.plan(this.graph,this.current,this.goal,allowance,
        this.method,{failCost:this.options.failCost??C.failCost,horizon:this.options.horizon??2}));
      this.route=this.cache.get(k);return this.route;
    }
    select(id,{pin=false,x=null}={}) {
      if(this.pinnedGoalName!==null&&!pin)return false;
      const p=this.surface(id);if(!p)return false;
      const point=this.desktop?G.onSurface(p,x??p.x):p.x;
      const offset=id===G.BAR?point:point-p.x;
      if(this.goal!==id||this.goalOffset!==offset){this.preparation=null;this.stopWalk();this.explorationAttempt=0;this.exploredSupports.clear();}
      this.goal=id;this.goalOffset=offset;this.route=null;
      if(pin)this.pinnedGoalName=p.name||id;
      if(this.mode==='Landed') this.reason=this.current===id?'arrived':'ready';
      return true;
    }
    clearTarget(){
      this.stopWalk();this.goal=null;this.goalOffset=0;this.pinnedGoalName=null;this.preparation=null;this.route=null;
      if(this.mode==='Landed')this.reason='ready';
    }
    explore(){
      if(!this.desktop||!this.goal||!this.surface(this.goal)||this.mode!=='Landed'||
        this.flight||this.dock||this.preparation||this.compression||this.arrived()||this.plan().path.length)return false;
      const e=G.explore(this,this.explorationAttempt++);
      if(!e||!this.requestJump(e))return false;
      // A new random foot position has a unique cache key. Reuse fixed
      // graph edges during each search without accumulating old probes.
      this.cache.clear();this.motionEdges.clear();
      if(this.dock)this.dock.exploratory=true;
      return true;
    }
    exploring(){
      return !!(this.preparation?.edge.exploratory||this.dock?.exploratory||
        this.dock?.runup?.exploratory||this.dock?.then?.exploratory||this.flight?.edge?.exploratory);
    }
    setLearning(enabled) {
      this.learning=!!enabled;this.observations.apply(this.graph,this.learning);
      this.cache.clear();this.route=null;
    }
    clearObservations() {
      this.observations.counts.clear();this.observations.apply(this.graph,false);this.cache.clear();
      if(this.flight)this.flight.changed=true;
    }
    launch() {
      if(this.desktop)return this.requestJump();
      if(this.mode!=='Landed'||this.dock||!this.goal||this.current===this.goal) return false;
      const e=this.plan().path[0];
      if(!e) {this.reason='no route';return false;}
      return this.fire(e);
    }
    requestJump(edge=this.plan().path[0]){
      if(!edge||this.compression||this.preparation||this.mode!=='Landed'||this.dock)return false;
      if(edge.kind==='walk')return this.walkTo(edge.target);
      if(this.desktop){
        if(!this.canLaunch(edge))return false;
        const launchX=edge.runup?.x??edge.launchX??this.surface(this.current).x;
        if(Math.abs(this.position().x-launchX)>G.tolerance)return this.walkTo(launchX,edge);
      }
      this.preparation={edge,elapsed:0,duration:C.crouchTime};
      return true;
    }
    canLaunch(edge){
      const {J,theta}=edge.q;
      return J>=0&&P.canPush(J*Math.cos(theta),J*Math.sin(theta));
    }
    walkTo(x,then=null){
      const p=this.surface(this.current);
      if(!p||!this.desktop||this.mode!=='Landed'||this.compression)return false;
      const here=this.position(),target=G.onSurface(p,x);
      if(Math.abs(target-here.x)<1e-9)return false;
      this.dock={...G.movement(here,target),then};this.preparation=null;this.reason='walking';
      return true;
    }
    stopWalk(){
      if(this.dock?.walk){this.stanceX=this.position().x;this.dock=null;}
    }
    manual(impulse,degrees) {
      if(this.mode!=='Landed'||this.dock||!this.goal||this.current===this.goal) return false;
      if(!Number.isFinite(impulse)||impulse<=0||(!this.desktop&&impulse>C.maxJ)||!Number.isFinite(degrees)||degrees<0||degrees>180){
        this.reason='invalid launch';return false;
      }
      const q={J:impulse,theta:degrees*Math.PI/180,energy:C.kappa*impulse};
      const source=this.surface(this.current);
      if(!source) return false;
      const foot=this.position();
      q.T=G.contact(this,P.trajectory(foot,q)).time;
      const edge={from:this.current,to:this.goal,q,manual:true,launchX:foot.x};
      if(this.desktop&&!this.canLaunch(edge)){this.reason='push-off limit';return false;}
      return this.free?this.requestJump(edge):this.fire(edge);
    }
    fire(e,origin=this.position()) {
      if(this.mode!=='Landed'||this.dock||this.compression)return false;
      if(this.desktop&&!this.canLaunch(e)){this.reason='push-off limit';return false;}
      if(!this.free&&e.q.energy>this.energy+1e-9) {this.reason='low stamina';return false;}
      const from=this.surface(this.current);
      if(!from) {this.mode='Failed';this.reason='support removed';return false;}
      // Common random numbers indexed by jump number pair competing policies in evaluation.
      const rng=P.random(P.hash('flight',this.seed,this.jumps));
      const f=P.trajectory(origin,e.q,e.gust??P.wind(rng,this.noise));
      this.flight={f,segmentStart:0,elapsed:0,hit:G.contact(this,f),edge:e};
      this.lastShot=e;this.jumps++;this.contactAge=Infinity;
      if(!this.free){this.spent+=e.q.energy;this.energy-=e.q.energy;}
      this.mode='Airborne';this.reason='in flight';return true;
    }
    position() {
      if(this.flight) return P.at(this.flight.f,this.flight.elapsed-this.flight.segmentStart);
      if(this.dock){
        if(this.dock.walk)return G.sample(this.dock);
        const d=this.dock,u=d.elapsed/d.duration,s=u*u*(3-2*u);
        return {x:d.x+(d.target-d.x)*s,y:d.y,vx:(d.target-d.x)*6*u*(1-u)/d.duration,vy:0};
      }
      const support=this.surface(this.current),p=support||this.stoppedAt||this.lastHit||{x:0,y:0};
      if(this.desktop&&support&&this.stanceX!==null)return {x:this.stanceX,y:p.y,vx:0,vy:0};
      return {x:p.x,y:p.y,vx:0,vy:0};
    }
    settle(dt) {
      if(!this.dock)return;
      if(this.dock.walk){
        const d=this.dock,remaining=d.duration-d.elapsed;
        d.elapsed=Math.min(d.duration,d.elapsed+dt);
        if(dt>=remaining){
          const launch=this.position();
          this.stanceX=d.target;this.dock=null;
          if(d.runup)this.fire(d.runup,launch);
          else if(d.then)this.requestJump(d.then);
          if((d.runup||d.then)&&dt>remaining)this.advance(dt-remaining);
        }
        return;
      }
      this.dock.elapsed=Math.min(this.dock.duration,this.dock.elapsed+dt);
      if(this.dock.elapsed>=this.dock.duration)this.dock=null;
    }
    release(position) {
      this.preparation=null;this.compression=null;this.contactAge=Infinity;
      const f={x:position.x,y:position.y,vx:position.vx,vy:0,ax:0,ay:-C.g};
      this.dock=null;this.current=null;this.mode='Airborne';this.reason='support removed';
      this.flight={f,edge:null,release:true,elapsed:0,segmentStart:0,hit:G.contact(this,f)};
    }
    advance(dt) {
      if(!Number.isFinite(dt)||dt<0) throw new Error('Invalid elapsed time');
      if(this.compression){
        const c=this.compression,duration=c.duration??C.compressionTime,wait=duration-c.elapsed;
        if(dt<wait){c.elapsed+=dt;this.contactAge+=dt;return;}
        const p=this.position(),f={x:p.x,y:p.y,vx:0,vy:c.speed,ax:0,ay:-C.g};
        this.flight={f,edge:null,release:true,rebound:true,contactDuration:duration,elapsed:0,segmentStart:0,hit:G.contact(this,f)};
        this.dock=null;this.compression=null;this.mode='Airborne';this.reason='rebound';dt-=wait;
      }
      if(this.preparation){
        const p=this.preparation,remaining=p.duration-p.elapsed;
        if(dt<remaining){p.elapsed+=dt;return;}
        this.preparation=null;
        if(p.edge.runup){
          const here=this.position();
          this.dock={walk:true,runup:p.edge,x:here.x,y:here.y,target:p.edge.launchX,elapsed:0,duration:p.edge.runup.duration};
          this.settle(dt-remaining);return;
        }
        if(!this.fire(p.edge))return;
        dt-=remaining;
      }
      this.contactAge+=dt;
      if(this.mode==='Rest') {this.energy=Math.min(C.capacity,this.energy+C.recharge*dt);return;}
      if(this.mode!=='Airborne') {this.settle(dt);return;}
      const f=this.flight,ends=f.segmentStart+f.hit.time;
      const afterContact=Math.max(0,dt-(ends-f.elapsed));
      f.elapsed=Math.min(ends,f.elapsed+dt);
      if(f.elapsed<ends) return;
      const impact=P.at(f.f,f.hit.time),normalSpeed=Math.max(0,-impact.vy);
      this.lastHit={...f.hit,normalSpeed};this.contactAge=afterContact;
      if(!f.release){this.flightTime+=f.elapsed;this.history.push({from:f.edge.from,to:f.edge.to,
        actual:f.hit.icon,time:f.elapsed,energy:f.edge.q.energy,speed:f.hit.speed,safe:f.hit.safe});
      }
      this.flight=null;
      if(this.learning && !f.release && !f.changed && !f.edge.manual) {
        const edge=this.graph.edges.get(H.edgeKey(f.edge.from,f.edge.to));
        if(edge){this.observations.observe(edge,f.hit.safe&&f.hit.icon===edge.to);this.cache.clear();}
      }
      this.stoppedAt={x:f.hit.x,y:f.hit.y};
      if(!f.hit.safe || (this.pinnedGoalName===null&&!f.release&&f.hit.icon!==f.edge.to)) {
        this.current=null;this.mode='Failed';this.reason=f.hit.safe?'wrong icon':f.hit.reason;return;
      }
      this.current=f.hit.icon;this.mode='Landed';
      if(f.edge?.exploratory)this.exploredSupports.set(this.current,(this.exploredSupports.get(this.current)||0)+1);
      const support=this.surface(this.current),dx=support.x-f.hit.x;
      if(this.desktop)this.stanceX=f.hit.x;
      else if(dx!==0){
        // Ground stance moves to the next graph launch point. Cubic easing
        // gives zero endpoint speeds and bounds peak ground speed at 2 m/s.
        this.dock={x:f.hit.x,y:support.y,target:support.x,elapsed:0,duration:Math.max(.08,1.5*Math.abs(dx)/2)};
      }
      this.reason=this.current===this.goal?'arrived':'landed';this.route=null;
      if(this.impactLimit===Infinity||(this.free&&!f.rebound)){
        const response=P.landingResponse(impact.vx,impact.vy);
        const speed=this.impactLimit===Infinity?response.speed:Math.min(C.maxRebound,C.restitution*normalSpeed);
        if(this.impactLimit===Infinity){
          const record={support:this.current,speed:f.hit.speed,before:response.before,after:response.after,lost:response.lost};
          this.impacts.push(record);if(this.impacts.length>32)this.impacts.shift();
          this.lastHit.energy=record;
        }
        if(speed>C.minRebound){
          this.compression={elapsed:0,duration:C.compressionTime,speed};this.contactAge=0;
          if(afterContact>0)this.advance(afterContact);
          return;
        }
      }
      this.settle(afterContact);
    }
    edit(next,{freezeGraph=false}={}) {
      H.validate(next);
      this.motionEdges.clear();
      const before=this.position(),preparing=this.preparation;
      this.preparation=null;
      if(this.learning || this.observations.counts.size)this.clearObservations();
      if(!freezeGraph) this.graph.update(next);
      this.icons=next.map(p=>({...p}));
      this.cache.clear();this.route=null;
      const target=this.surface(this.goal);
      if(target&&this.pinnedGoalName!==null)this.pinnedGoalName=target.name||target.id;
      if(!target&&this.pinnedGoalName===null)this.goal=null;
      if(this.mode==='Airborne') {
        const f=this.flight,here=this.position();
        f.f={...here,ax:f.f.ax,ay:f.f.ay};f.segmentStart=f.elapsed;
        f.hit=G.contact(this,f.f);
      } else if(this.current) {
        const support=this.surface(this.current);
        if(!support||Math.abs(support.y-before.y)>1e-9||Math.abs(before.x-support.x)>support.w/2-P.C.footMargin+1e-9){
          this.release(before);
        }else if(this.desktop){
          this.stanceX=before.x;
          if(this.dock?.walk&&(this.dock.then||this.dock.runup||Math.abs(this.dock.target-G.onSurface(support,this.dock.target))>G.tolerance))this.stopWalk();
        }else if((this.dock?.target??before.x)!==support.x){
          this.dock={x:before.x,y:before.y,target:support.x,elapsed:0,
            duration:Math.max(.08,1.5*Math.abs(support.x-before.x)/2)};
        }
        if(this.mode==='Landed')this.reason=this.current===this.goal?'arrived':'layout edited';
      }
      if(preparing&&!preparing.edge.manual&&this.mode==='Landed'&&!this.dock){
        const step=this.plan().path[0],old=preparing.edge;
        if(step?.q&&step.from===old.from&&step.to===old.to&&step.launchX===old.launchX&&
            step.landX===old.landX&&step.q.J===old.q.J&&step.q.theta===old.q.theta){
          this.preparation={...preparing,edge:step};
        }
      }
    }
    rest() {
      if(this.mode==='Landed'&&!this.dock) {this.mode='Rest';this.reason='screen off';return true;}
      return false;
    }
    wake() {
      if(this.mode==='Rest') {this.mode='Landed';this.reason=this.current===this.goal?'arrived':'ready';return true;}
      return false;
    }
    recover() {
      const support=this.icons.find(p=>p.id===this.home)||this.icons[0];
      if(this.mode!=='Failed'||!support) return false;
      this.current=support.id;this.stanceX=null;this.mode='Landed';this.contactAge=Infinity;this.reason='ready';this.route=null;return true;
    }
  }
  function episode(scene,options={}) {
    const r=new Run(scene,options);
    while(r.mode==='Landed' && r.current!==r.goal && r.jumps<40) {
      if(options.beforeJump) options.beforeJump(r);
      if(!r.launch()) break;
      if(options.inFlight) options.inFlight(r);
      r.advance(10);
    }
    const reached=r.mode==='Landed' && r.current===r.goal && !!r.goal;
    const failed=r.mode==='Failed';
    return {reached:+reached,fallen:+failed,stranded:+(!reached&&!failed),
      energy:r.spent,jumps:r.jumps,time:r.flightTime,
      cost:r.flightTime+C.energyWeight*r.spent+(reached?0:options.failCost??C.failCost),
      reason:reached?'arrived':r.reason};
  }
  return {Run,episode};
});

