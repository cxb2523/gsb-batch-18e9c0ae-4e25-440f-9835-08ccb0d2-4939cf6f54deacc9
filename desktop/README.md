# Toontown: Anywhere for Windows and Linux

The app is the website's own WASM build in a full-screen-capable window (Electron). It opens `<server>/play/?install=0`; the page downloads and
caches the game files itself, exactly as it does in a browser or as a Home Screen app, so **a fix to the website is a fix to this app**. Nothing
about the game lives here: no Python, no Panda3D, no game files.

## What the app does itself

- Opens the window (size, position and full-screen state are remembered), **F11** or **Alt+Enter** switches full screen.
- Keeps links to other sites out of the window (they open in the browser), shows a plain "No connection. Trying again..." note and retries, and
  starts the page again if its process is ended.
- Keeps the screen awake while it runs. Controllers work through the browser's own gamepad support, as on the website.
- Updates itself (`updater.js`): reads `windows.json` / `linux.json` from the newest GitHub release, checks the Ed25519 signature against the
  public key in `updatekey.js`, downloads the file named there, checks its size and SHA-256, and installs it for the next start.
- Windows: `TTAnywhere.exe --uninstall [--silent]` removes the app (Setup registers it in Windows' app list). On the first start over the older
  Python-based app it removes that program's leftover files (`_internal`, the old `game` download folder).

Switches: `--server URL` (or environment `TTA_SERVER`) opens another server, for example the test instance; `--selftest` (CI) loads the page,
writes the result to the file named in `TTA_SELFTEST_OUT` and quits.

## Files

| File | Job |
|---|---|
| `main.js` | The window and everything above. |
| `updater.js`, `updatekey.js` | The signed self-update. |
| `uninstall.js` | Windows uninstall. |
| `installer.py` | The Windows setup program (tkinter, built with PyInstaller by `tools/build_installer.py`): installs the app zip for the current user into `%LOCALAPPDATA%\Programs\TTAnywhere`, adds shortcuts and the app-list entry. |
| `tools/build.js` | Packages the app (`win`: `@electron/packager`, a folder with `TTAnywhere.exe`; `linux`: `electron-builder`, an AppImage). |
| `tools/make_zip.py` | Zips the Windows folder as `TTAnywhere/...`, the layout the updater and Setup expect. |
| `tools/sign_tool.py` | Makes the signing key and the signed update lists. |
| `tools/check_spec.py` | CI check for the web app's embedded settings spec. |

## Run and build it

```
cd desktop
npm install
npm start                          # runs it from source; add -- --server http://192.168.40.134:7381 for the test instance
node tools/build.js win            # -> out/TTAnywhere-win32-x64/TTAnywhere.exe   (Windows)
node tools/build.js linux          # -> out/TTAnywhere-<version>-x86_64.AppImage  (Linux)
```

The version number is the `VERSION` file in the repository root. `assets/icon.png` (window and Linux icon) is drawn by
`python ios/panda_ios/make_icon.py <dir>` (copy `AppIcon-1024.png`); the release workflow does this.

Releases: see [RELEASING.md](RELEASING.md).
