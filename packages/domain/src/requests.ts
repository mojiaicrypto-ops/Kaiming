/**
 * Chief routing for a user message (`workflow.md` §1, AC-005/AC-006).
 *
 * The Chief is an agent, so its assessment is normally produced by a model
 * (WP-04/WP-06). This module is the deterministic baseline the Core applies before
 * that model exists: it detects the *structural* facts of a message — does it ask for
 * an explanation, does it name a concrete modification target, does it do both — and
 * turns them into work items with independent scopes.
 *
 * It never decides product semantics and never invents a requirement: an explicit
 * target is the message's own scope authorization (AC-005), and a mixed message is
 * split into one Work per intent so the explanation can finish first (AC-006).
 */
import { emptyScope, type Intent, type Scope } from '@agentdev/contracts';

/** One Work the message asks for. */
export interface MessageWorkItem {
  readonly intent: Extract<Intent, 'assist' | 'artifact' | 'document' | 'delivery'>;
  readonly goal: string;
  readonly scope: Scope;
  /**
   * Paths the message explicitly named and may modify.
   *
   * Non-empty only for a modification intent: it becomes the Authorization envelope
   * the message itself grants.
   */
  readonly writePaths: readonly string[];
}

export interface MessageRouting {
  readonly items: readonly MessageWorkItem[];
  /** True when the message names a modification target (an execution message). */
  readonly explicitAuthorization: boolean;
  /** Why the routing decided this, for the Assessment reason. */
  readonly reason: string;
}

const EXPLANATION_PATTERNS: readonly RegExp[] = [
  /解释|说明|为什么|为何|怎么|如何|介绍|讲讲|梳理/iu,
  /\bexplain\b|\bdescribe\b|\bwhy\b|\bhow\b|\bwhat\b|\bsummar/iu,
];

const MODIFICATION_PATTERNS: readonly RegExp[] = [
  /修复|修正|更正|改掉|改成|修改|实现|新增|添加|删除|移除|更新|补充|重命名|重构/iu,
  /\bfix\b|\bimplement\b|\bupdate\b|\badd\b|\bremove\b|\bdelete\b|\brefactor\b|\brename\b/iu,
];

/**
 * Markers of a question.
 *
 * `workflow.md` §1 only lets an *execution* message authorize its target; "how do I
 * fix X?" names a path but asks for an explanation, so it must never create a write
 * authorization (W3R3 review).
 */
const QUESTION_PATTERNS: readonly RegExp[] = [
  /[?？]\s*$/u,
  /^(如何|怎么|怎样|为什么|为何|能否|是否可以|可不可以|要不要|是不是|有没有)/u,
  /^(how|why|what|when|where|which|can|could|should|would|is|are|does|do)\b/iu,
  /(请问|帮我看看|能不能|可以吗)/u,
  // An explanation is not an instruction, even when it names a concrete target
  // ("explain why docs/INDEX.md needs a fix", W3R4 review).
  /^(请?\s*(解释|说明|描述|介绍|讲讲|梳理|分析))/u,
  /^\s*(please\s+)?(explain|describe|summari[sz]e|walk me through|tell me)\b/iu,
  /(解释一下|说明一下|是怎么回事|有什么问题)/u,
];

/**
 * Markers that explicitly refuse a change ("don't fix X", "不要修改 X").
 *
 * A refusal is the opposite of an execution instruction; the router must not turn it
 * into a write authorization (W3R4 review).
 */
const NEGATION_PATTERNS: readonly RegExp[] = [
  /(不要|别|无需|不用|不需要|先别|暂不|不是要你|没有让你|并没有要求)/u,
  /\b(do not|don't|dont|never|no need to|not asking|not asking you to|without changing)\b/iu,
];

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

/** One whitespace/punctuation separated token. */
const TOKEN_PATTERN = /[^\s,;:()"'`[\]{}<>，。；：（）【】]+/gu;

/** A conservative path shape; anchored and free of nested quantifiers. */
const PATH_TOKEN_PATTERN = /^[\w.@-]+(?:\/[\w.@-]+)*$/u;

const MAX_TOKEN_LENGTH = 512;

/**
 * Paths a message names.
 *
 * The scan is linear (tokens, then an anchored shape test) so a 64 000-character body
 * cannot make routing quadratic; a token counts as a path only when it has a
 * separator or a known file extension.
 */
function pathsIn(body: string): string[] {
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
    const looksLikePath = token.includes('/') || FILE_EXTENSIONS.has(extension);
    if (!looksLikePath) continue;
    found.add(token);
    if (found.size >= 32) break;
  }
  return [...found];
}

const MAX_WORK_ITEMS = 4;

function matches(patterns: readonly RegExp[], body: string): boolean {
  return patterns.some((pattern) => pattern.test(body));
}

/** Clause boundaries: sentences, list separators and coordinating conjunctions. */
function splitClauses(text: string): string[] {
  return text
    .split(/(?:[;；。!！\n]+)|(?:[，,]\s*(?:and|then|然后|并且|同时)?\s*)|(?:\s+(?:and|then)\s+)/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Routes one message body into work items.
 *
 * - a pure question/explanation → one `assist` Work with a read-only scope;
 * - an explicit modification with a target → one `delivery` Work whose scope is the
 *   named target (the message is the authorization source);
 * - both at once → two Works with independent scopes, the explanation first.
 */
export function routeMessage(body: string): MessageRouting {
  const text = body.trim();
  const clauses = splitClauses(text);
  const asksForDocument = matches(DOCUMENT_PATTERNS, text);

  // Each clause is classified on its own, so a mixed message keeps its explanation and
  // its instruction apart (AC-006) while an explanation clause never authorizes a
  // change just because the message mentions a path (AC-005, W3R4 review).
  const instructionPaths: string[] = [];
  let explanation = false;
  for (const clause of clauses) {
    const clausePaths = pathsIn(clause);
    const clauseExplains = matches(EXPLANATION_PATTERNS, clause);
    const clauseQuestion = matches(QUESTION_PATTERNS, clause);
    const clauseNegated = matches(NEGATION_PATTERNS, clause);
    const clauseModifies = matches(MODIFICATION_PATTERNS, clause);
    if (clauseExplains || clauseQuestion) {
      explanation = true;
      continue;
    }
    if (clauseNegated) {
      explanation = true;
      continue;
    }
    if (clauseModifies) {
      if (clausePaths.length === 0) {
        // A modification request with no named target cannot be authorized; the Chief
        // asks for the target instead of guessing a write scope.
        explanation = true;
        continue;
      }
      instructionPaths.push(...clausePaths);
      continue;
    }
    if (clausePaths.length > 0) explanation = true;
  }

  const items: MessageWorkItem[] = [];
  const paths = [...new Set(instructionPaths)];
  if (paths.length > 0) {
    items.push({
      intent: 'delivery',
      goal: text.slice(0, 2_000),
      // Reading the target is part of changing it, so both capabilities are declared:
      // an authorization with `readPaths` but no read operation is self-contradictory
      // and would fail the Core's capability check (W3R3-01).
      scope: {
        ...emptyScope(),
        readPaths: paths,
        writePaths: paths,
        operations: ['read', 'edit'],
      },
      writePaths: paths,
    });
  }
  if (explanation || items.length === 0) {
    const mentionPaths = pathsIn(text);
    items.push({
      intent: items.length === 0 && asksForDocument ? 'document' : 'assist',
      goal: text.slice(0, 2_000),
      scope: {
        ...emptyScope(),
        readPaths: mentionPaths.length > 0 ? [...new Set(mentionPaths)] : ['docs'],
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
  return {
    items: trimmed,
    explicitAuthorization: explicit,
    reason,
  };
}
