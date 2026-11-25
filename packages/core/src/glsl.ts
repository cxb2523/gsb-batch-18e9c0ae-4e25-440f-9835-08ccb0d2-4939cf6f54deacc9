export type PrismUniformType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';

export interface PrismAnnotation {
  name: string;
  type: PrismUniformType;
  min?: number;
  max?: number;
  /** The default as written after `=`, unparsed. */
  default?: string;
}

const ANNOTATION =
  /^\s*\/\/\s*@prism\s+uniform\s+([A-Za-z_]\w*)\s+(float|int|bool|vec2|vec3|vec4|color)(?:\s+(-?\d*\.?\d+)\.\.(-?\d*\.?\d+))?(?:\s*=\s*(\S+))?\s*$/;

/**
 * Parse `// @prism uniform <name> <type> [min..max] [=default]` comments from GLSL source.
 * Lines that start with `@prism` but do not match the grammar are ignored here; `prism_lint`
 * will report them later.
 */
export function parsePrismAnnotations(glsl: string): PrismAnnotation[] {
  const out: PrismAnnotation[] = [];
  for (const line of glsl.split(/\r?\n/)) {
    const m = ANNOTATION.exec(line);
    if (!m) continue;
    const [, name, type, min, max, def] = m;
    const a: PrismAnnotation = { name: name as string, type: type as PrismUniformType };
    if (min !== undefined && max !== undefined) {
      a.min = Number(min);
      a.max = Number(max);
    }
    if (def !== undefined) a.default = def;
    out.push(a);
  }
  return out;
}
