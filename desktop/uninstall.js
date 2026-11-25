'use strict';
// Removes the installed app (Windows): the Start menu and desktop shortcuts, the entry in Windows' app list, the program folder and (if the
// player says so) the downloaded game files and settings. Run as `TTAnywhere.exe --uninstall` (the app list's Uninstall button does this).
const { app, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TTAnywhere';
const SHORTCUT_NAME = 'Toontown Anywhere.lnk';

function run(silent, dataRoot) {
  const appDir = path.dirname(process.execPath);
  let keepData = true;
  if (!silent) {
    const r = dialog.showMessageBoxSync({
      type: 'question', buttons: ['Keep my game files', 'Delete everything'], defaultId: 0, cancelId: 0,
      title: 'Uninstall Toontown: Anywhere',
      message: 'Also delete the downloaded game files and your saved settings (about 1 GB)?',
      detail: 'Keep them if you plan to reinstall later.',
    });
    keepData = r === 0;
  }
  const shortcuts = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_NAME),
    path.join(process.env.USERPROFILE || '', 'Desktop', SHORTCUT_NAME),
  ];
  for (const p of shortcuts) { try { fs.rmSync(p, { force: true }); } catch (e) { /* not there */ } }
  spawnSync('reg', ['delete', REG_KEY, '/f'], { windowsHide: true });
  // the program folder holds this running program, so a script removes it once this program has closed
  const bat = path.join(process.env.TEMP || os.tmpdir(), 'tta-uninstall.bat');
  const lines = ['@echo off', 'powershell -NoProfile -Command "try { Wait-Process -Id ' + process.pid + ' -Timeout 60 } catch {}"', 'rmdir /S /Q "' + appDir + '"'];
  if (!keepData) lines.push('rmdir /S /Q "' + dataRoot + '"');
  lines.push('del "%~f0"');
  fs.writeFileSync(bat, lines.join('\r\n') + '\r\n');
  spawn('cmd', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  if (!silent) dialog.showMessageBoxSync({ type: 'info', title: 'Uninstall', message: 'Toontown: Anywhere has been removed.' });
  app.exit(0);
}

module.exports = { run };
