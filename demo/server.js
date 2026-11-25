'use strict';

// Zero-dependency local server for the interactive tape-deck demo.
//
//   npm run serve   ->   http://127.0.0.1:8123/
//
// It serves demo/index.html and exposes the same engine the tests use over a
// tiny JSON API, so the page's colors come straight from src/background.js.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { SkinLibrary, renderDeckFrame } from '../src/deck.js';
import { Player } from '../src/player.js';
import { backgroundHex } from '../src/background.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8123;

const player = new Player();
const library = new SkinLibrary(join(here, 'SKINS'));
await library.discover();
await library.select(library.names.includes('Cycler Fade') ? 'Cycler Fade' : library.names[0]);
player.play(
  { id: 'demo', title: 'Technique', artist: 'New Order', album: 'Technique', folder: 'Synth' },
  240,
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(join(here, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const frame = renderDeckFrame(library, player.snapshot());
      return json(res, {
        skins: library.names,
        selected: library.selectedName,
        playback: player.snapshot(),
        background: backgroundHex(library.skin.background, player.snapshot()),
        frame,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/command') {
      const body = await readJson(req);
      await applyCommand(body);
      const frame = renderDeckFrame(library, player.snapshot());
      return json(res, {
        skins: library.names,
        selected: library.selectedName,
        playback: player.snapshot(),
        background: backgroundHex(library.skin.background, player.snapshot()),
        frame,
      });
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err && err.message) }));
  }
});

async function applyCommand({ command, value }) {
  switch (command) {
    case 'play':
      if (player.status === 'stopped') {
        player.play(player.track ?? { id: 'demo', title: 'Technique' }, player.durationSeconds || 240);
      } else {
        player.resume();
      }
      break;
    case 'pause':
      player.pause();
      break;
    case 'stop':
      player.stop();
      break;
    case 'seek':
      player.seek(Number(value));
      break;
    case 'nextTrack':
      player.play({ id: `t${Date.now()}`, title: 'Next Track', artist: null, album: 'B-sides', folder: 'Queue' }, 240);
      break;
    case 'skin':
      await library.select(String(value));
      break;
    case 'skinStep':
      await library.step(value === 'prev' ? 'prev' : 'next');
      break;
    case 'tick':
      player.tick(Number(value) || 0.1);
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TRAX tape-deck demo running at http://127.0.0.1:${PORT}/`);
});
