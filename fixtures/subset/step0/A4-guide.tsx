import { Suspense, useRef } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float } from "@react-three/drei";
import { MathUtils } from "three";
import type { Group } from "three";

export default function Hero() {
  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "radial-gradient(ellipse at 50% 40%, #1a1240 0%, #07060f 70%)",
        overflow: "hidden",
      }}
    >
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: "9vh",
          pointerEvents: "none",
          color: "#ffffff",
          fontFamily: "Inter, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          Light, bent into form.
        </h1>
        <p style={{ margin: "1rem 0 0", maxWidth: 520, opacity: 0.7, fontSize: "1.1rem" }}>
          Move your cursor and watch the surface shift through the spectrum.
        </p>
      </div>
    </section>
  );
}

function Scene() {
  return (
    <group name="scene-root">
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 5, 3]} intensity={1.6} color="#ffffff" />
      <pointLight position={[-4, -2, 2]} intensity={12} color="#7c5cff" />
      <pointLight position={[4, -3, -2]} intensity={10} color="#2de2e6" />

      <MouseFollow strength={0.15} range={1.2}>
        <group name="backdrop-group">
          <mesh name="backdrop-ring" position={[0, 0, -2.5]} rotation={[0.4, 0, 0]}>
            <torusGeometry args={[3.2, 0.015, 16, 128]} />
            <meshBasicMaterial color="#7c5cff" transparent={true} opacity={0.45} />
          </mesh>
        </group>
      </MouseFollow>

      <MouseFollow strength={0.5} range={0.6}>
        <group name="knot-group">
          <Spin speed={0.15}>
            <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.8}>
              <mesh name="iridescent-knot" position={[0, 0, 0]} rotation={[0.3, 0, 0]}>
                <torusKnotGeometry args={[1, 0.32, 256, 64, 2, 3]} />
                <meshPhysicalMaterial
                  color="#ffffff"
                  metalness={0.9}
                  roughness={0.12}
                  iridescence={1}
                  iridescenceIOR={1.8}
                  iridescenceThicknessRange={[100, 900]}
                  clearcoat={1}
                  clearcoatRoughness={0.05}
                  envMapIntensity={1.6}
                />
              </mesh>
            </Float>
          </Spin>
        </group>
      </MouseFollow>

      <Environment preset="city" />
    </group>
  );
}

/* ---------- Motion wrappers ---------- */

function Spin({ speed, children }: { speed: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * speed;
    }
  });
  return (
    <group name="spin-wrapper" ref={ref}>
      {children}
    </group>
  );
}

function MouseFollow({
  strength,
  range,
  children,
}: {
  strength: number;
  range: number;
  children?: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    const { x, y } = state.pointer;
    g.rotation.y = MathUtils.damp(g.rotation.y, x * strength * 2, 4, delta);
    g.rotation.x = MathUtils.damp(g.rotation.x, -y * strength * 2, 4, delta);
    g.position.x = MathUtils.damp(g.position.x, x * range * 0.5, 4, delta);
    g.position.y = MathUtils.damp(g.position.y, y * range * 0.5, 4, delta);
  });
  return (
    <group name="mouse-follow-wrapper" ref={ref}>
      {children}
    </group>
  );
}
