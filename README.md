# IconHop

IconHop is a browser robotics sandbox. Desktop icons are landing platforms for a pet that runs, jumps and bounces. Move a platform and the route changes. Open the method labs to see how the jump solver, planner and wind estimator make their decisions.

## Run locally

1. On GitHub, select **Code → Download ZIP** and extract the archive, or run `git clone https://github.com/GuoYiFantastic/IconHop.git`.
2. Open [index.html](index.html) from the extracted or cloned folder in a desktop browser. The playground runs offline without installing Node.js or starting a server.
3. Drag an icon to move it. Right-click the icon and choose **Jump here** to send the pet to it.

中文快速开始：在 GitHub 点 **Code → Download ZIP**，解压后用桌面浏览器打开 `index.html`。拖动图标可以改变它的位置。右键图标，点 **Jump here**，宠物就会自己找路跳过去。

If your browser restricts local files, run `python -m http.server 8000` in the same folder and open `http://localhost:8000/`.

| Demo | What to try |
| --- | --- |
| [Photos to Work](index.html?scene=runup) | Select **Run route**, then follow the walk along the taskbar and the running jumps. Turn on **Show planned route** to see the predicted arcs. |
| [Stacked icons](demos.html?chapter=stack) | Play or scrub a jump that uses a side-wall rebound to reach the lower ledge. |
| [Move a stepping stone](index.html?scene=bridge) | From the taskbar, right-click Archive and choose **Jump here**. Drag Step between the taskbar and Archive so the pet can reach it in two jumps. |
| [Same-wind comparison](demos.html?chapter=wind) | Watch deterministic A* and the risk-aware MDP make different route choices using common gusts by jump index. |
| [Build a route](demos.html?chapter=tower) | Watch three added platforms turn an unreachable archive into a four-jump route. |
| [Bellman decision lab](methods.html#bellman) | Change the failure cost from 6.42 to 6.43 and inspect the switch from Archive to Tools at the same state. |
| [Kalman and launch feedback lab](methods.html#kf) | Change gust correlation and position noise and compare the next-launch prediction. |

In the playground, drag icons to move them. Right-click an icon for **Jump here**, or right-click empty space to create a new icon. Click the taskbar to walk to a point on it. Press Space to toggle automatic motion. Changes are saved in browser storage where the browser permits it.

## How it works

- [physics.js](physics.js) propagates ballistic motion, finds first contact and solves single-jump shooting problems.
- [planner.js](planner.js) builds the directed jump graph, repairs it after edits, and compares A*, value iteration, policy iteration and receding-horizon planning.
- [control.js](control.js) contains the constrained single-jump solver, Kalman updates and a one-stage LQR correction at takeoff. [frontier.js](frontier.js) computes routes that trade expected stamina against modeled reach.
- [ground.js](ground.js) plans desktop motion with states indexed by support and foot position. It searches walking, running takeoffs and wall-return jumps with Dijkstra. [engine.js](engine.js) executes actions and resolves contacts.

The course benchmark and desktop playground share ballistic and contact routines. The benchmark has a stamina budget, independent gusts and a 9.2 m/s landing criterion. The desktop models friction-limited push-off and dissipative landings without a stamina budget. The two modes have separate evaluation metrics.

## Reproduce results

Use Node.js 18 or later. Run the following from this directory. The standard-library tests require no installed packages.

```sh
node --test experiments/test.cjs experiments/course-test.cjs experiments/motion-test.cjs
node experiments/benchmark.cjs
node experiments/course-methods.cjs
node experiments/online-edits.cjs
node experiments/frontier.cjs
```

Outputs are written to [results/](results/). [policies.csv](results/policies.csv) records full-route success on held-out layouts. [tracking.csv](results/tracking.csv) records individual shuttle transfers in the wind-estimation experiment. [The desktop motion tests](experiments/motion-test.cjs) check sampled routes through frame-by-frame execution. See each experiment script for its seed ranges and options.

Optional browser verification and MP4 export use Playwright. Install it locally with `npm install --no-save playwright` and install its Chromium with `npx playwright install chromium`, or set `ICONHOP_BROWSER=msedge` for an existing Edge installation. Run `node experiments/browser-qa.cjs` for browser checks. To export a video, place FFmpeg with libx264 on PATH or set `ICONHOP_FFMPEG` to its executable, then run `node experiments/record-demos.cjs --only=stack`. The built-in replay player runs directly from the simulation and requires neither tool.

## License

The maintainers have yet to select a repository license.
