import { describe, expect, it } from 'vitest';
import {
  acceptanceChanged,
  acceptanceGap,
  acceptanceText,
  declaredVerificationProfile,
  extractScope,
  scopeDrift,
  scopeCheckFor,
} from '../src/runtime/plan-contract.ts';

const PLAN = [
  '# 目标',
  '做点事。',
  '',
  '## 验收',
  '- 按钮文案为“进入”。',
  '',
  '## 范围',
  '账号模块：`server/account/**`、`web/src/account/**`；接口 `POST /api/login`。',
  '',
].join('\n');

describe('acceptance', () => {
  it('accepts a non-empty 验收 section at level 2 or 3', () => {
    expect(acceptanceGap('## 验收\n- x\n')).toBeUndefined();
    expect(acceptanceGap('### 验收\n- x\n')).toBeUndefined();
    expect(acceptanceGap('## Acceptance criteria\n- x\n')).toBeUndefined();
  });

  it('refuses a missing or empty acceptance section', () => {
    expect(acceptanceGap('# 目标\n做点事。\n')).toMatch(/验收/);
    expect(acceptanceGap('## 验收\n\n## 范围\n`a.ts`\n')).toMatch(/empty/);
  });

  it('compares only the acceptance section', () => {
    const changed = PLAN.replace('按钮文案为“进入”。', '按钮文案为“登录”。');
    expect(acceptanceChanged(PLAN, changed)).toBe(true);
    expect(acceptanceChanged(PLAN, `${PLAN}\n## 其他\n- x\n`)).toBe(false);
    expect(acceptanceText(PLAN)).toContain('按钮文案');
  });
});

describe('scope', () => {
  it('extracts only path-shaped backticked fragments from the 范围 section', () => {
    expect(extractScope(PLAN)).toEqual(['server/account/**', 'web/src/account/**']);
  });

  it('returns null when the section is missing or declares no path', () => {
    expect(extractScope('# 目标\n只写文字。\n')).toBeNull();
    expect(extractScope('## 范围\n账号模块与登录接口。\n')).toBeNull();
  });

  it('lists changed files outside the declared globs', () => {
    const check = scopeDrift(PLAN, [
      'server/account/reset.ts',
      'server/trade/a.ts',
      '.dev/backlog.md',
      'docs/x.md',
      'README.md',
    ]);
    expect(check.declared).toEqual(['server/account/**', 'web/src/account/**']);
    expect(check.outOfScope).toEqual(['server/trade/a.ts']);
  });

  it('does not invent drift when the Plan declares no scope', () => {
    const check = scopeDrift('# 目标\n', ['server/trade/a.ts']);
    expect(check).toEqual({ declared: null, outOfScope: [] });
  });

  it('reads nothing from a project without a repository', () => {
    expect(scopeCheckFor('/nonexistent-project-directory', PLAN)).toEqual({
      declared: ['server/account/**', 'web/src/account/**'],
      outOfScope: [],
    });
  });
});

describe('verification profile', () => {
  it('reads the one declared line, accepting either colon and optional backticks', () => {
    expect(declaredVerificationProfile('# Plan\n\nverification profile: `focused`\n')).toBe('focused');
    expect(declaredVerificationProfile('verification profile：broad')).toBe('broad');
    expect(declaredVerificationProfile('  Verification Profile: VISUAL  ')).toBe('visual');
    expect(
      declaredVerificationProfile('verification profile: `broad` (shared dispatch contract; full suite allowed)'),
    ).toBe('broad');
  });

  it('accepts Markdown emphasis around the value, as real Plans write it', () => {
    expect(declaredVerificationProfile('Verification profile: **focused**\n')).toBe('focused');
    expect(declaredVerificationProfile('Verification profile: **broad** (schema migration)\n')).toBe('broad');
    expect(declaredVerificationProfile('Verification profile: __visual__\n')).toBe('visual');
    expect(declaredVerificationProfile('verification profile: *focused*\n')).toBe('focused');
    // Emphasis inside a fence is still an example, not a declaration.
    expect(declaredVerificationProfile('```\nVerification profile: **broad**\n```\n')).toBeUndefined();
  });

  it('ignores examples inside fenced code and prose that only mentions the phrase', () => {
    const plan = [
      '## 验证',
      '```',
      'verification profile: broad',
      '```',
      '~~~',
      'verification profile: focused',
      '~~~',
      '````',
      '```',
      'verification profile: visual',
      '```',
      '````',
      '~~~',
      '```',
      'verification profile: focused',
      '```',
      '~~~',
      '    verification profile: broad',
      'The Plan mentions verification profile: broad in a sentence.',
      '## other',
    ].join('\n');
    expect(declaredVerificationProfile(plan)).toBeUndefined();
  });

  it('keeps a fence open when the closer is shorter or carries text, and reads a declaration after it', () => {
    const unclosed = ['```', '``` note', 'verification profile: broad', '## still code'].join('\n');
    expect(declaredVerificationProfile(unclosed)).toBeUndefined();
    expect(declaredVerificationProfile('```\nx\n```\nverification profile: focused\n')).toBe('focused');
  });

  it('returns undefined when nothing is declared or the value is unknown', () => {
    expect(declaredVerificationProfile('# Plan\n')).toBeUndefined();
    expect(declaredVerificationProfile('verification profile: exhaustive\n')).toBeUndefined();
    expect(declaredVerificationProfile('verification profile: broader\n')).toBeUndefined();
  });
});
