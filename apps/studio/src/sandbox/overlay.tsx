import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ToSandbox, TransformChange } from '../protocol';
import { bus } from './bus';
import { computeFocusCamera, resetCameraState } from './camera';
import { ClockFreezer } from './clock';

const ACCENT = '#7c6cff';
const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;
const BLOCKED = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'pointerleave', 'pointercancel'] as const;

type Prism = THREE.Object3D & { userData: { prism?: string; prismHelper?: boolean } };

declare global {
  interface Window {
    __prismDebug?: {
      screenPointOf(name: string): { x: number; y: number } | null;
      gizmoAxis(): string | null;
      frozen(): boolean;
      selectedTag(): string | null;
      freezeBroken(): boolean;
      info(): Record<string, unknown>;
    };
  }
}

function isHelper(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if ((p as Prism).userData?.prismHelper) return true;
  return false;
}

function tagOf(o: unknown): string | undefined {
  const u = (o as { userData?: { prism?: unknown } } | null | undefined)?.userData;
  return typeof u?.prism === 'string' ? u.prism : undefined;
}

/** Object, material or geometry carrying the tag. For the latter two the owning mesh is returned as `object`. */
function findByTag(scene: THREE.Scene, tag: string): { object: THREE.Object3D; target: unknown } | null {
  let found: { object: THREE.Object3D; target: unknown } | null = null;
  scene.traverse((o) => {
    if (found || isHelper(o)) return;
    if (tagOf(o) === tag) found = { object: o, target: o };
    else {
      const m = (o as THREE.Mesh).material;
      const mats = Array.isArray(m) ? m : m ? [m] : [];
      const mat = mats.find((x) => tagOf(x) === tag);
      if (mat) found = { object: o, target: mat };
      else if (tagOf((o as THREE.Mesh).geometry) === tag) found = { object: o, target: (o as THREE.Mesh).geometry };
    }
  });
  return found;
}

function triple(v: THREE.Vector3 | THREE.Euler): number[] {
  return [round3(v.x), round3(v.y), round3(v.z)];
}

/**
 * The editor overlay, injected by instrument() as the last child of the user's <Canvas>.
 * Picking, the transform gizmo, Scene cam / Free view, selection box and the d9 animation pause
 * (freeze the R3F clock while a gizmo handle is hovered or dragged) all live here.
 */
export function __PrismOverlay() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const set = useThree((s) => s.set);

  useEffect(() => {
    const dom = gl.domElement;
    const sceneCam = get().camera;
    const initialCamPos = sceneCam.position.clone();
    const initialCamRot = sceneCam.rotation.clone();
    let initialOrbitTarget: THREE.Vector3 | null = null;
    let freeCam: THREE.Camera | null = null;
    let orbit: OrbitControls | null = null;

    const tc = new TransformControls(sceneCam, dom); // registers its listeners first
    tc.size = 0.85;

    function setSnap(enabled: boolean) {
      tc.setTranslationSnap(enabled ? 0.1 : null);
      tc.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
      tc.setScaleSnap(enabled ? 0.1 : null);
    }
    setSnap(bus.snap);
    const helper = tc.getHelper();
    helper.userData.prismHelper = true;
    scene.add(helper);
    const box = new THREE.BoxHelper(new THREE.Object3D(), ACCENT);
    box.userData.prismHelper = true;
    box.visible = false;
    scene.add(box);

    const freezer = new ClockFreezer(get().clock);
    let freezeBroken = false;
    let selected: THREE.Object3D | null = null;
    let selectedTag: string | null = null;
    const raycaster = new THREE.Raycaster();

    const setFrozen = (reason: 'hover' | 'drag', on: boolean) => {
      const before = freezer.frozen;
      freezer.set(reason, on && bus.armed);
      if (before !== freezer.frozen) bus.post({ type: 'frozen', value: freezer.frozen });
    };

    function select(tag: string | null) {
      selectedTag = tag;
      selected = null;
      if (tag) {
        const hit = findByTag(scene, tag);
        if (hit) selected = hit.object;
      }
      if (selected && bus.armed) {
        tc.attach(selected);
        box.setFromObject(selected);
        box.visible = true;
      } else {
        tc.detach();
        box.visible = false;
      }
    }

    function pick(e: PointerEvent) {
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.visible && !isHelper(h.object));
      let tag: string | null = null;
      for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
        const t = tagOf(o);
        if (t) {
          tag = t;
          break;
        }
      }
      bus.selected = tag;
      select(tag);
      bus.post({ type: 'pick', tag });
    }

    // Gizmo + pick state. Registered after TransformControls' own listeners (same element, registration
    // order), so the gizmo still sees every event; then nothing reaches R3F or the user's own handlers
    // while the overlay is armed (Edit mode).
    let down: { x: number; y: number; onGizmo: boolean } | null = null;
    const block = (e: Event) => {
      if (!bus.armed) return;
      e.stopPropagation();
      const pe = e as PointerEvent;
      if (e.type === 'pointerdown' && pe.button === 0) down = { x: pe.clientX, y: pe.clientY, onGizmo: tc.axis !== null };
      if (e.type === 'pointerup' && pe.button === 0 && down) {
        const moved = Math.hypot(pe.clientX - down.x, pe.clientY - down.y);
        if (moved < 5 && !down.onGizmo) pick(pe);
        down = null;
      }
    };
    BLOCKED.forEach((t) => dom.addEventListener(t, block));

    // d9: pause while a handle is hovered and while it is dragged.
    tc.addEventListener('axis-changed', (ev) => setFrozen('hover', (ev as unknown as { value: unknown }).value !== null && !tc.dragging));
    let before: Record<string, number[]> | null = null;
    tc.addEventListener('dragging-changed', (ev) => {
      const dragging = Boolean((ev as unknown as { value: boolean }).value);
      if (orbit) orbit.enabled = !dragging;
      setFrozen('drag', dragging);
      const o = tc.object;
      if (dragging && o) {
        before = { position: triple(o.position), rotation: triple(o.rotation), scale: triple(o.scale) };
        setFrozen('hover', false);
        return;
      }
      if (!dragging && o && before) {
        const after = { position: triple(o.position), rotation: triple(o.rotation), scale: triple(o.scale) };
        const changes: Partial<Record<'position' | 'rotation' | 'scale', TransformChange>> = {};
        for (const k of ['position', 'rotation', 'scale'] as const) {
          if ((before[k] as number[]).some((v, i) => v !== (after[k] as number[])[i])) changes[k] = { from: before[k] as number[], to: after[k] as number[] };
        }
        before = null;
        const tag = tagOf(o) ?? selectedTag;
        if (tag && Object.keys(changes).length) bus.post({ type: 'transform', tag, changes }); // ONE message, at drag end
      }
    });

    function setView(mode: 'scene' | 'free') {
      if (mode === 'free' && !freeCam) {
        freeCam = sceneCam.clone();
        orbit = new OrbitControls(freeCam, dom);
        orbit.enableDamping = false;
        if (!initialOrbitTarget) {
          initialOrbitTarget = orbit.target.clone();
        }
        set({ camera: freeCam as THREE.PerspectiveCamera });
        tc.camera = freeCam;
      } else if (mode === 'scene' && freeCam) {
        orbit?.dispose();
        orbit = null;
        freeCam = null;
        set({ camera: sceneCam });
        tc.camera = sceneCam;
      }
      bus.view = mode;
    }

    function live(m: Extract<ToSandbox, { type: 'live' }>) {
      const hit = findByTag(scene, m.tag);
      if (!hit) return;
      try {
        const t = hit.target as Record<string, unknown> & { uniforms?: Record<string, { value: unknown }> };
        if (m.uniform) {
          const u = t.uniforms?.[m.prop];
          if (!u) return;
          const cur = u.value as { set?: (v: unknown) => void; fromArray?: (a: number[]) => void } | number | boolean | null;
          if (typeof m.value === 'string' && cur && typeof cur === 'object' && cur.set) cur.set(m.value);
          else if (Array.isArray(m.value) && cur && typeof cur === 'object' && cur.fromArray) cur.fromArray(m.value as number[]);
          else u.value = m.value;
          return;
        }
        const cur = t[m.prop] as { set?: (v: unknown) => void; fromArray?: (a: number[]) => void } | undefined;
        if (m.prop === 'rotation' && Array.isArray(m.value)) (t as unknown as THREE.Object3D).rotation.set(m.value[0] as number, m.value[1] as number, m.value[2] as number);
        else if (Array.isArray(m.value) && cur && cur.fromArray) cur.fromArray(m.value as number[]);
        else if (typeof m.value === 'string' && cur && typeof cur === 'object' && cur.set) cur.set(m.value);
        else if (m.prop in t) t[m.prop] = m.value;
        if (selected) box.setFromObject(selected);
      } catch {
        /* a live preview must never break the scene; the committed source edit is what counts */
      }
    }

    function apply(m: ToSandbox) {
      switch (m.type) {
        case 'arm':
          bus.armed = m.value;
          if (!m.value) {
            freezer.set('hover', false);
            freezer.set('drag', false);
          }
          select(m.value ? selectedTag : null);
          if (!m.value) selectedTag = bus.selected;
          break;
        case 'select':
          bus.selected = m.tag;
          select(m.tag);
          break;
        case 'view':
          setView(m.mode);
          break;
        case 'gizmo':
          bus.gizmo = m.mode;
          tc.setMode(m.mode);
          break;
        case 'resetCamera':
          if (bus.view === 'free' && freeCam && orbit) {
            resetCameraState(freeCam, initialCamPos, initialCamRot, orbit, initialOrbitTarget);
          } else {
            resetCameraState(sceneCam, initialCamPos, initialCamRot);
          }
          break;
        case 'focus':
          if (selected) {
            const curCam = get().camera;
            const framing = computeFocusCamera(selected, curCam);
            if (bus.view === 'free' && freeCam && orbit) {
              freeCam.position.copy(framing.position);
              orbit.target.copy(framing.target);
              orbit.update();
            } else {
              curCam.position.copy(framing.position);
              curCam.lookAt(framing.target);
            }
          }
          break;
        case 'snap':
          bus.snap = m.enabled;
          setSnap(m.enabled);
          break;
        case 'live':
          live(m);
          break;
        default:
          break;
      }
    }
    bus.handler = apply;
    tc.setMode(bus.gizmo);
    if (bus.view === 'free') setView('free');
    select(bus.selected);

    const frame = () => {
      if (selected && box.visible) box.update();
    };
    (window as unknown as { __prismFrame?: () => void }).__prismFrame = frame;

    window.__prismDebug = {
      screenPointOf(name) {
        let o: THREE.Object3D | null = null;
        scene.traverse((x) => {
          if (!o && x.name === name && !isHelper(x)) o = x;
        });
        if (!o) return null;
        const p = (o as THREE.Object3D).getWorldPosition(new THREE.Vector3()).project(get().camera);
        const r = dom.getBoundingClientRect();
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      },
      gizmoAxis: () => tc.axis,
      frozen: () => freezer.frozen,
      selectedTag: () => selectedTag,
      freezeBroken: () => freezeBroken,
      info: () => ({ canvases: document.querySelectorAll('canvas').length, view: bus.view, armed: bus.armed }),
    };
    (window as unknown as { __prismFreezeCheck?: (delta: number) => void }).__prismFreezeCheck = (delta) => {
      if (freezer.frozen && delta !== 0 && !freezeBroken) {
        freezeBroken = true;
        console.warn('Prismbox d9: the R3F clock is frozen but a frame reported a non-zero delta; R3F may no longer drive frames with clock.getDelta().');
      }
    };

    return () => {
      bus.handler = null;
      BLOCKED.forEach((t) => dom.removeEventListener(t, block));
      freezer.dispose();
      orbit?.dispose();
      scene.remove(helper);
      scene.remove(box);
      tc.dispose();
      box.dispose();
      delete window.__prismDebug;
    };
  }, [gl, scene, get, set]);

  useFrame((_state, delta) => {
    (window as unknown as { __prismFrame?: () => void }).__prismFrame?.();
    (window as unknown as { __prismFreezeCheck?: (d: number) => void }).__prismFreezeCheck?.(delta);
  });

  return null;
}
