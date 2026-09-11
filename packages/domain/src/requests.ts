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

const DOCUMENT_PATTERNS: readonly RegExp[] = [
  /文档|说明书|readme|设计文档/iu,
  /\bdocument(ation)?\b/iu,
];

/** Paths a message names: `a/b.md`, `packages/core/src/x.ts`, `` `path` ``. */
const PATH_PATTERN =
  /(?:^|[\s(`"'])((?:[\w.@-]+\/)+[\w.@-]+(?:\.[A-Za-z0-9]+)?|[\w.@-]+\.(?:md|ts|tsx|js|json|toml|yml|yaml|txt|html|css|py|rs|go))/gu;

const MAX_WORK_ITEMS = 4;

function pathsIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(PATH_PATTERN)) {
    const value = match[1];
    if (value === undefined) continue;
    // A trailing slash or a sentence-final period is punctuation, not a path.
    found.add(value.replace(/[.,;:]$/u, ''));
  }
  return [...found].slice(0, 32);
}

function matches(patterns: readonly RegExp[], body: string): boolean {
  return patterns.some((pattern) => pattern.test(body));
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(0, index);
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
  const paths = pathsIn(text);
  const asksForExplanation = matches(EXPLANATION_PATTERNS, text);
  const asksForChange = matches(MODIFICATION_PATTERNS, text);
  const asksForDocument = matches(DOCUMENT_PATTERNS, text);

  const items: MessageWorkItem[] = [];
  if (asksForChange && paths.length === 0) {
    // A modification request with no named target still needs a scope before it can
    // be executed; the Chief asks for it rather than guessing (no silent write scope).
    return {
      items: [
        {
          intent: 'assist',
          goal: 'clarify the modification target',
          scope: { ...emptyScope(), readPaths: ['docs'] },
          writePaths: [],
        },
      ],
      explicitAuthorization: false,
      reason: 'modification request without an explicit target: ask before writing',
    };
  }
  if (asksForChange && paths.length > 0) {
    const readPaths = [...new Set(paths.map(parentOf))];
    items.push({
      intent: 'delivery',
      goal: text.slice(0, 2_000),
      scope: { ...emptyScope(), readPaths, writePaths: paths, operations: ['edit'] },
      writePaths: paths,
    });
  }
  const explanationIntent: MessageWorkItem['intent'] = asksForDocument ? 'document' : 'assist';
  if (asksForExplanation || items.length === 0) {
    items.push({
      intent: items.length === 0 && asksForDocument ? 'document' : explanationIntent,
      goal: text.slice(0, 2_000),
      scope: { ...emptyScope(), readPaths: paths.length > 0 ? [...new Set(paths)] : ['docs'] },
      writePaths: [],
    });
  }
  const trimmed = items.slice(0, MAX_WORK_ITEMS);
  const explicit = trimmed.some((item) => item.writePaths.length > 0);
  const reason = explicit
    ? trimmed.length > 1
      ? 'mixed message: one explanation Work and one authorized modification Work'
      : 'explicit target: the message authorizes its own scope'
    : 'question or explanation: read-only assist route';
  return { items: trimmed, explicitAuthorization: explicit, reason };
}
