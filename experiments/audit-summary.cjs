// Summarize a completed or in-progress endurance checkpoint at layout level.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const source=path.resolve(process.argv[2]||path.join(__dirname,'../results/endurance.json'));
const output=path.resolve(process.argv[3]||path.join(__dirname,'../results/endurance-summary.csv'));
const audit=JSON.parse(fs.readFileSync(source,'utf8'));
const rows=[];
let totalEpisodes=0;
function ordered(value){
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
  return value;
}
for(const [key,cell] of Object.entries(audit.cells)) {
  const [profile,wind,n,policy]=key.split('/');
  const {episodes,layouts,reached,fallen,stranded}=cell;
  if(episodes!==layouts*12||episodes!==reached+fallen+stranded)throw new Error('Inconsistent outcomes in '+key);
  const mean=reached/episodes;
  // Each independent layout contributes one mean of its 12 rollouts.
  const variance=layouts>1?Math.max(0,(cell.squaredLayoutReach-layouts*mean**2)/(layouts-1)):null;
  const half=variance===null?null:1.96*Math.sqrt(variance/layouts);
  rows.push({profile,executionWind:Number(wind),modelSamples:Number(n),policy,layouts,episodes,reach:mean,
    reachLo:half===null?'':Math.max(0,mean-half),reachHi:half===null?'':Math.min(1,mean+half),
    fall:fallen/episodes,stranded:stranded/episodes,staminaPerAttempt:cell.energy/episodes,meanTaskCost:cell.cost/episodes});
  totalEpisodes+=episodes;
}
if(totalEpisodes!==audit.episodes||audit.blocks*24!==audit.episodes||
   audit.blocks!==audit.editChecks||audit.blocks!==audit.mdpChecks)throw new Error('Checkpoint counts do not reconcile');
if(audit.violations)throw new Error('Invariant violations: '+JSON.stringify(audit.examples));
rows.sort((a,b)=>a.profile.localeCompare(b.profile)||a.executionWind-b.executionWind||a.modelSamples-b.modelSamples||a.policy.localeCompare(b.policy));
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,[Object.keys(rows[0]).join(','),...rows.map(row=>Object.values(row).join(','))].join('\n')+'\n');
const fields=['blocks','episodes','editChecks','mdpChecks','violations','examples','cells'];
const content=Object.fromEntries(fields.map(k=>[k,audit[k]]));
const digest=require('node:crypto').createHash('sha256').update(JSON.stringify(ordered(content))).digest('hex');
console.log(JSON.stringify({updated:audit.updated,layouts:audit.blocks,episodes:audit.episodes,cells:rows.length,violations:audit.violations,digest}));
