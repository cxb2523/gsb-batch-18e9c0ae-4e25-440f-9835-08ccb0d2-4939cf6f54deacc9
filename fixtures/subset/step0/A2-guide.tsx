import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, OrbitControls, Stars } from "@react-three/drei";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { MathUtils } from "three";
import type { Group } from "three";

export default function Hero() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "#05060f",
        overflow: "hidden",
      }}
    >
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#05060f"]} />
        <ambientLight intensity={0.35} color="#8aa0ff" />
        <pointLight name="key-light" position={[5, 3, 5]} intensity={40} color="#9fb4ff" />
        <pointLight name="rim-light" position={[-5, -2, -3]} intensity={25} color="#7c5cff" />
        <Environment preset="night" />

        <group name="starfield">
          <Stars radius={60} depth={40} count={2500} factor={3} saturation={0} fade speed={0.6} />
        </group>

        <MouseFollow name="scene-follow" strength={0.25}>
          <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
            <HoverScale name="globe-hover" scale={1.08}>
              <group name="globe">
                <Spin name="globe-spin" speed={0.15}>
                  <group name="globe-body">
                    <mesh name="globe-core">
                      <sphereGeometry args={[1.5, 64, 64]} />
                      <meshStandardMaterial
                        color="#0b1a4a"
                        emissive="#1b2f8f"
                        emissiveIntensity={0.6}
                        roughness={0.4}
                        metalness={0.3}
                      />
                    </mesh>
                    <mesh name="globe-grid">
                      <sphereGeometry args={[1.52, 36, 24]} />
                      <meshBasicMaterial color="#7c5cff" wireframe transparent opacity={0.25} />
                    </mesh>
                    <mesh name="marker-front" position={[0, 0, 1.5]}>
                      <sphereGeometry args={[0.04, 16, 16]} />
                      <meshBasicMaterial color="#ffffff" />
                    </mesh>
                    <mesh name="marker-right" position={[1.06, 0, 1.06]}>
                      <sphereGeometry args={[0.04, 16, 16]} />
                      <meshBasicMaterial color="#6ee7ff" />
                    </mesh>
                    <mesh name="marker-top" position={[0, 1.06, 1.06]}>
                      <sphereGeometry args={[0.04, 16, 16]} />
                      <meshBasicMaterial color="#ff7ad9" />
                    </mesh>
                    <mesh name="marker-left" position={[-1.2, 0.6, 0.7]}>
                      <sphereGeometry args={[0.04, 16, 16]} />
                      <meshBasicMaterial color="#6ee7ff" />
                    </mesh>
                  </group>
                </Spin>

                <mesh name="globe-atmosphere">
                  <sphereGeometry args={[1.75, 64, 64]} />
                  <shaderMaterial
                    transparent
                    depthWrite={false}
                    blending={2}
                    uniforms={{
                      uIntensity: { value: 1.2 },
                      uPower: { value: 2.8 },
                    }}
                    vertexShader={/* glsl */ `
                      varying vec3 vNormal;
                      varying vec3 vViewDir;
                      void main() {
                        vNormal = normalize(normalMatrix * normal);
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        vViewDir = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                      }
                    `}
                    fragmentShader={/* glsl */ `
                      uniform float uIntensity; // @prism uniform uIntensity float 0..3 =1.2
                      uniform float uPower; // @prism uniform uPower float 0.5..6 =2.8
                      varying vec3 vNormal;
                      varying vec3 vViewDir;
                      void main() {
                        float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), uPower);
                        vec3 col = mix(vec3(0.25, 0.4, 1.0), vec3(0.6, 0.35, 1.0), fres);
                        gl_FragColor = vec4(col * fres * uIntensity, fres);
                      }
                    `}
                  />
                </mesh>
              </group>
            </HoverScale>

            <group name="ring-a-tilt" rotation={[1.2, 0, 0.3]}>
              <Spin name="ring-a-spin" speed={0.5}>
                <group name="ring-a">
                  <mesh name="ring-a-band" rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[2.4, 0.012, 16, 200]} />
                    <meshBasicMaterial color="#6ee7ff" transparent opacity={0.8} />
                  </mesh>
                  <mesh name="ring-a-satellite" position={[2.4, 0, 0]}>
                    <sphereGeometry args={[0.07, 24, 24]} />
                    <meshBasicMaterial color="#6ee7ff" />
                  </mesh>
                </group>
              </Spin>
            </group>

            <group name="ring-b-tilt" rotation={[0.5, 0, -0.6]}>
              <Spin name="ring-b-spin" speed={-0.35}>
                <group name="ring-b">
                  <mesh name="ring-b-band" rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[3.0, 0.01, 16, 220]} />
                    <meshBasicMaterial color="#7c5cff" transparent opacity={0.7} />
                  </mesh>
                  <mesh name="ring-b-satellite" position={[-3.0, 0, 0]}>
                    <sphereGeometry args={[0.09, 24, 24]} />
                    <meshBasicMaterial color="#b9a6ff" />
                  </mesh>
                </group>
              </Spin>
            </group>

            <group name="ring-c-tilt" rotation={[1.9, 0, 0.9]}>
              <Spin name="ring-c-spin" speed={0.22}>
                <group name="ring-c">
                  <mesh name="ring-c-band" rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[3.6, 0.008, 16, 240]} />
                    <meshBasicMaterial color="#ff7ad9" transparent opacity={0.55} />
                  </mesh>
                  <mesh name="ring-c-satellite" position={[0, 0, 3.6]}>
                    <sphereGeometry args={[0.06, 24, 24]} />
                    <meshBasicMaterial color="#ff7ad9" />
                  </mesh>
                </group>
              </Spin>
            </group>
          </Float>
        </MouseFollow>

        <OrbitControls enableZoom={false} enablePan={false} enableDamping />
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
          color: "#e8ecff",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "3rem", margin: 0, letterSpacing: "-0.02em" }}>
          One world. Infinite orbits.
        </h1>
        <p style={{ opacity: 0.7, marginTop: "0.75rem" }}>
          Drag the globe, hover to feel it respond.
        </p>
      </div>
    </div>
  );
}

type WrapperProps = {
  name?: string;
  children?: ReactNode;
};

function Spin({ name, speed = 0.4, children }: WrapperProps & { speed?: number }) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return (
    <group name={name} ref={ref}>
      {children}
    </group>
  );
}

function MouseFollow({ name, strength = 0.3, children }: WrapperProps & { strength?: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ pointer }, delta) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y = MathUtils.damp(g.rotation.y, pointer.x * strength, 4, delta);
    g.rotation.x = MathUtils.damp(g.rotation.x, -pointer.y * strength, 4, delta);
  });
  return (
    <group name={name} ref={ref}>
      {children}
    </group>
  );
}

function HoverScale({ name, scale = 1.1, children }: WrapperProps & { scale?: number }) {
  const ref = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const target = hovered ? scale : 1;
    const s = MathUtils.damp(g.scale.x, target, 6, delta);
    g.scale.set(s, s, s);
  });
  return (
    <group
      name={name}
      ref={ref}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children}
    </group>
  );
}
