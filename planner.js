(function(root,factory) {
  if(typeof module!=='undefined' && module.exports) module.exports=factory(require('./physics'),require('./control'));
  else root.HopPlan=factory(root.HopPhysics,root.HopControl);
})(globalThis,function(P,control) {
  'use strict';
  const {C}=P;
  const edgeKey=(a,b)=>a+'>'+b;
  function makeEdge(a,b,options) {
    let q;
    if(options.solver==='arc')q=P.arcingShot(a,b);
    else if(options.solver==='exposure')q=P.exposureShot(a,b,options.noise);
    else if(options.solver==='kkt')q=control.constrainedShot(a,b);
    else q=P.shoot(a,b,options.solver);
    if(!q) return null;
    const nominal=P.trajectory(a,q);
    const rng=P.random(P.hash(options.seed,a.id,b.id,'edge-MC'));
    const flights=[];
    const box={left:Infinity,right:-Infinity,low:Infinity,high:-Infinity};
    function include(f,t) {
      const times=[0,t];
      for(const [v,acc] of [[f.vx,f.ax],[f.vy,f.ay]]) {
        const extremum=-v/acc;
        if(extremum>0 && extremum<t) times.push(extremum);
      }
      for(const s of times) {
        const z=P.at(f,s);
        box.left=Math.min(box.left,z.x);box.right=Math.max(box.right,z.x);
        box.low=Math.min(box.low,z.y);box.high=Math.max(box.high,z.y);
      }
    }
    include(nominal,q.T);
    for(let k=0;k<options.samples;k++) {
      const f=P.trajectory(a,q,P.wind(rng,options.noise));
      const hit=P.contact(f,[b]);
      // A blocker can remove a successful target hit, but cannot create one.
      if(hit.icon===b.id && hit.safe) {include(f,hit.time);flights.push(f);}
    }
    return {from:a.id,to:b.id,q,nominal,flights,box,n:options.samples,free:options.free};
  }
  function intersects(box,p) {
    return box.left<=p.x+p.w/2 && box.right>=p.x-p.w/2 &&
      box.low<=p.y+1e-8 && box.high>=p.y-1e-8;
  }
  function score(edge,icons) {
    const local=icons.filter(p=>intersects(edge.box,p));
    const hit=P.contact(edge.nominal,local);
    if(hit.icon!==edge.to || !hit.safe) return null;
    let successes=0;
    for(const f of edge.flights) {
      const h=P.contact(f,local);
      if(h.icon===edge.to && h.safe) successes++;
    }
    const q=edge.q;
    return {from:edge.from,to:edge.to,q,successes,n:edge.n,p:successes/edge.n,
      cost:edge.free?q.T:q.T+C.energyWeight*q.energy,bins:edge.free?1:Math.max(1,Math.ceil(q.energy/C.bin-1e-10))};
  }
  function validate(icons) {
    const keys=new Set();
    for(const p of icons) {
      if(typeof p.id!=='string'||!p.id||p.id.includes('>')||keys.has(p.id)||
        ![p.x,p.y,p.w].every(Number.isFinite)||p.w<=2*C.footMargin||p.y<=0)
        throw new Error('Invalid or duplicate icon: '+p.id);
      keys.add(p.id);
    }
  }
  class Graph {
    constructor(icons,options={}) {
      this.options={noise:C.noise,samples:C.samples,seed:1948,solver:'gn',...options};
      if(!Number.isInteger(this.options.samples)||this.options.samples<1||
        !Number.isFinite(this.options.noise)||this.options.noise<0) throw new Error('Invalid sampling settings');
      this.candidates=new Map();this.edges=new Map();this.icons=[];
      this.update(icons);
    }
    update(input) {
      validate(input);
      const icons=input.map(p=>({...p})), before=new Map(this.icons.map(p=>[p.id,p]));
      const changed=new Set(), regions=[];
      for(const p of icons) {
        const old=before.get(p.id);
        if(!old || old.x!==p.x || old.y!==p.y || old.w!==p.w) {
          changed.add(p.id);regions.push(p);if(old) regions.push(old);
        }
        before.delete(p.id);
      }
      for(const old of before.values()) {changed.add(old.id);regions.push(old);}
      for(const [key,e] of this.candidates) if(changed.has(e.from)||changed.has(e.to)) {
        this.candidates.delete(key);this.edges.delete(key);
      }
      const stats={solves:0,rescored:0};
      for(const a of icons) for(const b of icons) if(a!==b) {
        const key=edgeKey(a.id,b.id);
        let edge=this.candidates.get(key);
        if(changed.has(a.id)||changed.has(b.id)) {
          stats.solves++;
          edge=makeEdge(a,b,this.options);
          if(edge) this.candidates.set(key,edge);
        } else if(!edge || !regions.some(p=>intersects(edge.box,p))) continue;
        if(!edge) continue;
        stats.rescored++;
        const result=score(edge,icons);
        if(result) this.edges.set(key,result);else this.edges.delete(key);
      }
      this.icons=icons; this.byId=new Map(icons.map(p=>[p.id,p]));
      this.out=new Map(icons.map(p=>[p.id,[]]));
      for(const e of this.edges.values()) this.out.get(e.from).push(e);
      for(const es of this.out.values()) es.sort((a,b)=>a.to<b.to?-1:a.to>b.to?1:0);
      this.stats=stats;return stats;
    }
  }
  function budget(energy) {return Math.floor(energy/C.bin+1e-9);}
  class LandingHistory {
    constructor(records=[]) {
      this.counts=new Map();
      for(const entry of records) {
        if(!Array.isArray(entry)||entry.length!==3)continue;
        const [key,hits,total]=entry;
        if(typeof key==='string'&&Number.isSafeInteger(hits)&&Number.isSafeInteger(total)&&
          hits>=0&&hits<=total&&total>0)this.counts.set(key,{hits,total});
      }
    }
    probability(edge) {
      const observed=this.counts.get(edgeKey(edge.from,edge.to));
      if(!observed)return edge.successes/edge.n;
      // Eight prior trials carry the simulator estimate; a Jeffreys half-count on
      // each outcome keeps an imperfect model from assigning certainty forever.
      return (8*edge.successes/edge.n+.5+observed.hits)/(9+observed.total);
    }
    observe(edge,landed) {
      const key=edgeKey(edge.from,edge.to),c=this.counts.get(key)||{hits:0,total:0};
      this.counts.set(key,{hits:c.hits+Number(landed),total:c.total+1});
      edge.p=this.probability(edge);
    }
    apply(graph,enabled) {
      for(const edge of graph.edges.values())edge.p=enabled?this.probability(edge):edge.successes/edge.n;
    }
    serialize() {return [...this.counts].map(([key,c])=>[key,c.hits,c.total]);}
  }
  function mdp(graph,start,goal,energy,{algorithm='vi',certainty=false,failCost=C.failCost}={}) {
    const maxBudget=budget(energy);
    const nodes=graph.icons, n=nodes.length, ix=new Map(nodes.map((p,i)=>[p.id,i]));
    const size=(maxBudget+1)*n, inf=Infinity;
    const actions=nodes.map(p=>graph.out.get(p.id).map(e=>({...e,target:ix.get(e.to)})));
    let value=new Float64Array(size).fill(inf), policy=new Int16Array(size).fill(-1);
    const g=ix.get(goal), startIndex=ix.get(start);
    for(let b=0;b<=maxBudget;b++) value[b*n+g]=0;
    const actionValue=(e,b,v)=>{
      if(e.bins>b) return inf;
      const next=v[(b-e.bins)*n+e.target];
      if(!Number.isFinite(next)) return inf;
      const p=certainty?1:e.p;
      return e.cost + p*next + (1-p)*failCost;
    };
    let sweeps=0;
    if(algorithm==='pi') {
      // Build a proper policy on the feasible subset, then evaluate it exactly in stamina order.
      for(let b=1;b<=maxBudget;b++) for(let i=0;i<n;i++) if(i!==g) {
        for(let j=0;j<actions[i].length;j++) {
          const v=actionValue(actions[i][j],b,value);
          if(v<inf) {policy[b*n+i]=j;value[b*n+i]=v;break;}
        }
      }
      for(;;) {
        sweeps++;
        for(let b=1;b<=maxBudget;b++) for(let i=0;i<n;i++) {
          const k=b*n+i,j=policy[k];if(j>=0) value[k]=actionValue(actions[i][j],b,value);
        }
        let changed=false;
        for(let b=1;b<=maxBudget;b++) for(let i=0;i<n;i++) if(i!==g) {
          const k=b*n+i;let best=value[k],bestJ=policy[k];
          for(let j=0;j<actions[i].length;j++) {
            const v=actionValue(actions[i][j],b,value);
            if(v<best-1e-10) {best=v;bestJ=j;}
          }
          if(bestJ!==policy[k]) {policy[k]=bestJ;changed=true;}
        }
        if(!changed) break;
      }
    } else {
      // Synchronous value iteration. Every jump consumes at least one bin.
      for(let r=0;r<=maxBudget;r++) {
        const next=value.slice();let changed=false;sweeps++;
        for(let b=1;b<=maxBudget;b++) for(let i=0;i<n;i++) if(i!==g) {
          const k=b*n+i;
          for(let j=0;j<actions[i].length;j++) {
            const v=actionValue(actions[i][j],b,value);
            if(v<next[k]-1e-10) {next[k]=v;policy[k]=j;changed=true;}
          }
        }
        value=next;if(!changed) break;
      }
    }
    let i=startIndex,b=maxBudget;
    const path=[];
    while(i!==g && policy[b*n+i]>=0) {
      const e=actions[i][policy[b*n+i]];path.push(graph.edges.get(edgeKey(e.from,e.to)));
      b-=e.bins;i=e.target;
    }
    return {path,value:value[maxBudget*n+startIndex],sweeps};
  }
  function astar(graph,start,goal,energy,heuristic=true) {
    const b0=budget(energy),g=graph.byId.get(goal);
    // Calibrate a consistent lower bound even when an off-centre landing docks at centre.
    let unit=Infinity;
    for(const e of graph.edges.values()) {
      const dx=Math.abs(graph.byId.get(e.from).x-graph.byId.get(e.to).x);
      if(dx>0) unit=Math.min(unit,e.cost/dx);
    }
    if(!Number.isFinite(unit)) unit=0;
    const h=id=>heuristic?Math.abs(graph.byId.get(id).x-g.x)*unit:0;
    const open=[{id:start,b:b0,c:0,f:h(start),path:[]}],dist=new Map();
    while(open.length) {
      open.sort((a,b)=>b.f-a.f);const cur=open.pop();
      const key=cur.id+'>'+cur.b;if((dist.get(key)??Infinity)<=cur.c) continue;
      dist.set(key,cur.c);
      if(cur.id===goal) return {path:cur.path,value:cur.c,expanded:dist.size};
      for(const e of graph.out.get(cur.id)) if(e.bins<=cur.b) {
        const c=cur.c+e.cost;
        open.push({id:e.to,b:cur.b-e.bins,c,f:c+h(e.to),path:[...cur.path,e]});
      }
    }
    return {path:[],value:Infinity,expanded:dist.size};
  }
  function greedy(graph,start,goal,energy) {
    const g=graph.byId.get(goal),distance=id=>{
      const p=graph.byId.get(id);return Math.hypot(p.x-g.x,p.y-g.y);
    };
    const path=[];let cur=start,b=budget(energy);
    while(cur!==goal) {
      const choices=graph.out.get(cur).filter(e=>e.bins<=b && distance(e.to)<distance(cur)-1e-9);
      choices.sort((a,b)=>distance(a.to)-distance(b.to)||a.cost-b.cost);
      if(!choices.length) break;
      const e=choices[0];path.push(e);cur=e.to;b-=e.bins;
    }
    return {path,value:cur===goal?path.reduce((v,e)=>v+e.cost,0):Infinity};
  }
  function iconOnly(graph,start,goal,failCost) {
    const values=new Map(graph.icons.map(p=>[p.id,p.id===goal?0:Infinity]));
    const policy=new Map();
    for(let sweep=0;sweep<graph.icons.length*16;sweep++) {
      const previous=new Map(values);let changed=false;
      for(const [id,edges] of graph.out) if(id!==goal) {
        for(const e of edges) {
          const future=previous.get(e.to);if(!Number.isFinite(future)) continue;
          const cost=e.cost+e.p*future+(1-e.p)*failCost;
          if(cost<values.get(id)-1e-9) {values.set(id,cost);policy.set(id,e);changed=true;}
        }
      }
      if(!changed) break;
    }
    const path=[],seen=new Set();let id=start;
    while(policy.has(id)&&!seen.has(id)) {
      seen.add(id);const e=policy.get(id);path.push(e);id=e.to;
    }
    return {path,value:values.get(start)};
  }
  function terminalCosts(graph,goal) {
    // Reverse Dijkstra gives a deterministic cost-to-go for the horizon boundary.
    const costs=new Map(graph.icons.map(p=>[p.id,Infinity])), incoming=new Map(graph.icons.map(p=>[p.id,[]]));
    for(const e of graph.edges.values())incoming.get(e.to).push(e);
    costs.set(goal,0);const pending=[{id:goal,c:0}];
    while(pending.length) {
      pending.sort((a,b)=>b.c-a.c);const item=pending.pop();
      if(item.c!==costs.get(item.id))continue;
      for(const e of incoming.get(item.id)) {
        const cost=item.c+e.cost;
        if(cost<costs.get(e.from)){costs.set(e.from,cost);pending.push({id:e.from,c:cost});}
      }
    }
    return costs;
  }
  function receding(graph,start,goal,energy,horizon,failCost=C.failCost) {
    if(!Number.isSafeInteger(horizon)||horizon<1||horizon>128)throw new Error('Horizon must be 1–128');
    const tail=terminalCosts(graph,goal),memo=new Map();
    function solve(id,b,left){
      if(id===goal)return {value:0,edge:null};
      if(left===0)return {value:tail.get(id),edge:null};
      const key=id+'>'+b+'>'+left;
      if(memo.has(key))return memo.get(key);
      let best={value:Infinity,edge:null};
      for(const e of graph.out.get(id))if(e.bins<=b) {
        const future=solve(e.to,b-e.bins,left-1).value;
        if(!Number.isFinite(future))continue;
        const value=e.cost+e.p*future+(1-e.p)*failCost;
        if(value<best.value-1e-10)best={value,edge:e};
      }
      memo.set(key,best);return best;
    }
    let id=start,b=budget(energy);
    const value=solve(id,b,horizon).value,path=[];
    for(let h=horizon;h>0&&id!==goal;h--){
      const e=solve(id,b,h).edge;if(!e)break;
      path.push(e);b-=e.bins;id=e.to;
    }
    return {value,path,horizon,expanded:memo.size};
  }
  function plan(graph,start,goal,energy,method='vi',options={}) {
    if(!graph.byId.has(start)||!graph.byId.has(goal)||!Number.isFinite(energy)||energy<0)
      return {path:[],value:Infinity,sweeps:0};
    if(start===goal) return {path:[],value:0,sweeps:0};
    if(method==='astar') return astar(graph,start,goal,energy);
    if(method==='dijkstra')return astar(graph,start,goal,energy,false);
    if(method==='mpc')return receding(graph,start,goal,energy,options.horizon??2,options.failCost??C.failCost);
    if(method==='greedy') return greedy(graph,start,goal,energy);
    if(method==='no-stamina') return iconOnly(graph,start,goal,options.failCost??C.failCost);
    if(!['vi','pi','no-risk','no-stamina'].includes(method)) throw new Error('Unknown planner: '+method);
    return mdp(graph,start,goal,energy,{...options,algorithm:method,certainty:method==='no-risk'});
  }
  return {Graph,plan,budget,edgeKey,validate,LandingHistory};
});

