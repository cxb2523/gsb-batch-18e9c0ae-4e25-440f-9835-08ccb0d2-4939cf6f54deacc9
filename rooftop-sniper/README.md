# ROOFTOP SNIPER: LAST LIGHT

A first-person 3D sniper game that runs in the browser, built with **Three.js + Vite**.
You're on a high-rise at sunset. Across the skyline, armed spotters and a recon drone move
between rooftops, mixed in with civilians. Scope in, identify, and take the shot before the light goes.

Everything is procedural: the city, characters, textures and sounds are all generated at runtime.
There are no asset files, external services, API keys or runtime downloads.

## Run it

Requires [Node.js](https://nodejs.org) 18+ (tested on Node 22).

```bash
npm install
npm start
```

`npm start` launches the Vite dev server and opens http://localhost:5173 in your browser.
(`npm run dev` does the same without opening the browser.)

**Windows shortcut:** double-click `PLAY.bat`. It installs dependencies the first time, then starts the game.

### Play without a server (offline single file)

```bash
npm run build:offline
```

This writes `offline/index.html`, one self-contained file with no external references.
Double-click it to play in Chrome or Edge, with no Node or server required. A prebuilt copy is included.

Other scripts: `npm run build` produces a normal static build in `dist/`, and `npm run preview` serves it.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim |
| Left click | Fire |
| Right click / **AIM** button | Scope in / out |
| Mouse wheel or `Q` / `E` | Scope zoom (4× / 6× / 8× / 11×) |
| `Shift` (hold, while scoped) | Hold breath, which steadies the sway for ~4.5 s |
| `R` | Reload |
| `W A S D` / arrow keys | Shift position along the parapet |
| `Esc` | Pause / resume |
| `H` | Toggle the in-game help panel |
| `M` | Mute / unmute |

**Mouse capture:** the game uses pointer lock. The first click on the view only captures the mouse and never fires.
If the browser refuses pointer lock (for example, in some embedded browsers), the game switches to
**drag-to-aim**. In that mode you drag to turn, and a short click without dragging fires, so adjusting the view never shoots.
Mouse sensitivity is in *Pause → Controls*.

## Mission

- Eliminate **5 hostiles** (4 armed spotters + 1 recon drone) within **3:00**.
- **2 civilians** share the rooftops. Each civilian hit is **−1500** with a full-screen *CIVILIAN HIT* warning.
  A second civilian hit fails the mission.
- 20 rounds (5-round magazine). Running dry with hostiles left fails the mission.
- Each miss costs −50. Hits score 1000 + 2 per metre + 500 for a headshot. A successful mission also earns
  a time bonus (10 per second left) and an accuracy bonus.

### Telling hostiles from civilians (through the scope)

| Hostile | Civilian |
| --- | --- |
| Olive helmet, plate carrier with pouches | Bare head with hair |
| Rifle held across the chest, raised on lookout | No weapon; phone to ear or shopping bag |
| Radio backpack with whip antenna | Light shirt, jeans |
| Hunched, scanning posture; sometimes jogs between cover | Relaxed upright walk; hands up and crouches when shots land nearby |
| Faint blinking **IR strobe** on the shoulder, visible **only through the scope** | No strobe |

Without the scope, the ID panel reads **UNIDENTIFIED**. Scope in to see **HOSTILE** or **CIVILIAN**, the range,
and the status (**MOVING**, **IN COVER**, or **EXPOSED**). The panel only appears when your crosshair is near a target.

### Range, drop and wind (arcade ballistics)

- The rangefinder shows `DISTANCE ### m` for whatever is under the crosshair.
- Bullets travel at 700 m/s. They drop more with range (about 0.1 m at 100 m and 0.6 m at 250 m), and wind pushes them sideways a little.
- In the scope, a **◇ HOLD** mark sits where you should aim for the current target (drop and wind included).
  The reticle also has **1 / 2 / 3** holdover ticks for 100 / 200 / 300 m.
- Hit detection is decided the moment you fire, so you don't need to lead moving targets.
  The impact, hit marker and target reaction play out after the bullet's flight time.
- Every miss tells you why, for example `MISS · 0.6 m LOW — hold higher at 243 m`, `… wind pushed 0.3 m right`,
  or `BLOCKED BY COVER`. A spark and dust puff show where the round landed.

## Project layout

```
index.html              HUD, scope overlay and menu screens (DOM)
PLAY.bat                Windows one-click launcher
offline/index.html      Prebuilt single-file offline version
src/
  main.js               Boot, WebGL check, error screen
  game.js               Renderer, state machine (title → briefing → playing ⇄ paused → results), scoring
  config.js             All tuning values + ballistics helpers
  style.css             HUD / menu styling
  world/
    sky.js              Sunset sky shader, sun direction, fog colour
    city.js             Procedural skyline (merged geometry), mission rooftops, props, catwalk, balcony
    rooftop.js          The player's rooftop: parapet, antenna + flag, vents, pipes, clutter
    ambient.js          Clouds, birds, dust, flags, beacons, street traffic
    textures.js         Canvas-generated facade/concrete/cloud textures, seeded RNG
  entities/
    models.js           Low-poly hostile / civilian / drone models + hitboxes
    targets.js          Patrol routes, AI (pauses, cover, startle/panic), target manager
  player/
    controls.js         Pointer lock + drag fallback, scope, sway, breath hold, movement
    weapon.js           Ammo, reload, bolt cycle, bullet arc raycast, miss analysis
    viewmodel.js        First-person rifle (separate render pass), recoil/reload animation
  fx/effects.js         Sparks, dust, smoke, tracers
  audio/audio.js        WebAudio-synthesised wind, shot, bolt, reload, hit, alarm, UI sounds
  ui/hud.js             HUD updates, ID panel, hold mark, feed, warnings
  ui/screens.js         Menu screens and button wiring
```

## Known limitations

- Pointer lock depends on the browser. Some embedded or preview browsers refuse it, and the game then falls back to drag-to-aim.
  In pointer-lock mode the on-screen **AIM** button can't be clicked because the cursor is hidden, so use right click.
- The ballistics are deliberately simple: constant-velocity travel time, gravity drop and linear wind drift.
- There is one mission. Target routes are hand-authored, and the starting positions and timings are randomised each run.
- Characters are low-poly primitives with simple procedural animation (no skeletal rigs).
- Desktop mouse and keyboard only. The layout adapts to small windows, but there are no touch controls.
