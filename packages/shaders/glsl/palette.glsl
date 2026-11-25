// Cosine palette (Inigo Quilez): a + b * cos(2pi * (c * t + d)).
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

// Cheap hash grain, in [-0.5, 0.5], to break up banding in dark gradients.
float grain(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}
