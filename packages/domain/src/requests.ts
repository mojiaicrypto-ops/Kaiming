/**
 * Chief routing for a user message (`workflow.md` §1, AC-005/AC-006).
 *
 * The Chief is an agent, so its assessment is normally produced by a model
 * (WP-04/WP-06). This module is the deterministic baseline the Core applies before
 * that model exists. It is deliberately **conservative**: a work item only carries
 * write authority when the message reads as an unambiguous instruction, because
 * granting write scope to a question is a security failure while asking for
 * clarification is merely slower.
 *
 * The two directions are equally important, so the rules are explicit:
 * - an instruction clause (modification verb + a named path) authorizes exactly that
 *   path (AC-005);
 * - a question, explanation, refusal, conditional or quotation never does — even when
 *   it names a path (AC-004);
 * - a message that mixes an instruction with an explanation becomes two Works with
 *   independent scopes, the explanation first (AC-006).
 */
import { emptyScope, type Intent, type Scope } from '@agentdev/contracts';

/** One Work the message asks for. */
export interface MessageWorkItem {
  readonly intent: Extract<Intent, 'assist' | 'artifact' | 'document' | 'delivery'>;
  readonly goal: string;
  readonly scope: Scope;
  /** Paths the message explicitly instructed to modify, in this clause. */
  readonly writePaths: readonly string[];
}

export interface MessageRouting {
  readonly items: readonly MessageWorkItem[];
  /** True when at least one clause is an instruction with a named target. */
  readonly explicitAuthorization: boolean;
  /** Why the routing decided this, for the Assessment reason. */
  readonly reason: string;
}

/** Verbs that ask for an explanation; only leading in a clause do they count. */
const EXPLANATION_LEAD_PATTERN =
  /^(?:请|帮我|麻烦|请帮我)?\s*(?:解释|说明|介绍|描述|讲讲|梳理|分析)/u;

const EXPLANATION_LEAD_EN_PATTERN =
  /^(?:please\s+)?(?:explain|describe|summari[sz]e|analy[sz]e|walk me through|tell me|show me)\b/iu;

/** Words that make a clause a question wherever they appear. */
const QUESTION_PATTERNS: readonly RegExp[] = [
  /[?？]/u,
  /(吗|呢|么|如何|怎么|怎样|为什么|为何|能否|是否可以|可不可以|要不要|是不是|有没有|请问|帮我看看|能不能|可以吗|是否已经)/u,
  /\b(how|why|what|when|where|which|who|can|could|should|would|is|are|am|does|do|did|have you|has it)\b/iu,
  /(question|not sure|wondering|curious)/iu,
];

/**
 * Refusals.
 *
 * The Chinese marker `别` only counts where it negates an action (`别改`, `别修改`), so
 * words such as 错别字 / 识别 / 特别 / 分别 stay instructions (W3R5-02).
 */
const NEGATION_PATTERNS: readonly RegExp[] = [
  // `别` only negates when it starts a word; 错别字 / 识别 / 特别 / 分别 must stay
  // instructions (W3R5-02).
  /(不要|不用|不需要|无需|先不|暂不|不必|(?<![\p{Script=Han}\w])别)\s*(?:再|去|来)?\s*(?:改|修改|动|碰|删|移除|更新|添加|新增|实现|修复|重命名|重构)/u,
  /(不是要你|没有让你|并没有要求|先说不要)/u,
  /\b(do not|don't|dont|never|no need to|without changing|not asking|not asking you to)\b/iu,
];

/** Hypotheticals and quotations are not instructions. */
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /(如果|假如|若是|要是|万一|假设)/u,
  /\b(if|whether|suppose|assuming|in case)\b/iu,
  /(你(刚才|之前)?说|你提到|引用|所说的)/u,
  /["“][^"”]{0,80}["”]/u,
];

const MODIFICATION_PATTERN =
  /(修复|修正|更正|改掉|改成|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构)/u;

const MODIFICATION_EN_PATTERN =
  /\b(fix|fixes|fixed|implement|update|updates|add|adds|remove|removes|delete|deletes|refactor|rename|change|changes|correct|corrects|edit|edits)\b/iu;

const DOCUMENT_PATTERNS: readonly RegExp[] = [
  /文档|说明书|readme|设计文档/iu,
  /\bdocument(ation)?\b/iu,
];

/** Extensions that mark a token as a file reference. */
const FILE_EXTENSIONS = new Set([
  'md',
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'toml',
  'yml',
  'yaml',
  'txt',
  'html',
  'css',
  'py',
  'rs',
  'go',
  'sql',
]);

/** One whitespace/punctuation separated token; `、` is a list separator. */
const TOKEN_PATTERN = /[^\s,;:()"'`[\]{}<>，。；：（）【】、]+/gu;

/** A conservative path shape; anchored and free of nested quantifiers. */
const PATH_TOKEN_PATTERN = /^[\w.@-]+(?:\/[\w.@-]+)*$/u;

const MAX_TOKEN_LENGTH = 512;
const MAX_PATHS = 32;

/** Clause boundaries: sentences and coordinating conjunctions, never list commas. */
const CLAUSE_SPLIT_PATTERN =
  /(?:[;；。!！\n]+)|(?:\s+(?:and|then)\s+)|(?:[，,]\s*(?:and|then|然后|并且|同时|而且)\s*)/iu;

/** Upper bound on the Works one message may create (`messages.ts` enforces it). */
export const MAX_WORK_ITEMS = 4;

/** Paths a message names; linear in the body length. */
export function pathsIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    if (raw.length > MAX_TOKEN_LENGTH) continue;
    const token = raw.replace(/[.,;:]+$/u, '');
    if (token.length === 0 || token.includes('://')) continue;
    if (!PATH_TOKEN_PATTERN.test(token)) continue;
    const extension = token.includes('.')
      ? token.slice(token.lastIndexOf('.') + 1).toLowerCase()
      : '';
    if (!token.includes('/') && !FILE_EXTENSIONS.has(extension)) continue;
    found.add(token);
    if (found.size >= MAX_PATHS) break;
  }
  return [...found];
}

function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function matches(patterns: readonly RegExp[], body: string): boolean {
  return patterns.some((pattern) => pattern.test(body));
}

interface ClauseReading {
  readonly paths: readonly string[];
  readonly instruction: boolean;
  readonly explanation: boolean;
}

/** Classifies one clause: instruction, explanation, or neither. */
function readClause(clause: string): ClauseReading {
  const paths = pathsIn(clause);
  if (matches(QUESTION_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(NEGATION_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(HYPOTHETICAL_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  const leadsExplanation =
    EXPLANATION_LEAD_PATTERN.test(clause) || EXPLANATION_LEAD_EN_PATTERN.test(clause);
  const modifies = MODIFICATION_PATTERN.test(clause) || MODIFICATION_EN_PATTERN.test(clause);
  if (leadsExplanation) {
    // The leading verb decides: "describe the fix needed in X" is an explanation even
    // though it contains the word "fix".
    return { paths, instruction: false, explanation: true };
  }
  if (modifies && paths.length > 0) {
    return { paths, instruction: true, explanation: false };
  }
  // A change without a target (ask before writing) or a mention without a verb.
  return { paths, instruction: false, explanation: modifies || paths.length > 0 };
}

/**
 * Routes one message body into work items.
 */
export function routeMessage(body: string): MessageRouting {
  const text = body.trim();
  const clauses = splitClauses(text);
  const instructionPaths: string[] = [];
  let explanation = false;

  for (const clause of clauses) {
    const reading = readClause(clause);
    if (reading.instruction) {
      instructionPaths.push(...reading.paths);
      continue;
    }
    if (reading.explanation) explanation = true;
  }

  const items: MessageWorkItem[] = [];
  const paths = [...new Set(instructionPaths)];
  if (paths.length > 0) {
    items.push({
      intent: 'delivery',
      goal: text.slice(0, 2_000),
      // Reading the target is part of changing it: an authorization with `readPaths`
      // but no read operation would fail the Core's own capability check.
      scope: { ...emptyScope(), readPaths: paths, writePaths: paths, operations: ['read', 'edit'] },
      writePaths: paths,
    });
  }
  if (explanation || items.length === 0) {
    const mentioned = pathsIn(text);
    const asksForDocument = matches(DOCUMENT_PATTERNS, text);
    items.push({
      intent: items.length === 0 && asksForDocument ? 'document' : 'assist',
      goal: text.slice(0, 2_000),
      scope: {
        ...emptyScope(),
        readPaths: mentioned.length > 0 ? [...new Set(mentioned)] : ['docs'],
      },
      writePaths: [],
    });
  }

  const trimmed = items.slice(0, MAX_WORK_ITEMS);
  const explicit = trimmed.some((item) => item.writePaths.length > 0);
  const reason = explicit
    ? trimmed.length > 1
      ? 'mixed message: one explanation Work and one authorized modification Work'
      : 'explicit instruction with a target: the message authorizes its own scope'
    : 'question, explanation or refusal: read-only route, nothing granted';
  return { items: trimmed, explicitAuthorization: explicit, reason };
}
