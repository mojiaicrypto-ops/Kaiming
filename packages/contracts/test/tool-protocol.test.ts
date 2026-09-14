import { describe, expect, it } from 'vitest';
import {
  BROKER_TOOLS,
  ROLES,
  ROLE_BROKER_TOOLS,
  roleHasBrokerTool,
  GIT_READ_ONLY_SUBCOMMANDS,
  TOOL_RESULT_INLINE_BYTES,
  brokerOperationOf,
  canonicalJson,
  isBrokerToolName,
  isReadOnlyGitInvocation,
  toolArgumentNames,
  toolArgsSchemas,
  toolExecuteRequestSchema,
  toolExecuteResultSchema,
} from '../src/index.js';

describe('canonicalJson', () => {
  it('sorts object keys and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it('drops undefined members so an omitted optional hashes identically', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1, b: undefined }));
  });

  it('serialises scalars and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
  });

  it('is stable across key insertion order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
    );
  });
});

describe('broker tool vocabulary', () => {
  it('maps every documented tool onto its own operation name', () => {
    expect(Object.keys(BROKER_TOOLS).sort()).toEqual([
      'artifact_write',
      'bash',
      'edit',
      'git',
      'read',
      'search',
      'write',
    ]);
    for (const name of Object.keys(BROKER_TOOLS)) {
      expect(brokerOperationOf(name as keyof typeof BROKER_TOOLS)).toBe(name);
    }
  });

  it('recognises only registered tool names', () => {
    expect(isBrokerToolName('bash')).toBe(true);
    expect(isBrokerToolName('stage_yield')).toBe(false);
    expect(isBrokerToolName('__proto__')).toBe(false);
  });
});

describe('role broker tool sets', () => {
  it('covers every role and only registers contract tools', () => {
    expect(Object.keys(ROLE_BROKER_TOOLS).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) {
      for (const name of ROLE_BROKER_TOOLS[role]) {
        expect(isBrokerToolName(name)).toBe(true);
      }
    }
  });

  it('keeps review and test off every source-writing and shell tool', () => {
    for (const role of ['review', 'test'] as const) {
      for (const forbidden of ['edit', 'write', 'bash', 'git']) {
        expect(roleHasBrokerTool(role, forbidden)).toBe(false);
      }
      for (const allowed of ['read', 'search', 'artifact_write']) {
        expect(roleHasBrokerTool(role, allowed)).toBe(true);
      }
    }
  });

  it('gives the modifying roles the shell and inspection tools', () => {
    for (const role of ['backend', 'frontend'] as const) {
      for (const allowed of ['edit', 'write', 'bash', 'git']) {
        expect(roleHasBrokerTool(role, allowed)).toBe(true);
      }
    }
    expect(roleHasBrokerTool('settlement', 'write')).toBe(true);
    expect(roleHasBrokerTool('settlement', 'bash')).toBe(false);
  });
});

describe('git subcommand gate', () => {
  it('admits only the read-only allowlist', () => {
    for (const subcommand of GIT_READ_ONLY_SUBCOMMANDS) {
      expect(isReadOnlyGitInvocation([subcommand])).toBe(true);
    }
    expect(isReadOnlyGitInvocation(['status', '--short'])).toBe(true);
    expect(isReadOnlyGitInvocation(['-C', '/repo', '--no-pager', 'log', '-1'])).toBe(true);
  });

  it('refuses every ref-mutating subcommand and anything unlisted', () => {
    for (const subcommand of ['commit', 'push', 'update-ref', 'reset', 'checkout', 'fetch']) {
      expect(isReadOnlyGitInvocation([subcommand])).toBe(false);
    }
    expect(isReadOnlyGitInvocation(['rm', '-rf', '.'])).toBe(false);
    expect(isReadOnlyGitInvocation(['--version'])).toBe(false);
  });
});

describe('tool.execute wire schemas', () => {
  it('accepts the documented request and rejects unknown members', () => {
    const request = toolExecuteRequestSchema.parse({
      attemptId: 'a',
      epoch: 3,
      toolName: 'read',
      args: { path: 'src/theme.ts' },
      expectedInputHash: 'a'.repeat(64),
      timeoutMs: 1_000,
    });
    expect(request.toolName).toBe('read');
    expect(
      toolExecuteRequestSchema.safeParse({
        attemptId: 'a',
        epoch: 3,
        toolName: 'read',
        args: {},
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      toolExecuteRequestSchema.safeParse({
        attemptId: 'a',
        epoch: 3,
        toolName: 'read',
        args: {},
        expectedInputHash: 'A'.repeat(64),
      }).success,
    ).toBe(false);
  });

  it('documents both result shapes', () => {
    const inline = toolExecuteResultSchema.parse({
      v: 1,
      status: 'executed',
      mode: 'host',
      operation: 'read',
      toolName: 'read',
      toolOperationId: 'op',
      inputHash: 'b'.repeat(64),
      grantId: 'g',
      result: 'contents',
      resultRef: null,
      truncated: false,
      durationMs: 2,
    });
    expect(inline.resultRef).toBeNull();
    const deferred = { ...inline, resultRef: 'ref', truncated: true, status: 'replayed' as const };
    expect(toolExecuteResultSchema.parse(deferred).truncated).toBe(true);
    expect(TOOL_RESULT_INLINE_BYTES).toBe(64 * 1024);
  });
});

describe('tool argument shapes', () => {
  it('validates each tool and refuses an out-of-root path', () => {
    expect(toolArgsSchemas.read.parse({ path: 'src/a.ts' }).path).toBe('src/a.ts');
    expect(toolArgsSchemas.read.safeParse({ path: '/etc/passwd' }).success).toBe(false);
    expect(toolArgsSchemas.read.safeParse({ path: 'src/../etc' }).success).toBe(false);
    expect(toolArgsSchemas.read.safeParse({ path: 'src/a.ts', extra: 1 }).success).toBe(false);
    expect(toolArgsSchemas.bash.parse({ command: 'git status' }).command).toBe('git status');
    expect(toolArgsSchemas.git.safeParse({ args: [] }).success).toBe(false);
    expect(toolArgsSchemas.write.safeParse({ path: 'src/a.ts' }).success).toBe(false);
  });

  it('exposes names for the runner/server schema cross-check', () => {
    expect(toolArgumentNames('read')).toEqual(['limit', 'offset', 'path']);
    expect(toolArgumentNames('git')).toEqual(['args', 'cwd']);
    expect(toolArgumentNames('search')).toEqual(['maxResults', 'path', 'query']);
  });
});
