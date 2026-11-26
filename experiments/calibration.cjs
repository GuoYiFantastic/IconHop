// Compare model sampling error and wind-model shift on independent layouts.
// All training, calibration, single-jump test, and route test streams are distinct.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('../physics');
const H = require('../planner');
const S = require('../scenes');
const E = require('../engine');

const layouts = 180;
const firstSeed = 960000;
const holdoutFlights = 256;
const routeFlights = 64;
const scales = [1, 1.7];
const estimates = ['mc16', 'mc64', 'mc256', 'observed8', 'observed32'];
const layoutRows = [];
const reliability = new Map();
let nominalPairs = 0;
let safeEdges = 0;
let trainingMatches = 0;

function landed(source, edge, icons, rng, scale) {
  const flight = P.trajectory(source, edge.q, P.wind(rng, scale));
  const hit = P.contact(flight, icons);
  return hit.icon === edge.to && hit.safe;
}

function bootstrap(values) {
  const rng = P.random(45109);
  const replicates = [];
  for (let b = 0; b < 2000; b++) {
    let sum = 0;
    for (let k = 0; k < values.length; k++) sum += values[Math.floor(rng() * values.length)];
    replicates.push(sum / values.length);
  }
  replicates.sort((a, b) => a - b);
  return [replicates[49], replicates[1949]];
}

for (let i = 0; i < layouts; i++) {
  const seed = firstSeed + i;
  const scene = S.generate(seed, 'standard');
  const modelSeed = P.hash('calibration-model', seed);
  const graph = new H.Graph(scene.icons, {seed:modelSeed, samples:64, noise:1});
  // Recheck all ordered pairs against the whole scene without the graph's
  // swept-volume filter. This covers both accepted and rejected arcs.
  for (const source of scene.icons) for (const target of scene.icons) {
    if (source.id === target.id) continue;
    nominalPairs++;
    const shot = P.shoot(source, target, 'gn');
    const hit = shot && P.contact(P.trajectory(source, shot), scene.icons);
    const expected = Boolean(hit && hit.icon === target.id && hit.safe);
    const actual = graph.edges.has(H.edgeKey(source.id, target.id));
    if (expected !== actual) throw new Error('Nominal contact disagreement in layout ' + seed);
  }
  const edges = [...graph.edges.values()];
  safeEdges += edges.length;
  const model = new Map();
  for (const edge of edges) {
    const source = graph.byId.get(edge.from);
    const rng = P.random(P.hash(modelSeed, edge.from, edge.to, 'edge-MC'));
    let count = 0;
    const predictions = {};
    for (let j = 1; j <= 256; j++) {
      count += Number(landed(source, edge, scene.icons, rng, 1));
      if (j === 16 || j === 64 || j === 256) predictions['mc' + j] = count / j;
    }
    if (predictions.mc64 !== edge.successes / edge.n) throw new Error('MC contact disagreement in layout ' + seed);
    trainingMatches++;
    model.set(edge, predictions);
  }
  for (const scale of scales) {
    const examples = [];
    for (const edge of edges) {
      const estimatesForEdge = {...model.get(edge)};
      const source = graph.byId.get(edge.from);
      const calibrationRng = P.random(P.hash('calibration-observations', seed, edge.from, edge.to));
      const history = new H.LandingHistory();
      for (let j = 1; j <= 32; j++) {
        history.observe(edge, landed(source, edge, scene.icons, calibrationRng, scale));
        if (j === 8 || j === 32) estimatesForEdge['observed' + j] = history.probability(edge);
      }
      const testRng = P.random(P.hash('calibration-edge-test', seed, edge.from, edge.to));
      let wins = 0;
      for (let j = 0; j < holdoutFlights; j++) wins += Number(landed(source, edge, scene.icons, testRng, scale));
      examples.push({edge, predictions:estimatesForEdge, wins});
    }
    for (const name of estimates) {
      let brierSum = 0;
      let biasSum = 0;
      for (const {edge, predictions, wins} of examples) {
        const p = predictions[name];
        edge.p = p;
        const frequency = wins / holdoutFlights;
        brierSum += frequency * (1 - p) ** 2 + (1 - frequency) * p ** 2;
        biasSum += p - frequency;
        const bin = Math.min(9, Math.floor(p * 10));
        const key = [scale, name, bin].join('/');
        if (!reliability.has(key)) reliability.set(key, {scale, estimate:name, bin, edges:0, trials:0, wins:0, sumPredicted:0});
        const group = reliability.get(key);
        group.edges++; group.trials += holdoutFlights; group.wins += wins; group.sumPredicted += p;
      }
      const cache = new Map();
      let reached = 0;
      let totalCost = 0;
      for (let j = 0; j < routeFlights; j++) {
        const out = E.episode(scene, {graph, cache, noise:scale, method:'vi', seed:P.hash('calibration-route-test', seed, j)});
        reached += out.reached;
        totalCost += out.cost;
      }
      layoutRows.push({seed, scale, estimate:name, edges:edges.length, brierSum, biasSum, reached, trials:routeFlights, totalCost});
    }
  }
}

const summary = [];
for (const scale of scales) {
  const baseline = layoutRows.filter(r => r.scale === scale && r.estimate === 'mc64');
  for (const estimate of estimates) {
    const rows = layoutRows.filter(r => r.scale === scale && r.estimate === estimate);
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const averageReach = sum('reached') / sum('trials');
    const pairedReach = rows.map((r, i) => (r.reached - baseline[i].reached) / routeFlights);
    summary.push({scale, estimate, layouts:rows.length, testedEdges:sum('edges'), brier:sum('brierSum') / sum('edges'),
      bias:sum('biasSum') / sum('edges'), reach:averageReach, meanCost:sum('totalCost') / sum('trials'),
      deltaReach:pairedReach.reduce((s, v) => s + v, 0) / rows.length, deltaReachCI:bootstrap(pairedReach)});
  }
}
const result = {modelScale:1, firstSeed, layouts, holdoutFlights, routeFlights, nominalPairs, safeEdges, trainingMatches,
  summary, reliability:[...reliability.values()]};
const target = path.join(__dirname, '..', 'results');
fs.mkdirSync(target, {recursive:true});
fs.writeFileSync(path.join(target, 'calibration.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'calibration-layouts.csv'), [Object.keys(layoutRows[0]).join(','),
  ...layoutRows.map(r => Object.values(r).join(','))].join('\n') + '\n');
console.table(summary.map(({scale,estimate,brier,bias,reach,deltaReach}) => ({scale,estimate,brier,bias,reach,deltaReach})));
