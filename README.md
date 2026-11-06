# @lp-labs/cache-reconciliation

Version-aware authoritative cache reconciliation plans and conflict reports.

Original independent MIT TypeScript implementation with **zero runtime/peer dependencies**. ESM and CommonJS with separate declarations, Node 18+ (browser use when adapters/APIs are available). Development dependencies are not consumer runtime dependencies.

## Install

```sh
npm install @lp-labs/cache-reconciliation
```

## Complete example

```js
import assert from 'node:assert/strict';
import { planCacheReconciliation, CacheReconciliationError } from '@lp-labs/cache-reconciliation';
const report = planCacheReconciliation(
  [{ id: 'a', version: 1, value: 'old' }],
  [
    { id: 'a', version: 2, value: 'new' },
    { id: 'b', version: 1, value: null },
  ],
);
assert.deepEqual(
  report.items.map((item) => item.action),
  ['upsert', 'upsert'],
);
assert.equal(report.counts.upsert, 2);
```

CommonJS exposes the same API: `const api = require('@lp-labs/cache-reconciliation')`.

## Scope, customization and performance

Authoritative input is a COMPLETE snapshot: absence means remove. Explicit server tombstones also remove, including older tombstones by design; use only trusted complete snapshots, not deltas. Older live versions and equal-version differing values report conflicts. Pure planning does not apply writes. Defaults 10,000 records per side and 1 MiB per value. Output sorted by id, nested object keys canonicalized. Finite JSON values only. Work O(records log records + JSON size); depth is bounded.

Configure explicit limits, clocks, policies and adapters through the API below. Error classes and standard TypeError/RangeError reject malformed input; adapter/handler errors propagate. Await asynchronous methods and handle rejection in your application; no success-shaped fallback on failed work. Inputs must be trusted ordinary data, not hostile proxies; adapters must meet documented atomicity, isolation and ownership contracts. This package never publishes data, loads external code or starts background services at import time.

## API reference

The complete exported TypeScript contract (including option defaults discussed above, method return shapes, and error codes) is included below. TypeScript users import interfaces using `import type`; JavaScript users pass matching ordinary objects. Signature optionals indicate intentionally optional fields, not silent recovery.

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type CacheRecord<T extends JsonValue = JsonValue> =
  | {
      id: string;
      version: number;
      deleted: true;
    }
  | {
      id: string;
      version: number;
      deleted?: false;
      value: T;
    };
export type ReconciliationReason =
  | 'local-missing'
  | 'server-missing'
  | 'server-tombstone'
  | 'server-newer'
  | 'equal'
  | 'equal-version-divergence'
  | 'server-version-regressed';
export type ReconciliationAction = 'upsert' | 'remove' | 'unchanged' | 'conflict';
export interface ReconciliationItem<T extends JsonValue = JsonValue> {
  id: string;
  action: ReconciliationAction;
  reason: ReconciliationReason;
  localVersion?: number;
  serverVersion?: number;
  record?: CacheRecord<T>;
}
export interface ReconciliationReport<T extends JsonValue = JsonValue> {
  items: ReconciliationItem<T>[];
  counts: Record<ReconciliationAction, number>;
}
export interface ReconciliationOptions {
  maxRecords?: number;
  maxValueBytes?: number;
}
export declare class CacheReconciliationError extends Error {
  readonly code: 'invalid' | 'capacity';
  constructor(code: 'invalid' | 'capacity', message: string);
}
/** Plans deterministic cache changes without mutating either supplied collection. */
export declare function planCacheReconciliation<T extends JsonValue>(
  localRecords: readonly CacheRecord<T>[],
  authoritativeRecords: readonly CacheRecord<T>[],
  options?: ReconciliationOptions,
): ReconciliationReport<T>;
```

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
