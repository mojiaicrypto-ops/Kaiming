/**
 * Gateway credential scoping (WP-12 fix round 2, security review G1).
 *
 * The Gateway holds the Provider credential for a Run, but admission (`availability`) must
 * not need a `secret` Grant that no production path ever mints, and a real call may resolve
 * exactly one ref: the Run's own frozen `provider.secretRef`. These tests drive the real
 * `SecretStore` through the real adapter — no stub resolver.
 */
import { describe, expect, it } from 'vitest';
import { SecretStore, gatewaySecretResolver, type SecretAccessContext } from '../src/index.js';

const REF_A = 'provider:a';
const REF_B = 'provider:b';
const VALUE_A = 'sk-a-value';
const VALUE_B = 'sk-b-value';

function store(): SecretStore {
  const secrets = new SecretStore();
  secrets.put({ ref: REF_A, value: VALUE_A, audience: 'gateway' });
  secrets.put({ ref: REF_B, value: VALUE_B, audience: 'gateway' });
  return secrets;
}

function context(overrides: Partial<SecretAccessContext> = {}): SecretAccessContext {
  return {
    audience: 'gateway',
    purpose: 'implementation',
    role: 'chief',
    workId: 'work-1',
    stage: 'Develop',
    at: new Date().toISOString(),
    grants: [],
    ...overrides,
  };
}

describe('gateway credential scoping', () => {
  it('registers the ref without reading it, so admission needs no Grant', () => {
    const resolver = gatewaySecretResolver(store(), context());
    expect(resolver.has?.(REF_A)).toBe(true);
    expect(resolver.has?.('provider:missing')).toBe(false);
    // Reading a value with no Grant and no per-call allowance is still refused.
    expect(resolver.resolve(REF_A)).toBeUndefined();
  });

  it('resolves exactly the ref the call is made for', () => {
    const resolver = gatewaySecretResolver(store(), context());
    expect(resolver.resolve(REF_A, { allowRef: REF_A })).toBe(VALUE_A);
    // A Run frozen to A can never read B, whatever it asks for.
    expect(resolver.resolve(REF_B, { allowRef: REF_A })).toBeUndefined();
    expect(resolver.resolve(REF_B, { allowRef: REF_B })).toBe(VALUE_B);
    // An unregistered ref stays `NOT_FOUND`, not a value.
    expect(resolver.resolve('provider:missing', { allowRef: 'provider:missing' })).toBeUndefined();
  });

  it('never widens the tool audience, which still needs a real Grant', () => {
    const secrets = store();
    const toolContext = context({ audience: 'tool', allowedRefs: [REF_A] });
    const verdict = secrets.resolve(REF_A, toolContext);
    // The gateway allowance did not apply at all: the refusal is the Grant check's.
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('no Grant authorizes');
  });
});
