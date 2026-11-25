import * as THREE from 'three';

// Sun sits low, front-left of the player, so the skyline is backlit at sunset.
export const SUN_DIR = new THREE.Vector3(-0.55, 0.055, -0.83).normalize();
export const FOG_COLOR = new THREE.Color('#9c6a62');

export function createSky() {
  const geo = new THREE.SphereGeometry(4000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR.clone() },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // keep sky at far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform float time;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 horizon = vec3(1.00, 0.58, 0.32);
        vec3 low     = vec3(0.93, 0.44, 0.33);
        vec3 mid     = vec3(0.44, 0.30, 0.45);
        vec3 top     = vec3(0.06, 0.09, 0.21);
        vec3 col;
        if (h < 0.0) {
          col = mix(vec3(0.62, 0.40, 0.36), vec3(0.18, 0.12, 0.15), clamp(-h * 5.0, 0.0, 1.0));
        } else {
          col = mix(horizon, low, smoothstep(0.0, 0.07, h));
          col = mix(col, mid, smoothstep(0.05, 0.28, h));
          col = mix(col, top, smoothstep(0.22, 0.75, h));
        }
        // sunward warmth
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.28;
        col += vec3(1.0, 0.62, 0.30) * pow(s, 48.0) * 0.45;
        col += vec3(1.0, 0.86, 0.62) * smoothstep(0.9993, 0.9997, s) * 1.6;
        // faint high-altitude banding
        col *= 1.0 + 0.025 * sin(h * 90.0 + d.x * 6.0);
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
