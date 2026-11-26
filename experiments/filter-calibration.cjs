// Audit prelaunch Kalman prediction bands with independent simulated sequences.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const T=require('../tracking');
const firstSeed=3500000,sequences=12000,jumps=18;
const conditions=[
  ['Independent, matched',0,0,.10,.10],
  ['Independent, assume persistence',0,.9,.10,.10],
  ['Persistent, low sensor noise',.9,.9,.10,.10],
  ['Persistent, matched high noise',.9,.9,.30,.30],
  ['Persistent, underestimate sensor noise',.9,.9,.30,.10],
  ['Persistent, overestimate sensor noise',.9,.9,.30,.60],
  ['Persistent, assume independence',.9,0,.30,.30]
];
const summary=[];
for(const [label,rho,modelRho,noiseSD,assumedNoiseSD] of conditions){
  const totals={reached:0,sqError:0,normSq:0,coveredX:0,coveredY:0,widthX:0};
  let sumSeqCoverageX=0,sumSquaredSeqCoverageX=0;
  for(let i=0;i<sequences;i++){
    const {records}=T.shuttle(firstSeed+i,{method:'kalman',rho,noiseSD,modelRho,assumedNoiseSD,jumps});
    let covered=0;
    for(const r of records){
      totals.reached+=r.reached;
      for(let k=0;k<2;k++){
        const variance=r.priorVariance[k],err=r.actual[k]-r.predicted[k],sd=Math.sqrt(variance);
        if(!(variance>0)||!Number.isFinite(err))throw new Error('Invalid Gaussian prior');
        totals.sqError+=err*err;totals.normSq+=err*err/variance;
        const hit=Number(Math.abs(err)<=1.96*sd);
        if(k===0){covered+=hit;totals.coveredX+=hit;totals.widthX+=3.92*sd;}else totals.coveredY+=hit;
      }
    }
    const coverage=covered/jumps;
    sumSeqCoverageX+=coverage;sumSquaredSeqCoverageX+=coverage*coverage;
  }
  const transfers=sequences*jumps,mean=sumSeqCoverageX/sequences;
  const sampleVar=Math.max(0,(sumSquaredSeqCoverageX-sequences*mean*mean)/(sequences-1));
  const half=1.96*Math.sqrt(sampleVar/sequences);
  summary.push({label,rho,modelRho,noiseSD,assumedNoiseSD,sequences,transfers,reach:totals.reached/transfers,
    windRMSE:Math.sqrt(totals.sqError/transfers),normalizedSqErrorPerAxis:totals.normSq/(2*transfers),
    coverageX:totals.coveredX/transfers,coverageY:totals.coveredY/transfers,coverageXInterval:[mean-half,mean+half],
    meanXIntervalWidth:totals.widthX/transfers,totals});
}
const dir=path.join(__dirname,'../results');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'filter-calibration.json'),JSON.stringify({firstSeed,sequences,jumps,summary},null,2)+'\n');
console.table(summary.map(({label,reach,coverageX,normalizedSqErrorPerAxis,windRMSE})=>({label,reach,coverageX,normalizedSqErrorPerAxis,windRMSE})));
