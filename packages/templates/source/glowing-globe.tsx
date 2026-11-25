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
  //@include noise
  //@include fresnel
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
  //@include fresnel
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
