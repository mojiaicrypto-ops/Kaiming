import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_EXTENSIONS,
  CRITICAL_CAPABILITIES,
  EXTENSION_API_VERSION,
  PiRuntimeError,
  activateExtensions,
  type BuiltinExtensionSpec,
} from '../src/index.js';

const criticalSpec: BuiltinExtensionSpec = {
  id: 'core-policy',
  version: '1.0.0',
  apiVersion: EXTENSION_API_VERSION,
  capabilities: ['policy'],
  critical: true,
  enabledByDefault: true,
};

const optionalSpec: BuiltinExtensionSpec = {
  id: 'extra-report',
  version: '1.0.0',
  apiVersion: EXTENSION_API_VERSION,
  capabilities: ['report'],
  critical: false,
  enabledByDefault: true,
};

describe('built-in extension whitelist', () => {
  it('ships an empty optional list for this release', () => {
    expect(BUILTIN_EXTENSIONS).toHaveLength(0);
  });

  it('has exactly the five core critical capabilities', () => {
    expect([...CRITICAL_CAPABILITIES]).toEqual([
      'policy',
      'context',
      'artifact',
      'events',
      'dispatch',
    ]);
  });
});

describe('extension activation', () => {
  it('rejects an id the release does not ship', async () => {
    await expect(
      activateExtensions({
        manifest: [optionalSpec],
        requested: [{ id: 'third-party-thing', enabled: true }],
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_EXTENSION' });
  });

  it('blocks startup when a critical capability fails', async () => {
    const result = await activateExtensions({
      manifest: [criticalSpec],
      activate: () => {
        throw new Error('policy backend unavailable');
      },
    });
    expect(result.startupBlocked).toBe(true);
    expect(result.active).toEqual([]);
    expect(result.disabled[0]).toMatchObject({
      id: 'core-policy',
      reason: 'policy backend unavailable',
    });
  });

  it('disables only the failing optional extension', async () => {
    const failing = { ...optionalSpec, id: 'extra-fails' };
    const result = await activateExtensions({
      manifest: [optionalSpec, failing],
      activate: (spec) => {
        if (spec.id === 'extra-fails') throw new Error('boom');
      },
    });
    expect(result.startupBlocked).toBe(false);
    expect(result.active).toEqual(['extra-report']);
    expect(result.disabled).toHaveLength(1);
    expect(result.disabled[0]?.id).toBe('extra-fails');
  });

  it('treats an unsupported apiVersion as that entry failing', async () => {
    const result = await activateExtensions({
      manifest: [{ ...optionalSpec, apiVersion: 99 }],
    });
    expect(result.active).toEqual([]);
    expect(result.disabled[0]?.reason).toContain('apiVersion');
    expect(result.startupBlocked).toBe(false);
  });

  it('reports critical capabilities no provider supplies', async () => {
    const result = await activateExtensions({ manifest: [] });
    expect(result.missingCapabilities).toEqual([...CRITICAL_CAPABILITIES]);
  });

  it('clears a critical capability once it is provided', async () => {
    const result = await activateExtensions({
      manifest: [criticalSpec],
      providedCapabilities: ['context', 'artifact', 'events', 'dispatch'],
    });
    expect(result.missingCapabilities).toEqual([]);
    expect(result.startupBlocked).toBe(false);
  });

  it('activates a critical extension that succeeds and calls activate once', async () => {
    const activate = vi.fn();
    const result = await activateExtensions({ manifest: [criticalSpec], activate });
    expect(result.active).toEqual(['core-policy']);
    expect(result.startupBlocked).toBe(false);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('reports entries disabled by configuration', async () => {
    const result = await activateExtensions({
      manifest: [optionalSpec],
      requested: [{ id: 'extra-report', enabled: false }],
    });
    expect(result.active).toEqual([]);
    expect(result.disabled[0]).toMatchObject({ id: 'extra-report', reason: 'disabled' });
  });

  it('uses a typed error', async () => {
    await expect(
      activateExtensions({ manifest: [], requested: [{ id: 'nope', enabled: true }] }),
    ).rejects.toBeInstanceOf(PiRuntimeError);
  });
});
