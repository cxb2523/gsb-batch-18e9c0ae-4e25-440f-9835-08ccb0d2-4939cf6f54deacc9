import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../src/read';
import { applyOps, PrismError, setUniform } from '../src/index';

// Replace analyze with a spy that delegates to the real parser unless a test overrides it.
vi.mock('../src/read', async (importOriginal) => {
  const actual = (await importOriginal()) as { analyze: typeof analyze };
  return { ...actual, analyze: vi.fn(actual.analyze) };
});

const mockedAnalyze = vi.mocked(analyze);
const actualRead = (await vi.importActual('../src/read')) as { analyze: typeof analyze };
const realAnalyze = actualRead.analyze;

const src = `import { Canvas } from "@react-three/fiber";
export default function H() {
  const u = { uI: { value: 0.6 } };
  return (
    <Canvas>
      <shaderMaterial name="matA" uniforms={u} />
      <shaderMaterial name="matB" uniforms={u} />
    </Canvas>
  );
}
`;

describe('shared-binding write-back verification', () => {
  it('surfaces WRITE_VERIFICATION_FAILED when the edited output cannot re-parse', () => {
    mockedAnalyze.mockImplementation((source, file) => {
      if (source.includes('7.777')) throw new Error('synthetic parse failure');
      return realAnalyze(source, file);
    });

    let caught: unknown;
    try {
      setUniform(src, { op: 'setUniform', node: 'matA', uniform: 'uI', value: 7.777 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PrismError);
    expect((caught as PrismError).code).toBe('WRITE_VERIFICATION_FAILED');
  });

  it('a verification failure inside applyOps returns no partial batch result', () => {
    mockedAnalyze.mockImplementation((source, file) => {
      if (source.includes('8.888')) throw new Error('synthetic parse failure');
      return realAnalyze(source, file);
    });

    let caught: unknown;
    let returned: unknown;
    try {
      returned = applyOps(src, [{ op: 'setUniform', node: 'matA', uniform: 'uI', value: 8.888 }]);
    } catch (e) {
      caught = e;
    }
    expect(returned).toBeUndefined();
    expect(caught).toBeInstanceOf(PrismError);
    expect((caught as PrismError).code).toBe('WRITE_VERIFICATION_FAILED');
    // the caller's source still holds the original literal
    expect(src).toContain('value: 0.6');
  });
});
