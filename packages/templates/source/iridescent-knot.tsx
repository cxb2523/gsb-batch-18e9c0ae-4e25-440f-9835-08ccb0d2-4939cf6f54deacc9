import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// Iridescent torus knot: thin-film colour shifts over a chrome body lit by a procedural photo studio.

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
  //@include noise
  //@include studio
  //@include fresnel
  //@include palette
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
  //@include palette
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
    <Canvas camera={{ position: [0, 0, 7], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#05050b"]} />
      <mesh name="backdrop" position={[0, 0, -6]}>
        <planeGeometry args={[34, 20]} />
        <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} uniforms={backdropUniforms} depthWrite={false} />
      </mesh>
      <Clock />
      <MouseFollow strength={0.35}>
        <Spin speed={0.22}>
          <mesh name="knot">
            <torusKnotGeometry args={[1, 0.34, 400, 64, 2, 3]} />
            <shaderMaterial vertexShader={knotVertex} fragmentShader={knotFragment} uniforms={knotUniforms} />
          </mesh>
        </Spin>
      </MouseFollow>
    </Canvas>
  );
}
