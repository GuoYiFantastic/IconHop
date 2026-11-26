// Chance-constrained routes on the same certified graph as the risk-aware MDP.
// An action either lands at its sole successor or fails permanently.
(function(root,factory) {
  const api=typeof module!=='undefined'&&module.exports?factory(require('./planner'),require('./engine')):factory(root.HopPlan,root.HopEngine);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.HopFrontier=api;
})(globalThis,function(H,E) {
  'use strict';
  const tolerance=1e-12;

  function solve(graphs,start,goal,energy) {
    if(!graphs.length||!graphs[0].byId.has(start)||!graphs[0].byId.has(goal)||!Number.isFinite(energy)||energy<0)
      throw new Error('Invalid route endpoints or stamina');
    const outgoing=new Map(graphs[0].icons.map(icon=>[icon.id,[]]));
    for(const graph of graphs) {
      if(graph.byId.size!==outgoing.size||graph.icons.some(i=>{
        const ref=graphs[0].byId.get(i.id);
        return !ref||i.x!==ref.x||i.y!==ref.y||i.w!==ref.w;
      }))throw new Error('The controllers must use the same platform geometry');
      for(const edge of graph.edges.values()) {
        if(!Number.isSafeInteger(edge.bins)||edge.bins<1)throw new Error('Each jump must consume at least one stamina bin');
        outgoing.get(edge.from).push(edge);
      }
    }
    const memo=new Map(),terminal=[{reach:1,energy:0,edge:null,next:null}];
    let candidates=0,retained=0;
    function labels(icon,b) {
      if(icon===goal)return terminal;
      const key=icon+'>'+b;
      if(memo.has(key))return memo.get(key);
      const possible=[];
      for(const e of outgoing.get(icon)) {
        if(e.bins>b)continue;
        for(const tail of labels(e.to,b-e.bins)) {
          possible.push({reach:e.p*tail.reach,energy:e.q.energy+e.p*tail.energy,edge:e,next:tail});
        }
      }
      candidates+=possible.length;
      // Higher reach and lower expected energy are both preserved by any
      // predecessor with a nonnegative transition probability.
      possible.sort((a,b)=>b.reach-a.reach||a.energy-b.energy);
      const keep=[];
      let bestEnergy=Infinity;
      for(const label of possible) {
        if(label.energy<bestEnergy-tolerance) {
          keep.push(label);bestEnergy=label.energy;
        }
      }
      retained+=keep.length;memo.set(key,keep);return keep;
    }
    const frontier=labels(start,H.budget(energy));
    return {frontier,states:memo.size,candidates,retained};
  }

  function choose(solution,minimumReach) {
    if(!Number.isFinite(minimumReach)||minimumReach<0||minimumReach>1)throw new Error('Reach target must be between zero and one');
    const frontier=solution.frontier;
    if(!frontier.length)return {path:[],reach:0,energy:0,meetsTarget:false,hasRoute:false};
    let pick=frontier[0];
    for(const route of frontier) {
      if(route.reach+tolerance<minimumReach)break;
      pick=route;
    }
    const path=[];
    for(let node=pick;node.edge;node=node.next)path.push(node.edge);
    return {path,reach:pick.reach,energy:pick.energy,meetsTarget:pick.reach+tolerance>=minimumReach,hasRoute:true};
  }

  function execute(scene,graph,path,seed) {
    const run=new E.Run(scene,{graph,seed});
    for(const edge of path){
      if(run.mode!=='Landed'||run.current===run.goal)break;
      if(run.current!==edge.from||!run.fire(edge))throw new Error('Invalid stamina-feasible route');
      run.advance(10);
    }
    return {reached:Number(run.current===run.goal&&run.mode==='Landed'),energy:run.spent,jumps:run.jumps};
  }
  return {solve,choose,execute};
});
