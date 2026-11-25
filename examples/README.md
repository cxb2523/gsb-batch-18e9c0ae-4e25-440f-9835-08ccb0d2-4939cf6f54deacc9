# Examples

## Deterministic simulation acceptance demo

From the repository root, run with Node.js 24+ (or any TypeScript ESM loader):

```sh
node examples/demo.ts
# or
npm test
```

The demo is executable documentation and exits non-zero if any assertion fails.
It verifies:

1. The same 2-second input segment is grouped into frames at both 60Hz and
   240Hz. Both runs commit exactly 256 physics ticks and finish with
   deep-equal positions and velocities.
2. Every rendered position is a linear interpolation between the two latest
   committed tick snapshots.
3. Calling the view layer leaves the physics state untouched.
4. Frame time and mouse deltas are split across the exact ticks driven by that
   frame; the mouse shares sum to the original delta.
5. Blur/focus and pause/resume clear accumulated time and stale mouse backlog.
   A simulated five-second background gap produces no 640-tick catch-up burst,
   and the recovery frame matches an ordinary 60Hz frame.

`basic.ts` remains the original minimal import example:

```sh
node examples/basic.ts
```

## Browser wiring

The core modules are DOM-free. A browser entry point should:

- create one `FixedTickLoop`;
- call `frameAt(performance.now() / 1000, input)` from `requestAnimationFrame`;
- forward `blur` / `visibilitychange` to `loop.blur()` and `loop.focus()`;
- call `loop.view.render()` or `loop.render()` and send the returned read-only
  pose to the renderer.
