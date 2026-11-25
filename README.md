# Void Runner.

Void Runner is a full-screen 3D parkour runner built with Three.js and Vite. Sprint across floating moon bridges, dodge hazards, jump broken paths, slide under gates, collect coins, and chain combos while the world accelerates.

## Features

- Full-bleed WebGL scene with a giant moon, stars, floating islands, fog, and animated sky bridge.
- Stylized human parkour runner built from 3D primitives.
- Lane movement, jump, slide, pause, restart, and mobile touch controls.
- Procedural hurdles, slide gates, pillars, bridge-gap markers, coins, and shield pickups.
- Coins, shields, combo multiplier, score, best score, pause, restart, and game-over flow.
- Two coin layers: **Run Coins** (this run) and **Coins** (lifetime archive). Each pickup is written to `localStorage` immediately, so restarting mid-run or refreshing the page never drops coins you already collected.
- Restart rebuilds the whole run: obstacles, pickups, particles, and floating islands are removed (and their geometries disposed), the bridge layout is reset, and lane/jump/slide/combo/shield/score/timers go back to their starting values. The best score and coin archive survive restart and refresh.
- Shields absorb one obstacle hit each: the shield count drops, the combo resets, and the HUD updates in the same frame. Only a hit with zero shields ends the run.
- Responsive HUD designed for desktop and mobile.
- Local best-score and coin persistence with `localStorage`.

## Controls

| Action | Input |
| --- | --- |
| Move left | `ArrowLeft` or `A` |
| Move right | `ArrowRight` or `D` |
| Jump | `ArrowUp` or `W` |
| Slide | `ArrowDown` or `S` |
| Pause | `Space` |
| Restart | `R` |

## Run Locally

Requires Node.js 18+ (the test tooling uses `node:test` and global `fetch`).

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Verify The Fix

### Automated tests (no browser needed)

```bash
npm test
```

`game-state.js` holds the run/archive logic as pure functions (`createRunState`, `resetRun`, `collectCoin`, `collectShield`, `resolveObstacleHit`, `recordScore`, `clearRunCollections`), and `tests/game-state.test.js` covers:

- a coin pickup is written to `localStorage` immediately, before game over;
- `resetRun` zeroes run state (score, combo, shield, lane, slide, jump, timers) while the archive keeps its coins and best score;
- shields absorb one hit each (shield–1, combo reset), and an unshielded hit is the only game-over result;
- restart/refresh loops keep all banked coins;
- `clearRunCollections` removes every tracked obstacle/pickup/particle/island.

### Browser smoke test (Chrome or Edge, headless)

```bash
npm run test:e2e
```

This builds the app, serves `dist` on an auto-selected free port (`E2E_PORT=4173` to pin one), and drives the real page over the Chrome DevTools Protocol. It asserts:

1. the page boots with the debug hook and scene objects;
2. a coin placed on the runner is banked to `localStorage` the same moment it is picked up;
3. **Restart** clears obstacles, pickups, particles, and the surplus islands while rebuilding exactly the fresh-run island set, resets score/combo/shield/lane/slide/jump, and preserves best score + coins;
4. a page refresh reloads the same coin/best archive, and the HUD shows it;
5. a shield pickup shows `1` in the HUD, the first hit drops it to `0` and resets the combo without ending the run, and the next hit shows the game-over panel.

Pass a specific browser with `CHROME_PATH=/path/to/chrome npm run test:e2e`.

### Manual check in the browser

```bash
npm run dev
```

Then open the dev URL, open DevTools, and use the debug hook (`window.__voidRunner`):

| Scenario | Console commands | Expected |
| --- | --- | --- |
| Coin survives restart | Start a run, collect any coin. Note **Coins** and **Run Coins**. Click **Restart** (or press `R`). | **Run Coins** resets to `000`; **Coins** keeps the banked total; `localStorage.getItem('void-runner-coins')` matches. Reload the page and **Coins** is still there. |
| Coins survive refresh | While running, collect a coin, then reload. | The HUD **Coins** value reloads from the archive, still including the coin. |
| Force a pickup | `__voidRunner.startRun(); __voidRunner.spawnPickup('coin', { lane: 1, z: 1.2, y: 0.9 })` | Coin collected within a frame; **Coins** +1, **Run Coins** +1. |
| Shield absorbs a hit | `__voidRunner.startRun(); __voidRunner.spawnPickup('shield', { lane: 1, z: 1.2, y: 0.9 })` then after it lands: `__voidRunner.hitObstacle(); __voidRunner.getState()` | **Shield** `1 → 0`, **Combo** back to `x1`, run continues (`over: false`), shield readout pulses. |
| Shield gone = game over | Repeat `__voidRunner.hitObstacle()` | Game-over panel appears, `over: true`. |
| Scene teardown | Run for a few seconds so islands accumulate, then `__voidRunner.getSceneCounts()` before/after **Restart** | `islands` goes back to `8`; `obstacles`/`pickups`/`particles` are `0`; `sceneChildren` drops. |

`__voidRunner.getState()` and `__voidRunner.getArchive()` expose the two layers directly (`sessionCoins` vs. `coins`).

## Stack

- Vite
- Three.js
- Cannon dependency retained for future physics experiments
