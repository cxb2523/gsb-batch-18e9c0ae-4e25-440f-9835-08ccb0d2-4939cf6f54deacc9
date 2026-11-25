# Claude Opus 5.5 Games

Three browser games built with **Claude Opus 5.5** and **three.js**. There is nothing to install: open a link and play.

### ▶ Play online: https://promptengineer48.github.io/claude-opus-5.5-games/

| Game | Genre | Play |
| --- | --- | --- |
| **Neon Siege** | Sci-fi arena shooter | [Play](https://promptengineer48.github.io/claude-opus-5.5-games/neon-siege/) · [Source](neon-siege/) |
| **Mortal Clash** | 1v1 fighting game | [Play](https://promptengineer48.github.io/claude-opus-5.5-games/mortal-clash/) · [Source](mortal-clash/) |
| **Rooftop Sniper: Last Light** | First-person sniper | [Play](https://promptengineer48.github.io/claude-opus-5.5-games/rooftop-sniper/offline/index.html) · [Source](rooftop-sniper/) |

All three are best on a desktop or laptop with keyboard and mouse, in Chrome or Edge.

---

## Neon Siege

Fight waves of robots in a neon arena. Dash through bots, raise your shield to send their bolts back at them, and pick up heavier weapons to keep up. An Overseer boss arrives every 5th wave.

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Aim |
| Left click (hold) | Fire |
| `Space` / `Shift` | Dash. You can't be hit during it, and it damages bots you pass through |
| Right click / `E` (hold) | Shield. Reflects enemy bolts, but you can't fire while it's up |
| `1`–`5` / mouse wheel / `Q` | Switch weapon |
| `Esc` / `P` | Pause |
| `F` | Fullscreen |
| `M` / `B` | Music on/off / graphics quality |

- **Weapons:** Blaster (unlimited ammo), Scatter, Pulse Rifle, Rail Lance (hits everything in a line) and Nova Launcher (explosive rockets).
- **Robots:** Skitter, Gunner, Volt Bomber, Lancer, Brute, and the Overseer boss.
- Kill streaks build a score multiplier up to x8. Gamepads work too.
- If it stutters, press `B` to lower the graphics quality.

## Mortal Clash

A 1v1 fighting game: you against a CPU opponent. Pick a fighter and a difficulty, then fight it out over several rounds.

| Input | Action |
| --- | --- |
| `A` / `D` | Move (and choose a fighter on the select screen) |
| `W` / `S` | Jump / crouch (and choose difficulty on the select screen) |
| `J` | Punch (press twice, then `K`, for a combo) |
| `K` | Kick |
| `L` | Block |
| `I` | Special |
| `S` + `J` / `S` + `K` | Uppercut / sweep |
| `Enter` | Start / confirm |
| `P` / `Esc` | Pause / back to menu |

## Rooftop Sniper: Last Light

A first-person sniper mission at sunset over a procedurally generated city. Scope in, tell armed spotters from civilians, correct for bullet drop and wind, and take out 5 hostiles within 3 minutes.

| Input | Action |
| --- | --- |
| Mouse | Aim |
| Left click | Fire |
| Right click | Scope in / out |
| Mouse wheel / `Q` / `E` | Scope zoom |
| `Shift` (hold, scoped) | Hold breath to steady the scope |
| `R` | Reload |
| `W A S D` | Move along the parapet |
| `Esc` / `H` / `M` | Pause / help / mute |

See [rooftop-sniper/README.md](rooftop-sniper/README.md) for the full mission rules and how to tell hostiles from civilians.

---

## Run locally

Clone or download the repo:

```bash
git clone https://github.com/PromptEngineer48/claude-opus-5.5-games.git
```

- **Neon Siege** and **Mortal Clash** are single HTML files. Double-click `neon-siege/index.html` or `mortal-clash/index.html`.
  You need an internet connection, because three.js and the fonts load from a CDN. Mortal Clash also streams its character models from there.
- **Rooftop Sniper** works fully offline. Double-click `rooftop-sniper/offline/index.html`.
  To work on the source instead, run `npm install` and then `npm start` inside `rooftop-sniper/` (needs Node.js 18+). On Windows you can double-click `PLAY.bat`.

## Credits

- [three.js](https://threejs.org) (MIT) for all 3D rendering.
- Mortal Clash loads its character models (`Soldier`, `Xbot`, `Michelle`, `readyplayer.me`) at runtime from the
  [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf). They are not included in this repo, and each is under its own license.
- All sound effects and music are generated in code with the Web Audio API. There are no audio files.
