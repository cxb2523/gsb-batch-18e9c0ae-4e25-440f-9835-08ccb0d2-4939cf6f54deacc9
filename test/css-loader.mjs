// Module loader hook so the renderer layer's `import './movy-subtitle.css'`
// resolves to an empty module when tests import it directly with Node.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {};' };
  }
  return nextLoad(url, context);
}
