import { useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";

// Glass card: a rounded sheet of glass that tilts toward the pointer over three drifting light blobs.

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  // @prism uniform uStrength float 0..2 =1
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const glowCyan = { uStrength: { value: 1.1 }, uColor: { value: new THREE.Color("#19c6ff") } };
const glowViolet = { uStrength: { value: 1.3 }, uColor: { value: new THREE.Color("#7a4dff") } };
const glowPink = { uStrength: { value: 1.0 }, uColor: { value: new THREE.Color("#ff4fa3") } };

const cardVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const cardFragment = /* glsl */ `
  // @prism uniform uAlpha float 0..1 =0.2
  // @prism uniform uEdge float 0..3 =1.6
  // @prism uniform uRadius float 0..0.5 =0.12
  uniform float uAlpha;
  uniform float uEdge;
  uniform float uRadius;
  uniform vec2 uSize;
  uniform vec3 uEdgeColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  //@include studio
  //@include fresnel
  float roundedBox(vec2 p, vec2 hs, float r) {
    vec2 q = abs(p) - hs + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = roundedBox(p, uSize * 0.5, uRadius * uSize.y);
    if (d > 0.0) discard;
    vec3 n = viewToWorld(normalize(vNormal));
    vec3 v = viewToWorld(normalize(vView));
    float f = fresnel(n, v, 2.0);
    vec3 refl = studioEnv(reflect(-v, n));
    float sheen = smoothstep(0.1, 0.9, vUv.x * 0.7 + (1.0 - vUv.y) * 0.5);
    float edge = exp(d * 26.0);
    vec3 col = refl * (0.10 + 0.6 * f) + vec3(0.55, 0.7, 1.0) * sheen * 0.10 + uEdgeColor * edge * uEdge;
    float alpha = clamp(uAlpha + f * 0.5 + edge * 0.7 + sheen * 0.06, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cardUniforms = {
  uAlpha: { value: 0.2 },
  uEdge: { value: 1.6 },
  uRadius: { value: 0.12 },
  uSize: { value: [3.6, 2.2] },
  uEdgeColor: { value: new THREE.Color("#cfe0ff") },
};

const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backdropFragment = /* glsl */ `
  varying vec2 vUv;
  //@include palette
  void main() {
    vec3 col = mix(vec3(0.012, 0.014, 0.03), vec3(0.03, 0.035, 0.08), smoothstep(0.0, 1.0, vUv.y));
    col += grain(gl_FragCoord.xy) * 0.012;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function MouseFollow({ strength, children }: { strength: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, state.pointer.x * strength, 5, delta);
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, -state.pointer.y * strength, 5, delta);
  });
  return <group name="mouse-follow" ref={ref}>{children}</group>;
}

function Drift({ speed, range, children }: { speed: number; range: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.x = Math.sin(state.clock.elapsedTime * speed) * range;
    ref.current.position.y = Math.cos(state.clock.elapsedTime * speed * 1.3) * range * 0.6;
  });
  return <group name="drift" ref={ref}>{children}</group>;
}

export default function Hero() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#05060c"]} />
      <mesh name="backdrop" position={[0, 0, -8]}>
        <planeGeometry args={[40, 24]} />
        <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} depthWrite={false} />
      </mesh>

      <Drift speed={0.35} range={0.5}>
        <mesh name="glow-cyan" position={[-2.2, 0.9, -1.2]}>
          <planeGeometry args={[4.6, 4.6]} />
          <shaderMaterial vertexShader={glowVertex} fragmentShader={glowFragment} uniforms={glowCyan} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </Drift>
      <Drift speed={0.28} range={0.6}>
        <mesh name="glow-violet" position={[2.0, -0.6, -1.0]}>
          <planeGeometry args={[5.4, 5.4]} />
          <shaderMaterial vertexShader={glowVertex} fragmentShader={glowFragment} uniforms={glowViolet} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </Drift>
      <Drift speed={0.42} range={0.4}>
        <mesh name="glow-pink" position={[0.2, -1.5, -0.8]}>
          <planeGeometry args={[3.6, 3.6]} />
          <shaderMaterial vertexShader={glowVertex} fragmentShader={glowFragment} uniforms={glowPink} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </Drift>

      <MouseFollow strength={0.3}>
        <mesh name="card" position={[0, 0, 0]}>
          <planeGeometry args={[3.6, 2.2]} />
          <shaderMaterial vertexShader={cardVertex} fragmentShader={cardFragment} uniforms={cardUniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh name="card-chip" position={[-1.2, 0.5, 0.02]}>
          <circleGeometry args={[0.22, 48]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.9} />
        </mesh>
        <mesh name="card-line-1" position={[-0.65, -0.35, 0.02]}>
          <planeGeometry args={[2.0, 0.1]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
        </mesh>
        <mesh name="card-line-2" position={[-0.95, -0.62, 0.02]}>
          <planeGeometry args={[1.4, 0.1]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
        </mesh>
      </MouseFollow>
    </Canvas>
  );
}
