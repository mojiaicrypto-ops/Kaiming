/**
 * The deletion gate (G1's bash clause): a destructive command asks the user before it runs.
 *
 * Detection is *textual*: the command line is split into shell segments and each segment is matched
 * against the deletion rules below. That is not a shell parser and not a sandbox — a determined
 * caller can spell deletion in ways no text rule catches. The rules watch the **command position**
 * (segment start, after a wrapper like sudo/xargs, or inside a command substitution), so a deletion
 * word in a commit message or an echo argument stays quiet while every ordinary spelling of a real
 * deletion still asks. The tool allowlist (read Tasks hold no bash) and the delivery verification
 * remain the outer bounds, as before.
 */
import type { ExtensionAPI, ExtensionFactory, ToolCallEvent } from '@earendil-works/pi-coding-agent';

/** The shell tools whose command text is inspected (the same pair the private-path guard watches). */
const SHELL_TOOLS = new Set(['bash', 'powershell']);

/** Where one command ends and the next begins: separators, newlines and pipes each start a segment. */
const SEGMENT_SEPARATOR = /\n|&&|\|\||;|\|/;

/** The characters that may precede a command word: nothing, whitespace, or a substitution opener. */
const COMMAND_START = /(^|[\s;|&(`])/;

interface DeletionRule {
  /** Does this segment perform the deletion this rule names? */
  readonly match: (segment: string) => boolean;
  /** How the rule is described to the user and, on refusal, to the model. */
  readonly label: string;
}

const RULES: readonly DeletionRule[] = [
  // Direct file deletion, however flagged (-r, -f, -rf, --recursive … all still `rm`). The command
  // word must sit in command position — bare, behind a wrapper, or inside a substitution — so an
  // `rm` inside a quoted argument (a commit message, an echo) stays quiet.
  {
    match: (s) => new RegExp(`${COMMAND_START.source}\\s*(?:(?:sudo|nohup|nice|watch|command|exec|time|xargs)\\s+|env\\s+\\S+\\s+)*(rm|rmdir|shred|unlink)\\b`).test(s),
    label: 'deletes files or directories',
  },
  // find with -delete removes what it matches.
  { match: (s) => /\bfind\b/.test(s) && /(^|\s)-delete\b/.test(s), label: 'find -delete removes what it matches' },
  // git clean needs -f to delete; -n is a dry run and stays quiet.
  { match: (s) => /\bgit\s+clean\b/.test(s) && /(^|\s)-[a-zA-Z]*f/.test(s), label: 'git clean -f deletes untracked files' },
  { match: (s) => /\bgit\s+reset\b/.test(s) && /(^|\s)--hard\b/.test(s), label: 'git reset --hard discards working-tree changes' },
  // Every git restore discards working-tree changes (--staged only un-stages; asking once more is
  // the safer failure direction).
  { match: (s) => /\bgit\s+restore\b/.test(s), label: 'git restore discards working-tree changes' },
  { match: (s) => /\bgit\s+checkout\b/.test(s) && /\s--(\s|$)/.test(s), label: 'git checkout -- discards working-tree changes' },
  { match: (s) => /\bgit\s+stash\b/.test(s) && /\s(drop|clear)\b/.test(s), label: 'drops stashed changes' },
  // -D force-deletes an unmerged branch; lowercase -d refuses unmerged work and stays quiet.
  { match: (s) => /\bgit\s+branch\b/.test(s) && /(^|\s)-D\b/.test(s), label: 'git branch -D force-deletes a branch' },
  // --force-with-lease also starts with --force.
  { match: (s) => /\bgit\s+push\b/.test(s) && /(^|\s)(--force\b|-f\b)/.test(s), label: 'force-pushes over remote history' },
  // Scripted deletion through an interpreter is the same act with another spelling. The Sync
  // suffices alone (it is not an English word); bare fs./os. calls keep their prefix so ordinary
  // prose in a quoted argument stays quiet.
  { match: (s) => /\bshutil\.rmtree\b|\bos\.(remove|unlink|rmdir)\b/.test(s), label: 'deletes files from a script' },
  { match: (s) => /\bfs\.(rm|unlink|rmdir)(Sync)?\b|\b(rm|unlink|rmdir)Sync\b/.test(s), label: 'deletes files from a script' },
];

/**
 * Why a command is destructive, or `undefined` when it is not. Exported so the rule table can be
 * tested without a running session.
 */
export function deletionCommandReason(command: string): string | undefined {
  for (const segment of command.split(SEGMENT_SEPARATOR)) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    for (const rule of RULES) {
      if (rule.match(trimmed)) {
        return rule.label;
      }
    }
  }
  return undefined;
}

/**
 * The extension that installs the gate for one session. The question travels through the session's
 * bound UI adapter, so it is durable (the interaction is in the store before the wait begins),
 * visible wherever the session's questions already appear, and the run counts as waiting rather than
 * stalled. A refusal blocks the call as a tool result the model can act on; an approval runs the
 * command exactly as issued.
 */
export function createDeletionGate(): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', async (event: ToolCallEvent, ctx) => {
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
      const approved = await ctx.ui.confirm('Approve the destructive command?', `${command}\n\n(${reason})`);
      return approved ? undefined : { block: true, reason: `the user declined: this command ${reason}` };
    });
  };
}
