/**
 * The known-drei table: drei components Prismbox understands, with the props it
 * will edit when they hold literals. Anything imported from drei that is not
 * listed here is reported with an `UNKNOWN_DREI_COMPONENT` diagnostic and left
 * alone.
 *
 * `Lightformer`, `Stars`, `Sparkles` and `PerspectiveCamera` were added after the
 * Step 0 coverage spike found Claude reaching for them unprompted.
 */
export const DREI_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  Environment: ['preset', 'background', 'blur', 'environmentIntensity'],
  Float: ['speed', 'rotationIntensity', 'floatIntensity', 'floatingRange'],
  OrbitControls: [
    'target',
    'enableZoom',
    'enablePan',
    'enableRotate',
    'autoRotate',
    'autoRotateSpeed',
    'minDistance',
    'maxDistance',
    'minPolarAngle',
    'maxPolarAngle',
    'enableDamping',
    'dampingFactor',
  ],
  MeshTransmissionMaterial: [
    'color',
    'transmission',
    'thickness',
    'roughness',
    'ior',
    'chromaticAberration',
    'anisotropy',
    'distortion',
    'distortionScale',
    'temporalDistortion',
    'samples',
    'resolution',
    'backside',
  ],
  MeshDistortMaterial: ['color', 'distort', 'speed', 'roughness', 'metalness', 'transparent', 'opacity'],
  Lightformer: ['position', 'rotation', 'scale', 'color', 'intensity', 'form'],
  Stars: ['radius', 'depth', 'count', 'factor', 'saturation', 'fade', 'speed'],
  Sparkles: ['count', 'speed', 'opacity', 'color', 'size', 'scale', 'noise'],
  PerspectiveCamera: ['makeDefault', 'position', 'rotation', 'fov', 'near', 'far', 'zoom'],
};

export const DREI_PACKAGE = '@react-three/drei';

export function isKnownDrei(importedName: string): boolean {
  return Object.prototype.hasOwnProperty.call(DREI_COMPONENTS, importedName);
}
