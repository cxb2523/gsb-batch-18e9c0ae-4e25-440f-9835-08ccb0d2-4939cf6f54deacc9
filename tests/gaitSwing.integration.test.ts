import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultConfig } from '../src/index.ts';
import type { Side } from '../src/rig/HumanRig.ts';
import { createWorld, DEG, simulate } from './helpers/sim.ts';

const SIDES: readonly Side[] = ['left', 'right'];

/**
 * Recorre la simulación frame a frame y, por cada pie, registra cada swing (desde el primer frame en SWING
 * hasta el último): si el estado salta, si la duración bloqueada o el duty cambiaron en el aire, y si el
 * FootTarget que se movía era coherente con el progreso de fase del GaitController.
 */
interface SwingRecord {
  side: Side;
  frames: number;
  stateJumps: number;
  durationChanges: number;
  dutyChanges: number;
  lockedDuration: number;
  lockedFrequency: number;
  lockedDuty: number;
  /** Máxima diferencia entre el progreso del swing del gait y el t guardado en el FootTarget. */
  maxProgressMismatch: number;
  /** Diferencia (m, horizontal) entre el punto de aterrizaje planeado y donde el pie apoya de verdad. */
  landingError: number;
}

function collectSwings(
  world: ReturnType<typeof createWorld>,
  seconds: number,
  start = 0,
  script: Parameters<typeof simulate>[2] = [],
): SwingRecord[] {
  const { human } = world;
  const gait = human.locomotion.gait;
  const records: SwingRecord[] = [];
  const active = new Map<Side, SwingRecord>();
  const previousState = new Map<Side, string>();
  const previousDuty = new Map<Side, number>();
  const previousDuration = new Map<Side, number>();
  // Punto de aterrizaje planeado durante el swing, para compararlo con el apoyo real al aterrizar.
  const plannedLanding = new Map<Side, { x: number; z: number }>();

  simulate(world, seconds, script, {
    start,
    onFrame: () => {
      if (human.airborne) return; // los saltos tienen su propia lógica de pies en el aire
      for (const side of SIDES) {
        const foot = human.locomotion.feet[side];
        const state = foot.phase;
        const was = previousState.get(side);
        if (state === 'SWING') {
          let rec = active.get(side);
          if (!rec) {
            rec = {
              side,
              frames: 0,
              stateJumps: 0,
              durationChanges: 0,
              dutyChanges: 0,
              lockedDuration: gait.footSwingDuration(side),
              lockedFrequency: gait.footStepFrequency(side),
              lockedDuty: gait.duty[side],
              maxProgressMismatch: 0,
              landingError: 0,
            };
            active.set(side, rec);
            records.push(rec);
            previousDuty.set(side, gait.duty[side]);
            previousDuration.set(side, rec.lockedDuration);
          }
          rec.frames++;
          // Un pie que ya estaba en SWING no puede pasar por otro estado y volver.
          if (was !== undefined && was !== 'SWING' && was !== 'LIFT') rec.stateJumps++;
          if (gait.footSwingDuration(side) !== previousDuration.get(side)) rec.durationChanges++;
          if (gait.duty[side] !== previousDuty.get(side)) rec.dutyChanges++;
          previousDuration.set(side, gait.footSwingDuration(side));
          previousDuty.set(side, gait.duty[side]);
          // El t del FootTarget lo escribe el GaitController con su swingProgress: deben coincidir.
          rec.maxProgressMismatch = Math.max(rec.maxProgressMismatch, Math.abs(foot.swing.t - gait.swingProgress(side)));
          plannedLanding.set(side, { x: foot.swing.landing.x, z: foot.swing.landing.z });
        } else if (active.has(side)) {
          // Aterrizó: el pie apoya donde el planificador proyectó con la duración de swing bloqueada.
          const planned = plannedLanding.get(side);
          const rec = active.get(side)!;
          if (planned) rec.landingError = Math.hypot(foot.planted.x - planned.x, foot.planted.z - planned.z);
          active.delete(side);
          plannedLanding.delete(side);
        }
        previousState.set(side, state);
      }
    },
  });
  return records;
}

function assertSwingInvariants(records: SwingRecord[]): void {
  assert.ok(records.length > 0, 'no se registró ningún swing');
  for (const rec of records) {
    assert.equal(rec.stateJumps, 0, `${rec.side}: el estado cambió a media fase (${rec.frames} frames)`);
    assert.equal(rec.durationChanges, 0, `${rec.side}: la duración del swing se recalculó en el aire`);
    assert.equal(rec.dutyChanges, 0, `${rec.side}: el duty cambió con el pie en el aire`);
    assert.ok(rec.lockedDuration > 0, `${rec.side}: swing sin duración bloqueada`);
    assert.ok(rec.lockedFrequency > 0, `${rec.side}: swing sin frecuencia bloqueada`);
    assert.ok(
      Math.abs(rec.lockedDuration - (1 - rec.lockedDuty) / rec.lockedFrequency) < 1e-9,
      `${rec.side}: duración bloqueada inconsistente con su duty`,
    );
    assert.ok(rec.maxProgressMismatch < 1e-9, `${rec.side}: el progreso del FootTarget no sigue la fase del gait`);
    // El punto de apoyo coincide con el que el FootstepPlanner proyectó al despegar (fase y plan alineados).
    assert.ok(rec.landingError < 1e-9, `${rec.side}: aterrizó a ${rec.landingError.toFixed(4)} m del punto planeado`);
  }
}

describe('locomoción integrada: fase, duty y plan de paso comparten cadencia y swing', () => {
  it('acelera desde parado cruzando runStartSpeed hasta correr sin estados de pie en el aire', () => {
    const world = createWorld({ human: { config: { variation: 0 } } });
    const { human } = world;
    simulate(world, 1.5, [[0, (h) => { h.targetSpeed = defaultConfig.runSpeed; }]]);
    assert.ok(human.runBlend > 0, 'no llegó a mezclar carrera');
    const records = collectSwings(world, 3, 1.5);
    assertSwingInvariants(records);
  });

  it('frena a caminar a mitad de un swing de carrera: el swing en curso no se altera', () => {
    const world = createWorld({ human: { config: { variation: 0 } } });
    const { human } = world;
    simulate(world, 3, [[0, (h) => { h.targetSpeed = defaultConfig.runSpeed; }]]);
    assert.ok(human.runBlend > 0.9, 'no estaba corriendo antes de frenar');
    // Frena de golpe a velocidad de caminar: los pies que estén en el aire en ese instante conservan su swing.
    human.targetSpeed = defaultConfig.walkSpeed;
    const braking = collectSwings(world, 2.5, 3);
    assertSwingInvariants(braking);
    assert.ok(braking.some((r) => r.frames > 2), 'no se capturó ningún swing frenando');
    assert.ok(human.runBlend < 1, 'el personaje siguió corriendo tras frenar');
  });

  it('corre y gira con rapidez: la cadencia del giro fija cada swing y nada cambia en el aire', () => {
    // Un giro largo y sostenido (270°) con el límite de aceleración lateral relajado para que el personaje
    // mantenga la velocidad de carrera mientras gira: así el giro exige más cadencia que la de la recta.
    const world = createWorld({
      human: { config: { variation: 0, turnSpeed: 120, turnAcceleration: 1000, maxLateralAcceleration: 20 } },
    });
    const { human } = world;
    // Se pone a correr primero; el giro se programa dentro de la misma simulación que recoge los swings
    // (un segundo simulate no conserva los guiones pendientes).
    simulate(world, 2, [[0, (h) => { h.targetSpeed = defaultConfig.runSpeed; }]]);
    const records = collectSwings(world, 5, 2, [[0, () => { human.targetHeading = 270 * DEG; }]]);
    assertSwingInvariants(records);
    // El giro pidió una cadencia mayor que la de la recta: alguna frecuencia bloqueada supera la base.
    const gait = human.locomotion.gait;
    const base = gait.cycleFrequency(defaultConfig.runSpeed, 0);
    assert.ok(records.some((r) => r.lockedFrequency > base), 'ningún swing absorbió la subida de cadencia del giro');
  });

  it('al volver a idle tras correr y girar, los dos pies quedan plantados en el doble apoyo', () => {
    const world = createWorld({ human: { config: { variation: 0 } } });
    const { human } = world;
    simulate(world, 3, [
      [0, (h) => { h.targetSpeed = defaultConfig.runSpeed; }],
      [1.5, () => { human.targetHeading = 90 * DEG; }],
    ]);
    // Se termina el giro y se frena por completo; se deja tiempo de sobra para asentar los pies.
    human.targetSpeed = 0;
    simulate(world, 5, [], { start: 3 });
    const gait = human.locomotion.gait;
    assert.equal(human.gaitMode, 'idle');
    assert.ok(gait.doubleSupport(), 'idle sin doble apoyo');
    for (const side of SIDES) {
      assert.notEqual(gait.footState(side), 'SWING');
      assert.equal(gait.footSwingDuration(side), 0, `${side} conserva un swing bloqueado en idle`);
      assert.equal(gait.footStepFrequency(side), 0, `${side} conserva frecuencia bloqueada en idle`);
      // El FootTarget también está en su pose apoyada.
      assert.equal(human.locomotion.feet[side].phase, 'PLANTED');
    }
  });
});
