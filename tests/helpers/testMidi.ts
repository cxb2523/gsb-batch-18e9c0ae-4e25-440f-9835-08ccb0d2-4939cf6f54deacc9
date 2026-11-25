import { Midi } from '@tonejs/midi';

export interface TestTrackSpec {
  channel: number;
  name: string;
  notes: Array<{ midi: number; time: number; duration: number; velocity?: number }>;
}

/**
 * Build an in-memory MIDI file (as ArrayBuffer) with the given tracks.
 * Mirrors the multi-track shape the player sees from real files: drums on
 * channel 9, a long-note bass track, and melodic/harmony tracks.
 */
export function buildTestMidi(tracks: TestTrackSpec[], bpm = 120): ArrayBuffer {
  const midi = new Midi();
  midi.header.setTempo(bpm);

  for (const spec of tracks) {
    const track = midi.addTrack();
    track.channel = spec.channel;
    track.name = spec.name;
    for (const note of spec.notes) {
      track.addNote({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity ?? 0.8,
      });
    }
  }

  return midi.toArray();
}

/**
 * A representative arrangement: percussion (channel 9), long bass notes,
 * a lead melody and a chordal harmony part, spread over ~12 seconds.
 */
export function buildMultiTrackMidi(): ArrayBuffer {
  const bpm = 120;
  const beat = 60 / bpm;

  const drums: TestTrackSpec['notes'] = [];
  const bass: TestTrackSpec['notes'] = [];
  const lead: TestTrackSpec['notes'] = [];
  const harmony: TestTrackSpec['notes'] = [];

  for (let bar = 0; bar < 6; bar++) {
    const barStart = bar * 4 * beat;
    // Kick on beats 1 and 3, snare-ish hit on 2 and 4, hats every beat.
    drums.push({ midi: 36, time: barStart, duration: 0.12, velocity: 1 });
    drums.push({ midi: 38, time: barStart + beat, duration: 0.1, velocity: 0.9 });
    drums.push({ midi: 36, time: barStart + 2 * beat, duration: 0.12, velocity: 1 });
    drums.push({ midi: 40, time: barStart + 3 * beat, duration: 0.08, velocity: 0.8 });
    for (let b = 0; b < 4; b++) {
      drums.push({ midi: 42, time: barStart + b * beat, duration: 0.05, velocity: 0.6 });
    }
    // Long bass notes (one per bar) to exercise the wave channel.
    bass.push({ midi: 36 + (bar % 2) * 5, time: barStart, duration: 4 * beat, velocity: 0.9 });
    // A simple lead phrase.
    const scale = [60, 62, 64, 67, 69, 72, 69, 67];
    for (let step = 0; step < 8; step++) {
      lead.push({
        midi: scale[(step + bar) % scale.length],
        time: barStart + step * beat / 2,
        duration: beat / 2 * 0.9,
        velocity: 0.85,
      });
    }
    // Block chords on the bar line for the arpeggiator path.
    for (const midi of [52, 55, 59]) {
      harmony.push({ midi, time: barStart, duration: 2 * beat, velocity: 0.7 });
    }
  }

  return buildTestMidi([
    { channel: 0, name: 'Lead', notes: lead },
    { channel: 1, name: 'Harmony', notes: harmony },
    { channel: 2, name: 'Bass', notes: bass },
    { channel: 9, name: 'Drums', notes: drums },
  ], bpm);
}
