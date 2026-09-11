/**
 * Chief routing for a user message (`workflow.md` §1, AC-005/AC-006).
 *
 * The Chief is an agent, so its assessment is normally produced by a model
 * (WP-04/WP-06). This module is the deterministic baseline the Core applies before
 * that model exists.
 *
 * The safety rule is one-directional and absolute: **only an imperative clause that
 * names a change verb and a target authorizes that target.** Everything else —
 * questions, explanations, advice, statements, refusals, hypotheticals, quotations and
 * any phrasing whose intent is unclear — is read-only, and the Chief asks for
 * clarification instead of guessing a write scope. A refused write is a slower answer;
 * a wrongly granted write is a security failure.
 *
 * Recorded residual risk: natural-language intent cannot be classified completely by
 * rules. A phrasing outside the registered vocabulary may be read as read-only
 * (fail-closed). The model-driven Assessment in WP-04/WP-06 replaces this baseline;
 * WP-03 owns the documented scenarios and the registered regression corpora, not every
 * possible sentence.
 */
import { emptyScope, type Intent, type Scope } from '@agentdev/contracts';

/** One Work the message asks for. */
export interface MessageWorkItem {
  readonly intent: Extract<Intent, 'assist' | 'artifact' | 'document' | 'delivery'>;
  readonly goal: string;
  readonly scope: Scope;
  /** Paths this clause instructed to modify (already exclusion-filtered). */
  readonly writePaths: readonly string[];
}

export interface MessageRouting {
  readonly items: readonly MessageWorkItem[];
  /** True when at least one clause is an instruction with a named target. */
  readonly explicitAuthorization: boolean;
  /** Why the routing decided this, for the Assessment reason. */
  readonly reason: string;
}

/** Verbs that request reading or advice: they never authorize a change by themselves. */
const READ_ONLY_VERBS =
  /(看一下|看看|查看|查阅|检查|评估|总结|阅读|参考|确认|列出|罗列|建议|咨询|征求意见|方案|意见|解释|说明|介绍|描述|分析|梳理|讲讲)/u;

const READ_ONLY_VERBS_EN =
  /\b(look at|check|review|assess|summari[sz]e|read|confirm|list|suggest|advice|advise|explain|describe|tell me|show me)\b/iu;

/** Verbs that ask for an explanation; only leading in a clause do they count. */
const EXPLANATION_LEAD_PATTERN =
  /^(?:请|帮我|麻烦|请帮我)?\s*(?:解释|说明|介绍|描述|讲讲|梳理|分析)/u;

const EXPLANATION_LEAD_EN_PATTERN =
  /^(?:please\s+)?(?:explain|describe|summari[sz]e|analy[sz]e|walk me through|tell me|show me)\b/iu;

/** Words that make a clause a question wherever they appear. */
const QUESTION_PATTERNS: readonly RegExp[] = [
  /[?？]/u,
  /(吗|呢|么|如何|怎么|怎样|为什么|为何|能否|是否可以|可不可以|要不要|是不是|有没有|请问|能不能|可以吗|是否已经|是否应该|是否需要|谁|哪些|几点|了没有|改了没|改过没|何必|何以|何苦)/u,
  /\b(how|why|what|when|where|which|who|can|could|should|would|is|are|am|does|do|did|have you|has it)\b/iu,
  /(question|not sure|wondering|curious)/iu,
];

/**
 * Refusals.
 *
 * `别` only counts when it negates an action and starts a word, so 错别字 / 识别 /
 * 特别 / 分别 stay instructions (W3R5-02).
 */
const NEGATION_PATTERNS: readonly RegExp[] = [
  /(不要|不用|不需要|无需|先不|暂不|不必|不想|不愿|请勿|切勿|禁止|严禁|不许|不准|暂缓|延后|推迟|(?<![\p{Script=Han}\w])别)\s*(?:再|去|来|急着|着急|忙|先)?\s*(?:改|修改|动|碰|删|移除|更新|添加|新增|实现|修复|重命名|重构|调整|处理|补)/u,
  /(不是要你|没有让你|并没有要求|先说不要|不用管)/u,
  /\b(do not|don't|dont|never|no need to|without changing|not asking|not asking you to)\b/iu,
];

/**
 * Statements and status questions.
 *
 * Chinese has no word boundaries, so the completion-aspect patterns must not use `\b`
 * (W3R7-02). "我已经修改了 X", "X 需要修改" and "The fix needed in X" report a state;
 * they are not instructions.
 */
const STATEMENT_PATTERNS: readonly RegExp[] = [
  /(?:已经|已|刚才|刚刚)[^，。；！？]{0,24}(?:修改|修复|更新|改|实现|添加|删除|移除|重命名|重构|调整|处理|补|优化|完善|纠正|替换|整理|清理|修|改好|完成)/u,
  /(?:修改|修复|更新|改|实现|添加|删除|移除|重命名|重构|调整|处理|优化|完善|纠正|替换|整理|清理|修|补)(?:了|完了|完毕|好了)(?:[，。；！？\s]|$)/u,
  /(?:修复|更新|修改|改|实现|添加|删除|移除|重命名|重构|调整|处理|优化|完善|纠正|替换|整理|清理|修|补)(?:完毕|完了|好了)/u,
  /(?:需要|应该|应当|必须|得|该|要)\s*(?:被)?\s*(?:修改|修复|更新|改|实现|添加|删除|移除|重命名|重构|调整|处理|优化|完善|纠正|替换|整理|清理|修|补)/u,
  /(?:有没有|是否)\s*(?:应该|需要|该|要)/u,
  /\b(already|have (?:already )?(?:fixed|changed|updated|added|removed|deleted)|i(?:'ve| have) (?:fixed|changed|updated)|needs? (?:to be )?(?:a )?(?:fix|change|update)|needs? (?:to be )?(?:fixed|changed|updated|removed|deleted)|the fix needed|should (?:we|i|it)|ought to)\b/iu,
];

/**
 * Advice and opinion requests (`workflow.md` §1: asking whether something could be
 * improved only produces a suggestion, never an authorization).
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  /(建议|咨询|征求意见|方案|意见|评估一下|怎么样|好不好|可行吗)/u,
  /\b(advice|suggest(?:ion)?s?|suggest|your opinion|recommend)\b/iu,
];

/**
 * Topic phrases and nominalised mentions ("关于 X 的修复", "the fix in X").
 *
 * Such a clause names a subject, not an action; the verb inside it belongs to a noun.
 */
const TOPIC_PATTERNS: readonly RegExp[] = [
  /^(?:关于|对于|针对|至于|就)/u,
  /^(?:regarding|about|as for|concerning|for)\b/iu,
  /(?:的修复|的修改|的改动|的修正|的更新|的方案|的建议|的问题|the fix (?:in|to)|the change (?:in|to)|the update (?:to|in))/iu,
];

/**
 * Preconditions ("修改 X 前需要审批", "先确认再改").
 *
 * A clause that gates the change behind an approval or a prior step is not itself the
 * command (W3R8 review).
 */
const PRECONDITION_PATTERNS: readonly RegExp[] = [
  /(?:前|之前)\s*(?:需要|需|必须|要|得|请|先)/u,
  /(?:需要|需|必须|待|等)\s*(?:先)?\s*(?:审批|批准|确认|授权|同意|复核)/u,
  /\b(?:before|prior to|pending approval|needs? approval)\b/iu,
];

/**
 * Choice questions ("修改 X 好还是不改好", "fix X or leave it alone"): the user is
 * weighing options, not issuing a command.
 */
const CHOICE_PATTERNS: readonly RegExp[] = [
  /(?:好还是|还是不改|还是不|或者不|要不要|是否要)/u,
  /\b(or leave|or not\b|or keep|yes or no|which (?:one|is better))\b/iu,
];

/** Hypotheticals and quotations are not instructions. */
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /(如果|假如|若是|要是|万一|假设)/u,
  /\b(if|whether|suppose|assuming|in case)\b/iu,
  /(你(刚才|之前)?说|你提到|引用|所说的)/u,
  /["“][^"”]{0,80}["”]/u,
];

/** Paths the clause explicitly excludes; they never enter the write scope. */
const EXCLUSION_MARKER_PATTERN =
  /(而不是|而非|不是|别改|不要改|不用改|无需改|instead of|rather than)/u;

const MODIFICATION_PATTERN =
  /(修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)/u;

const MODIFICATION_EN_PATTERN =
  /\b(fix|fixes|implement|update|updates|add|adds|remove|removes|delete|deletes|refactor|rename|change|changes|correct|corrects|edit|edits)\b/iu;

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

/**
 * Clause boundaries.
 *
 * A comma separates independent requests, which is what makes "别改 A，改 B" authorize
 * only B. `并` only splits when it introduces a fresh change verb, so 合并/并且 inside a
 * word cannot fork a clause by accident.
 */
const CLAUSE_SPLIT_PATTERN =
  /(?:[，,；;。!！\n]+)|(?:\s+(?:and|then)\s+)|(?:(?:并且|然后|同时|而且))|(?:并(?=\s*(?:请|麻烦|帮我)?\s*(?:修复|修正|修改|更新|删除|移除|添加|新增|实现|改|补|整理|清理|处理)))/iu;

/** Upper bound on the Works one message may create. */
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

/**
 * Write paths of one clause, minus the targets the clause excludes.
 *
 * "修改 docs/PLAN.md 而不是 docs/INDEX.md" authorizes the first path and never the
 * second (W3R7 A1); a clause that starts with a refusal authorizes nothing.
 */
function authorizedPaths(clause: string): string[] {
  if (matches(NEGATION_PATTERNS, clause)) return [];
  const exclusion = EXCLUSION_MARKER_PATTERN.exec(clause);
  if (exclusion === null) return pathsIn(clause);
  const before = clause.slice(0, exclusion.index);
  const after = clause.slice(exclusion.index + exclusion[0].length);
  const excluded = new Set(pathsIn(after));
  return pathsIn(before).filter((path) => !excluded.has(path));
}

/**
 * Imperative forms.
 *
 * A change is authorized only when the clause reads as a command: it opens with a
 * change verb (after an optional polite lead-in) or it ends with one in command form
 * ("X 的错别字麻烦处理下"). Everything else — statements, topical mentions, references,
 * questions — stays read-only, so a phrasing outside this grammar asks for
 * clarification instead of granting a write (W3R8 review).
 */
const POLITE_LEAD_PATTERN = /^(?:请|麻烦|帮我|帮忙|劳驾|please)\s*/iu;

/** Adverbs and conjunctions that may precede the verb of a command. */
const ADVERB_LEAD_PATTERN =
  /^(?:(?:但|但是|而是|不过|然后|再|同时|也|另外|并且|而且|就|先|特别|重点|主要|务必|一定|直接|立刻|马上|尽快|顺便|顺手)\s*)+(?:要|需要|请|麻烦|帮我|帮忙)?\s*/u;

const CHANGE_VERB_LEAD_PATTERN =
  /^(?:修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)/u;

const CHANGE_VERB_LEAD_EN_PATTERN =
  /^(?:fix|fixes|implement|update|updates|add|adds|remove|removes|delete|deletes|refactor|rename|change|changes|correct|corrects|edit|edits)\b/iu;

const CHANGE_VERB_TAIL_PATTERN =
  /(?:修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)(?:一下|下|吧|掉|好)?[。！!\s]*$/u;

/**
 * Markers that make a clause a statement or a passive/conditional description rather
 * than a command (`X 需要被修改`, `X 被更新了`, `X 可能修复`).
 */
const NON_COMMAND_MARKERS =
  /(被|需要|应该|应当|必须|会|值得|得到|已经|已|刚才|刚刚|了|过|可能|也许|大概|是否|如果|假如|若是|要是|万一|假设)/u;

/** True when the clause reads as an imperative command to change something. */
function isImperative(clause: string): boolean {
  const stripped = clause.replace(POLITE_LEAD_PATTERN, '').replace(ADVERB_LEAD_PATTERN, '');
  if (NON_COMMAND_MARKERS.test(stripped)) return false;
  // A command names one action: a bare list of verbs ("X 修复 更新 整理") is ambiguous
  // and asks for clarification instead of guessing which verb applies (W3R9 review).
  if (countChangeVerbs(stripped) !== 1) return false;
  if (CHANGE_VERB_LEAD_PATTERN.test(stripped)) return true;
  if (CHANGE_VERB_LEAD_EN_PATTERN.test(clause)) return true;
  return CHANGE_VERB_TAIL_PATTERN.test(stripped);
}

/** Number of change verbs in a clause, in either language. */
function countChangeVerbs(clause: string): number {
  const chinese = clause.match(
    /(修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)/gu,
  );
  const english = clause.match(
    /\b(fix|fixes|implement|update|updates|add|adds|remove|removes|delete|deletes|refactor|rename|change|changes|correct|corrects|edit|edits)\b/giu,
  );
  return (chinese?.length ?? 0) + (english?.length ?? 0);
}

interface ClauseReading {
  readonly paths: readonly string[];
  readonly instruction: boolean;
  readonly explanation: boolean;
}

/** Classifies one clause: instruction, explanation, or neither. */
function readClause(raw: string): ClauseReading {
  // Leading politeness and adverbs belong to the phrase, not to its meaning: "但要修复
  // X" is the command "修复 X" with a conjunction in front (W3R8 review).
  const clause = raw.replace(POLITE_LEAD_PATTERN, '').replace(ADVERB_LEAD_PATTERN, '');
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
  if (matches(STATEMENT_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(CHOICE_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(PRECONDITION_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(ADVICE_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  if (matches(TOPIC_PATTERNS, clause)) {
    return { paths, instruction: false, explanation: true };
  }
  const leadsExplanation =
    EXPLANATION_LEAD_PATTERN.test(clause) || EXPLANATION_LEAD_EN_PATTERN.test(clause);
  if (leadsExplanation) {
    // The leading verb decides: "describe the fix needed in X" asks for words.
    return { paths, instruction: false, explanation: true };
  }
  const modifies = MODIFICATION_PATTERN.test(clause) || MODIFICATION_EN_PATTERN.test(clause);
  const commandLead = CHANGE_VERB_LEAD_PATTERN.test(clause);
  if (!commandLead && (READ_ONLY_VERBS.test(clause) || READ_ONLY_VERBS_EN.test(clause))) {
    // A read/advice verb never authorizes, unless the clause itself opens with the
    // change verb ("更新 X 的说明"): the read-only word there is a noun.
    return { paths, instruction: false, explanation: true };
  }
  if (!isImperative(clause)) {
    // Not a command: a mention, a report or an unclear phrasing asks for words.
    return { paths, instruction: false, explanation: modifies || paths.length > 0 };
  }
  const writable = authorizedPaths(clause);
  if (writable.length > 0) {
    return { paths: writable, instruction: true, explanation: false };
  }
  // A command without an authorized target: ask which target before writing.
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

  let conditional = false;
  for (const clause of clauses) {
    const reading = readClause(clause);
    // The clause after a conditional inherits it: "如果要改，就修改 X" is a hypothesis,
    // not a command (W3R9 A2).
    const isConditional = matches(HYPOTHETICAL_PATTERNS, clause);
    if (reading.instruction && !conditional) {
      instructionPaths.push(...reading.paths);
    } else if (reading.instruction) {
      explanation = true;
    }
    if (reading.explanation) explanation = true;
    conditional = isConditional;
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
    : 'no imperative instruction with a target: read-only route, nothing granted';
  return { items: trimmed, explicitAuthorization: explicit, reason };
}
