import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";

export default function Hero() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "#05030f",
        overflow: "hidden",
      }}
    >
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <color attach="background" args={["#05030f"]} />
        <ambientLight name="ambient" intensity={0.6} />

        <MouseFollow strength={0.25}>
          <group name="waves" position={[0, 0, 0]} rotation={[-0.9, 0, 0.25]}>
            <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
              <mesh name="wave-back" position={[0, 0, -1.2]}>
                <planeGeometry args={[16, 9, 160, 160]} />
                <WaveMaterial
                  uColorA="#2a1bff"
                  uColorB="#7c5cff"
                  uColorC="#00d4ff"
                  uAmplitude={0.9}
                  uSpeed={0.25}
                  uOpacity={0.85}
                  uSeed={0}
                />
              </mesh>
            </Float>

            <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.5}>
              <mesh name="wave-mid" position={[0, 0, -0.4]}>
                <planeGeometry args={[16, 9, 160, 160]} />
                <WaveMaterial
                  uColorA="#7c5cff"
                  uColorB="#ff4fd8"
                  uColorC="#ffb36b"
                  uAmplitude={0.7}
                  uSpeed={0.35}
                  uOpacity={0.6}
                  uSeed={3}
                />
              </mesh>
            </Float>

            <Float speed={1.8} rotationIntensity={0.1} floatIntensity={0.6}>
              <mesh name="wave-front" position={[0, 0, 0.4]}>
                <planeGeometry args={[16, 9, 160, 160]} />
                <WaveMaterial
                  uColorA="#00d4ff"
                  uColorB="#ff6ad5"
                  uColorC="#fff0c2"
                  uAmplitude={0.5}
                  uSpeed={0.45}
                  uOpacity={0.45}
                  uSeed={7}
                />
              </mesh>
            </Float>
          </group>
        </MouseFollow>
      </Canvas>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color: "#ffffff",
          pointerEvents: "none",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: "0 24px",
        }}
      >
        <h1
          style={{
            fontSize: "clamp(40px, 7vw, 96px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.02,
            margin: 0,
          }}
        >
          Build the flow.
        </h1>
        <p
          style={{
            maxWidth: 560,
            marginTop: 20,
            fontSize: "clamp(16px, 1.6vw, 20px)",
            opacity: 0.8,
          }}
        >
          A living gradient of layered waves that responds to every move.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Motion + material wrappers                                          */
/* ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  // @prism uniform uTime float 0..1000 =0
  // @prism uniform uAmplitude float 0..2 =0.6
  // @prism uniform uSpeed float 0..2 =0.4
  // @prism uniform uSeed float 0..20 =0
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uSpeed;
  uniform float uSeed;

  varying vec2 vUv;
  varying float vHeight;

  void main() {
    vUv = uv;
    vec3 p = position;
    float t = uTime * uSpeed + uSeed;

    float h = 0.0;
    h += sin(p.x * 0.55 + t * 1.1) * 0.55;
    h += sin(p.y * 0.8 - t * 0.9 + p.x * 0.3) * 0.35;
    h += sin((p.x + p.y) * 0.35 + t * 0.6) * 0.5;
    h += sin(p.x * 1.4 - p.y * 1.1 + t * 1.7) * 0.15;

    p.z += h * uAmplitude;
    vHeight = h;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  // @prism uniform uColorA color =#7c5cff
  // @prism uniform uColorB color =#ff4fd8
  // @prism uniform uColorC color =#00d4ff
  // @prism uniform uOpacity float 0..1 =0.8
  // @prism uniform uIntensity float 0..2 =1.0
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uSeed;

  varying vec2 vUv;
  varying float vHeight;

  void main() {
    float k = clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
    float sweep = 0.5 + 0.5 * sin(vUv.x * 3.0 + vUv.y * 2.0 + uTime * 0.2 + uSeed);

    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.7, k));
    col = mix(col, uColorC, smoothstep(0.45, 1.0, k * 0.6 + sweep * 0.4));

    // soft crest highlight
    col += pow(k, 4.0) * 0.35;

    // fade edges of the plane
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x)
               * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);

    gl_FragColor = vec4(col * uIntensity, uOpacity * edge);
  }
`;

type WaveMaterialProps = {
  uColorA: string;
  uColorB: string;
  uColorC: string;
  uAmplitude: number;
  uSpeed: number;
  uOpacity: number;
  uSeed: number;
};

function WaveMaterial({
  uColorA,
  uColorB,
  uColorC,
  uAmplitude,
  uSpeed,
  uOpacity,
  uSeed,
}: WaveMaterialProps) {
  const ref = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uAmplitude: { value: uAmplitude },
      uSpeed: { value: uSpeed },
      uOpacity: { value: uOpacity },
      uSeed: { value: uSeed },
      uColorA: { value: new THREE.Color(uColorA) },
      uColorB: { value: new THREE.Color(uColorB) },
      uColorC: { value: new THREE.Color(uColorC) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    uniforms.uAmplitude.value = uAmplitude;
    uniforms.uSpeed.value = uSpeed;
    uniforms.uOpacity.value = uOpacity;
    uniforms.uSeed.value = uSeed;
    uniforms.uColorA.value.set(uColorA);
    uniforms.uColorB.value.set(uColorB);
    uniforms.uColorC.value.set(uColorC);
  }, [uniforms, uColorA, uColorB, uColorC, uAmplitude, uSpeed, uOpacity, uSeed]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <shaderMaterial
      ref={ref}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
      transparent
      depthWrite={false}
      side={THREE.DoubleSide}
      blending={THREE.NormalBlending}
    />
  );
}

function MouseFollow({
  strength = 0.3,
  children,
}: {
  strength?: number;
  children?: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    const targetY = state.pointer.x * strength;
    const targetX = -state.pointer.y * strength * 0.6;
    const k = 1 - Math.exp(-delta * 3);
    g.rotation.y += (targetY - g.rotation.y) * k;
    g.rotation.x += (targetX - g.rotation.x) * k;
  });

  return <group ref={ref}>{children}</group>;
}
