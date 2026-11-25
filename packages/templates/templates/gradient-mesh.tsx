import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// Gradient mesh: a lit, rippling ribbon of colour in the style of a payments-landing-page hero.

const meshVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uSpeed;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vNormal;
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
  float height(vec2 p) {
    p += vec2(0.0137, 0.0091); // keep the noise lattice off the exact origin
    float t = uTime * uSpeed;
    float h = snoise(vec3(p * 0.28, t * 0.35)) * 1.0;
    h += snoise(vec3(p * 0.62 + 11.0, t * 0.55)) * 0.45;
    return h * uAmplitude;
  }
  void main() {
    vUv = uv;
    float e = 0.06;
    float h = height(position.xy);
    vec3 pc = vec3(position.xy, h);
    vec3 px = vec3(position.xy + vec2(e, 0.0), height(position.xy + vec2(e, 0.0)));
    vec3 py = vec3(position.xy + vec2(0.0, e), height(position.xy + vec2(0.0, e)));
    vNormal = normalize(normalMatrix * normalize(cross(px - pc, py - pc)));
    vHeight = h / max(uAmplitude, 0.001);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pc, 1.0);
  }
`;

const meshFragment = /* glsl */ `
  // @prism uniform uLight float 0..2 =1
  // @prism uniform uSheen float 0..2 =0.8
  uniform float uLight;
  uniform float uSheen;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uColorD;
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vNormal;
  // Cosine palette (Inigo Quilez): a + b * cos(2pi * (c * t + d)).
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }

  // Cheap hash grain, in [-0.5, 0.5], to break up banding in dark gradients.
  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }
  void main() {
    vec3 n = normalize(vNormal);
    float t = clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.45, t));
    col = mix(col, uColorC, smoothstep(0.35, 0.75, t));
    col = mix(col, uColorD, smoothstep(0.7, 1.0, t));
    col = mix(col, uColorB, 0.35 * smoothstep(0.0, 1.0, vUv.x));
    vec3 l = normalize(vec3(-0.5, 0.7, 0.8));
    float diffuse = clamp(dot(n, l), 0.0, 1.0);
    vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), 48.0);
    col *= mix(0.30, 1.0, smoothstep(-0.2, 0.9, t)) * (0.25 + 0.95 * diffuse * uLight);
    col += vec3(1.0, 0.95, 0.9) * spec * 0.35 * uSheen;
    col += grain(gl_FragCoord.xy) * 0.01;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const meshUniforms = {
  uTime: { value: 0 },
  uAmplitude: { value: 0.6 },
  uSpeed: { value: 0.7 },
  uLight: { value: 1 },
  uSheen: { value: 0.8 },
  uColorA: { value: new THREE.Color("#3a1fe0") },
  uColorB: { value: new THREE.Color("#0a8bff") },
  uColorC: { value: new THREE.Color("#ff2a8a") },
  uColorD: { value: new THREE.Color("#ff9a3a") },
};

function Parallax({ strength, children }: { strength: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, state.pointer.x * strength, 3, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, state.pointer.y * strength * 0.6, 3, delta);
  });
  return <group name="parallax" ref={ref}>{children}</group>;
}

/** Feeds the clock to the shader uniforms. Pausing the R3F clock (the editor does this while you drag) pauses the shaders too. */
function Clock() {
  useFrame((state) => {
    meshUniforms.uTime.value = state.clock.elapsedTime;
  });
  return null;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 5.6], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#07070f"]} />
      <Clock />
      <Parallax strength={0.25}>
        <mesh name="ribbon" position={[0, 0.3, -0.5]} rotation={[-0.85, 0, 0.22]}>
          <planeGeometry args={[22, 18, 260, 200]} />
          <shaderMaterial vertexShader={meshVertex} fragmentShader={meshFragment} uniforms={meshUniforms} side={THREE.DoubleSide} />
        </mesh>
      </Parallax>
    </Canvas>
  );
}
