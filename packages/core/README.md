# @prismbox/core

Parser, subset classifier and minimal-diff writer for React Three Fiber source files. Part of [Prismbox](https://github.com/Guten-Morgen1302/prismbox).

**Status: early development, not published yet.** The API will change.

```ts
import { readScene, setProp } from '@prismbox/core';

const scene = readScene(source);            // nodes, props, diagnostics, coverage
const r = setProp(source, { op: 'setProp', node: 'orb', prop: 'position', value: [0.4, 0.1, 0] });
r.source; // the file with exactly one span changed
```

See [docs/subset.md](../../docs/subset.md) for what is editable.

MIT licensed.
