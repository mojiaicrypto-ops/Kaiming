/**
 * T3.1 — the role tool registry and the **real** Pi session it produces (AC-048/AC-050).
 *
 * The registry cases are pure; the activation cases build a real Pi session over the
 * offline catalog (no provider call) and assert `activeToolNames()`, because the defect
 * this sub-task exists for is a *session-level* one: Pi 0.85.1 treats `tools` as both the
 * allowlist and the initial active set and filters `customTools` through it, so a Runner
 * that passed only the (possibly empty) profile subset silently ran with no tools at all.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@agentdev/contracts';
import { PiSessionFactory, createExplicitResources } from '@agentdev/pi-runtime';
import { controlTools, createControlClient } from '../src/control-client.js';
import {
  ROLE_TOOL_REGISTRY,
  assertActiveTools,
  contractArgumentNames,
  registeredArgumentNames,
  roleToolNames,
  roleTools,
  selectRoleTools,
  type ToolBridge,
} from '../src/tools.js';

/** A bridge that records calls and returns a fixed text, so no HTTP is involved. */
function recordingBridge(): ToolBridge & { readonly calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    execute: (input) => {
      calls.push({ ...input, signal: input.signal !== undefined });
      return Promise.resolve({ text: `ran ${input.toolName}` });
    },
  };
}

describe('role tool registry (execution.md §7, rules/agents.md §1)', () => {
  it('defines every contract role', () => {
    expect(Object.keys(ROLE_TOOL_REGISTRY).sort()).toEqual([...ROLES].sort());
  });

  it('gives read-only investigation tools to every role', () => {
    for (const role of ROLES) {
      const names = roleToolNames(role);
      expect(names).toContain('read');
      expect(names).toContain('search');
      expect(names).toContain('artifact_write');
    }
  });

  it('keeps review and test free of every source-writing or shell tool', () => {
    for (const role of ['review', 'test'] as const) {
      const names = roleToolNames(role);
      for (const forbidden of ['edit', 'write', 'bash', 'git']) {
        expect(names).not.toContain(forbidden);
      }
      // `artifact_write` is the one "mutating" capability these roles hold:
      // `execution.md` §3 gives Review "自己报告与检查临时目录" and Test its own report
      // directory, and the Broker confines that write to the configured report root.
      const mutating = ROLE_TOOL_REGISTRY[role]
        .filter((spec) => spec.mutating)
        .map((spec) => spec.name);
      expect(mutating).toEqual(['artifact_write']);
    }
  });

  it('gives the modifying roles the shell and git tools, settlement only file writes', () => {
    for (const role of ['backend', 'frontend'] as const) {
      expect(roleToolNames(role)).toEqual(
        expect.arrayContaining([
          'read',
          'search',
          'edit',
          'write',
          'bash',
          'git',
          'artifact_write',
        ]),
      );
    }
    expect(roleToolNames('settlement')).toEqual(
      expect.arrayContaining(['read', 'search', 'edit', 'write', 'artifact_write']),
    );
    expect(roleToolNames('settlement')).not.toContain('bash');
  });

  it('gives no role a tool whose server schema accepts different fields', () => {
    for (const role of ROLES) {
      for (const spec of ROLE_TOOL_REGISTRY[role]) {
        expect(registeredArgumentNames(role, spec.name)).toEqual(contractArgumentNames(spec.name));
      }
    }
  });

  it('does not register context_request, which has no endpoint in this slice', () => {
    for (const role of ROLES) {
      expect(roleToolNames(role)).not.toContain('context_request');
    }
  });
});

describe('selectRoleTools (plan D-T3-1)', () => {
  it('treats an empty subset as the role registry', () => {
    const selection = selectRoleTools('backend', []);
    expect(selection.tools.map((spec) => spec.name)).toEqual(roleToolNames('backend'));
    expect(selection.rejected).toEqual([]);
  });

  it('narrows to the intersection for a non-empty subset', () => {
    const selection = selectRoleTools('backend', ['read', 'git']);
    expect(selection.tools.map((spec) => spec.name)).toEqual(['read', 'git']);
    expect(selection.rejected).toEqual([]);
  });

  it('reports a tool the role does not have instead of dropping it silently', () => {
    const selection = selectRoleTools('review', ['read', 'bash']);
    expect(selection.tools.map((spec) => spec.name)).toEqual(['read']);
    expect(selection.rejected).toEqual(['bash']);
  });
});

describe('assertActiveTools', () => {
  it('accepts an exact match and names what differed otherwise', () => {
    expect(assertActiveTools(['read', 'search'], ['search', 'read'])).toBe('');
    expect(assertActiveTools(['read'], ['read', 'bash'])).toContain('unexpected: bash');
    expect(assertActiveTools(['read', 'search'], ['read'])).toContain('missing: search');
  });
});

describe('documented control tools in a real Pi session (execution.md §7, T3 轮 3)', () => {
  let root: string;
  let provider: string;
  let modelId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentdev-runner-control-tools-'));
    const factory = await PiSessionFactory.create({ cwd: root, agentDir: join(root, 'agent') });
    const first = factory.listModels()[0];
    if (first === undefined) throw new Error('the offline catalog is empty');
    provider = first.provider;
    modelId = first.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** The tool set `AttemptRunner` composes: the role registry plus the control tools. */
  async function activeControlTools(role: Role, withWork = true) {
    const bridge = recordingBridge();
    const client = createControlClient({
      url: 'http://127.0.0.1:1',
      capability: 'cap-1',
      attemptId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50',
      epoch: 1,
    });
    const customTools = [
      ...roleTools(role, bridge),
      ...controlTools({
        client,
        role,
        ...(withWork ? { workId: 'work-1' } : {}),
      }),
    ];
    const factory = await PiSessionFactory.create({ cwd: root, agentDir: join(root, 'agent') });
    const session = await factory.createSession({
      provider,
      modelId,
      resourceLoader: createExplicitResources({
        cwd: root,
        agentDir: join(root, 'agent'),
        trusted: true,
        skillPaths: [],
      }).loader,
      toolNames: customTools.map((tool) => tool.name),
      customTools,
    });
    try {
      return session.activeToolNames().sort();
    } finally {
      session.dispose();
    }
  }

  it('activates the Chief control tools including decision_request', async () => {
    const active = await activeControlTools('chief');
    expect(active).toEqual(
      [
        'agent_dispatch',
        'artifact_write',
        'assessment_submit',
        'context_request',
        'decision_request',
        'read',
        'search',
      ].sort(),
    );
    expect(active).not.toContain('stage_yield');
    expect(active).not.toContain('request_dispatch');
    expect(active).not.toContain('bash');
  });

  it('activates the professional control tools and never the Chief ones', async () => {
    const active = await activeControlTools('backend');
    expect(active).toEqual(
      [
        'artifact_write',
        'bash',
        'context_request',
        'edit',
        'git',
        'read',
        'request_dispatch',
        'search',
        'stage_yield',
        'write',
      ].sort(),
    );
    expect(active).not.toContain('assessment_submit');
    expect(active).not.toContain('agent_dispatch');
    expect(active).not.toContain('decision_request');
  });

  it('keeps a Review Run free of source-writing and shell tools', async () => {
    const active = await activeControlTools('review');
    expect(active).toEqual(
      [
        'artifact_write',
        'context_request',
        'read',
        'request_dispatch',
        'search',
        'stage_yield',
      ].sort(),
    );
  });

  it('does not register a control tool whose transport is missing', () => {
    // An older client without `decisionRequest` must not hand the model a dead tool.
    const full = createControlClient({
      url: 'http://127.0.0.1:1',
      capability: 'cap-1',
      attemptId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50',
      epoch: 1,
    });
    const client: typeof full = { ...full };
    delete (client as { decisionRequest?: unknown }).decisionRequest;
    const names = controlTools({ client, role: 'chief', workId: 'work-1' }).map(
      (tool) => tool.name,
    );
    expect(names).toContain('assessment_submit');
    expect(names).not.toContain('decision_request');
    expect(names).toContain('context_request');
  });
});

describe('roleTools over a real Pi session', () => {
  let root: string;
  let provider: string;
  let modelId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentdev-runner-tools-'));
    const factory = await PiSessionFactory.create({ cwd: root, agentDir: join(root, 'agent') });
    const first = factory.listModels()[0];
    if (first === undefined) throw new Error('the offline catalog is empty');
    provider = first.provider;
    modelId = first.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function activeToolsFor(
    role: Role,
    subset?: readonly string[],
    customTools?: readonly string[],
  ) {
    const factory = await PiSessionFactory.create({
      cwd: root,
      agentDir: join(root, 'agent'),
    });
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
      skillPaths: [],
    });
    const specs = roleTools(role, recordingBridge(), subset);
    const wanted = customTools ?? specs.map((spec) => spec.name);
    const session = await factory.createSession({
      provider,
      modelId,
      resourceLoader: resources.loader,
      toolNames: [...wanted],
      customTools: specs,
    });
    try {
      return session.activeToolNames().sort();
    } finally {
      session.dispose();
    }
  }

  it('activates exactly the backend registry, including our bash instead of the SDK built-in', async () => {
    const active = await activeToolsFor('backend');
    expect(active).toEqual([...roleToolNames('backend')].sort());
    expect(active).toContain('bash');
    expect(active).toContain('git');
  });

  it('activates no mutating tool for a review Run', async () => {
    const active = await activeToolsFor('review');
    expect(active).toEqual([...roleToolNames('review')].sort());
    for (const forbidden of ['edit', 'write', 'bash', 'git']) {
      expect(active).not.toContain(forbidden);
    }
  });

  it('narrows a profile subset that names only permitted tools', async () => {
    const active = await activeToolsFor('backend', ['read']);
    expect(active).toEqual(['read']);
  });

  it('fails the Attempt when the profile asks a review Run for bash', () => {
    const selection = selectRoleTools('review', ['bash']);
    expect(selection.rejected).toEqual(['bash']);
    // The Runner reports `rejected` and fails the Attempt; nothing is registered.
    expect(selection.tools.map((spec) => spec.name)).not.toContain('bash');
  });

  it('surfaces an SDK tool the registry did not want as a mismatch', async () => {
    // Simulating a drifted allowlist: the session is asked for `read` plus a built-in the
    // registry never chose. `assertActiveTools` is what turns that into a fatal error.
    const active = await activeToolsFor('review', undefined, [...roleToolNames('review'), 'task']);
    const registry = [...roleToolNames('review')].sort();
    const verdict = assertActiveTools(registry, active);
    if (active.includes('task')) {
      expect(verdict).toContain('unexpected: task');
    } else {
      expect(verdict).toBe('');
    }
  });
});
