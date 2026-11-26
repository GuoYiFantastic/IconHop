(function() {
  'use strict';
  const P=HopPhysics,H=HopPlan,S=HopScenes,E=HopEngine,R=HopRender,C=P.C;
  const $=id=>document.getElementById(id),canvas=$('world'),key='iconhop-desktop-v3';
  const params=new URLSearchParams(location.search);
  let run,sceneId,activeRoute=null,auto=false,delay=0,trail=[],previous=performance.now();
  let nextId=1,patrol=false,patrolIds=[],clock=0;
  function opt(value,label) {const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
  const motionMethod=opt('motion','Dijkstra · minimum motion time'),motionSolver=opt('interval','Constrained ballistic flight time');
  $('method').append(motionMethod);$('solver').append(motionSolver);
  for(const s of S.scenes.filter(s=>s.id!=='rest')) $('scene').append(opt(s.id,s.name));
  function log(message) {
    const row=document.createElement('li');row.textContent=message;$('log').prepend(row);
    while($('log').children.length>35) $('log').lastChild.remove();
  }
  function persist() {
    try {localStorage.setItem(key,JSON.stringify({sceneId,icons:run.icons,current:run.current,goal:run.goal,pinnedGoalName:run.pinnedGoalName,
      seed:run.seed,noise:run.noise,mode:run.mode,method:run.method,solver:run.graph.options.solver,jumps:run.jumps,
      flightTime:run.flightTime,nextId,learning:run.learning,preparation:run.preparation,compression:run.compression,contactAge:run.contactAge,patrol,auto,
      goalOffset:run.goalOffset,stanceX:run.stanceX,explorationAttempt:run.explorationAttempt,exploredSupports:[...run.exploredSupports],recycled:desktop.recycled(),flight:run.flight,lastShot:run.lastShot,dock:run.dock,stoppedAt:run.stoppedAt,lastHit:run.lastHit,
      impacts:run.impacts,observations:run.observations.serialize(),horizon:run.options.horizon??2}));}catch{}
  }
  function setScene(id,snap=null) {
    const scene=S.get(id);sceneId=id;$('scene').value=id;$('scene-title').textContent=scene.name;
    const data=snap?{...scene,icons:snap.icons,goal:snap.goal,noise:snap.noise}:scene;
    const view=R.view(canvas,!!scene.desktop);
    run=new E.Run(data,{free:true,barWidth:view.w/view.scale,seed:snap?.seed??2026,method:snap?.method||'vi',graphOptions:{solver:snap?.solver||(id==='wind'?'gn':'arc')},
      learning:!scene.desktop&&!!snap?.learning,observations:new H.LandingHistory(snap?.observations||[]),horizon:snap?.horizon??2});
    $('horizon').value=run.options.horizon;
    $('learn').checked=run.learning;
    patrolIds=scene.patrol||[];patrol=snap?!!snap.patrol:patrolIds.length>0&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    auto=snap?!!snap.auto:(patrol||!!scene.runOnEntry);delay=.65;clock=0;activeRoute=null;trail=[];nextId=snap?.nextId||1;
    if(snap) {
      // Older sessions recorded a goal but did not tag manual selections. Preserve a
      // non-patrol goal on upgrade instead of letting the patrol replace it.
      run.pinnedGoalName='pinnedGoalName' in snap?snap.pinnedGoalName:
        (!patrol&&snap.goal?(run.graph.byId.get(snap.goal)?.name||snap.goal):null);
      if(run.pinnedGoalName!==null)patrol=false;
      run.current=snap.current;run.jumps=snap.jumps||0;run.flightTime=snap.flightTime||0;
      run.goalOffset=snap.goalOffset??0;run.stanceX=snap.stanceX??null;
      run.explorationAttempt=snap.explorationAttempt??0;run.exploredSupports=new Map(snap.exploredSupports||[]);
      run.impacts=(snap.impacts||[]).slice(-32);
      run.dock=snap.dock||null;run.lastHit=snap.lastHit||null;run.stoppedAt=snap.stoppedAt||null;run.lastShot=snap.lastShot||null;
      run.preparation=snap.preparation||null;run.compression=snap.compression||null;run.contactAge=snap.contactAge??Infinity;
      if(run.desktop){
        if(run.preparation&&!run.canLaunch(run.preparation.edge))run.preparation=null;
        const queued=run.dock?.runup||run.dock?.then;
        if(queued&&!run.canLaunch(queued))run.stopWalk();
      }
      if(snap.mode==='Airborne'&&snap.flight){
        run.flight=snap.flight;run.mode='Airborne';
        if(run.impactLimit===Infinity&&run.flight.hit?.reason==='hard impact'&&run.flight.hit.icon){
          run.flight.hit.safe=true;run.flight.hit.reason='landed';
        }
      }
      else if(['Airborne','Failed'].includes(snap.mode)) {run.mode='Failed';run.current=null;run.reason='recover at home';}
      else if(run.current===run.goal) run.reason='arrived';
    }
    motionMethod.hidden=motionSolver.hidden=!run.desktop;
    $('manual-strength').textContent=run.desktop?'Peak push (N)':'Impulse (N·s)';
    $('effort-label').textContent=run.desktop?'Peak push':'Next impulse';
    $('manual-j').max=run.desktop?P.pushOff.peakForce:C.maxJ;
    $('manual-j').value=run.desktop?60:7.45;$('manual-angle').value=run.desktop?85:45;
    $('manual-msg').textContent='';
    motionMethod.disabled=motionSolver.disabled=!run.desktop;
    $('method').value=run.desktop?'motion':run.method;$('solver').value=run.desktop?'interval':run.graph.options.solver;
    $('learning-panel').hidden=run.desktop;$('graph-label').textContent=run.desktop?'Show planned route':'Reachable edges';
    $('noise').value=String(run.noise);if(run.noise===.5) $('noise').value='.5';
    $('seed').value=run.seed;$('instructions').textContent=scene.brief+' Drag to move an icon. Right-click the desktop to create a file.';
    $('log').replaceChildren();log(snap?'Restored desktop session.':'Loaded '+scene.name+'.');
    desktop.reset(snap?.recycled||[]);syncOptions();refresh();persist();
  }
  function syncOptions() {
    const old=$('edit-id').value;
    $('target').replaceChildren(opt('','No target'));$('edit-id').replaceChildren();
    for(const p of run.icons){$('target').append(opt(p.id,p.name));$('edit-id').append(opt(p.id,p.name));}
    if(run.desktop)$('target').append(opt(HopGround.BAR,'Taskbar'));
    if(run.pinnedGoalName!==null&&!run.surface(run.goal)){
      const missing=opt(run.goal,run.pinnedGoalName+' (unavailable)');missing.disabled=true;$('target').append(missing);
    }
    $('target').value=run.goal||'';$('edit-id').value=run.icons.some(p=>p.id===old)?old:run.icons[0]?.id||'';
    editFields();
  }
  function editFields() {
    const p=run.icons.find(p=>p.id===$('edit-id').value);if(!p) return;
    $('edit-x').value=p.x.toFixed(2);$('edit-y').value=p.y.toFixed(2);$('edit-w').value=p.w.toFixed(2);
  }
  const name=id=>run.surface(id)?.name||id||'—';
  const message=()=>{
    if(run.exploring())return 'Exploring from '+name(run.current)+' toward '+name(run.goal)+'.';
    if(run.preparation)return 'Crouching for takeoff.';
    if(run.compression)return 'Touchdown. The ball compresses against the platform.';
    if(run.flight?.rebound)return 'Rebounding from the landing.';
    if(run.mode==='Airborne') return run.flight.release?'Support removed. Falling under gravity.':('wall' in run.flight.edge?'Banking off the desktop edge toward ':'Flying to ')+name(run.flight.edge.to)+'.';
    if(run.dock?.runup)return 'Running up on '+name(run.current)+' to jump to '+name(run.dock.runup.to)+'.';
    if(run.dock?.walk)return 'Walking along '+name(run.current)+'.';
    if(run.dock)return 'Touchdown on '+name(run.current)+'. Moving along the platform to the launch point.';
    if(run.mode==='Failed'){
      if(!run.icons.length)return 'Add a platform so the pet can recover.';
      const support=run.icons.find(p=>p.id===run.home)||run.icons[0];
      return 'Flight ended · '+run.reason+'. Recover on '+support.name+' to try again.';
    }
    if(run.arrived()) return 'Arrived at '+name(run.goal)+(run.pinnedGoalName!==null?'. Target retained.':'. Choose another target.');
    if(!run.goal) return 'Choose a target icon.';
    if(run.pinnedGoalName!==null&&!run.surface(run.goal))return 'Target saved: '+run.pinnedGoalName+'. Waiting for this icon to be restored.';
    if(!activeRoute?.path.length) {
      if(run.desktop)return (auto?'Trying new takeoffs from ':'No route found from ')+name(run.current)+' to '+name(run.goal)+'.';
      return 'No jump route to '+name(run.goal)+'. Add or move a platform.';
    }
    if(!auto)return 'Ready to go to '+name(run.goal)+'. Press Run route to start.';
    return activeRoute.path[0].kind==='walk'?'Ready to walk along '+name(run.current)+'.':'Ready to jump from '+name(run.current)+' to '+name(activeRoute.path[0].to)+'.';
  };
  function directShot(){
    if(!run.desktop)return run.graph.edges.get(H.edgeKey(run.current,run.goal));
    const target=run.surface(run.goal);
    if(!target||!run.current||run.current===run.goal)return null;
    return HopGround.ballisticEdge({...run.position(),id:run.current},{...target,x:run.goalPoint()},[...run.icons,run.surface(HopGround.BAR)]);
  }
  function refresh() {
    $('horizon-label').hidden=run.method!=='mpc';$('horizon').disabled=run.mode==='Airborne';
    if(run.mode==='Landed') activeRoute=run.plan();
    else if(run.mode!=='Airborne') activeRoute=null;
    const e=run.mode==='Airborne'?run.flight.edge:activeRoute?.path[0];
    $('drop-support').disabled=run.mode!=='Landed'||run.current===HopGround.BAR;
    const moving=!!(run.flight||run.dock||run.preparation||run.compression);
    const waiting=auto&&run.mode==='Landed'&&!moving&&!run.arrived()&&run.pinnedGoalName!==null&&!e;
    const exploring=run.exploring()||(waiting&&canExplore());
    $('mode').textContent=exploring?'Exploring':run.preparation?'Crouching':run.compression?'Compressing':run.flight?.rebound?'Rebounding':run.dock?.runup?'Run-up':run.dock?.walk?'Walking':waiting?'Waiting for a route':run.mode;$('status').textContent=message();
    const planned=activeRoute?.path||[];
    $('path').textContent=planned.length?[name(planned[0].from),...planned.flatMap(x=>[...(x.runup?['Run-up']:[]),...('wall' in x?['Side bounce']:[]),x.kind==='walk'?'Walk':name(x.to)])].join(' › '):
      (run.current===run.goal&&run.goal?name(run.goal):'—');
    $('impulse').textContent=e?.q?(run.desktop?P.pushForce(e.q.J).toFixed(1)+' N':e.q.J.toFixed(2)+' N·s'):'—';
    $('chance').textContent=Number.isFinite(e?.p)?Math.round(e.p*100)+'%':'—';
    const learned=e&&run.observations.counts.get(H.edgeKey(e.from,e.to));
    $('chance').title=Number.isFinite(e?.n)?e.successes+'/'+e.n+' simulated landings'+
      (run.learning&&learned?' · '+learned.hits+'/'+learned.total+' observed landings':''):'';
    const observationCount=[...run.observations.counts.values()].reduce((sum,c)=>sum+c.total,0);
    $('observed').textContent=observationCount+' recorded '+(observationCount===1?'flight':'flights');
    $('learn').disabled=run.mode==='Airborne';$('clear-learn').disabled=run.mode==='Airborne'||!observationCount;
    $('manual-fire').disabled=run.mode!=='Landed'||!!run.dock||!!run.preparation||!!run.compression||!run.surface(run.goal)||run.current===run.goal;
    $('copy-shot').disabled=$('manual-fire').disabled||!directShot();
    $('count').textContent=run.jumps;$('impact').textContent=run.lastHit?run.lastHit.speed.toFixed(2)+' m/s':'—';
    $('impact-history').hidden=run.impactLimit!==Infinity;
    $('impact-events').replaceChildren(...run.impacts.slice(-8).reverse().map(h=>{
      const row=document.createElement('li');
      row.textContent=name(h.support)+' · '+h.before.toFixed(2)+' → '+h.after.toFixed(2)+' J · '+h.lost.toFixed(2)+' J lost';
      return row;
    }));
    const replay=run.arrived();
    const pinned=run.pinnedGoalName!==null,arrived=pinned&&replay;
    $('run').textContent=run.mode==='Failed'?(run.graph.byId.has(run.home)?'Return home':'Recover on platform'):
      arrived?'Arrived':waiting&&!exploring?'Pause auto-retry':auto?'Pause':!run.goal&&patrolIds.length?'Resume patrol':replay?(patrolIds.length?'Resume patrol':'Jump back'):'▶ Run route';
    $('run').disabled=run.mode==='Failed'?!run.icons.length:!!arrived||(!run.goal?!patrolIds.length:!pinned&&!auto&&!moving&&!e&&!replay);
    $('cancel-target').disabled=!run.goal;
    $('step').disabled=run.mode!=='Landed'||!!run.dock||!!run.preparation||!!run.compression||!e||auto;
    $('method').disabled=$('solver').disabled=run.desktop||run.mode==='Airborne';$('noise').disabled=run.mode==='Airborne';$('seed').disabled=run.mode==='Airborne';
    $('target').value=run.goal||'';paint();
  }
  function paint(time=clock) {
    R.draw(canvas,run,activeRoute,{time,guides:$('graph').checked,graph:$('graph').checked,...desktop.drawing(),trail});
    const p=run.position();
    $('horizontal-position').textContent=p.x.toFixed(2)+' m';
    $('horizontal-speed').textContent=p.vx.toFixed(2)+' m/s';
    $('height').textContent=p.y.toFixed(2)+' m';
    $('vertical-speed').textContent=p.vy.toFixed(2)+' m/s';
    $('vertical-accel').textContent=(run.flight?.f.ay??0).toFixed(2)+' m/s²';
  }
  function canExplore(){return run.desktop&&run.pinnedGoalName!==null&&!!run.surface(run.goal);}
  function takeoff() {
    if(run.requestJump()||(auto&&canExplore()&&run.explore()))trail=[];
    else if(run.pinnedGoalName===null)auto=false;
    else delay=.42;
    refresh();persist();
  }
  function choose(id,jump=false,x=null) {
    if(!run.select(id,{pin:true,x})) return;
    patrol=false;auto=jump;delay=0;log('Target set to '+name(id)+'.');syncOptions();refresh();
    if(jump&&!run.arrived()&&run.mode==='Landed'&&!run.dock&&!run.preparation&&!run.compression&&activeRoute?.path.length)takeoff();
    else persist();
  }
  function cancelTarget(){
    run.clearTarget();patrol=false;auto=false;activeRoute=null;
    log('Target cancelled.');syncOptions();refresh();persist();
  }
  function updateIcons(next,action) {
    const now=performance.now(),wasAirborne=run.mode==='Airborne';run.edit(next);
    if(!wasAirborne&&run.mode==='Airborne') {if(run.pinnedGoalName===null)auto=false;trail=[run.position()];activeRoute=null;}
    syncOptions();refresh();
    const elapsed=performance.now()-now;
    const effort=run.desktop?(activeRoute?.states??0)+' sampled stances':run.graph.stats.solves+' pairs solved';
    log(action+' · '+effort+' · '+elapsed.toFixed(1)+' ms including UI update.');
    persist();
  }
  function add(point,width=1.9) {
    let id;do{id='user'+nextId++;}while(run.icons.some(p=>p.id===id));
    const p=S.icon(id,point.x,point.y,width,'Folder '+(nextId-1));
    updateIcons([...run.icons,p],'Added '+p.name);$('edit-id').value=id;editFields();
  }
  function nextPatrolTarget(){
    const ids=patrolIds.filter(id=>run.graph.byId.has(id));
    if(ids.length<2)return false;
    const at=ids.indexOf(run.current);
    for(let j=1;j<=ids.length;j++){
      const id=ids[(at+j)%ids.length];
      if(id===run.current)continue;
      run.select(id);if(run.plan().path.length)return true;
    }
    return false;
  }
  function frame(now) {
    // Embedded previews can keep delivering frames while reporting hidden.
    // Advance on delivered frames and limit the gap when a suspended tab wakes.
    const dt=P.clamp((now-previous)/1000,0,.1);previous=now;clock+=dt;
    const oldMode=run.mode,oldCount=run.jumps,wasDock=!!run.dock,wasPreparing=!!run.preparation,wasCompressed=!!run.compression;
    run.advance(dt);
    if(run.jumps!==oldCount){trail=[];log('Takeoff · '+run.lastShot.q.J.toFixed(2)+' N·s');}
    if(run.flight){trail.push(run.position());if(trail.length>350)trail.shift();}
    const landed=(oldMode==='Airborne'||wasPreparing)&&!run.flight&&!run.preparation&&!!run.lastHit;
    if(landed){
      trail.push(run.lastHit);delay=.42;
      log(run.reason+' · impact '+run.lastHit.speed.toFixed(2)+' m/s');
      if(run.pinnedGoalName===null&&(run.mode==='Failed'||(run.arrived()&&!patrol)))auto=false;
    }
    if(!landed&&auto&&run.mode==='Landed'&&!run.dock&&!run.preparation&&!run.compression){
      delay-=dt;
      if(delay<=0&&(run.arrived()||run.pinnedGoalName===null||activeRoute?.path.length||canExplore())){
        if(run.arrived()&&(!patrol||!nextPatrolTarget()))auto=false;
        if(auto)takeoff();else {refresh();persist();}
      }
    }
    if(oldMode!==run.mode||oldCount!==run.jumps||wasDock!==!!run.dock||wasPreparing!==!!run.preparation||wasCompressed!==!!run.compression){refresh();persist();}
    paint();
    requestAnimationFrame(frame);
  }
  $('run').onclick=()=>{
    if(run.mode==='Failed') {run.recover();trail=[];refresh();persist();return;}
    if(auto) {auto=false;patrol=false;run.stopWalk();run.preparation=null;refresh();persist();return;}
    if(patrolIds.length&&run.pinnedGoalName===null)patrol=true;
    if(run.flight||run.dock||run.preparation||run.compression){auto=true;refresh();persist();return;}
    if((!run.goal||run.current===run.goal)&&run.pinnedGoalName===null){
      if(patrolIds.length){patrol=true;if(!nextPatrolTarget()){patrol=false;refresh();return;}}
      else if(run.lastShot&&run.graph.byId.has(run.lastShot.from))run.select(run.lastShot.from);
      else if(run.current!==run.home&&run.graph.byId.has(run.home))run.select(run.home);
    }
    auto=true;takeoff();
  };
  $('step').onclick=()=>{auto=false;patrol=false;takeoff();};
  $('copy-shot').onclick=()=>{
    const e=directShot();if(!e)return;
    $('manual-j').value=String(run.desktop?P.pushForce(e.q.J):e.q.J);$('manual-angle').value=String(e.q.theta*180/Math.PI);
    $('manual-msg').textContent='Loaded the direct shot to '+name(run.goal)+'.';
  };
  $('manual-fire').onclick=()=>{
    const strength=$('manual-j').valueAsNumber,degrees=$('manual-angle').valueAsNumber;auto=false;
    const j=run.desktop?strength*P.pushOff.duration/2:strength;
    if(!run.manual(j,degrees)) {
      $('manual-msg').textContent=run.desktop?'Use a peak push up to '+P.pushOff.peakForce+' N. Aim closer to vertical if the foot would slip.':'Use 0 < impulse ≤ 8.35 and 0° to 180°.';return;
    }
    $('manual-msg').textContent='Manual launch.';trail=[run.position()];activeRoute={path:[run.preparation.edge]};
    log('Manual launch to '+name(run.goal)+' · '+j.toFixed(2)+' N·s at '+degrees.toFixed(1)+'°.');
    refresh();persist();
  };
  $('target').onchange=e=>e.target.value?choose(e.target.value,run.desktop):cancelTarget();
  $('cancel-target').onclick=cancelTarget;
  $('method').onchange=e=>{auto=false;run.method=e.target.value;refresh();persist();};
  $('horizon').onchange=e=>{auto=false;run.options.horizon=P.clamp(Math.floor(Number(e.target.value)||2),1,12);
    e.target.value=run.options.horizon;refresh();persist();};
  $('noise').onchange=e=>{auto=false;run.noise=Number(e.target.value);run.graph=new H.Graph(run.icons,
    {...run.graph.options,noise:run.noise});run.clearObservations();refresh();persist();};
  $('solver').onchange=e=>{auto=false;run.graph=new H.Graph(run.icons,{...run.graph.options,solver:e.target.value});
    run.clearObservations();refresh();persist();};
  $('learn').onchange=e=>{auto=false;run.setLearning(e.target.checked);refresh();persist();};
  $('clear-learn').onclick=()=>{run.clearObservations();refresh();persist();};
  $('seed').onchange=e=>{run.seed=P.clamp(Math.trunc(Number(e.target.value)||0),0,4294967295);e.target.value=run.seed;persist();};
  $('scene').onchange=e=>setScene(e.target.value);
  $('reset').onclick=()=>{
    if(run.pinnedGoalName===null&&run.goal!==null){setScene(sceneId);return;}
    const goal=run.goal,label=run.pinnedGoalName,offset=run.goalOffset,wasRunning=auto;
    setScene(sceneId);
    patrol=false;auto=wasRunning;run.goal=goal;run.goalOffset=offset;run.pinnedGoalName=run.surface(goal)?.name??label;
    syncOptions();refresh();persist();
  };
  $('graph').onchange=()=>paint();$('fullscreen').onclick=async()=>{
    try{if(document.fullscreenElement) await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    catch{log('Full screen unavailable. Use the browser full-screen command.');}
  };
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen ↙':'Full screen ↗';});
  function fields() {
    const values=['edit-x','edit-y','edit-w'].map(id=>$(id).valueAsNumber);
    if(values.some(v=>!Number.isFinite(v)))return null;
    return {x:P.clamp(values[0],.55,18.95),y:P.clamp(values[1],.55,8),w:P.clamp(values[2],.35,3.5)};
  }
  $('edit-id').onchange=editFields;
  $('apply-edit').onclick=()=>{const v=fields(),id=$('edit-id').value;if(v&&id)updateIcons(run.icons.map(p=>p.id===id?{...p,...v}:p),'Edited '+name(id));};
  $('add-edit').onclick=()=>{const v=fields();if(v)add(v,v.w);};
  $('remove-edit').onclick=()=>{const id=$('edit-id').value;if(id)updateIcons(run.icons.filter(p=>p.id!==id),'Removed '+name(id));};
  $('drop-support').onclick=()=>{
    if(run.mode==='Landed')updateIcons(run.icons.filter(p=>p.id!==run.current),'Removed supporting platform');
  };
  const desktop=HopDesktop.bind({canvas,getRun:()=>run,commit:updateIcons,jump:(id,x)=>choose(id,true,x),cancelTarget,paint});
  let snap=null;
  try{
    snap=JSON.parse(localStorage.getItem(key));
    if(!snap){
      const old=JSON.parse(localStorage.getItem('iconhop-play-v2'));
      const original=[['home',3.5,2.55],['mail',7.5,3.9],['photos',11.25,2.75],['notes',15.6,4]];
      const untouched=old?.icons?.length===original.length&&original.every(([id,x,y])=>
        old.icons.some(p=>p.id===id&&p.x===x&&p.y===y));
      if(old&&(old.sceneId!=='play'||!untouched))snap=old;
    }
  }catch{}
  const explicit=S.scenes.find(s=>s.id===params.get('scene'));
  try{setScene(explicit?.id==='rest'?'play':explicit?.id||snap?.sceneId||'play',explicit&&explicit.id!==snap?.sceneId?null:snap);}catch{setScene('play');}
  document.addEventListener('keydown',ev=>{if(ev.code==='Space'&&!ev.repeat&&['BODY','CANVAS'].includes(ev.target.tagName)){
    ev.preventDefault();if(!$('run').disabled)$('run').click();
  }});
  window.addEventListener('pagehide',persist);
  function resizeDesktop(){
    if(run.desktop){
      const v=R.view(canvas,true),width=v.w/v.scale;
      if(width>0&&Math.abs(width-run.barWidth)>1e-5){
        const here=run.position();run.barWidth=width;
        if(run.current===HopGround.BAR&&run.mode==='Landed'){
          run.stopWalk();run.stanceX=HopGround.onSurface(run.surface(HopGround.BAR),here.x);
        }
        run.edit(run.icons);refresh();persist();return;
      }
    }
    paint();
  }
  new ResizeObserver(resizeDesktop).observe(canvas);
  document.addEventListener('visibilitychange',()=>{previous=performance.now();if(document.hidden)persist();});
  requestAnimationFrame(frame);
})();

