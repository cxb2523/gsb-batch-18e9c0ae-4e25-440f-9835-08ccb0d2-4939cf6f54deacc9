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
  //@include noise
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
  //@include palette
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
