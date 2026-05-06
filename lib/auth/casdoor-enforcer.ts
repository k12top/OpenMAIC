/**
 * Thin wrapper over the Casdoor SDK's casbin enforce / batch-enforce
 * endpoints. Used by `lib/auth/menu-enforcer.ts` to evaluate
 * `(subject, [domain,] menuId, op)` decisions against the policies an
 * admin configured in the Casdoor dashboard.
 *
 * Two ways Casdoor can resolve a request to a model + adapter:
 *  - **Permission mode** (`permissionId=<owner>/<name>`):
 *    Looks up a Casdoor "Permission" object. The Permission UI bakes in
 *    a `len(policy_definition) == 3` validator, so this only works with
 *    3-element models like `p = sub, obj, act`.
 *  - **Enforcer mode** (`enforcerId=<owner>/<name>`):
 *    Looks up a Casdoor "Enforcer" object (newer abstraction; bundles
 *    Model + Adapter + Policies in one place). NO model-shape validation
 *    — works with both 3-element and 4-element (RBAC-with-domains)
 *    models. **Recommended.**
 *
 * We send `enforcerId` when `CASDOOR_ENFORCER_NAME` is set, else fall
 * back to `permissionId` driven by `CASDOOR_PERMISSION_NAME`. Either way
 * the SDK returns a `boolean[][]` which we collapse via logical-OR
 * (matches the "some-allow" effect in our casbin model).
 *
 * On any failure we throw {@link EnforcerUnavailableError} so the
 * snapshot builder can fall back gracefully when Casdoor is unreachable,
 * misconfigured, or hasn't been opted into via `CASDOOR_RBAC_ENABLED`.
 */

import { casdoorSDK, casdoorConfig } from './casdoor';
import { createLogger } from '@/lib/logger';

const log = createLogger('casdoor-enforcer');

/**
 * Discriminated identifier for which Casdoor object should resolve the
 * model + adapter. Exactly one of `permissionId` / `enforcerId` is set
 * on each call — Casdoor uses the non-empty one and ignores the other.
 */
interface CasdoorIdentifier {
  permissionId: string;
  enforcerId: string;
  /** Human-readable label used in logs/diagnostics, e.g. `enforcer=k12/openmaic-exec`. */
  label: string;
}

function resolveIdentifier(): CasdoorIdentifier {
  const owner = process.env.CASDOOR_ORG_NAME || casdoorConfig.orgName || 'built-in';
  const enforcerName = (process.env.CASDOOR_ENFORCER_NAME ?? '').trim();
  if (enforcerName) {
    return {
      permissionId: '',
      enforcerId: `${owner}/${enforcerName}`,
      label: `enforcer=${owner}/${enforcerName}`,
    };
  }
  const permName = process.env.CASDOOR_PERMISSION_NAME || 'openmaic-menus';
  return {
    permissionId: `${owner}/${permName}`,
    enforcerId: '',
    label: `permission=${owner}/${permName}`,
  };
}

/**
 * Issue a raw fetch to Casdoor's `/api/<endpoint>` so we can capture the
 * actual `{status, msg, data}` payload — the SDK swallows these and
 * throws a generic "invalid data" Error, which makes misconfigurations
 * (missing permission/enforcer, wrong owner/name, model mismatch, etc.)
 * almost impossible to diagnose from logs.
 *
 * Auth: Casdoor's enforce APIs accept the client credentials as query
 * string OR as Basic auth. We use query string here so we don't have to
 * base64-encode and there are fewer cross-runtime concerns.
 */
async function rawCasdoorEnforce(
  endpoint: 'enforce' | 'batch-enforce',
  reqs: readonly CasbinRequest[] | CasbinRequest,
): Promise<{ status: string; msg: string; data: unknown }> {
  const base = (process.env.CASDOOR_ENDPOINT || casdoorConfig.endpoint || '').replace(/\/+$/, '');
  const clientId = process.env.CASDOOR_CLIENT_ID || casdoorConfig.clientId || '';
  const clientSecret = process.env.CASDOOR_CLIENT_SECRET || casdoorConfig.clientSecret || '';
  const id = resolveIdentifier();
  const params = new URLSearchParams({
    clientId,
    clientSecret,
  });
  if (id.enforcerId) params.set('enforcerId', id.enforcerId);
  if (id.permissionId) params.set('permissionId', id.permissionId);
  const url = `${base}/api/${endpoint}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reqs),
  });
  let parsed: { status?: string; msg?: string; data?: unknown } = {};
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    /* non-JSON response — leave parsed empty */
  }
  return {
    status: parsed.status ?? `http-${res.status}`,
    msg: parsed.msg ?? '',
    data: parsed.data,
  };
}

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
 *
 * SDK signature is `(permissionId, modelId, resourceId, enforcerId, owner, request)`.
 * Casdoor consults whichever of permissionId/enforcerId is non-empty.
 */
export async function enforceOne(req: CasbinRequest): Promise<boolean> {
  const id = resolveIdentifier();
  try {
    return await casdoorSDK.enforce(id.permissionId, '', '', id.enforcerId, '', req);
  } catch (err) {
    await logCasdoorDiagnostic('enforce', req, err);
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
  const id = resolveIdentifier();
  try {
    const matrix = await casdoorSDK.batchEnforce(
      id.permissionId,
      '',
      '',
      id.enforcerId,
      '',
      reqs as CasbinRequest[],
    );
    return reduceMatrix(matrix, reqs.length);
  } catch (err) {
    await logCasdoorDiagnostic('batch-enforce', reqs, err);
    throw new EnforcerUnavailableError('Casdoor batchEnforce call failed', err);
  }
}

/**
 * On any SDK failure, do one extra raw fetch to capture Casdoor's actual
 * `{status, msg, data}` payload and dump a single high-signal log line so
 * misconfigurations are diagnosable from production logs.
 *
 * Safe by design: this only runs on the failure path, never on the hot
 * happy path. We never throw from here — the caller still throws the
 * original {@link EnforcerUnavailableError}.
 */
async function logCasdoorDiagnostic(
  endpoint: 'enforce' | 'batch-enforce',
  reqs: readonly CasbinRequest[] | CasbinRequest,
  originalErr: unknown,
): Promise<void> {
  const id = resolveIdentifier();
  const sample = Array.isArray(reqs) && Array.isArray(reqs[0]) ? reqs[0] : reqs;
  try {
    const probe = await rawCasdoorEnforce(endpoint, reqs);
    log.warn(
      `Casdoor ${endpoint} failed | ${id.label} | sample=${JSON.stringify(sample)} | ` +
        `casdoor.status=${probe.status} casdoor.msg=${JSON.stringify(probe.msg)} ` +
        `casdoor.dataType=${typeof probe.data}`,
      originalErr,
    );
  } catch (probeErr) {
    log.warn(
      `Casdoor ${endpoint} failed AND diagnostic probe failed | ${id.label} | ` +
        `sample=${JSON.stringify(sample)}`,
      { originalErr, probeErr },
    );
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
