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
  //@include noise
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
  //@include studio
  //@include fresnel
  //@include palette
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
  //@include palette
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
