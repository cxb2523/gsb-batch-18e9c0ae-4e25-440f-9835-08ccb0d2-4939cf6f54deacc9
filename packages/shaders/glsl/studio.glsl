// A procedural photo studio: dark room, a large key softbox, a cool rim strip and a magenta kicker.
// d is a normalized WORLD-space direction. Values above 1.0 are intended (they tone-map into highlights).
vec3 studioEnv(vec3 d) {
  vec3 col = mix(vec3(0.012, 0.014, 0.03), vec3(0.07, 0.08, 0.13), smoothstep(-0.7, 0.9, d.y));
  float key = smoothstep(0.50, 0.92, dot(d, normalize(vec3(-0.55, 0.70, 0.55))));
  col += vec3(2.6, 2.45, 2.3) * key;
  float rim = smoothstep(0.80, 0.97, dot(d, normalize(vec3(0.90, 0.25, -0.45))));
  col += vec3(0.45, 0.75, 1.9) * rim * 1.6;
  float kicker = smoothstep(0.92, 0.995, dot(d, normalize(vec3(0.35, -0.55, 0.75))));
  col += vec3(1.9, 0.55, 1.3) * kicker;
  float top = smoothstep(0.85, 0.99, d.y);
  col += vec3(0.9, 0.95, 1.2) * top * 0.8;
  return col;
}

// View-space direction/normal to world space (ShaderMaterial exposes viewMatrix).
vec3 viewToWorld(vec3 v) {
  return normalize(vec3(vec4(v, 0.0) * viewMatrix));
}
