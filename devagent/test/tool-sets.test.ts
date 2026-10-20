import { describe, expect, it } from 'vitest';
import { ROLE_IDS } from '../src/runtime/prompt-assembly.ts';
import { DOMAIN_TOOL_NAMES, isProjectReadOnly, toolSetFor, toolSetMatrix } from '../src/runtime/tool-sets.ts';

describe('role tool sets', () => {
  it('gives every write-capable role the reading tools it needs to analyse code first', () => {
    for (const roleId of ['designer', 'developer', 'settler'] as const) {
      const set = toolSetFor(roleId, 'write');
      expect(set.readTools).toEqual(['read', 'grep', 'find', 'ls']);
      expect(set.allowlist).toContain('write');
      expect(set.allowlist).toContain('edit');
      expect(set.projectReadOnly).toBe(false);
    }
  });

  it('lets a write Task keep shell for the roles the contract documents, and only those', () => {
    expect(toolSetFor('chief', 'write').allowlist).toContain('bash');
    expect(toolSetFor('developer', 'write').allowlist).toContain('bash');
    expect(toolSetFor('tester', 'write').allowlist).toContain('bash');
    expect(toolSetFor('settler', 'write').allowlist).toContain('bash');
    expect(toolSetFor('designer', 'write').allowlist).not.toContain('bash');
    expect(toolSetFor('reviewer', 'write').allowlist).not.toContain('bash');
  });

  it('opens no project-writing tool and no shell in a read Task', () => {
    for (const roleId of ROLE_IDS) {
      const set = toolSetFor(roleId, 'read');
      expect(set.allowlist).not.toContain('write');
      expect(set.allowlist).not.toContain('edit');
      expect(set.allowlist).not.toContain('bash');
      expect(set.allowlist).not.toContain('requirement');
      expect(set.allowlist).not.toContain('project');
      expect(set.projectReadOnly).toBe(true);
    }
  });

  it('keeps the role\u2019s own set while a session has no Task yet', () => {
    const chief = toolSetFor('chief', undefined);
    expect(chief.allowlist).toContain('requirement');
    expect(chief.allowlist).toContain('project');
    expect(chief.projectReadOnly).toBe(false); // it can save requirements
    expect(toolSetFor('reviewer', undefined).projectReadOnly).toBe(true);
    expect(toolSetFor('developer', undefined).allowlist).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'bash']),
    );
  });

  it('keeps read-only roles read-only even inside a write Task', () => {
    for (const roleId of ['chief', 'reviewer', 'tester', 'investigator'] as const) {
      const set = toolSetFor(roleId, 'write');
      expect(set.allowlist).not.toContain('write');
      expect(set.allowlist).not.toContain('edit');
    }
    // tester may run the test entry point, but it never edits the delivered sources.
    expect(toolSetFor('tester', 'write').allowlist).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'agent_report',
      'task',
      'question',
    ]);
    expect(toolSetFor('reviewer', 'write').readTools).toEqual(['read', 'grep', 'find', 'ls']);
  });

  it('keeps the report tool available in a read Task because it writes a Server-side report', () => {
    expect(toolSetFor('investigator', 'read').allowlist).toContain('agent_report');
    expect(toolSetFor('chief', 'read').allowlist).not.toContain('agent_report');
  });

  it('gives every role the one task tool and the chief alone the project task surface', () => {
    const chief = toolSetFor('chief', 'write').allowlist;
    expect(chief).toEqual(expect.arrayContaining(['task', 'requirement', 'project']));
    for (const roleId of ROLE_IDS) {
      // Every member reads its own Task through the same tool; only the chief may act on it.
      expect(toolSetFor(roleId, 'write').allowlist).toContain('task');
    }
    for (const roleId of ROLE_IDS.filter((id) => id !== 'chief')) {
      expect(toolSetFor(roleId, 'write').allowlist).not.toContain('project');
    }
  });

  it('denies every name the role does not hold, so a host union cannot widen it', () => {
    const designerRead = toolSetFor('designer', 'read');
    expect(designerRead.denied).toEqual(
      expect.arrayContaining(['write', 'edit', 'bash', 'requirement', 'project']),
    );
    // The reading tools and the report tool it does hold are not denied.
    expect(designerRead.denied).not.toContain('read');
    expect(designerRead.denied).not.toContain('agent_report');

    const designerWrite = toolSetFor('designer', 'write');
    expect(designerWrite.denied).not.toContain('write');
    expect(designerWrite.denied).not.toContain('requirement');
    expect(designerWrite.denied).toEqual(expect.arrayContaining(['project', 'bash']));

    // A reviewer must never be handed the chief's task tools, even through a host union.
    const reviewerWrite = toolSetFor('reviewer', 'write');
    expect(reviewerWrite.denied).toEqual(
      expect.arrayContaining(['write', 'edit', 'bash', 'requirement', 'project']),
    );
    expect(reviewerWrite.denied).not.toContain('agent_report');

    // The chief holds requirement/project and shell, but not the report tool or project writes.
    const chief = toolSetFor('chief', undefined);
    expect(chief.denied).not.toContain('requirement');
    expect(chief.denied).not.toContain('bash');
    expect(chief.denied).toEqual(expect.arrayContaining(['agent_report', 'write', 'edit']));
  });

  it('exposes a read-only answer for callers that only need the boolean', () => {
    expect(isProjectReadOnly('reviewer', 'write')).toBe(true);
    expect(isProjectReadOnly('developer', 'write')).toBe(false);
  });
});
describe('chief task tools · recovery path', () => {
  it('the chief allowlist carries every host-registered domain tool (recovery included)', () => {
    // Every registered domain tool must be callable by at least one role; a registered-but-
    // unlisted tool would otherwise reach every role through the host union (or none at all).
    for (const name of DOMAIN_TOOL_NAMES) {
      const inSomeRole = toolSetMatrix().some((entry) => entry.allowlist.includes(name));
      expect(inSomeRole, `${name} is registered but no role may call it`).toBe(true);
    }
    expect(toolSetFor('chief', 'write').allowlist).toContain('task');
  });
});
