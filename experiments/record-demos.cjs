// Render exact simulation timestamps offline and encode constant-frame-rate H.264.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const project=path.resolve(__dirname,'..'),dest=path.join(project,'demos');
const stills=path.resolve(process.env.ICONHOP_QA_DIR||path.join(require('node:os').tmpdir(),'iconhop-qa'));
const framesPerSecond=60;
fs.mkdirSync(dest,{recursive:true});fs.mkdirSync(stills,{recursive:true});

async function record(page,chapter,index){
  await page.evaluate(async id=>{
    window.movie=new HopFilm.Player(document.createElement('canvas'));
    movie.canvas.width=1280;movie.canvas.height=720;
    movie.load(id);await movie.ready;
  },chapter.id);
  const output=path.join(dest,String(index+1).padStart(2,'0')+'-'+chapter.id+'.mp4');
  const stage=output+'.tmp';
  const codec=process.env.ICONHOP_ENCODER||'libx264';
  const quality=codec==='libx264'?['-preset','fast','-crf','19','-threads','4','-pix_fmt','yuv420p']:['-b:v','7M','-pix_fmt','nv12'];
  const sequence=fs.mkdtempSync(path.join(stills,'frames-'+chapter.id+'-'));
  try{
    const total=Math.round(chapter.duration*framesPerSecond);
    for(let n=0;n<total;n+=12){
      const batch=await page.evaluate(({start,stop,fps})=>{
        const frames=[];
        for(let i=start;i<stop;i++){
          movie.seek(i/fps);frames.push(movie.canvas.toDataURL('image/jpeg',.95).split(',')[1]);
        }
        return frames;
      },{start:n,stop:Math.min(n+12,total),fps:framesPerSecond});
      for(const [offset,frame] of batch.entries()){
        fs.writeFileSync(path.join(sequence,String(n+offset).padStart(5,'0')+'.jpg'),Buffer.from(frame,'base64'));
      }
    }
    execFileSync(process.env.ICONHOP_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-y',
      '-framerate',String(framesPerSecond),'-i',path.join(sequence,'%05d.jpg'),'-an','-c:v',codec,
      ...quality,'-movflags','+faststart','-f','mp4',stage],{windowsHide:true,stdio:'inherit'});
    const result=await page.evaluate(({id,duration})=>{
      movie.seek(duration);
      const state=movie.runs.map(v=>({mode:v.r.mode,current:v.r.current,goal:v.r.goal,jumps:v.r.jumps,energy:v.r.energy}));
      const t={stack:2.75,work:3.8,play:1.28,walk:4,first:1.98,drop:2.1,wind:4.6,tower:6.65,rest:7,kkt:7.3}[id];
      if(id==='stack'&&!(movie.runs[0].r.arrived()&&movie.runs[0].r.current==='pc'&&movie.runs[0].r.history.length===1&&movie.runs[0].r.lastShot.wall!=null))throw Error('Stacked icon route did not finish via the wall');
      if(id==='work'&&!(movie.runs[0].r.arrived()&&movie.runs[0].r.history.map(e=>e.actual).join(',')==='@taskbar,notes,mail,work'))throw Error('Work route did not finish');
      if(id==='drop'&&!(movie.runs[0].r.arrived()&&movie.runs[0].r.impacts.length===3))throw Error('Drop did not settle after three contacts');
      movie.seek(t);
      const still=movie.canvas.toDataURL('image/png').split(',')[1];
      if(id==='kkt'){
        const active=movie.certificate?.muLow;movie.seek(13);
        if(!(active>0)||movie.certificate!==null)throw Error('KKT sequence failed');
      }
      movie.buffers.forEach(b=>b.remove());return {state,still};
    },chapter);
    fs.writeFileSync(path.join(stills,chapter.id+'-film.png'),Buffer.from(result.still,'base64'));
    fs.renameSync(stage,output);
    console.log(chapter.id,total+' frames',JSON.stringify(result.state));
  }finally{
    for(const file of fs.readdirSync(sequence))if(/^\d{5}\.jpg$/.test(file))fs.unlinkSync(path.join(sequence,file));
    fs.rmdirSync(sequence);
  }
}
(async()=>{
 const browser=await chromium.launch({channel:process.env.ICONHOP_BROWSER||undefined,headless:true});
 try{
   const ctx=await browser.newContext({viewport:{width:1440,height:900}});
   // Serve a same-origin offline page from the checked-in files. Chrome
   // treats separate file:// resources as opaque origins when exporting a canvas.
   const base='http://iconhop.local/';
   const files=new Set(['demos.html','style.css','physics.js','control.js','kkt-plot.js','planner.js','scenes.js',
     'ground.js','engine.js','render.js','film.js',...fs.readdirSync(path.join(project,'assets')).map(n=>'assets/'+n)]);
   await ctx.route('**/*',r=>{
     const url=new URL(r.request().url()),name=url.pathname.slice(1);
     return url.origin==='http://iconhop.local'&&files.has(name)?r.fulfill({path:path.join(project,name)}):r.abort();
   });
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(base+'demos.html');
   const chapters=await page.evaluate(()=>HopFilm.chapters);
   const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
   if(only&&!chapters.some(c=>c.id===only))throw Error('Unknown chapter '+only);
   for(const [i,c] of chapters.entries())if(!only||c.id===only)await record(page,c,i);
   if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

