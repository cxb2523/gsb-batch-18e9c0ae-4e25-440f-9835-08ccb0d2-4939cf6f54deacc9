import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Float,
  MeshTransmissionMaterial,
  Sparkles,
} from "@react-three/drei";
import * as THREE from "three";

function IridescentKnot() {
  const group = useRef<THREE.Group>(null!);
  const mesh = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    // Parallax: ease group rotation and position toward pointer
    const { x, y } = state.pointer;
    const g = group.current;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, x * 0.6, 4, delta);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -y * 0.4, 4, delta);
    g.position.x = THREE.MathUtils.damp(g.position.x, x * 0.35, 3, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, y * 0.25, 3, delta);

    // Idle spin
    mesh.current.rotation.z += delta * 0.15;
    mesh.current.rotation.y += delta * 0.1;
  });

  return (
    <group ref={group}>
      <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.8}>
        <mesh ref={mesh} castShadow>
          <torusKnotGeometry args={[1, 0.34, 300, 48, 2, 3]} />
          <meshPhysicalMaterial
            color="#ffffff"
            metalness={0.9}
            roughness={0.12}
            iridescence={1}
            iridescenceIOR={1.6}
            iridescenceThicknessRange={[200, 800]}
            clearcoat={1}
            clearcoatRoughness={0.05}
            envMapIntensity={1.6}
          />
        </mesh>
      </Float>
    </group>
  );
}

function CameraRig() {
  useFrame((state, delta) => {
    const { x, y } = state.pointer;
    const cam = state.camera;
    cam.position.x = THREE.MathUtils.damp(cam.position.x, x * 0.8, 2.5, delta);
    cam.position.y = THREE.MathUtils.damp(cam.position.y, y * 0.5, 2.5, delta);
    cam.lookAt(0, 0, 0);
  });
  return null;
}

export default function Hero() {
  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "relative",
      width: "100%",
      height: "100vh",
      minHeight: 520,
      overflow: "hidden",
      background:
        "radial-gradient(ellipse at 50% 40%, #1b1440 0%, #0a0818 55%, #04030a 100%)",
    }),
    []
  );

  return (
    <section style={containerStyle}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#05030d"]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <pointLight position={[-5, -2, 3]} intensity={30} color="#7a5cff" />
        <pointLight position={[4, -3, 2]} intensity={25} color="#00e5ff" />
        <Suspense fallback={null}>
          <IridescentKnot />
          <Sparkles
            count={60}
            scale={[10, 6, 6]}
            size={2}
            speed={0.3}
            opacity={0.6}
            color="#b9a8ff"
          />
          <Environment preset="city" />
        </Suspense>
        <CameraRig />
      </Canvas>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: "10vh",
          pointerEvents: "none",
          color: "#fff",
          textAlign: "center",
          fontFamily:
            "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2.2rem, 6vw, 5rem)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            background: "linear-gradient(90deg,#c9b8ff,#7ae7ff,#ffb8f0)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Build something unforgettable
        </h1>
        <p style={{ margin: "1rem 0 0", opacity: 0.75, fontSize: "1.1rem" }}>
          Move your mouse and watch it respond.
        </p>
      </div>
    </section>
  );
}
