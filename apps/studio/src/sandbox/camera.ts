import * as THREE from 'three';

export const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;

export interface CameraFraming {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Compute camera position and look-at target to frame an Object3D inside the viewport.
 * View-only math: this never alters scene meshes or user source files.
 */
export function computeFocusCamera(object: THREE.Object3D, camera: THREE.Camera): CameraFraming {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.isEmpty()
    ? object.getWorldPosition(new THREE.Vector3())
    : box.getCenter(new THREE.Vector3());
  const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);

  const persCam = camera as THREE.PerspectiveCamera;
  const fov = typeof persCam.fov === 'number' && Number.isFinite(persCam.fov) && persCam.fov > 0 ? persCam.fov : 50;
  const distance = Math.max(1, (maxDim / 2 / Math.tan((fov * Math.PI) / 360)) * 1.5);

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);

  const position = center.clone().sub(dir.multiplyScalar(distance));
  return { position, target: center };
}

/**
 * Restores camera position, rotation, and actual initial orbit target without hardcoding.
 */
export function resetCameraState(
  camera: THREE.Camera,
  initialPos: THREE.Vector3,
  initialRot: THREE.Euler,
  orbit?: { target: THREE.Vector3; update: () => void } | null,
  initialOrbitTarget?: THREE.Vector3 | null,
): void {
  camera.position.copy(initialPos);
  camera.rotation.copy(initialRot);
  if (orbit && initialOrbitTarget) {
    orbit.target.copy(initialOrbitTarget);
    orbit.update();
  }
}
