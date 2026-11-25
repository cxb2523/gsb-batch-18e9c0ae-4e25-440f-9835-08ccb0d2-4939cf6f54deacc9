// Small deterministic harness used by the subtitle translation tests.
import assert from 'node:assert/strict';

const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

export async function run(label = 'tests') {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  console.log(`\n${label}: ${passed}/${tests.length} passed`);
  for (const { name, error } of failures) {
    console.log(`  FAIL ${name}\n    ${(error && error.stack) || error}`);
  }
  if (failures.length) process.exitCode = 1;
  return failures.length === 0;
}

export { assert };

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

// Controllable translation stub: every request waits on a manual gate so a test
// can hold responses in flight, resolve them out of order, or abort them.
export function createStub() {
  const requests = [];
  const stub = {
    requests,
    calls: 0,
    async translate(text, from, signal) {
      stub.calls += 1;
      const req = { text, from, signal, aborted: false };
      requests.push(req);
      return new Promise((resolve, reject) => {
        req.resolve = (value) => resolve(value);
        req.reject = (error) => reject(error);
        if (signal) {
          signal.addEventListener('abort', () => {
            req.aborted = true;
            reject(new Error('aborted'));
          }, { once: true });
        }
      });
    },
    pending() { return requests.filter((r) => !r.aborted && !r.settled); },
    texts() { return requests.map((r) => r.text); },
  };
  return stub;
}

export function makeCues(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({ s: i * 2, e: i * 2 + 1.8, t: `${prefix} line ${i}` }));
}
