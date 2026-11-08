/**
 * The Plan contract (G2 task, D-02): a write Task's Plan must state acceptance before development,
 * and its「范围」section is compared with what actually changed. Neither check reads the code: the
 * first validates the Plan text, the second only lists files as a prompt for Review.
 */
import { matchesGlob } from 'node:path';
import { changedProjectPaths } from './git-delivery.ts';

const ACCEPTANCE_NAMES = ['验收', 'acceptance', 'acceptance criteria'];
const SCOPE_NAMES = ['范围', 'scope'];
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

interface Section {
  readonly level: number;
  readonly lines: readonly string[];
}

function findSection(markdown: string, names: readonly string[]): Section | undefined {
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading === null || heading[1] === undefined) {
      continue;
    }
    const level = heading[1].length;
    const title = (heading[2] ?? '').trim().toLowerCase();
    if (level < 2 || level > 3 || !names.includes(title)) {
      continue;
    }
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = HEADING.exec(lines[cursor] ?? '');
      if (next !== null && (next[1] ?? '').length <= level) {
        break;
      }
      body.push(lines[cursor] ?? '');
    }
    return { level, lines: body };
  }
  return undefined;
}

function meaningful(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
}

/** Why the Plan does not satisfy the acceptance rule; undefined when it does. */
export function acceptanceGap(planMarkdown: string): string | undefined {
  const section = findSection(planMarkdown, ACCEPTANCE_NAMES);
  if (section === undefined) {
    return 'the Plan needs a level-2 or level-3 section titled 验收 / Acceptance / Acceptance criteria';
  }
  if (!meaningful(section.lines)) {
    return 'the 验收 section is empty: state observable completion conditions before development';
  }
  return undefined;
}

/** The acceptance section with whitespace normalized, for "did the acceptance change" comparisons. */
export function acceptanceText(planMarkdown: string): string {
  const section = findSection(planMarkdown, ACCEPTANCE_NAMES);
  if (section === undefined) {
    return '';
  }
  return section.lines.join('\n').replace(/\s+/g, ' ').trim();
}

export function acceptanceChanged(before: string, after: string): boolean {
  return acceptanceText(before) !== acceptanceText(after);
}

const BACKTICK = /`([^`]+)`/g;
/** A path or glob, not a route, command or sentence: those are read by Review, not extracted. */
const PATH_LIKE = new RegExp('^(?:[^\\s]+/|\\*|.*\\.[A-Za-z0-9]+$)');

/** Declared paths from the Plan's「范围」section; null means the section declares no usable path. */
export function extractScope(planMarkdown: string): string[] | null {
  const section = findSection(planMarkdown, SCOPE_NAMES);
  if (section === undefined) {
    return null;
  }
  const declared: string[] = [];
  for (const line of section.lines) {
    for (const match of line.matchAll(BACKTICK)) {
      const candidate = (match[1] ?? '').trim().replace(/^\.\//, '');
      if (
        candidate !== '' &&
        !/\s/.test(candidate) &&
        PATH_LIKE.test(candidate) &&
        !declared.includes(candidate)
      ) {
        declared.push(candidate);
      }
    }
  }
  return declared.length === 0 ? null : declared;
}

/** `.dev/**`, `docs/**` and root Markdown are settlement output, never scope drift (G2). */
function isSettlementOutput(path: string): boolean {
  if (path.startsWith('.dev/') || path.startsWith('docs/')) {
    return true;
  }
  return !path.includes('/') && /\.md$/i.test(path);
}

export interface ScopeCheck {
  readonly declared: readonly string[] | null;
  readonly outOfScope: readonly string[];
}

/**
 * Compare the declared scope with the paths this delivery changed. Only value-shaped paths matter:
 * Review decides whether a listed file is really out of scope.
 */
export function scopeDrift(
  planMarkdown: string,
  changedPaths: readonly string[],
): ScopeCheck {
  const declared = extractScope(planMarkdown);
  if (declared === null) {
    return { declared: null, outOfScope: [] };
  }
  const outOfScope = changedPaths
    .map((path) => path.replace(/^\.\//, ''))
    .filter((path) => path !== '' && !isSettlementOutput(path))
    .filter((path) => !declared.some((pattern) => matchesGlob(path, pattern)));
  return { declared, outOfScope: [...new Set(outOfScope)].sort() };
}

/** The check attached to dispatch and task.get: declared paths plus files that fall outside them. */
export function scopeCheckFor(cwd: string, planMarkdown: string | undefined): ScopeCheck {
  const declared = planMarkdown === undefined ? null : extractScope(planMarkdown);
  if (declared === null) {
    return { declared: null, outOfScope: [] };
  }
  return scopeDrift(planMarkdown ?? '', changedProjectPaths(cwd));
}

/** One line for the model: what the Plan declares and which files are outside it. */
export function scopeCheckText(check: ScopeCheck): string {
  if (check.declared === null) {
    return 'Scope: not declared (the Plan has no usable 范围 section)';
  }
  const declared = check.declared.join(', ');
  if (check.outOfScope.length === 0) {
    return `Scope declared: ${declared}; no changed file outside it`;
  }
  return `Scope declared: ${declared}; files outside it: ${check.outOfScope.join(', ')} (Review judges whether each is justified)`;
}
