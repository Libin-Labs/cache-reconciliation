import test from 'node:test';
import assert from 'node:assert/strict';
import { planCacheReconciliation, CacheReconciliationError } from '../dist/esm/index.js';

test('documented workflow produces required outputs', async () => {
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
});
test('canonical keys compare equally', () => {
  assert.equal(
    planCacheReconciliation(
      [{ id: 'a', version: 1, value: { a: 1, b: 2 } }],
      [{ id: 'a', version: 1, value: { b: 2, a: 1 } }],
    ).items[0].action,
    'unchanged',
  );
});
test('reports regression and divergence', () => {
  assert.equal(
    planCacheReconciliation(
      [{ id: 'a', version: 2, value: 1 }],
      [{ id: 'a', version: 1, value: 1 }],
    ).items[0].reason,
    'server-version-regressed',
  );
  assert.equal(
    planCacheReconciliation(
      [{ id: 'a', version: 1, value: 1 }],
      [{ id: 'a', version: 1, value: 2 }],
    ).counts.conflict,
    1,
  );
});
test('complete absence and tombstones remove', () => {
  assert.equal(planCacheReconciliation([{ id: 'a', version: 1, value: 1 }], []).counts.remove, 1);
  assert.equal(
    planCacheReconciliation([], [{ id: 'a', version: 1, deleted: true }]).counts.remove,
    1,
  );
});
test('duplicates and limits reject without mutation', () => {
  const a = [{ id: 'a', version: 1, value: 1 }];
  assert.throws(() => planCacheReconciliation(a, [...a, ...a]), CacheReconciliationError);
  assert.throws(() => planCacheReconciliation(a, a, { maxRecords: 0 }));
  assert.equal(a[0].value, 1);
});
