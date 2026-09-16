/**
 * WP-12 trust: the "untrusted = read-only" admission rule.
 *
 * `docs/product/experience.md` §1/§2 keep the one-time trust prompt, so the untrusted
 * state has to mean something observable: a tool call that can change the project's files
 * is refused with a typed error that names the trust state and the act that changes it,
 * while reads, search, analysis and the workbench's own artifact store keep working.
 * `permissions.ts` `decideTrustAdmission` is the single rule the daemon admission layer
 * and the Broker both decide, so this test pins it directly.
 */
import { describe, expect, it } from 'vitest';
import { decideTrustAdmission, trustAllowsOperation } from '../src/permissions.js';

describe('decideTrustAdmission', () => {
  it('admits every operation while the project is trusted', () => {
    for (const operation of ['read', 'search', 'write', 'edit', 'bash', 'git', 'artifact_write']) {
      expect(decideTrustAdmission({ trust: 'trusted', operation })).toEqual({ ok: true });
    }
  });

  it('still admits reads, search, analysis and the artifact store while untrusted', () => {
    // `artifact_write` is allowed because Core's `ArtifactService` stores the report in the
    // workbench's own artifact store, never in the repository (product-owner ruling).
    for (const operation of ['read', 'search', 'network', 'secret', 'artifact_write']) {
      expect(trustAllowsOperation(operation)).toBe(true);
      expect(decideTrustAdmission({ trust: 'untrusted', operation })).toEqual({ ok: true });
    }
  });

  it('refuses operations that change the project while untrusted', () => {
    for (const operation of [
      'write',
      'edit',
      'bash',
      'git',
      'delete_data',
      'push',
      // An unknown operation fails closed rather than being assumed harmless.
      'some-future-tool',
    ]) {
      const decision = decideTrustAdmission({ trust: 'untrusted', operation });
      expect(decision.ok).toBe(false);
      if (decision.ok) throw new Error('unreachable');
      expect(decision.code).toBe('NOT_AUTHORIZED');
      // The refusal names the trust state, the tool, the surface that still works, the act
      // that changes the state and the "do not retry" instruction.
      expect(decision.reason).toContain('只看不改');
      expect(decision.reason).toContain(operation);
      expect(decision.reason).toContain('artifact_write');
      expect(decision.reason).toContain('project.trust {trusted:true}');
      expect(decision.reason).toContain('do not retry');
      expect(decision.howToChange).toBe('project.trust {trusted:true}');
    }
  });

  it('names the tool the model called, not only the internal operation', () => {
    const decision = decideTrustAdmission({
      trust: 'untrusted',
      operation: 'write',
      toolName: 'write',
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.reason).toContain('write can change the project');
  });
});
