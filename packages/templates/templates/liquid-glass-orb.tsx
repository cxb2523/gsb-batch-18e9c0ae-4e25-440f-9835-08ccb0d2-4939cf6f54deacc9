import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// Liquid-glass orb: a noise-displaced sphere that refracts and reflects a procedural photo studio.
// Edit the sliders in the shader comments, or any literal prop below. No dependencies beyond R3F.

const orbVertex = /* glsl */ `
  uniform float uTime;
  uniform float uWobble;
  varying vec3 vNormal;
  varying vec3 vView;
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
  vec3 displace(vec3 p, vec3 n) {
    return p + n * snoise(p * 0.9 + vec3(0.0, uTime * 0.22, uTime * 0.17)) * uWobble;
  }
  void main() {
    vec3 p = displace(position, normal);
    vec3 t1 = normalize(cross(normal, vec3(0.0, 1.0, 0.001)));
    vec3 t2 = cross(normal, t1);
    vec3 pa = displace(position + t1 * 0.02, normal);
    vec3 pb = displace(position + t2 * 0.02, normal);
    vec3 n = normalize(cross(pa - p, pb - p));
    if (dot(n, normal) < 0.0) n = -n;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * n);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const orbFragment = /* glsl */ `
  // @prism uniform uIor float 1..2 =1.35
  // @prism uniform uDispersion float 0..0.12 =0.05
  // @prism uniform uRim float 0..4 =2.4
  uniform float uIor;
  uniform float uDispersion;
  uniform float uRim;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  varying vec3 vNormal;
  varying vec3 vView;
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
  vec3 refractEnv(vec3 incident, vec3 n, float eta) {
    vec3 r = refract(incident, n, 1.0 / eta);
    return studioEnv(length(r) > 0.001 ? normalize(r) : reflect(incident, n));
  }
  void main() {
    vec3 n = viewToWorld(normalize(vNormal));
    vec3 v = viewToWorld(normalize(vView));
    vec3 incident = -v;
    float f = fresnel(n, v, 3.0);
    vec3 refl = studioEnv(reflect(incident, n));
    vec3 body = vec3(
      refractEnv(incident, n, uIor - uDispersion).r,
      refractEnv(incident, n, uIor).g,
      refractEnv(incident, n, uIor + uDispersion).b
    );
    float depth = pow(clamp(dot(n, v), 0.0, 1.0), 1.5);
    vec3 tint = mix(uTintB, uTintA, 0.5 + 0.5 * n.y);
    vec3 col = body * tint * 1.25 + tint * depth * 0.22;
    col = mix(col, refl, clamp(f * 0.9 + 0.07, 0.0, 1.0));
    float spec = pow(max(dot(reflect(incident, n), normalize(vec3(-0.5, 0.7, 0.55))), 0.0), 90.0);
    col += vec3(1.0) * spec * 3.5;
    col += vec3(0.35, 0.55, 1.0) * pow(max(dot(n, normalize(vec3(0.9, 0.1, -0.4))), 0.0), 6.0) * f * 1.4;
    vec3 film = palette(f * 1.4 + n.x * 0.25, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    col += film * pow(f, 2.0) * uRim * 0.28;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const orbUniforms = {
  uTime: { value: 0 },
  uWobble: { value: 0.07 },
  uIor: { value: 1.35 },
  uDispersion: { value: 0.05 },
  uRim: { value: 2.4 },
  uTintA: { value: new THREE.Color("#8fb4ff") },
  uTintB: { value: new THREE.Color("#c9a7ff") },
};

const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backdropFragment = /* glsl */ `
  // @prism uniform uGlow float 0..1.5 =0.55
  uniform float uGlow;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
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
    vec2 p = vUv - vec2(0.5, 0.52);
    float r = length(p * vec2(1.0, 1.5));
    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.7, r)) * uGlow * (1.0 - smoothstep(0.0, 0.75, r));
    col += grain(gl_FragCoord.xy) * 0.012;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const backdropUniforms = {
  uGlow: { value: 0.55 },
  uColorA: { value: new THREE.Color("#1a2268") },
  uColorB: { value: new THREE.Color("#06070f") },
};

function Spin({ speed, children }: { speed: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return <group name="spin" ref={ref}>{children}</group>;
}

function MouseFollow({ strength, children }: { strength: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, state.pointer.x * strength, 4, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, -state.pointer.y * strength, 4, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

/** Feeds the clock to the shader uniforms. Pausing the R3F clock (the editor does this while you drag) pauses the shaders too. */
function Clock() {
  useFrame((state) => {
    orbUniforms.uTime.value = state.clock.elapsedTime;
  });
  return null;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 6.6], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#05060c"]} />
      <mesh name="backdrop" position={[0, 0, -6]}>
        <planeGeometry args={[34, 20]} />
        <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} uniforms={backdropUniforms} depthWrite={false} />
      </mesh>
      <Clock />
      <MouseFollow strength={0.25}>
        <Spin speed={0.12}>
          <mesh name="orb" position={[0, 0.05, 0]}>
            <icosahedronGeometry args={[1.3, 64]} />
            <shaderMaterial vertexShader={orbVertex} fragmentShader={orbFragment} uniforms={orbUniforms} />
          </mesh>
        </Spin>
      </MouseFollow>
    </Canvas>
  );
}
