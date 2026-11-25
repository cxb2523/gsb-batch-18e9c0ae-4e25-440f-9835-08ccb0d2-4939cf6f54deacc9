/**
 * The agent style guide, served as the MCP resource `prismbox://guide` and usable in AGENTS.md / CLAUDE.md.
 * One source of truth: everything here is enforced by the reader and writer in this package.
 */
export const GUIDE = `# Prismbox: writing React Three Fiber that a visual editor can edit

Prismbox edits your \`.tsx\` as minimal text diffs. It only edits what it can understand, so write scene code in the **Prism subset**. Anything outside it still runs; it is just shown read-only and never rewritten.

## The rules

1. **Literal props.** Every prop on a scene element (mesh, group, lights, geometries, materials) is a literal: numbers, strings, booleans, arrays or objects of those, \`Math.PI\` angle forms (\`Math.PI / 2\`), \`new THREE.Color("#7c5cff")\`, \`new THREE.Vector3(1, 2, 3)\`. Write \`position={[0, 1, 0]}\`, \`args={[1, 64, 64]}\`, \`color="#7c5cff"\`. Do not compute props from variables, props, state or function calls.
2. **Name every mesh and group** with a unique literal \`name\`: \`<mesh name="orb">\`. Prismbox addresses nodes by name; unnamed nodes get fragile path ids and duplicate names are refused.
3. **No spreads, no \`.map()\`, no conditionals around scene elements** you want editable. Write the important nodes out. Nodes inside \`.map()\` or \`cond && <mesh/>\` are selectable but locked.
4. **Motion lives in small wrapper components** in the same file (\`Spin\`, \`MouseFollow\`, \`Drift\`, \`HoverScale\`, \`Clock\`) that wrap plain literal children. Do not mutate transforms of scene nodes from \`useFrame\` inside the scene component. Animation that reads the R3F clock (\`state.clock.elapsedTime\`, \`delta\`) pauses cleanly while the user drags the gizmo; \`performance.now()\` / \`Date.now()\` do not.
5. **Shaders:** put GLSL in a top-level \`const\` as a \`/* glsl */\` template literal and pass it by name: \`vertexShader={vert} fragmentShader={frag}\`. Put \`uniforms\` in a top-level \`const\` object literal (or \`useMemo(() => ({...}), [])\` with an **empty** dependency array) and pass it by name. Same-file \`const\` bindings are resolved; imports are not followed.
6. **Annotate tunable uniforms** in the GLSL so the editor can build sliders: \`// @prism uniform uGlow float 0..2 =1\`, \`// @prism uniform uTint color =#7c5cff\` (types: float, int, bool, vec2, vec3, vec4, color). These are ordinary GLSL comments; they import nothing and cost nothing.
7. **Mixed uniforms are fine.** \`{ uTex: { value: texture }, uMix: { value: 0.5 } }\`: \`uMix\` stays editable, only \`uTex\` is read-only.
8. **One scene per file, one \`<Canvas camera={{ position: [0, 0, 6], fov: 40 }}>\`** with a literal camera. Do not set \`preserveDrawingBuffer\`; capture does not need it.
9. **Imports** only from \`react\`, \`three\`, \`@react-three/fiber\`, \`@react-three/drei\` and relative files. Never import Prismbox: it must not be a dependency of the project.
10. **drei components Prismbox understands:** \`Environment\`, \`Float\`, \`OrbitControls\`, \`MeshTransmissionMaterial\`, \`MeshDistortMaterial\`, \`Lightformer\`, \`Stars\`, \`Sparkles\`, \`PerspectiveCamera\`. Others work but are left alone. \`<Environment preset="...">\` downloads HDRs at runtime; for offline, deterministic lighting prefer \`<Lightformer>\` children or a procedural shader.

## What \`ref\`, handlers and \`key\` do

\`ref\`, \`key\` and event handlers (\`onClick\`, ...) are never edited and do not make a node read-only.

## Working with the tools

- Call \`prism_get_selection\` whenever the user says "this", "that" or "here": it returns the node they have selected in the editor (file, line, props, uniforms, surrounding source).
- Call \`prism_get_view\` to look at the live scene before and after a visual change.
- Prefer \`prism_set_prop\` / \`prism_set_uniform\` for small tweaks (they are minimal one-line diffs, compare-and-set, and the user can undo them with one click). For structural changes, edit the file directly and run \`prism_lint\`.
- A tool error carries a \`code\`, what happened and the fix. \`CONFLICT\` means the file changed since you looked: re-read it and retry. \`OUT_OF_SUBSET\` means that prop is an expression: change the source by hand or make it a literal.
- Do not edit a file and call a Prismbox tool on it in the same breath without re-reading: Prismbox always compares against the file on disk.
`;
