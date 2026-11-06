export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CacheRecord<T extends JsonValue = JsonValue> =
  | { id: string; version: number; deleted: true }
  | { id: string; version: number; deleted?: false; value: T };

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

export class CacheReconciliationError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity',
    message: string,
  ) {
    super(message);
    this.name = 'CacheReconciliationError';
  }
}

function fail(message: string): never {
  throw new CacheReconciliationError('invalid', message);
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return fail(`${label} must be a safe integer from ${min} to ${max}.`);
  }
  return value;
}

function ownRecord(
  value: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(`${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0)
    return fail(`${label} cannot have symbol keys.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key)))
    return fail(`${label} has unknown fields.`);
  return record;
}

function cloneJson(
  value: unknown,
  budget: { nodes: number; maxNodes: number },
  depth = 0,
): JsonValue {
  budget.nodes++;
  if (budget.nodes > budget.maxNodes || depth > 64) {
    throw new CacheReconciliationError(
      'capacity',
      'Record values exceed the configured node limit.',
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return Array.from(value, (entry) => cloneJson(entry, budget, depth + 1));
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  ) {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) return fail('Record values cannot contain undefined.');
      Object.defineProperty(result, key, {
        value: cloneJson(entry, budget, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return fail('Record values must contain only finite JSON values and plain objects.');
}

function parseRecords<T extends JsonValue>(
  input: readonly CacheRecord<T>[],
  maxRecords: number,
  maxValueBytes: number,
): Map<string, CacheRecord<T>> {
  if (!Array.isArray(input) || input.length > maxRecords) {
    throw new CacheReconciliationError('capacity', 'Input exceeds the configured record limit.');
  }
  const result = new Map<string, CacheRecord<T>>();
  for (const candidate of input as readonly unknown[]) {
    const raw = ownRecord(candidate, ['id', 'version', 'deleted', 'value'], 'Cache record');
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 512) {
      return fail('Record id must contain 1–512 characters.');
    }
    const id = raw.id;
    const version = integer(raw.version, 0, Number.MAX_SAFE_INTEGER, 'Record version');
    if (result.has(id)) return fail(`Duplicate record id: ${id}.`);
    if (raw.deleted === true) {
      if (Object.hasOwn(raw, 'value')) return fail('Tombstones cannot contain a value.');
      result.set(id, { id, version, deleted: true });
    } else {
      if (raw.deleted !== undefined && raw.deleted !== false)
        return fail('deleted must be boolean.');
      if (!Object.hasOwn(raw, 'value')) return fail('Live records require a value.');
      const value = cloneJson(raw.value, { nodes: 0, maxNodes: 100_000 }) as T;
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxValueBytes) {
        throw new CacheReconciliationError('capacity', 'A record value exceeds the byte limit.');
      }
      result.set(id, { id, version, value });
    }
  }
  return result;
}

function sameValue(a: CacheRecord, b: CacheRecord): boolean {
  if (a.deleted === true || b.deleted === true) return a.deleted === b.deleted;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

/** Plans deterministic cache changes without mutating either supplied collection. */
export function planCacheReconciliation<T extends JsonValue>(
  localRecords: readonly CacheRecord<T>[],
  authoritativeRecords: readonly CacheRecord<T>[],
  options: ReconciliationOptions = {},
): ReconciliationReport<T> {
  ownRecord(options, ['maxRecords', 'maxValueBytes'], 'Options');
  const maxRecords = integer(options.maxRecords ?? 10_000, 1, 100_000, 'maxRecords');
  const maxValueBytes = integer(options.maxValueBytes ?? 1_048_576, 1, 16_777_216, 'maxValueBytes');
  const local = parseRecords(localRecords, maxRecords, maxValueBytes);
  const server = parseRecords(authoritativeRecords, maxRecords, maxValueBytes);
  const items: ReconciliationItem<T>[] = [];
  const ids = [...new Set([...local.keys(), ...server.keys()])].sort();
  for (const id of ids) {
    const cached = local.get(id);
    const remote = server.get(id);
    if (!cached && remote) {
      items.push({
        id,
        action: remote.deleted ? 'remove' : 'upsert',
        reason: remote.deleted ? 'server-tombstone' : 'local-missing',
        serverVersion: remote.version,
        ...(remote.deleted ? {} : { record: remote }),
      });
    } else if (cached && !remote) {
      items.push({ id, action: 'remove', reason: 'server-missing', localVersion: cached.version });
    } else if (cached && remote) {
      if (remote.deleted) {
        items.push({
          id,
          action: 'remove',
          reason: 'server-tombstone',
          localVersion: cached.version,
          serverVersion: remote.version,
        });
      } else if (remote.version > cached.version) {
        items.push({
          id,
          action: 'upsert',
          reason: 'server-newer',
          localVersion: cached.version,
          serverVersion: remote.version,
          record: remote,
        });
      } else if (remote.version < cached.version) {
        items.push({
          id,
          action: 'conflict',
          reason: 'server-version-regressed',
          localVersion: cached.version,
          serverVersion: remote.version,
        });
      } else if (sameValue(cached, remote)) {
        items.push({
          id,
          action: 'unchanged',
          reason: 'equal',
          localVersion: cached.version,
          serverVersion: remote.version,
        });
      } else {
        items.push({
          id,
          action: 'conflict',
          reason: 'equal-version-divergence',
          localVersion: cached.version,
          serverVersion: remote.version,
        });
      }
    }
  }
  const counts: Record<ReconciliationAction, number> = {
    upsert: 0,
    remove: 0,
    unchanged: 0,
    conflict: 0,
  };
  for (const item of items) counts[item.action]++;
  return { items, counts };
}
