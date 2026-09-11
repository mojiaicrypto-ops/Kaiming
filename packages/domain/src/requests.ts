/**
 * Chief routing for a user message (`workflow.md` §1, AC-005/AC-006).
 *
 * The Chief is an agent, so its assessment is normally produced by a model
 * (WP-04/WP-06). This module is the deterministic baseline the Core applies before that
 * model exists, and it is deliberately **sound rather than fluent**:
 *
 * - a change is authorized **only** when the clause is exactly a command — a change verb
 *   plus one named target, or a 把/将/对 disposal command of the same shape;
 * - everything else (statements, questions, choices, conditions, references, richer
 *   phrasing) is read-only, and the Chief asks for the action to be phrased as a
 *   command.
 *
 * A wrongly granted write is a security failure; a clarification round is not. The
 * residual cost is registered in `plan.md` planVersion 2 and in the WP-03 records: real
 * natural-language understanding belongs to the model-driven assessment, not to this
 * grammar.
 */
import { emptyScope, type Intent, type Scope } from '@agentdev/contracts';

/** One Work the message asks for. */
export interface MessageWorkItem {
  readonly intent: Extract<Intent, 'assist' | 'artifact' | 'document' | 'delivery'>;
  readonly goal: string;
  readonly scope: Scope;
  /** The targets this clause was authorized to modify (never a mere mention). */
  readonly writePaths: readonly string[];
}

export interface MessageRouting {
  readonly items: readonly MessageWorkItem[];
  /** True when at least one clause is a command with a named target. */
  readonly explicitAuthorization: boolean;
  /** Why the routing decided this, for the Assessment reason. */
  readonly reason: string;
}

/** Upper bound on the Works one message may create. */
export const MAX_WORK_ITEMS = 4;

const MAX_TOKEN_LENGTH = 512;
const MAX_PATHS = 32;

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

/** A repository path inside a clause, as a regular-expression source. */
const PATH_TOKEN = '[\\w.@-]+(?:/[\\w.@-]+)*';

/** Paths a message names; linear in the body length. */
export function pathsIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    if (raw.length > MAX_TOKEN_LENGTH) continue;
    const token = raw.replace(/[.,;:]+$/u, '');
    if (token.length === 0 || token.includes('://')) continue;
    // A target must stay inside the repository: `..`, a leading `/` or `~` is refused at
    // routing time so the request fails as a validation error instead of a storage
    // failure deep in the transaction (W3R15 adversarial 5).
    if (token.startsWith('/') || token.startsWith('~') || token.split('/').includes('..')) {
      continue;
    }
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

// --- guards -------------------------------------------------------------------------

/** Words that make a clause a question wherever they appear. */
const QUESTION_PATTERNS: readonly RegExp[] = [
  /[?？]/u,
  /(吗|呢|么|如何|怎么|怎样|为什么|为何|能否|是否可以|可不可以|要不要|是不是|有没有|请问|能不能|可以吗|是否已经|是否应该|是否需要|谁|哪些|几点|了没有|改了没|改过没|何必|何以|何苦|与否|哪个|哪一个|更好|抑或|要不然)/u,
  /\b(how|why|what|when|where|which|who|can|could|should|would|is|are|am|does|do|did|have you|has it)\b/iu,
  /(question|not sure|wondering|curious)/iu,
];

/**
 * The refusal vocabulary, shared by the two patterns below.
 *
 * Both patterns are built from this one string, so the "is this a refusal?" and "does this
 * clause head a refusal?" judgements can never disagree about which verbs count (W3R19-01).
 */
const REFUSAL_ADVERBS = '(?:再|去|来|赶紧|尽快|立刻|马上|立即|直接|急着|着急|忙|先)?';
const REFUSAL_CHANGE_VERBS =
  '(?:改掉|改成|改为|改|修改|改进|更改|修复|修正|更正|动|碰|删|删除|移除|更新|添加|新增|实现|补充|重写|优化|完善|纠正|替换|换成|处理|整理|清理|重命名|重构|调整|修|补)';
const REFUSAL_VERBS_EN =
  '(?:change|modify|update|delete|remove|add|implement|fix|repair|rename|refactor|adjust|clean|tidy|replace|rewrite|optimi[sz]e|polish|improve|correct|edit)';

/**
 * A refusal *heads* the clause.
 *
 * A clause that merely quotes or reports a negation ("报告说不要修改 Y") is not the user
 * refusing anything, so a clause only counts as a refusal when a refusal marker opens it
 * (after an optional politeness prefix) and is itself followed by a change verb. The verb
 * requirement is what keeps `别人说不要修改 Y` out: there `别` is part of the noun
 * `别人`, not a refusal (W3R17-01).
 */
const REFUSAL_HEAD_PATTERN = new RegExp(
  `^(?:(?:请|麻烦|帮我|帮忙|劳驾|please|kindly)\\s*)?(?:先)?` +
    `(?:不要|不用|不需要|无需|先不|暂不|先别|不必|不想|不愿|请勿|切勿|禁止|严禁|不许|不准|暂缓|延后|推迟|不|别|do not|don't|dont|never|no need to|without changing|not asking)` +
    `\\s*${REFUSAL_ADVERBS}\\s*(?:${REFUSAL_CHANGE_VERBS}|${REFUSAL_VERBS_EN})`,
  'iu',
);

/** Refusals; `别` only counts word-initially (`错别字`/`识别`/`特别`/`分别` stay intact). */
const NEGATION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `(?:不要|不用|不需要|无需|先不|暂不|先别|不必|不想|不愿|请勿|切勿|禁止|严禁|不许|不准|暂缓|延后|推迟|不|(?<![\\p{Script=Han}\\w])别)` +
      `\\s*${REFUSAL_ADVERBS}\\s*${REFUSAL_CHANGE_VERBS}`,
    'u',
  ),
  /(不是要你|没有让你|并没有要求|先说不要|不用管)/u,
  /\b(do not|don't|dont|never|no need to|without changing|not asking|not asking you to)\b/iu,
];

/**
 * Is this clause nothing but one explanation request about one named path?
 *
 * The explanation lead is stripped and what remains must be a single path token. A clause
 * that mentions a path and *also* carries anything else — a negation with any wording, a
 * change verb with any wording, a topic phrase — is a statement about that path, not a
 * request for words, so it must not license a later command (W3R18-01, W3R19-01).
 *
 * This is a shape test rather than a vocabulary test: an unregistered negation
 * (`说明莫碰 Y`) or an unregistered verb fails it by construction, because the residual is
 * not a path. A clause with no path at all carries nothing to launder and stays benign.
 */
function isPureExplanationOfPath(clause: string, lead: RegExp): boolean {
  const residual = clause
    .trim()
    .replace(lead, '')
    .trim()
    .replace(/[。！!?？\s]+$/u, '');
  return PATH_TOKEN_PATTERN.test(residual);
}

/**
 * Statements and status reports.
 *
 * Chinese has no word boundaries, so completion aspect is matched without `\b`
 * (W3R7-02): "我已经修改了 X", "X 需要被更新" and "The fix needed in X" are states, not
 * commands.
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
 * improved produces a suggestion, never an authorization).
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  /(建议|咨询|征求意见|方案|意见|评估一下|怎么样|好不好|可行吗)/u,
  /\b(advice|suggest(?:ion)?s?|suggest|your opinion|recommend)\b/iu,
];

/** Topic phrases and nominalised mentions ("关于 X 的修复", "the fix in X"). */
const TOPIC_PATTERNS: readonly RegExp[] = [
  /^(?:关于|对于|针对|至于|就)/u,
  /^(?:regarding|about|as for|concerning|for)\b/iu,
  /(?:的修复|的修改|的改动|的修正|的更新|的方案|的建议|的问题|the fix (?:in|to)|the change (?:in|to)|the update (?:to|in))/iu,
];

/** Preconditions ("修改 X 前需要审批"): a gate is not itself the command. */
const PRECONDITION_PATTERNS: readonly RegExp[] = [
  /(?:前|之前)\s*(?:需要|需|必须|要|得|请|先)/u,
  /(?:需要|需|必须|待|等)\s*(?:先)?\s*(?:审批|批准|确认|授权|同意|复核)/u,
  /\b(?:before|prior to|pending approval|needs? approval)\b/iu,
];

/** Choice questions ("修改 X 好还是不改好", "fix X or leave it alone"). */
const CHOICE_PATTERNS: readonly RegExp[] = [
  /(?:好还是|还是不改|还是不|或者不|要不要|是否要|妥否|妥不妥|可行不可行|有无必要)/u,
  /\b(or leave|or not\b|or keep|yes or no|versus|vs\.?|which (?:one|is better))\b/iu,
];

/**
 * Evaluative comments ("修改 X，不太明智", "X 属于越权").
 *
 * A clause that judges rather than requests is not an instruction.
 */
const COMMENT_PATTERNS: readonly RegExp[] = [
  /(明智|愚蠢|必要|必需|合适|不妥|正确|错误|值得|重要|不错|很好|可以|行不通|越权|属于|由.{0,6}决定|不太|有点)/u,
  /\b(seems?|looks?|probably|maybe|might be|is (?:not )?(?:right|wrong|wise|needed|necessary)|i think|it seems|in my opinion)\b/iu,
];

/** Clauses that are only politeness ("谢谢", "thanks") carry no request. */
const POLITE_TAIL_PATTERN = /^(?:谢谢|多谢|感谢|thanks|thank you|thx|麻烦了|拜谢)[。！!\s]*$/iu;

/**
 * Conditions that gate a command (`视具体情况`, `不用改 X 的话`, `depending on the
 * result`). A conditional clause anywhere makes the message a discussion, even when the
 * clause happens to contain a negation or an explanation verb (W3R16 review).
 */
const CONDITION_PATTERNS: readonly RegExp[] = [
  /(一旦|的话|之后|以后|确认后|经确认|经批准|批准后|否则|待你|等你|等消息|看情况|看结果|酌情|发现问题|如有问题|视情况|视具体|先讨论|先确认|先跟你确认|收到回复|收到消息|按你|随你|由你|取决于)/u,
  /\b(once|after|before|depending|pending|upon approval|subject to|as long as|if needed)\b/iu,
];

/** Hypotheticals and quotations are not instructions. */
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /(如果|假如|若是|要是|万一|假设)/u,
  /\b(if|whether|suppose|assuming|in case)\b/iu,
  /(你(刚才|之前)?说|你提到|引用|所说的)/u,
  /["“][^"”]{0,80}["”]/u,
];

/**
 * Markers of a statement, a question or a condition inside an otherwise command-shaped
 * clause (`修改 X 是必要的`, `修改 X 尚未完成`).
 *
 * This is a guard, not the decision: `commandTarget` below additionally requires the
 * clause to be *exactly* a command, so an unlisted marker can only cause clarification.
 */
const NON_COMMAND_MARKERS =
  /(被|需要|应该|应当|必须|会|值得|得到|已经|已|刚才|刚刚|了|过|可能|也许|大概|是否|如果|假如|若是|要是|万一|假设|还是|或者|行不行|该不该|对不对|也行|好不好|要不要|一旦|的话|之后|以后|确认后|经确认|完毕|与否|哪个|哪一个|更好|抑或|要不然|也可以|是必要|尚未|还没|没有完成|未完成|更合适|的理由|划算|好在哪里|不是我的意思|是明智|由我负责|看起来|很重要|有问题|vs\.?|\bor\b|\byes\b|\bno\b|\bunless\b|\bwhether\b|\bmaybe\b|\bperhaps\b|\bpossibly\b|\bdepends\b|或|以及|还有|不仅|重写|改写|而不是|而非|instead of|rather than)/iu;

// --- the command grammar ------------------------------------------------------------

const VERB_GROUP =
  '(?:修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)';

const VERB_GROUP_EN =
  '(?:fix|implement|update|add|remove|delete|refactor|rename|change|correct|edit)';

const POLITE = '(?:请|麻烦|帮我|帮忙|劳驾|kindly)?\\s*';
const PARTICLE = '(?:一下|下|掉|为|成|好)?';
/**
 * The only shapes that authorize a change.
 *
 * 1. `变更动词(+粒子) 目标` — the whole clause is just the verb and one target.
 * 2. `把/将/对 目标 变更动词(+粒子)` — an equally short disposal command.
 *
 * A statement ("X 尚未修改"), a choice ("修改 X 或重写"), a condition ("经批准，修改 X") or
 * a reference ("修改 Y 参考 X") cannot match, because extra words and extra targets are
 * rejected. That is what makes this rule sound instead of another keyword list.
 */
const LEAD_COMMAND_PATTERN = new RegExp(
  `^${POLITE}${VERB_GROUP}${PARTICLE}\\s*(${PATH_TOKEN})[。！!\\s]*$`,
  'u',
);

const LEAD_COMMAND_EN_PATTERN = new RegExp(
  `^${POLITE}${VERB_GROUP_EN}\\s+(${PATH_TOKEN})[。！!\\s]*$`,
  'iu',
);

const DISPOSAL_COMMAND_PATTERN = new RegExp(
  `^${POLITE}(?:把|将|对)\\s*(${PATH_TOKEN})\\s*${VERB_GROUP}${PARTICLE}[。！!\\s]*$`,
  'u',
);

const POLITE_LEAD_PATTERN = /^(?:请|麻烦|帮我|帮忙|劳驾|kindly|please)\s*/iu;

/** Adverbs and conjunctions that may precede the verb of a command. */
const ADVERB_LEAD_PATTERN =
  /^(?:(?:但是|而是|不过|但|然后|再|同时|也|则|另外|并且|而且|就|先|特别|重点|主要|务必|一定|直接|立刻|马上|尽快|顺便|顺手)\s*)+/u;

/** Number of change verbs in a clause, in either language. */
function countChangeVerbs(clause: string): number {
  const chinese = clause.match(new RegExp(VERB_GROUP, 'gu'));
  const english = clause.match(new RegExp(`\\b${VERB_GROUP_EN}\\b`, 'giu'));
  return (chinese?.length ?? 0) + (english?.length ?? 0);
}

/**
 * The single target this clause commands, or `undefined` when it is not a command.
 *
 * A command may carry one short tail ("修改 X 中的错别字", "fix the typo in X"), but the
 * tail may not name another path or contain a statement marker; otherwise the clause is
 * asking about something instead of ordering a change.
 */
/**
 * The clause with its politeness and adverb prefixes removed.
 *
 * `要` after an adversative conjunction is a correction ("但要修复 X"); anywhere else it
 * is a modal that keeps the clause a statement (`另外要更新 X`).
 */
function normalizeCore(clause: string): string {
  return clause.replace(POLITE_LEAD_PATTERN, '').replace(ADVERB_LEAD_PATTERN, '');
}

/** The single target this clause commands, or `undefined` when it is not a command. */
function commandTarget(clause: string): string | undefined {
  const core = normalizeCore(clause);
  if (NON_COMMAND_MARKERS.test(core)) return undefined;
  if (countChangeVerbs(core) !== 1) return undefined;
  const candidates: readonly RegExp[] = [
    LEAD_COMMAND_PATTERN,
    DISPOSAL_COMMAND_PATTERN,
    LEAD_COMMAND_EN_PATTERN,
  ];
  for (const pattern of candidates) {
    const match = pattern.exec(core);
    const target = match?.[1];
    if (target === undefined) continue;
    // The captured token must be exactly one of the paths the message names, so no
    // trailing punctuation can mint an alias the user never wrote (W3R13 review).
    if (!pathsIn(core).includes(target)) continue;
    return target;
  }
  return undefined;
}

// --- clause resolution --------------------------------------------------------------

const EXPLANATION_LEAD_PATTERN =
  /^(?:请|帮我|麻烦|请帮我)?\s*(?:先|优先)?\s*(?:解释|说明|介绍|描述|讲讲|梳理|分析)/u;

const EXPLANATION_LEAD_EN_PATTERN =
  /^(?:please\s+)?(?:explain|describe|summari[sz]e|analy[sz]e|walk me through|tell me|show me)\b/iu;

const MODIFICATION_PATTERN =
  /(修复|修正|更正|改掉|改成|改为|修改|改进|更改|改|实现|新增|添加|删除|移除|更新|补充|重命名|重构|调整|优化|完善|纠正|替换|换成|处理|整理|清理|修|补)/u;

const DOCUMENT_PATTERNS: readonly RegExp[] = [
  /文档|说明书|readme|设计文档/iu,
  /\bdocument(ation)?\b/iu,
];

/**
 * Clause boundaries: sentences and coordinating conjunctions, plus `并` when it
 * introduces a fresh change verb.
 */
const CLAUSE_SPLIT_PATTERN =
  /([，,；;。!！\n]+|\s+(?:and|then)\s+|并且|然后|同时|而且|并(?=\s*(?:请|麻烦|帮我)?\s*(?:修复|修正|修改|更新|删除|移除|添加|新增|实现|改|补|整理|清理|处理)))/iu;

const CONJUNCTION_SPLIT_PATTERN = /^(?:and|then|并且|然后|同时|而且|并)$/iu;

interface Clause {
  readonly text: string;
  /** True when this clause was introduced by a coordinating conjunction. */
  readonly conjunction: boolean;
}

/**
 * Splits a message into clauses and remembers whether a conjunction introduced each
 * one, because only a conjunction may carry a command into a following clause.
 */
function splitClauses(text: string): Clause[] {
  // With a capturing separator, `split` alternates text and separator: even indices are
  // clause texts, odd indices are the separators that introduced the next clause.
  const parts = text.split(CLAUSE_SPLIT_PATTERN);
  const clauses: Clause[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const trimmed = (parts[index] ?? '').trim();
    if (trimmed.length === 0) continue;
    const separator = index === 0 ? undefined : parts[index - 1];
    clauses.push({
      text: trimmed,
      conjunction: separator !== undefined && CONJUNCTION_SPLIT_PATTERN.test(separator.trim()),
    });
  }
  return clauses;
}

function matches(patterns: readonly RegExp[], body: string): boolean {
  return patterns.some((pattern) => pattern.test(body));
}

interface ClauseReading {
  /** The authorized target, when this clause is a command. */
  readonly target: string | undefined;
  readonly explanation: boolean;
}

/** Classifies one clause: an authorized command, an explanation, or neither. */
function readClause(raw: string): ClauseReading {
  const clause = raw.trim();
  if (clause.length === 0) return { target: undefined, explanation: false };
  const core = normalizeCore(clause);
  if (matches(QUESTION_PATTERNS, clause)) return { target: undefined, explanation: true };
  if (matches(NEGATION_PATTERNS, clause)) return { target: undefined, explanation: true };
  if (matches(HYPOTHETICAL_PATTERNS, clause)) return { target: undefined, explanation: true };
  if (matches(CHOICE_PATTERNS, clause)) return { target: undefined, explanation: true };
  // Statement/advice/topic/precondition markers are judged on the normalized core, so
  // "但要修复 X" is a command while "X 需要修改" stays a statement.
  if (matches(STATEMENT_PATTERNS, core)) return { target: undefined, explanation: true };
  if (matches(PRECONDITION_PATTERNS, core)) return { target: undefined, explanation: true };
  if (matches(ADVICE_PATTERNS, core)) return { target: undefined, explanation: true };
  if (matches(COMMENT_PATTERNS, core)) return { target: undefined, explanation: true };
  if (matches(TOPIC_PATTERNS, core)) return { target: undefined, explanation: true };
  if (EXPLANATION_LEAD_PATTERN.test(clause) || EXPLANATION_LEAD_EN_PATTERN.test(clause)) {
    // The leading verb decides: "describe the fix needed in X" asks for words.
    return { target: undefined, explanation: true };
  }
  const target = commandTarget(clause);
  if (target !== undefined) return { target, explanation: false };
  const modifies = MODIFICATION_PATTERN.test(clause);
  return { target: undefined, explanation: modifies || pathsIn(clause).length > 0 };
}

/** Routes one message body into work items. */
export function routeMessage(body: string): MessageRouting {
  const text = body.trim();
  const clauses = splitClauses(text);

  // A message that asks, weighs options, asks for advice, states a condition or makes a
  // judgement *anywhere* is not an order: no clause may authorize. Conditions count on
  // both sides — "如果没问题，修改 X" and "修改 X，如果没问题" are the same request
  // (W3R13/W3R14 review).
  // Every clause must be one of: a command, a refusal, politeness, or an explicit
  // explanation request. Anything else — a statement, a condition, a fragment, an
  // opinion — makes the message a conversation rather than an order, so no clause may
  // authorize (`视具体情况，然后修改 X`, `修改 X，视具体情况`). This is structural: an
  // unregistered wording cannot open a hole, it can only ask for clarification.
  const additiveLead = /^(?:也|再|就|则|另外|同时|并且|而且|然后|顺便|顺手)/u;
  const readings = clauses.map((clause, index) => {
    const reading = readClause(clause.text);
    const refusal =
      matches(NEGATION_PATTERNS, clause.text) && REFUSAL_HEAD_PATTERN.test(clause.text.trim());
    // Only a *trailing* politeness clause is benign: a leading "谢谢" carries no request, so
    // a command that follows it via a conjunction is a fragment, not an order (W3R18-02).
    const polite = POLITE_TAIL_PATTERN.test(clause.text) && index === clauses.length - 1;
    const explanationLead =
      EXPLANATION_LEAD_PATTERN.test(clause.text) || EXPLANATION_LEAD_EN_PATTERN.test(clause.text);
    // An explanation lead is only benign when the clause really is a request for words about
    // one named path, or names no path at all: anything else (a quoted negation, a named
    // change, a topic phrase around a path) is being talked about, not requested, so it must
    // not license a later command (W3R18-01, W3R19-01).
    const benignExplanation =
      explanationLead &&
      (isPureExplanationOfPath(clause.text, EXPLANATION_LEAD_PATTERN) ||
        isPureExplanationOfPath(clause.text, EXPLANATION_LEAD_EN_PATTERN) ||
        pathsIn(clause.text).length === 0);
    // "别改 A，但要修复 B": 要 belongs to a correction and only counts after a refusal.
    let target = reading.target;
    const previousWasRefusal =
      index > 0 &&
      matches(NEGATION_PATTERNS, clauses[index - 1]?.text ?? '') &&
      REFUSAL_HEAD_PATTERN.test((clauses[index - 1]?.text ?? '').trim());
    const adversative = /^(?:但是|而是|不过|但)/u.test(clause.text.trim());
    if (target === undefined && previousWasRefusal && adversative) {
      const correction = /^(?:但是|而是|不过|但)\s*要\s*(.+)$/u.exec(clause.text.trim());
      if (correction?.[1] !== undefined) target = commandTarget(correction[1]);
    }
    return {
      clause,
      reading,
      refusal,
      polite,
      explanationLead,
      benignExplanation,
      target,
      previousWasRefusal,
      adversative,
    };
  });
  const markerSuppressed = clauses.some(
    (clause) =>
      matches(QUESTION_PATTERNS, clause.text) ||
      matches(CHOICE_PATTERNS, clause.text) ||
      matches(ADVICE_PATTERNS, clause.text) ||
      matches(COMMENT_PATTERNS, clause.text) ||
      matches(CONDITION_PATTERNS, clause.text) ||
      matches(HYPOTHETICAL_PATTERNS, clause.text) ||
      matches(PRECONDITION_PATTERNS, clause.text),
  );
  const classSuppressed = readings.some(
    ({ target, refusal, polite, benignExplanation }) =>
      target === undefined && !refusal && !polite && !benignExplanation,
  );
  // A negation that does not *head* its clause is a report, a quotation or a premise
  // ("报告说不要修改 Y", "说明不要修改 Y"), never the user refusing: such a clause makes
  // the whole message read-only (W3R17-01).
  const reportedNegation = clauses.some(
    (clause) =>
      matches(NEGATION_PATTERNS, clause.text) && !REFUSAL_HEAD_PATTERN.test(clause.text.trim()),
  );
  // A message that *opens* with a conjunction has no clause to continue: "然后修改 X" and
  // "但是修改 X" are fragments, not commands (W3R16/W3R17 reviews).
  const leadingConjunction =
    /^(?:并且|而且|然后|同时|并|也|再|就|则|另外|顺便|顺手|但是|但|不过|而是)/u.test(text);
  const suppressed = markerSuppressed || classSuppressed || reportedNegation || leadingConjunction;

  const targets: string[] = [];
  let explanation = false;
  let previousWasCommand = false;

  readings.forEach(
    ({ clause, reading, polite, target, previousWasRefusal, adversative }, index) => {
      if (polite) {
        previousWasCommand = false;
        return;
      }
      const additive = additiveLead.test(clause.text.trim());
      // A command may open the message, continue a previous command, follow a coordinating
      // conjunction, or correct a refusal. After a refusal only a non-additive correction
      // (or an explicit conjunction) counts, so "不要改 Y，也修改 X" stays read-only while
      // "不要改 Y，然后修改 X" remains a registered positive (W3R16/W3R17 reviews).
      const allowed =
        index === 0
          ? !additive
          : clause.conjunction ||
            previousWasCommand ||
            (previousWasRefusal && (adversative || !additive));
      if (target !== undefined && !suppressed && allowed) {
        targets.push(target);
      } else if (target !== undefined) {
        explanation = true;
      }
      if (reading.explanation) explanation = true;
      previousWasCommand = target !== undefined && allowed;
    },
  );

  const items: MessageWorkItem[] = [];
  const paths = [...new Set(targets)];
  if (paths.length > 0) {
    items.push({
      intent: 'delivery',
      goal: text.slice(0, 2_000),
      // Reading the target is part of changing it: an authorization with `readPaths` but
      // no read operation would fail the Core's own capability check.
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
      : 'explicit command with a target: the message authorizes its own scope'
    : 'no command with a target: read-only route, nothing granted';
  return { items: trimmed, explicitAuthorization: explicit, reason };
}
