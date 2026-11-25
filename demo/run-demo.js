'use strict';

// Local verification for the playback-position-driven background cycle.
//
// Runs a scripted "tape deck" against the demo SKINS folder and prints the
// background color after every operation, so the four required behaviors can
// be observed without a PSP:
//   1. pause      -> while=playing snaps to the first color
//   2. new track  -> the cycle restarts at the first color
//   3. scrub      -> the color jumps to the new position immediately
//   4. skin switch-> skin.json is re-read; phase continues from the position
// Also demonstrates while=always holding its color, step blend, flat colors
// and the two failure modes (illegal colors, broken JSON).
//
// Run: npm run demo   (or: node demo/run-demo.js)

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SkinLibrary, renderDeckFrame } from '../src/deck.js';
import { Player } from '../src/player.js';
import { backgroundHex } from '../src/background.js';

const here = dirname(fileURLToPath(import.meta.url));
const SKINS = join(here, 'SKINS');

const TRACKS = [
  { id: 't1', title: 'Technique', artist: 'New Order', album: 'Technique', folder: 'Synth' },
  { id: 't2', title: 'A Very Long Title That Must Shrink And Then Truncate Inside Its Area', artist: null, album: 'B-sides', folder: 'Rarities' },
  { id: 't3', title: 'Closer', artist: 'Joy Division', album: null, folder: 'Post-punk' },
];

function hr(title) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function show(label, lib, player) {
  const frame = renderDeckFrame(lib, player.snapshot());
  const pb = player.snapshot();
  const hex = backgroundHex(lib.skin.background, pb);
  const labelText = frame.areas
    .flatMap((a) => a.rendered.map((l) => l.text))
    .join(' | ') || '(no text)';
  console.log(
    `${label.padEnd(34)} status=${pb.status.padEnd(7)} pos=${String(
      pb.positionSeconds.toFixed(2),
    ).padStart(7)}s  bg=${hex}  text="${labelText}"`,
  );
  return hex;
}

async function main() {
  const lib = new SkinLibrary(SKINS);
  await lib.discover();
  console.log(`Skins found in ${SKINS}:`);
  for (const name of lib.names) console.log('  - ' + name);

  const player = new Player();
  const queueInfo = { position: '1/3' };

  // ----------------------------------------------------------------------
  hr('1. PLAYING + PAUSE  (Cycler Fade: red -> green -> blue, 6s segments, while=playing)');
  await lib.select('Cycler Fade');
  player.play(TRACKS[0], 300);
  player.tick(3);
  show('playing 3s (mid red->green)', lib, player);
  player.tick(3);
  show('playing 6s (exactly green)', lib, player);
  player.tick(3);
  show('playing 9s (mid green->blue)', lib, player);
  const pausedHex = (() => {
    player.pause();
    return show('PAUSE -> must snap to first #FF0000', lib, player);
  })();
  console.assert(pausedHex === '#FF0000', 'pause did not return to the first color');
  player.tick(8); // wall clock passes while paused
  show('8 wall-seconds later, still paused', lib, player);
  player.resume();
  show('RESUME -> continues from 9s position', lib, player);

  // ----------------------------------------------------------------------
  hr('2. TRACK CHANGE  (phase resets to zero on every new track)');
  player.tick(5); // 14s into track 1
  show('track 1 at 14s', lib, player);
  player.play(TRACKS[1], 300); // next track starts at 0
  const newTrackHex = show('next track starts -> first color again', lib, player);
  console.assert(newTrackHex === '#FF0000', 'new track did not reset the phase');
  player.tick(6);
  show('new track at 6s -> green again', lib, player);

  // ----------------------------------------------------------------------
  hr('3. SCRUB  (phase follows the dragged position on the next frame)');
  player.seek(16);
  show('scrub 6s -> 16s (2/3 through blue->red)', lib, player);
  player.seek(0.5);
  show('scrub back to 0.5s (near red)', lib, player);
  player.pause();
  show('paused after scrub -> first color', lib, player);
  player.resume();

  // ----------------------------------------------------------------------
  hr('4. SKIN SWITCH  (re-reads skin.json; phase computed from current position)');
  player.seek(9);
  show('back on Cycler Fade at 9s', lib, player);
  await lib.step('next'); // -> Flat Blue
  show('switch to Flat Blue (flat color, no cycle)', lib, player);
  await lib.step('next'); // -> Hold Always
  show('switch to Hold Always at 9s (while=always)', lib, player);
  player.pause();
  const heldHex = show('Hold Always PAUSED -> keeps reached color', lib, player);
  console.assert(heldHex !== '#1B0B3A', 'while=always should not return to the first color');
  player.resume();
  await lib.step('next'); // -> Stepper
  show('switch to Stepper (step blend, 2s segments)', lib, player);
  player.seek(5);
  show('Stepper scrubbed to 5s -> discrete color', lib, player);
  await lib.select('Cycler Fade'); // switch back: phase continues from 5s
  const backHex = show('switch back to Cycler Fade at 5s', lib, player);
  const expected = backgroundHex(lib.skin.background, {
    status: 'playing',
    positionSeconds: 5,
  });
  console.assert(backHex === expected, 'returning skin did not continue from the position');

  // Re-read proof: mutate a skin.json while another skin is selected.
  hr('5. RE-READ AFTER EDIT  (up/down then back picks up a changed skin.json)');
  await lib.select('Stepper');
  const target = join(SKINS, 'Stepper', 'skin.json');
  const { writeFile, readFile } = await import('node:fs/promises');
  const original = await readFile(target, 'utf8');
  await writeFile(
    target,
    JSON.stringify({ background: { colors: ['#000000', '#FFFFFF'], seconds: 1, blend: 'step' } }),
  );
  await lib.step('next'); // away from Stepper
  await lib.select('Stepper'); // back: file must be re-read
  show('Stepper after on-disk edit (now black/white 1s)', lib, player);
  console.assert(lib.skin.background.seconds === 1, 'edited skin.json was not re-read');
  await writeFile(target, original); // restore the sample
  await lib.reload();

  // ----------------------------------------------------------------------
  hr('6. FAILURE MODES  (illegal colors ignored; broken JSON -> no text, black)');
  await lib.select('Bad Colors');
  show('all-illegal colors -> black flat background', lib, player);
  console.assert(
    renderDeckFrame(lib, player.snapshot()).background.r === 0 &&
      lib.skin.background.kind === 'flat',
    'illegal colors were not ignored',
  );
  await lib.select('Broken JSON');
  const brokenFrame = renderDeckFrame(lib, player.snapshot());
  show('broken JSON -> skin loads, no text, black', lib, player);
  console.assert(brokenFrame.areas.length === 0, 'broken JSON produced text areas');

  // ----------------------------------------------------------------------
  hr('7. LABEL FIELDS  (missing fields drop their separators; long titles fit)');
  await lib.select('Cycler Fade');
  player.play(TRACKS[1], 300); // no artist
  show('track with no artist (separator dropped)', lib, {
    snapshot: () => ({ ...player.snapshot(), track: TRACKS[1] }),
  });
  player.play(TRACKS[2], 300); // no album
  show('track with no album (separator dropped)', lib, {
    snapshot: () => ({ ...player.snapshot(), track: TRACKS[2] }),
  });

  console.log('\nAll assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
