/**
 * WP-07 T2 — the SecretStore and leak prevention (AC-051).
 *
 * The suite exercises the whole promise of AC-051 against the real store:
 *
 * - a value is returned only to a caller whose Grants admit the `secret`
 *   operation on that exact ref, for that role/stage/run/use-time, and only for
 *   the registration's own audience/purpose/role;
 * - a foreign purpose, role or sibling Run, a wrong operation/target and an
 *   expired Grant are refused with the documented code and resolve nothing;
 * - an unauthorized caller cannot even learn whether a ref exists, while an
 *   authorized caller gets `NOT_FOUND` for an unknown one;
 * - `list`/`has`/`JSON.stringify(store)` never carry a value;
 * - redaction masks nested objects, arrays and `Error` messages, and the scanner
 *   finds a decoy in a nested object, an array, an error message and a log line.
 */
import { describe, expect, it } from 'vitest';
import type { Grant, Purpose, Role } from '@agentdev/contracts';
import {
  ProtocolError,
  SECRET_ENV_PREFIX,
  SECRET_MASK,
  SECRET_OPERATION,
  SecretStore,
  containsSecret,
  gatewaySecretResolver,
  hasLeaks,
  redact,
  redactValue,
  scanForLeaks,
  secretEnvName,
  type SecretAccessContext,
  type SecretAudience,
} from '../src/index.js';

const PROJECT_ID = 'a'.repeat(32);
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e00';
const RUN_A = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const RUN_B = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e11';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30';
const GRANT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e40';

const AT = '2026-09-11T00:00:00.000Z';
const EXPIRES = '2026-09-11T01:00:00.000Z';

const DECOY_REF = 'decoy/provider';
const DECOY_VALUE = 'sk-decoy-7f3a9c1b-never-in-a-payload';
const OTHER_REF = 'project/deploy-token';
const OTHER_VALUE = 'deploy-token-42-plaintext';

/** The decoy's environment variable, asserted against the derived name. */
const DECOY_ENV = `${SECRET_ENV_PREFIX}DECOY_PROVIDER`;

interface GrantOptions {
  readonly role?: Role;
  readonly stage?: string;
  readonly operation?: string;
  readonly targets?: readonly string[];
  readonly runId?: string;
  readonly expiresAt?: string;
  readonly scope?: Grant['scope'];
  readonly consumedAt?: string;
}

/** A real `grant` row shape (`data.md` §2) without needing SQLite. */
function grantFor(options: GrantOptions = {}): Grant {
  return {
    id: GRANT_ID,
    projectId: PROJECT_ID,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    workId: WORK_ID,
    scope: options.scope ?? 'run',
    role: options.role ?? 'backend',
    stage: options.stage ?? 'develop-L2',
    operation: options.operation ?? SECRET_OPERATION,
    targets: [...(options.targets ?? [DECOY_REF])],
    expiresAt: options.expiresAt ?? EXPIRES,
    limits: {},
    decisionId: DECISION_ID,
    ...(options.runId === undefined ? { runId: RUN_A } : { runId: options.runId }),
    ...(options.consumedAt === undefined ? {} : { consumedAt: options.consumedAt }),
  };
}

interface ContextOptions {
  readonly audience?: SecretAudience;
  readonly purpose?: Purpose;
  readonly role?: Role;
  readonly stage?: string;
  readonly at?: string;
  readonly runId?: string;
  readonly grants?: readonly Grant[];
}

/** The authorization context a caller passes alongside its Grants. */
function contextFor(options: ContextOptions = {}): SecretAccessContext {
  return {
    audience: options.audience ?? 'tool',
    purpose: options.purpose ?? 'implementation',
    role: options.role ?? 'backend',
    workId: WORK_ID,
    stage: options.stage ?? 'develop-L2',
    at: options.at ?? AT,
    grants: options.grants ?? [grantFor()],
    ...(options.runId === undefined ? { runId: RUN_A } : { runId: options.runId }),
  };
}

function storeWithDecoy(): SecretStore {
  const store = new SecretStore();
  store.put({
    ref: DECOY_REF,
    value: DECOY_VALUE,
    audience: 'tool',
    purposes: ['implementation'],
  });
  return store;
}

/** Runs `put` and returns the ProtocolError it must throw. */
function putRefusal(store: SecretStore, registration: Parameters<SecretStore['put']>[0]) {
  try {
    store.put(registration);
  } catch (error) {
    if (error instanceof ProtocolError) return error;
    throw error;
  }
  throw new Error('expected put to refuse the registration');
}

describe('SecretStore resolution (AC-051)', () => {
  it('resolves a registered ref for the authorized Grantholder (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(DECOY_REF, contextFor());
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('unreachable');
    expect(resolution.ref).toBe(DECOY_REF);
    expect(resolution.value).toBe(DECOY_VALUE);
  });

  it('refuses an unknown ref with NOT_FOUND for an authorized ref shape (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(
      'ghost/credential',
      contextFor({ grants: [grantFor({ targets: ['ghost/'] })] }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_FOUND');
  });

  it('refuses an unauthorized caller without disclosing whether the ref exists (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve('ghost/credential', contextFor({ grants: [] }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a foreign role, operation or target with NOT_AUTHORIZED (AC-051)', () => {
    const store = storeWithDecoy();
    for (const grant of [
      grantFor({ role: 'review' }),
      grantFor({ operation: 'read' }),
      grantFor({ targets: ['other/ref'] }),
    ]) {
      const resolution = store.resolve(DECOY_REF, contextFor({ grants: [grant] }));
      expect(resolution.ok).toBe(false);
      if (resolution.ok) throw new Error('unreachable');
      expect(resolution.code).toBe('NOT_AUTHORIZED');
    }
  });

  it('refuses a sibling Run trying to reuse a run-scoped Grant (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(DECOY_REF, contextFor({ runId: RUN_B }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_AUTHORIZED');
    // The owner Run still resolves it.
    expect(store.resolve(DECOY_REF, contextFor({ runId: RUN_A })).ok).toBe(true);
  });

  it('refuses an expired Grant with AUTH_EXPIRED and resolves nothing (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(
      DECOY_REF,
      contextFor({
        at: '2026-09-11T02:00:00.000Z',
        grants: [grantFor({ expiresAt: '2026-09-11T01:00:00.000Z' })],
      }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('AUTH_EXPIRED');
  });

  it('refuses a foreign purpose at the registration boundary (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(DECOY_REF, contextFor({ purpose: 'review' }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses the wrong audience channel (AC-051)', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve(DECOY_REF, contextFor({ audience: 'gateway' }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a role the registration does not allow (AC-051)', () => {
    const store = new SecretStore({
      secrets: [
        {
          ref: DECOY_REF,
          value: DECOY_VALUE,
          audience: 'tool',
          roles: ['backend'],
        },
      ],
    });
    const resolution = store.resolve(
      DECOY_REF,
      contextFor({ role: 'frontend', grants: [grantFor({ role: 'frontend' })] }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a malformed ref with VALIDATION_ERROR', () => {
    const store = storeWithDecoy();
    const resolution = store.resolve('has space', contextFor());
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error('unreachable');
    expect(resolution.code).toBe('VALIDATION_ERROR');
  });

  it('binds the one-argument Gateway resolver to one authorized context (AC-051)', () => {
    const store = storeWithDecoy();
    const resolver = gatewaySecretResolver(store, contextFor());
    expect(resolver.resolve(DECOY_REF)).toBe(DECOY_VALUE);
    expect(resolver.resolve('ghost/credential')).toBeUndefined();

    // The same ref through a foreign Run is "not available", never a value.
    const foreign = gatewaySecretResolver(store, contextFor({ runId: RUN_B }));
    expect(foreign.resolve(DECOY_REF)).toBeUndefined();
  });
});

describe('query surface never carries a value (AC-051)', () => {
  it('lists refs and metadata without the value (AC-051)', () => {
    const store = storeWithDecoy();
    store.put({ ref: OTHER_REF, value: OTHER_VALUE, audience: 'tool' });
    expect(store.has(DECOY_REF)).toBe(true);
    expect(store.has('absent/ref')).toBe(false);
    expect(store.refs()).toEqual([DECOY_REF, OTHER_REF].sort());
    const metadata = store.list();
    expect(metadata).toHaveLength(2);
    expect(metadata[0]?.envName).toBe(DECOY_ENV);
    expect(metadata[0]?.audience).toBe('tool');
    expect(metadata[0]?.purposes).toEqual(['implementation']);

    // No enumeration of the store or its metadata can reveal a value.
    expect(JSON.stringify(store)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(store)).not.toContain(OTHER_VALUE);
    expect(JSON.stringify(metadata)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(metadata)).not.toContain(OTHER_VALUE);
  });

  it('derives the documented environment variable names', () => {
    expect(secretEnvName(DECOY_REF)).toBe(DECOY_ENV);
    expect(secretEnvName('Provider Main.v2')).toBe(`${SECRET_ENV_PREFIX}PROVIDER_MAIN_V2`);
  });

  it('offers audit helpers that mask and scan every known value (AC-051)', () => {
    const store = storeWithDecoy();
    store.put({ ref: OTHER_REF, value: OTHER_VALUE, audience: 'tool' });
    const line = `raw=${DECOY_VALUE} other=${OTHER_VALUE}`;
    expect(store.maskAll(line)).toBe(`raw=${SECRET_MASK} other=${SECRET_MASK}`);
    expect(store.maskAll(line)).not.toContain(DECOY_VALUE);

    // `secretIndex` indexes the sorted refs list, so the audit path can name the
    // credential without ever handling its value.
    expect(store.refs()).toEqual([DECOY_REF, OTHER_REF].sort());
    const findings = store.scanAll({ nested: { line } });
    expect(findings.map((finding) => finding.secretIndex)).toEqual([0, 1]);
    expect(findings.every((finding) => finding.path === '$.nested.line')).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(findings)).not.toContain(OTHER_VALUE);
    expect(store.scanAll({ clean: true })).toEqual([]);
  });

  it('replaces a registration on the same ref and validates the input', () => {
    const store = storeWithDecoy();
    store.put({ ref: DECOY_REF, value: 'rotated-value', audience: 'tool' });
    expect(store.list()).toHaveLength(1);
    const resolution = store.resolve(DECOY_REF, contextFor());
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('unreachable');
    expect(resolution.value).toBe('rotated-value');

    expect(putRefusal(store, { ref: '', value: 'x', audience: 'tool' }).code).toBe(
      'VALIDATION_ERROR',
    );
    expect(putRefusal(store, { ref: 'a b', value: 'x', audience: 'tool' }).code).toBe(
      'VALIDATION_ERROR',
    );
    expect(putRefusal(store, { ref: 'ok/ref', value: '', audience: 'tool' }).code).toBe(
      'VALIDATION_ERROR',
    );
    expect(putRefusal(store, { ref: 'ok/ref', value: 'a\0b', audience: 'tool' }).code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      putRefusal(store, { ref: 'ok/ref', value: 'x', audience: 'tool', envName: 'lower-case' })
        .code,
    ).toBe('VALIDATION_ERROR');
    // The refusals changed nothing.
    expect(store.list()).toHaveLength(1);
  });
});

describe('scoped environment injection (AC-051)', () => {
  it('injects only the secrets the Run is authorized for (AC-051)', () => {
    const store = storeWithDecoy();
    store.put({ ref: OTHER_REF, value: OTHER_VALUE, audience: 'tool' });
    const injection = store.environmentFor(contextFor(), [DECOY_REF]);
    expect(injection.ok).toBe(true);
    if (!injection.ok) throw new Error('unreachable');
    expect(injection.refs).toEqual([DECOY_REF]);
    expect(Object.keys(injection.env)).toEqual([DECOY_ENV]);
    expect(injection.env[DECOY_ENV]).toBe(DECOY_VALUE);
    // The unrelated secret is registered but was not requested, so it is absent.
    expect(Object.values(injection.env)).not.toContain(OTHER_VALUE);
  });

  it('refuses the whole environment when one requested ref is unauthorized (AC-051)', () => {
    const store = storeWithDecoy();
    store.put({ ref: OTHER_REF, value: OTHER_VALUE, audience: 'tool' });
    const injection = store.environmentFor(contextFor({ runId: RUN_B }), [OTHER_REF, DECOY_REF]);
    expect(injection.ok).toBe(false);
    if (injection.ok) throw new Error('unreachable');
    expect(injection.code).toBe('NOT_AUTHORIZED');
    // `fields` names the requested position, not the secret value.
    expect(injection.fields).toEqual(['refs[0]']);
    expect('env' in injection).toBe(false);
    // Nothing about the refusal carries the value.
    expect(JSON.stringify(injection)).not.toContain(DECOY_VALUE);
    expect(JSON.stringify(injection)).not.toContain(OTHER_VALUE);
  });

  it('refuses injection for an unknown ref with NOT_FOUND', () => {
    const store = storeWithDecoy();
    const injection = store.environmentFor(
      contextFor({ grants: [grantFor({ targets: ['ghost/'] })] }),
      ['ghost/credential'],
    );
    expect(injection.ok).toBe(false);
    if (injection.ok) throw new Error('unreachable');
    expect(injection.code).toBe('NOT_FOUND');
  });
});

describe('redaction (AC-051)', () => {
  it('masks every occurrence of a known value in text', () => {
    const line = `Authorization: Bearer ${DECOY_VALUE} (retry with ${DECOY_VALUE})`;
    const masked = redact(line, [DECOY_VALUE]);
    expect(masked).toBe(`Authorization: Bearer ${SECRET_MASK} (retry with ${SECRET_MASK})`);
    expect(masked).not.toContain(DECOY_VALUE);
    expect(containsSecret(masked, [DECOY_VALUE])).toBe(false);
    expect(containsSecret(line, [DECOY_VALUE])).toBe(true);
  });

  it('redacts nested structures and error messages without mutating them (AC-051)', () => {
    const error = new Error(`provider rejected the key ${DECOY_VALUE}`);
    const payload = {
      artifact: { kind: 'log', lines: [`tool stderr: ${DECOY_VALUE}`, 'ok'] },
      ui: { visible: { token: DECOY_VALUE } },
      error,
    };
    const safe = redactValue(payload, [DECOY_VALUE]);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(DECOY_VALUE);
    expect(serialized).toContain(SECRET_MASK);
    // The message survives, only the value is gone.
    expect(serialized).toContain('provider rejected the key');

    // The input is untouched: redaction is a copy, never an in-place edit.
    expect(payload.ui.visible.token).toBe(DECOY_VALUE);
    expect(error.message).toContain(DECOY_VALUE);
    expect(scanForLeaks(payload, [DECOY_VALUE]).length).toBeGreaterThanOrEqual(3);
    expect(scanForLeaks(safe, [DECOY_VALUE])).toEqual([]);
  });

  it('redacts Map, Set and Date contents defensively', () => {
    const safe = redactValue(
      new Map<string, unknown>([
        ['token', DECOY_VALUE],
        ['nested', new Set([DECOY_VALUE, 'clean'])],
        ['when', new Date('2026-09-11T00:00:00.000Z')],
      ]),
      [DECOY_VALUE],
    );
    expect(safe).toBeInstanceOf(Map);
    const map = safe as Map<string, unknown>;
    expect(map.get('token')).toBe(SECRET_MASK);
    expect([...(map.get('nested') as Set<unknown>)]).toEqual([SECRET_MASK, 'clean']);
    expect(map.get('when')).toBe('2026-09-11T00:00:00.000Z');
    expect(JSON.stringify([...map])).not.toContain(DECOY_VALUE);
  });

  it('replaces the longest known value first', () => {
    // With values that contain one another, no partial copy may survive.
    const masked = redact(`value=${DECOY_VALUE} short=${'sk-decoy'}`, [DECOY_VALUE, 'sk-decoy']);
    expect(masked).not.toContain(DECOY_VALUE);
    expect(masked).not.toContain('sk-decoy');
  });
});

describe('leak scanning (AC-051)', () => {
  it('finds the decoy in a nested object and an array (AC-051)', () => {
    const payload = { ok: true, artifact: { lines: ['clean', `token=${DECOY_VALUE}`] } };
    const findings = scanForLeaks(payload, [DECOY_VALUE]);
    expect(findings.map((finding) => finding.path)).toEqual(['$.artifact.lines[1]']);
    expect(findings[0]?.secretIndex).toBe(0);
    expect(findings[0]?.preview).toContain(SECRET_MASK);
    // The finding itself never carries the value.
    expect(JSON.stringify(findings)).not.toContain(DECOY_VALUE);
  });

  it('finds the decoy in an error message and stack (AC-051)', () => {
    const error = new Error(`git push failed with ${DECOY_VALUE}`);
    const paths = scanForLeaks(error, [DECOY_VALUE]).map((finding) => finding.path);
    expect(paths).toContain('$.message');
  });

  it('finds the decoy in a log line and an array item (AC-051)', () => {
    expect(scanForLeaks(`2026-09-11 INFO raw=${DECOY_VALUE}`, [DECOY_VALUE])).toHaveLength(1);
    expect(scanForLeaks([DECOY_VALUE], [DECOY_VALUE])[0]?.path).toBe('$[0]');
  });

  it('reports which known value matched and stays silent on clean input', () => {
    const findings = scanForLeaks({ first: DECOY_VALUE, second: OTHER_VALUE }, [
      DECOY_VALUE,
      OTHER_VALUE,
    ]);
    expect(findings.map((finding) => finding.secretIndex).sort()).toEqual([0, 1]);
    expect(scanForLeaks({ clean: ['nothing', 'here'] }, [DECOY_VALUE, OTHER_VALUE])).toEqual([]);
    expect(hasLeaks('clean', [DECOY_VALUE])).toBe(false);
    expect(hasLeaks(`dirty ${DECOY_VALUE}`, [DECOY_VALUE])).toBe(true);
    // An empty known-value list can never match.
    expect(scanForLeaks(`dirty ${DECOY_VALUE}`, [])).toEqual([]);
  });

  it('finds a decoy used as an object key without echoing it in the path', () => {
    const findings = scanForLeaks({ [DECOY_VALUE]: 'value' }, [DECOY_VALUE]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe('$.*');
    expect(JSON.stringify(findings)).not.toContain(DECOY_VALUE);
  });
});
