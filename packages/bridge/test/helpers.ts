import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createDaemon } from '../src/daemon/server';
import type { Daemon, DaemonOptions } from '../src/daemon/server';

export const TOKEN = 'test-token-0123456789';
export const PAGE_ORIGIN = 'http://localhost:5173';

export const HERO = `import { Canvas } from "@react-three/fiber";

const uniforms = { uFilm: { value: 1.4 }, uMix: { value: 0.5 } };
const frag = /* glsl */ \`
  // @prism uniform uFilm float 0..3 =1.4
  void main() { gl_FragColor = vec4(1.0); }
\`;
const vert = /* glsl */ \`void main() { gl_Position = vec4(0.0); }\`;

export default function Hero3D() {
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 40 }}>
      <group name="rig" position={[0, 0, 0]}>
        <mesh name="knot" position={[0, 0, 0]} scale={1}>
          <torusKnotGeometry args={[1, 0.3, 128, 16]} />
          <shaderMaterial name="film" vertexShader={vert} fragmentShader={frag} uniforms={uniforms} />
        </mesh>
      </group>
    </Canvas>
  );
}
`;

export interface Fixture {
  root: string;
  file: string;
  abs: string;
  cleanup(): void;
}

export function fixture(source: string = HERO, file = 'src/Hero3D.tsx'): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'prismbox-test-'));
  const abs = path.join(root, ...file.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
  return { root, file, abs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const read = (abs: string): Buffer => readFileSync(abs);
export const tmpLeft = (dir: string): string[] => readdirSync(dir).filter((f) => f.startsWith('.prismbox-tmp-'));

export interface Client {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  send(m: unknown): void;
  waitFor(pred: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
  closed: Promise<number>;
  close(): void;
}

function wrap(ws: WebSocket): Client {
  const messages: Record<string, unknown>[] = [];
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as Record<string, unknown>;
    messages.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return {
    ws,
    messages,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor(pred, ms = 4000) {
      const hit = messages.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out waiting for a message; saw: ${JSON.stringify(messages.map((x) => x.type))}`)), ms);
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
    closed: new Promise((resolve) => ws.on('close', (code) => resolve(code))),
    close: () => ws.close(),
  };
}

export interface Rig {
  daemon: Daemon;
  port: number;
  origin: string;
  fx: Fixture;
  studio(opts?: { token?: string; origin?: string }): Promise<Client>;
  page(opts?: { origin?: string }): Promise<Client>;
  pageToken(origin?: string): Promise<string>;
  httpGet(pathname: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  stop(): Promise<void>;
}

export async function rig(fx: Fixture = fixture(), extra: Partial<DaemonOptions> = {}): Promise<Rig> {
  const daemon = createDaemon({ root: fx.root, token: TOKEN, port: 0, watch: false, ...extra });
  const { port, origin } = await daemon.listen();
  daemon.allowPageOrigin(PAGE_ORIGIN);
  const clients: Client[] = [];
  const open = (p: string, origin2: string): Promise<Client> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers: { Origin: origin2 } });
      const c = wrap(ws);
      clients.push(c);
      ws.on('open', () => resolve(c));
      ws.on('error', reject);
      ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  const r: Rig = {
    daemon, port, origin, fx,
    async studio(o = {}) {
      const c = await open('/studio', o.origin ?? origin);
      c.send({ type: 'hello', token: o.token ?? TOKEN });
      return c;
    },
    async pageToken(o = PAGE_ORIGIN) {
      const res = await r.httpGet('/__prism/page-token', { Origin: o });
      if (res.status !== 200) throw new Error(`page-token ${res.status}`);
      return (JSON.parse(res.body) as { token: string }).token;
    },
    async page(o = {}) {
      const token = await r.pageToken(o.origin ?? PAGE_ORIGIN);
      const c = await open('/page', o.origin ?? PAGE_ORIGIN);
      c.send({ type: 'hello', token });
      await c.waitFor((m) => m.type === 'hello-ok');
      return c;
    },
    httpGet: (p, headers = {}) =>
      new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }).on('error', reject);
      }),
    async stop() {
      clients.forEach((c) => c.ws.terminate());
      await daemon.close();
      fx.cleanup();
    },
  };
  return r;
}

export async function ready(s: Client): Promise<Record<string, unknown>> {
  return s.waitFor((m) => m.type === 'ready');
}
