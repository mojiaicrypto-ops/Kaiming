/**
 * Requirement records (F1-F4): the files under `.dev/requirements/<id>.md` are the only authority for a
 * proposal or an implementation requirement. They are project files, so a save is a version-checked
 * atomic replace, and the list is rebuilt from the files - never from a second live index.
 *
 * Parsing is deliberately strict and returns locatable problems: a record the program cannot read is
 * reported as an invalid file with its reasons, never silently guessed into a valid one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIREMENTS_DIR = join('.dev', 'requirements');

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const SCHEMA_VERSION = 2;

export type RequirementKind = 'proposal' | 'implementation';

export const STATUSES: Readonly<Record<RequirementKind, readonly string[]>> = {
  proposal: ['pending', 'planning', 'archived', 'cancelled'],
  implementation: ['pending', 'in_progress', 'completed', 'cancelled', 'archived'],
};

export const IMPLEMENTATION_SECTIONS = [
  '目标',
  '范围',
  '行为与异常',
  '验收',
  '来源与决定',
  '未知',
  '完成摘要',
] as const;

const REQUIRED_FIELDS = ['schemaVersion', 'id', 'kind', 'title', 'status', 'createdAt', 'updatedAt'] as const;

/**
 * The exact record shape, derived from the same constants the parser enforces. It is handed to
 * the model (tool description and failure details) because the format contract lives in the
 * design documents, which a run never reads: an author without it writes a plausible markdown
 * document (headings, no front matter) and every save is rejected without a way to comply.
 */
export function requirementTemplate(kind: RequirementKind = 'implementation', id = 'req-example'): string {
  const front = [
    '---',
    `schemaVersion: ${SCHEMA_VERSION}`,
    `id: ${id}`,
    `kind: ${kind}`,
    'title: <非空标题>',
    `status: ${STATUSES[kind][0]}`,
    'createdAt: "2026-01-01T00:00:00Z"',
    'updatedAt: "2026-01-01T00:00:00Z"',
    '---',
  ].join('\n');
  const body = kind === 'implementation'
    ? IMPLEMENTATION_SECTIONS.map((section) => `## ${section}\n<正文>`).join('\n\n')
    : ['## 目标', '## 来源与决定', '## 处理记录'].map((section) => `${section}\n<正文>`).join('\n\n');
  return `${front}\n\n${body}\n`;
}

/** The one-line rules a save must satisfy, quoted in the tool output so a retry can succeed. */
export function requirementFormatRules(): string {
  return [
    'the file starts with a YAML front matter (`---`) and the required fields',
    `schemaVersion must be ${SCHEMA_VERSION}`,
    'id must equal the file name ([A-Za-z0-9_-]+); kind is proposal or implementation and cannot change in place',
    `status: proposal ${STATUSES.proposal.join('/')}; implementation ${STATUSES.implementation.join('/')}`,
    'createdAt/updatedAt are UTC RFC3339 strings ("2026-01-01T00:00:00Z"), updatedAt is stamped by the save',
    `implementation body: each of ${IMPLEMENTATION_SECTIONS.map((section) => `## ${section}`).join(' ')} exactly once, in order, non-empty`,
    'proposal body: non-empty (目标/来源与决定/处理记录 recommended)',
    'modules entries must be existing project-relative markdown files',
  ]
    .filter((line) => line !== '')
    .join('; ');
}
const ARRAY_FIELDS = ['modules', 'sourceRequirementIds', 'linkedTaskIds'] as const;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface RequirementMetadata {
  readonly schemaVersion: number;
  readonly id: string;
  readonly kind: RequirementKind;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modules: readonly string[];
  readonly sourceRequirementIds: readonly string[];
  readonly linkedTaskIds: readonly string[];
}

export interface RequirementRecord {
  readonly metadata: RequirementMetadata;
  readonly body: string;
  readonly text: string;
}

/** What `list` reports per file: the summary when it is valid, the reasons when it is not. */
export interface RequirementSummary {
  readonly id: string;
  readonly kind: RequirementKind;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly modules: readonly string[];
  readonly sourceRequirementIds: readonly string[];
  readonly linkedTaskIds: readonly string[];
  readonly version: string;
  readonly path: string;
}

export interface InvalidRequirementFile {
  readonly file: string;
  readonly issues: readonly string[];
}

export function requirementsDirOf(cwd: string): string {
  return join(cwd, REQUIREMENTS_DIR);
}

export function requirementPath(cwd: string, id: string): string {
  if (!ID_PATTERN.test(id)) {
    // The id is the file name: anything else could walk out of the requirements directory.
    throw new Error(`the requirement id ${id} is not a valid record name`);
  }
  return join(requirementsDirOf(cwd), `${id}.md`);
}

export function digestOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Parse one record. `expectedId` is the file name: a record must not claim another identity (F4).
 * Returns either the parsed record with non-fatal notes, or the locatable reasons it is invalid.
 */
export function parseRequirement(
  text: string,
  expectedId: string,
  cwd: string,
):
  | { readonly ok: true; readonly record: RequirementRecord; readonly issues: readonly string[] }
  | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { ok: false, issues: ['the file must start with a YAML front matter (`---`)'] };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) {
    return { ok: false, issues: ['the YAML front matter is not closed with `---`'] };
  }
  const front = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n');

  const values = new Map<string, string | string[]>();
  let currentListKey: string | undefined;
  for (const [offset, rawLine] of front.entries()) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') {
      continue;
    }
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem !== null) {
      if (currentListKey === undefined) {
        issues.push(`line ${offset + 2}: a list item without a field`);
        continue;
      }
      const existing = values.get(currentListKey) ?? [];
      values.set(currentListKey, [...(Array.isArray(existing) ? existing : []), unquote(listItem[1] ?? '')]);
      continue;
    }
    const field = /^([A-Za-z][A-Za-z0-9_]*):(?:\s*(.*))?$/.exec(line);
    if (field === null) {
      issues.push(`line ${offset + 2}: not a \`key: value\` field`);
      continue;
    }
    const key = field[1] ?? '';
    if (values.has(key)) {
      issues.push(`line ${offset + 2}: duplicate field \`${key}\``);
      continue;
    }
    const raw = (field[2] ?? '').trim();
    if (raw === '') {
      // A field with no value starts a block list.
      values.set(key, []);
      currentListKey = key;
      continue;
    }
    currentListKey = undefined;
    values.set(key, raw.startsWith('[') ? parseFlowList(raw, issues, offset + 2) : unquote(raw));
  }

  for (const field of REQUIRED_FIELDS) {
    if (!values.has(field)) {
      issues.push(`missing field \`${field}\``);
    }
  }
  const string = (key: string): string | undefined => {
    const value = values.get(key);
    return typeof value === 'string' ? value : undefined;
  };
  const list = (key: string): string[] => {
    const value = values.get(key);
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      issues.push(`\`${key}\` must be a list`);
      return [];
    }
    const unique = [...new Set(value)];
    if (unique.length !== value.length) {
      issues.push(`\`${key}\` contains duplicates`);
    }
    return unique;
  };

  const version = string('schemaVersion');
  if (version !== undefined && version !== String(SCHEMA_VERSION)) {
    issues.push(`schemaVersion ${version} is not supported (expected ${SCHEMA_VERSION})`);
  }
  const id = string('id');
  if (id !== undefined) {
    if (!ID_PATTERN.test(id)) {
      issues.push('id must use [A-Za-z0-9_-]');
    } else if (id !== expectedId) {
      issues.push(`id ${id} does not match the file name ${expectedId}`);
    }
  }
  const kind = string('kind');
  if (kind !== undefined && kind !== 'proposal' && kind !== 'implementation') {
    issues.push(`kind ${kind} is neither proposal nor implementation`);
  }
  const title = string('title');
  if (title !== undefined && title.trim() === '') {
    issues.push('title must not be empty');
  }
  const status = string('status');
  if (status !== undefined && kind !== undefined && (kind === 'proposal' || kind === 'implementation')) {
    if (!STATUSES[kind].includes(status)) {
      issues.push(`status ${status} is not valid for a ${kind}`);
    }
  }
  const createdAt = string('createdAt');
  const updatedAt = string('updatedAt');
  if (createdAt !== undefined && !RFC3339.test(createdAt)) {
    issues.push('createdAt must be a UTC RFC3339 timestamp');
  }
  if (updatedAt !== undefined && !RFC3339.test(updatedAt)) {
    issues.push('updatedAt must be a UTC RFC3339 timestamp');
  }
  if (createdAt !== undefined && updatedAt !== undefined && RFC3339.test(createdAt) && RFC3339.test(updatedAt)) {
    if (updatedAt < createdAt) {
      issues.push('updatedAt must not be earlier than createdAt');
    }
  }
  // Project-relative references may not escape the project, and the file must really be there (F1).
  for (const entry of list('modules')) {
    if (entry.startsWith('/') || entry.split('/').includes('..') || entry.trim() === '') {
      issues.push(`modules entry ${entry} is not a project-relative path`);
      continue;
    }
    const resolved = join(cwd, entry);
    if (!resolved.startsWith(join(cwd, '/')) && resolved !== cwd) {
      issues.push(`modules entry ${entry} resolves outside the project`);
      continue;
    }
    try {
      if (!statSync(resolved).isFile()) {
        issues.push(`modules entry ${entry} is not a file`);
      }
    } catch {
      issues.push(`modules entry ${entry} does not exist or cannot be read`);
    }
  }
  for (const linked of list('linkedTaskIds')) {
    if (linked.trim() === '') {
      issues.push('linkedTaskIds contains an empty id');
    }
  }
  for (const source of list('sourceRequirementIds')) {
    if (!ID_PATTERN.test(source)) {
      issues.push(`sourceRequirementIds entry ${source} is not a valid id`);
    }
  }

  issues.push(...bodyIssues(kind, body));

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    issues: [],
    record: {
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        id: id as string,
        kind: kind as RequirementKind,
        title: title as string,
        status: status as string,
        createdAt: createdAt as string,
        updatedAt: updatedAt as string,
        modules: list('modules'),
        sourceRequirementIds: list('sourceRequirementIds'),
        linkedTaskIds: list('linkedTaskIds'),
      },
      body,
      text,
    },
  };
}

function bodyIssues(kind: string | undefined, body: string): string[] {
  const issues: string[] = [];
  const trimmed = body.trim();
  if (trimmed === '') {
    issues.push('the body must not be empty');
    return issues;
  }
  if (kind !== 'implementation') {
    return issues;
  }
  // F3: the seven sections appear exactly once, in order, and each one has content.
  const headings: string[] = [];
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading !== null) {
      headings.push(heading[1] ?? '');
    }
  }
  const expected = [...IMPLEMENTATION_SECTIONS];
  for (const section of expected) {
    const count = headings.filter((heading) => heading === section).length;
    if (count === 0) {
      issues.push(`missing section \`## ${section}\``);
    } else if (count > 1) {
      issues.push(`section \`## ${section}\` appears ${count} times`);
    }
  }
  const known = headings.filter((heading) => expected.includes(heading as (typeof expected)[number]));
  if (known.join('|') !== expected.join('|')) {
    issues.push('the implementation sections are not in the required order');
  }
  // Each section carries content: the slice runs from the end of a heading line to the *start* of the
  // next one, so an empty section cannot hide behind the next heading's own marker.
  const marker = /^##\s+(.*?)\s*$/gm;
  const found: Array<{ readonly title: string; readonly fieldStart: number; readonly contentStart: number }> = [];
  for (let match = marker.exec(body); match !== null; match = marker.exec(body)) {
    found.push({
      title: (match[1] ?? '').trim(),
      fieldStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  found.forEach((section, index) => {
    if (!expected.includes(section.title as (typeof expected)[number])) {
      return;
    }
    const stop = index + 1 < found.length ? (found[index + 1]?.fieldStart ?? body.length) : body.length;
    if (body.slice(section.contentStart, stop).trim() === '') {
      issues.push(`section \`## ${section.title}\` has no content`);
    }
  });
  return issues;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFlowList(raw: string, issues: string[], line: number): string[] {
  if (!raw.endsWith(']')) {
    issues.push(`line ${line}: the list is not closed with ]`);
    return [];
  }
  const inner = raw.slice(1, -1).trim();
  if (inner === '') {
    return [];
  }
  return inner.split(',').map((item) => unquote(item));
}

export function serializeRequirement(metadata: RequirementMetadata, body: string): string {
  const front = [
    '---',
    `schemaVersion: ${metadata.schemaVersion}`,
    `id: ${metadata.id}`,
    `kind: ${metadata.kind}`,
    `title: ${quote(metadata.title)}`,
    `status: ${metadata.status}`,
    `createdAt: "${metadata.createdAt}"`,
    `updatedAt: "${metadata.updatedAt}"`,
    ...(metadata.modules.length > 0 ? [`modules: [${metadata.modules.map(quote).join(', ')}]`] : []),
    ...(metadata.sourceRequirementIds.length > 0
      ? [`sourceRequirementIds: [${metadata.sourceRequirementIds.map(quote).join(', ')}]`]
      : []),
    ...(metadata.linkedTaskIds.length > 0
      ? [`linkedTaskIds: [${metadata.linkedTaskIds.map(quote).join(', ')}]`]
      : []),
    '---',
  ].join('\n');
  const normalized = body.startsWith('\n') ? body.slice(1) : body;
  return `${front}\n${normalized}${normalized.endsWith('\n') ? '' : '\n'}`;
}

/**
 * A save prepared from fields rather than from a hand-written file: the author supplies the
 * content and the decisions, the program owns the serialization (schemaVersion, id, the
 * timestamps, the section headings). The produced text is parsed by the same authority before it
 * is written, so the file keeps exactly one format definition.
 */
export interface RequirementDraft {
  readonly id: string;
  readonly kind: RequirementKind;
  readonly title: string;
  readonly status: string;
  readonly modules: readonly string[];
  readonly sourceRequirementIds: readonly string[];
  readonly linkedTaskIds: readonly string[];
  /** implementation: content per required heading; the keys are the headings themselves. */
  readonly sections: Readonly<Record<string, string>> | undefined;
  /** proposal: the free body. */
  readonly body: string | undefined;
}

export function draftToMarkdown(
  draft: RequirementDraft,
  when: { readonly createdAt: string; readonly updatedAt: string },
): { readonly ok: true; readonly markdown: string } | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  let body: string;
  if (draft.kind === 'implementation') {
    if (draft.body !== undefined) {
      issues.push('an implementation record takes `sections`, not `body`');
    }
    const sections = draft.sections ?? {};
    for (const key of Object.keys(sections)) {
      if (!(IMPLEMENTATION_SECTIONS as readonly string[]).includes(key)) {
        issues.push(
          `unknown section \`${key}\`; an implementation record has exactly ${IMPLEMENTATION_SECTIONS.join(' / ')}`,
        );
      }
    }
    const missing: string[] = [];
    for (const heading of IMPLEMENTATION_SECTIONS) {
      if ((sections[heading] ?? '').trim() === '') {
        missing.push(heading);
      }
    }
    if (missing.length > 0) {
      issues.push(`sections without content: ${missing.join(' / ')}`);
    }
    body = IMPLEMENTATION_SECTIONS.map((heading) => `## ${heading}\n\n${(sections[heading] ?? '').trim()}`).join(
      '\n\n',
    );
  } else {
    if (draft.sections !== undefined) {
      issues.push('a proposal takes `body`, not `sections`');
    }
    body = (draft.body ?? '').trim();
    if (body === '') {
      issues.push('a proposal needs a non-empty body');
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    markdown: serializeRequirement(
      {
        schemaVersion: SCHEMA_VERSION,
        id: draft.id,
        kind: draft.kind,
        title: draft.title.trim(),
        status: draft.status.trim(),
        createdAt: when.createdAt,
        updatedAt: when.updatedAt,
        modules: [...draft.modules],
        sourceRequirementIds: [...draft.sourceRequirementIds],
        linkedTaskIds: [...draft.linkedTaskIds],
      },
      body,
    ),
  };
}

/** The section contents of an implementation body, keyed by heading; used to revise losslessly. */
export function splitSections(body: string): Record<string, string> {
  const marker = /^##\s+(.*?)\s*$/gm;
  const found: Array<{ readonly title: string; readonly headingStart: number; readonly contentStart: number }> = [];
  for (let match = marker.exec(body); match !== null; match = marker.exec(body)) {
    found.push({
      title: (match[1] ?? '').trim(),
      headingStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  const result: Record<string, string> = {};
  found.forEach((section, index) => {
    if (!(IMPLEMENTATION_SECTIONS as readonly string[]).includes(section.title)) {
      return;
    }
    // A section runs to the start of the next heading (known or not), so its text is never clipped.
    const stop = index + 1 < found.length ? (found[index + 1]?.headingStart ?? body.length) : body.length;
    result[section.title] = body.slice(section.contentStart, stop).trim();
  });
  return result;
}

function quote(value: string): string {
  return /^[A-Za-z0-9_\-./ ]+$/.test(value) && value.trim() === value && value !== ''
    ? value
    : JSON.stringify(value);
}

/** Read every record in the directory; unreadable files are reported, never hidden (F4). */
export function listRequirements(cwd: string): {
  readonly valid: RequirementSummary[];
  readonly invalid: InvalidRequirementFile[];
} {
  const dir = requirementsDirOf(cwd);
  const valid: RequirementSummary[] = [];
  const invalid: InvalidRequirementFile[] = [];
  if (!existsSync(dir)) {
    return { valid, invalid };
  }
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const id = file.slice(0, -'.md'.length);
    const path = join(dir, file);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      invalid.push({ file, issues: [`the file could not be read: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    const parsed = parseRequirement(text, id, cwd);
    if (!parsed.ok) {
      invalid.push({ file, issues: parsed.issues });
      continue;
    }
    valid.push({
      ...parsed.record.metadata,
      version: digestOfText(text),
      path,
    } as RequirementSummary);
  }
  valid.sort((left, right) => (left.updatedAt === right.updatedAt ? (left.id < right.id ? -1 : 1) : left.updatedAt > right.updatedAt ? -1 : 1));
  return { valid, invalid };
}

/** get: the raw text, its metadata when valid, the file digest and any locatable problems. */
export function getRequirement(
  cwd: string,
  id: string,
):
  | { readonly found: false }
  | {
      readonly found: true;
      readonly text: string;
      readonly version: string;
      readonly parsed: ReturnType<typeof parseRequirement>;
    } {
  let path: string;
  try {
    path = requirementPath(cwd, id);
  } catch {
    return { found: false };
  }
  if (!existsSync(path)) {
    return { found: false };
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    // A file the program cannot read is reported with its reason, never thrown at the caller (F4).
    return {
      found: true,
      text: '',
      version: '',
      parsed: {
        ok: false,
        issues: [`the file could not be read: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
  return { found: true, text, version: digestOfText(text), parsed: parseRequirement(text, id, cwd) };
}

/**
 * The one transition the program itself writes: an implementation requirement whose Task has started
 * is `in_progress` (R-05). Only this fact is derived — completion, cancellation and archiving stay
 * decisions the owner records through the tool, with their evidence.
 *
 * The edit is confined to the two front-matter lines that change, so an owner's prose is never
 * re-serialized by a program that only knows about status; the result is re-parsed before it is
 * written, and the version check makes a concurrent external edit lose instead of being overwritten.
 */
export function promoteRequirementToInProgress(params: {
  readonly cwd: string;
  readonly id: string;
}):
  | { readonly ok: true; readonly status: string; readonly path: string }
  | { readonly ok: false; readonly code: 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'VERSION_CONFLICT'; readonly message: string } {
  const found = getRequirement(params.cwd, params.id);
  if (!found.found) return { ok: false, code: 'NOT_FOUND', message: `requirement ${params.id} does not exist` };
  if (!found.parsed.ok) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: `requirement ${params.id} is not valid: ${found.parsed.issues.join('; ')}` };
  }
  const metadata = found.parsed.record.metadata;
  if (metadata.kind !== 'implementation') {
    return { ok: false, code: 'INVALID_ARGUMENT', message: `requirement ${params.id} is a proposal; only an implementation requirement can be in progress` };
  }
  if (metadata.status === 'in_progress') {
    return { ok: true, status: 'in_progress', path: requirementPath(params.cwd, params.id) };
  }
  if (metadata.status !== 'pending') {
    // A cancelled, completed or archived record is a decision already taken; the program reports it.
    return { ok: false, code: 'INVALID_ARGUMENT', message: `requirement ${params.id} is ${metadata.status}; a started Task does not reopen it` };
  }
  const now = new Date().toISOString();
  const rewritten = found.text
    .replace(/^status:\s*"?[^"\n]*"?\s*$/m, 'status: in_progress')
    .replace(/^updatedAt:\s*.*$/m, `updatedAt: "${now}"`);
  const expected = digestOfText(found.text);
  const saved = saveRequirement({ cwd: params.cwd, id: params.id, expectedVersion: expected, markdown: rewritten });
  if (!saved.ok) {
    return { ok: false, code: saved.code, message: saved.message };
  }
  return { ok: true, status: 'in_progress', path: saved.path };
}

export interface SaveRequirementParams {
  readonly cwd: string;
  readonly id: string;
  /** null creates a new record; otherwise the digest `get` returned. */
  readonly expectedVersion: string | null;
  readonly markdown: string;
}

/**
 * Save with a version check: the intended version is computed first, the current file is compared,
 * and only then is the record replaced atomically and read back. A losing writer never touches the
 * file, and a retry with the recorded version is idempotent.
 */
export function saveRequirement(
  params: SaveRequirementParams,
):
  | { readonly ok: true; readonly id: string; readonly path: string; readonly version: string; readonly reused: boolean }
  | { readonly ok: false; readonly code: 'VERSION_CONFLICT' | 'INVALID_ARGUMENT'; readonly message: string; readonly issues?: readonly string[] } {
  if (!ID_PATTERN.test(params.id)) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'the requirement id must use [A-Za-z0-9_-]' };
  }
  const parsed = parseRequirement(params.markdown, params.id, params.cwd);
  if (!parsed.ok) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'the record is not valid', issues: parsed.issues };
  }
  const path = requirementPath(params.cwd, params.id);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const currentVersion = existing === undefined ? null : digestOfText(existing);
  const intendedVersion = digestOfText(params.markdown);

  if (params.expectedVersion === null) {
    if (existing !== undefined) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `${params.id} already exists; get it and pass its version to update it`,
      };
    }
  } else if (currentVersion === intendedVersion) {
    // The very same content is already saved: a retry, not a new revision.
    return { ok: true, id: params.id, path, version: currentVersion, reused: true };
  } else if (currentVersion !== params.expectedVersion) {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      message: `the file changed since it was read (expected ${params.expectedVersion}, found ${currentVersion ?? 'nothing'})`,
    };
  }

  const directory = requirementsDirOf(params.cwd);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, params.markdown, 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  const saved = readFileSync(path, 'utf8');
  if (digestOfText(saved) !== intendedVersion) {
    return { ok: false, code: 'VERSION_CONFLICT', message: 'the saved file does not read back as written' };
  }
  return { ok: true, id: params.id, path, version: intendedVersion, reused: false };
}
