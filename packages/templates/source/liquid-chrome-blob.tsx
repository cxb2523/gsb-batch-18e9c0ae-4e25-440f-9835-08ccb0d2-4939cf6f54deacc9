import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// Liquid chrome blob: a slowly morphing mirror-metal body reflecting a procedural photo studio.
// Edit the sliders in the shader comments, or any literal prop below. No dependencies beyond R3F.

const blobVertex = /* glsl */ `
  uniform float uTime;
  uniform float uWobble;
  uniform float uSpeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vBulge;
  //@include noise
  float field(vec3 p) {
    float t = uTime * uSpeed;
    return snoise(p * 0.55 + vec3(t * 0.7, t * 0.4, -t * 0.55)) * 0.9 + snoise(p * 1.3 - vec3(t * 0.9, 0.0, t * 0.3)) * 0.1;
  }
  vec3 displace(vec3 p, vec3 n) {
    return p + n * field(p) * uWobble;
  }
  void main() {
    vec3 p = displace(position, normal);
    vec3 t1 = normalize(cross(normal, vec3(0.0, 1.0, 0.001)));
    vec3 t2 = cross(normal, t1);
    vec3 pa = displace(position + t1 * 0.02, normal);
    vec3 pb = displace(position + t2 * 0.02, normal);
    vec3 n = normalize(cross(pa - p, pb - p));
    if (dot(n, normal) < 0.0) n = -n;
    vBulge = field(position);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * n);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const blobFragment = /* glsl */ `
  // @prism uniform uChrome float 0..1 =0.92
  // @prism uniform uSheen float 0..1.5 =0.55
  // @prism uniform uWobble float 0..1 =0.36
  // @prism uniform uSpeed float 0..2 =0.6
  uniform float uChrome;
  uniform float uSheen;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vBulge;
  //@include studio
  //@include fresnel
  //@include palette
  void main() {
    vec3 n = viewToWorld(normalize(vNormal));
    vec3 v = viewToWorld(normalize(vView));
    vec3 r = reflect(-v, n);
    float f = fresnel(n, v, 3.0);
    vec3 env = studioEnv(r);
    vec3 steel = vec3(0.78, 0.82, 0.9);
    vec3 mirror = env * mix(vec3(1.0), steel, 0.5) * (0.82 + 0.3 * f);
    vec3 film = palette(vBulge * 0.8 + f * 0.9, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
    vec3 col = mix(vec3(0.03, 0.035, 0.05), mirror, uChrome);
    col += film * pow(f, 2.0) * uSheen * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const blobUniforms = {
  uTime: { value: 0 },
  uChrome: { value: 0.92 },
  uSheen: { value: 0.55 },
  uWobble: { value: 0.36 },
  uSpeed: { value: 0.6 },
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
    vec3 col = uColor * pow(1.0 - smoothstep(0.0, 0.8, r), 1.6) * 0.6 + vec3(0.006, 0.007, 0.012);
    col += grain(gl_FragCoord.xy) * 0.012;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const backdropUniforms = { uColor: { value: new THREE.Color("#16345c") } };

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
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, state.pointer.x * strength, 4, delta);
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, state.pointer.y * strength, 4, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

/** Feeds the clock to the shader uniforms. Pausing the R3F clock (the editor does this while you drag) pauses the shaders too. */
function Clock() {
  useFrame((state) => {
    blobUniforms.uTime.value = state.clock.elapsedTime;
  });
  return null;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#05060a"]} />
      <mesh name="backdrop" position={[0, 0, -6]}>
        <planeGeometry args={[34, 20]} />
        <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} uniforms={backdropUniforms} depthWrite={false} />
      </mesh>
      <Clock />
      <MouseFollow strength={0.3}>
        <Spin speed={0.12}>
          <mesh name="blob">
            <sphereGeometry args={[1.45, 160, 160]} />
            <shaderMaterial vertexShader={blobVertex} fragmentShader={blobFragment} uniforms={blobUniforms} />
          </mesh>
        </Spin>
      </MouseFollow>
    </Canvas>
  );
}
