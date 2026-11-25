import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Float,
  MeshTransmissionMaterial,
  Lightformer,
} from "@react-three/drei";

function Orb() {
  const mesh = useRef<THREE.Mesh>(null!);
  const group = useRef<THREE.Group>(null!);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    // Subtle pointer-driven parallax
    const targetX = state.pointer.x * 0.6;
    const targetY = state.pointer.y * 0.4 + 0.6;
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, targetX, 3, delta);
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, targetY, 3, delta);
    mesh.current.rotation.y += delta * 0.2;
    mesh.current.rotation.x = Math.sin(t * 0.4) * 0.15;
    // Gentle breathing
    const s = 1 + Math.sin(t * 1.2) * 0.02;
    mesh.current.scale.setScalar(s);
  });

  return (
    <group ref={group} position={[0, 0.6, 0]}>
      <Float speed={1.6} rotationIntensity={0.4} floatIntensity={1.2}>
        <mesh ref={mesh}>
          <icosahedronGeometry args={[1.25, 24]} />
          <MeshTransmissionMaterial
            backside
            samples={8}
            resolution={512}
            thickness={1.4}
            roughness={0.05}
            transmission={1}
            ior={1.35}
            chromaticAberration={0.08}
            anisotropy={0.3}
            distortion={0.45}
            distortionScale={0.5}
            temporalDistortion={0.15}
            attenuationColor="#9fd3ff"
            attenuationDistance={2.5}
            color="#ffffff"
            clearcoat={1}
            clearcoatRoughness={0}
          />
        </mesh>
      </Float>
    </group>
  );
}

function Particles({ count = 600 }: { count?: number }) {
  const points = useRef<THREE.Points>(null!);

  const { positions, speeds, offsets } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 7 - 1.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
      speeds[i] = 0.1 + Math.random() * 0.3;
      offsets[i] = Math.random() * Math.PI * 2;
    }
    return { positions, speeds, offsets };
  }, [count]);

  const sprite = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      arr[i3 + 1] += speeds[i] * 0.004;
      arr[i3] += Math.sin(t * 0.3 + offsets[i]) * 0.0025;
      if (arr[i3 + 1] > 3.5) arr[i3 + 1] = -5;
    }
    attr.needsUpdate = true;
    points.current.rotation.y = t * 0.02;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={sprite}
        size={0.09}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        color="#a8d8ff"
        opacity={0.8}
      />
    </points>
  );
}

function Rig() {
  useFrame((state, delta) => {
    const cam = state.camera;
    cam.position.x = THREE.MathUtils.damp(cam.position.x, state.pointer.x * 0.4, 2, delta);
    cam.position.y = THREE.MathUtils.damp(cam.position.y, state.pointer.y * 0.25, 2, delta);
    cam.lookAt(0, 0.4, 0);
  });
  return null;
}

export default function Hero() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: 520,
        background:
          "radial-gradient(ellipse at 50% 40%, #14223f 0%, #080d1c 55%, #03050b 100%)",
        overflow: "hidden",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#05080f"]} />
        <fog attach="fog" args={["#05080f", 6, 14]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[4, 5, 3]} intensity={1.5} color="#cfe6ff" />
        <pointLight position={[-4, -2, 2]} intensity={20} color="#ff7ad9" />
        <pointLight position={[3, -1, -2]} intensity={20} color="#5cf0ff" />

        <Suspense fallback={null}>
          <Orb />
          <Particles />
          <Environment resolution={256}>
            <group rotation={[-Math.PI / 3, 0, 1]}>
              <Lightformer form="circle" intensity={4} position={[0, 5, -9]} scale={4} />
              <Lightformer form="ring" intensity={3} color="#7dd3fc" position={[-5, 1, -1]} scale={3} />
              <Lightformer form="rect" intensity={3} color="#f0abfc" position={[5, 1, -2]} scale={[3, 6, 1]} />
              <Lightformer form="rect" intensity={2} position={[0, -4, 3]} scale={[8, 2, 1]} />
            </group>
          </Environment>
        </Suspense>
        <Rig />
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
          color: "white",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2rem, 6vw, 4.5rem)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            textShadow: "0 4px 40px rgba(120,180,255,0.35)",
          }}
        >
          Clarity in motion
        </h1>
        <p style={{ margin: "12px 0 0", opacity: 0.7, fontSize: "clamp(1rem, 2vw, 1.25rem)" }}>
          Move your cursor and watch the glass respond.
        </p>
      </div>
    </div>
  );
}
