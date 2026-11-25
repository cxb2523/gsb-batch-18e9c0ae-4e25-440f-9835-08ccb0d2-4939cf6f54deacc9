/**
 * The real-page overlay (`virtual:prism-overlay`). instrument() injects <__PrismOverlay /> as the last child of the
 * user's <Canvas>. Everything here runs in the user's page in dev only. It is OBSERVATION plus bounded PROPOSALS:
 * it can never write a file, only ask the daemon, which accepts proposals only while Studio is armed (d8).
 */
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ClockFreezer } from './clock';

declare const __PRISMBOX_DAEMON__: string | undefined;

type Mode = 'translate' | 'rotate' | 'scale';
type Triple = [number, number, number];
type Changes = Partial<Record<'position' | 'rotation' | 'scale', { from: Triple; to: Triple }>>;

const BLOCKED = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'pointerleave', 'pointercancel'] as const;
const ACCENT = '#7c6cff';
const round3 = (n: number): number => Math.round(n * 1000) / 1000 || 0;
const triple = (v: { x: number; y: number; z: number }): Triple => [round3(v.x), round3(v.y), round3(v.z)];
const tagOf = (o: unknown): string | undefined => {
  const p = (o as { userData?: { prism?: unknown } } | null | undefined)?.userData?.prism;
  return typeof p === 'string' ? p : undefined;
};
const isHelper = (o: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if ((p as THREE.Object3D & { userData: { prismHelper?: boolean } }).userData.prismHelper) return true;
  return false;
};

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

// ---- shared (module-level) state: one daemon connection per page, whichever <Canvas> mounts the overlay ----
const S = {
  armed: false,
  selected: null as string | null,
  gizmo: 'translate' as Mode,
  view: 'scene' as 'scene' | 'free',
  connected: false,
  ws: null as WebSocket | null,
  nextId: 1,
  pending: new Map<number, (r: { ok: boolean; code?: string; message?: string }) => void>(),
  apply: null as null | ((m: Record<string, unknown>) => void),
  lastError: null as string | null,
  rejections: [] as { code?: string; message?: string }[],
};

function send(m: unknown): boolean {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(m));
    return true;
  }
  return false;
}

let started = false;
function connect(): void {
  const origin = typeof __PRISMBOX_DAEMON__ === 'string' ? __PRISMBOX_DAEMON__ : '';
  if (started || !origin) return;
  started = true;
  let delay = 500;
  const open = async () => {
    try {
      const { token } = (await (await fetch(`${origin}/__prism/page-token`)).json()) as { token: string };
      const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/page`);
      S.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, url: location.pathname }));
      ws.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.type === 'hello-ok') {
          S.connected = true;
          delay = 500;
          S.armed = m.armed === true;
          S.apply?.({ type: 'arm', value: S.armed });
        } else if (m.type === 'proposal-result') {
          const cb = S.pending.get(m.id as number);
          S.pending.delete(m.id as number);
          if (m.ok !== true) S.rejections.push({ code: m.code as string, message: m.message as string });
          cb?.({ ok: m.ok === true, code: m.code as string, message: m.message as string });
        } else S.apply?.(m);
      };
      ws.onclose = () => {
        S.connected = false;
        S.armed = false;
        S.apply?.({ type: 'arm', value: false });
        setTimeout(open, (delay = Math.min(delay * 2, 8000)));
      };
      ws.onerror = () => ws.close();
    } catch {
      setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    }
  };
  void open();
}

function propose(tag: string, changes: Changes): Promise<{ ok: boolean; code?: string; message?: string }> {
  const id = S.nextId++;
  return new Promise((resolve) => {
    if (!send({ type: 'proposal', id, tag, changes })) return resolve({ ok: false, code: 'DISCONNECTED', message: 'Not connected to the daemon.' });
    S.pending.set(id, resolve);
    setTimeout(() => {
      if (S.pending.delete(id)) resolve({ ok: false, code: 'TIMEOUT', message: 'The daemon did not answer.' });
    }, 8000);
  });
}

declare global {
  interface Window {
    __prismDebug?: Record<string, unknown>;
  }
}

export function __PrismOverlay() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const set = useThree((s) => s.set);

  useEffect(() => {
    connect();
    const dom = gl.domElement;
    const sceneCam = get().camera;
    let freeCam: THREE.Camera | null = null;
    let orbit: OrbitControls | null = null;

    const tc = new TransformControls(sceneCam, dom); // registers its own listeners first
    tc.size = 0.85;
    const helper = tc.getHelper();
    helper.userData.prismHelper = true;
    scene.add(helper);
    const box = new THREE.BoxHelper(new THREE.Object3D(), ACCENT);
    box.userData.prismHelper = true;
    box.visible = false;
    scene.add(box);

    // "Editing live" badge
    const badge = document.createElement('div');
    badge.textContent = 'Prismbox: editing live. The 3D scene ignores your pointer handlers.';
    badge.setAttribute('style', `position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;padding:4px 12px;border-radius:999px;font:12px/1.4 system-ui,sans-serif;color:#e8e9ef;background:rgba(16,17,23,.88);border:1px solid ${ACCENT};pointer-events:none;display:none`);
    document.body.appendChild(badge);

    const freezer = new ClockFreezer(get().clock);
    let selected: THREE.Object3D | null = null;
    let selectedTag: string | null = null;
    const raycaster = new THREE.Raycaster();
    const frozenReport = () => send({ type: 'frozen', value: freezer.frozen });
    const setFrozen = (reason: 'hover' | 'drag', on: boolean) => {
      const was = freezer.frozen;
      freezer.set(reason, on && S.armed);
      if (was !== freezer.frozen) frozenReport();
    };

    function select(tag: string | null) {
      selectedTag = tag;
      selected = tag ? (findByTag(scene, tag)?.object ?? null) : null;
      if (selected && S.armed) {
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
      S.selected = tag;
      select(tag);
      send({ type: 'pick', tag });
    }

    // Registered after TransformControls' listeners (same element, registration order) so the gizmo still gets every
    // event; then nothing reaches R3F or the page's own handlers while armed.
    let down: { x: number; y: number; onGizmo: boolean } | null = null;
    const block = (e: Event) => {
      if (!S.armed) return;
      e.stopPropagation();
      const pe = e as PointerEvent;
      if (e.type === 'pointerdown' && pe.button === 0) down = { x: pe.clientX, y: pe.clientY, onGizmo: tc.axis !== null };
      if (e.type === 'pointerup' && pe.button === 0 && down) {
        if (Math.hypot(pe.clientX - down.x, pe.clientY - down.y) < 5 && !down.onGizmo) pick(pe);
        down = null;
      }
    };
    BLOCKED.forEach((t) => dom.addEventListener(t, block));

    tc.addEventListener('axis-changed', (ev) => setFrozen('hover', (ev as unknown as { value: unknown }).value !== null && !tc.dragging));
    let before: { position: Triple; rotation: Triple; scale: Triple } | null = null;
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
        const b = before;
        before = null;
        const after = { position: triple(o.position), rotation: triple(o.rotation), scale: triple(o.scale) };
        const changes: Changes = {};
        for (const k of ['position', 'rotation', 'scale'] as const) if (b[k].some((v, i) => v !== after[k][i])) changes[k] = { from: b[k], to: after[k] };
        const tag = tagOf(o);
        if (!tag || Object.keys(changes).length === 0) return;
        // ONE proposal, at drag end. If the daemon refuses it (disarmed, stale, rate limited), put the object back.
        void propose(tag, changes).then((r) => {
          if (r.ok) return;
          S.lastError = `${r.code}: ${r.message}`;
          o.position.set(...b.position);
          o.rotation.set(...b.rotation);
          o.scale.set(...b.scale);
          if (selected) box.setFromObject(selected);
        });
      }
    });

    function setView(mode: 'scene' | 'free') {
      if (mode === 'free' && !freeCam) {
        freeCam = sceneCam.clone();
        orbit = new OrbitControls(freeCam, dom);
        set({ camera: freeCam as THREE.PerspectiveCamera });
        tc.camera = freeCam;
      } else if (mode === 'scene' && freeCam) {
        orbit?.dispose();
        orbit = null;
        freeCam = null;
        set({ camera: sceneCam });
        tc.camera = sceneCam;
      }
      S.view = mode;
    }

    function live(m: { tag: string; prop: string; value: unknown; uniform?: boolean }) {
      const hit = findByTag(scene, m.tag);
      if (!hit) return;
      try {
        const t = hit.target as Record<string, unknown> & { uniforms?: Record<string, { value: unknown }> };
        type SetLike = { set?: (v: unknown) => void; fromArray?: (a: number[]) => void };
        if (m.uniform) {
          const u = t.uniforms?.[m.prop];
          if (!u) return;
          const cur = u.value as SetLike | number | boolean | null;
          if (typeof m.value === 'string' && cur && typeof cur === 'object' && cur.set) cur.set(m.value);
          else if (Array.isArray(m.value) && cur && typeof cur === 'object' && cur.fromArray) cur.fromArray(m.value as number[]);
          else u.value = m.value;
          return;
        }
        const cur = t[m.prop] as SetLike | undefined;
        if (m.prop === 'rotation' && Array.isArray(m.value)) (t as unknown as THREE.Object3D).rotation.set(...(m.value as Triple));
        else if (Array.isArray(m.value) && cur?.fromArray) cur.fromArray(m.value as number[]);
        else if (typeof m.value === 'string' && cur && typeof cur === 'object' && cur.set) cur.set(m.value);
        else if (m.prop in t) t[m.prop] = m.value;
        if (selected) box.setFromObject(selected);
      } catch {
        /* a live preview must never break the page; the committed edit is what counts */
      }
    }

    // prism_get_view: render synchronously and read the canvas in the SAME task (no preserveDrawingBuffer needed), gizmo and
    // selection box hidden. Wider than 1280 px is downscaled so the image stays a sensible size for an agent.
    function captureNow() {
      const vis = helper.visible;
      const bvis = box.visible;
      helper.visible = false;
      box.visible = false;
      try {
        gl.render(scene, get().camera);
        let url = dom.toDataURL('image/png');
        let width = dom.width;
        let height = dom.height;
        if (width > 1280) {
          const c = document.createElement('canvas');
          c.width = 1280;
          c.height = Math.round((height * 1280) / width);
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(dom, 0, 0, c.width, c.height);
            url = c.toDataURL('image/png');
            width = c.width;
            height = c.height;
          }
        }
        return { url, width, height };
      } finally {
        helper.visible = vis;
        box.visible = bvis;
      }
    }

    S.apply = (m) => {
      switch (m.type) {
        case 'capture': {
          const id = m.id as number;
          try {
            const cam = get().camera as THREE.PerspectiveCamera;
            const out = captureNow();
            const r = dom.getBoundingClientRect();
            send({
              type: 'capture-result', id, ok: true, ...out,
              camera: { position: triple(cam.position), rotation: triple(cam.rotation), fov: typeof cam.fov === 'number' ? round3(cam.fov) : null, type: cam.type },
              viewport: { cssWidth: Math.round(r.width), cssHeight: Math.round(r.height), dpr: window.devicePixelRatio },
            });
          } catch (e) {
            send({ type: 'capture-result', id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }
        case 'arm':
          S.armed = m.value === true;
          badge.style.display = S.armed ? 'block' : 'none';
          if (!S.armed) {
            freezer.set('hover', false);
            freezer.set('drag', false);
            frozenReport();
          }
          select(S.armed ? (selectedTag ?? S.selected) : null);
          break;
        case 'recheck':
          if (!tc.dragging && S.armed && selectedTag && findByTag(scene, selectedTag)?.object !== selected) select(selectedTag);
          break;
        case 'select':
          S.selected = (m.tag as string | null) ?? null;
          select(S.selected);
          break;
        case 'view':
          setView(m.mode as 'scene' | 'free');
          break;
        case 'gizmo':
          S.gizmo = m.mode as Mode;
          tc.setMode(S.gizmo);
          break;
        case 'live':
          live(m as { tag: string; prop: string; value: unknown; uniform?: boolean });
          break;
      }
    };
    tc.setMode(S.gizmo);
    if (S.armed) S.apply({ type: 'arm', value: true });

    const screenPointOf = (name: string) => {
      let o: THREE.Object3D | null = null;
      scene.traverse((x) => {
        if (!o && x.name === name && !isHelper(x)) o = x;
      });
      if (!o) return null;
      const p = (o as THREE.Object3D).getWorldPosition(new THREE.Vector3()).project(get().camera);
      const r = dom.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    // a screen point that really hits the object (a torus knot has a hole at its centre)
    const hitPointOf = (name: string) => {
      const o2 = byName(name);
      const c = screenPointOf(name);
      if (!o2 || !c) return null;
      const r = dom.getBoundingClientRect();
      for (let rad = 0; rad <= 320; rad += 8) {
        for (let a = 0; a < 16; a++) {
          const x = c.x + Math.cos((a / 16) * Math.PI * 2) * rad;
          const y = c.y + Math.sin((a / 16) * Math.PI * 2) * rad;
          raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), get().camera);
          if (raycaster.intersectObject(o2, true).length) return { x, y };
        }
      }
      return null;
    };
    const byName = (name: string): THREE.Object3D | null => {
      let o: THREE.Object3D | null = null;
      scene.traverse((x) => {
        if (!o && x.name === name && !isHelper(x)) o = x;
      });
      return o;
    };
    window.__prismDebug = {
      screenPointOf,
      hitPointOf,
      gizmoAxis: () => tc.axis,
      frozen: () => freezer.frozen,
      info: () => ({ connected: S.connected, armed: S.armed, view: S.view, selected: S.selected, lastError: S.lastError, rejections: S.rejections.length, canvases: document.querySelectorAll('canvas').length, clockElapsed: get().clock.elapsedTime }),
      localPosition: (name: string) => {
        const o = byName(name);
        return o ? triple(o.position) : null;
      },
      uniform: (name: string, key: string) => {
        const o = byName(name) as THREE.Mesh | null;
        const u = (o?.material as THREE.ShaderMaterial | undefined)?.uniforms?.[key]?.value;
        return typeof u === 'number' ? u : u && typeof u === 'object' && 'toArray' in u ? (u as { toArray(): number[] }).toArray() : null;
      },
      /** Send a raw proposal as a page would (used to test that the daemon refuses forged or disarmed edits). */
      forgeProposal: (tag: string, changes: Changes) => propose(tag, changes),
      /** prism_get_view (M3): synchronous render + read in the SAME task, gizmo hidden. Needs no preserveDrawingBuffer. */
      capture: () => captureNow(),
    };

    return () => {
      S.apply = null;
      BLOCKED.forEach((t) => dom.removeEventListener(t, block));
      freezer.dispose();
      orbit?.dispose();
      scene.remove(helper);
      scene.remove(box);
      tc.dispose();
      box.dispose();
      badge.remove();
      delete window.__prismDebug;
    };
  }, [gl, scene, get, set]);

  let frame = 0;
  useFrame(() => {
    frame++;
    if (frame % 20 !== 0) return;
    // after HMR the selected object may have been replaced: re-find it by tag
    S.apply?.({ type: 'recheck' });
  });

  return null;
}
