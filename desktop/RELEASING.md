# Releasing the apps through GitHub

Every installer and every update is published as a **GitHub release** of this repository (`lPuffyy/toontown-anywhere`). One tag, `vX.Y.Z`,
is one release, and every platform's files for that version are attached to it. Nothing is hosted anywhere else, and the apps find their
updates on GitHub too. Every app is the website's own game in a full-screen window, so most changes never need a release at all: they go out with
the website.

## How a player gets and updates the app

| Platform | First install | Updates |
|---|---|---|
| **Windows** | `https://github.com/lPuffyy/toontown-anywhere/releases/latest/download/TTAnywhere-Setup.exe` | The app reads `windows.json` and `windows.json.sig` from the newest release (`.../releases/latest/download/`), checks the signature, downloads the zip named in the list and swaps it in the next time it closes. |
| **Linux / Steam Deck** | `.../releases/latest/download/TTAnywhere-x86_64.AppImage` (make it executable, run it) | Same signed list, `linux.json`; the AppImage replaces itself. |
| **iPhone / iPad** | Add the SideStore / AltStore source `https://github.com/lPuffyy/toontown-anywhere/releases/latest/download/altstore.json` | The source file lists the newest `.ipa`, so SideStore offers each update. |
| **Android** (APK builds by hand for now) | `TTAnywhere.apk` from a release, or add the repo to Obtainium | Obtainium follows GitHub releases. The APK is signed with one Android key that must never change. |

The game's own code and files (the packs) are **not** part of these releases: they update from the game server's `packs.json`.

## Making a release (every platform from one tag)

1. Raise the number in the `VERSION` file (the one version for every platform), commit and push.
2. Tag the same number and push the tag: `git tag v1.3.2` then `git push origin v1.3.2`.
3. `.github/workflows/native-release.yml` starts a draft release and builds **all platforms** from that commit:
   - **Windows** (Windows runner): packages the Electron app, starts it once as a self-test (it must load the game page), then makes
     `TTAnywhere-Setup-<version>.exe`, `TTAnywhere-Setup.exe` (a name that never changes), `TTAnywhere-<version>-windows.zip` and the signed
     list `windows.json` + `windows.json.sig` (signed with the `TTA_UPDATE_KEY` secret).
   - **Linux** (Ubuntu runner): `TTAnywhere-<version>-x86_64.AppImage` (self-tested under a virtual display), `TTAnywhere-x86_64.AppImage`, and
     `linux.json` + `linux.json.sig`.
   - **iOS** (macOS runner, through `ios-app.yml`): `TTAnywhere-<version>.ipa`, `icon.png` and `altstore.json`.
4. When every build has passed, the draft is published and becomes the latest release. If one build fails nothing is published: fix it and run the
   workflow again for the same tag. Installed apps pick the release up the next time they start.

"Run workflow" in the Actions tab builds everything as a trial, with no release (the Windows and Linux files are kept for 7 days).

### One-time setup

- The update signing key: `python desktop/tools/sign_tool.py keygen KEYFILE` (KEYFILE outside the repo). Put the printed public key in
  `desktop/updatekey.js`, commit, and add the **private** key's contents as the repository secret `TTA_UPDATE_KEY`. **Back the private key up in two
  places.** If it is lost, installed apps can only be moved to a new key by installing a new setup program by hand; if it leaks, anyone can push an
  update. (The key in the repo today is the real release key; its private half is in `tta-signing/`.)

## Android

`android-app.yml` builds the APK by hand (Run workflow). It needs the repository secrets `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASS`
(the permanent Android signing key); without them it signs with a throwaway key, which can never update a real install. Joining the release
workflow, and an Obtainium or F-Droid source, come after the key is in place.

## Known problem: antivirus and SmartScreen warnings

The Windows files are not code-signed, so SmartScreen shows "unknown publisher" (More info, then Run anyway) and an antivirus may flag a new
build. Before a wide release: sign `TTAnywhere.exe` and the setup program with a code-signing certificate (SignPath Foundation signs open-source
projects for free and works from GitHub Actions), and submit each release to Microsoft as a false positive
(<https://www.microsoft.com/wdsi/filesubmission>).
