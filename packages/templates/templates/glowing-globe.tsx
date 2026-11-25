import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";

// Glowing globe: a dotted planet with an atmosphere rim, orbit rings and a starfield. Reacts to the pointer.

const globeVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vObj = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const globeFragment = /* glsl */ `
  // @prism uniform uDots float 40..160 =96
  // @prism uniform uLand float -0.4..0.4 =0.02
  // @prism uniform uGlow float 0..3 =1.9
  uniform float uDots;
  uniform float uLand;
  uniform float uGlow;
  uniform vec3 uLandColor;
  uniform vec3 uSeaColor;
  uniform vec3 uRimColor;
  varying vec3 vObj;
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
  // Schlick-style rim term: 0 when facing the camera, 1 at grazing angles.
  float fresnel(vec3 n, vec3 v, float power) {
    return pow(1.0 - clamp(dot(normalize(n), normalize(v)), 0.0, 1.0), power);
  }
  void main() {
    vec3 p = normalize(vObj);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);
    float rows = uDots * 0.5;
    float row = floor((lat / 3.14159 + 0.5) * rows);
    float rowLat = ((row + 0.5) / rows - 0.5) * 3.14159;
    float cols = max(floor(uDots * cos(rowLat)), 6.0);
    float cell = floor((lon / 6.28318 + 0.5) * cols);
    float cellLon = ((cell + 0.5) / cols - 0.5) * 6.28318;
    vec3 center = vec3(cos(rowLat) * cos(cellLon), sin(rowLat), cos(rowLat) * sin(cellLon));
    float land = smoothstep(uLand - 0.04, uLand + 0.04, fbm(center * 1.7 + 3.0));
    float dist = distance(p, center) * uDots * 0.5;
    float radius = mix(0.16, 0.40, land);
    float dotMask = 1.0 - smoothstep(radius - 0.08, radius + 0.04, dist);
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float f = fresnel(n, v, 2.5);
    float light = 0.35 + 0.65 * clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0, 1.0);
    vec3 base = mix(uSeaColor, uLandColor, land) * dotMask * light * uGlow;
    vec3 col = base * (0.55 + 0.9 * (1.0 - f)) + uRimColor * f * 0.55;
    col += uSeaColor * 0.05;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const globeUniforms = {
  uDots: { value: 96 },
  uLand: { value: 0.02 },
  uGlow: { value: 1.9 },
  uLandColor: { value: new THREE.Color("#5ff3ff") },
  uSeaColor: { value: new THREE.Color("#1a4f8f") },
  uRimColor: { value: new THREE.Color("#2f8bff") },
};

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const atmosphereFragment = /* glsl */ `
  // @prism uniform uPower float 1..6 =2.4
  uniform float uPower;
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vView;
  // Schlick-style rim term: 0 when facing the camera, 1 at grazing angles.
  float fresnel(vec3 n, vec3 v, float power) {
    return pow(1.0 - clamp(dot(normalize(n), normalize(v)), 0.0, 1.0), power);
  }
  void main() {
    float f = pow(clamp(dot(normalize(-vNormal), normalize(vView)), 0.0, 1.0), uPower);
    gl_FragColor = vec4(uColor * f * 1.8, f * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereUniforms = {
  uPower: { value: 2.4 },
  uColor: { value: new THREE.Color("#3d8bff") },
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
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, state.pointer.x * strength, 3, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, -state.pointer.y * strength, 3, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#03050b"]} />
      <Stars radius={60} depth={40} count={3500} factor={3.2} saturation={0.4} fade speed={0.6} />
      <MouseFollow strength={0.2}>
        <group name="planet" rotation={[0.35, 0, -0.2]}>
          <Spin speed={0.18}>
            <mesh name="globe">
              <sphereGeometry args={[1.6, 128, 128]} />
              <shaderMaterial vertexShader={globeVertex} fragmentShader={globeFragment} uniforms={globeUniforms} />
            </mesh>
          </Spin>
          <mesh name="atmosphere" scale={1.09}>
            <sphereGeometry args={[1.6, 64, 64]} />
            <shaderMaterial vertexShader={atmosphereVertex} fragmentShader={atmosphereFragment} uniforms={atmosphereUniforms} transparent depthWrite={false} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
        <mesh name="ring-inner" rotation={[1.25, 0.2, 0]}>
          <torusGeometry args={[2.35, 0.006, 8, 220]} />
          <meshBasicMaterial color="#5ff3ff" transparent opacity={0.55} />
        </mesh>
        <mesh name="ring-outer" rotation={[1.05, -0.35, 0.3]}>
          <torusGeometry args={[2.85, 0.004, 8, 220]} />
          <meshBasicMaterial color="#8a7bff" transparent opacity={0.4} />
        </mesh>
      </MouseFollow>
    </Canvas>
  );
}
