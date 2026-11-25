import { useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, MeshDistortMaterial } from "@react-three/drei";
import type { Group } from "three";

export default function Hero() {
  return (
    <div style={{ position: "relative", width: "100%", height: "300vh", background: "#050509" }}>
      <div style={{ position: "sticky", top: 0, width: "100%", height: "100vh" }}>
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
          <color attach="background" args={["#050509"]} />
          <ambientLight name="ambient" intensity={0.3} />
          <directionalLight name="key-light" position={[4, 5, 3]} intensity={1.6} color="#ffffff" />
          <pointLight name="rim-light" position={[-4, -2, -3]} intensity={30} color="#7c5cff" />
          <Environment preset="city" />

          <ScrollSpin speed={2.4}>
            <ScrollSquash amount={0.35}>
              <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.8}>
                <group name="blob-group">
                  <mesh name="chrome-blob" position={[0, 0, 0]}>
                    <icosahedronGeometry args={[1.4, 64]} />
                    <MeshDistortMaterial
                      color="#ffffff"
                      metalness={1}
                      roughness={0.05}
                      distort={0.55}
                      speed={1.8}
                      envMapIntensity={1.6}
                    />
                  </mesh>
                </group>
              </Float>
            </ScrollSquash>
          </ScrollSpin>
        </Canvas>
      </div>
    </div>
  );
}

function getScrollProgress(): number {
  if (typeof window === "undefined") return 0;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

function ScrollSpin({ speed = 1, children }: { speed?: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  const current = useRef(0);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const target = getScrollProgress() * Math.PI * speed;
    current.current += (target - current.current) * Math.min(1, delta * 4);
    g.rotation.y = current.current + 0.15;
    g.rotation.x = current.current * 0.35;
  });
  return (
    <group name="scroll-spin" ref={ref}>
      {children}
    </group>
  );
}

function ScrollSquash({ amount = 0.3, children }: { amount?: number; children?: ReactNode }) {
  const ref = useRef<Group>(null);
  const current = useRef(0);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const p = getScrollProgress();
    const target = Math.sin(p * Math.PI);
    current.current += (target - current.current) * Math.min(1, delta * 4);
    const k = current.current * amount;
    g.scale.set(1 + k, 1 - k * 0.6, 1 + k * 0.4);
  });
  return (
    <group name="scroll-squash" ref={ref}>
      {children}
    </group>
  );
}
