// Auto Gain — keep the tab at roughly the level it was before you shaped it.
//
// The problem it solves is comparison. Boost four bands and everything gets louder, and louder
// reads as better whether or not the curve is any good; the honest way to judge an EQ is at
// matched level. So this subtracts what the curve added.
//
// TWO THINGS IT IS DELIBERATELY NOT.
//
// It is not a limiter. Nothing here looks at the signal — it is arithmetic on the band settings,
// computed in the popup, and costs nothing at audio rate.
//
// It is not stored. `outputGain` renders what to SEND to the engine; the user's own master volume
// is what gets written, unchanged. That matters more than it looks: turning Auto Gain on must not
// rewrite a single saved profile, and if the compensated value were ever fed back in as the stored
// one, every message would duck the tab a little further.
//
// WHY THE AVERAGE AND NOT THE PEAK. One band lifted 11 dB out of eleven is not an 11 dB louder
// track. Peak-matching would duck the whole tab for a single narrow boost, which is a worse answer
// than not compensating at all. The bands are roughly evenly spaced in log frequency, so a plain
// mean of their gains is a fair stand-in for the average lift across the spectrum, at a fraction
// of the cost of evaluating the actual response.
//
// Band and master gains use amplitude dB, so compensation uses the same scale. Existing saved
// linear gains are unchanged; correcting the displayed master scale does not change their sound.

import { clampMasterGain, dbToMasterGain, masterGainToDb, type Band } from './audio';

/** Off until asked for. A feature that changes how everything sounds does not arrive switched on. */
export const AUTO_GAIN_DEFAULT = false;

/** How much level the curve adds, in amplitude dB. Positive when the EQ boosts. */
export function compensationDb(bands: Band[]): number {
  if (!bands.length) return 0;
  return bands.reduce((sum, b) => sum + b.gain, 0) / bands.length;
}

/**
 * The master gain to hand the engine — never the one to store.
 *
 * With Auto Gain off this returns the caller's own number, identically: switching the feature on
 * should be the only thing that changes the sound.
 */
export function outputGain(input: { userGain: number; bands: Band[]; on: boolean }): number {
  if (!input.on) return input.userGain;
  const comp = compensationDb(input.bands);
  if (comp === 0) return input.userGain;
  return clampMasterGain(dbToMasterGain(masterGainToDb(clampMasterGain(input.userGain)) - comp));
}

/**
 * The master gain a tab should actually PLAY: the one place Bypass and Auto Gain meet.
 *
 * They used to be two paths that each computed their own level. Auto Gain subtracted the curve's
 * average lift from the master; Bypass worked around it by substituting a flat curve, whose
 * compensation happens to be zero. That agreement was incidental — it held only while every
 * caller remembered the substitution, and a later push that passed the real curve while bypassed
 * would quietly reintroduce the duck the user was trying to compare against.
 *
 * So bypass is an argument, not a trick played on the curve:
 *
 *   bypassed  the equalizer is out of the path, so nothing is being lifted and there is nothing
 *             to compensate — the tab hears the user's own volume, identically, whatever the
 *             curve and whatever Auto Gain is set to.
 *   otherwise the user's volume, with the curve's average lift subtracted when Auto Gain is on.
 *
 * `userGain` is always the STORED/edited master. The result is a message payload and must never
 * be fed back into storage; see outputGain's note about the drift that causes.
 */
export function engineGain(input: { userGain: number; bands: Band[]; on: boolean; bypassed: boolean }): number {
  if (input.bypassed) return input.userGain;
  return outputGain(input);
}
