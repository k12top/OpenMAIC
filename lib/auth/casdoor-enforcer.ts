/**
 * Thin wrapper over the Casdoor SDK's casbin enforce / batch-enforce
 * endpoints. Used by `lib/auth/menu-enforcer.ts` to evaluate
 * `(subject, domain, menuId, op)` decisions against the policies an admin
 * configured in the Casdoor dashboard.
 *
 * Why a wrapper?
 *  - The SDK requires five string arguments (`permissionId`, `modelId`,
 *    `resourceId`, `enforcerId`, `owner`) and returns a 2-D boolean matrix
 *    (one row per matched permission). We collapse that to a single array
 *    via logical-OR which matches the "some-allow" effect in the casbin
 *    model we recommend.
 *  - We surface a single {@link EnforcerUnavailableError} so the snapshot
 *    builder can fall back gracefully when Casdoor is unreachable, has
 *    misconfigured RBAC, or hasn't been opted into via the
 *    `CASDOOR_RBAC_ENABLED` flag.
 */

import { casdoorSDK, casdoorConfig } from './casdoor';
import { createLogger } from '@/lib/logger';

const log = createLogger('casdoor-enforcer');

/**
 * Tuple format Casdoor expects: `[sub, dom, obj, act]` (or just
 * `[sub, obj, act]` if the configured model is RBAC without domains).
 * Strings only — never undefined / null.
 */
export type CasbinRequest = [string, string, string, string] | [string, string, string];

export class EnforcerUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EnforcerUnavailableError';
    this.cause = cause;
  }
}

/**
 * Resolve the Casdoor permission identifier we should pass on every call.
 *
 * The SDK accepts `<owner>/<name>`. We default to
 * `<CASDOOR_ORG_NAME>/<CASDOOR_PERMISSION_NAME>` so a single env var can
 * override the permission name without touching the org.
 */
function resolvePermissionId(): string {
  const owner = process.env.CASDOOR_ORG_NAME || casdoorConfig.orgName || 'built-in';
  const name = process.env.CASDOOR_PERMISSION_NAME || 'openmaic-menus';
  return `${owner}/${name}`;
}

/**
 * Collapse the SDK's `boolean[][]` (one row per matched permission)
 * down to a single `boolean[]` via logical-OR. Matches the
 * "some(where (p.eft == allow))" effect in the recommended casbin model.
 */
function reduceMatrix(matrix: boolean[][], expectedLen: number): boolean[] {
  if (matrix.length === 0) return new Array(expectedLen).fill(false);
  const out = new Array(expectedLen).fill(false);
  for (const row of matrix) {
    for (let i = 0; i < expectedLen; i++) {
      if (row[i]) out[i] = true;
    }
  }
  return out;
}

/**
 * Issue a single enforce call against Casdoor. Used by direct callers
 * (the snapshot builder uses {@link batchEnforce} instead — one HTTP
 * round-trip is much cheaper than N).
 */
export async function enforceOne(req: CasbinRequest): Promise<boolean> {
  try {
    return await casdoorSDK.enforce(resolvePermissionId(), '', '', '', '', req);
  } catch (err) {
    log.warn('enforce failed', err);
    throw new EnforcerUnavailableError('Casdoor enforce call failed', err);
  }
}

/**
 * Batch enforce a list of casbin requests in a single round-trip.
 * Returns one boolean per input request (in the same order). Throws
 * {@link EnforcerUnavailableError} if Casdoor cannot be reached or
 * returns an unexpected payload.
 */
export async function batchEnforce(reqs: readonly CasbinRequest[]): Promise<boolean[]> {
  if (reqs.length === 0) return [];
  try {
    const matrix = await casdoorSDK.batchEnforce(
      resolvePermissionId(),
      '',
      '',
      '',
      '',
      reqs as CasbinRequest[],
    );
    return reduceMatrix(matrix, reqs.length);
  } catch (err) {
    log.warn(`batchEnforce of ${reqs.length} requests failed`, err);
    throw new EnforcerUnavailableError('Casdoor batchEnforce call failed', err);
  }
}

/**
 * Quick health probe — returns true when we are reasonably sure the
 * Casdoor enforce endpoint is reachable and configured. Used by the
 * snapshot builder to decide between the casdoor source and the env
 * fallback at startup.
 */
export async function pingEnforcer(): Promise<boolean> {
  try {
    // A noop request the policy is unlikely to ever allow — we only care
    // that we got a structured response, not the boolean value itself.
    await enforceOne(['__healthcheck__', '__noop__', '__noop__', '__noop__']);
    return true;
  } catch {
    return false;
  }
}
