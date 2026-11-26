/* Course extensions. The scalar constrained shot is convex after s = T².
   The observer and feedback law operate on separate, repeated-jump experiments. */
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./physics'));
  else root.HopControl=factory(root.HopPhysics);
})(globalThis,function(P){
  'use strict';
  const {C}=P;
  function constrainedShot(a,b,{ax=0,ay=0,timeWeight=12,available=C.capacity}={}) {
    if(timeWeight<0||!Number.isFinite(timeWeight)||!Number.isFinite(ax)||!Number.isFinite(ay)||!Number.isFinite(available))return null;
    const gravity=C.g-ay,dx=b.x-a.x,dy=b.y-a.y;
    if(gravity<=0||available<=0)return null;
    const A=(ax*ax+gravity*gravity)/4,B=dx*dx+dy*dy,D=ax*dx-gravity*dy;
    if(B<1e-12)return null;
    let low=C.minTime*C.minTime,high=C.maxTime*C.maxTime,lower='minimum time',upper='maximum time';
    function lowerBound(value,name){if(value>low){low=value;lower=name;}}
    function upperBound(value,name){if(value<high){high=value;upper=name;}}
    function speedInterval(k,name){
      const disc=k*k-4*A*B;if(k<=0||disc< -1e-10)return false;
      const root=Math.sqrt(Math.max(0,disc));
      lowerBound(2*B/(k+root),name);upperBound((k+root)/(2*A),name);
      return low<=high+1e-11;
    }
    const impulseCap=Math.min(C.maxJ,available/C.kappa);
    if(!speedInterval((impulseCap/C.mass)**2+D,impulseCap<C.maxJ?'stamina limit':'impulse limit')||
       !speedInterval(C.safeSpeed**2-D,'impact limit'))return null;
    lowerBound(-2*dy/gravity,'upward launch');
    const descentDisc=C.minDescent*C.minDescent+2*gravity*dy;
    if(descentDisc>=0){
      const t=(C.minDescent+Math.sqrt(descentDisc))/gravity;
      const small=(C.minDescent-Math.sqrt(descentDisc))/gravity;
      // For a nonnegative vertical launch, admissible T lies on the large-root branch.
      if(small<=0||Math.sqrt(low)>=small-1e-12)lowerBound(t*t,'descending contact');
      else return null;
    }
    if(low>high+1e-10)return null;
    const mass2=C.mass*C.mass,free=Math.sqrt(.5*mass2*B/(.5*mass2*A+timeWeight));
    const s=P.clamp(free,low,high),T=Math.sqrt(s),vx=dx/T-.5*ax*T,vy=dy/T+.5*gravity*T;
    const J=C.mass*Math.hypot(vx,vy),theta=Math.atan2(Math.max(0,vy),vx);
    const speed=Math.hypot(vx+ax*T,vy-gravity*T);
    if(J>impulseCap+1e-7||speed>C.safeSpeed+1e-7||vy< -1e-7)return null;
    const derivative=.5*mass2*(A-B/(s*s))+timeWeight;
    const muLow=Math.abs(s-low)<1e-8?Math.max(0,derivative):0;
    const muHigh=Math.abs(s-high)<1e-8?Math.max(0,-derivative):0;
    return {J,theta,T,error:0,speed,energy:C.kappa*J,objective:.5*J*J+timeWeight*s,
      certificate:{A,B,D,s,low,high,free,lower,upper,muLow,muHigh,
        active:s===low?lower:s===high?upper:'interior',
        stationarity:Math.abs(derivative-muLow+muHigh),
        complementarity:Math.max(Math.abs(muLow*(s-low)),Math.abs(muHigh*(high-s)))}};
  }
  // Scalar Gaussian wind state for either axis. Position residual H*w has H=t²/2.
  class WindFilter {
    constructor(variance){this.mean=0;this.variance=variance;}
    predict(rho,processVariance){
      this.mean*=rho;this.variance=rho*rho*this.variance+processVariance;
    }
    observe(residual,t,measurementVariance){
      if(t<=0||measurementVariance<=0)return;
      const H=.5*t*t,R=measurementVariance,innovation=residual-H*this.mean;
      const gain=this.variance*H/(H*H*this.variance+R);
      this.mean+=gain*innovation;
      this.variance=(1-gain*H)**2*this.variance+gain*gain*R;
    }
  }
  // One-stage finite-horizon LQR for launch-velocity correction. Terminal position
  // error e = d + T*deltaV. Q=I and R=regularization*I. The plant enforces actuator limits.
  function launchFeedback(base,wx,wy,regularization=.04) {
    const T=base.T,K=T/(T*T+regularization),dx=.5*T*T*wx,dy=.5*T*T*wy;
    let vx=(base.J/C.mass)*Math.cos(base.theta)-K*dx;
    const requestedVy=(base.J/C.mass)*Math.sin(base.theta)-K*dy;
    let vy=Math.max(0,requestedVy);
    const unbounded=C.mass*Math.hypot(vx,vy),ratio=Math.min(1,C.maxJ/Math.max(1e-12,unbounded));
    vx*=ratio;vy*=ratio;
    return {J:C.mass*Math.hypot(vx,vy),theta:Math.atan2(vy,vx),T,saturated:ratio<1||requestedVy<0,
      gain:K,deltaX:-K*dx,deltaY:-K*dy};
  }
  return {constrainedShot,WindFilter,launchFeedback};
});

