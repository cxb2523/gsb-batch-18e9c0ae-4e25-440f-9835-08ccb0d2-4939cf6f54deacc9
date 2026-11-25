import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Html } from "@react-three/drei";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uAmp;
  uniform float uOffset;
  varying vec2 vUv;
  varying float vElevation;

  vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main(){
    vUv = uv;
    vec3 pos = position;

    float t = uTime * 0.18;
    float n1 = snoise(vec2(pos.x * 0.18 + t + uOffset, pos.y * 0.30 - t * 0.6));
    float n2 = snoise(vec2(pos.x * 0.45 - t * 1.3, pos.y * 0.55 + t + uOffset)) * 0.45;
    float sweep = sin(pos.x * 0.35 + pos.y * 0.25 + uTime * 0.4 + uOffset * 3.0) * 0.55;

    float d = distance(pos.xy, uMouse);
    float ripple = exp(-d * 0.35) * sin(d * 1.6 - uTime * 2.2) * 0.55;

    float e = (n1 + n2 + sweep) * uAmp + ripple;
    pos.z += e;
    vElevation = e;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uAlpha;
  uniform float uOffset;
  varying vec2 vUv;
  varying float vElevation;

  void main(){
    float k = vElevation * 0.35 + 0.5 + vUv.x * 0.35 - vUv.y * 0.2;
    k += sin(uTime * 0.15 + uOffset) * 0.08;
    k = clamp(k, 0.0, 1.0);

    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.55, k));
    col = mix(col, uColorC, smoothstep(0.45, 1.0, k));

    // soft highlight along crests
    float crest = smoothstep(0.55, 1.1, vElevation);
    col += crest * 0.18;

    // fade edges
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x)
               * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);

    gl_FragColor = vec4(col, uAlpha * edge);
  }
`;

type LayerProps = {
  offset: number;
  z: number;
  amp: number;
  alpha: number;
  colors: [string, string, string];
  mouse: React.MutableRefObject<THREE.Vector2>;
};

function WaveLayer({ offset, z, amp, alpha, colors, mouse }: LayerProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(999, 999) },
      uAmp: { value: amp },
      uOffset: { value: offset },
      uAlpha: { value: alpha },
      uColorA: { value: new THREE.Color(colors[0]) },
      uColorB: { value: new THREE.Color(colors[1]) },
      uColorC: { value: new THREE.Color(colors[2]) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useFrame((state) => {
    const m = matRef.current;
    if (!m) return;
    m.uniforms.uTime.value = state.clock.elapsedTime;
    (m.uniforms.uMouse.value as THREE.Vector2).lerp(mouse.current, 0.06);
  });

  return (
    <mesh position={[0, 0, z]} rotation={[-0.9, 0, 0.12]}>
      <planeGeometry args={[30, 18, 220, 130]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}

function Scene() {
  const mouse = useRef(new THREE.Vector2(999, 999));
  const group = useRef<THREE.Group>(null);
  const { viewport } = useThree();

  useFrame((state) => {
    // Pointer in approximate plane-space units
    mouse.current.set(state.pointer.x * viewport.width * 0.5, state.pointer.y * viewport.height * 0.5);
    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, state.pointer.x * 0.12, 0.04);
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -state.pointer.y * 0.06, 0.04);
    }
  });

  return (
    <group ref={group}>
      <WaveLayer offset={0.0} z={-3.0} amp={1.2} alpha={1.0} mouse={mouse} colors={["#1a0b4d", "#5b2bff", "#ff5fa2"]} />
      <WaveLayer offset={1.7} z={-1.8} amp={1.0} alpha={0.75} mouse={mouse} colors={["#0b2a6b", "#2f8bff", "#7cf0ff"]} />
      <WaveLayer offset={3.4} z={-0.6} amp={0.8} alpha={0.55} mouse={mouse} colors={["#4a1a8c", "#ff6ac1", "#ffd27a"]} />
      <WaveLayer offset={5.1} z={0.6} amp={0.6} alpha={0.35} mouse={mouse} colors={["#1b1464", "#8a5cff", "#9bf3ff"]} />
    </group>
  );
}

export default function Hero() {
  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: 560,
        overflow: "hidden",
        background: "#070514",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: false }} style={{ position: "absolute", inset: 0 }}>
        <color attach="background" args={["#070514"]} />
        <PerspectiveCamera makeDefault position={[0, 0, 9]} fov={50} />
        <Suspense fallback={<Html center>Loading…</Html>}>
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
          justifyContent: "center",
          textAlign: "center",
          padding: "0 24px",
          color: "#fff",
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, rgba(7,5,20,0.45) 0%, rgba(7,5,20,0) 65%)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(40px, 7vw, 92px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.02,
            textShadow: "0 4px 40px rgba(20,10,80,0.5)",
          }}
        >
          Build products
          <br />
          that flow.
        </h1>
        <p
          style={{
            margin: "24px 0 0",
            maxWidth: 560,
            fontSize: "clamp(16px, 1.6vw, 20px)",
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.82)",
          }}
        >
          A beautifully layered foundation for your next launch. Move your cursor and watch it respond.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 32, pointerEvents: "auto" }}>
          <a
            href="#get-started"
            style={{
              padding: "14px 26px",
              borderRadius: 999,
              background: "#fff",
              color: "#1a0b4d",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get started
          </a>
          <a
            href="#learn-more"
            style={{
              padding: "14px 26px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#fff",
              fontWeight: 500,
              textDecoration: "none",
              backdropFilter: "blur(8px)",
            }}
          >
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
}
