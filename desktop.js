/* Direct manipulation of the simulated desktop. World coordinates belong to the physics engine. */
(function(root){
  'use strict';
  function bind({canvas,getRun,commit,jump,cancelTarget,paint}){
    const byId=id=>document.getElementById(id);
    const screen=canvas.parentElement,menu=byId('desktop-menu'),sub=byId('new-menu');
    const editor=byId('rename-icon'),notice=byId('desktop-notice'),grid=HopScenes.desktopGrid;
    const newButton=menu.querySelector('[data-action=new]');
    const clamp=HopPhysics.clamp,render=HopRender;
    let selected=null,drag=null,anchor=null,editing=null,hold=0,noticeTimer=0,trash=[];
    const icons=()=>getRun().icons;
    const find=id=>icons().find(p=>p.id===id);
    const v=()=>render.view(canvas);
    function announce(message){
      notice.textContent=message;notice.hidden=false;clearTimeout(noticeTimer);
      noticeTimer=setTimeout(()=>{notice.hidden=true;},2800);
    }
    function close(){
      menu.hidden=true;sub.hidden=true;
      newButton.setAttribute('aria-expanded','false');
    }
    function itemAt(x,y){
      const cam=v();
      return icons().slice().reverse().find(p=>{
        const b=render.iconBox(cam,p);
        return x>=b.x&&x<=b.x+b.width&&y>=b.y&&y<=b.y+b.height;
      });
    }
    function coords(ev){
      const b=canvas.getBoundingClientRect();
      return {x:ev.clientX-b.left,y:ev.clientY-b.top};
    }
    function select(id){selected=id;paint();}
    function positionMenu(node,x,y){
      node.hidden=false;
      node.style.left=clamp(x,1,screen.clientWidth-node.offsetWidth-1)+'px';
      node.style.top=clamp(y,1,v().bottom-node.offsetHeight-1)+'px';
    }
    function open(x,y){
      const run=getRun(),onBar=y>=v().bottom;
      if(onBar&&!run.desktop)return;
      close();drag=null;const p=onBar?run.surface(HopGround.BAR):itemAt(x,y);
      select(p?.id??null);anchor=v().world(x,y);
      const action=menu.querySelector('[data-action=jump]');
      action.textContent=p&&run.desktop&&run.current===p.id&&run.mode==='Landed'?'Walk here':'Jump here';
      for(const b of menu.children){
        const act=b.dataset.action;
        if(act==='new'||act==='refresh')b.hidden=!!p;
        else if(act==='undo')b.hidden=!!p||!trash.length;
        else if(act==='restore')b.hidden=p?.kind!=='bin'||!trash.length;
        else if(act==='cancel-target')b.hidden=getRun().pinnedGoalName===null||!!(p&&p.id!==getRun().goal);
        else b.hidden=!p||(onBar&&act!=='jump')||(p.kind==='bin'&&act==='delete');
      }
      positionMenu(menu,x,y);menu.querySelector('button:not([hidden])').focus({preventScroll:true});
    }
    function openNew(focus){
      const right=menu.offsetLeft+menu.offsetWidth-2;
      const x=right+menu.offsetWidth<=screen.clientWidth?right:menu.offsetLeft-menu.offsetWidth+2;
      positionMenu(sub,x,menu.offsetTop+newButton.offsetTop-4);
      newButton.setAttribute('aria-expanded','true');
      if(focus)sub.firstElementChild.focus({preventScroll:true});
    }
    function cellNear(point,ignore=null){
      const cam=v(),cells=[];
      const right=cam.world(cam.w,0).x,top=cam.world(0,0).y;
      for(let col=0;grid.left+col*grid.across<=right-.55;col++){
        for(let row=0;row<6;row++){
          const x=grid.left+col*grid.across,y=grid.top-row*grid.down;
          const box=render.iconBox(cam,{x,y});
          if(y>top||box.y<0||box.x<-.5||box.y+box.height>cam.bottom||box.x+box.width>cam.w+.5)continue;
          if(icons().some(p=>{
            if(p.id===ignore)return false;
            const b=render.iconBox(cam,p);
            return Math.min(box.x+box.width,b.x+b.width)-Math.max(box.x,b.x)>1&&
              Math.min(box.y+box.height,b.y+b.height)-Math.max(box.y,b.y)>1;
          }))continue;
          cells.push({x,y});
        }
      }
      cells.sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y));
      return cells[0];
    }
    function finishRename(save){
      const p=find(editing);
      if(editing===null)return;
      const name=editor.value.trim();
      const invalid=!name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||
        icons().some(other=>other.id!==editing&&other.name.toLowerCase()===name.toLowerCase());
      if(save&&invalid){
        announce('Choose a valid, unique file name.');editor.focus();return false;
      }
      editing=null;editor.hidden=true;
      if(save&&p&&name!==p.name)commit(icons().map(i=>i.id===p.id?{...i,name}:i),'Renamed '+p.name);
      return true;
    }
    function rename(){
      const p=find(selected);if(!p)return;
      const b=render.iconBox(v(),p),w=Math.min(146,canvas.clientWidth-4);
      editing=p.id;editor.value=p.name;editor.hidden=false;
      editor.style.width=w+'px';editor.style.left=clamp(b.cx-w/2,2,canvas.clientWidth-w-2)+'px';
      editor.style.top=clamp(b.y+b.size+2,1,v().bottom-editor.offsetHeight)+'px';
      editor.focus({preventScroll:true});
      const ext=p.kind==='note'?p.name.lastIndexOf('.'):-1;
      editor.setSelectionRange(0,ext>0?ext:p.name.length);
    }
    function create(kind){
      const point=cellNear(anchor||{x:grid.left,y:grid.top});
      if(!point){announce('No free space on the desktop.');return;}
      const base=kind==='folder'?'New folder':'New Text Document',ext=kind==='note'?'.txt':'';
      let n=1,name=base+ext;
      const names=new Set(icons().map(p=>p.name.toLowerCase()));
      while(names.has(name.toLowerCase()))name=base+' ('+(++n)+')'+ext;
      let seq=1;while(find('file'+seq)||getRun().goal==='file'+seq||trash.some(p=>p.id==='file'+seq))seq++;
      const item=HopScenes.icon('file'+seq,point.x,point.y,.66,name,kind);
      selected=item.id;commit([...icons(),item],'Created '+name);rename();
    }
    function remove(id){
      const p=find(id);if(!p||p.kind==='bin')return;
      trash.push({...p});selected=null;commit(icons().filter(i=>i.id!==id),'Deleted '+p.name);
    }
    function restore(){
      const p=trash.at(-1);if(!p)return;
      const point=cellNear(p);
      if(!point){announce('No free space on the desktop.');return;}
      if(icons().some(i=>i.name.toLowerCase()===p.name.toLowerCase())){
        announce('Rename the existing item before restoring '+p.name+'.');return;
      }
      trash.pop();selected=p.id;commit([...icons(),{...p,...point}],'Restored '+p.name);
    }
    function act(action){
      if(action==='new'){openNew(true);return;}
      close();canvas.focus({preventScroll:true});
      if(action==='folder'||action==='note')create(action);
      else if(action==='delete')remove(selected);
      else if(action==='restore'||action==='undo')restore();
      else if(action==='refresh')paint();
      else if(action==='rename')rename();
      else if(action==='jump'&&selected)jump(selected,anchor.x);
      else if(action==='cancel-target')cancelTarget();
    }
    for(const n of [menu,sub]){
      n.addEventListener('click',e=>{const b=e.target.closest('button');if(b)act(b.dataset.action);});
      n.addEventListener('keydown',e=>{
        const list=[...n.querySelectorAll('button:not([hidden])')],i=list.indexOf(document.activeElement);
        if(e.key==='Escape'){close();canvas.focus();}
        else if(e.key==='ArrowDown'||e.key==='ArrowUp')list[(i+(e.key==='ArrowDown'?1:-1)+list.length)%list.length].focus();
        else if(e.key==='ArrowRight'&&e.target.dataset.action==='new')openNew(true);
        else if(e.key==='ArrowLeft'&&n===sub){sub.hidden=true;newButton.setAttribute('aria-expanded','false');newButton.focus();}
        else if(e.key==='Tab'){close();return;}
        else return;
        e.preventDefault();
      });
    }
    menu.onpointerover=e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b===newButton)openNew(false);
      else{sub.hidden=true;newButton.setAttribute('aria-expanded','false');}
    };
    document.addEventListener('pointerdown',e=>{
      if(!menu.contains(e.target)&&!sub.contains(e.target))close();
    },true);
    editor.onkeydown=e=>{
      if(e.key!=='Enter'&&e.key!=='Escape')return;
      e.preventDefault();if(finishRename(e.key==='Enter'))canvas.focus({preventScroll:true});
    };
    editor.onblur=()=>finishRename(true);
    canvas.oncontextmenu=e=>{
      e.preventDefault();clearTimeout(hold);
      const p=coords(e);open(p.x,p.y);
    };
    canvas.onpointerdown=e=>{
      if(e.button!==0)return;
      close();if(editing&&!finishRename(true))return;
      canvas.focus({preventScroll:true});
      const p=coords(e);
      if(p.y>=v().bottom){
        if(getRun().desktop){select(HopGround.BAR);jump(HopGround.BAR,v().world(p.x,p.y).x);}
        return;
      }
      const hit=itemAt(p.x,p.y);select(hit?.id??null);
      if(e.pointerType==='touch')hold=setTimeout(()=>open(p.x,p.y),550);
      drag={id:hit?.id,start:p,original:hit,point:hit,moved:false};
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove=e=>{
      if(!drag)return;
      const p=coords(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      clearTimeout(hold);if(!drag.original)return;
      drag.moved=true;drag.point={x:drag.original.x+dx/v().scale,y:drag.original.y-dy/v().scale};paint();
    };
    canvas.onpointerup=e=>{
      clearTimeout(hold);
      const d=drag;drag=null;
      if(!d?.moved)return;
      const p=coords(e),over=itemAt(p.x,p.y);
      if(p.x>=0&&p.x<canvas.clientWidth&&p.y>=0&&p.y<v().bottom){
        if(over?.kind==='bin'&&d.id!==over.id)remove(d.id);
        else{
          const point=cellNear(d.point,d.id);
          if(point&&(point.x!==d.original.x||point.y!==d.original.y))
            commit(icons().map(i=>i.id===d.id?{...i,...point}:i),'Moved '+d.original.name);
        }
      }
      paint();
    };
    canvas.onpointercancel=canvas.onlostpointercapture=()=>{clearTimeout(hold);if(drag){drag=null;paint();}};
    canvas.onkeydown=e=>{
      const p=find(selected);
      if(e.key==='Delete'&&p)remove(p.id);
      else if(e.ctrlKey&&e.key.toLowerCase()==='z'&&trash.length)restore();
      else if(e.key==='F2'&&p)rename();
      else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
        if(selected===HopGround.BAR){open(v().point(getRun().goalPoint()??getRun().barWidth/2,0).x,v().bottom+8);}
        else{const b=p?render.iconBox(v(),p):{cx:22,y:15};open(b.cx,b.y+8);}
      }else if(e.shiftKey&&e.ctrlKey&&e.key.toLowerCase()==='n'){
        anchor={x:grid.left,y:grid.top};create('folder');
      }else if(e.key==='Escape'){select(null);close();}
      else return;
      e.preventDefault();
    };
    return {drawing:()=>({selected,drag:drag?.moved?drag:null}),recycled:()=>trash,reset:(saved=[])=>{
      trash=saved;
      clearTimeout(hold);clearTimeout(noticeTimer);editing=null;editor.hidden=true;notice.hidden=true;
      close();selected=null;drag=null;anchor=null;
    }};
  }
  root.HopDesktop={bind};
})(globalThis);
