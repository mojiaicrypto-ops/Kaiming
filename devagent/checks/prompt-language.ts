/**
 * Prompt-language check: the text a host injects into a model must be English.
 *
 * It reuses the product's own extraction (`src/runtime/prompt-assembly.ts`), so this check guards the
 * code path that really feeds the model instead of a copy of it. For every injected body it asserts
 * the slice is substantial and CJK-free, that the assembly composes the right bodies for the right
 * role, that a broken boundary fails loudly, and that the injected files' links all resolve (their
 * headers are human-facing metadata and keep the original anchors; only the injected body is English).
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROLE_IDS,
  assembleSystemPrompt,
  loadPromptBodies,
  sliceInjectedBody,
} from '../src/runtime/prompt-assembly.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS_DIR = join(REPO_ROOT, 'docs', 'technicalnew', 'prompts');

const CJK =
  /[\u3000-\u303f\u3040-\u30ff\u1100-\u11ff\u3130-\u318f\u2e80-\u2eff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u{20000}-\u{2fa1f}]/u;

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
};

function cjkSample(body: string): string {
  const match = CJK.exec(body);
  if (match === null) {
    return '';
  }
  const start = Math.max(0, match.index - 20);
  return body.slice(start, match.index + 20).replace(/\n/g, ' ');
}

const bodies = loadPromptBodies(PROMPTS_DIR);

function reportEnglish(name: string, body: string): void {
  const cjk = cjkSample(body);
  check(
    `${name}: injected body is substantial and English`,
    body.length > 300 && cjk === '',
    `bodyChars=${body.length} cjk=${cjk === '' ? 'none' : JSON.stringify(cjk)}`,
  );
}

reportEnglish('base.md', bodies.base.text);
reportEnglish('specialists.md', bodies.specialists.text);
for (const roleId of ROLE_IDS) {
  reportEnglish(`${roleId}.md`, bodies.roles[roleId].text);
}

// Composition: chief = base + its own body; a specialist = base + shared specialist rules + its own.
const chief = assembleSystemPrompt(bodies, 'chief');
const reviewer = assembleSystemPrompt(bodies, 'reviewer');
const compositionOk =
  chief.sources.map((source) => source.name).join(',') === 'base,chief' &&
  reviewer.sources.map((source) => source.name).join(',') === 'base,specialists,reviewer' &&
  reviewer.text.includes(bodies.specialists.text) &&
  !chief.text.includes(bodies.specialists.text) &&
  !reviewer.text.includes(bodies.roles.chief.text);
check(
  'assembly composes base + (shared rules for specialists) + the current role only',
  compositionOk,
  `chief=[${chief.sources.map((source) => source.name).join(',')}] reviewer=[${reviewer.sources.map((source) => source.name).join(',')}]`,
);

// Independent of the extractor: the boundary headings themselves must be exactly as documented, so a
// wrong-but-self-consistent literal cannot pass unnoticed.
const EXPECTED_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  'base.md': ['## Base rules', '## Judgment and expression'],
  'specialists.md': ['## Shared rules', '## Role file map'],
  ...Object.fromEntries(ROLE_IDS.map((roleId) => [`${roleId}.md`, ['## Role and goal']])),
};
const wrongHeadings: string[] = [];
for (const [file, headings] of Object.entries(EXPECTED_HEADINGS)) {
  const text = readFileSync(join(PROMPTS_DIR, file), 'utf8');
  for (const heading of headings) {
    const occurrences = text.split('\n').filter((line) => line.trim() === heading).length;
    if (occurrences !== 1) {
      wrongHeadings.push(`${file}: ${heading} occurs ${occurrences}x`);
    }
  }
}
check(
  'the documented boundary headings appear exactly once per injected file',
  wrongHeadings.length === 0,
  wrongHeadings.length === 0 ? `${Object.keys(EXPECTED_HEADINGS).length} files checked` : wrongHeadings.join(' | '),
);

// Pin the literal the extractor actually uses: the slice must begin with the documented heading, so a
// self-consistent wrong boundary inside the runtime module cannot pass this check.
const BOUNDARY_LITERALS: Readonly<Record<string, string>> = {
  'base.md': '## Base rules',
  'specialists.md': '## Shared rules',
  ...Object.fromEntries(ROLE_IDS.map((roleId) => [`${roleId}.md`, '## Role and goal'])),
};
const wrongSliceStart: string[] = [];
for (const [file, literal] of Object.entries(BOUNDARY_LITERALS)) {
  const body =
    file === 'base.md'
      ? bodies.base.text
      : file === 'specialists.md'
        ? bodies.specialists.text
        : bodies.roles[file.replace('.md', '') as (typeof ROLE_IDS)[number]].text;
  if (!body.startsWith(literal)) {
    wrongSliceStart.push(`${file}: slice starts with ${JSON.stringify(body.slice(0, 40))}`);
  }
}
check(
  'the extracted slice begins with the documented boundary literal',
  wrongSliceStart.length === 0,
  wrongSliceStart.length === 0 ? `${Object.keys(BOUNDARY_LITERALS).length} slices pinned` : wrongSliceStart.join(' | '),
);

// A broken boundary must fail loudly instead of injecting half a role body.
const scratch = mkdtempSync(join(tmpdir(), 'devagent-prompt-check-'));
try {
  const brokenPath = join(scratch, 'broken.md');
  let missingThrew = false;
  try {
    sliceInjectedBody('## Something else\n', 'role', brokenPath);
  } catch {
    missingThrew = true;
  }
  let duplicateStartThrew = false;
  try {
    sliceInjectedBody('## Role and goal\nfirst\n## Role and goal\nsecond\n', 'role', brokenPath);
  } catch {
    duplicateStartThrew = true;
  }
  let duplicateEndThrew = false;
  try {
    sliceInjectedBody(
      '## Shared rules\nR1\n## Role file map\nM1\n## Role file map\nM2\n',
      'specialists',
      brokenPath,
    );
  } catch {
    duplicateEndThrew = true;
  }
  check(
    'a missing start, duplicated start or duplicated end boundary is refused',
    missingThrew && duplicateStartThrew && duplicateEndThrew,
    `missingThrew=${missingThrew} duplicateStartThrew=${duplicateStartThrew} duplicateEndThrew=${duplicateEndThrew}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const agentsEntry = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
check(
  'AGENTS.md (project entry injected into agents) is English',
  !CJK.test(agentsEntry),
  CJK.test(agentsEntry) ? `cjk=${JSON.stringify(cjkSample(agentsEntry))}` : `chars=${agentsEntry.length}`,
);

// --- link integrity: injected files keep resolvable links ----------------------------------------
const LINK = /\]\(([^)\s]+)\)/g;

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingsOf(file: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      slugs.add(slugify(match[1]));
    }
  }
  return slugs;
}

const linkTargets: ReadonlyArray<{ readonly file: string; readonly base: string }> = [
  ...['base.md', 'specialists.md', ...ROLE_IDS.map((roleId) => `${roleId}.md`)].map((file) => ({
    file: join(PROMPTS_DIR, file),
    base: PROMPTS_DIR,
  })),
  { file: join(REPO_ROOT, 'AGENTS.md'), base: REPO_ROOT },
];
const broken: string[] = [];
let linkCount = 0;
for (const entry of linkTargets) {
  for (const match of readFileSync(entry.file, 'utf8').matchAll(LINK)) {
    const target = match[1];
    if (target === undefined || target.startsWith('http') || target.startsWith('#')) {
      continue;
    }
    linkCount += 1;
    const [pathPart, fragment] = target.split('#');
    if (pathPart === undefined) {
      continue;
    }
    const targetFile = resolve(entry.base, pathPart);
    if (!existsSync(targetFile)) {
      broken.push(`${entry.file} -> ${target} (missing file)`);
      continue;
    }
    if (fragment !== undefined && !headingsOf(targetFile).has(fragment)) {
      broken.push(`${entry.file} -> ${target} (no such heading)`);
    }
  }
}
check(
  `injected files keep resolvable links (${linkCount} targets, headers keep their original anchors)`,
  broken.length === 0,
  broken.length === 0 ? 'all resolvable' : broken.slice(0, 6).join(' | '),
);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} prompt-language checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}