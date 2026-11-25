import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// The 3D hero of the landing page: an iridescent torus knot. Plain React Three Fiber, nothing else.
declare global {
  interface Window {
    __heroClicks?: Record<string, number>;
  }
}
const bump = (k: string) => () => {
  window.__heroClicks = { ...window.__heroClicks, [k]: (window.__heroClicks?.[k] ?? 0) + 1 };
};

const knotVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const knotFragment = /* glsl */ `
  // @prism uniform uFilm float 0..3 =1.4
  // @prism uniform uShift float 0..1 =0.15
  // @prism uniform uChrome float 0..1 =0.85
  uniform float uTime;
  uniform float uFilm;
  uniform float uShift;
  uniform float uChrome;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vObj;
  // 3D simplex noise (after Ashima Arts / Stefan Gustavson, MIT) and fractal noise.
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 p) {
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 4; i++) {
      sum += amp * snoise(p);
      p = p * 2.02 + vec3(7.1, 3.3, 1.7);
      amp *= 0.5;
    }
    return sum;
  }
  // A procedural photo studio: dark room, a large key softbox, a cool rim strip and a magenta kicker.
  // d is a normalized WORLD-space direction. Values above 1.0 are intended (they tone-map into highlights).
  vec3 studioEnv(vec3 d) {
    vec3 col = mix(vec3(0.012, 0.014, 0.03), vec3(0.07, 0.08, 0.13), smoothstep(-0.7, 0.9, d.y));
    float key = smoothstep(0.50, 0.92, dot(d, normalize(vec3(-0.55, 0.70, 0.55))));
    col += vec3(2.6, 2.45, 2.3) * key;
    float rim = smoothstep(0.80, 0.97, dot(d, normalize(vec3(0.90, 0.25, -0.45))));
    col += vec3(0.45, 0.75, 1.9) * rim * 1.6;
    float kicker = smoothstep(0.92, 0.995, dot(d, normalize(vec3(0.35, -0.55, 0.75))));
    col += vec3(1.9, 0.55, 1.3) * kicker;
    float top = smoothstep(0.85, 0.99, d.y);
    col += vec3(0.9, 0.95, 1.2) * top * 0.8;
    return col;
  }

  // View-space direction/normal to world space (ShaderMaterial exposes viewMatrix).
  vec3 viewToWorld(vec3 v) {
    return normalize(vec3(vec4(v, 0.0) * viewMatrix));
  }
  // Schlick-style rim term: 0 when facing the camera, 1 at grazing angles.
  float fresnel(vec3 n, vec3 v, float power) {
    return pow(1.0 - clamp(dot(normalize(n), normalize(v)), 0.0, 1.0), power);
  }
  // Cosine palette (Inigo Quilez): a + b * cos(2pi * (c * t + d)).
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }

  // Cheap hash grain, in [-0.5, 0.5], to break up banding in dark gradients.
  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }
  void main() {
    vec3 n = viewToWorld(normalize(vNormal));
    vec3 v = viewToWorld(normalize(vView));
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float thickness = 0.55 + 0.35 * snoise(vObj * 0.9 + uTime * 0.05) + uShift;
    float phase = (1.0 - ndv) * uFilm + thickness * 2.0;
    vec3 film = palette(phase, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
    vec3 env = studioEnv(reflect(-v, n));
    float f = fresnel(n, v, 3.0);
    vec3 chrome = env * mix(vec3(0.9), film, 0.55);
    vec3 col = mix(film * 0.18, chrome, uChrome);
    col += film * f * 0.9;
    col += studioEnv(reflect(-v, n)) * 0.0;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const knotUniforms = {
  uTime: { value: 0 },
  uFilm: { value: 1.4 },
  uShift: { value: 0.15 },
  uChrome: { value: 0.85 },
};

const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backdropFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  // Cosine palette (Inigo Quilez): a + b * cos(2pi * (c * t + d)).
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }

  // Cheap hash grain, in [-0.5, 0.5], to break up banding in dark gradients.
  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }
  void main() {
    float r = length((vUv - vec2(0.5, 0.45)) * vec2(1.0, 1.6));
    vec3 col = uColor * pow(1.0 - smoothstep(0.0, 0.8, r), 1.6) * 0.7 + vec3(0.006, 0.006, 0.012);
    col += grain(gl_FragCoord.xy) * 0.012;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const backdropUniforms = { uColor: { value: new THREE.Color("#1a1260") } };

function Spin({ speed, children }: { speed: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * speed;
      ref.current.rotation.x += delta * speed * 0.35;
    }
  });
  return <group name="spin" ref={ref}>{children}</group>;
}

function MouseFollow({ strength, children }: { strength: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, state.pointer.x * strength, 4, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, state.pointer.y * strength, 4, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

/** Feeds the clock to the shader uniforms. Pausing the R3F clock (the editor does this while you drag) pauses the shaders too. */
function Clock() {
  useFrame((state) => {
    knotUniforms.uTime.value = state.clock.elapsedTime;
  });
  return null;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 7.5], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#05050b"]} />
      <mesh name="backdrop" position={[0, 0, -6]}>
        <planeGeometry args={[34, 20]} />
        <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} uniforms={backdropUniforms} depthWrite={false} />
      </mesh>
      <Clock />
      <group name="hero" position={[2.3, 0, 0]}>
        <MouseFollow strength={0.35}>
          <Spin speed={0.22}>
            <mesh name="knot" position={[0, 0, 0]} onClick={bump('knot.click')} onPointerDown={bump('knot.pointerdown')}>
              <torusKnotGeometry args={[1, 0.34, 400, 64, 2, 3]} />
              <shaderMaterial name="film" vertexShader={knotVertex} fragmentShader={knotFragment} uniforms={knotUniforms} />
            </mesh>
          </Spin>
        </MouseFollow>
      </group>
    </Canvas>
  );
}
