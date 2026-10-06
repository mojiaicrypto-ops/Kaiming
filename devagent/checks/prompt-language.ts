/**
 * Prompt-language check: the text a host injects into a model must be English.
 *
 * It mirrors the context-assembly boundaries (G4): base runs from `## Base rules` to EOF,
 * specialists from `## Shared rules` up to `## Role file map`, and each role from `## Role and goal`
 * to EOF. For every slice it asserts the boundary resolves exactly once, the body is substantial,
 * and it contains no CJK characters. The project entry (AGENTS.md) is checked the same way.
 *
 * It also keeps the prompt files' own links honest: every link target must exist, and every fragment
 * must match a heading in the target document (the headers are human-facing metadata, so their link
 * targets stay exactly as written — only the injected body is English).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS_DIR = join(REPO_ROOT, 'docs', 'technicalnew', 'prompts');

const ROLE_FILES = [
  'chief.md',
  'designer.md',
  'developer.md',
  'reviewer.md',
  'tester.md',
  'settler.md',
  'investigator.md',
] as const;

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

/** Slice from `start` heading to EOF, or up to (excluding) `end` heading when given. */
function slice(
  text: string,
  start: string,
  end?: string,
): { ok: true; body: string } | { ok: false; reason: string } {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) {
    return { ok: false, reason: `missing boundary ${JSON.stringify(start)}` };
  }
  if (text.indexOf(start, startIndex + start.length) !== -1) {
    return { ok: false, reason: `boundary ${JSON.stringify(start)} appears more than once` };
  }
  const endIndex = end === undefined ? text.length : text.indexOf(end, startIndex);
  if (end !== undefined && endIndex === -1) {
    return { ok: false, reason: `missing end boundary ${JSON.stringify(end)}` };
  }
  return { ok: true, body: text.slice(startIndex, endIndex) };
}

function readPrompt(file: string): string {
  return readFileSync(join(PROMPTS_DIR, file), 'utf8');
}

function cjkSample(body: string): string {
  const match = CJK.exec(body);
  if (match === null) {
    return '';
  }
  const start = Math.max(0, match.index - 20);
  return body.slice(start, match.index + 20).replace(/\n/g, ' ');
}

for (const [file, start, end] of [
  ['base.md', '## Base rules', undefined],
  ['specialists.md', '## Shared rules', '## Role file map'],
] as const) {
  const result = slice(readPrompt(file), start, end);
  check(
    `${file}: boundary ${JSON.stringify(start)} resolves and the body is English`,
    result.ok && result.body.length > 300 && !CJK.test(result.body),
    result.ok
      ? `bodyChars=${result.body.length} cjk=${cjkSample(result.body) === '' ? 'none' : JSON.stringify(cjkSample(result.body))}`
      : result.reason,
  );
}

for (const file of ROLE_FILES) {
  const result = slice(readPrompt(file), '## Role and goal');
  check(
    `${file}: boundary "## Role and goal" resolves and the body is English`,
    result.ok && result.body.length > 300 && !CJK.test(result.body),
    result.ok
      ? `bodyChars=${result.body.length} cjk=${cjkSample(result.body) === '' ? 'none' : JSON.stringify(cjkSample(result.body))}`
      : result.reason,
  );
}

const agentsEntry = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
check(
  'AGENTS.md (project entry injected into agents) is English',
  !CJK.test(agentsEntry),
  CJK.test(agentsEntry) ? `cjk=${JSON.stringify(cjkSample(agentsEntry))}` : `chars=${agentsEntry.length}`,
);

// --- link integrity: prompt headers are metadata and must keep resolvable links ------------------
const LINK = /\]\(([^)\s]+)\)/g;

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingsOf(file: string): Set<string> {
  const text = readFileSync(file, 'utf8');
  const slugs = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      slugs.add(slugify(match[1]));
    }
  }
  return slugs;
}

const promptFiles = ['base.md', 'specialists.md', ...ROLE_FILES];
/** Injected artifacts: prompt files (relative to the prompts dir) and the project entry. */
const linkTargets: ReadonlyArray<{ readonly file: string; readonly base: string }> = [
  ...promptFiles.map((file) => ({ file: join(PROMPTS_DIR, file), base: PROMPTS_DIR })),
  { file: join(REPO_ROOT, 'AGENTS.md'), base: REPO_ROOT },
];
const broken: string[] = [];
let linkCount = 0;
for (const entry of linkTargets) {
  const text = readFileSync(entry.file, 'utf8');
  for (const match of text.matchAll(LINK)) {
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
  `prompt links resolve (${linkCount} targets checked, headers keep their original anchors)`,
  broken.length === 0,
  broken.length === 0 ? 'all resolvable' : broken.slice(0, 6).join(' | '),
);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} prompt-language checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}