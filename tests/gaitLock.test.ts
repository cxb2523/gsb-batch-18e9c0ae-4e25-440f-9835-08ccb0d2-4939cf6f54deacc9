import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultLocomotionConfig, type LocomotionConfig } from '../src/locomotion/LocomotionConfig.ts';
import { GaitController } from '../src/locomotion/GaitController.ts';
import type { FootPhase } from '../src/locomotion/FootTarget.ts';
import type { Side } from '../src/rig/HumanRig.ts';

const SIDES: readonly Side[] = ['left', 'right'];
/** Paso fijo muy fino: ningún pie puede saltarse por completo su ventana de SWING en un solo paso. */
const DT = 1 / 2000;

/** Avanza el gait `frames` pasos a la velocidad y velocidad angular dadas. */
function run(gait: GaitController, frames: number, speed: number, angularSpeed = 0): void {
  for (let i = 0; i < frames; i++) gait.update(DT, speed, angularSpeed);
}

/** Avanza hasta que `side` despega y se asegura de que ese paso lo deje en SWING (sin saltarse la ventana). */
function runUntilLiftoff(gait: GaitController, side: Side, speed: number, angularSpeed = 0, maxFrames = 20000): void {
  for (let i = 0; i < maxFrames; i++) {
    gait.update(DT, speed, angularSpeed);
    if (gait.footState(side) === 'SWING') return;
  }
  throw new Error(`${side} no despegó`);
}

/**
 * Sigue el swing actual de `side` hasta el aterrizaje, aplicando `conditions` en cada paso. Comprueba los
 * bloqueos *antes* de cada paso (el último paso aterriza y libera el bloqueo), y devuelve cuántos duró.
 */
function followSwing(
  gait: GaitController,
  side: Side,
  conditions: (step: number) => { speed: number; angularSpeed?: number },
  assertLocked?: () => void,
): number {
  let steps = 0;
  while (gait.footState(side) === 'SWING') {
    assertLocked?.();
    const { speed, angularSpeed = 0 } = conditions(steps);
    gait.update(DT, speed, angularSpeed);
    steps++;
    if (steps > 20000) throw new Error('el swing no terminó');
  }
  return steps;
}

function assertPlantedInDoubleSupport(gait: GaitController): void {
  for (const side of SIDES) {
    assert.notEqual(gait.footState(side), 'SWING', `${side} en el aire en idle`);
    assert.equal(gait.footSwingDuration(side), 0, `${side} conserva un swing bloqueado en idle`);
    assert.equal(gait.footStepFrequency(side), 0, `${side} conserva frecuencia bloqueada en idle`);
  }
  assert.ok(gait.doubleSupport(), 'idle sin doble apoyo');
  // El pie derecho está a medio ciclo del izquierdo: ambos dentro de su apoyo, centrados en el doble apoyo.
  assert.ok(gait.footPhase('left') < gait.duty.left && gait.footPhase('right') < gait.duty.right);
}

describe('GaitController: frecuencia, duty y duración del swing compartidos', () => {
  it('reset queda en doble apoyo, con los dos pies plantados y sin bloqueos de swing', () => {
    const gait = new GaitController({ ...defaultLocomotionConfig });
    gait.mode = 'walk';
    run(gait, 2000, defaultLocomotionConfig.runSpeed);
    gait.reset();
    assert.equal(gait.mode, 'idle');
    assertPlantedInDoubleSupport(gait);
  });

  it('acelerando desde parado hasta correr: un pie en SWING no cambia de estado ni re-bloquea su swing', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';

    run(gait, 1500, config.walkSpeed);
    const side: Side = 'left';
    runUntilLiftoff(gait, side, config.walkSpeed);

    // El duty y la duración del swing quedan fijados en el despegue.
    const lockedDuty = gait.duty[side];
    const lockedSwing = gait.footSwingDuration(side);
    const lockedFrequency = gait.footStepFrequency(side);
    assert.ok(lockedSwing > 0, 'sin duración de swing bloqueada al despegar');
    assert.ok(Math.abs(lockedSwing - (1 - lockedDuty) / lockedFrequency) < 1e-12, 'swingDuration inconsistente con el duty');
    // Es la misma duración que obtendría el planificador con la cadencia objetivo del instante del despegue.
    assert.ok(Math.abs(lockedSwing - gait.swingDuration(config.walkSpeed, 0, lockedDuty)) < 1e-12,
      'la duración bloqueada difiere de la que usa el planificador al despegar');

    // Acelera cruzando runStartSpeed hasta la carrera completa mientras el pie sigue en el aire.
    let previous: FootPhase = gait.footState(side);
    let sawRunning = false;
    const steps = followSwing(gait, side, (i) => {
      const speed = Math.min(config.runSpeed, config.runStartSpeed + (config.runSpeed - config.runStartSpeed) * (i / 40));
      if (gait.runFactor(speed) > 0) sawRunning = true;
      return { speed };
    });
    assert.ok(sawRunning, 'la prueba no llegó a mezclar carrera durante el swing');
    assert.ok(steps >= 3, 'el swing duró menos pasos de los esperados');
    assert.equal(previous, 'SWING');
    assert.equal(gait.footSwingDuration(side), 0, 'el bloqueo no se liberó al aterrizar');
    assert.equal(gait.footStepFrequency(side), 0);
  });

  it('frenando a caminar a mitad del swing: el duty y la duración bloqueados sobreviven hasta el aterrizaje', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';

    run(gait, 2000, config.runSpeed);
    const side: Side = 'right';
    runUntilLiftoff(gait, side, config.runSpeed);
    const lockedDuty = gait.duty[side];
    const lockedSwing = gait.footSwingDuration(side);
    assert.ok(lockedDuty < config.dutyFactor, 'el bloqueo de carrera no tiene un duty de carrera');
    assert.ok(Math.abs(lockedSwing - (1 - lockedDuty) / gait.footStepFrequency(side)) < 1e-12);

    // Frena de golpe a velocidad de caminar (factor de carrera a 0) con el pie aún en el aire.
    const steps = followSwing(gait, side, () => ({ speed: config.walkSpeed }));
    assert.ok(steps > 1, 'el swing terminó de inmediato');
    // Aterrizó: el nuevo duty ya corresponde a caminar y el bloqueo se libera.
    assert.notEqual(gait.footState(side), 'SWING');
    assert.equal(gait.footSwingDuration(side), 0);
    assert.equal(gait.footStepFrequency(side), 0);
    assert.ok(gait.duty[side] > lockedDuty, 'el duty de caminar no es mayor que el de carrera');
  });

  it('girando corriendo: la subida de frecuencia del giro fija el swing al despegar y no cambia después', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';
    const speed = config.runSpeed;

    run(gait, 2000, speed);
    const straight = gait.cycleFrequency(speed, 0);

    // El giro empieza con ambos pies en el suelo. La cadencia sube de forma continua (máx. 1,5 ciclos/s²),
    // así que se deja girar con los pies apoyados el tiempo suficiente para que la subida esté instalada
    // antes de observar el siguiente despegue: la frecuencia del giro debe llegar antes que el pie al aire.
    const sharpTurn = ((config.maxTurnPerStep * Math.PI) / 180) * 2.5; // rad/s, por encima del límite por paso
    run(gait, 1000, speed, sharpTurn); // 0,5 s girando, los bloqueos se renuevan en cada despegue
    assert.ok(gait.cycleFrequency(speed, sharpTurn) > straight, 'el giro no pide más cadencia que la recta');

    let side: Side | null = null;
    for (let i = 0; i < 20000; i++) {
      gait.update(DT, speed, sharpTurn);
      for (const s of SIDES) {
        if (gait.footState(s) === 'SWING' && gait.footStepFrequency(s) > 0) {
          side = s;
          break;
        }
      }
      if (side) break;
    }
    assert.ok(side, 'ningún pie despegó tras instalarse el giro');

    const lockedFrequency = gait.footStepFrequency(side);
    const lockedSwing = gait.footSwingDuration(side);
    const lockedDuty = gait.duty[side];
    // La frecuencia bloqueada ya incluye el aumento que pide el giro (no es la de la recta).
    assert.ok(lockedFrequency > straight, `el giro no subió la cadencia antes del despegue: ${lockedFrequency} ≤ ${straight}`);
    assert.ok(Math.abs(lockedSwing - (1 - lockedDuty) / lockedFrequency) < 1e-12);
    // Y coincide exactamente con la duración de swing calculada con la cadencia objetivo del despegue:
    // el GaitController y el planificador comparten el mismo número.
    assert.ok(Math.abs(lockedSwing - gait.swingDuration(speed, sharpTurn, lockedDuty)) < 1e-12,
      'la duración bloqueada no coincide con la cadencia objetivo del despegue');

    // Sigue girando incluso más fuerte con el pie en el aire: nada del swing se mueve.
    const steps = followSwing(
      gait,
      side,
      () => ({ speed, angularSpeed: sharpTurn * 1.5 }),
      () => {
        assert.equal(gait.footSwingDuration(side), lockedSwing, 'la duración del swing cambió con el giro en el aire');
        assert.equal(gait.footStepFrequency(side), lockedFrequency, 'la frecuencia del pie cambió con el giro en el aire');
        assert.equal(gait.duty[side], lockedDuty, 'el duty del pie cambió con el giro en el aire');
      },
    );
    assert.ok(steps > 1);
    assert.notEqual(gait.footState(side), 'SWING');
    assert.equal(gait.footSwingDuration(side), 0);
    assert.equal(gait.footStepFrequency(side), 0);
  });

  it('el pie en el aire conserva duty, frecuencia objetivo y duración de swing pese a cambiar velocidad y giro', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';
    run(gait, 1500, config.runSpeed);
    const side: Side = 'right';

    // Captura el pie exactamente en el paso de su despegue.
    let locked = 0;
    let lockedFrequency = 0;
    let lockedDuty = 0;
    for (let i = 0; i < 20000; i++) {
      const events = gait.update(DT, config.runSpeed);
      if (events.some((e) => e.side === side && e.type === 'liftoff')) {
        locked = gait.footSwingDuration(side);
        lockedFrequency = gait.footStepFrequency(side);
        lockedDuty = gait.duty[side];
        break;
      }
    }
    assert.ok(locked > 0, 'no se capturó el despegue');
    assert.ok(Math.abs(locked - (1 - lockedDuty) / lockedFrequency) < 1e-12);

    // Velocidad y giro cambiantes en cada paso: el reloj de fase global avanza con la cadencia suavizada
    // del momento, pero el pie en el aire conserva intactos su duty, su frecuencia bloqueada y, con ella,
    // la duración de su swing (que es lo que FootstepPlanner usa para proyectar el aterrizaje).
    let previousPhase = gait.footPhase(side);
    let accumulated = 0;
    let steps = 0;
    while (gait.footState(side) === 'SWING') {
      assert.equal(gait.footSwingDuration(side), locked, 'la duración del swing cambió en el aire');
      assert.equal(gait.footStepFrequency(side), lockedFrequency, 'la frecuencia del pie cambió en el aire');
      assert.equal(gait.duty[side], lockedDuty, 'el duty del pie cambió en el aire');
      const speed = config.walkSpeed + (config.runSpeed - config.walkSpeed) * (0.5 + 0.5 * Math.sin(steps * 0.7));
      const angularSpeed = 1.5 + Math.sin(steps * 0.3);
      gait.update(DT, speed, angularSpeed);
      const now = gait.footPhase(side);
      // El avance de fase de cada paso coincide con la cadencia global de ese paso (reloj compartido).
      const advance = now >= previousPhase ? now - previousPhase : 1 - previousPhase + now;
      assert.ok(Math.abs(advance - gait.frequency * DT) <= 1e-9, 'el pie no siguió el reloj de fase compartido');
      accumulated += advance;
      previousPhase = now;
      steps++;
    }
    // El tiempo que el pie pasó en el aire es del orden de su swing bloqueado: el reloj de fase global se
    // suaviza hacia la nueva cadencia, así que el aterrizaje puede adelantarse o atrasarse un poco, pero el
    // pie nunca salta de estado ni ve cambiar su duty ni la duración que el planificador usó al despegar.
    const elapsed = steps * DT;
    assert.ok(elapsed > locked * 0.5 && elapsed < locked * 1.5,
      `tiempo en el aire ${elapsed} inconsistente con el swing bloqueado ${locked}`);
    // La fase total recorrida en el aire equivale a la fracción de ciclo del swing (1 − duty).
    assert.ok(Math.abs(accumulated - (1 - lockedDuty)) < 0.05,
      `fase recorrida en el aire ${accumulated} ≠ fracción de swing ${1 - lockedDuty}`);
  });

  it('los dos pies alternan despegues y sus bloqueos son coherentes en cambios bruscos de marcha', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';
    const liftoffs: Side[] = [];
    let speed = config.walkSpeed;
    for (let i = 0; i < 12000; i++) {
      // Cambia de velocidad cada ~0,25 s, cruzando la transición walk/run en los dos sentidos, y añade giros.
      if (i % 500 === 0) speed = speed > config.runStartSpeed ? config.walkSpeed : config.runSpeed;
      const angularSpeed = i % 1000 < 250 ? 2 : 0;
      const events = gait.update(DT, speed, angularSpeed);
      for (const event of events) if (event.type === 'liftoff') liftoffs.push(event.side);

      for (const side of SIDES) {
        if (gait.footState(side) === 'SWING') {
          const swing = gait.footSwingDuration(side);
          assert.ok(swing > 0, `${side} en SWING sin duración bloqueada`);
          assert.ok(Math.abs(swing - (1 - gait.duty[side]) / gait.footStepFrequency(side)) < 1e-12);
        } else {
          assert.equal(gait.footSwingDuration(side), 0, `${side} plantado conserva bloqueo`);
        }
      }
    }
    assert.ok(liftoffs.length > 10, 'casi no hubo despegues');
    for (let i = 1; i < liftoffs.length; i++) {
      assert.notEqual(liftoffs[i], liftoffs[i - 1], `dos despegues seguidos del mismo pie en el paso ${i}`);
    }
  });

  it('volver a idle tras moverse libera los bloqueos y deja los dos pies en el centro del doble apoyo', () => {
    const config: LocomotionConfig = { ...defaultLocomotionConfig };
    const gait = new GaitController(config);
    gait.mode = 'walk';
    run(gait, 2500, config.runSpeed, 1.2);
    gait.reset();
    assertPlantedInDoubleSupport(gait);
    // La fase es el centro del primer doble apoyo.
    const center = (config.dutyFactor - 0.5) / 2;
    assert.ok(Math.abs(gait.phase - center) < 1e-12);
  });
});
