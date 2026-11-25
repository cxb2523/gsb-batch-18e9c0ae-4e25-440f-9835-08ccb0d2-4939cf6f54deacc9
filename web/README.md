# The browser client

What runs on the phone. How it fits together is in [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), section 2.1.

| Path | Job |
|---|---|
| `tta-ui.js`, `tta-ui.css` | The page shell: sign-in, loading and download, touch controls, rotate and install screens, recovery cards, test-session logging |
| `tta-audio.js` | Sound through the Web Audio API |
| `icon-*.png`, `icons/` | Home Screen icons, and the Discord and Reddit button pictures |
| `game/` | The Python glue that starts Open Toontown in the browser (`main.py` and helpers) |
| `make_ot_packs.py` | Builds the download packs and `packs.json` |
| `patch_web.py` | Adds the shell, manifest and icons to the page pygbag builds |
| `ot_server.py`, `bridge_ot.py` | A small local test server and WebSocket bridge for development |
| `NOTICE.txt` | The licence notice packed into the code pack |

Not in the repository: the game's art, sound and data (your Open Toontown `resources/`), the `_ui/` pictures the page
uses (`background.jpg` for the sky and the Toon font `ToonDisplay.ttf`; the page works without them, with a plain
background and system fonts) and an optional `logo.png`.

## Build

1. Install [pygbag](https://github.com/pygame-web/pygbag) (the live site uses CDN version 0.9.3) and `pytz`.
2. Build the page from the glue code:

   ```
   pygbag --build web/game          # makes web/game/build/web/
   python web/patch_web.py auto     # "auto": the page connects to wss://<its own site>/ws
   ```

   For a local test use `python web/patch_web.py ws://localhost:8766` instead.
3. Build the packs from your patched Open Toontown checkout:

   ```
   OT_DIR=/path/to/open-toontown python web/make_ot_packs.py      # makes web/build/site/
   ```

4. Put the files where the server serves them (`$ROOT/web`, see [the operations notes](../docs/OPERATIONS.md)):
   `web/game/build/web/*` to `_play/`, `web/build/site/*` to `root/`, and your `_ui/` folder into both `_play/` and `root/`.

## Try it locally

```
python web/ot_server.py 8002 0.0.0.0     # serves the page and packs, and accepts any sign-in
python web/bridge_ot.py                  # WebSocket on 8766 to a local Astron client agent on 7198
```

Run Astron, the UberDOG and a district from your Open Toontown checkout as usual, then open `http://<this machine>:8002`
on the phone. (The game fetches its Python runtime from a local address when the page is served from `localhost`, so use
the machine's network address, not `localhost`.)

### Running the client on your own machine, start to finish

The browser client talks to a game server, so you need both. The server side is in
[open-toontown-anywhere/docker/README.md](https://github.com/lPuffyy/open-toontown-anywhere/blob/anywhere/docker/README.md).

1. Start the server (the Docker image is the easiest way) and wait until `ai1.log` to `ai3.log` in its data folder end with `Done.`.
   The image already includes the sign-in service and the WebSocket bridge behind nginx on port 80, so with it you can skip
   `bridge_ot.py`, and serve the page and packs from the container's `/ot/web` folder.
2. Build the page and packs (the Build section above), then serve them.
3. Open the page by the machine's **network address** (for example `http://192.168.1.20:8002`), not `localhost` or `127.0.0.1`.
4. Use `patch_web.py auto` when the page and the WebSocket come from the same address (the Docker image's nginx does this), or
   `patch_web.py ws://<address>:8766` when the bridge is separate.

### If the page never gets past the spinner

Open the browser's developer console and look for the Python error.

- `ModuleNotFoundError: No module named 'tarfile'`: the page was opened on `localhost`. The browser's Python has no `tarfile`
  module, and on `localhost` the page tries to unpack a `.tar.gz`. Open it by the machine's network address instead. (The build also
  produces a ZIP `.apk` of the same game files, which the browser can unpack; the `.tar.gz` is not needed in the browser.)
- A blank page with a 404 for `packs.json` or `_code.zip`: the packs were not built or not placed in the folder the page is served from.
- The page loads but sign-in fails: the page's WebSocket address (the `patch_web.py` argument) does not match where the bridge is.

