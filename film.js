(function(root) {
  'use strict';
  const P=HopPhysics,S=HopScenes,E=HopEngine,R=HopRender;
  const chapters=[
    {id:'first',title:'A single ballistic jump',scene:'first',duration:6.0},
    {id:'wind',title:'Two policies in the same wind',scene:'wind',duration:10.2},
    {id:'tower',title:'Building a route to the archive',scene:'tower',duration:14.4},
    {id:'rest',title:'Stamina across tasks',scene:'rest',duration:16.2},
    {id:'kkt',title:'When the stamina constraint binds',duration:14},
    {id:'drop',title:'Free fall from rest',scene:'drop',duration:5.0},
    {id:'play',title:'Desktop playground',scene:'play',duration:9.4},
    {id:'walk',title:'Taskbar and icon walking',scene:'play',duration:19},
    {id:'work',title:'Short jumps and a taskbar crossing',scene:'runup',duration:22},
    {id:'stack',title:'From Recycle Bin to This PC',scene:'stack',duration:5}
  ];
  function rounded(ctx,x,y,w,h,r,color) {ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function text(ctx,value,x,y,font,color='#203f3e') {ctx.font=font;ctx.fillStyle=color;ctx.fillText(value,x,y);}
  function surface(w,h) {
    const c=document.createElement('canvas');
    c.style.cssText='position:fixed;left:-5000px;top:0;pointer-events:none;width:'+w+'px;height:'+h+'px;';
    c.setAttribute('aria-hidden','true');document.body.append(c);return c;
  }
  class Player {
    constructor(canvas) {
      this.canvas=canvas;this.ready=R.ready;
      this.buffers=[surface(1168,422),surface(566,422),surface(566,422)];
    }
    load(id) {
      this.chapter=chapters.find(c=>c.id===id);if(!this.chapter) throw new Error('Unknown recording');
      const desktop=['play','runup','stack'].includes(this.chapter.scene);
      this.buffers[0].style.width=desktop?'1280px':'1168px';
      this.buffers[0].style.height=desktop?'720px':'422px';
      this.duration=this.chapter.duration;this.reset();
    }
    reset() {
      const c=this.chapter;this.ticks=0;this.eventIndex=0;
      if(c.id==='kkt'){this.runs=[];return;}
      const scene=S.get(c.scene);
      this.runs=(c.id==='wind'?['astar','vi']:['vi']).map(method=>{
        const free=['play','first','drop','walk','work','stack'].includes(c.id);
        const r=new E.Run(scene,{method,free,graphOptions:{solver:free?'arc':'gn'},seed:c.id==='wind'?2:2026});
        if(c.id==='walk')r.select('home',{pin:true,x:.60});
        if(c.id==='work')r.select('work',{pin:true});
        if(c.id==='stack')r.select('pc',{pin:true});
        return {r,route:r.plan(),trail:[],next:c.id==='play'?.38:c.id==='rest'?9.1:c.id==='tower'?6.2:1.5};
      });
    }
    step() {
      this.ticks++;const t=this.ticks/60, c=this.chapter;
      for(const v of this.runs) {
        const r=v.r;
        if(c.id==='walk'){
          if(this.ticks===55)r.select(HopGround.BAR,{pin:true,x:9});
          if(this.ticks===650)r.select('music',{pin:true,x:1.12});
          r.advance(1/60);
          if(r.mode==='Landed'&&!r.dock&&!r.preparation&&!r.compression&&!r.arrived()){
            v.route=r.plan();r.requestJump();
          }
          continue;
        }
        if(c.id==='play'||c.id==='first'||c.id==='work'||c.id==='stack'){
          const before=r.mode;r.advance(1/60);
          if(before==='Airborne'&&r.mode!=='Airborne')v.next=t+.40;
          if(t>=v.next&&r.mode==='Landed'&&!r.preparation&&!r.compression&&!r.dock&&(c.id==='play'||!r.arrived())){
            if(c.id==='play'&&r.arrived()){
              const sequence=S.get('play').patrol;
              r.select(sequence[(sequence.indexOf(r.current)+1)%sequence.length]);
            }
            v.route=r.plan();r.requestJump();
          }
          continue;
        }
        if(c.id==='drop'&&this.ticks===90){
          r.edit(r.icons.filter(p=>p.id!==r.current));v.route=null;v.trail=[r.position()];
          v.next=Infinity;continue;
        }
        if(c.id==='tower') {
          const points=[[5.8,3],[9.3,4.5],[12.6,6]];
          if(this.eventIndex<3&&t>=[1.8,3.3,4.8][this.eventIndex]) {
            const j=this.eventIndex++,xy=points[j],p=S.icon('step'+j,...xy,2,'Step '+(j+1));
            r.edit([...r.icons,p]);v.route=r.plan();
          }
        }
        if(c.id==='rest') {
          if(this.ticks===75)r.rest();
          if(this.ticks===500){r.wake();v.route=r.plan();}
          if(this.ticks===816&&r.mode==='Landed'&&r.current===r.goal) {r.select('home');v.route=r.plan();v.next=15.4;}
        }
        if(r.mode==='Rest') {r.advance(1/60);continue;}
        if(r.mode==='Airborne') {
          r.advance(1/60);
          if(r.mode==='Airborne') v.trail.push(r.position());
          else {v.trail.push(r.lastHit);v.next=t+.42;v.route=r.mode==='Landed'?r.plan():null;}
        } else if(r.dock||r.compression){r.advance(1/60);}
        else if(c.id!=='drop'&&r.mode==='Landed'&&r.current!==r.goal&&t>=v.next) {
          v.route=r.plan();
          if(v.route.path.length&&r.launch()){v.trail=[r.position()];}
          else v.next=t+1;
        }
      }
    }
    seek(seconds) {
      const tick=Math.min(Math.round(this.duration*60),Math.max(0,Math.round(seconds*60)));
      if(tick<this.ticks)this.reset();
      while(this.ticks<tick)this.step();this.draw();
    }
    caption() {
      const t=this.ticks/60,id=this.chapter.id,r=this.runs[0].r;
      if(id==='drop'){
        if(t<1.5)return 'A stationary pet is supported 5.00 m above Archive.';
        const hit=r.impacts.at(-1);
        return hit?'Contact '+r.impacts.length+' · '+hit.before.toFixed(2)+' J before, '+hit.after.toFixed(2)+' J returned, '+hit.lost.toFixed(2)+' J lost.':
          'After release, each second adds 9.81 m/s to the downward speed.';
      }
      if(id==='first'){
        if(r.preparation)return 'The ball crouches against Home before the launch impulse.';
        if(r.compression)return 'First contact. The ball compresses against Mail.';
        if(r.flight?.rebound)return 'Impact sends the ball back up. Gravity brings it down for the final landing.';
        if(r.flight)return r.position().vy>0?'Gravity reduces upward speed until the ball reaches its apex.':'Gravity increases downward speed on the way to Mail.';
        return r.current===r.goal?'The ball has settled on Mail.':'The launch supplies the initial velocity. During flight, aᵧ = −9.81 m/s².';
      }
      if(id==='wind') return t<5?'Both pets receive the same sequence of random gusts.':'A* attempts the long final jump. The MDP uses Tools as an intermediate landing.';
      if(id==='tower') return this.eventIndex===0?'The archive is outside the pet’s jump envelope.':
        this.eventIndex<3?'Each new icon changes the reachable graph.':r.current===r.goal?'Four feasible jumps reach the floating archive.':'The third step connects Home to Archive. The planner now has a route.';
      if(r.mode==='Rest')return 'Screen-off mode restores 1.8 stamina units per second.';
      if(t<1.25)return 'The pet has two stamina units, too little for the route.';
      if(t>13.6)return 'A new target inherits the remaining stamina. Another rest is needed for the return.';
      return 'After waking, the pet can spend the recovered stamina on two jumps.';
    }
    panel(ctx,v,x,y,w,h,buffer,title) {
      const r=v.r;
      text(ctx,title,x,y-17,'bold 24px Segoe UI, Arial');
      ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,13);ctx.clip();
      R.draw(buffer,r,v.route,{time:this.ticks/60,trail:v.trail});ctx.drawImage(buffer,x,y,w,h);
      if(r.mode==='Rest') {
        ctx.fillStyle='rgba(15,43,50,.86)';ctx.fillRect(x,y,w,h);ctx.textAlign='center';
        text(ctx,'☾',x+w/2,y+h/2-16,'64px Georgia','#f7e5b5');
        text(ctx,'Screen off',x+w/2,y+h/2+26,'bold 32px Segoe UI, Arial','#fff3cc');ctx.textAlign='left';
      }
      ctx.restore();
      const state=r.preparation?'Crouching':r.compression?'Compressing':r.flight?.rebound?'Rebounding':r.mode==='Failed'?(r.lastHit?.reason==='hard impact'?'Hard impact':'Flight failed'):r.dock?'Docking':r.current===r.goal?'Arrived':r.mode==='Landed'&&!v.route?.path.length?'At rest':r.mode;
      text(ctx,state,x,y+h+32,'bold 23px Segoe UI, Arial',r.mode==='Failed'?'#a14734':'#14675b');
      const count=r.jumps+(r.jumps===1?' jump':' jumps');
      text(ctx,this.chapter.id==='rest'?r.energy.toFixed(1)+' stamina  /  '+count:count,x+167,y+h+32,'20px Segoe UI, Arial');
      if(['first','drop'].includes(this.chapter.id)){
        const p=r.position();
        text(ctx,'y  '+p.y.toFixed(2)+' m       vᵧ  '+p.vy.toFixed(2)+' m/s       aᵧ  '+(r.flight?.f.ay??0).toFixed(2)+' m/s²',
          x+480,y+h+32,'bold 21px Segoe UI, Arial');
      }
    }
    constrained(ctx) {
      const t=this.ticks/60,bound=4.8549927768763155;
      const ramp=(start,end)=>P.clamp((t-start)/(end-start),0,1);
      const available=6.0+(bound-6.0)*ramp(2.0,6.0)+(4.72-bound)*ramp(9.0,11.8);
      const q=HopKktPlot.draw(ctx,{x:52,y:115,width:845,height:480},{
        dx:-5.228082176763564,dy:-.7409483712865041,available,timeWeight:23.578912891447544});
      const x=923;
      text(ctx,'Available stamina',x,163,'25px Segoe UI, Arial');
      text(ctx,available.toFixed(3),x,218,'bold 48px Segoe UI, Arial','#176859');
      text(ctx,'Optimal flight time',x,294,'25px Segoe UI, Arial');
      text(ctx,q?q.T.toFixed(3)+' s':'No feasible jump',x,341,'bold 32px Segoe UI, Arial');
      text(ctx,'Lower multiplier μL',x,417,'25px Segoe UI, Arial');
      text(ctx,q?q.certificate.muLow.toFixed(2):'—',x,466,'bold 35px Segoe UI, Arial');
      const caption=!q?'The interval has vanished. No flight time reaches this centre within the stamina budget.':
        q.certificate.active==='interior'?'The free optimum is feasible. Its lower-bound multiplier is zero.':
        'The optimum follows the lower bound as stamina runs out. Its multiplier becomes positive.';
      text(ctx,caption,54,649,'24px Segoe UI, Arial');
      this.certificate=q?.certificate||null;
    }
    draw() {
      const ctx=this.canvas.getContext('2d'),id=this.chapter.id;
      if(id==='play'||id==='walk'||id==='work'||id==='stack'){
        const canvas=this.buffers[0],v=this.runs[0],r=v.r;
        R.draw(canvas,r,r.arrived()?null:v.route,{time:this.ticks/60,guides:id==='work'||id==='stack'});
        if(id==='stack')ctx.drawImage(canvas,0,0,canvas.width*.48,canvas.height*.48,0,0,1280,720);
        else ctx.drawImage(canvas,0,0,1280,720);
        ctx.save();rounded(ctx,988,24,264,74,12,'rgba(17,31,54,.76)');
        const title={walk:'Ground movement',work:'Route to Work',play:'Desktop playground',stack:'Recycle Bin → This PC'}[id];
        text(ctx,title,1005,54,'600 23px Segoe UI, Arial','#ffffff');
        const phase=r.preparation?'Crouch':r.compression?'Compression':r.flight?.rebound?'Rebound':r.flight?.edge?.wall!=null?(Math.sign(r.position().vx)===Math.sign(r.flight.f.vx)?'Toward wall':'Away from wall'):r.flight?(r.position().vy>0?'Rising':'Falling'):
          r.dock?.runup?'Run-up':r.dock?.walk?'Walking':r.arrived()?'Arrived':r.contactAge<.42?'Touchdown':'Ready';
        text(ctx,phase+'   ·   '+r.jumps+(r.jumps===1?' jump':' jumps'),1006,81,'17px Segoe UI, Arial','#deecff');
        ctx.restore();return;
      }
      ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#f8f7ed';ctx.fillRect(0,0,1280,720);
      text(ctx,'IconHop',54,57,'bold 37px Trebuchet MS, Arial');
      text(ctx,this.chapter.title,235,58,'bold 36px Trebuchet MS, Arial');
      if(id==='kkt')this.constrained(ctx);
      else if(id==='wind') {
        this.panel(ctx,this.runs[0],55,142,566,422,this.buffers[1],'Deterministic A*');
        this.panel(ctx,this.runs[1],659,142,566,422,this.buffers[2],'Risk-aware MDP');
        text(ctx,'Illustrative flight seed 2',55,693,'16px Segoe UI, Arial','#4d6860');
      } else {
        const label=id==='drop'?'Shelf to Archive · zero launch impulse':id==='first'?'Home to Mail · real time':id==='tower'?'Home to Archive':'Home to Photos';
        this.panel(ctx,this.runs[0],56,142,1168,422,this.buffers[0],label);
      }
      if(id!=='kkt')text(ctx,this.caption(),55,650,'23px Segoe UI, Arial');
      ctx.fillStyle='#d6e0d5';ctx.fillRect(0,714,1280,6);ctx.fillStyle='#278675';
      ctx.fillRect(0,714,1280*(this.ticks/60)/this.duration,6);
    }
  }
  root.HopFilm={Player,chapters};
})(globalThis);

