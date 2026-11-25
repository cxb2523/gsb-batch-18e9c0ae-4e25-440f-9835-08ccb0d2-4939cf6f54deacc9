'use strict';
// electron-builder hook (Linux): the program inside the AppImage becomes a small launcher that starts the real one with --no-sandbox. An AppImage
// cannot ship Chromium's setuid sandbox helper, and many systems (Ubuntu 24.04, for one) refuse the unprivileged alternative, so without this the
// app aborts at start. The window only ever shows the game's own site.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const dir = context.appOutDir;
  const exe = path.join(dir, context.packager.executableName);
  fs.renameSync(exe, exe + '.bin');
  fs.writeFileSync(exe, '#!/bin/bash\nHERE="$(dirname "$(readlink -f "$0")")"\nexec "$HERE/' + path.basename(exe) + '.bin" --no-sandbox "$@"\n');
  fs.chmodSync(exe, 0o755);
};
