import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const vercel = JSON.parse(read('../vercel.json')) as { rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] };
const headersFile = read('../public/_headers');
const get = (source: string, key: string) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value;

describe('static host configs for the sandboxed Playground', () => {
  it('Vercel: CORS on assets (opaque-origin iframe), a strict Studio CSP, a framable sandbox page', () => {
    expect(get('/assets/(.*)', 'Access-Control-Allow-Origin')).toBe('*');
    expect(get('/assets/(.*)', 'Cache-Control')).toContain('immutable');
    expect(get('/sandbox.html', 'Access-Control-Allow-Origin')).toBe('*');
    expect(get('/sandbox.html', 'Content-Security-Policy')).toBe("frame-ancestors 'self'");
    for (const page of ['/', '/index.html']) {
      const csp = get(page, 'Content-Security-Policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe/);
      expect(csp).toContain("frame-src 'self'");
    }
    expect(vercel.headers.some((h) => h.headers.some((x) => x.key === 'X-Frame-Options'))).toBe(false); // would break the preview iframe
  });

  it('Vercel: SPA rewrite that leaves assets and the sandbox page alone', () => {
    const re = new RegExp(`^${vercel.rewrites[0]!.source}$`);
    expect(vercel.rewrites[0]!.destination).toBe('/index.html');
    expect(re.test('/some/deep/link')).toBe(true);
    expect(re.test('/assets/index-abc.js')).toBe(false);
    expect(re.test('/sandbox.html')).toBe(false);
  });

  it('Cloudflare _headers: the same rules', () => {
    expect(headersFile).toMatch(/\/assets\/\*\n\s+Access-Control-Allow-Origin: \*/);
    expect(headersFile).toMatch(/\/sandbox\.html\n\s+Access-Control-Allow-Origin: \*/);
    expect(headersFile).toContain("frame-ancestors 'none'");
    expect(headersFile).toContain("frame-ancestors 'self'");
    expect(headersFile).not.toContain('X-Frame-Options');
    expect(headersFile).toContain('X-Content-Type-Options: nosniff');
  });
});
