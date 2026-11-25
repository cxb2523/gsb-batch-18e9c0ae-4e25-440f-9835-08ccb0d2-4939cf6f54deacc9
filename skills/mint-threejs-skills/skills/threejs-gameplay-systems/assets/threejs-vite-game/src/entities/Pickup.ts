import * as THREE from 'three';

const FLOAT_BASE_Y = 0.78;
const FLOAT_AMPLITUDE = 0.16;

export class Pickup {
  readonly group = new THREE.Group();
  readonly radius = 0.62;
  active = true;

  private readonly core: THREE.Mesh;
  private readonly coreGeometry = new THREE.IcosahedronGeometry(0.42, 1);
  private readonly ringGeometry = new THREE.TorusGeometry(0.58, 0.028, 8, 32);
  private readonly coreMaterial = new THREE.MeshStandardMaterial({
    color: '#48baa7',
    emissive: '#0f5249',
    emissiveIntensity: 0.8,
    roughness: 0.28,
    metalness: 0.1,
  });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: '#f6f1df',
  });

  // Own the animation phase instead of deriving float height from the loop's
  // absolute elapsed time. An owned phase can be fully restored by reset() and
  // does not jump after a screenshot pause (the loop clock keeps running).
  private floatTime = 0;

  constructor(
    readonly index: number,
    position: THREE.Vector3,
  ) {
    this.core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    this.core.castShadow = true;
    this.group.add(this.core);

    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    this.group.position.copy(position);
    this.resetPose();
  }

  // `_elapsed` is retained for the original (delta, elapsed) call signature.
  // Animation phase is accumulated from `delta` internally so reset() can fully
  // restore it and a screenshot pause cannot cause an absolute-time jump.
  update(delta: number, _elapsed: number): void {
    // Collected relays stay hidden and must not advance any phase; reset()
    // restores both visibility and the phase when a run restarts.
    if (!this.active) return;
    this.group.rotation.y += delta * 1.8;
    this.core.rotation.x -= delta * 1.2;
    this.floatTime += delta;
    this.group.position.y =
      FLOAT_BASE_Y + Math.sin(this.floatTime * 2.6 + this.index) * FLOAT_AMPLITUDE;
  }

  collect(): void {
    this.active = false;
    this.group.visible = false;
  }

  reset(): void {
    this.active = true;
    this.group.visible = true;
    this.resetPose();
  }

  /** Rotation of the spinning inner mesh, exposed for state diagnostics. */
  get coreRotationX(): number {
    return this.core.rotation.x;
  }

  /** Restore every animated transform to its deterministic starting pose. */
  private resetPose(): void {
    this.floatTime = 0;
    this.group.rotation.set(0, 0, 0);
    this.core.rotation.set(0, 0, 0);
    this.group.position.y = FLOAT_BASE_Y + Math.sin(this.index) * FLOAT_AMPLITUDE;
  }

  dispose(): void {
    this.coreGeometry.dispose();
    this.ringGeometry.dispose();
    this.coreMaterial.dispose();
    this.ringMaterial.dispose();
  }
}
