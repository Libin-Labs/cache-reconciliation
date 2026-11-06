import { planCacheReconciliation, CacheReconciliationError } from '@lp-labs/cache-reconciliation';
const publicAPI = [planCacheReconciliation, CacheReconciliationError];
const apiCount: number = publicAPI.length;
void apiCount;
const report = planCacheReconciliation([{ id: 'a', version: 1, value: 'text' }], []);
const count: number = report.counts.conflict;
void count;
