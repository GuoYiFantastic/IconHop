(function(){
  'use strict';
  const P=HopPhysics,S=HopScenes,H=HopPlan,E=HopEngine,T=HopTracking;
  const $=id=>document.getElementById(id),canvas=$('plot'),ctx=canvas.getContext('2d');
  const ink='#1c4040',green='#177264',orange='#af602e',blue='#39637e',grid='#d7e1d7';
  let tab='shoot',values={},lastGraph=null,lastSeed=null;
  let frontierLayout=null,mailDecision=null;
  const sections={
    shoot:{title:'How does curvature change the shooting step?',intro:'Both solvers start from the same launch. Change the target displacement and inspect the accepted least-squares objectives.',source:'Lectures 07–08, steepest descent, backtracking and Gauss–Newton. Lecture 10, direct single shooting.',formula:'F(u) = ½ ‖r(u)‖². Gauss–Newton solves (AᵀA + λI) d = −Aᵀr, with A = ∂r/∂u.'},
    kkt:{title:'When does a stamina limit change flight time?',intro:'This solver targets the icon centre. The shaded band contains flight times that satisfy the impulse, impact and launch-direction constraints.',source:'Lectures 09–10, equality elimination and the four KKT conditions. The certificate applies to the endpoint problem. Scene-wide contacts still require certification.',formula:'With s = T², F(s) = ½ (B/s + g Δy + g²s/4) + λs. The optimum is the unconstrained minimizer projected onto the feasible interval.'},
    bellman:{title:'Why does the pet change route at Mail?',intro:'Replay the decision after two landings in Windy shortcuts, seed 2. Change the cost of a failed jump. The planner recomputes the continuation from each possible landing with the remaining stamina.',source:'Lecture 02, Bellman optimality and value iteration. The 64 simulated gusts per arc are separate from the gusts used to execute the route in the film.',formula:'Q = c + pV(next icon, remaining stamina) + (1 − p)F. The action with the smallest Q determines the next landing.'},
    mpc:{title:'How far ahead should the pet plan?',intro:'Each bar is the target-reaching rate on the displayed layout over 64 paired gust sequences. The finite-horizon policy executes one jump and re-solves on landing.',source:'Lecture 02, Bellman backups. Lectures 05–06, receding-horizon control. Lecture 12, Dijkstra and A* on a certified graph.',formula:'At the horizon, use the deterministic cost-to-go. Before it, minimize flight and stamina cost plus expected successor or failure cost.'},
    kf:{title:'Can past flights help aim the next jump?',intro:'Follow 18 alternating transfers between two icons. Every trial starts from its prescribed dock, including after a miss. Observations arrive after takeoff and influence later launches.',source:'State Estimation, linear Kalman prediction and correction. Lecture 04, finite-horizon linear-quadratic feedback. Wind correlation is an explicit extension to the original independent-gust model.',formula:'Position residual z(t) = ½t²w + ε. The next launch applies δv = −T(T² + R)⁻¹d, with d = ½T² ŵ and R = 0.04.'},
    frontier:{title:'How much stamina does a reach target cost?',intro:'Each dot is a complete route. Choose a minimum predicted chance of arrival. The planner picks the least expected stamina among routes meeting that target. If none qualifies, it picks the highest-reach route.',source:'An extension of Lecture 02 dynamic programming and Lectures 09–10 constrained optimization. The model uses 128 gusts per arc. Trials below use independent gusts.',formula:'A jump with success p and stamina debit e transforms a continuation (P, E) into (pP, e + pE). Discard a route if another uses no more expected stamina and reaches at least as often.'}
  };
  function range(key,label,min,max,value,step){
    values[key]=value;
    const l=document.createElement('label'),head=document.createElement('span'),out=document.createElement('b'),input=document.createElement('input');
    head.textContent=label;out.className='unit';out.textContent=value;head.append(out);
    input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.id='lab-'+key;
    input.oninput=()=>{values[key]=Number(input.value);out.textContent=input.value;draw();};
    l.append(head,input);$('controls').append(l);
  }
  function selection(key,label,choices,initial){
    values[key]=initial;const l=document.createElement('label'),s=document.createElement('select');
    l.textContent=label;s.id='lab-'+key;for(const [v,n] of choices)s.add(new Option(n,v));s.value=initial;
    s.onchange=()=>{values[key]=s.value;draw();};l.append(s);$('controls').append(l);
  }
  function metrics(pairs){const d=$('results');d.replaceChildren();for(const [label,value] of pairs){
    const item=document.createElement('div'),l=document.createElement('span'),v=document.createElement('strong');
    l.textContent=label;v.textContent=value;item.append(l,v);d.append(item);
  }}
  function table(rows){const d=$('snap-table');d.replaceChildren();for(const [i,row] of rows.entries()){
    const tr=document.createElement('tr');for(const value of row){const c=document.createElement(i?'td':'th');c.textContent=value;tr.append(c);}d.append(tr);
  }}
  function write(value,x,y,color=ink,size=18,align='left'){
    ctx.fillStyle=color;ctx.textAlign=align;ctx.font=size+'px Segoe UI, Arial';ctx.fillText(value,x,y);
  }
  function axis({x0,x1,y0,y1,xLabel,yLabel,xText=x=>x.toFixed(1),yText=y=>y.toFixed(1),nx=6,ny=5}){
    const L=100,R=1015,top=66,bottom=476;
    const X=x=>L+(x-x0)/(x1-x0)*(R-L),Y=y=>bottom-(y-y0)/(y1-y0)*(bottom-top);
    ctx.lineWidth=1;ctx.strokeStyle=grid;
    for(let i=0;i<=ny;i++){const y=y0+(y1-y0)*i/ny;ctx.beginPath();ctx.moveTo(L,Y(y));ctx.lineTo(R,Y(y));ctx.stroke();write(yText(y),L-12,Y(y)+6,ink,17,'right');}
    if(nx>0)for(let i=0;i<=nx;i++){const x=x0+(x1-x0)*i/nx;write(xText(x),X(x),bottom+25,ink,17,'center');}
    write(yLabel,L,38,ink,21);write(xLabel,(L+R)/2,550,ink,20,'center');
    return {X,Y,L,R,top,bottom};
  }
  function curve(ax,points,color,width=3,dash=[]){
    ctx.save();ctx.beginPath();ctx.rect(ax.L,ax.top,ax.R-ax.L,ax.bottom-ax.top);ctx.clip();
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();
    points.forEach(([x,y],i)=>i?ctx.lineTo(ax.X(x),ax.Y(y)):ctx.moveTo(ax.X(x),ax.Y(y)));
    ctx.stroke();ctx.restore();
  }
  function label(text,x,y,color){ctx.fillStyle=color;ctx.fillRect(x,y-9,22,4);write(text,x+30,y,color,17);}
  function shooting(){
    const a=S.icon('a',0,4,2,'A'),b=S.icon('b',values.dx,4+values.dy,2,'B'),series=[];
    for(const method of ['gd','gn']){
      const trace=[];const q=P.shoot(a,b,method+(values.search==='armijo'?'-armijo':''),trace);
      series.push({method,trace,q});
    }
    const vals=series.flatMap(s=>s.trace.map(r=>r.cost));
    if(!vals.length){write('The endpoint lies beyond the analytic impulse or impact bound.',66,270,ink,26);metrics([]);table([]);return;}
    const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(.000001,(hi-lo)*.10);
    const ax=axis({x0:0,x1:Math.max(5,...series.map(s=>s.trace.length-1)),y0:Math.max(0,lo-pad),y1:hi+pad,
      xLabel:'Iteration',yLabel:'Shooting objective F',xText:x=>x.toFixed(0),yText:y=>y.toFixed(5)});
    series.forEach((s,i)=>curve(ax,s.trace.map(r=>[r.iteration,r.cost]),i?green:orange,3.5));
    label('Gradient descent',565,38,orange);label('Gauss–Newton',786,38,green);
    metrics([]);table([['Solver','Iterations','Last objective','Certified by target check'],...series.map((s,i)=>
      [i?'Gauss–Newton':'Gradient descent',s.trace.length,s.trace.at(-1)?.cost.toFixed(6)||'—',s.q?'Yes':'No'])]);
  }
  function constrained(){
    const q=HopKktPlot.draw(ctx,{x:0,y:0,width:canvas.width,height:canvas.height},
      {dx:values.dx,dy:values.dy,available:values.energy,timeWeight:values.weight});
    metrics(q?[['Active bound',q.certificate.active],['Flight time',q.T.toFixed(3)+' s'],['Impulse',q.J.toFixed(3)+' N·s'],
      ['Stationarity residual',q.certificate.stationarity.toExponential(1)]]:[['Feasibility','No centre-reaching shot within the budget']]);
    table(q?[['Feasible interval for s','Lower multiplier','Upper multiplier','Complementarity residual'],
      [q.certificate.low.toFixed(3)+' – '+q.certificate.high.toFixed(3),q.certificate.muLow.toFixed(4),q.certificate.muHigh.toFixed(4),q.certificate.complementarity.toExponential(1)]]:[]);
  }
  function bellman(){
    if(!mailDecision) mailDecision=HopBellmanExample.atMail();
    const decision=HopBellmanExample.evaluate(mailDecision,values.penalty);
    const name=id=>mailDecision.graph.byId.get(id).name;
    const highest=Math.max(...decision.choices.map(action=>action.expected));
    const axisTop=5*Math.ceil((highest+2)/5);
    const ax=axis({x0:0,x1:decision.choices.length,y0:0,y1:axisTop,nx:0,ny:5,
      yText:y=>y.toFixed(0),xLabel:'Next landing',yLabel:'Bellman action cost Q'});
    label('Current jump',435,38,blue);
    label('Continuation',620,38,green);
    label('Failure',814,38,orange);
    const rows=[['Action','Model landings','Jump cost c','Success term pV','Failure term','Total Q']];
    decision.choices.forEach((action,index)=>{
      const p=action.hits/action.trials;
      const continuation=p*action.future;
      const failure=(1-p)*decision.failureCost;
      const x=ax.X(index+.5);
      let bottom=0;
      for(const [part,color] of [[action.stage,blue],[continuation,green],[failure,orange]]){
        ctx.fillStyle=color;
        ctx.fillRect(x-62,ax.Y(bottom+part),124,ax.Y(bottom)-ax.Y(bottom+part));
        bottom+=part;
      }
      write(action.expected.toFixed(3),x,ax.Y(action.expected)-8,ink,21,'center');
      write(name(action.to),x,ax.bottom+27,ink,20,'center');
      rows.push([name(action.to),action.hits+' / '+action.trials,action.stage.toFixed(3),
        continuation.toFixed(3),failure.toFixed(3),action.expected.toFixed(4)]);
    });
    metrics([['Value iteration chooses',name(decision.vi)],['A* chooses',name(decision.astar)],
      ['Stamina at Mail',decision.stamina.toFixed(3)],['Budget state',decision.budget+' bins']]);
    table(rows);
  }
  function horizon(){
    const id=values.layout;
    if(lastSeed!==id){const s=id==='wind'?S.get(id):S.generate(Number(id));
      lastGraph={s,g:new H.Graph(s.icons,{noise:1}),cache:new Map()};lastSeed=id;}
    const {s,g,cache}=lastGraph;
    const methods=[['A*','astar'],['H = 1','mpc',1],['H = '+values.horizon,'mpc',values.horizon],['Full VI','vi']];
    const rows=[['Policy','First landing','Planned prefix','Reach / 64']];
    const rates=[];
    for(const [title,method,h] of methods){
      const plan=H.plan(g,s.start,s.goal,s.energy,method,{horizon:h??2});
      let wins=0;for(let k=0;k<64;k++)wins+=E.episode(s,{graph:g,cache,method,horizon:h??2,seed:P.hash('lab-flight',k)}).reached;
      rates.push(wins/64);rows.push([title,g.byId.get(plan.path[0]?.to)?.name||'—',plan.path.map(e=>g.byId.get(e.to).name).join(' › ')||'—',wins]);
    }
    const ax=axis({x0:0,x1:4,y0:0,y1:1,xLabel:'Planner',yLabel:'Target-reaching rate',nx:0,ny:4,yText:y=>(100*y).toFixed(0)+'%'});
    rates.forEach((value,i)=>{const w=112;ctx.fillStyle=i===3?green:blue;ctx.fillRect(ax.X(i+.5)-w/2,ax.Y(value),w,ax.bottom-ax.Y(value));
      write((100*value).toFixed(1)+'%',ax.X(i+.5),ax.Y(value)-8,ink,20,'center');write(methods[i][0],ax.X(i+.5),ax.bottom+28,ink,18,'center');});
    const aa=H.plan(g,s.start,s.goal,s.energy,'astar'),dd=H.plan(g,s.start,s.goal,s.energy,'dijkstra');
    metrics([['A* expanded',aa.expanded],['Dijkstra expanded',dd.expanded],['Deterministic optimal cost',Number.isFinite(aa.value)?aa.value.toFixed(2):'Unreachable']]);table(rows);
  }
  function filtering(){
    const options={rho:values.rho,noiseSD:values.sensor};
    if(values.assumption==='quiet')options.assumedNoiseSD=values.sensor/3;
    else if(values.assumption==='persistent')options.modelRho=.90;
    else if(values.assumption==='independent')options.modelRho=0;
    const a=T.shuttle(values.seed,{...options,method:'kalman'}).records;
    const base=T.shuttle(values.seed,{...options,method:'open'}).records;
    const bound=Math.max(2,...a.map(r=>Math.abs(r.actual[0])),...a.map(r=>Math.abs(r.predicted[0])+1.96*Math.sqrt(r.priorVariance[0])));
    const ax=axis({x0:1,x1:a.length,y0:-Math.ceil(bound),y1:Math.ceil(bound),xLabel:'Transfer number',yLabel:'Lateral acceleration (m/s²)',xText:x=>x.toFixed(0),nx:5});
    const range=a.map(r=>1.96*Math.sqrt(r.priorVariance[0]));
    ctx.fillStyle='rgba(52,136,105,.16)';ctx.beginPath();
    a.forEach((r,i)=>i?ctx.lineTo(ax.X(r.jump),ax.Y(r.predicted[0]+range[i])):ctx.moveTo(ax.X(r.jump),ax.Y(r.predicted[0]+range[i])));
    for(let i=a.length-1;i>=0;i--)ctx.lineTo(ax.X(a[i].jump),ax.Y(a[i].predicted[0]-range[i]));ctx.closePath();ctx.fill();
    curve(ax,a.map(r=>[r.jump,r.actual[0]]),orange,3);curve(ax,a.map(r=>[r.jump,r.predicted[0]]),green,3);
    label('Actual gust',570,38,orange);label('Prelaunch estimate ± 1.96σ',732,38,green);
    const wins=rs=>rs.reduce((v,r)=>v+r.reached,0);
    metrics([['Open-loop landings',wins(base)+' / 18'],['KF + LQR landings',wins(a)+' / 18'],
      ['Wind prediction RMSE',Math.sqrt(a.reduce((s,r)=>s+(r.actual[0]-r.predicted[0])**2+(r.actual[1]-r.predicted[1])**2,0)/a.length).toFixed(2)+' m/s²'],
      ['Gusts inside lateral band',a.filter((r,i)=>Math.abs(r.actual[0]-r.predicted[0])<=range[i]).length+' / 18']]);table([]);
  }
  function riskAndStamina(){
    const seed=Number(values.layout);
    if(frontierLayout?.seed!==seed){
      const s=S.generate(seed,'standard'),options={samples:128,noise:1,seed:P.hash('frontier-training',seed)};
      const gn=new H.Graph(s.icons,{...options,solver:'gn'}),exposure=new H.Graph(s.icons,{...options,solver:'exposure'});
      frontierLayout={seed,s,gn,exposure,solution:HopFrontier.solve([gn,exposure],s.start,s.goal,s.energy)};
    }
    const {s,gn,exposure,solution}=frontierLayout,threshold=values.threshold/100,route=HopFrontier.choose(solution,threshold);
    const xmax=Math.max(5,Math.ceil(Math.max(0,...solution.frontier.map(q=>q.energy))/5)*5);
    const ax=axis({x0:0,x1:xmax,y0:0,y1:1,xLabel:'Expected stamina per attempt',yLabel:'Predicted route reach',yText:y=>Math.round(y*100)+'%',nx:5,ny:4});
    curve(ax,[[0,threshold],[xmax,threshold]],orange,2.5,[9,6]);label('Minimum reach',558,38,orange);label('Selected route',798,38,green);
    for(const q of solution.frontier){ctx.fillStyle=blue;ctx.beginPath();ctx.arc(ax.X(q.energy),ax.Y(q.reach),4,0,2*Math.PI);ctx.fill();}
    if(route.hasRoute){ctx.fillStyle=green;ctx.beginPath();ctx.arc(ax.X(route.energy),ax.Y(route.reach),8,0,2*Math.PI);ctx.fill();}
    let wins=0,spent=0;
    for(let k=0;k<96;k++){
      const out=HopFrontier.execute(s,gn,route.path,P.hash('frontier-execution',seed,k));
      wins+=out.reached;spent+=out.energy;
    }
    metrics([['Model target',route.meetsTarget?'Met':'Infeasible'],['Predicted reach',(100*route.reach).toFixed(1)+'%'],
      ['Executed reach',wins+' / 96'],['Mean stamina used',(spent/96).toFixed(2)]]);
    table([['Jump','Launch controller','Model landing chance','Stamina'],...route.path.map(edge=>[
      gn.byId.get(edge.from).name+' → '+gn.byId.get(edge.to).name,
      exposure.edges.get(H.edgeKey(edge.from,edge.to))===edge?'Exposure-aware':'Gauss–Newton',
      (100*edge.p).toFixed(1)+'%',edge.q.energy.toFixed(2)])]);
  }
  function draw(){
    ctx.fillStyle='#fffef8';ctx.fillRect(0,0,canvas.width,canvas.height);
    ({shoot:shooting,kkt:constrained,bellman,mpc:horizon,kf:filtering,frontier:riskAndStamina})[tab]();
  }
  function select(id){
    tab=id;values={};const s=sections[id];$('title').textContent=s.title;$('intro').textContent=s.intro;$('source').textContent=s.source;$('formula').textContent=s.formula;
    $('controls').replaceChildren();for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===id));
    if(id==='shoot'||id==='kkt'){range('dx','Horizontal distance (m)',1,7.5,id==='kkt'?5.2:5,.1);range('dy','Height change (m)',-2.5,3,id==='kkt'?-.7:.6,.1);}
    if(id==='shoot')selection('search','Step acceptance',[['decrease','Backtracking decrease'],['armijo','Projected Armijo']],'armijo');
    if(id==='kkt'){range('energy','Available stamina',2.5,7,4.85,.05);range('weight','Time-squared weight λ',0,40,24,1);}
    if(id==='bellman'){
      const field=document.createElement('label'),number=document.createElement('input');
      field.textContent='Failure cost F (0–100)';
      number.type='number';number.id='lab-penalty';number.min=0;number.max=100;number.step=.01;
      number.value=P.C.failCost;values.penalty=P.C.failCost;
      number.oninput=()=>{
        if(Number.isFinite(number.valueAsNumber)&&number.validity.valid){
          values.penalty=number.valueAsNumber;draw();
        }
      };
      number.onchange=()=>{number.value=values.penalty;};
      field.append(number);$('controls').append(field);
      const hint=document.createElement('p');hint.className='lab-foot';
      hint.textContent='Try 6.4, then 6.5. The two best actions exchange rank between those costs.';
      $('controls').append(hint);
    }
    if(id==='mpc'){selection('layout','Layout',[['wind','Windy shortcuts'],['810009','Standard seed 810009'],['810035','Standard seed 810035'],['810097','Standard seed 810097']],'wind');range('horizon','Planning horizon H',2,9,4,1);}
    if(id==='kf'){range('rho','Wind correlation ρ',0,.98,.9,.02);range('sensor','Position noise σ (m)',.03,.35,.10,.01);
      selection('assumption','Filter assumption',[['matched','Match the simulated model'],['quiet','Assume one-third of sensor σ'],
        ['persistent','Assume wind correlation 0.90'],['independent','Assume uncorrelated wind']],'matched');
      range('seed','Sequence seed',910000,910299,910000,1);}
    if(id==='frontier'){selection('layout','Layout',[['980006','Standard seed 980006'],['980011','Standard seed 980011'],['980237','Standard seed 980237']],'980006');range('threshold','Minimum model reach (%)',50,100,85,1);}
    draw();
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>select(b.dataset.tab));
  select(Object.hasOwn(sections,location.hash.slice(1))?location.hash.slice(1):'shoot');
})();

