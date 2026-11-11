/**
 * The deletion gate (G1's bash clause): a destructive command asks the user before it runs.
 *
 * Detection is *textual*: the command line is split into shell segments and each segment is matched
 * against the deletion rules below. That is not a shell parser and not a sandbox — a determined
 * caller can spell deletion in ways no text rule catches. The splitter is quote-aware and the rules
 * only look at the **command position** (segment start, after a wrapper like sudo/xargs, or inside a
 * command substitution), so a deletion word in a commit message, an echo argument, a sed expression
 * or a grep pattern stays quiet while every ordinary spelling of a real deletion still asks. The
 * tool allowlist (read Tasks hold no bash) and the delivery verification remain the outer bounds, as
 * before.
 *
 * Scope: only commands that really delete something. Git operations that merely discard working-tree
 * changes or rewrite remote history (`reset --hard`, `restore`, `checkout --`, `push --force`) are
 * deliberately not in this table; they are not deletion commands and asking for them made routine
 * test runs noisy.
 */
import type { ExtensionAPI, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';

/** The shell tools whose command text is inspected (the same pair the private-path guard watches). */
const SHELL_TOOLS = new Set(['bash', 'powershell']);

/** Where one command ends and the next begins, outside quotes. */
const SEGMENT_SEPARATOR = new Set(['\n', ';', '|', '&']);

/** Commands that run another command: the deletion word sits behind them at command position. */
const WRAPPERS = String.raw`(?:(?:sudo|nohup|nice|watch|command|exec|time|xargs)\s+|env\s+\S+\s+)*`;

/**
 * Split a command line at unquoted separators. A `|`, `;` or `&&` inside a quoted argument is
 * data, not syntax: treating it as a separator is how a grep pattern like `'kept\|rm -rf'` used to
 * turn into a fake `rm -rf` segment.
 */
function segmentsOf(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (SEGMENT_SEPARATOR.has(char)) {
      // `&&` and `||` are one separator; a single `&`/`|` is also a separator.
      segments.push(current);
      current = '';
      if ((char === '&' || char === '|') && command[index + 1] === char) index += 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/** Command-substitution bodies (`$(…)` and backticks) that actually run, outside single quotes. */
function substitutionBodies(segment: string): string[] {
  const bodies: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === '$' && segment[index + 1] === '(') {
        bodies.push(segment.slice(index + 2));
        index += 1;
        continue;
      }
      if (char === '`') {
        bodies.push(segment.slice(index + 1));
        continue;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '$' && segment[index + 1] === '(') {
      bodies.push(segment.slice(index + 2));
      index += 1;
      continue;
    }
    if (char === '`') {
      bodies.push(segment.slice(index + 1));
    }
  }
  return bodies;
}

/** Does `wordPattern` start this command, at the segment start or inside a substitution? */
function atCommandStart(segment: string, wordPattern: string): boolean {
  const pattern = new RegExp(`^\\s*${WRAPPERS}${wordPattern}`);
  if (pattern.test(segment)) return true;
  return substitutionBodies(segment).some((body) => pattern.test(body));
}

interface DeletionRule {
  /** Does this segment perform the deletion this rule names? */
  readonly match: (segment: string) => boolean;
  /** How the rule is described to the user and, on refusal, to the model. */
  readonly label: string;
}

const RULES: readonly DeletionRule[] = [
  // Direct file deletion, however flagged (-r, -f, -rf, --recursive … all still `rm`). The command
  // word must sit in command position; a deletion word inside a quoted argument stays quiet.
  {
    match: (s) => atCommandStart(s, String.raw`(?:rm|rmdir|shred|unlink)\b`),
    label: 'deletes files or directories',
  },
  // find with -delete removes what it matches.
  {
    match: (s) => atCommandStart(s, String.raw`find\b`) && /(^|\s)-delete\b/.test(s),
    label: 'find -delete removes what it matches',
  },
  // git clean needs -f to delete; -n is a dry run and stays quiet.
  {
    match: (s) =>
      atCommandStart(s, String.raw`git\s+(?:-C\s+\S+\s+)?clean\b`) &&
      /(^|\s)(?:--force\b|-[a-zA-Z]*f)/.test(s),
    label: 'git clean -f deletes untracked files',
  },
  // Dropping or clearing a stash deletes saved changes; `git stash` / `pop` do not.
  {
    match: (s) =>
      atCommandStart(s, String.raw`git\s+(?:-C\s+\S+\s+)?stash\b`) && /\s(drop|clear)\b/.test(s),
    label: 'drops stashed changes',
  },
  // -D force-deletes an unmerged branch; lowercase -d refuses unmerged work and stays quiet.
  {
    match: (s) =>
      atCommandStart(s, String.raw`git\s+(?:-C\s+\S+\s+)?branch\b`) && /(^|\s)-D\b/.test(s),
    label: 'git branch -D force-deletes a branch',
  },
  // Scripted deletion through an interpreter is the same act with another spelling. The Sync
  // suffices alone (it is not an English word); bare fs./os. calls keep their prefix so ordinary
  // prose in a quoted argument stays quiet.
  {
    match: (s) => /\bshutil\.rmtree\b|\bos\.(remove|unlink|rmdir)\b/.test(s),
    label: 'deletes files from a script',
  },
  {
    match: (s) => /\bfs\.(rm|unlink|rmdir)(Sync)?\b|\b(rm|unlink|rmdir)Sync\b/.test(s),
    label: 'deletes files from a script',
  },
];

/**
 * Why a command is destructive, or `undefined` when it is not. Exported so the rule table can be
 * tested without a running session.
 */
export function deletionCommandReason(command: string): string | undefined {
  for (const segment of segmentsOf(command)) {
    if (segment.trim() === '') continue;
    for (const rule of RULES) {
      if (rule.match(segment)) {
        return rule.label;
      }
    }
  }
  return undefined;
}

/** The choices shown by the gate. `TRUST` covers every later shell call in this session. */
const APPROVE_ONCE = 'Approve once';
const TRUST_SESSION = 'Trust all commands in this session';
const REJECT = 'Reject';

/** Session-local trust state owned by the runner, so a Pi instance rebuild does not reset it. */
export interface DeletionGateOptions {
  readonly isTrusted?: () => boolean;
  readonly trust?: () => void;
}

/**
 * The extension that installs the gate for one session. The question travels through the session's
 * bound UI adapter, so it is durable (the interaction is in the store before the wait begins),
 * visible wherever the session's questions already appear, and the run counts as waiting rather than
 * stalled. A refusal blocks the call as a tool result the model can act on; an approval runs the
 * command exactly as issued. Choosing `TRUST_SESSION` is an explicit, session-local bypass for
 * repeated test runs: every later shell call, including deletions, runs without a question.
 */
export function createDeletionGate(options: DeletionGateOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    let trustAll = options.isTrusted?.() === true;
    pi.on('tool_call', async (event: ToolCallEvent, ctx) => {
      if (trustAll || options.isTrusted?.() === true) return undefined;
      if (!SHELL_TOOLS.has(event.toolName)) return undefined;
      const input = event.input as { command?: string };
      const command = input['command'];
      if (typeof command !== 'string' || command === '') return undefined;
      const reason = deletionCommandReason(command);
      if (reason === undefined) return undefined;
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `this command ${reason} and needs the user's approval, but no UI is bound`,
        };
      }
      const answer = await ctx.ui.select(
        `Approve the destructive command?\n\n${command}\n\n(${reason})`,
        [APPROVE_ONCE, TRUST_SESSION, REJECT],
      );
      if (answer === TRUST_SESSION) {
        trustAll = true;
        options.trust?.();
        return undefined;
      }
      if (answer === APPROVE_ONCE) return undefined;
      return { block: true, reason: `the user declined: this command ${reason}` };
    });
  };
}
