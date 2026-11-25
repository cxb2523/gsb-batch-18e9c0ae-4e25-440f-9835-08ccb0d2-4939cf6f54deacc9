// Schlick-style rim term: 0 when facing the camera, 1 at grazing angles.
float fresnel(vec3 n, vec3 v, float power) {
  return pow(1.0 - clamp(dot(normalize(n), normalize(v)), 0.0, 1.0), power);
}
