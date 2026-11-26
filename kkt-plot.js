// Plot the reduced objective at a fixed geometry. Axis limits stay fixed while the
// available stamina changes so motion of the active bound can be read directly.
(function(root) {
  'use strict';
  const P = root.HopPhysics, U = root.HopControl;
  const source = {x:0,y:4};
  function draw(ctx, rect, {dx,dy,available,timeWeight}) {
    const target = {x:dx,y:4+dy};
    const q = U.constrainedShot(source,target,{available,timeWeight});
    const loose = U.constrainedShot(source,target,{available:P.C.capacity,timeWeight});
    const B = dx*dx+dy*dy;
    const cost = s => .5*(B/s+P.C.g*dy+P.C.g**2*s/4)+timeWeight*s;
    const free = Math.sqrt(B/(P.C.g**2/4+2*timeWeight));
    const sMin = Math.max(.02,.38*free);
    const sMax = Math.max(1.8*free,1.04*(loose?.certificate.high||free));
    const minCost = Math.max(0,.89*cost(free));
    const maxCost = 1.05*Math.max(cost(sMin),cost(sMax));
    ctx.save();
    ctx.translate(rect.x,rect.y);
    ctx.scale(rect.width/1050,rect.height/565);
    ctx.fillStyle = '#fffef8';
    ctx.fillRect(0,0,1050,565);
    const left=86,right=1018,top=91,bottom=461;
    const X=s=>left+(s-sMin)/(sMax-sMin)*(right-left);
    const Y=f=>bottom-(f-minCost)/(maxCost-minCost)*(bottom-top);
    function write(value,x,y,size,color='#244542',align='left') {
      ctx.textAlign=align; ctx.fillStyle=color; ctx.font=size+'px Segoe UI, Arial'; ctx.fillText(value,x,y);
    }
    function marker(x,y,r,color,outline=false) {
      ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);
      if(outline){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();}
      else {ctx.fillStyle=color;ctx.fill();}
    }
    write('Objective ½J² + λs',left,42,25);
    marker(402,34,8,'#b16b31',true); write('Free optimum',418,42,22);
    marker(619,34,7,'#176859'); write('Optimum',635,42,22);
    ctx.fillStyle='#d7e8d9';ctx.fillRect(794,24,23,19);write('Feasible',829,42,22);
    if(q) {
      const a=Math.max(left,X(q.certificate.low)),b=Math.min(right,X(q.certificate.high));
      ctx.fillStyle='#dcebdc';ctx.fillRect(a,top,Math.max(0,b-a),bottom-top);
    }
    for(let i=0;i<=4;i++) {
      const value=minCost+(maxCost-minCost)*i/4,y=Y(value);
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.strokeStyle='#cfdacf';ctx.lineWidth=1.3;ctx.stroke();
      write(value.toFixed(0),left-11,y+7,21,'#48625b','right');
    }
    for(let i=0;i<=5;i++) {
      const s=sMin+(sMax-sMin)*i/5;
      write(s.toFixed(2),X(s),bottom+30,21,'#48625b','center');
    }
    ctx.beginPath();
    for(let i=0;i<=240;i++){
      const s=sMin+(sMax-sMin)*i/240;
      if(i===0)ctx.moveTo(X(s),Y(cost(s)));else ctx.lineTo(X(s),Y(cost(s)));
    }
    ctx.strokeStyle='#3a6279';ctx.lineWidth=4;ctx.stroke();
    marker(X(free),Y(cost(free)),11,'#b16b31',true);
    if(q)marker(X(q.certificate.s),Y(q.objective),7,'#176859');
    write('Squared flight time s = T² (s²)',(left+right)/2,545,24,'#244542','center');
    ctx.restore();
    return q;
  }
  root.HopKktPlot={draw};
})(globalThis);
