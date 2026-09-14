/**
 * `environmentRef` — the environment an Attempt reports in `attempt.ready`.
 *
 * `protocol.md:123` makes `runner.ready` carry an `environmentRef`, and a delivery freezes
 * it into its `VerificationManifest`. The value has to be a real observation of the process:
 * a host descriptor built from `process`, or the image the launcher really started this
 * container from. These cases pin both shapes and the honest fallback, so no caller can turn
 * it into a placeholder (or a random value) without failing here.
 */
import { describe, expect, it } from 'vitest';
import {
  EXEC_IMAGE_ENV,
  containerImageRef,
  environmentRef,
  inContainer,
  nodeMajor,
} from '../src/environment.js';

describe('environmentRef', () => {
  it('names the real host, architecture and Node major', () => {
    const ref = environmentRef({
      env: {},
      container: false,
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: '24.4.1',
    });
    expect(ref).toBe('host:darwin/arm64/node-24');
    // The same host reports the same value: nothing random may enter a manifest.
    expect(
      environmentRef({
        env: {},
        container: false,
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: '24.9.0',
      }),
    ).toBe(ref);
  });

  it('names the image the launcher really started this container from', () => {
    expect(
      environmentRef({
        env: { [EXEC_IMAGE_ENV]: 'agentdev/exec:0.0.0' },
        container: true,
      }),
    ).toBe('container:agentdev/exec:0.0.0');
    expect(containerImageRef({ [EXEC_IMAGE_ENV]: 'agentdev/exec@sha256:abc' }, true)).toBe(
      'agentdev/exec@sha256:abc',
    );
  });

  it('reports an undeclared container image instead of inventing one', () => {
    expect(containerImageRef({}, true)).toBe('undeclared');
    expect(environmentRef({ env: {}, container: true })).toBe('container:undeclared');
    // The launcher variable alone is not a container: a host process that inherits it must
    // not claim to run inside an image.
    expect(environmentRef({ env: { [EXEC_IMAGE_ENV]: 'x' }, container: false })).toMatch(/^host:/);
  });

  it('detects containers only through real runtime markers', () => {
    expect(inContainer(['/definitely/not/here'])).toBe(false);
    expect(inContainer([])).toBe(false);
    expect(nodeMajor('22.11.0')).toBe('22');
  });
});
