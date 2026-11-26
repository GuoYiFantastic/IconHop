(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./physics'),require('./control'),require('./scenes'));
  else root.HopTracking=factory(root.HopPhysics,root.HopControl,root.HopScenes);
})(globalThis,function(P,U,S){
  'use strict';
  function gaussian(rng) {
    const mag=Math.sqrt(-2*Math.log(Math.max(1e-12,rng()))),angle=2*Math.PI*rng();
    return [mag*Math.cos(angle),mag*Math.sin(angle)];
  }
  // Independent two-icon transfer sequences. The plant resets the pet at the named
  // takeoff after each trial so every controller receives the same set of tasks.
  function shuttle(seed,{method='kalman',rho=.90,noiseSD=.10,modelRho=rho,assumedNoiseSD=noiseSD,gustScale=1.5,jumps=18,regularization=.04}={}) {
    if(![rho,noiseSD,modelRho,assumedNoiseSD,gustScale,regularization].every(Number.isFinite)||
       rho<0||rho>1||modelRho<0||modelRho>1||noiseSD<=0||assumedNoiseSD<=0||gustScale<=0||regularization<0||
       !Number.isSafeInteger(jumps)||jumps<1||!['open','last','kalman','oracle'].includes(method))
      throw new Error('Invalid tracking condition');
    const rng=P.random(P.hash('tracking-geometry',seed)),rngWind=P.random(P.hash('tracking-gust',seed));
    const a=S.icon('a',3,2,0.75+.65*rng(),'A'),b=S.icon('b',6.5+1.6*rng(),1.75+.6*rng(),.75+.65*rng(),'B');
    const sigmas=[P.C.windX*gustScale,P.C.windY*gustScale],filters=sigmas.map(s=>new U.WindFilter(s*s));
    let actual=gaussian(rngWind).map((x,j)=>x*sigmas[j]),last=[0,0];
    const records=[];
    for(let k=0;k<jumps;k++) {
      if(k) {
        const fresh=gaussian(rngWind);
        actual=actual.map((v,j)=>rho*v+Math.sqrt(1-rho*rho)*sigmas[j]*fresh[j]);
        for(let j=0;j<2;j++) filters[j].predict(modelRho,(1-modelRho*modelRho)*sigmas[j]*sigmas[j]);
      }
      const from=k%2?b:a,to=k%2?a:b,base=U.constrainedShot(from,to,{timeWeight:2});
      if(!base)throw new Error('Shuttle generator produced an infeasible nominal transfer');
      const predicted=method==='open'?[0,0]:method==='last'?last.map(x=>modelRho*x):method==='oracle'?[...actual]:filters.map(f=>f.mean);
      const priorVariance=filters.map(f=>f.variance);
      const q=method==='open'?{...base,saturated:false}:U.launchFeedback(base,...predicted,regularization);
      const f=P.trajectory(from,q,{ax:actual[0],ay:actual[1]}),nominal=P.trajectory(from,q);
      const hit=P.contact(f,[from,to]),observed=[];
      // Samples stop at true physical contact, and reach the controller only after takeoff.
      for(let n=1;n*.12<hit.time-1e-10;n++) {
        const t=n*.12,r=P.random(P.hash('tracking-observation',seed,k,n)),z=gaussian(r);
        const state=P.at(f,t),expected=P.at(nominal,t);
        const residual=[state.x-expected.x+noiseSD*z[0],state.y-expected.y+noiseSD*z[1]];
        for(let j=0;j<2;j++)filters[j].observe(residual[j],t,assumedNoiseSD*assumedNoiseSD);
        const H=.5*t*t;last=residual.map(x=>x/H);
        observed.push({t,x:state.x+noiseSD*z[0],y:state.y+noiseSD*z[1]});
      }
      records.push({jump:k+1,from:from.id,to:to.id,reached:+(hit.safe&&hit.icon===to.id),actual:[...actual],
        predicted,priorVariance,posterior:filters.map(v=>v.mean),variance:filters.map(v=>v.variance),
        J:q.J,theta:q.theta,T:base.T,flightTime:hit.time,saturated:+q.saturated,observed,
        energy:P.C.kappa*q.J,impact:hit.speed,miss:Math.abs(hit.x-to.x),f,hit});
    }
    return {a,b,records};
  }
  return {shuttle};
});

