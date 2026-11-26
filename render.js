/* Canvas draws contacts at the pet's foot. Physics uses metres with +y upward. */
(function(root) {
  'use strict';
  const P=root.HopPhysics;
  const images={};
  const files={home:'desktop-home.png',folder:'desktop-folder.png',note:'desktop-note.png',
    photo:'desktop-photo.png',music:'desktop-music.png',edge:'desktop-edge.png',bin:'desktop-bin.png'};
  const ready=Promise.all(Object.entries(files).map(([key,file])=>{
    const image=new Image();images[key]=image;image.src='assets/'+file;return image.decode();
  }));
  function view(canvas,desktopLayout=canvas.dataset.layout==='desktop') {
    const w=canvas.clientWidth,h=canvas.clientHeight;
    const taskbar=w<650?32:42,bottom=h-taskbar;
    const scale=desktopLayout?(bottom-12)/(HopScenes.desktopGrid.top+2*P.C.bodyRadius+.32):Math.min(w/19.55,(bottom-12)/9.1);
    const left=desktopLayout?0:(w-scale*19.55)/2;
    return {w,h,scale,taskbar,bottom,point:(x,y)=>({x:left+x*scale,y:bottom-y*scale}),
      world:(x,y)=>({x:(x-left)/scale,y:(bottom-y)/scale})};
  }
  function line(ctx,points,color,width=2,dash=[]) {
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.lineCap='round';
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.restore();
  }
  function arc(ctx,v,from,q,color,width,dash,walls) {
    const f=P.trajectory(from,q),pts=[];
    if(walls)f.walls=walls;
    for(let i=0;i<=36;i++) {const p=P.at(f,q.T*i/36);pts.push(v.point(p.x,p.y));}
    line(ctx,pts,color,width,dash);
  }
  function box(ctx,x,y,w,h,r,fill) {
    ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
  }
  function glyph(ctx,type,x,y,size) {
    if(type==='mail'){
      const g=ctx.createLinearGradient(x,y,x+size,y+size);
      g.addColorStop(0,'#1598ea');g.addColorStop(1,'#07518e');
      box(ctx,x+size*.03,y+size*.16,size*.94,size*.68,2,g);
      line(ctx,[{x:x+size*.06,y:y+size*.21},{x:x+size*.5,y:y+size*.55},{x:x+size*.94,y:y+size*.21}],'#e8f6ff',Math.max(1,size*.045));
      return;
    }
    const im=images[type]||images.folder;
    if(im.complete&&im.naturalWidth)ctx.drawImage(im,x,y,size,size);
  }
  function iconBox(v,p){
    const pt=v.point(p.x,p.y),size=Math.min(43,Math.max(17,.66*v.scale));
    const width=Math.max(size+6,Math.min(94,1.68*v.scale));
    const fontSize=Math.min(13,Math.max(9,.26*v.scale));
    return {x:pt.x-width/2,y:pt.y-3,width,height:size+fontSize+8,size,fontSize,cx:pt.x};
  }
  function icon(ctx,v,p,selected) {
    const b=iconBox(v,p);
    ctx.save();
    let label=p.name||p.id;
    ctx.font=b.fontSize+'px "Segoe UI", Arial';
    ctx.textAlign='center';
    if(selected){
      box(ctx,b.x,b.y,b.width,b.height,3,'rgba(130,193,250,.38)');
      ctx.strokeStyle='rgba(237,248,255,.75)';ctx.lineWidth=1;ctx.stroke();
    }
    glyph(ctx,p.kind,b.cx-b.size/2,b.y+3,b.size);
    if(ctx.measureText(label).width>b.width-2){
      while(label.length&&ctx.measureText(label+'…').width>b.width-2)label=label.slice(0,-1);
      label+='…';
    }
    const labelY=b.y+3+b.size+b.fontSize;
    ctx.shadowColor='#091f34';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
    ctx.strokeStyle='rgba(10,28,49,.55)';ctx.lineWidth=2.3;ctx.strokeText(label,b.cx,labelY);
    ctx.fillStyle='white';ctx.fillText(label,b.cx,labelY);ctx.restore();
  }
  function desktop(ctx,v) {
    const gradient=ctx.createLinearGradient(0,0,v.w,v.bottom);
    gradient.addColorStop(0,'#192341');gradient.addColorStop(.53,'#35476e');gradient.addColorStop(1,'#2d606e');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,v.w,v.h);
    ctx.fillStyle='rgba(233,245,252,.22)';
    for(let y=21;y<v.bottom;y+=28)for(let x=21;x<v.w;x+=28){
      ctx.beginPath();ctx.arc(x,y,1.1,0,2*Math.PI);ctx.fill();
    }
  }
  function targetMarker(ctx,x,y,above){
    ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.fillStyle='#0958a8';
    const s=above?-1:1;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-6,y+s*9);ctx.lineTo(x+6,y+s*9);ctx.closePath();ctx.stroke();ctx.fill();
    ctx.restore();
  }
  function taskbar(ctx,v) {
    const y=v.h-v.taskbar,h=v.taskbar;
    ctx.save();
    ctx.fillStyle='#182a46';ctx.fillRect(0,y,v.w,h);
    ctx.fillStyle='#86d8c3';ctx.fillRect(0,y,v.w,2);
    ctx.fillStyle='#d7eee9';ctx.font='600 11px system-ui';
    ctx.textBaseline='middle';ctx.fillText('TASKBAR',12,y+h/2);
    ctx.fillStyle='rgba(215,238,233,.20)';
    for(let x=95;x<v.w-8;x+=26)ctx.fillRect(x,y+h/2,8,1);
    ctx.restore();
  }
  function impactShape(run,t){
    const speed=run.lastHit?.normalSpeed??run.lastHit?.speed??0;
    const strength=Math.min(.61,speed*.075);
    return 1+strength*Math.exp(-8.8*t)*(.31*Math.cos(29*t)-1.43*Math.sin(29*t));
  }
  function pose(run,time){
    const p=run.position(),prep=run.preparation;
    let tall=1,lean=0,look=0,blink=Math.pow(Math.max(0,Math.cos(time*2.11+.8)),95);
    if(prep){
      const u=prep.elapsed/prep.duration,dir=Math.cos(prep.edge.q.theta);
      const crouch=u<.76?Math.sin(u/.76*Math.PI/2)**2:Math.cos((u-.76)/.24*Math.PI/2)**2;
      tall=1-.39*crouch;lean=-.14*dir*crouch;look=dir*.30;blink=.64*crouch;
    }else if(run.flight){
      const f=run.flight,age=f.elapsed,launch=f.release?0:Math.sin(Math.min(1,age/.14)*Math.PI/2)*Math.exp(-Math.max(0,age-.14)*7);
      const speed=Math.min(1,Math.abs(p.vy)/7),airBlend=Math.min(1,age/.14);
      tall=1+.32*launch+airBlend*(.18*speed-.085*(1-speed));
      if(f.rebound){
        const u=Math.min(1,age/.10),blend=u*u*(3-2*u);
        const atRelease=impactShape(run,f.contactDuration??.09);
        tall=atRelease+(tall-atRelease)*blend;
      }
      lean=(.19+.14*speed)*Math.tanh(p.vx/3)*Math.tanh(p.vy/3)*airBlend;
      look=.36*Math.tanh(p.vx/2);blink=0;
    }else if(run.dock?.walk){
      const stride=Math.sin((p.x-run.dock.x)*9),speed=Math.tanh(p.vx/2);
      tall=1+.065*stride*speed;lean=.20*speed;look=.4*speed;
    }else if(run.contactAge<.55){
      // A damped shape response to impact. Its lowest point stays on the support.
      const t=run.contactAge;
      tall=impactShape(run,t);
      blink=Math.max(0,Math.sin(Math.min(1,t/.13)*Math.PI))*.9;
    }else{
      tall=1+.026*Math.sin(4.7*time)+.012*Math.sin(8.4*time);
      look=.15*Math.sin(time*1.8);
    }
    return {tall,wide:1/Math.sqrt(tall),lean,look,blink};
  }
  function pet(ctx,v,run,time){
    const pos=run.position(),p=v.point(pos.x,pos.y);
    if(!Number.isFinite(p.x))return;
    const r=run.desktop?P.C.bodyRadius*v.scale:Math.max(12,Math.min(30,.49*v.scale)),s=pose(run,time);
    // The same foot coordinate is used for contact, shadow and body deformation.
    let supportY=0;
    for(const icon of run.icons){
      if(Math.abs(pos.x-icon.x)<=icon.w/2&&icon.y<=pos.y+1e-8)supportY=Math.max(supportY,icon.y);
    }
    const clearance=Math.max(0,pos.y-supportY),shadow=v.point(pos.x,supportY);
    ctx.save();ctx.fillStyle='rgba(15,26,48,'+(.32/(1+.7*clearance))+')';
    ctx.beginPath();ctx.ellipse(shadow.x,shadow.y+1,r*(.92+.12*clearance),Math.max(1.2,r*.11),0,0,2*Math.PI);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(p.x,p.y);ctx.transform(s.wide,0,s.lean,s.tall,0,0);ctx.translate(0,-r);
    const g=ctx.createRadialGradient(-r*.38,-r*.5,r*.04,0,0,r*1.2);
    g.addColorStop(0,'#fff5b1');g.addColorStop(.45,'#ffd17a');g.addColorStop(.82,'#ffac54');g.addColorStop(1,'#db733b');
    ctx.fillStyle=g;ctx.strokeStyle='#6b462c';ctx.lineWidth=Math.max(1,r*.066);ctx.beginPath();ctx.ellipse(0,0,r,r,0,0,2*Math.PI);ctx.fill();ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.70)';ctx.beginPath();ctx.ellipse(-r*.44,-r*.57,r*.21,r*.072,-.6,0,2*Math.PI);ctx.fill();
    for(const side of [-1,1]){
      const x=r*(side*.34+s.look*.26);
      ctx.fillStyle='#f18a64';ctx.beginPath();ctx.ellipse(r*side*.57,r*.30,r*.155,r*.078,-side*.16,0,2*Math.PI);ctx.fill();
      ctx.fillStyle='#402d31';ctx.beginPath();ctx.ellipse(x,r*.02,r*.09,r*(.165-.13*s.blink),0,0,2*Math.PI);ctx.fill();
      if(s.blink<.5){ctx.fillStyle='#fff5e6';ctx.beginPath();ctx.arc(x-r*.022,-r*.045,r*.032,0,2*Math.PI);ctx.fill();}
    }
    ctx.strokeStyle='#693e32';ctx.lineWidth=Math.max(1.1,r*.07);ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-r*.15,r*.24);ctx.quadraticCurveTo(0,r*(run.flight?.release ? .14 : .44),r*.15,r*.24);ctx.stroke();ctx.restore();
  }
  function draw(canvas,run,route,opts={}) {
    canvas.dataset.layout=run.desktop?'desktop':'lab';
    const v=view(canvas),dpr=Math.min(root.devicePixelRatio||1,2);
    const bw=Math.round(v.w*dpr),bh=Math.round(v.h*dpr);
    if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,v.w,v.h);desktop(ctx,v);
    if(opts.graph&&!run.desktop) for(const e of run.graph.edges.values()) {
      const from=run.graph.byId.get(e.from);arc(ctx,v,from,e.q,'rgba(29,76,79,.27)',1,[3,4]);
    }
    if(!opts.drag&&opts.guides!==false) for(const e of (route?.path||[])) {
      const from=run.surface(e.from);
      if(!from)continue;
      if(e.kind==='walk')line(ctx,[v.point(e.x,from.y),v.point(e.target,from.y)],'#e9ffff',2,[2,5]);
      else{
        if(e.runup)line(ctx,[v.point(e.runup.x,from.y),v.point(e.launchX,from.y)],'#e9ffff',2,[2,5]);
        arc(ctx,v,{...from,x:e.launchX??from.x,vx:e.runup?.vx||0},e.q,'rgba(233,255,255,.92)',2,[4,6],e.walls);
      }
    }
    if(opts.guides!==false&&opts.trail?.length>1) line(ctx,opts.trail.map(p=>v.point(p.x,p.y)),'#fff0bd',3);
    for(const p of run.icons) icon(ctx,v,p,opts.selected===p.id);
    if(opts.drag){
      const original=run.graph.byId.get(opts.drag.id);
      if(original){ctx.save();ctx.globalAlpha=.72;icon(ctx,v,{...original,...opts.drag.point},true);ctx.restore();}
    }
    taskbar(ctx,v);
    if(run.mode!=='Failed'||run.stoppedAt||run.lastHit) pet(ctx,v,run,opts.time||0);
    if(run.pinnedGoalName!==null){
      const goal=run.surface(run.goal);
      if(goal){
        const top=v.point(run.goalPoint(),goal.y);
        if(goal.id===HopGround.BAR){
          ctx.save();ctx.fillStyle='#368bd6';ctx.fillRect(0,v.bottom,v.w,2);
          const x=P.clamp(top.x,7,v.w-7);targetMarker(ctx,x,v.bottom+2,false);
          const labelX=P.clamp(x+8,3,v.w-48);
          box(ctx,labelX,v.bottom+3,44,13,3,'#164d82');
          ctx.fillStyle='white';ctx.font='600 10px "Segoe UI",Arial';ctx.textAlign='center';
          ctx.fillText('Taskbar',labelX+22,v.bottom+13);ctx.restore();
        }else{
          const b=iconBox(v,goal);
          ctx.save();ctx.strokeStyle='#164e81';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(b.x,b.y,b.width,b.height,4);ctx.stroke();
          ctx.strokeStyle='#b9e5ff';ctx.lineWidth=1.4;ctx.stroke();ctx.restore();
          targetMarker(ctx,top.x,top.y,true);
        }
      }
    }
    if(run.desktop&&!opts.graph)return;
    const m=v.scale;
    line(ctx,[{x:14,y:v.bottom-14},{x:14+m,y:v.bottom-14}],'#fff6dc',2);
    ctx.fillStyle='#fff8e6';ctx.textAlign='left';ctx.font='600 10px Segoe UI, Arial';ctx.fillText('1 m',18+m,v.bottom-11);
  }
  root.HopRender={draw,view,ready,pose,iconBox};
})(globalThis);

