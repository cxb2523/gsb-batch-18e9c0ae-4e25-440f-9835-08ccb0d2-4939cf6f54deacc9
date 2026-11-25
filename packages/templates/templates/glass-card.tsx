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
  // Cosine palette (Inigo Quilez): a + b * cos(2pi * (c * t + d)).
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
  }

  // Cheap hash grain, in [-0.5, 0.5], to break up banding in dark gradients.
  float grain(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }
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
