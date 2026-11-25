import { audio } from '../audio/audio.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'title', 'briefing', 'pause', 'results', 'error'];

// Menu screens and their buttons. Every button here is wired to a game action.
export class Screens {
  constructor(game) {
    this.game = game;
    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        audio.init();
        audio.ui();
        fn();
      });

    click('btn-start', () => game.showBriefing());
    click('btn-brief-back', () => game.showTitle());
    click('btn-begin', () => game.startMission());
    click('btn-resume', () => game.resume(true));
    click('btn-restart', () => game.startMission());
    click('btn-controls', () => $('pause-controls').classList.toggle('hidden'));
    click('btn-quit', () => game.showTitle());
    click('btn-replay', () => game.startMission());
    click('btn-res-title', () => game.showTitle());
    click('btn-audio-title', () => game.toggleAudio());
    click('btn-audio-pause', () => game.toggleAudio());

    // The in-HUD AIM button toggles the scope without firing.
    const aim = $('btn-aim');
    aim.addEventListener('mousedown', (e) => e.stopPropagation());
    aim.addEventListener('click', (e) => {
      e.stopPropagation();
      if (game.state === 'playing') game.controls.toggleScope();
    });

    const sens = $('sens');
    const out = $('sens-val');
    sens.value = String(game.settings.sensitivity);
    out.textContent = Number(sens.value).toFixed(2);
    sens.addEventListener('input', () => {
      game.settings.sensitivity = Number(sens.value);
      out.textContent = game.settings.sensitivity.toFixed(2);
      game.saveSettings();
    });
    this.syncAudio();
  }

  show(name) {
    for (const s of SCREENS) $(`screen-${s}`).classList.toggle('show', s === name);
    if (name === 'pause') $('pause-controls').classList.add('hidden');
    this.syncAudio();
  }

  hideAll() {
    this.show(null);
  }

  syncAudio() {
    const label = `AUDIO: ${audio.enabled ? 'ON' : 'OFF'}`;
    $('btn-audio-title').textContent = label;
    $('btn-audio-pause').textContent = label;
  }

  results({ success, reason, score, kills, required, civHits, accuracy, timeLeft }) {
    const title = $('res-title');
    title.textContent = success ? 'MISSION SUCCESS' : 'MISSION FAILED';
    title.className = success ? 'success' : 'fail';
    $('res-reason').textContent = reason;
    $('res-score').textContent = score.toLocaleString('en-US');
    $('res-kills').textContent = `${kills} / ${required}`;
    $('res-civ').textContent = String(civHits);
    $('res-acc').textContent = `${Math.round(accuracy * 100)}%`;
    const t = Math.max(0, Math.ceil(timeLeft));
    $('res-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.show('results');
  }

  error(msg) {
    $('error-text').textContent = msg;
    this.show('error');
  }
}
