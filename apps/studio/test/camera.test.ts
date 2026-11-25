import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeFocusCamera, resetCameraState, round3 } from '../src/sandbox/camera';

describe('camera framing math (Issue #4)', () => {
  it('computes center and distance to frame a mesh', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.set(5, 10, -5);
    mesh.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    camera.position.set(5, 10, 15);
    camera.lookAt(5, 10, -5);
    camera.updateMatrixWorld(true);

    const framing = computeFocusCamera(mesh, camera);

    // Target must match object's world center
    expect(round3(framing.target.x)).toBe(5);
    expect(round3(framing.target.y)).toBe(10);
    expect(round3(framing.target.z)).toBe(-5);

    // Camera position must be placed along view vector
    expect(framing.position.z).toBeGreaterThan(framing.target.z);
    expect(round3(framing.position.x)).toBe(5);
    expect(round3(framing.position.y)).toBe(10);
  });

  it('does not mutate the original scene mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(1, 2, 3);
    mesh.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    computeFocusCamera(mesh, camera);

    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
  });

  it('restores initial position, rotation, and actual initial orbit target (not hardcoded 0,0,0)', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const initialPos = new THREE.Vector3(10, 20, 30);
    const initialRot = new THREE.Euler(0.1, 0.2, 0.3);
    const initialOrbitTarget = new THREE.Vector3(5, 6, 7);

    // Modify camera and orbit to arbitrary values
    camera.position.set(-100, 50, 200);
    camera.rotation.set(1, 1, 1);

    let updated = false;
    const orbit = {
      target: new THREE.Vector3(99, 99, 99),
      update: () => {
        updated = true;
      },
    };

    resetCameraState(camera, initialPos, initialRot, orbit, initialOrbitTarget);

    expect(camera.position.x).toBe(10);
    expect(camera.position.y).toBe(20);
    expect(camera.position.z).toBe(30);
    expect(round3(camera.rotation.x)).toBe(0.1);
    expect(round3(camera.rotation.y)).toBe(0.2);
    expect(round3(camera.rotation.z)).toBe(0.3);

    // Orbit target must restore to actual initialOrbitTarget (5, 6, 7), NOT (0, 0, 0)
    expect(orbit.target.x).toBe(5);
    expect(orbit.target.y).toBe(6);
    expect(orbit.target.z).toBe(7);
    expect(updated).toBe(true);
  });
});
