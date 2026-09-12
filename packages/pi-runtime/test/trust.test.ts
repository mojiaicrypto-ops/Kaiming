import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@agentdev/contracts';
import {
  EXTENSION_API_VERSION,
  PiRuntimeError,
  loadTrustedExtensions,
  type BuiltinExtensionSpec,
  type LoaderTraceEntry,
  type TrustedExtensionLoadResult,
} from '../src/index.js';

/**
 * AC-053 trust and resource boundary.
 *
 * "Given 未信任仓库有自动加载扩展；When open/createSession；Then 不执行，Trust后也只有
 *  选择的Skill/内置资源可用。证据：Loader轨迹。"
 *
 * Every fixture is a real temporary repository. The repository module below writes a
 * marker file when it is evaluated, so "was it imported?" is answered by the file
 * system rather than by trusting the loader's own report.
 */
let scratch: string;
let repo: string;
const MARKER = 'pwned.marker';

const REPOSITORY_MODULE = [
  "import { writeFileSync } from 'node:fs';",
  "import { fileURLToPath } from 'node:url';",
  "import { dirname, join } from 'node:path';",
  'const here = dirname(fileURLToPath(import.meta.url));',
  `writeFileSync(join(here, '${MARKER}'), 'the repository module executed');`,
  "export const id = 'repo-demo';",
  '',
].join('\n');

const MODULE_DIR = 'extensions';
const CANDIDATE_MODULE = join(MODULE_DIR, 'evil.mjs');

function markerPath(): string {
  return join(repo, MODULE_DIR, MARKER);
}

/** A whitelist entry; the release ships an empty optional list, so tests supply one. */
function spec(overrides: Partial<BuiltinExtensionSpec> & { id: string }): BuiltinExtensionSpec {
  return {
    version: '1.0.0',
    apiVersion: EXTENSION_API_VERSION,
    capabilities: [],
    critical: false,
    enabledByDefault: false,
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function entryOf(
  result: TrustedExtensionLoadResult,
  kind: LoaderTraceEntry['kind'],
  id: string,
): LoaderTraceEntry | undefined {
  return result.trace.find((entry) => entry.kind === kind && entry.id === id);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'agentdev-trust-'));
  repo = join(scratch, 'repo');
  await mkdir(join(repo, MODULE_DIR), { recursive: true });
  await mkdir(join(repo, '.pi'), { recursive: true });
  await writeFile(
    join(repo, '.pi', 'extensions.json'),
    '{ "extensions": ["repo-demo"] }\n',
    'utf8',
  );
  await writeFile(join(repo, CANDIDATE_MODULE), REPOSITORY_MODULE, 'utf8');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('untrusted repository (AC-053)', () => {
  it('never imports, reads or activates a repository resource and reports every skip', async () => {
    const imported: string[] = [];
    const readSkills: string[] = [];
    const skillDir = join(repo, 'skills', 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: demo\n---\n\n# demo\n',
      'utf8',
    );

    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'untrusted',
      manifest: [spec({ id: 'repo-demo', capabilities: ['report'] })],
      repositoryExtensions: [
        {
          id: 'repo-demo',
          modulePath: CANDIDATE_MODULE,
          configPath: '.pi/extensions.json',
        },
      ],
      repositoryConfigPaths: ['.pi/extensions.json'],
      selectedExtensionIds: ['repo-demo'],
      selectedSkillPaths: [skillDir],
      importModule: async (absolutePath) => {
        imported.push(absolutePath);
        const loaded: unknown = await import(pathToFileURL(absolutePath).href);
        return loaded;
      },
      readSkillFile: async (absolutePath) => {
        readSkills.push(absolutePath);
        return readFile(absolutePath, 'utf8');
      },
    });

    // The repository module's only effect is the marker file: its absence proves
    // that no import happened, not merely that the loader said so.
    expect(imported).toEqual([]);
    expect(readSkills).toEqual([]);
    expect(await exists(markerPath())).toBe(false);
    expect(result.readOnly).toBe(true);

    expect(result.loadedExtensions).toEqual([]);
    expect(result.loadedSkills).toEqual([]);

    const extension = entryOf(result, 'extension', 'repo-demo');
    expect(extension).toMatchObject({ decision: 'skipped', code: 'NOT_AUTHORIZED' });
    expect(extension?.reason).toContain('untrusted-project');

    const config = entryOf(result, 'config', '.pi/extensions.json');
    expect(config).toMatchObject({ decision: 'skipped', code: 'NOT_AUTHORIZED' });
    expect(config?.reason).toContain('untrusted-project');

    const skill = entryOf(result, 'skill', skillDir);
    expect(skill).toMatchObject({ decision: 'skipped', code: 'NOT_AUTHORIZED' });
    expect(skill?.reason).toContain('untrusted-project');

    expect(result.trace.some((entry) => entry.decision === 'loaded')).toBe(false);
  });

  it('still activates the shipped release whitelist, which is not repository content', async () => {
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'untrusted',
      manifest: [spec({ id: 'builtin-report', enabledByDefault: true, capabilities: ['report'] })],
    });

    expect(result.loadedExtensions).toEqual([
      {
        id: 'builtin-report',
        origin: 'builtin',
        path: undefined,
        capabilities: ['report'],
        critical: false,
      },
    ]);
    expect(entryOf(result, 'extension', 'builtin-report')).toMatchObject({
      origin: 'builtin',
      decision: 'loaded',
    });
  });
});

describe('trusted repository (AC-053)', () => {
  it('imports a selected, whitelisted repository extension only after trust', async () => {
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo', capabilities: ['report'] })],
      repositoryExtensions: [
        { id: 'repo-demo', modulePath: CANDIDATE_MODULE, configPath: '.pi/extensions.json' },
      ],
      repositoryConfigPaths: ['.pi/extensions.json'],
      selectedExtensionIds: ['repo-demo'],
    });

    expect(await exists(markerPath())).toBe(true);
    const loaded = result.loadedExtensions.find((entry) => entry.id === 'repo-demo');
    expect(loaded).toMatchObject({
      origin: 'repository',
      capabilities: ['report'],
      critical: false,
    });
    const trace = entryOf(result, 'extension', 'repo-demo');
    expect(trace).toMatchObject({ origin: 'repository', decision: 'loaded' });
    expect(trace?.reason).toContain('trusted-project');
    // Repository configuration never drives loading, even after trust.
    expect(entryOf(result, 'config', '.pi/extensions.json')?.reason).toContain('not authoritative');
  });

  it('refuses a repository extension outside the selected set, without importing it', async () => {
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo', capabilities: ['report'] })],
      repositoryExtensions: [{ id: 'repo-demo', modulePath: CANDIDATE_MODULE }],
    });

    expect(await exists(markerPath())).toBe(false);
    expect(result.loadedExtensions).toEqual([]);
    expect(entryOf(result, 'extension', 'repo-demo')).toMatchObject({
      decision: 'refused',
      code: 'NOT_AUTHORIZED',
    });
    expect(entryOf(result, 'extension', 'repo-demo')?.reason).toContain('not-selected');
  });

  it('refuses a selected repository extension the release does not ship', async () => {
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [],
      repositoryExtensions: [{ id: 'repo-unknown', modulePath: CANDIDATE_MODULE }],
      selectedExtensionIds: ['repo-unknown'],
    });

    expect(await exists(markerPath())).toBe(false);
    expect(entryOf(result, 'extension', 'repo-unknown')).toMatchObject({
      decision: 'refused',
      code: 'VALIDATION_ERROR',
    });
    expect(entryOf(result, 'extension', 'repo-unknown')?.reason).toContain(
      'not-in-builtin-whitelist',
    );
  });

  it('refuses a module path that escapes the project root', async () => {
    await writeFile(join(scratch, 'outside.mjs'), REPOSITORY_MODULE, 'utf8');
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo' })],
      repositoryExtensions: [{ id: 'repo-demo', modulePath: join('..', 'outside.mjs') }],
      selectedExtensionIds: ['repo-demo'],
    });

    expect(await exists(join(scratch, MARKER))).toBe(false);
    expect(await exists(markerPath())).toBe(false);
    expect(entryOf(result, 'extension', 'repo-demo')).toMatchObject({
      decision: 'refused',
      code: 'VALIDATION_ERROR',
    });
    expect(entryOf(result, 'extension', 'repo-demo')?.reason).toContain('path-escape');
  });

  it('refuses a symlinked module that resolves outside the project root', async () => {
    await writeFile(join(scratch, 'outside-linked.mjs'), REPOSITORY_MODULE, 'utf8');
    await symlink(join(scratch, 'outside-linked.mjs'), join(repo, 'linked.mjs'));
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo' })],
      repositoryExtensions: [{ id: 'repo-demo', modulePath: 'linked.mjs' }],
      selectedExtensionIds: ['repo-demo'],
    });

    expect(await exists(join(scratch, MARKER))).toBe(false);
    expect(result.loadedExtensions).toEqual([]);
    expect(entryOf(result, 'extension', 'repo-demo')?.decision).toBe('refused');
  });

  it('loads only the selected skill and records its declared name', async () => {
    const selectedDir = join(repo, 'skills', 'selected-skill');
    const otherDir = join(repo, 'skills', 'other-skill');
    await mkdir(selectedDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });
    await writeFile(
      join(selectedDir, 'SKILL.md'),
      '---\nname: selected-skill\ndescription: selected\n---\n\nbody\n',
      'utf8',
    );
    await writeFile(join(otherDir, 'SKILL.md'), '---\nname: other-skill\n---\n\nbody\n', 'utf8');

    const readSkills: string[] = [];
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      selectedSkillPaths: [selectedDir],
      readSkillFile: async (absolutePath) => {
        readSkills.push(absolutePath);
        return readFile(absolutePath, 'utf8');
      },
    });

    expect(result.loadedSkills.map((skill) => skill.name)).toEqual(['selected-skill']);
    expect(readSkills).toHaveLength(1);
    expect(readSkills[0]).toContain('selected-skill');
    expect(JSON.stringify(result.trace)).not.toContain('other-skill');
  });

  it('refuses a selected skill outside the project and agent roots', async () => {
    const readSkills: string[] = [];
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      selectedSkillPaths: [join('..', 'outside-skill')],
      readSkillFile: async (absolutePath) => {
        readSkills.push(absolutePath);
        return readFile(absolutePath, 'utf8');
      },
    });

    expect(readSkills).toEqual([]);
    expect(entryOf(result, 'skill', join('..', 'outside-skill'))).toMatchObject({
      decision: 'refused',
      code: 'VALIDATION_ERROR',
    });
    expect(entryOf(result, 'skill', join('..', 'outside-skill'))?.reason).toContain('path-escape');
  });

  it('blocks startup when a critical repository extension fails to import', async () => {
    await writeFile(
      join(repo, 'extensions', 'broken.mjs'),
      "throw new Error('broken repository extension');\n",
      'utf8',
    );
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo', critical: true, capabilities: ['policy'] })],
      repositoryExtensions: [{ id: 'repo-demo', modulePath: join(MODULE_DIR, 'broken.mjs') }],
      selectedExtensionIds: ['repo-demo'],
    });

    expect(result.startupBlocked).toBe(true);
    expect(entryOf(result, 'extension', 'repo-demo')).toMatchObject({
      decision: 'refused',
      code: 'VALIDATION_ERROR',
    });
    expect(entryOf(result, 'extension', 'repo-demo')?.reason).toContain('extension-import-failed');
  });

  it('keeps the built-in activation semantics: a failed optional only disables itself', async () => {
    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [
        spec({
          id: 'core-policy',
          capabilities: ['policy'],
          critical: true,
          enabledByDefault: true,
        }),
        spec({ id: 'extra-report', capabilities: ['report'], enabledByDefault: true }),
      ],
      activate: (entry) => {
        if (entry.id === 'core-policy') throw new Error('policy backend unavailable');
      },
    });

    expect(result.startupBlocked).toBe(true);
    expect(result.loadedExtensions.map((entry) => entry.id)).toEqual(['extra-report']);
    expect(entryOf(result, 'extension', 'core-policy')).toMatchObject({
      origin: 'builtin',
      decision: 'refused',
      code: 'INTERNAL_ERROR',
    });
    expect(entryOf(result, 'extension', 'extra-report')).toMatchObject({
      origin: 'builtin',
      decision: 'loaded',
    });
  });
});

describe('loader trace (AC-053 evidence)', () => {
  it('records every input exactly once, in order, with a contracts code on every refusal', async () => {
    const skillDir = join(repo, 'skills', 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\n---\n\nbody\n', 'utf8');

    const result = await loadTrustedExtensions({
      projectRoot: repo,
      trust: 'trusted',
      manifest: [spec({ id: 'repo-demo' }), spec({ id: 'builtin-report', enabledByDefault: true })],
      repositoryConfigPaths: ['.pi/extensions.json'],
      repositoryExtensions: [
        { id: 'repo-demo', modulePath: CANDIDATE_MODULE },
        { id: 'repo-other', modulePath: CANDIDATE_MODULE },
      ],
      selectedExtensionIds: ['repo-demo'],
      selectedSkillPaths: [skillDir],
    });

    expect(result.trace.map((entry) => entry.seq)).toEqual(
      result.trace.map((_entry, index) => index + 1),
    );
    // config + two candidates + skill + two built-ins.
    expect(result.trace).toHaveLength(5);
    const ids = result.trace.map((entry) => `${entry.kind}:${entry.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.refused.map((entry) => entry.id)).toContain('repo-other');
    expect(result.refused.every((entry) => entry.code !== undefined)).toBe(true);
    expect(
      result.refused.every((entry) => ERROR_CODES.includes(entry.code ?? 'INTERNAL_ERROR')),
    ).toBe(true);
    expect(result.skipped.every((entry) => entry.decision === 'skipped')).toBe(true);
  });

  it('rejects a missing project root as a caller error', async () => {
    await expect(
      loadTrustedExtensions({ projectRoot: '   ', trust: 'trusted' }),
    ).rejects.toBeInstanceOf(PiRuntimeError);
    await expect(
      loadTrustedExtensions({ projectRoot: '   ', trust: 'trusted' }),
    ).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
  });
});
