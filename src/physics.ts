/**
 * DOM-free bunny-hop physics core.
 *
 * Coordinate convention: +Y is up, yaw=0 faces +Z, and +X is the right vector.
 * All distances are in units and all simulation time is in seconds.
 */

export const TICK_RATE = 128 as const;
export const PHYSICS_HZ = TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;
export const FIXED_PHYSICS_STEP = TICK_DT;
export const FIXED_TIME_STEP = TICK_DT;
export const FIXED_TIMESTEP = TICK_DT;

/** Source-style air wish-speed cap called out by the game design. */
export const AIR_WISH_SPEED_CAP = 30;
export const AIR_ACCELERATION_CAP = AIR_WISH_SPEED_CAP;
export const AIR_ACCEL_CAP = AIR_WISH_SPEED_CAP;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MouseLikeDelta {
  x?: number;
  y?: number;
}

/**
 * Input accepted by one fixed physics tick.
 *
 * `mouseDeltaX/Y` are raw mouse counts for this tick. Higher layers divide a
 * rendered frame's accumulated mouse delta before constructing these values.
 */
export interface TickInput {
  forward?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;

  /** Held jump state. With autoHop enabled, holding jump bunny-hops on landing. */
  jump?: boolean;
  jumpHeld?: boolean;

  /** Edge-triggered jump. Used when autoHop is disabled. */
  jumpPressed?: boolean;

  mouseDeltaX?: number;
  mouseDeltaY?: number;
  yawDelta?: number;
  pitchDelta?: number;
}

export interface PhysicsConfig {
  tickRate: number;
  gravity: number;
  jumpSpeed: number;
  maxGroundSpeed: number;
  groundAcceleration: number;
  airAcceleration: number;
  airWishSpeedCap: number;
  friction: number;
  stopSpeed: number;
  lookSensitivity: number;
  maxPitch: number;
  autoHop: boolean;
  groundY: number;
  maxFallSpeed: number;
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  tickRate: TICK_RATE,
  gravity: 1000,
  jumpSpeed: 300,
  maxGroundSpeed: 250,
  groundAcceleration: 10,
  airAcceleration: 12,
  airWishSpeedCap: AIR_WISH_SPEED_CAP,
  friction: 6,
  stopSpeed: 100,
  lookSensitivity: 0.0022,
  maxPitch: Math.PI / 2 - 0.01,
  autoHop: true,
  groundY: 0,
  maxFallSpeed: 2000,
};

export interface PhysicsState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** Number of committed fixed ticks. The initial state has tick=0. */
  tick: number;
  lastJumpTick: number | null;
  lastLandingTick: number | null;
}

export interface PhysicsSnapshot {
  tick: number;
  time: number;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
}

export interface FlatPhysicsState extends PhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function clonePhysicsState(state: PhysicsState): PhysicsState {
  return {
    ...state,
    position: cloneVec3(state.position),
    velocity: cloneVec3(state.velocity),
  };
}

export function createPhysicsState(init: Partial<PhysicsState> = {}): PhysicsState {
  return {
    yaw: 0,
    pitch: 0,
    grounded: true,
    tick: 0,
    lastJumpTick: null,
    lastLandingTick: null,
    ...init,
    position: init.position ? cloneVec3(init.position) : { x: 0, y: 0, z: 0 },
    velocity: init.velocity ? cloneVec3(init.velocity) : { x: 0, y: 0, z: 0 },
  };
}

/** Alias used by game-style code. */
export const createInitialState = createPhysicsState;

export function createSnapshot(state: PhysicsState): PhysicsSnapshot {
  return {
    tick: state.tick,
    time: state.tick * TICK_DT,
    position: cloneVec3(state.position),
    velocity: cloneVec3(state.velocity),
    yaw: state.yaw,
    pitch: state.pitch,
    grounded: state.grounded,
  };
}

function resolveConfig(config: Partial<PhysicsConfig> | undefined): PhysicsConfig {
  return config ? { ...DEFAULT_PHYSICS_CONFIG, ...config } : DEFAULT_PHYSICS_CONFIG;
}

function applyLook(state: PhysicsState, input: TickInput, config: PhysicsConfig): void {
  if (typeof input.yawDelta === 'number') {
    state.yaw += input.yawDelta;
  } else if (input.mouseDeltaX) {
    state.yaw += input.mouseDeltaX * config.lookSensitivity;
  }

  let pitchDelta = 0;
  if (typeof input.pitchDelta === 'number') pitchDelta = input.pitchDelta;
  else if (input.mouseDeltaY) pitchDelta = -input.mouseDeltaY * config.lookSensitivity;

  if (pitchDelta !== 0) {
    state.pitch = Math.max(
      -config.maxPitch,
      Math.min(config.maxPitch, state.pitch + pitchDelta),
    );
  }
}

function wishDirection(state: PhysicsState, input: TickInput): Vec3 {
  const side = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);

  if (side === 0 && forward === 0) return { x: 0, y: 0, z: 0 };

  const sinYaw = Math.sin(state.yaw);
  const cosYaw = Math.cos(state.yaw);

  // yaw=0: forward is +Z, right is +X.
  let x = sinYaw * forward + cosYaw * side;
  let z = cosYaw * forward - sinYaw * side;
  const length = Math.hypot(x, z);
  if (length > 0) {
    x /= length;
    z /= length;
  }
  return { x, y: 0, z };
}

function applyFriction(state: PhysicsState, dt: number, config: PhysicsConfig): void {
  const v = state.velocity;
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-12) {
    v.x = 0;
    v.z = 0;
    return;
  }

  const control = Math.max(speed, config.stopSpeed);
  const drop = control * config.friction * dt;
  const nextSpeed = Math.max(0, speed - drop);
  const scale = nextSpeed / speed;
  v.x *= scale;
  v.z *= scale;
}

function applyAcceleration(
  state: PhysicsState,
  input: TickInput,
  dt: number,
  config: PhysicsConfig,
): void {
  const wish = wishDirection(state, input);
  if (wish.x === 0 && wish.z === 0) return;

  const inputMagnitude = input.forward || input.back || input.left || input.right ? 1 : 0;
  const uncappedWishSpeed = inputMagnitude * config.maxGroundSpeed;

  // The defining bunny-hop rule: airborne wish speed is clamped to 30 u/s,
  // while the actual per-tick acceleration gain can still accumulate.
  const wishSpeed = state.grounded
    ? uncappedWishSpeed
    : Math.min(uncappedWishSpeed, config.airWishSpeedCap);

  if (wishSpeed <= 0) return;

  const v = state.velocity;
  const currentWishSpeed = v.x * wish.x + v.z * wish.z;
  const addSpeed = wishSpeed - currentWishSpeed;
  if (addSpeed <= 0) return;

  const acceleration = state.grounded
    ? config.groundAcceleration
    : config.airAcceleration;
  const acceleratedSpeed = Math.min(acceleration * dt * wishSpeed, addSpeed);

  v.x += wish.x * acceleratedSpeed;
  v.z += wish.z * acceleratedSpeed;
}

function wantsJump(input: TickInput): { held: boolean; pressed: boolean } {
  const held = input.jumpHeld ?? input.jump ?? false;
  const pressed = input.jumpPressed ?? input.jump ?? false;
  return { held, pressed };
}

function tryStartJump(
  state: PhysicsState,
  input: TickInput,
  config: PhysicsConfig,
): void {
  if (!state.grounded) return;
  const jump = wantsJump(input);
  const allowed = config.autoHop ? jump.held || jump.pressed : jump.pressed;
  if (!allowed) return;

  state.velocity.y = config.jumpSpeed;
  state.grounded = false;
  state.lastJumpTick = state.tick;
}

function resolveGroundContact(
  state: PhysicsState,
  input: TickInput,
  config: PhysicsConfig,
): void {
  const { position, velocity } = state;
  if (position.y > config.groundY) return;

  const landedFromAir = !state.grounded || velocity.y < 0;
  position.y = config.groundY;
  velocity.y = 0;

  if (landedFromAir) {
    state.grounded = true;
    state.lastLandingTick = state.tick;
  }

  // Auto-hop is resolved on the exact landing tick.
  const jump = wantsJump(input);
  if (config.autoHop ? jump.held || jump.pressed : jump.pressed) {
    velocity.y = config.jumpSpeed;
    state.grounded = false;
    state.lastJumpTick = state.tick;
  }
}

/**
 * Advance one fixed 1/128s physics tick in place and return the same state.
 *
 * Prefer `advancePhysics` when callers need immutable previous/current states.
 */
export function stepPhysicsInPlace(
  state: PhysicsState,
  input: TickInput = {},
  dt: number = TICK_DT,
  options: Partial<PhysicsConfig> = {},
): PhysicsState {
  const config = resolveConfig(options);
  const stepSeconds = options.tickRate ? 1 / options.tickRate : dt;

  state.tick += 1;

  applyLook(state, input, config);

  if (state.grounded) applyFriction(state, stepSeconds, config);
  applyAcceleration(state, input, stepSeconds, config);
  tryStartJump(state, input, config);

  // Half-gravity integration gives a stable, deterministic arc.
  state.velocity.y -= config.gravity * stepSeconds * 0.5;
  state.velocity.y = Math.max(state.velocity.y, -config.maxFallSpeed);

  state.position.x += state.velocity.x * stepSeconds;
  state.position.z += state.velocity.z * stepSeconds;
  state.position.y += state.velocity.y * stepSeconds;

  state.velocity.y -= config.gravity * stepSeconds * 0.5;
  state.velocity.y = Math.max(state.velocity.y, -config.maxFallSpeed);

  resolveGroundContact(state, input, config);
  return state;
}

/** Immutable fixed-tick step. The supplied state is not modified. */
export function advancePhysics(
  state: PhysicsState,
  input: TickInput = {},
  dt: number = TICK_DT,
  options: Partial<PhysicsConfig> = {},
): PhysicsState {
  const next = clonePhysicsState(state);
  return stepPhysicsInPlace(next, input, dt, options);
}

/**
 * Mutable stateful physics world. This is the conventional game-loop API.
 */
export class PhysicsWorld {
  state: PhysicsState;
  config: PhysicsConfig;

  constructor(initialState: Partial<PhysicsState> = {}, config: Partial<PhysicsConfig> = {}) {
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    this.state = createPhysicsState(initialState);
  }

  step(input: TickInput = {}, dt: number = TICK_DT): PhysicsState {
    return stepPhysicsInPlace(this.state, input, dt, this.config);
  }

  snapshot(): PhysicsSnapshot {
    return createSnapshot(this.state);
  }
}

/** Compatibility aliases for code expecting simulation-oriented names. */
export const stepPhysics = stepPhysicsInPlace;
export const physicsStep = stepPhysicsInPlace;
export const stepBunnyHop = stepPhysicsInPlace;
export const simulateTick = advancePhysics;
export type Physics = PhysicsWorld;
