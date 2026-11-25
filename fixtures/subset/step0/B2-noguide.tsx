import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Float } from "@react-three/drei";

const GLOBE_RADIUS = 1.6;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = /* glsl */ `
  varying vec3 vNormal;
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(uColor, 1.0) * rim * uIntensity;
  }
`;

function Atmosphere({ hovered }: { hovered: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color("#4fa3ff") },
      uIntensity: { value: 1.6 },
    }),
    []
  );

  useFrame((_, delta) => {
    if (!material.current) return;
    const target = hovered ? 2.8 : 1.6;
    uniforms.uIntensity.value = THREE.MathUtils.damp(
      uniforms.uIntensity.value,
      target,
      4,
      delta
    );
  });

  return (
    <mesh scale={1.22}>
      <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
      <shaderMaterial
        ref={material}
        vertexShader={atmosphereVertex}
        fragmentShader={atmosphereFragment}
        uniforms={uniforms}
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

function Globe() {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  // Scatter glowing points over the sphere surface (fibonacci distribution)
  const points = useMemo(() => {
    const count = 900;
    const positions = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const R = GLOBE_RADIUS * 1.012;
      positions[i * 3] = Math.cos(theta) * r * R;
      positions[i * 3 + 1] = y * R;
      positions[i * 3 + 2] = Math.sin(theta) * r * R;
    }
    return positions;
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    const spin = hovered ? 0.05 : 0.18;
    group.current.rotation.y += delta * spin;
    // gentle parallax toward the pointer
    group.current.rotation.x = THREE.MathUtils.damp(
      group.current.rotation.x,
      state.pointer.y * 0.25,
      3,
      delta
    );
    if (core.current) {
      core.current.emissiveIntensity = THREE.MathUtils.damp(
        core.current.emissiveIntensity,
        hovered ? 1.1 : 0.55,
        4,
        delta
      );
    }
  });

  return (
    <group>
      <group ref={group}>
        <mesh
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "auto";
          }}
        >
          <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
          <meshStandardMaterial
            ref={core}
            color="#0a1f44"
            emissive="#1a5cff"
            emissiveIntensity={0.55}
            roughness={0.55}
            metalness={0.25}
          />
        </mesh>

        {/* wireframe lattice */}
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS * 1.005, 36, 24]} />
          <meshBasicMaterial
            color="#5fb4ff"
            wireframe
            transparent
            opacity={0.18}
            depthWrite={false}
          />
        </mesh>

        {/* surface points */}
        <points>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[points, 3]}
            />
          </bufferGeometry>
          <pointsMaterial
            color="#bfe3ff"
            size={0.025}
            sizeAttenuation
            transparent
            opacity={0.95}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>

      <Atmosphere hovered={hovered} />
    </group>
  );
}

function OrbitRing({
  radius,
  tilt,
  speed,
  color,
  tube = 0.008,
  satellite = true,
}: {
  radius: number;
  tilt: [number, number, number];
  speed: number;
  color: string;
  tube?: number;
  satellite?: boolean;
}) {
  const ring = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (ring.current) ring.current.rotation.z += delta * speed;
    if (orb.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 3 + radius) * 0.25;
      orb.current.scale.setScalar(pulse);
    }
  });

  return (
    <group rotation={tilt}>
      <group ref={ring}>
        <mesh>
          <torusGeometry args={[radius, tube, 16, 180]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.75}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {satellite && (
          <mesh ref={orb} position={[radius, 0, 0]}>
            <sphereGeometry args={[0.055, 24, 24]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function CameraRig() {
  useFrame((state, delta) => {
    const { pointer, camera } = state;
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      pointer.x * 0.6,
      2.5,
      delta
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      pointer.y * 0.4,
      2.5,
      delta
    );
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#02030a"]} />
      <fog attach="fog" args={["#02030a", 8, 22]} />

      <ambientLight intensity={0.35} />
      <pointLight position={[6, 4, 6]} intensity={60} color="#8ec5ff" />
      <pointLight position={[-6, -3, -4]} intensity={35} color="#7a4dff" />

      <Stars
        radius={60}
        depth={50}
        count={3500}
        factor={3.5}
        saturation={0}
        fade
        speed={0.6}
      />

      <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.35}>
        <Globe />
        <OrbitRing radius={2.3} tilt={[1.2, 0.2, 0]} speed={0.45} color="#4fd1ff" />
        <OrbitRing radius={2.7} tilt={[0.5, -0.6, 0.3]} speed={-0.3} color="#8b7bff" tube={0.006} />
        <OrbitRing radius={3.1} tilt={[1.0, 0.9, -0.2]} speed={0.2} color="#ff7ad9" tube={0.005} />
      </Float>

      <CameraRig />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        rotateSpeed={0.5}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={(2 * Math.PI) / 3}
      />
    </>
  );
}

export default function Hero() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: 480,
        background: "#02030a",
        overflow: "hidden",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Scene />
      </Canvas>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: "8vh",
          pointerEvents: "none",
          textAlign: "center",
          color: "#e8f1ff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2rem, 6vw, 4.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            textShadow: "0 0 30px rgba(79,163,255,0.6)",
          }}
        >
          Connect the World
        </h1>
        <p style={{ margin: "0.75rem 0 0", opacity: 0.7, fontSize: "1.1rem" }}>
          Drag to explore. Hover to ignite.
        </p>
      </div>
    </div>
  );
}
