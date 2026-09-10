import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ExplicitResourceLoader,
  PiRuntimeError,
  createExplicitResources,
  renderSkills,
} from '../src/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agentdev-resources-'));
  await mkdir(join(root, 'agent'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(name: string): Promise<string> {
  const dir = join(root, 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} for tests\n---\n\n# ${name}\n\nBody of ${name}.\n`,
    'utf8',
  );
  return join(root, 'skills');
}

describe('explicit resource selection', () => {
  it('loads only the skills the caller selected', async () => {
    const skillsDir = await writeSkill('demo-skill');
    // A second, unselected skill exists on disk: the assertion below can only
    // hold if the loader honours the selection instead of discovering skills.
    await writeSkill('other-skill');
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
      skillPaths: [join(skillsDir, 'demo-skill')],
    });
    expect(resources.skills.map((skill) => skill.name)).toEqual(['demo-skill']);
    expect(renderSkills(resources.skills)).toContain('demo-skill');
    expect(renderSkills(resources.skills)).not.toContain('other-skill');
  });

  it('loads nothing when no skill path is given', () => {
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
    });
    expect(resources.skills).toEqual([]);
    expect(resources.loader.getSkills().skills).toEqual([]);
  });

  it('withholds skills from an untrusted project and says so', async () => {
    const skillsDir = await writeSkill('untrusted-skill');
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: false,
      skillPaths: [skillsDir],
    });
    expect(resources.skills).toEqual([]);
    expect(resources.diagnostics.some((entry) => entry.message.includes('untrusted'))).toBe(true);
  });

  it('refuses project content for an untrusted project', () => {
    expect(() =>
      createExplicitResources({
        cwd: root,
        agentDir: join(root, 'agent'),
        trusted: false,
        agentsFiles: [{ path: 'PROJECT.md', content: '# Project' }],
      }),
    ).toThrowError(PiRuntimeError);
  });

  it('exposes selected project files and the system prompt verbatim', () => {
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
      agentsFiles: [{ path: 'PROJECT.md', content: '# Project' }],
      systemPrompt: 'runner prompt',
      systemPromptSource: 'docs/agentdev/PROJECT.md',
    });
    expect(resources.loader.getAgentsFiles().agentsFiles).toHaveLength(1);
    expect(resources.loader.getSystemPrompt()).toBe('runner prompt');
    expect(resources.loader.getSystemPromptSource()).toEqual({
      path: 'docs/agentdev/PROJECT.md',
    });
  });

  it('starts from an empty extension set with a live runtime', () => {
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
    });
    const extensions = resources.loader.getExtensions();
    expect(extensions.extensions).toEqual([]);
    expect(extensions.errors).toEqual([]);
    expect(extensions.runtime).toBeDefined();
  });
});

describe('resource widening is refused', () => {
  it('records an extension request without loading it', () => {
    const loader = new ExplicitResourceLoader();
    loader.extendResources({ skillPaths: [{ path: '/elsewhere/skills', metadata: {} }] });
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getSkills().diagnostics.some((entry) => entry.message.includes('fixed'))).toBe(
      true,
    );
  });

  it('does not widen on reload', async () => {
    const skillsDir = await writeSkill('stable-skill');
    const resources = createExplicitResources({
      cwd: root,
      agentDir: join(root, 'agent'),
      trusted: true,
      skillPaths: [skillsDir],
    });
    await resources.loader.reload();
    expect(resources.loader.getSkills().skills.map((skill) => skill.name)).toEqual([
      'stable-skill',
    ]);
  });
});
