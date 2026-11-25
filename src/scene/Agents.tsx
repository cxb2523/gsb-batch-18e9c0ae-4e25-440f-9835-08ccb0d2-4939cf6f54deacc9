/**
 * Deploy carts and the technician. All motion runs in useFrame on refs; the store only hears
 * when a cart is gone.
 *
 * Container identity: a service with several containers is several nodes, each in its own rack.
 * Deploy carts only ever drive to the service's main node (the one that keeps the service id),
 * never to a helper container. The technician handles any node that is in error with an open
 * alert, oldest incident first. Layout rebuilds (projects / environments / services added or
 * removed) discard the old route coordinates: carts re-plan onto the new rack, the technician
 * re-plans to its current target or goes home.
 */
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { STAGES } from '../data/types';
import { routeFromHome, type Layout, type V3 } from '../layout';
import { useStore } from '../store';
import { Label } from './Label';
import {
  cartLeaves,
  planAfterRecovery,
  planCart,
  planTechnician,
  standSpot,
  technicianQueue,
  type TechPhase,
  type TechPlan,
} from './agents.logic';
import { dampAngle, Walker } from './walker';

const CART_SPEED = 3.2;
const TECH_SPEED = 2.3;
const TECH_DX = 0.42;
const FACE_RACK = Math.PI; // racks face +z, so agents look toward -z

// ---- carts ----------------------------------------------------------------------------

/** Deploy carts; see the file header for the main-container / node identity rules. */
export function Agents({ layout }: { layout: Layout }) {
  const carts = useStore((s) => s.carts);
  return (
    <>
      {carts.map((id) => (
        <Cart key={id} deploymentId={id} layout={layout} />
      ))}
      <Technician layout={layout} />
      <HomeMarker at={layout.home} />
    </>
  );
}

type CartPhase = 'out' | 'docked' | 'back';

const Cart = memo(function Cart({ deploymentId, layout }: { deploymentId: string; layout: Layout }) {
  const dep = useStore((s) => s.deployments[deploymentId]);
  const svcName = useStore((s) => (dep ? s.services[dep.serviceId]?.name : undefined));
  const still = useStore((s) => s.reducedMotion);
  const [phase, setPhase] = useState<CartPhase>('out');

  const lane = dep ? (dep.cart % 2 ? -0.34 : 0.04) : 0.04;
  // Route is state (so render and frames agree); it changes only on spawn and layout rebuilds.
  const [route, setRoute] = useState<V3[] | null>(() => (dep ? planCart(layout, dep.serviceId, lane).route : null));
  const routeRef = useRef(route);
  routeRef.current = route;
  const sim = useRef({
    walker: route ? new Walker(route) : null,
    phase: 'out' as CartPhase | 'gone',
    age: 0,
    docked: 0,
    lastPos: route ? new THREE.Vector3(...route[0]) : null as THREE.Vector3 | null,
  });

  const group = useRef<THREE.Group>(null);
  const chassis = useRef<THREE.Group>(null);
  const terminal = !dep || dep.status === 'success' || dep.status === 'failed';
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;
  const depRef = useRef(dep);
  depRef.current = dep;
  const laneRef = useRef(lane);
  laneRef.current = lane;
  const spawned = useRef(false);

  // Layout rebuilt (service / environment / project added or removed): never keep the old
  // coordinates. Re-plan to the service's main node in the new layout and snap onto its route.
  useEffect(() => {
    // Skipped on mount: the spawn route above is already against this layout.
    if (!spawned.current) {
      spawned.current = true;
      return;
    }
    const st = sim.current;
    if (st.phase === 'gone') return;
    const d = depRef.current;
    const next = d ? planCart(layout, d.serviceId, laneRef.current).route : null;
    setRoute(next);
    routeRef.current = next;
    if (!next) {
      // The service has no node in this layout: park the cart (it leaves once the deploy ends).
      st.walker = null;
      if (terminalRef.current) {
        st.phase = 'gone';
        useStore.getState().cartGone(deploymentId);
      }
      return;
    }
    // Resume from where the cart is now; when docked, head for the new main rack's spot.
    const from = st.lastPos?.clone() ?? st.walker?.pos.clone();
    const at = st.phase === 'docked' ? new THREE.Vector3(...next[next.length - 1]) : from;
    st.walker = st.phase === 'back' ? new Walker(next.slice().reverse(), at) : new Walker(next, at);
  }, [layout, deploymentId]);

  // Nowhere to drive at all: leave as soon as the deploy ends instead of hanging around.
  useEffect(() => {
    if (!cartLeaves(routeRef.current, terminal)) return;
    const st = sim.current;
    if (st.phase === 'gone') return;
    st.phase = 'gone';
    useStore.getState().cartGone(deploymentId);
  }, [terminal, deploymentId]);

  useFrame((_, rawDt) => {
    const st = sim.current;
    const g = group.current;
    if (!g || st.phase === 'gone') return;
    const dt = Math.min(rawDt, 0.1);
    st.age += dt;

    if (!st.walker) {
      // No destination yet: stay hidden (the effects above leave once the deploy ends).
      g.scale.setScalar(0.001);
      return;
    }

    let moving = false;
    if (st.phase === 'out') {
      moving = true;
      if (st.walker.step(CART_SPEED * dt)) {
        st.phase = 'docked';
        setPhase('docked');
      }
    } else if (st.phase === 'docked') {
      st.docked += dt;
      if (terminalRef.current && st.docked > 0.8 && routeRef.current) {
        st.phase = 'back';
        st.walker = new Walker(routeRef.current.slice().reverse());
        setPhase('back');
      }
    } else if (st.walker.step(CART_SPEED * dt)) {
      st.phase = 'gone';
      useStore.getState().cartGone(deploymentId);
      return;
    } else {
      moving = true;
    }

    g.position.copy(st.walker.pos);
    st.lastPos = st.walker.pos.clone();
    const heading = st.phase === 'docked' ? FACE_RACK : st.walker.heading;
    g.rotation.y = st.age < 0.05 ? heading : dampAngle(g.rotation.y, heading, 12, dt);
    const appear = Math.min(1, st.age / 0.35);
    const vanish = st.phase === 'back' ? Math.min(1, st.walker.remaining / 0.9) : 1;
    g.scale.setScalar(Math.max(0.001, Math.min(appear, vanish)));
    if (chassis.current) chassis.current.position.y = moving && !still ? Math.abs(Math.sin(st.age * 16)) * 0.02 : 0;
  });

  if (!dep) return null;

  const stage = dep.stages.findIndex((s) => s === 'running' || s === 'failed');
  const label =
    phase === 'out'
      ? `To ${svcName ?? '…'}`
      : phase === 'docked'
        ? dep.status === 'running' && stage >= 0
          ? `${STAGES[stage]} · ${svcName}`
          : dep.status === 'queued'
            ? `Docking · ${svcName}`
            : dep.status === 'success'
              ? 'Delivered'
              : 'Build failed'
        : dep.status === 'failed'
          ? 'Returning · failed'
          : 'Returning';
  const delivered = phase === 'back' && dep.status === 'success';
  const failed = dep.status === 'failed';

  return (
    <group ref={group} scale={0.001} position={route ? route[0] : layout.home}>
      <group ref={chassis}>
        <RoundedBox args={[0.56, 0.2, 0.74]} radius={0.06} smoothness={3} position-y={0.2} castShadow>
          <meshStandardMaterial color="#1a2436" roughness={0.35} metalness={0.6} />
        </RoundedBox>
        <mesh position={[0, 0.21, 0.375]}>
          <boxGeometry args={[0.4, 0.06, 0.01]} />
          <meshStandardMaterial color="#000" emissive="#3d9bff" emissiveIntensity={2.2} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.305, -0.08]}>
          <boxGeometry args={[0.5, 0.012, 0.52]} />
          <meshStandardMaterial color="#000" emissive="#7c6cff" emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
        {!delivered && (
          <mesh position={[0, 0.47, -0.08]} castShadow>
            <boxGeometry args={[0.32, 0.32, 0.32]} />
            <meshStandardMaterial
              color={failed ? '#e5484d' : '#3d8bff'}
              emissive={failed ? '#e5484d' : '#3d8bff'}
              emissiveIntensity={1.3}
              roughness={0.35}
              toneMapped={false}
            />
          </mesh>
        )}
        <mesh position={[0.2, 0.42, 0.28]}>
          <cylinderGeometry args={[0.012, 0.012, 0.26, 6]} />
          <meshStandardMaterial color="#8b929e" />
        </mesh>
        <mesh position={[0.2, 0.57, 0.28]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color="#000" emissive={failed ? '#ff2e55' : '#ffb224'} emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
      </group>
      {[-0.22, 0.22].flatMap((x) =>
        [-0.24, 0.24].map((z) => (
          <mesh key={`${x}${z}`} position={[x * 1.12, 0.08, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.08, 0.08, 0.06, 14]} />
            <meshStandardMaterial color="#2a2f3a" roughness={0.8} />
          </mesh>
        )),
      )}
      <Label position={[0, 1.05, 0]} zIndex={8} minZoom={13}>
        <div className={`cart-label ${failed ? 'is-failed' : ''}`}>
          <b>RC{dep.cart}</b> · {label}
        </div>
      </Label>
    </group>
  );
});

// ---- technician ---------------------------------------------------------------------

function Technician({ layout }: { layout: Layout }) {
  const alerts = useStore((s) => s.alerts);
  const services = useStore((s) => s.services);
  const still = useStore((s) => s.reducedMotion);

  // Nodes that need a hand: an open alert on a node that is still in error. Oldest incident
  // first, one entry per node, and only while the node still has a rack in the layout.
  const queue = useMemo(() => technicianQueue(alerts, services, layout), [alerts, services, layout]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const [mode, setMode] = useState<TechPhase>('idle');
  const sim = useRef({
    phase: 'idle' as TechPhase,
    walker: null as Walker | null,
    target: null as string | null,
    at: null as string | null,
    pos: layout.home as V3,
    lastPos: layout.home as V3,
    t: 0,
  });

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);

  const applyPlan = (plan: TechPlan, resumeAt?: THREE.Vector3) => {
    const st = sim.current;
    st.phase = plan.phase;
    st.target = plan.target;
    st.at = plan.at;
    st.walker = plan.path ? new Walker(plan.path, resumeAt) : null;
    if (plan.pos) st.pos = plan.pos;
    setMode(plan.phase);
  };

  const settleHome = () =>
    applyPlan({ phase: 'idle', target: null, at: null, path: null, pos: layout.home });

  // Layout rebuilt: drop every old route. Keep working at a rack that still needs it (its new
  // spot), walk to the node we were after (or the oldest open incident) through the new layout,
  // else go back home. Resume from the current spot so nothing jumps across the new floor.
  useEffect(() => {
    const st = sim.current;
    const from = new THREE.Vector3(...st.lastPos);
    applyPlan(planTechnician(layout, queueRef.current, { phase: st.phase, target: st.target, at: st.at }, TECH_DX), from);
    // `applyPlan` only touches refs and setMode; the layout is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useFrame((_, rawDt) => {
    const st = sim.current;
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    st.t += dt;
    const q = queueRef.current;

    const go = (phase: TechPhase, path: V3[] | null, target: string | null) => {
      if (!path) return false;
      applyPlan({ phase, target, at: null, path, pos: null });
      return true;
    };
    const next = () => applyPlan(planAfterRecovery(layout, q, st.at, TECH_DX));

    switch (st.phase) {
      case 'idle': {
        const job = q[0];
        if (job) go('walk', routeFromHome(layout, job, TECH_DX), job);
        break;
      }
      case 'walk':
        if (st.walker && st.walker.step(TECH_SPEED * dt)) {
          st.at = st.target;
          // Arrived, but it recovered (or its alert resolved) on the way: never investigate a node
          // that is no longer in the queue -- take the next incident, or go home.
          if (st.at && q.includes(st.at) && layout.slots[st.at]) {
            // Stand at the node's (possibly moved) front spot, with the routes' lateral shift.
            applyPlan({ phase: 'work', target: st.at, at: st.at, path: null, pos: standSpot(layout, st.at, TECH_DX) });
          } else next();
        }
        break;
      case 'work':
        // Recovered, removed, or its alert resolved: leave and take the next incident (or go home).
        if (!st.at || !q.includes(st.at) || !layout.slots[st.at]) next();
        break;
      case 'home':
        if (st.walker && st.walker.step(TECH_SPEED * dt)) settleHome();
        break;
    }

    // pose
    const walking = st.phase === 'walk' || st.phase === 'home';
    if (walking && st.walker) g.position.copy(st.walker.pos);
    else g.position.set(...st.pos);
    st.lastPos = [g.position.x, g.position.y, g.position.z];
    const heading = st.phase === 'work' ? FACE_RACK : st.walker ? st.walker.heading : 0;
    g.rotation.y = dampAngle(g.rotation.y, heading, 10, dt);

    const swing = walking && !still ? Math.sin(st.t * 10) * 0.55 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) {
      armR.current.rotation.x =
        st.phase === 'work' ? (still ? -1.9 : -1.6 - Math.abs(Math.sin(st.t * 7)) * 0.7) : swing * 0.8;
    }
    if (body.current) {
      body.current.position.y = walking && !still ? Math.abs(Math.sin(st.t * 10)) * 0.035 : still ? 0 : Math.sin(st.t * 2) * 0.006;
    }
  });

  return (
    <group ref={root} position={layout.home}>
      <group ref={body}>
        <TechModel legL={legL} legR={legR} armL={armL} armR={armR} />
      </group>
      {mode === 'work' && (
        <Label position={[0, 1.6, 0]} zIndex={9}>
          <div className="bubble">
            <span className="bubble-spinner" />
            Investigating…
          </div>
        </Label>
      )}
    </group>
  );
}

type GroupRef = RefObject<THREE.Group | null>;

const SKIN = '#e9b993';
const VEST = '#ff7a1a';
const PANTS = '#2b3a55';
const HAT = '#ffc53d';

function Limb({ r, len, color }: { r: number; len: number; color: string }) {
  return (
    <mesh position-y={-len / 2 - r} castShadow>
      <capsuleGeometry args={[r, len, 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

function TechModel({ legL, legR, armL, armR }: { legL: GroupRef; legR: GroupRef; armL: GroupRef; armR: GroupRef }) {
  return (
    <group>
      <group ref={legL} position={[-0.075, 0.46, 0]}>
        <Limb r={0.065} len={0.3} color={PANTS} />
      </group>
      <group ref={legR} position={[0.075, 0.46, 0]}>
        <Limb r={0.065} len={0.3} color={PANTS} />
      </group>
      <mesh position-y={0.68} castShadow>
        <capsuleGeometry args={[0.15, 0.22, 4, 12]} />
        <meshStandardMaterial color={VEST} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.72, 0.12]}>
        <boxGeometry args={[0.2, 0.035, 0.08]} />
        <meshStandardMaterial color="#e8ecf1" emissive="#ffffff" emissiveIntensity={0.3} />
      </mesh>
      <group ref={armL} position={[-0.2, 0.86, 0]}>
        <Limb r={0.048} len={0.26} color={VEST} />
      </group>
      <group ref={armR} position={[0.2, 0.86, 0]}>
        <Limb r={0.048} len={0.26} color={VEST} />
        <mesh position={[0, -0.42, 0.02]}>
          <boxGeometry args={[0.04, 0.14, 0.04]} />
          <meshStandardMaterial color="#8b929e" metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
      <mesh position-y={1.02} castShadow>
        <sphereGeometry args={[0.115, 16, 12]} />
        <meshStandardMaterial color={SKIN} roughness={0.8} />
      </mesh>
      <mesh position-y={1.05} castShadow>
        <sphereGeometry args={[0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={HAT} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.05, 0.03]}>
        <cylinderGeometry args={[0.165, 0.165, 0.02, 20]} />
        <meshStandardMaterial color={HAT} roughness={0.4} />
      </mesh>
    </group>
  );
}

function HomeMarker({ at }: { at: V3 }) {
  return (
    <mesh position={[at[0], 0.004, at[2]]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.36, 0.42, 40]} />
      <meshBasicMaterial color="#1f5f7a" toneMapped={false} />
    </mesh>
  );
}
