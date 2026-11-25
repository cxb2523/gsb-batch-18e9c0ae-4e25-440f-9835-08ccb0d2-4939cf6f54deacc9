/** Bumped whenever the editable subset changes in a way that affects existing files. */
export const SUBSET_VERSION = 1;

/** Lowercase JSX tags that are DOM/SVG, never R3F host elements. */
export const HTML_TAGS: ReadonlySet<string> = new Set(
  (
    'a abbr article aside audio b body br button canvas code dd div dl dt em fieldset figure footer form ' +
    'h1 h2 h3 h4 h5 h6 header hr i iframe img input label legend li main nav ol option p picture pre ' +
    'section select small source span strong sub sup svg path table tbody td textarea th thead tr u ul ' +
    'video style script'
  ).split(' '),
);

/** Host elements whose contents Prismbox does not understand: selectable, never rewritten. */
export const OPAQUE_TAGS: ReadonlySet<string> = new Set([
  'bufferGeometry',
  'bufferAttribute',
  'instancedBufferAttribute',
  'primitive',
]);

/** Props whose value may be a `THREE.Foo` enum member and still count as a literal. */
export const ENUM_PROPS: ReadonlySet<string> = new Set(['side', 'blending']);

/** Constructors that may appear as `new THREE.X(literal args)` inside a literal value. */
export const NEWABLE: ReadonlySet<string> = new Set(['Color', 'Vector2', 'Vector3', 'Vector4', 'Euler']);

/** Packages a scene file may import from (plus relative files and `three/...`). */
export const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  'react',
  'three',
  '@react-three/fiber',
  '@react-three/drei',
]);

/** Props on `shaderMaterial` that may resolve through a same-file binding. */
export const SHADER_RESOLVABLE_PROPS: ReadonlySet<string> = new Set(['vertexShader', 'fragmentShader', 'uniforms']);

/** GLSL source is never edited in v1, only uniforms. */
export const GLSL_PROPS: ReadonlySet<string> = new Set(['vertexShader', 'fragmentShader']);
