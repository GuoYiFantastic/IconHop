(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./physics'), require('./planner'), require('./scenes'), require('./engine'));
  } else {
    root.HopBellmanExample = factory(root.HopPhysics, root.HopPlan, root.HopScenes, root.HopEngine);
  }
})(globalThis, function (physics, planner, scenes, engine) {
  'use strict';

  function atMail() {
    const run = new engine.Run(scenes.get('wind'), {method: 'vi', seed: 2});
    while (run.current !== 'mail' && run.jumps < 5 && run.launch()) run.advance(10);
    if (run.mode !== 'Landed' || run.current !== 'mail') {
      throw new Error('The recorded windy route did not reach the Mail decision.');
    }
    return run;
  }

  function evaluate(run, failureCost) {
    const graph = run.graph;
    const budget = planner.budget(run.energy);
    const candidates = graph.out.get(run.current).filter(edge => edge.bins <= budget);
    const choices = candidates.map(edge => {
      const nextEnergy = (budget - edge.bins) * physics.C.bin;
      const future = planner.plan(graph, edge.to, run.goal, nextEnergy, 'vi', {failCost: failureCost}).value;
      const deterministicFuture = planner.plan(graph, edge.to, run.goal, nextEnergy, 'astar').value;
      return {
        to: edge.to, hits: edge.successes, trials: edge.n, stage: edge.cost, bins: edge.bins, future,
        expected: edge.cost + edge.p * future + (1 - edge.p) * failureCost,
        deterministic: edge.cost + deterministicFuture
      };
    });
    const vi = planner.plan(graph, run.current, run.goal, run.energy, 'vi', {failCost: failureCost});
    const astar = planner.plan(graph, run.current, run.goal, run.energy, 'astar');
    return {
      scene: 'wind', executionSeed: run.seed, icon: run.current, goal: run.goal,
      stamina: run.energy, budget, failureCost, choices, vi: vi.path[0].to, astar: astar.path[0].to
    };
  }

  return {atMail, evaluate};
});
