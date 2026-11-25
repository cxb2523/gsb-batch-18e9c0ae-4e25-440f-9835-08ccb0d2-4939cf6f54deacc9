# Toontown: Anywhere for iPhone and iPad

The app is the website's own WASM build in a full-screen WKWebView (`webwrap/main.m`). It opens `<server>/play/?install=0` and the page downloads
and caches the game files itself, exactly as the Home Screen app does, so a fix to the website is a fix to the app. There is no Python, no Panda3D
and no game file inside it.

- **Build:** `.github/workflows/ios-app.yml` (called by the release workflow, or run by hand for a trial). `webwrap/assemble.sh` compiles `main.m` with
  `xcrun clang` and packs the IPA; the runner label `xcode-27` builds against the real iOS 27 SDK (full-display mode on the iPhone Duo).
- **Ship:** SideStore / AltStore only, never the App Store. The release carries `altstore.json`, written by `panda_ios/make_source.py`; players add
  `https://github.com/lPuffyy/toontown-anywhere/releases/latest/download/altstore.json` once.
- **Screens:** landscape only, status bar and home indicator hidden, edge gestures deferred on every edge. On a two-screen phone (iPhone Duo) the
  scene's screen is not `UIScreen.mainScreen`; `TTARightMargin` keeps the page's buttons out of the strip that does not take taps, through
  `additionalSafeAreaInsets` (the page reads it as `env(safe-area-inset-right)`).
- **Icon:** `panda_ios/make_icon.py` draws it from `panda_ios/icon_source.jpg`; the Android and desktop builds use the same picture.

Release flow for every platform: [../desktop/RELEASING.md](../desktop/RELEASING.md).
