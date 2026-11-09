/**
 * The backlog file (BF-1..BF-4): one project file, `.dev/backlog.md`, is the authority. This module
 * only parses it, classifies what it finds, and performs entry-level rewrites under a per-project
 * lock. It never guesses intent and never rewrites an entry it could not read.
 *
 * Writes are atomic (temporary file + rename + read-back). Reads never mutate the file, and a
 * rewrite keeps every line outside the touched entry byte-for-byte.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseRef, resolveRef } from './refs.ts';

export const BACKLOG_FILE = join('.dev', 'backlog.md');

export type BacklogState = 'open' | 'done' | 'dropped';

export interface BacklogItem {
  readonly id: string;
  readonly title: string;
  readonly state: BacklogState;
  readonly specRefs: readonly string[];
  readonly taskIds: readonly string[];
  readonly source?: string;
  readonly createdBy?: string;
  readonly closedBy?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string;
  readonly note?: string;
  readonly external?: string;
  readonly body: string;
  /** sha256 of the entry's raw lines: the entry-level version. */
  readonly digest: string;
  /** 1-based line of the entry heading. */
  readonly line: number;
}

export interface BacklogIssue {
  /** 0 means a file-level problem: nothing in the file could be read as an entry. */
  readonly line: number;
  readonly excerpt: string;
  readonly reason: string;
  readonly id?: string;
}

export interface BacklogReadResult {
  readonly items: readonly BacklogItem[];
  readonly issues: readonly BacklogIssue[];
  readonly warnings: readonly BacklogIssue[];
}

export interface BacklogDraft {
  readonly title: string;
  readonly body?: string;
  readonly specRefs?: readonly string[];
  readonly source: string;
  readonly actorId: string;
}

export interface BacklogPatch {
  readonly title?: string;
  readonly body?: string;
  readonly specRefs?: readonly string[];
}

export interface BacklogClose {
  readonly state: 'done' | 'dropped';
  readonly note: string;
  readonly taskIds?: readonly string[];
}

/** The interface file changed after the caller read it: return the current entry, overwrite nothing. */
export class BacklogConflictError extends Error {
  readonly item: BacklogItem;
  constructor(item: BacklogItem) {
    super(`待办 ${item.id} 已被他人修改`);
    this.name = 'BacklogConflictError';
    this.item = item;
  }
}

/** The target entry (or the whole file) is unreadable: only editing its原文 can fix it. */
export class BacklogProblemError extends Error {
  readonly id: string;
  readonly issues: readonly BacklogIssue[];
  constructor(id: string, issues: readonly BacklogIssue[]) {
    super(`待办 ${id === '' ? '文件' : id} 有问题，需要先修复原文`);
    this.name = 'BacklogProblemError';
    this.id = id;
    this.issues = issues;
  }
}

/** The entry does not exist (or no readable heading carries that id). */
export class BacklogNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`待办 ${id} 不存在`);
    this.name = 'BacklogNotFoundError';
    this.id = id;
  }
}

type Key =
  | 'state'
  | 'spec'
  | 'task'
  | 'source'
  | 'createdBy'
  | 'closedBy'
  | 'created'
  | 'updated'
  | 'closed'
  | 'note'
  | 'external';

const KEYS: Readonly<Record<string, Key>> = {
  状态: 'state',
  state: 'state',
  规格: 'spec',
  spec: 'spec',
  Task: 'task',
  task: 'task',
  来源: 'source',
  source: 'source',
  创建人: 'createdBy',
  createdBy: 'createdBy',
  关闭人: 'closedBy',
  closedBy: 'closedBy',
  创建: 'created',
  created: 'created',
  更新: 'updated',
  updated: 'updated',
  关闭: 'closed',
  closed: 'closed',
  说明: 'note',
  note: 'note',
  外部: 'external',
  external: 'external',
};

const MULTI_KEYS = new Set<Key>(['spec', 'task']);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9_-]+$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const META_LINE = /^-\s*([^:：]+?)\s*[:：]\s*(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

const UNFINISHED = ['未完成', 'unfinished'];
const CLOSED = ['已关闭', 'closed'];

const NOTE_LINES = [
  '以 `### 编号 标题` 开头的一条是一件事；`- 状态:` 只能是 open / done / dropped。',
  '改坏了会在项目页显示位置和原因；修复只需改原文。',
];

interface Entry {
  readonly key?: Key;
  readonly keyText: string;
  value: string;
  readonly raw: string;
  readonly line: number;
}

interface ParsedItem extends BacklogItem {
  readonly rawStart: number;
  readonly rawEnd: number;
  readonly entries: readonly Entry[];
  readonly bodyLines: readonly string[];
}

function isSectionHeading(line: string, names: readonly string[]): boolean {
  const match = HEADING.exec(line);
  if (match === null || match[1] !== '##') {
    return false;
  }
  return names.includes((match[2] ?? '').trim().toLowerCase());
}

function sectionIndex(lines: readonly string[], names: readonly string[]): number | undefined {
  const found = lines.findIndex((line) => isSectionHeading(line, names));
  return found < 0 ? undefined : found;
}

function keyOf(keyText: string): Key | undefined {
  const wanted = keyText.trim().toLowerCase();
  for (const [name, key] of Object.entries(KEYS)) {
    if (name.toLowerCase() === wanted) {
      return key;
    }
  }
  return undefined;
}

function excerptOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

function digestOf(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function backlogPath(cwd: string): string {
  return join(cwd, BACKLOG_FILE);
}

function readText(cwd: string): string | undefined {
  const path = backlogPath(cwd);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function timeNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function splitSignalLine(line: string): { readonly indent: string; readonly rest: string } {
  const match = /^(-\s*[^:：]+?[：:]\s*)(.*)$/.exec(line);
  return match === null
    ? { indent: '- ', rest: line }
    : { indent: match[1] ?? '- ', rest: match[2] ?? '' };
}

function renderHeading(item: { readonly id: string; readonly title: string }): string {
  return item.title === '' ? `### ${item.id}` : `### ${item.id} ${item.title}`;
}

function renderBlock(item: {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly Entry[];
  readonly bodyLines: readonly string[];
}): string[] {
  const lines = [renderHeading(item)];
  for (const entry of item.entries) {
    lines.push(entry.raw);
  }
  if (item.bodyLines.length > 0) {
    if ((item.bodyLines[0] ?? '') !== '') {
      lines.push('');
    }
    lines.push(...item.bodyLines);
  }
  return lines;
}

function trimTrailingBlank(lines: readonly string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && (copy[copy.length - 1] ?? '').trim() === '') {
    copy.pop();
  }
  return copy;
}

function trimLeadingBlank(lines: readonly string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && (copy[0] ?? '').trim() === '') {
    copy.shift();
  }
  return copy;
}

/** Insert a block right under a section heading, with exactly one blank line on each side. */
function insertIntoSection(
  lines: readonly string[],
  names: readonly string[],
  block: readonly string[],
  heading: string,
): string[] {
  const index = sectionIndex(lines, names);
  if (index === undefined) {
    const base = trimTrailingBlank(lines);
    return [...base, '', `## ${heading}`, '', ...block, ''];
  }
  const head = lines.slice(0, index + 1);
  const tail = trimLeadingBlank(lines.slice(index + 1));
  return [...head, '', ...block, '', ...tail];
}

function removeBlock(lines: readonly string[], start: number, end: number): string[] {
  const before = [...lines.slice(0, start)];
  const after = [...lines.slice(end)];
  // Drop one of the two blank lines that meet at the seam; keep every other line, including blank
  // lines inside bodies, byte-identical.
  if ((before[before.length - 1] ?? '').trim() === '' && (after[0] ?? '').trim() === '') {
    after.shift();
  }
  return [...before, ...after];
}

function setSingleEntry(
  entries: Entry[],
  key: Key,
  keyText: string,
  value: string,
  line: number,
): Entry[] {
  const index = entries.findIndex((entry) => entry.key === key);
  const rendered = { key, keyText, value, raw: `- ${keyText}: ${value}`, line };
  if (index < 0) {
    entries.push(rendered);
    return entries;
  }
  const existing = entries[index];
  if (existing !== undefined) {
    entries[index] = { ...existing, value, raw: `${splitSignalLine(existing.raw).indent}${value}` };
  }
  return entries;
}

function removeKey(entries: readonly Entry[], key: Key): Entry[] {
  return entries.filter((entry) => entry.key !== key);
}

function setMultiEntries(
  entries: readonly Entry[],
  key: Key,
  keyText: string,
  values: readonly string[],
  line: number,
): Entry[] {
  const first = entries.findIndex((entry) => entry.key === key);
  const keepBefore = first < 0 ? entries.length : first;
  const inserted = values.map((value) => ({
    key,
    keyText,
    value,
    raw: `- ${keyText}: ${value}`,
    line,
  }));
  return [
    ...entries.slice(0, keepBefore),
    ...inserted,
    ...entries.slice(keepBefore).filter((entry) => entry.key !== key),
  ];
}

/**
 * Parse the file text. `cwd` is needed for the `规格` existence warning only; pass `''` to skip it.
 */
export function parseBacklog(
  text: string | undefined,
  cwd = '',
): { readonly items: readonly ParsedItem[]; readonly issues: readonly BacklogIssue[]; readonly warnings: readonly BacklogIssue[] } {
  const lines = (text ?? '').split('\n');
  const issues: BacklogIssue[] = [];
  const warnings: BacklogIssue[] = [];
  const items: ParsedItem[] = [];
  const readableIds = new Map<string, number[]>();

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const heading = HEADING.exec(line);
    const level = heading?.[1];
    const titleText = (heading?.[2] ?? '').trim();

    if (level === '##' && titleText !== '' && ID_PATTERN.test(titleText.split(/\s+/)[0] ?? '')) {
      issues.push({
        line: index + 1,
        excerpt: excerptOf(line),
        reason: '标题级别应为 ###',
        id: titleText.split(/\s+/)[0] ?? '',
      });
      index += 1;
      continue;
    }

    if (level !== '###') {
      index += 1;
      continue;
    }

    const rawStart = index;
    const match = /^(###)\s+(\S+)\s*(.*)$/.exec(line);
    const rawId = match?.[2] ?? '';
    const rawTitle = (match?.[3] ?? '').trim();
    if (!ID_PATTERN.test(rawId)) {
      issues.push({
        line: index + 1,
        excerpt: excerptOf(line),
        reason: `无法识别编号：${rawId === '' ? '(空)' : rawId}`,
      });
      index += 1;
      continue;
    }

    // Entry body ends at the next heading of level 2 or 3 (or EOF).
    let rawEnd = index + 1;
    while (rawEnd < lines.length) {
      const next = HEADING.exec(lines[rawEnd] ?? '');
      if (next !== null && (next[1] === '##' || next[1] === '###')) {
        break;
      }
      rawEnd += 1;
    }

    const entries: Entry[] = [];
    let cursor = index + 1;
    while (cursor < rawEnd) {
      const candidate = lines[cursor] ?? '';
      const meta = META_LINE.exec(candidate);
      if (meta === null) {
        break;
      }
      const keyText = (meta[1] ?? '').trim();
      const value = (meta[2] ?? '').trim();
      const key = keyOf(keyText);
      entries.push(
        key === undefined
          ? { keyText, value, raw: candidate, line: cursor + 1 }
          : { key, keyText, value, raw: candidate, line: cursor + 1 },
      );
      cursor += 1;
    }
    const bodyLines = lines.slice(cursor, rawEnd);

    const counts = new Map<Key, number>();
    for (const entry of entries) {
      if (entry.key !== undefined) {
        counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
      }
    }
    const stateEntry = entries.find((entry) => entry.key === 'state');
    const stateValue = stateEntry?.value ?? '';
    const stateValid = stateValue === 'open' || stateValue === 'done' || stateValue === 'dropped';

    if (stateEntry === undefined) {
      issues.push({
        line: rawStart + 1,
        excerpt: excerptOf(line),
        reason: '缺少状态',
        id: rawId,
      });
    } else if ((counts.get('state') ?? 0) > 1) {
      issues.push({
        line: stateEntry.line,
        excerpt: excerptOf(stateEntry.raw),
        reason: '状态写入了两次',
        id: rawId,
      });
    } else if (!stateValid) {
      issues.push({
        line: stateEntry.line,
        excerpt: excerptOf(stateEntry.raw),
        reason: `状态不合法：${stateValue === '' ? '(空)' : stateValue}`,
        id: rawId,
      });
    }

    for (const entry of entries) {
      if (entry.key === undefined || MULTI_KEYS.has(entry.key) || entry.key === 'state') {
        continue;
      }
      if ((counts.get(entry.key) ?? 0) > 1 && entry.key === 'note') {
        warnings.push({
          line: entry.line,
          excerpt: excerptOf(entry.raw),
          reason: '说明写入了两次',
          id: rawId,
        });
      } else if ((counts.get(entry.key) ?? 0) > 1) {
        warnings.push({
          line: entry.line,
          excerpt: excerptOf(entry.raw),
          reason: `${entry.keyText} 写入了两次，取第一次`,
          id: rawId,
        });
      }
    }

    const firstValue = (key: Key): string | undefined =>
      entries.find((entry) => entry.key === key)?.value;
    const allValues = (key: Key): string[] =>
      entries.filter((entry) => entry.key === key).map((entry) => entry.value);

    const createdAt = firstValue('created');
    const updatedAt = firstValue('updated');
    const closedAt = firstValue('closed');
    for (const [label, value] of [
      ['创建', createdAt],
      ['更新', updatedAt],
      ['关闭', closedAt],
    ] as const) {
      if (value !== undefined && value !== '' && !RFC3339.test(value)) {
        warnings.push({
          line: rawStart + 1,
          excerpt: excerptOf(line),
          reason: `${label} 时间不是 RFC3339：${value}`,
          id: rawId,
        });
      }
    }

    const specRefs = allValues('spec');
    if (cwd !== '') {
      for (const ref of specRefs) {
        const resolved = resolveRef(cwd, ref);
        if (!resolved.exists) {
          warnings.push({
            line: rawStart + 1,
            excerpt: excerptOf(line),
            reason: `规格引用不存在：${ref}`,
            id: rawId,
          });
        }
      }
    }

    const note = firstValue('note');
    if ((stateValue === 'done' || stateValue === 'dropped') && (note === undefined || note === '')) {
      warnings.push({
        line: rawStart + 1,
        excerpt: excerptOf(line),
        reason: '关闭了却没有写说明',
        id: rawId,
      });
    }

    const source = firstValue('source');
    const createdBy = firstValue('createdBy');
    const closedBy = firstValue('closedBy');
    const external = firstValue('external');
    // An entry whose state is missing or invalid is reported as a problem and can never be acted
    // on (add/close/update refuse it). Its `state` here is a placeholder only; callers must treat an
    // item with a matching issue as unreadable instead of trusting this field.
    const item: ParsedItem = {
      id: rawId,
      title: rawTitle,
      state: stateValid ? (stateValue as BacklogState) : 'open',
      specRefs,
      taskIds: allValues('task'),
      ...(source === undefined ? {} : { source }),
      ...(createdBy === undefined ? {} : { createdBy }),
      ...(closedBy === undefined ? {} : { closedBy }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(closedAt === undefined ? {} : { closedAt }),
      ...(note === undefined ? {} : { note }),
      ...(external === undefined ? {} : { external }),
      body: bodyLines.join('\n'),
      digest: digestOf(lines.slice(rawStart, rawEnd)),
      line: rawStart + 1,
      rawStart,
      rawEnd,
      entries,
      bodyLines,
    };
    items.push(item);
    readableIds.set(rawId, [...(readableIds.get(rawId) ?? []), rawStart]);
    index = rawEnd;
  }

  for (const [id, positions] of readableIds) {
    if (positions.length < 2) {
      continue;
    }
    for (const position of positions) {
      issues.push({
        line: position + 1,
        excerpt: excerptOf(lines[position] ?? ''),
        reason: `编号重复：${id}`,
        id,
      });
    }
  }

  // A file holding only headings and the canonical writing note is empty, not broken: that is
  // exactly what `add` creates before the first item. Anything else unexplained (a table, prose)
  // means the format was changed under us.
  const unexplained = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && HEADING.exec(line) === null && !NOTE_LINES.includes(trimmed);
  });
  if (unexplained.length > 0 && items.length === 0 && issues.length === 0) {
    issues.push({
      line: 0,
      excerpt: '',
      reason: '未识别出任何条目，可能格式已被改动',
    });
  }

  return { items, issues, warnings };
}

export function readBacklog(cwd: string): BacklogReadResult {
  const parsed = parseBacklog(readText(cwd), cwd);
  return {
    items: parsed.items.map(toPublicItem),
    issues: [...parsed.issues].sort((a, b) => a.line - b.line),
    warnings: [...parsed.warnings].sort((a, b) => a.line - b.line),
  };
}

function toPublicItem(item: ParsedItem): BacklogItem {
  const {
    rawStart: _rawStart,
    rawEnd: _rawEnd,
    entries: _entries,
    bodyLines: _bodyLines,
    ...rest
  } = item;
  return rest;
}

// --- writes -----------------------------------------------------------------------------------

const locks = new Map<string, Promise<unknown>>();

/** Serialise writes per project: two writers must not build their text from the same snapshot. */
async function withProjectLock<T>(cwd: string, work: () => Promise<T> | T): Promise<T> {
  const key = resolve(cwd);
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  try {
    return await current;
  } finally {
    if (locks.get(key) === settled) {
      locks.delete(key);
    }
  }
}

function writeAtomic(cwd: string, text: string): void {
  const path = backlogPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    writeFileSync(temporary, text, 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  if (readFileSync(path, 'utf8') !== text) {
    throw new Error('待办文件写入后读回不一致');
  }
}

function baseText(): string[] {
  return ['# 待办', '', ...NOTE_LINES, ''];
}

function problemIssuesFor(
  parsed: { readonly issues: readonly BacklogIssue[] },
  id: string,
): readonly BacklogIssue[] {
  const fileLevel = parsed.issues.filter((issue) => issue.line === 0);
  if (fileLevel.length > 0) {
    return fileLevel;
  }
  return parsed.issues.filter((issue) => issue.id === id);
}

function nextId(items: readonly ParsedItem[]): string {
  let max = 0;
  for (const item of items) {
    const match = /^B-(\d+)$/i.exec(item.id);
    if (match !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > max) {
        max = value;
      }
    }
  }
  return `B-${max + 1}`;
}

function findById(parsed: { readonly items: readonly ParsedItem[] }, id: string): ParsedItem | undefined {
  return parsed.items.find((item) => item.id === id);
}

function requireItem(
  parsed: { readonly items: readonly ParsedItem[]; readonly issues: readonly BacklogIssue[] },
  id: string,
): ParsedItem {
  const problems = problemIssuesFor(parsed, id);
  const item = findById(parsed, id);
  if (item === undefined) {
    if (problems.length > 0) {
      throw new BacklogProblemError(id, problems);
    }
    throw new BacklogNotFoundError(id);
  }
  if (problems.length > 0) {
    throw new BacklogProblemError(id, problems);
  }
  return item;
}

export async function addItem(cwd: string, draft: BacklogDraft): Promise<BacklogItem> {
  const title = draft.title.trim();
  if (title === '') {
    throw new Error('待办标题不能为空');
  }
  const specRefs = draft.specRefs ?? [];
  for (const ref of specRefs) {
    parseRef(ref);
  }
  return withProjectLock(cwd, () => {
    const text = readText(cwd) ?? '';
    const parsed = parseBacklog(text, cwd);
    const fileLevel = parsed.issues.filter((issue) => issue.line === 0);
    if (fileLevel.length > 0) {
      throw new BacklogProblemError('', fileLevel);
    }
    const id = nextId(parsed.items);
    const now = timeNow();
    const entries: Entry[] = [];
    const push = (key: Key, keyText: string, value: string): void => {
      entries.push({ key, keyText, value, raw: `- ${keyText}: ${value}`, line: 0 });
    };
    push('state', '状态', 'open');
    for (const ref of specRefs) {
      push('spec', '规格', ref);
    }
    push('source', '来源', draft.source);
    push('createdBy', '创建人', draft.actorId);
    push('created', '创建', now);
    push('updated', '更新', now);
    const body = (draft.body ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    const block = renderBlock({
      id,
      title,
      entries,
      bodyLines: body === '' ? [] : body.split('\n'),
    });
    const source = text === '' ? baseText() : text.split('\n');
    const next = insertIntoSection(source, UNFINISHED, block, '未完成');
    writeAtomic(cwd, next.join('\n'));
    const reread = parseBacklog(readText(cwd) ?? '', cwd);
    const created = findById(reread, id);
    if (created === undefined) {
      throw new Error('新建的待办没有读回');
    }
    return toPublicItem(created);
  });
}

export async function updateItem(
  cwd: string,
  id: string,
  expectedDigest: string,
  patch: BacklogPatch,
  _actorId: string,
): Promise<BacklogItem> {
  if (patch.specRefs !== undefined) {
    for (const ref of patch.specRefs) {
      parseRef(ref);
    }
  }
  return withProjectLock(cwd, () => {
    const parsed = parseBacklog(readText(cwd) ?? '', cwd);
    const item = requireItem(parsed, id);
    if (item.digest !== expectedDigest) {
      throw new BacklogConflictError(toPublicItem(item));
    }
    const title = patch.title === undefined ? item.title : patch.title.trim();
    if (title === '') {
      throw new Error('待办标题不能为空');
    }
    let entries = [...item.entries];
    const now = timeNow();
    if (patch.specRefs !== undefined) {
      const keyText =
        item.entries.find((entry) => entry.key === 'spec')?.keyText ?? '规格';
      entries = setMultiEntries(entries, 'spec', keyText, patch.specRefs, item.line);
    }
    const updatedKeyText = item.entries.find((entry) => entry.key === 'updated')?.keyText ?? '更新';
    entries = setSingleEntry(entries, 'updated', updatedKeyText, now, item.line);
    const bodyLines =
      patch.body === undefined
        ? item.bodyLines
        : patch.body.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    const block = renderBlock({
      id: item.id,
      title,
      entries,
      bodyLines: bodyLines.length === 1 && bodyLines[0] === '' ? [] : bodyLines,
    });
    const lines = readText(cwd)?.split('\n') ?? [];
    const next = [
      ...lines.slice(0, item.rawStart),
      ...block,
      ...lines.slice(item.rawEnd),
    ];
    writeAtomic(cwd, next.join('\n'));
    const reread = parseBacklog(readText(cwd) ?? '', cwd);
    const updated = findById(reread, id);
    if (updated === undefined) {
      throw new Error('修改后的待办没有读回');
    }
    return toPublicItem(updated);
  });
}

export async function closeItem(
  cwd: string,
  id: string,
  expectedDigest: string | undefined,
  close: BacklogClose,
  actorId: string,
): Promise<BacklogItem> {
  const note = close.note.trim();
  if (note === '') {
    throw new Error('关闭待办必须写一句说明');
  }
  if (close.state !== 'done' && close.state !== 'dropped') {
    throw new Error('关闭状态只能是 done 或 dropped');
  }
  return withProjectLock(cwd, () => {
    const text = readText(cwd) ?? '';
    const parsed = parseBacklog(text, cwd);
    const item = requireItem(parsed, id);
    if (item.digest !== expectedDigest && expectedDigest !== undefined) {
      throw new BacklogConflictError(toPublicItem(item));
    }
    if (item.state !== 'open') {
      throw new Error(`待办 ${id} 不是未完成状态`);
    }
    const now = timeNow();
    let entries = [...item.entries];
    const pick = (key: Key, fallback: string): string =>
      item.entries.find((entry) => entry.key === key)?.keyText ?? fallback;
    entries = setSingleEntry(entries, 'state', pick('state', '状态'), close.state, item.line);
    entries = setSingleEntry(entries, 'note', pick('note', '说明'), note, item.line);
    entries = setSingleEntry(entries, 'closedBy', pick('closedBy', '关闭人'), actorId, item.line);
    entries = setSingleEntry(entries, 'closed', pick('closed', '关闭'), now, item.line);
    entries = setSingleEntry(entries, 'updated', pick('updated', '更新'), now, item.line);
    const taskIds = [...item.taskIds];
    for (const taskId of close.taskIds ?? []) {
      if (!taskIds.includes(taskId)) {
        taskIds.push(taskId);
      }
    }
    entries = setMultiEntries(entries, 'task', pick('task', 'Task'), taskIds, item.line);
    const block = renderBlock({
      id: item.id,
      title: item.title,
      entries,
      bodyLines: item.bodyLines,
    });
    const lines = text.split('\n');
    const without = removeBlock(lines, item.rawStart, item.rawEnd);
    const next = insertIntoSection(without, CLOSED, block, '已关闭');
    writeAtomic(cwd, next.join('\n'));
    const reread = parseBacklog(readText(cwd) ?? '', cwd);
    const closed = findById(reread, id);
    if (closed === undefined) {
      throw new Error('关闭后的待办没有读回');
    }
    return toPublicItem(closed);
  });
}

export async function reopenItem(
  cwd: string,
  id: string,
  expectedDigest: string,
  note: string,
  _actorId: string,
): Promise<BacklogItem> {
  const reason = note.trim();
  if (reason === '') {
    throw new Error('重开待办必须写一句原因');
  }
  return withProjectLock(cwd, () => {
    const text = readText(cwd) ?? '';
    const parsed = parseBacklog(text, cwd);
    const item = requireItem(parsed, id);
    if (item.digest !== expectedDigest) {
      throw new BacklogConflictError(toPublicItem(item));
    }
    if (item.state === 'open') {
      throw new Error(`待办 ${id} 已经是未完成状态`);
    }
    let entries = removeKey([...item.entries], 'closed');
    entries = removeKey(entries, 'closedBy');
    const now = timeNow();
    const pick = (key: Key, fallback: string): string =>
      item.entries.find((entry) => entry.key === key)?.keyText ?? fallback;
    entries = setSingleEntry(entries, 'state', pick('state', '状态'), 'open', item.line);
    entries = setSingleEntry(entries, 'note', pick('note', '说明'), `重开：${reason}`, item.line);
    entries = setSingleEntry(entries, 'updated', pick('updated', '更新'), now, item.line);
    const block = renderBlock({
      id: item.id,
      title: item.title,
      entries,
      bodyLines: item.bodyLines,
    });
    const lines = text.split('\n');
    const without = removeBlock(lines, item.rawStart, item.rawEnd);
    const next = insertIntoSection(without, UNFINISHED, block, '未完成');
    writeAtomic(cwd, next.join('\n'));
    const reread = parseBacklog(readText(cwd) ?? '', cwd);
    const reopened = findById(reread, id);
    if (reopened === undefined) {
      throw new Error('重开后的待办没有读回');
    }
    return toPublicItem(reopened);
  });
}

/**
 * Replace an exact snippet, only inside `.dev/backlog.md`. The old text must occur exactly once;
 * anything else is refused and the current content is left untouched. This is the fix path for every
 * problem in the file (including duplicate ids).
 */
export async function editRaw(
  cwd: string,
  oldText: string,
  newText: string,
): Promise<BacklogReadResult> {
  if (oldText === '') {
    throw new Error('oldText 不能为空');
  }
  return withProjectLock(cwd, () => {
    const text = readText(cwd) ?? '';
    const occurrences = countOccurrences(text, oldText);
    if (occurrences !== 1) {
      throw new Error(
        occurrences === 0
          ? 'oldText 在待办文件中不存在'
          : `oldText 在待办文件中出现了 ${occurrences} 次，无法确定改哪一处`,
      );
    }
    writeAtomic(cwd, text.replace(oldText, newText));
    return readBacklog(cwd);
  });
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}


