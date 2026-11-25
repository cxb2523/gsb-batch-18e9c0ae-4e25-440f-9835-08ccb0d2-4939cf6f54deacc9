import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Float,
  MeshDistortMaterial,
  Lightformer,
  AdaptiveDpr,
} from "@react-three/drei";
import * as THREE from "three";

function useScrollProgress() {
  const progress = useRef(0);
  const velocity = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const p = window.scrollY / max;
      velocity.current = p - last.current;
      last.current = p;
      progress.current = p;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { progress, velocity };
}

type ScrollRefs = ReturnType<typeof useScrollProgress>;

function ChromeBlob({ scroll }: { scroll: ScrollRefs }) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<any>(null);
  const smooth = useRef(0);
  const energy = useRef(0);

  useFrame((state, delta) => {
    const { progress, velocity } = scroll;
    smooth.current = THREE.MathUtils.damp(
      smooth.current,
      progress.current,
      3,
      delta
    );

    // Scroll velocity injects energy that decays over time
    energy.current = THREE.MathUtils.damp(
      energy.current,
      Math.min(Math.abs(velocity.current) * 60, 1),
      4,
      delta
    );
    velocity.current *= 0.9;

    const t = state.clock.elapsedTime;

    if (group.current) {
      group.current.rotation.y = t * 0.08 + smooth.current * Math.PI * 2;
      group.current.rotation.x = Math.sin(t * 0.2) * 0.1 + smooth.current * 0.8;
      group.current.rotation.z = smooth.current * 0.4;
      const s = 1.35 - smooth.current * 0.35;
      group.current.scale.setScalar(
        THREE.MathUtils.damp(group.current.scale.x, s, 4, delta)
      );
      group.current.position.y = smooth.current * 0.8;

      // Subtle pointer parallax
      group.current.position.x = THREE.MathUtils.damp(
        group.current.position.x,
        state.pointer.x * 0.35,
        2.5,
        delta
      );
    }

    if (material.current) {
      material.current.distort = 0.28 + smooth.current * 0.35 + energy.current * 0.25;
      material.current.speed = 1.2 + smooth.current * 2 + energy.current * 3;
    }
  });

  return (
    <group ref={group}>
      <Float speed={1.2} rotationIntensity={0.25} floatIntensity={0.6}>
        <mesh ref={mesh} castShadow receiveShadow>
          <icosahedronGeometry args={[1, 64]} />
          <MeshDistortMaterial
            ref={material}
            color="#ffffff"
            metalness={1}
            roughness={0.06}
            envMapIntensity={1.6}
            distort={0.3}
            speed={1.5}
          />
        </mesh>
      </Float>
    </group>
  );
}

function Studio() {
  return (
    <Environment resolution={256} background={false}>
      <color attach="background" args={["#05060a"]} />
      <Lightformer
        form="rect"
        intensity={4}
        position={[0, 5, -6]}
        scale={[14, 3, 1]}
        color="#ffffff"
      />
      <Lightformer
        form="rect"
        intensity={3}
        position={[-6, 1, 2]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[8, 4, 1]}
        color="#7aa7ff"
      />
      <Lightformer
        form="rect"
        intensity={3}
        position={[6, -1, 2]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[8, 4, 1]}
        color="#ff7ad9"
      />
      <Lightformer
        form="ring"
        intensity={2}
        position={[0, -4, 3]}
        scale={6}
        color="#ffd9a0"
      />
    </Environment>
  );
}

export default function Hero() {
  const scroll = useScrollProgress();

  return (
    <section
      style={{
        position: "sticky",
        top: 0,
        width: "100%",
        height: "100vh",
        background:
          "radial-gradient(ellipse at 50% 40%, #12141c 0%, #05060a 70%)",
        overflow: "hidden",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 40 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Suspense fallback={null}>
          <Studio />
          <ChromeBlob scroll={scroll} />
        </Suspense>
        <AdaptiveDpr pixelated />
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
          fontFamily:
            "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2.5rem, 8vw, 6.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            mixBlendMode: "difference",
          }}
        >
          Liquid Metal
        </h1>
        <p
          style={{
            margin: "1rem 0 0",
            fontSize: "clamp(0.9rem, 1.6vw, 1.15rem)",
            opacity: 0.65,
            letterSpacing: "0.02em",
          }}
        >
          Scroll to reshape it.
        </p>
      </div>
    </section>
  );
}
