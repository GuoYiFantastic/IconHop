// Optional browser integration tests. Requires Playwright and a Chromium browser.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const source=path.resolve(__dirname,'..'),art=path.resolve(process.argv[2]||path.join(require('node:os').tmpdir(),'iconhop-qa'));
fs.mkdirSync(art,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.ICONHOP_BROWSER||undefined,headless:true});
  try {
    const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    // Simulate the normal offline entry point; reject all remote requests.
    await ctx.route(/^https?:/,route=>route.abort());
    const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
    const url=pathToFileURL(path.join(source,'index.html')).href;
    await p.goto(url);
    const state=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('iconhop-desktop-v3')));
    const xy=point=>p.evaluate(({x,y})=>{
      const c=document.querySelector('#world'),rect=c.getBoundingClientRect(),v=HopRender.view(c),pt=v.point(x,y);
      return {x:rect.left+pt.x,y:rect.top+pt.y+8};
    },point);
    const desktopClick=async(point,button='left')=>{const q=await xy(point);await p.mouse.click(q.x,q.y,{button});};
    const dragIcon=async(from,to)=>{
      const a=await xy(from),b=await xy(to);
      await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:12});await p.mouse.up();
    };
    const initial=await state();
    await p.locator('#scene').selectOption('high-bin');
    const viewportSizes=await p.evaluateHandle(()=>{
      const canvas=document.querySelector('#world'),sizes=new Set();
      const sample=()=>sizes.add(canvas.clientWidth+'x'+canvas.clientHeight);
      sample();
      const observer=new ResizeObserver(sample);
      observer.observe(canvas);
      return {sizes,observer};
    });
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Downloads'));
    const highBin=await state();assert.equal(highBin.current,'downloads');
    assert.ok(highBin.impacts.some(h=>h.speed>9.2&&h.lost>0));
    await p.locator('#impact-history summary').click();
    await p.waitForFunction(()=>document.querySelector('#impact-events').getBoundingClientRect().height>0);
    await p.locator('#impact-history summary').click();
    const measured=await viewportSizes.evaluate(({sizes,observer})=>{
      observer.disconnect();
      return [...sizes];
    });
    await viewportSizes.dispose();
    assert.equal(measured.length,1,'route updates and impact history resized the desktop: '+measured.join(', '));
    await p.locator('#scene').selectOption('stack');
    // Some embedded viewers deliver animation frames but keep the page hidden flag set.
    await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:true,configurable:true}));
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at This PC'));
    await p.evaluate(()=>delete document.hidden);
    assert.equal((await state()).jumps,1,'selecting the demo alone runs the example');
    await p.locator('#reset').click();
    await p.locator('#graph').check();
    const pc=(await state()).icons.find(i=>i.id==='pc');
    await desktopClick({...pc,x:pc.x+.12},'right');
    await p.getByRole('menuitem',{name:'Jump here'}).click();
    assert.match(await p.locator('#path').textContent(),/Recycle Bin.*Side bounce.*This PC/);
    await p.locator('#screen').screenshot({path:path.join(art,'this-pc-route.png')});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at This PC'));
    const stacked=await state();assert.equal(stacked.jumps,1);assert.equal(stacked.current,'pc');
    assert.equal(stacked.pinnedGoalName,'This PC');assert.ok(Math.abs(stacked.stanceX-stacked.goalOffset-pc.x)<1e-5);
    await p.locator('#screen').screenshot({path:path.join(art,'this-pc-arrived.png')});
    // The desktop target picker also starts a route, then accepts the return journey.
    await p.locator('#target').selectOption('bin');
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Recycle Bin'));
    await p.locator('#target').selectOption('pc');
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at This PC'));
    await p.locator('#graph').uncheck();
    await p.locator('#scene').selectOption('runup');
    await p.locator('summary').filter({hasText:'Manual launch'}).click();
    assert.equal(await p.locator('#manual-strength').textContent(),'Peak push (N)');
    assert.equal(await p.locator('#effort-label').textContent(),'Peak push');
    await p.locator('#manual-j').fill('60');await p.locator('#manual-angle').fill('45');
    await p.locator('#manual-fire').click();assert.match(await p.locator('#manual-msg').textContent(),/slip/);
    assert.equal((await state()).jumps,0);
    await p.locator('#manual-angle').fill('85');await p.locator('#manual-fire').click();
    await p.waitForFunction(()=>document.querySelector('#count').textContent==='1');
    await p.locator('summary').filter({hasText:'Manual launch'}).click();
    await p.locator('#scene').selectOption('work');
    const work=(await state()).icons.find(i=>i.id==='work');
    await p.locator('#graph').check();await desktopClick(work,'right');
    await p.getByRole('menuitem',{name:'Jump here'}).click();
    assert.match(await p.locator('#path').textContent(),/Music.*This PC.*Work/);
    await p.locator('#screen').screenshot({path:path.join(art,'work-planned.png')});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Work'));
    assert.equal((await state()).current,'work');assert.equal(await p.locator('#count').textContent(),'4');
    await p.locator('#screen').screenshot({path:path.join(art,'work-arrived.png')});
    await p.locator('#graph').uncheck();await p.locator('#scene').selectOption('play');
    // Restore the reported, already-running desktop with its original pinned target and 16 prior flights.
    // Use the ordinary playground entry point and its persisted layout, including after a page reload.
    await p.evaluate(()=>{
      const key='iconhop-desktop-v3',saved=JSON.parse(localStorage.getItem(key)),scene=HopScenes.get('runup');
      Object.assign(saved,{icons:scene.icons,current:'photos',stanceX:2.59,goal:'work',goalOffset:-.02,
        pinnedGoalName:'Work',mode:'Landed',auto:true,patrol:false,jumps:16});
      localStorage.setItem('regression-test-snapshot',JSON.stringify(saved));
    });
    await p.addInitScript(()=>{
      const snapshot=localStorage.getItem('regression-test-snapshot');
      if(snapshot){localStorage.setItem('iconhop-desktop-v3',snapshot);localStorage.removeItem('regression-test-snapshot');}
    });
    await p.reload();assert.equal(await p.locator('#scene').inputValue(),'play');
    // The canvas sets the taskbar width. The shortest safe descent from Photos
    // can either land on Music or go straight to the taskbar at this viewport.
    const reportedPath=await p.locator('#path').textContent();
    assert.match(reportedPath,/Photos.*Taskbar.*Walk.*Notes.txt.*Run-up.*Mail.*Work/);
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Walking'&&parseFloat(document.querySelector('#height').textContent)===0);
    await p.reload();
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Work'));
    const arrival=await state();assert.equal(arrival.current,'work');assert.equal(arrival.goal,'work');
    assert.equal(arrival.jumps,reportedPath.includes('Music')?21:20);
    await p.locator('#screen').screenshot({path:path.join(art,'reported-layout-arrived.png')});
    await p.locator('#scene').selectOption('first');await p.locator('#scene').selectOption('play');
    assert.equal(initial.sceneId,'play');assert.equal(await p.locator('#select-tool,#add-tool,#delete-tool').count(),0);
    assert.equal(new Set(initial.icons.map(i=>i.x)).size,2);
    const mailIcon=initial.icons.find(i=>i.id==='mail');
    await dragIcon(mailIcon,{x:13.32,y:2.72});
    const movedMail=(await state()).icons.find(i=>i.id==='mail');
    await desktopClick(movedMail,'right');await p.getByRole('menuitem',{name:'Jump here'}).click();
    assert.match(await p.locator('#path').textContent(),/Taskbar.*(Walk|Run-up).*Mail/);
    await p.waitForFunction(()=>['Walking','Run-up'].includes(document.querySelector('#mode').textContent)&&
      parseFloat(document.querySelector('#height').textContent)===0);
    assert.equal(await p.locator('#target').inputValue(),'mail');
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Mail'));
    assert.equal((await state()).current,'mail');assert.equal(await p.locator('#target').inputValue(),'mail');
    await p.locator('#cancel-target').click();await p.locator('#reset').click();
    const homeIcon=initial.icons.find(i=>i.id==='home');
    const aim={x:homeIcon.x+.23,y:homeIcon.y};
    await desktopClick(aim,'right');await p.getByRole('menuitem',{name:'Walk here'}).click();
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived'));
    assert.equal(await p.locator('#count').textContent(),'0');
    assert.ok(Math.abs(parseFloat(await p.locator('#horizontal-position').textContent())-aim.x)<.03);
    await desktopClick({x:9,y:0});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Taskbar'));
    assert.ok(Math.abs(parseFloat(await p.locator('#horizontal-position').textContent())-9)<.04);
    const floorJumps=await p.locator('#count').textContent();
    // Start from a known stance, so the signed walking speed is independent of the landing point.
    await desktopClick({x:5,y:0},'right');await p.getByRole('menuitem',{name:'Walk here'}).click();
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Walking'&&
      parseFloat(document.querySelector('#horizontal-speed').textContent)<-1);
    assert.equal(await p.locator('#height').textContent(),'0.00 m');
    assert.equal(await p.locator('#vertical-speed').textContent(),'0.00 m/s');
    await desktopClick(initial.icons.find(i=>i.id==='notes'));
    assert.equal(await p.locator('#target').inputValue(),'@taskbar');
    await p.locator('#screen').screenshot({path:path.join(art,'walking-target.png')});
    await p.reload();
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Taskbar'));
    assert.ok(Math.abs(parseFloat(await p.locator('#horizontal-position').textContent())-5)<.04);
    assert.equal(await p.locator('#count').textContent(),floorJumps);
    await desktopClick(initial.icons.find(i=>i.id==='music'),'right');await p.getByRole('menuitem',{name:'Jump here'}).click();
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Music'));
    await p.locator('#cancel-target').click();
    for(const kind of ['Folder','Text Document']){
      await desktopClick(kind==='Folder'?{x:7,y:4}:{x:8.8,y:4},'right');await p.getByRole('menuitem',{name:'New',exact:false}).click();
      await p.getByRole('menuitem',{name:kind,exact:true}).click();
      const input=p.getByRole('textbox',{name:'File name'});
      await input.fill(kind==='Folder'?'Coursework':'Meeting.txt');await input.press('Enter');
    }
    const folder=(await state()).icons.find(i=>i.name==='Coursework');
    let doc=(await state()).icons.find(i=>i.name==='Meeting.txt');
    assert.ok(folder&&doc);assert.notDeepEqual([folder.x,folder.y],[doc.x,doc.y]);
    const destination={x:9.8,y:6};await dragIcon(doc,destination);
    const moved=(await state()).icons.find(i=>i.id===doc.id);
    assert.notEqual(moved.x,doc.x);doc=moved;
    await desktopClick(doc);await p.keyboard.press('F2');
    await p.locator('#rename-icon').fill('Draft.txt');await p.locator('#rename-icon').press('Escape');
    assert.ok((await state()).icons.some(i=>i.name==='Meeting.txt'));
    await desktopClick(doc,'right');await p.getByRole('menuitem',{name:/Delete/}).click();
    assert.ok(!(await state()).icons.some(i=>i.id===doc.id));
    await p.reload();const bin=(await state()).icons.find(i=>i.kind==='bin');
    await desktopClick(bin,'right');await p.getByRole('menuitem',{name:'Restore last deleted item'}).click();
    assert.ok((await state()).icons.some(i=>i.id===doc.id&&i.x===doc.x&&i.y===doc.y));
    await dragIcon(folder,bin);
    assert.ok(!(await state()).icons.some(i=>i.id===folder.id));
    await desktopClick(doc);await p.keyboard.press('Delete');
    assert.ok(!(await state()).icons.some(i=>i.id===doc.id));
    await p.keyboard.press('Control+z');assert.ok((await state()).icons.some(i=>i.id===doc.id));
    await desktopClick({x:6.4,y:7},'right');await p.getByRole('menuitem',{name:'New',exact:false}).hover();
    await p.locator('#new-menu').waitFor();await p.locator('#screen').screenshot({path:path.join(art,'desktop-new-menu.png')});
    await p.keyboard.press('Escape');
    await p.goto(url+'?scene=first');await p.locator('#world').waitFor();
    await p.locator('#step').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Arrived'));
    assert.equal(await p.locator('#count').textContent(),'1');
    assert.equal(await p.locator('#energy,#rest').count(),0);
    await p.locator('#target').selectOption('home');
    await p.goto(url);assert.equal(await p.locator('#target').inputValue(),'home');
    assert.equal(await p.locator('#count').textContent(),'1');
    await p.locator('#scene').selectOption('first');await p.locator('summary').filter({hasText:'Manual launch'}).click();
    await p.locator('#copy-shot').click();await p.locator('#manual-fire').click();
    await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Arrived'));
    await p.locator('summary').filter({hasText:'Manual launch'}).click();
    await p.locator('#scene').selectOption('wind');
    await p.screenshot({path:path.join(art,'wind-desktop.png')});
    const pathVI=await p.locator('#path').textContent();
    await p.locator('#method').selectOption('astar');assert.notEqual(await p.locator('#path').textContent(),pathVI);
    await p.locator('#method').selectOption('mpc');await p.locator('#horizon').fill('4');await p.locator('#horizon').press('Tab');
    assert.ok(await p.locator('#run').isEnabled());await p.locator('#solver').selectOption('kkt');
    await p.locator('#scene').selectOption('tower');assert.equal(await p.locator('#run').isDisabled(),true);
    // The goal has no route yet. Only right-click file creation should be needed to unlock it.
    const archive=(await state()).icons.find(i=>i.id==='archive');
    await desktopClick(archive,'right');await p.getByRole('menuitem',{name:'Jump here'}).click();
    assert.match(await p.locator('#status').textContent(),/No jump route/);
    assert.equal(await p.locator('#mode').textContent(),'Waiting for a route');
    assert.equal(await p.locator('#run').textContent(),'Pause auto-retry');
    await p.locator('#layout-editor summary').click();
    await p.locator('#edit-id').selectOption('archive');await p.locator('#remove-edit').click();
    assert.equal(await p.locator('#target').inputValue(),'archive');
    assert.match(await p.locator('#target option:checked').textContent(),/Archive.*unavailable/);
    await p.locator('#scene').selectOption('first');await p.locator('#scene').selectOption('tower');
    await desktopClick(archive,'right');await p.getByRole('menuitem',{name:'Jump here'}).click();
    for(const [i,[x,y]] of [[6.20,2.72],[9.76,4.22],[13.32,5.72]].entries()) {
      await desktopClick({x,y},'right');await p.getByRole('menuitem',{name:'New'}).click();
      await p.getByRole('menuitem',{name:'Text Document'}).click();
      await p.locator('#rename-icon').fill('Step '+(i+1)+'.txt');await p.locator('#rename-icon').press('Enter');
      assert.equal(await p.locator('#target').inputValue(),'archive');assert.equal((await state()).auto,true);
      if(i===0){await p.reload();assert.equal(await p.locator('#target').inputValue(),'archive');}
    }
    await p.locator('.desktop').screenshot({path:path.join(art,'tower-route.png')});
    await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('Arrived'),{},{timeout:15000});
    assert.equal(await p.locator('#count').textContent(),'4');
    assert.equal(await p.locator('#target').inputValue(),'archive');
    await p.locator('#reset').click();assert.equal(await p.locator('#target').inputValue(),'archive');
    assert.equal((await state()).pinnedGoalName,'Archive');
    await desktopClick(archive,'right');await p.getByRole('menuitem',{name:/Delete/}).click();
    assert.match(await p.locator('#target option:checked').textContent(),/Archive.*unavailable/);
    await p.keyboard.press('Control+z');assert.equal(await p.locator('#target option:checked').textContent(),'Archive');
    await desktopClick(archive,'right');await p.getByRole('menuitem',{name:'Cancel target'}).click();
    assert.equal(await p.locator('#target').inputValue(),'');
    await p.reload();assert.equal(await p.locator('#target').inputValue(),'');
    await p.locator('#scene').selectOption('route');
    await p.locator('#step').click();await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Airborne');
    // Remove the physical landing support during the arc through a normal editor action.
    await p.evaluate(()=>{
      const ed=document.querySelector('#edit-id');ed.value='notes';ed.dispatchEvent(new Event('change'));
      document.querySelector('#remove-edit').click();
    });
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Failed');
    await p.locator('#run').click();assert.equal(await p.locator('#mode').textContent(),'Landed');
    await p.locator('#scene').selectOption('first');await p.locator('#layout-editor summary').click();
    for(const id of ['mail','home']){await p.locator('#edit-id').selectOption(id);await p.locator('#remove-edit').click();}
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Failed');
    assert.equal(await p.locator('#run').isDisabled(),true);assert.match(await p.locator('#status').textContent(),/Add a platform/);
    await p.locator('#edit-x').fill('4');await p.locator('#edit-y').fill('2');await p.locator('#edit-w').fill('2');await p.locator('#add-edit').click();
    assert.equal(await p.locator('#run').textContent(),'Recover on platform');await p.locator('#run').click();
    assert.equal(await p.locator('#mode').textContent(),'Landed');await p.locator('#layout-editor summary').click();
    await p.locator('#scene').selectOption('drop');
    assert.equal(await p.locator('#height').textContent(),'7.00 m');
    await p.locator('#drop-support').click();
    await p.waitForFunction(()=>parseFloat(document.querySelector('#vertical-speed').textContent)<-1);
    assert.equal(await p.locator('#vertical-accel').textContent(),'-9.81 m/s²');
    await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Arrived at Archive'));
    assert.equal(await p.locator('#height').textContent(),'2.00 m');
    await p.locator('#impact-history summary').click();
    assert.equal(await p.locator('#impact-events li').count(),3);
    assert.match(await p.locator('#impact-events').textContent(),/49.05 → 5.67 J/);
    assert.equal(await p.locator('#count').textContent(),'0');
    await p.emulateMedia({reducedMotion:'no-preference'});
    await p.locator('#scene').selectOption('play');
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Crouching');
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Compressing');
    await p.waitForFunction(()=>document.querySelector('#mode').textContent==='Rebounding');
    await p.waitForFunction(()=>Number(document.querySelector('#count').textContent)>=2);
    await p.locator('#run').click();await p.locator('#run').click();
    await p.waitForFunction(()=>Number(document.querySelector('#count').textContent)>=3);
    await p.locator('#run').click();
    // Selecting a desktop icon is independent of changing the pet's destination.
    const home=await p.evaluate(()=>{
      const canvas=document.querySelector('#world'),rect=canvas.getBoundingClientRect(),v=HopRender.view(canvas);
      const p=HopScenes.get('play').icons.find(icon=>icon.id==='home'),xy=v.point(p.x,p.y);
      return {x:rect.left+xy.x,y:rect.top+xy.y+12};
    });
    const oldGoal=await p.locator('#target').inputValue();
    await p.mouse.click(home.x,home.y);assert.equal(await p.locator('#target').inputValue(),oldGoal);
    await p.mouse.click(home.x,home.y,{button:'right'});
    await p.getByRole('menuitem',{name:'Jump here'}).click();
    await p.waitForFunction(()=>document.querySelector('#target').value==='home'&&document.querySelector('#status').textContent.includes('Arrived at Projects'),{},{timeout:15000});
    await p.locator('#scene').selectOption('route');await p.locator('#graph').check();
    await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(art,'mobile.png'),fullPage:true});
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await p.setViewportSize({width:1440,height:900});
    await p.getByRole('link',{name:'Course methods'}).click();
    for(const id of ['shoot','kkt','bellman','mpc','kf']){
      await p.locator('[data-tab="'+id+'"]').click();
      assert.ok((await p.locator('#results').textContent()).length>0||(await p.locator('#snap-table tr').count())>1);
      await p.screenshot({path:path.join(art,'method-'+id+'.png')});
      if(id==='bellman'){
        const vi=p.locator('#results strong').first(),astar=p.locator('#results strong').nth(1);
        assert.equal(await vi.textContent(),'Tools');assert.equal(await astar.textContent(),'Archive');
        assert.match(await p.locator('#snap-table').textContent(),/48 \/ 64/);
        await p.locator('#lab-penalty').fill('6.42');assert.equal(await vi.textContent(),'Archive');
        await p.locator('#lab-penalty').fill('6.43');assert.equal(await vi.textContent(),'Tools');
        assert.equal(await astar.textContent(),'Archive');
      }
    }
    await p.locator('#lab-rho').focus();await p.locator('#lab-rho').press('Home');assert.ok((await p.locator('#formula').textContent()).includes('LQR')||
      (await p.locator('#formula').textContent()).includes('δv'));
    const matchedResults=await p.locator('#results').textContent();
    await p.locator('#lab-assumption').selectOption('persistent');
    assert.notEqual(await p.locator('#results').textContent(),matchedResults);
    await p.locator('[data-tab="frontier"]').click();
    assert.ok((await p.locator('#results').textContent()).includes('Met'));
    await p.screenshot({path:path.join(art,'method-frontier.png')});
    await p.locator('#lab-layout').selectOption('980237');
    assert.ok((await p.locator('#results').textContent()).includes('Infeasible'));
    assert.ok((await p.locator('#snap-table tr').count())>1);
    await p.setViewportSize({width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    assert.deepEqual(errors,[]);console.log('Browser checks passed: pinned target across right-click file creation, deletion, restoration, reset and reload, automatic four-hop arrival, cancellation, desktop edits, flight, course labs and mobile.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

