(function(root,factory) {
  if(typeof module!=='undefined' && module.exports) module.exports=factory(require('./physics'));
  else root.HopScenes=factory(root.HopPhysics);
})(globalThis,function(P) {
  'use strict';
  function icon(id,x,y,w,name,kind='folder') {return {id,x,y,w,name,kind};}
  const desktopGrid={left:.86,top:8.72,across:1.78,down:1.50};
  function desktopIcon(id,col,row,name,kind) {
    const g=desktopGrid;
    return icon(id,g.left+col*g.across,g.top-row*g.down,.66,name,kind);
  }
  const scenes=[
    {id:'play',name:'Desktop playground',desktop:true,brief:'Click a spot on the taskbar to go there. Right-click a spot on an icon to jump or walk to it.',
      noise:0,energy:36,start:'home',goal:'mail',patrol:['mail','photos','home'],
      icons:[desktopIcon('bin',0,0,'Recycle Bin','bin'),desktopIcon('pc',0,1,'This PC','home'),
        desktopIcon('edge',0,2,'Web','edge'),desktopIcon('home',0,3,'Projects','folder'),
        desktopIcon('music',0,4,'Music','music'),desktopIcon('notes',0,5,'Notes.txt','note'),
        desktopIcon('work',1,0,'Work','folder'),desktopIcon('downloads',1,1,'Downloads','folder'),
        desktopIcon('mail',1,2,'Mail','mail'),desktopIcon('photos',1,3,'Photos','photo')]},
    {id:'work',name:'Across the desktop to Work',desktop:true,brief:'Right-click Work and choose Jump here. Enable Show planned route to see the takeoff and landing points.',noise:0,energy:36,start:'home',goal:'work',
      icons:[desktopIcon('bin',6,2,'Recycle Bin','bin'),desktopIcon('pc',4,1,'This PC','home'),
        desktopIcon('edge',5,4,'Web','edge'),desktopIcon('home',6,5,'Projects','folder'),
        desktopIcon('music',5,3,'Music','music'),desktopIcon('notes',0,5,'Notes.txt','note'),
        desktopIcon('work',0,0,'Work','folder'),desktopIcon('downloads',2,1,'Downloads','folder'),
        desktopIcon('mail',6,0,'Mail','mail'),desktopIcon('photos',0,2,'Photos','photo')]},
    {id:'runup',name:'Photos to Work',desktop:true,brief:'Choose Work and follow the short jumps and the walk along the taskbar.',noise:0,energy:36,start:'photos',startX:2.59,goal:'work',
      icons:[desktopIcon('bin',0,0,'Recycle Bin','bin'),desktopIcon('pc',0,1,'This PC','home'),
        desktopIcon('edge',0,2,'Web','edge'),desktopIcon('home',0,3,'Projects','folder'),
        desktopIcon('music',2,4,'Music','music'),desktopIcon('notes',8,5,'Notes.txt','note'),
        desktopIcon('work',8,2,'Work','folder'),desktopIcon('downloads',1,1,'Downloads','folder'),
        desktopIcon('mail',6,3,'Mail','mail'),desktopIcon('photos',1,3,'Photos','photo')]},
    {id:'stack',name:'Recycle Bin to This PC',desktop:true,runOnEntry:true,brief:'Follow the rebound off the side of the desktop. Reset scene replays the trip.',noise:0,energy:36,start:'bin',goal:'pc',
      icons:[desktopIcon('bin',0,0,'Recycle Bin','bin'),desktopIcon('pc',0,1,'This PC','home')]},
    {id:'bridge',name:'Add a stepping stone',desktop:true,
      brief:'Right-click Archive and choose Jump here. Then drag Step between the taskbar and Archive to complete the route.',
      noise:0,energy:36,start:'@taskbar',startX:11.54,goal:'archive',
      icons:[icon('archive',11.54,4.22,.82,'Archive'),icon('step',6.20,7.22,.82,'Step','note')]},
    {id:'drop',name:'Free fall',brief:'Remove the upper support to release the pet from rest. A lower folder catches it.',noise:0,energy:36,start:'shelf',goal:'catch',
      icons:[icon('shelf',9,7,2,'Shelf','folder'),icon('catch',9,2,2.3,'Archive','folder')]},
    {id:'first',name:'First jump',brief:'A single target on a quiet desktop.',noise:0,energy:36,start:'home',goal:'mail',
      icons:[icon('home',5,2.5,2.2,'Home','home'),icon('mail',10,3.1,2.3,'Mail','mail')]},
    {id:'route',name:'Across the desktop',brief:'The archive takes several jumps to reach.',noise:0,energy:36,start:'home',goal:'archive',
      icons:[icon('home',1.8,2,2,'Home','home'),icon('notes',5.7,3.1,2,'Notes','note'),
        icon('photos',9.5,3.8,2.1,'Photos','photo'),icon('music',13.7,3.6,2,'Music','music'),
        icon('archive',17.3,4.2,1.9,'Archive','folder')]},
    {id:'wind',name:'Windy shortcuts',brief:'Compare a long final jump with a shorter hop onto Tools.',noise:1,energy:36,start:'home',goal:'archive',
      icons:[icon('home',2,2.0,2.2,'Home','home'),icon('wide',5.8,3.0,2.8,'Photos','photo'),
        icon('pin',8.5,1.9,0.62,'Pin','note'),icon('mail',10.3,3.7,2.4,'Mail','mail'),
        icon('tools',14.1,3.3,2.65,'Tools','folder'),icon('archive',17.1,3.8,2.65,'Archive','folder')]},
    {id:'tower',name:'The floating archive',brief:'Add platforms between Home and the high archive.',noise:0,energy:36,start:'home',goal:'archive',
      icons:[icon('home',2.3,1.4,2.1,'Home','home'),icon('archive',15.7,7.4,2.1,'Archive','folder')]},
    {id:'rest',name:'The last charge',brief:'Start with low stamina. Rest, wake, and choose a target.',noise:0,energy:2,start:'home',goal:'photos',
      icons:[icon('home',4,2.0,2.4,'Home','home'),icon('mail',8.4,2.7,2.4,'Mail','mail'),icon('photos',13.0,3.2,2.4,'Photos','photo')]}
  ];
  const highBin=get('runup');
  highBin.icons.find(p=>p.id==='bin').x=highBin.icons.find(p=>p.id==='mail').x;
  scenes.push({...highBin,id:'high-bin',name:'Recycle Bin to Downloads',start:'bin',startX:11.64,
    goal:'downloads',runOnEntry:true,brief:'Follow the pet to Downloads. Open Landing energy loss to inspect each contact.'});
  function get(id) {
    const s=scenes.find(x=>x.id===id);
    if(!s) throw new Error('Unknown scene: '+id);
    return {...s,icons:s.icons.map(p=>({...p}))};
  }
  // Independent layout draws with a traversable nominal backbone by construction in most,
  // but not all, cases. All draws stay in the denominator regardless of connectivity.
  function generate(seed,profile='standard') {
    const r=P.random(P.hash('layout-v1',profile,seed)), u=(lo,hi)=>lo+(hi-lo)*r();
    const hard=profile==='stress', sparse=profile==='sparse';
    const n=sparse?4+Math.floor(2*r()):5+Math.floor(3*r());
    const span=u(13,16),base=u(1,2.4);
    const slope=u(-0.25,1.9),tight=r()<0.45,small=r()<0.36;
    const energy=hard?u(12,26):(tight?u(22,29):u(29,36));
    const icons=[];
    for(let i=0;i<n;i++) {
      const s=i/(n-1), x=1.5+span*s+(i>0 && i<n-1?u(-.4,.4):0);
      const y=P.clamp(base+s*slope+((i>0 && i<n-1)?u(-.65,.85):0),0.8,5.8);
      const w=hard?u(.65,1.65):((i===n-1 && small)?u(1.15,1.85):u(1.85,3.0));
      icons.push(icon('i'+i,x,y,w,i===0?'Home':i===n-1?'Archive':'Folder '+i,i===0?'home':'folder'));
    }
    const extra=sparse?0:Math.floor(u(0,hard?5:4));
    for(let j=0;j<extra;j++) {
      icons.push(icon('x'+j,u(2.8,16),u(3.5,6.8),u(.55,2.25),'Note '+(j+1),'note'));
    }
    return {id:'layout-'+seed,icons,start:'i0',goal:'i'+(n-1),energy,noise:1,
      strata:{count:icons.length,targetWidth:icons[n-1].w,span,density:icons.length/span,budget:energy}};
  }
  return {scenes,get,generate,icon,desktopGrid};
});

