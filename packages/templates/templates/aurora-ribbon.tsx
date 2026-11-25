import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";

// Aurora ribbon: three layered curtains of light drifting over a starfield.

const auroraVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uWave;
  varying vec2 vUv;
  varying float vFold;
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
  void main() {
    vUv = uv;
    vec3 p = position;
    float fold = snoise(vec3(p.x * 0.22 + uPhase, uTime * 0.12, 0.0));
    p.z += fold * uWave * (0.4 + 0.6 * uv.y);
    p.y += snoise(vec3(p.x * 0.35, uTime * 0.18 + uPhase, 3.0)) * 0.35 * uv.y;
    vFold = fold;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const auroraFragment = /* glsl */ `
  // @prism uniform uIntensity float 0..3 =1.4
  // @prism uniform uRays float 4..40 =30
  uniform float uTime;
  uniform float uIntensity;
  uniform float uRays;
  uniform float uPhase;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  varying vec2 vUv;
  varying float vFold;
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
  void main() {
    float rays = 0.3 + 0.7 * snoise(vec3(vUv.x * uRays + uPhase * 3.0, uTime * 0.25, vUv.y * 0.6));
    float curtain = pow(clamp(vUv.y, 0.0, 1.0), 1.1) * (1.0 - smoothstep(0.5, 1.0, vUv.y)) * 1.25;
    float bottom = smoothstep(0.0, 0.08, vUv.y);
    float a = curtain * rays * bottom;
    vec3 col = mix(uLow, uHigh, smoothstep(0.1, 0.9, vUv.y + vFold * 0.12));
    float edgeFade = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    a *= edgeFade * uIntensity;
    gl_FragColor = vec4(col * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const auroraGreen = {
  uTime: { value: 0 },
  uPhase: { value: 0 },
  uWave: { value: 1.1 },
  uIntensity: { value: 1.4 },
  uRays: { value: 30 },
  uLow: { value: new THREE.Color("#19ffa0") },
  uHigh: { value: new THREE.Color("#2fa8ff") },
};

const auroraViolet = {
  uTime: { value: 0 },
  uPhase: { value: 4.2 },
  uWave: { value: 1.4 },
  uIntensity: { value: 1.0 },
  uRays: { value: 22 },
  uLow: { value: new THREE.Color("#35e0c0") },
  uHigh: { value: new THREE.Color("#a64dff") },
};

const auroraPink = {
  uTime: { value: 0 },
  uPhase: { value: 8.7 },
  uWave: { value: 1.0 },
  uIntensity: { value: 0.7 },
  uRays: { value: 36 },
  uLow: { value: new THREE.Color("#4dd8ff") },
  uHigh: { value: new THREE.Color("#ff5fb0") },
};

/** Feeds the clock to the shader uniforms. Pausing the R3F clock (the editor does this while you drag) pauses the shaders too. */
function Clock() {
  useFrame((state) => {
    auroraGreen.uTime.value = state.clock.elapsedTime;
    auroraViolet.uTime.value = state.clock.elapsedTime;
    auroraPink.uTime.value = state.clock.elapsedTime;
  });
  return null;
}

function Sway({ speed, range, children }: { speed: number; range: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * speed) * range;
  });
  return <group name="sway" ref={ref}>{children}</group>;
}

function MouseFollow({ strength, children }: { strength: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, state.pointer.x * strength, 3, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, -state.pointer.y * strength * 0.5, 3, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

const groundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const groundFragment = /* glsl */ `
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
    vec3 col = mix(vec3(0.004, 0.008, 0.02), vec3(0.01, 0.03, 0.05), smoothstep(0.0, 1.0, vUv.y));
    col += grain(gl_FragCoord.xy) * 0.01;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0.4, 7], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={["#02040a"]} />
      <mesh name="sky" position={[0, 1, -14]}>
        <planeGeometry args={[70, 36]} />
        <shaderMaterial vertexShader={groundVertex} fragmentShader={groundFragment} depthWrite={false} />
      </mesh>
      <Stars radius={50} depth={30} count={3000} factor={2.6} saturation={0.2} fade speed={0.4} />
      <Clock />
      <MouseFollow strength={0.18}>
        <Sway speed={0.12} range={0.12}>
          <mesh name="aurora-green" position={[0, -0.6, -1]} rotation={[0.15, 0, 0]}>
            <planeGeometry args={[16, 5, 240, 24]} />
            <shaderMaterial vertexShader={auroraVertex} fragmentShader={auroraFragment} uniforms={auroraGreen} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh name="aurora-violet" position={[0.8, -0.2, -2.6]} rotation={[0.1, 0.08, 0.02]}>
            <planeGeometry args={[16, 5, 240, 24]} />
            <shaderMaterial vertexShader={auroraVertex} fragmentShader={auroraFragment} uniforms={auroraViolet} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh name="aurora-pink" position={[-1, 0.1, -4.2]} rotation={[0.05, -0.1, -0.03]}>
            <planeGeometry args={[16, 5, 240, 24]} />
            <shaderMaterial vertexShader={auroraVertex} fragmentShader={auroraFragment} uniforms={auroraPink} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
        </Sway>
      </MouseFollow>
    </Canvas>
  );
}
