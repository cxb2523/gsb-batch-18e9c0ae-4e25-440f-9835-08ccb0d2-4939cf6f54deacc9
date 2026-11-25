import { Suspense, useRef } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, MeshTransmissionMaterial } from "@react-three/drei";
import type { Group } from "three";

export default function Hero() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "radial-gradient(ellipse at 50% 40%, #1b1440 0%, #07060f 70%)",
        overflow: "hidden",
      }}
    >
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
          <color attach="background" args={["#07060f"]} />
          <ambientLight name="ambient" intensity={0.4} />
          <directionalLight name="key-light" position={[3, 4, 5]} intensity={1.2} color="#ffffff" />
          <pointLight name="violet-light" position={[-4, -1, 2]} intensity={30} color="#7c5cff" />
          <pointLight name="cyan-light" position={[4, 1, -2]} intensity={25} color="#3cd6ff" />
          <Environment preset="city" />

          <MouseFollow strength={0.25}>
            <group name="orb-rig" position={[0, 0.7, 0]}>
              <Float speed={1.5} rotationIntensity={0.4} floatIntensity={1.2}>
                <HoverScale scale={1.08}>
                  <Spin speed={0.15}>
                    <mesh name="orb" position={[0, 0, 0]}>
                      <sphereGeometry args={[1, 64, 64]} />
                      <MeshTransmissionMaterial
                        color="#c9b8ff"
                        transmission={1}
                        thickness={0.8}
                        roughness={0.05}
                        ior={1.45}
                        chromaticAberration={0.06}
                        anisotropy={0.3}
                        distortion={0.35}
                        distortionScale={0.4}
                        temporalDistortion={0.12}
                        backside={true}
                        samples={6}
                        resolution={512}
                      />
                    </mesh>
                  </Spin>
                </HoverScale>
              </Float>
            </group>
          </MouseFollow>

          <group name="particles" position={[0, -1.2, -0.5]}>
            <Drift speed={0.35} amplitude={0.18} phase={0}>
              <group name="particles-a">
                <mesh name="particle-a1" position={[-3.2, -0.4, 0.2]}>
                  <sphereGeometry args={[0.035, 12, 12]} />
                  <meshBasicMaterial color="#b9a6ff" transparent={true} opacity={0.8} />
                </mesh>
                <mesh name="particle-a2" position={[-2.1, 0.5, -0.6]}>
                  <sphereGeometry args={[0.025, 12, 12]} />
                  <meshBasicMaterial color="#8fe9ff" transparent={true} opacity={0.7} />
                </mesh>
                <mesh name="particle-a3" position={[-1.2, -0.9, 0.5]}>
                  <sphereGeometry args={[0.045, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.6} />
                </mesh>
                <mesh name="particle-a4" position={[-0.4, 0.2, -1]}>
                  <sphereGeometry args={[0.03, 12, 12]} />
                  <meshBasicMaterial color="#7c5cff" transparent={true} opacity={0.85} />
                </mesh>
                <mesh name="particle-a5" position={[-2.7, 1.1, -1.2]}>
                  <sphereGeometry args={[0.02, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.5} />
                </mesh>
                <mesh name="particle-a6" position={[-1.7, -0.1, 0.9]}>
                  <sphereGeometry args={[0.028, 12, 12]} />
                  <meshBasicMaterial color="#3cd6ff" transparent={true} opacity={0.75} />
                </mesh>
              </group>
            </Drift>

            <Drift speed={0.28} amplitude={0.22} phase={2}>
              <group name="particles-b">
                <mesh name="particle-b1" position={[0.3, -0.6, 0.4]}>
                  <sphereGeometry args={[0.04, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.7} />
                </mesh>
                <mesh name="particle-b2" position={[1.0, 0.4, -0.8]}>
                  <sphereGeometry args={[0.03, 12, 12]} />
                  <meshBasicMaterial color="#b9a6ff" transparent={true} opacity={0.8} />
                </mesh>
                <mesh name="particle-b3" position={[-0.2, 0.9, -0.3]}>
                  <sphereGeometry args={[0.022, 12, 12]} />
                  <meshBasicMaterial color="#8fe9ff" transparent={true} opacity={0.65} />
                </mesh>
                <mesh name="particle-b4" position={[0.8, -1.0, 0.7]}>
                  <sphereGeometry args={[0.05, 12, 12]} />
                  <meshBasicMaterial color="#7c5cff" transparent={true} opacity={0.6} />
                </mesh>
                <mesh name="particle-b5" position={[-0.7, -0.3, 1.1]}>
                  <sphereGeometry args={[0.026, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.55} />
                </mesh>
                <mesh name="particle-b6" position={[0.1, 0.1, -1.4]}>
                  <sphereGeometry args={[0.032, 12, 12]} />
                  <meshBasicMaterial color="#3cd6ff" transparent={true} opacity={0.7} />
                </mesh>
              </group>
            </Drift>

            <Drift speed={0.4} amplitude={0.15} phase={4}>
              <group name="particles-c">
                <mesh name="particle-c1" position={[1.9, 0.3, 0.1]}>
                  <sphereGeometry args={[0.03, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.75} />
                </mesh>
                <mesh name="particle-c2" position={[2.8, -0.5, -0.7]}>
                  <sphereGeometry args={[0.04, 12, 12]} />
                  <meshBasicMaterial color="#b9a6ff" transparent={true} opacity={0.7} />
                </mesh>
                <mesh name="particle-c3" position={[3.3, 0.8, 0.3]}>
                  <sphereGeometry args={[0.02, 12, 12]} />
                  <meshBasicMaterial color="#8fe9ff" transparent={true} opacity={0.8} />
                </mesh>
                <mesh name="particle-c4" position={[1.5, -0.9, 0.8]}>
                  <sphereGeometry args={[0.035, 12, 12]} />
                  <meshBasicMaterial color="#7c5cff" transparent={true} opacity={0.8} />
                </mesh>
                <mesh name="particle-c5" position={[2.4, 1.2, -1.1]}>
                  <sphereGeometry args={[0.024, 12, 12]} />
                  <meshBasicMaterial color="#ffffff" transparent={true} opacity={0.5} />
                </mesh>
                <mesh name="particle-c6" position={[2.2, -0.2, 1]}>
                  <sphereGeometry args={[0.028, 12, 12]} />
                  <meshBasicMaterial color="#3cd6ff" transparent={true} opacity={0.7} />
                </mesh>
              </group>
            </Drift>
          </group>
        </Suspense>
      </Canvas>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "12%",
          textAlign: "center",
          color: "#f4f1ff",
          fontFamily: "system-ui, sans-serif",
          pointerEvents: "none",
        }}
      >
        <h1 style={{ fontSize: "3rem", margin: 0, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Build in glass.
        </h1>
        <p style={{ margin: "0.5rem 0 0", opacity: 0.7 }}>
          A cinematic, interactive 3D hero.
        </p>
      </div>
    </div>
  );
}

/* ---------- Motion wrappers ---------- */

function Spin({ speed, children }: { speed: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return <group ref={ref}>{children}</group>;
}

function MouseFollow({ strength, children }: { strength: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    const k = 1 - Math.exp(-delta * 4);
    g.rotation.y += (state.pointer.x * strength - g.rotation.y) * k;
    g.rotation.x += (-state.pointer.y * strength - g.rotation.x) * k;
    g.position.x += (state.pointer.x * strength * 0.5 - g.position.x) * k;
    g.position.y += (state.pointer.y * strength * 0.3 - g.position.y) * k;
  });
  return <group ref={ref}>{children}</group>;
}

function HoverScale({ scale, children }: { scale: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  const hovered = useRef(false);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const target = hovered.current ? scale : 1;
    const k = 1 - Math.exp(-delta * 6);
    const s = g.scale.x + (target - g.scale.x) * k;
    g.scale.set(s, s, s);
  });
  return (
    <group
      ref={ref}
      onPointerOver={() => {
        hovered.current = true;
      }}
      onPointerOut={() => {
        hovered.current = false;
      }}
    >
      {children}
    </group>
  );
}

function Drift({
  speed,
  amplitude,
  phase,
  children,
}: {
  speed: number;
  amplitude: number;
  phase: number;
  children?: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime * speed + phase;
    g.position.y = Math.sin(t) * amplitude;
    g.position.x = Math.cos(t * 0.7) * amplitude * 0.6;
    g.rotation.y = t * 0.2;
  });
  return <group ref={ref}>{children}</group>;
}
