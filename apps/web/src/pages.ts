/**
 * The nine workbench surfaces, rendered as server-side HTML over real protocol data.
 *
 * The pages are deliberately "dumb": every rule that decides what to show lives in
 * `views.ts`, and every value that reaches the markup is escaped through
 * `html.ts`. What these functions own is the honesty of the presentation —
 * `experience.md` §2/§3/§5/§7:
 *
 * - a message state is `received` / `processing` / `processed` / `failed` /
 *   `decision_required`, never an animation;
 * - a version is always shown with the validity it actually has, and an expired Plan
 *   is refused before the click;
 * - a truncated preview says so and offers the full download;
 * - an unavailable model, a waiting Work and a failed save state are stated, not
 *   hidden.
 */
import type { JsonObject } from '@agentdev/contracts';
import { attrs, badge, escapeHtml, isoUtc, pair, stateLabel } from './html.js';
import { UI_STRINGS, type Translator } from './i18n.js';
import {
  BOARD_COLUMNS,
  isSuccessfulRun,
  type AgentsModel,
  type ArtifactView,
  type BoardModel,
  type ChiefModel,
  type FilesModel,
  type InboxModel,
  type RequirementDetail,
  type RunDetail,
  type RunsModel,
  type SettingsModel,
} from './views.js';

/** A page section with a heading that is both visible and a real ARIA label. */
export function section(
  input: {
    readonly id: string;
    readonly titleKey: string;
    readonly ariaKey?: string;
    readonly t: Translator;
    readonly level?: 2 | 3;
  },
  body: string,
): string {
  const t = input.t;
  const level = input.level ?? 2;
  const title = t(input.titleKey);
  return [
    `<section class="panel" id="${escapeHtml(input.id)}"`,
    ` data-i18n-aria="${escapeHtml(input.ariaKey ?? input.titleKey)}" aria-label="${escapeHtml(t(input.ariaKey ?? input.titleKey))}">`,
    `<h${String(level)} class="panel-title" data-i18n="${escapeHtml(input.titleKey)}">${escapeHtml(title)}</h${String(level)}>`,
    body,
    '</section>',
  ].join('');
}

/** Reads one protocol field as text without letting `String(object)` leak in. */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

function emptyNote(t: Translator, key: string): string {
  return `<p class="empty" data-i18n="${escapeHtml(key)}">${escapeHtml(t(key))}</p>`;
}

/**
 * The dictionary key for one machine-readable Plan-approval reason (W9R2-05).
 *
 * The daemon answers `approval.reasonCode` and keeps its English sentence as a
 * diagnostic, so the page can render the reason in the current interface language.
 * An unknown code — a newer daemon, or a fixture — falls back to the generic
 * "unavailable" wording rather than rendering the code itself.
 */
function approveReasonKeyOf(code: string): string {
  const key = `detail.approveReason.${code}`;
  return UI_STRINGS[key] === undefined ? 'detail.approveUnavailable' : key;
}

/** Deep link into Chief carrying the object reference, never a copy of its body. */
function discussLink(projectId: string, t: Translator, target: string): string {
  return `<a class="discuss-link" href="/projects/${escapeHtml(projectId)}/chief#${escapeHtml(target)}" data-i18n="shell.discussInChief">${escapeHtml(t('shell.discussInChief'))}</a>`;
}

function chip(label: string, value: string, tone = ''): string {
  return `<span class="chip${tone === '' ? '' : ` ${tone}`}">${escapeHtml(label)}: ${escapeHtml(value)}</span>`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function renderProjectsPage(input: {
  readonly projects: readonly JsonObject[];
  readonly currentProjectId: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly t: Translator;
  readonly language: string;
  readonly panelMode: string;
}): string {
  const t = input.t;
  const rows = input.projects
    .map((project) => {
      const id = text(project['id']);
      const root = text(project['root']);
      const head = text(project['head']);
      const state = text(project['state'], 'open');
      const trust = text(project['trust'], 'untrusted');
      return [
        `<li class="project-row" data-project="${escapeHtml(id)}" data-i18n-project="${escapeHtml(id)}">`,
        `<a class="project-link" href="/projects/${escapeHtml(id)}/chief">${escapeHtml(root)}</a>`,
        `<span class="project-meta mono">${escapeHtml(head.slice(0, 12))}</span>`,
        chip('state', state),
        chip('trust', trust),
        stateLabel(t, state) === state ? '' : '',
        '</li>',
      ].join('');
    })
    .join('');
  const counts = Object.entries(input.counts)
    .map(([key, value]) => chip(key, String(value)))
    .join('');
  return [
    section(
      { id: 'projects', titleKey: 'nav.projects', t },
      [
        rows === '' ? emptyNote(t, 'board.empty') : `<ul class="project-list">${rows}</ul>`,
        `<p class="hint" id="currentProject" data-project="${escapeHtml(input.currentProjectId)}">${escapeHtml(input.currentProjectId)}</p>`,
        `<div class="chips">${counts}</div>`,
        `<p class="hint" data-i18n="board.l1Hidden">${escapeHtml(t('board.l1Hidden'))}</p>`,
      ].join(''),
    ),
    section(
      { id: 'projectActions', titleKey: 'shell.discussInChief', t },
      [
        `<p class="hint" data-i18n="shell.chiefOnlyControls">${escapeHtml(t('shell.chiefOnlyControls'))}</p>`,
        discussLink(input.currentProjectId, t, 'chief'),
      ].join(''),
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Chief (AC-069, AC-084)
// ---------------------------------------------------------------------------

export function renderChiefPage(input: {
  readonly model: ChiefModel;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const model = input.model;
  const conversationOptions = model.conversations
    .map(
      (conversation) =>
        `<option value="${escapeHtml(conversation.conversationId)}"${conversation.conversationId === model.conversationId ? ' selected' : ''}>${escapeHtml(conversation.title)}</option>`,
    )
    .join('');
  const messages = model.messages
    .map((message) => {
      const stateTone =
        message.state === 'failed' ? ' danger' : message.state === 'processed' ? ' ok' : '';
      const attachments =
        message.attachmentIds.length === 0
          ? ''
          : `<ul class="attachments">${message.attachmentIds
              .map(
                (id) =>
                  `<li data-attachment="${escapeHtml(id)}" data-i18n="chief.attachmentBound">${escapeHtml(t('chief.attachmentBound'))}</li>`,
              )
              .join('')}</ul>`;
      return [
        `<li class="message" data-message="${escapeHtml(message.messageId)}" data-state="${escapeHtml(message.state)}" data-seq="${String(message.seq)}">`,
        `<div class="message-head">`,
        `<span class="role">${escapeHtml(message.role)}</span>`,
        `<span class="state${stateTone}" role="status">${escapeHtml(stateLabel(t, message.state))}</span>`,
        `<time class="mono" data-utc="${escapeHtml(isoUtc(message.createdAt))}">${escapeHtml(isoUtc(message.createdAt))}</time>`,
        '</div>',
        // Project content: rendered verbatim, marked non-translatable (AC-073).
        `<div class="message-body" data-translatable="false" data-i18n-project>${escapeHtml(message.body ?? '')}</div>`,
        message.errorReason === null
          ? ''
          : `<p class="error" role="alert">${escapeHtml(message.errorReason)}</p>`,
        attachments,
        '</li>',
      ].join('');
    })
    .join('');
  const providerNotice =
    model.providerReady === false
      ? `<p class="alert" id="providerMissing" role="status" data-i18n="chief.providerMissing">${escapeHtml(t('chief.providerMissing'))}</p>`
      : '';
  return [
    section(
      { id: 'chief', titleKey: 'nav.chief', ariaKey: 'aria.chiefConversation', t },
      [
        '<div class="conversation-bar">',
        `<label for="conversationSelect" data-i18n="chief.switchConversation">${escapeHtml(t('chief.switchConversation'))}</label>`,
        `<select id="conversationSelect" data-conversation="${escapeHtml(model.conversationId)}">${conversationOptions}</select>`,
        `<button type="button" id="newConversationInline" data-i18n="chief.newConversation">${escapeHtml(t('chief.newConversation'))}</button>`,
        '</div>',
        `<p class="alert" id="conversationError" role="alert" hidden></p>`,
        `<ol class="messages" id="messages" data-i18n-aria="aria.messages" aria-label="${escapeHtml(t('aria.messages'))}" aria-live="polite">${messages}</ol>`,
        providerNotice,
        `<form class="composer" id="composer" data-conversation="${escapeHtml(model.conversationId)}" data-i18n-aria="aria.composer" aria-label="${escapeHtml(t('aria.composer'))}">`,
        `<label class="sr-only" for="composerBody" data-i18n="chief.composer">${escapeHtml(t('chief.composer'))}</label>`,
        `<textarea id="composerBody" name="body" rows="3" maxlength="64000" required data-i18n-aria="chief.composer" aria-label="${escapeHtml(t('chief.composer'))}"></textarea>`,
        `<div class="composer-tools">`,
        `<input id="composerAttachments" name="attachment" type="file" multiple accept="image/png,image/jpeg,image/webp,text/plain,text/markdown,text/html,application/pdf" data-i18n-aria="chief.attach" aria-label="${escapeHtml(t('chief.attach'))}">`,
        `<button type="submit" id="composerSend" data-i18n="chief.send">${escapeHtml(t('chief.send'))}</button>`,
        '</div>',
        `<p class="hint" data-i18n="chief.attachmentLimits">${escapeHtml(t('chief.attachmentLimits'))}</p>`,
        `<ul class="staged" id="stagedAttachments" aria-live="polite"></ul>`,
        `<p class="alert" id="composerError" role="alert" hidden></p>`,
        '</form>',
      ].join(''),
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Board (AC-068)
// ---------------------------------------------------------------------------

function boardCard(input: {
  readonly card: BoardModel['columns']['queued'][number];
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const card = input.card;
  const workStatus = card.work === null ? null : card.work.status;
  return [
    `<li class="board-card" data-requirement="${escapeHtml(card.requirementId)}" data-identity="${escapeHtml(card.identity)}"`,
    ` data-lifecycle="${escapeHtml(card.lifecycle)}" data-work="${escapeHtml(card.work?.workId ?? '')}"`,
    ` tabindex="0" role="listitem">`,
    `<div class="card-head">`,
    `<a class="card-title" href="/projects/${escapeHtml(input.projectId)}/requirements/${escapeHtml(card.requirementId)}" data-i18n-project>${escapeHtml(card.title)}</a>`,
    `<span class="card-id mono">${escapeHtml(card.identity)}</span>`,
    '</div>',
    `<p class="card-goal" data-i18n-project>${escapeHtml(card.goal)}</p>`,
    '<div class="chips">',
    chip(t('board.card.phase'), card.phase ?? t('common.none')),
    chip(t('board.card.tasks'), `${String(card.tasksDone)}/${String(card.tasksTotal)}`),
    chip(t('board.card.blockers'), String(card.blockers), card.blockers > 0 ? 'danger' : ''),
    chip(
      t('board.card.decisions'),
      String(card.awaitingDecision),
      card.awaitingDecision > 0 ? 'warn' : '',
    ),
    chip(t('board.card.saveState'), card.saveState, card.saveState === 'saved' ? '' : 'warn'),
    chip(t('board.card.evidence'), card.evidenceAvailability),
    card.previousLifecycle === null
      ? ''
      : chip(t('board.card.previousState'), card.previousLifecycle),
    workStatus === null ? '' : chip(t('runs.status'), stateLabel(t, workStatus)),
    '</div>',
    card.waitingToContinue
      ? `<p class="chip warn" data-i18n="board.card.waitingToContinue">${escapeHtml(t('board.card.waitingToContinue'))}</p>`
      : '',
    `<div class="card-actions">`,
    // A Queued requirement with no local Work can be cancelled directly and its
    // Pause is refused with INVALID_STATE (`AC-068`); the UI states that up front.
    card.canPause
      ? `<button type="button" class="pause" data-action="pause" data-work="${escapeHtml(card.work?.workId ?? '')}" data-i18n="board.action.pause">${escapeHtml(t('board.action.pause'))}</button>`
      : `<button type="button" class="pause" data-action="pause" data-requirement="${escapeHtml(card.requirementId)}" data-refused="INVALID_STATE" aria-disabled="true" title="${escapeHtml(t('board.pauseQueuedRefused'))}" data-i18n="board.action.pause">${escapeHtml(t('board.action.pause'))}</button>`,
    card.canCancelWithoutWork
      ? `<button type="button" class="cancel" data-action="cancel" data-requirement="${escapeHtml(card.requirementId)}" data-i18n="board.action.cancel">${escapeHtml(t('board.action.cancel'))}</button>`
      : card.work === null
        ? ''
        : `<button type="button" class="cancel" data-action="cancel" data-work="${escapeHtml(card.work.workId)}" data-i18n="board.action.cancel">${escapeHtml(t('board.action.cancel'))}</button>`,
    `<a class="open-detail" href="/projects/${escapeHtml(input.projectId)}/requirements/${escapeHtml(card.requirementId)}" data-i18n="board.card.open">${escapeHtml(t('board.card.open'))}</a>`,
    '</div>',
    '</li>',
  ].join('');
}

export function renderBoardPage(input: {
  readonly model: BoardModel;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const columns = BOARD_COLUMNS.map((column) => {
    const cards = input.model.columns[column];
    return [
      `<section class="board-column" data-column="${column}" role="group" data-i18n-aria="board.${column}" aria-label="${escapeHtml(t(`board.${column}`))}">`,
      `<h3 data-i18n="board.${column}">${escapeHtml(t(`board.${column}`))}</h3>${badge(cards.length, { attention: column === 'active' })}`,
      cards.length === 0
        ? emptyNote(t, 'board.empty')
        : `<ul class="board-list" role="list">${cards
            .map((card) => boardCard({ card, projectId: input.projectId, t }))
            .join('')}</ul>`,
      '</section>',
    ].join('');
  }).join('');
  const duplicateWarning =
    input.model.duplicatedIdentities.length === 0
      ? ''
      : `<p class="alert" role="alert">duplicated identities: ${escapeHtml(input.model.duplicatedIdentities.join(', '))}</p>`;
  return [
    section(
      { id: 'board', titleKey: 'nav.requirements', ariaKey: 'aria.board', t },
      [
        `<div class="board" id="board" data-project="${escapeHtml(input.projectId)}">${columns}</div>`,
        `<p class="hint" data-i18n="board.l1Hidden">${escapeHtml(t('board.l1Hidden'))}</p>`,
        `<p class="hint" data-i18n="board.pauseQueuedRefused">${escapeHtml(t('board.pauseQueuedRefused'))}</p>`,
        `<p class="hint" id="excludedWorkIds" data-excluded="${escapeHtml(input.model.excludedWorkIds.join(','))}"></p>`,
        duplicateWarning,
        `<p class="alert" id="boardError" role="alert" hidden></p>`,
      ].join(''),
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Requirement detail (AC-070)
// ---------------------------------------------------------------------------

function artifactCard(input: { readonly artifact: ArtifactView; readonly t: Translator }): string {
  const t = input.t;
  const artifact = input.artifact;
  const invalid = artifact.validity !== 'valid';
  const previewable = artifact.mime.startsWith('text/') || artifact.mime === 'application/pdf';
  return [
    `<li class="artifact" data-artifact="${escapeHtml(artifact.artifactId)}" data-version="${String(artifact.artifactVersion)}"`,
    ` data-validity="${escapeHtml(artifact.validity)}" data-kind="${escapeHtml(artifact.kind)}">`,
    `<div class="artifact-head">`,
    `<span class="kind">${escapeHtml(artifact.kind)}</span>`,
    `<span class="role">${escapeHtml(artifact.authorRole)}</span>`,
    `<span class="version mono" data-i18n="common.version">${escapeHtml(t('common.version'))} ${String(artifact.artifactVersion)}${artifact.isLatest ? '' : ` / ${String(artifact.versionCount)}`}</span>`,
    `<span class="validity${invalid ? ' danger' : ' ok'}" data-i18n="common.validity">${escapeHtml(invalid ? stateLabel(t, 'invalidated') : stateLabel(t, 'valid'))}</span>`,
    `<time class="mono" data-utc="${escapeHtml(isoUtc(artifact.createdAt))}">${escapeHtml(isoUtc(artifact.createdAt))}</time>`,
    '</div>',
    previewable
      ? `<div class="artifact-preview">` +
        `<iframe title="${escapeHtml(`${artifact.kind} ${String(artifact.artifactVersion)}`)}" sandbox="allow-scripts" referrerpolicy="no-referrer" data-preview-href="${escapeHtml(artifact.previewHref)}" data-artifact="${escapeHtml(artifact.artifactId)}" data-version="${String(artifact.artifactVersion)}"></iframe>` +
        `<p class="hint" data-i18n="detail.previewTruncated" hidden data-truncation-notice>${escapeHtml(t('detail.previewTruncated'))}</p>` +
        `<p class="alert" data-preview-error role="alert" hidden data-i18n="detail.previewFailed">${escapeHtml(t('detail.previewFailed'))}</p>` +
        `</div>`
      : `<p class="hint" data-i18n="files.binary">${escapeHtml(t('files.binary'))} ${escapeHtml(artifact.mime)} · ${String(artifact.bytes)} B · ${escapeHtml(artifact.hash.slice(0, 12))}</p>`,
    `<div class="artifact-actions">`,
    `<button type="button" class="download" data-download-artifact="${escapeHtml(artifact.artifactId)}" data-download-version="${String(artifact.artifactVersion)}" data-i18n="detail.download">${escapeHtml(t('detail.download'))}</button>`,
    '</div>',
    '</li>',
  ].join('');
}

export function renderRequirementPage(input: {
  readonly detail: RequirementDetail;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const detail = input.detail;
  const plan = detail.plan;
  // The approve control is disabled for exactly two honest reasons: the card shows a
  // version that is not the gate's current one, or the daemon cannot hand over the
  // Plan body plus its local authorization (W9R1-01/W9R1-02).
  const approveBlocked = plan !== null && (plan.expired || !plan.approvalEnabled);
  // The visible reason is always an interface string: the daemon's English
  // sentence is a diagnostic and moves to the element's `title` (W9R2-05).
  const blockReasonKey =
    plan === null
      ? null
      : plan.expired
        ? 'detail.approveExpired'
        : plan.approvalReasonCode === null
          ? 'detail.approveUnavailable'
          : approveReasonKeyOf(plan.approvalReasonCode);
  const blockReason = blockReasonKey === null ? null : t(blockReasonKey);
  const blockDiagnostic = plan?.approvalReason ?? null;
  const planSection =
    plan === null
      ? emptyNote(t, 'common.none')
      : [
          `<div class="plan" id="plan" data-work="${escapeHtml(plan.workId)}" data-requested-version="${String(plan.requestedVersion)}" data-current-version="${String(plan.currentVersion)}" data-expired="${plan.expired ? 'true' : 'false'}" data-approvable="${approveBlocked ? 'false' : 'true'}"${plan.approvalReasonCode === null ? '' : ` data-approve-reason="${escapeHtml(plan.approvalReasonCode)}"`}${blockDiagnostic === null ? '' : ` data-approve-detail="${escapeHtml(blockDiagnostic)}"`}>`,
          '<div class="chips">',
          chip(t('detail.planCurrent'), String(plan.currentVersion)),
          chip(t('detail.planVersion'), String(plan.requestedVersion)),
          chip(t('files.revision'), plan.revision),
          plan.approvedAt === null ? '' : chip(t('detail.approvedAt'), isoUtc(plan.approvedAt)),
          '</div>',
          plan.expired
            ? `<p class="alert" id="planExpired" role="alert" data-i18n="detail.approveExpired">${escapeHtml(t('detail.approveExpired'))}</p>`
            : '',
          approveBlocked && blockReasonKey !== null
            ? `<p class="alert" id="approveBlocked" role="alert" data-i18n="${escapeHtml(blockReasonKey)}"${blockDiagnostic === null ? '' : ` title="${escapeHtml(blockDiagnostic)}"`}>${escapeHtml(blockReason ?? '')}</p>`
            : '',
          `<button type="button" id="approvePlan" data-work="${escapeHtml(plan.workId)}" data-plan-version="${String(plan.requestedVersion)}" data-plan-revision="${escapeHtml(plan.revision)}"`,
          approveBlocked ? ' disabled aria-disabled="true"' : '',
          ` data-i18n="detail.approve">${escapeHtml(t('detail.approve'))}</button>`,
          `<p class="alert" id="approveError" role="alert" hidden></p>`,
          `<p class="status" id="approveStatus" role="status" aria-live="polite" hidden></p>`,
          '</div>',
        ].join('');
  const tasks = detail.tasks
    .map(
      (task) =>
        `<tr data-task="${escapeHtml(task.taskId)}"><td class="mono">${escapeHtml(task.taskId)}</td><td data-i18n-project>${escapeHtml(task.title)}</td><td>${escapeHtml(stateLabel(t, task.status))}</td><td>${escapeHtml(task.role ?? '')}</td><td class="mono">${escapeHtml(task.dependsOn.join(', '))}</td></tr>`,
    )
    .join('');
  const runs = detail.runs
    .map(
      (run) =>
        `<tr data-run="${escapeHtml(run.runId)}" data-outcome="${escapeHtml(run.outcome ?? '')}"><td class="mono">${escapeHtml(run.runId)}</td><td>${escapeHtml(run.role)}</td><td>${escapeHtml(stateLabel(t, run.status))}</td><td>${escapeHtml(run.outcome ?? t('common.waiting'))}</td><td>${String(run.attemptCount)}</td><td class="mono">${escapeHtml(String(run.lastEpoch ?? ''))}</td></tr>`,
    )
    .join('');
  return [
    section(
      {
        id: 'requirement',
        titleKey: 'aria.detail',
        t,
      },
      [
        `<h2 class="requirement-title" id="requirementTitle" data-i18n-project>${escapeHtml(detail.title)}</h2>`,
        `<div class="chips" id="requirementMeta" data-requirement="${escapeHtml(detail.requirementId)}" data-record-version="${String(detail.recordVersion)}">`,
        chip(t('common.version'), String(detail.recordVersion)),
        chip(
          t('board.card.saveState'),
          detail.saveState,
          detail.saveState === 'saved' ? '' : 'warn',
        ),
        chip(t('state.active'), stateLabel(t, detail.lifecycle)),
        chip(t('board.card.evidence'), detail.evidenceAvailability),
        chip(
          t('runs.status'),
          detail.workStatus === null ? t('common.none') : stateLabel(t, detail.workStatus),
        ),
        '</div>',
        detail.waitingToContinue
          ? `<p class="chip warn" data-i18n="board.card.waitingToContinue">${escapeHtml(t('board.card.waitingToContinue'))}</p>`
          : '',
        discussLink(input.projectId, t, `requirement-${detail.requirementId}`),
      ].join(''),
    ),
    section(
      { id: 'requirementFields', titleKey: 'detail.goal', t, level: 3 },
      [
        `<dl class="pairs">${pair(t('detail.goal'), detail.goal)}${pair(t('detail.scope'), JSON.stringify(detail.scope ?? {}))}</dl>`,
        detail.acceptance.length === 0
          ? ''
          : `<ul class="list">${detail.acceptance.map((item) => `<li data-i18n-project>${escapeHtml(item)}</li>`).join('')}</ul>`,
        detail.openQuestions.length === 0
          ? ''
          : `<h4 data-i18n="detail.openQuestions">${escapeHtml(t('detail.openQuestions'))}</h4><ul class="list">${detail.openQuestions.map((item) => `<li data-i18n-project>${escapeHtml(item)}</li>`).join('')}</ul>`,
        detail.contentMarkdown === null
          ? ''
          : `<pre class="markdown" data-translatable="false" data-i18n-project>${escapeHtml(detail.contentMarkdown)}</pre>`,
      ].join(''),
    ),
    section({ id: 'requirementPlan', titleKey: 'detail.plan', t }, planSection),
    section(
      { id: 'requirementTasks', titleKey: 'detail.tasks', t },
      tasks === ''
        ? emptyNote(t, 'common.none')
        : `<table class="table"><thead><tr><th>Id</th><th>${escapeHtml(t('detail.goal'))}</th><th>${escapeHtml(t('runs.status'))}</th><th>${escapeHtml(t('board.card.role'))}</th><th>dependsOn</th></tr></thead><tbody>${tasks}</tbody></table>`,
    ),
    section(
      { id: 'requirementRuns', titleKey: 'detail.runs', t },
      runs === ''
        ? emptyNote(t, 'common.none')
        : `<table class="table"><thead><tr><th>Id</th><th>${escapeHtml(t('board.card.role'))}</th><th>${escapeHtml(t('runs.status'))}</th><th>${escapeHtml(t('runs.outcome'))}</th><th>${escapeHtml(t('runs.attempt'))}</th><th>${escapeHtml(t('runs.epoch'))}</th></tr></thead><tbody>${runs}</tbody></table>`,
    ),
    section(
      { id: 'requirementArtifacts', titleKey: 'detail.artifacts', t },
      detail.artifacts.length === 0
        ? emptyNote(t, 'common.none')
        : `<ul class="artifacts">${detail.artifacts.map((artifact) => artifactCard({ artifact, t })).join('')}</ul>`,
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Docs / Files (AC-077)
// ---------------------------------------------------------------------------

export function renderDocsPage(input: {
  readonly views: Readonly<Record<'delivered' | 'design' | 'work', JsonObject>>;
  /** The active view is also named here so a test can assert which one rendered. */
  readonly activeView: 'delivered' | 'design' | 'work';
  readonly query: string;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const current = input.views[input.activeView];
  const items = Array.isArray(current['items']) ? (current['items'] as unknown[]) : [];
  const rows = items
    .map((entry) => {
      const item = entry as JsonObject;
      const featureId = text(item['featureId']);
      const state = text(item['state'], 'unknown');
      const path = text(item['documentPath']);
      return `<li class="feature" data-feature="${escapeHtml(featureId)}" data-state="${escapeHtml(state)}"><span class="mono" data-i18n-project>${escapeHtml(featureId)}</span><span class="path mono" data-i18n-project>${escapeHtml(path)}</span><span class="chip${state === 'stale' ? ' warn' : ''}">${escapeHtml(stateLabel(t, state))}</span><a href="/projects/${escapeHtml(input.projectId)}/docs?feature=${encodeURIComponent(featureId)}" data-i18n="common.open">${escapeHtml(t('common.open'))}</a></li>`;
    })
    .join('');
  const revision = text(current['sourceRevision'], 'working-tree');
  const projectionState = text(current['projectionState'], 'valid');
  const unknown = Array.isArray(current['unknown'])
    ? (current['unknown'] as unknown[]).map((value) => String(value))
    : [];
  return [
    section(
      { id: 'docs', titleKey: 'nav.docs', ariaKey: 'aria.docs', t },
      [
        `<form class="search" method="get" action="/projects/${escapeHtml(input.projectId)}/docs" role="search">`,
        `<label for="docsQuery" data-i18n="files.search">${escapeHtml(t('files.search'))}</label>`,
        `<input id="docsQuery" name="query" type="search" value="${escapeHtml(input.query)}">`,
        `<input type="hidden" name="view" value="${escapeHtml(input.activeView)}">`,
        `<button type="submit" data-i18n="common.refresh">${escapeHtml(t('common.refresh'))}</button>`,
        '</form>',
        `<nav class="view-tabs" data-i18n-aria="nav.docs" aria-label="${escapeHtml(t('nav.docs'))}">`,
        (['delivered', 'design', 'work'] as const)
          .map(
            (view) =>
              `<a href="/projects/${escapeHtml(input.projectId)}/docs?view=${view}${input.query === '' ? '' : `&query=${encodeURIComponent(input.query)}`}"${view === input.activeView ? ' aria-current="page" class="active"' : ''}>${escapeHtml(view)}</a>`,
          )
          .join(''),
        '</nav>',
        `<div class="chips">${chip(t('files.revision'), revision)}${chip(t('common.validity'), projectionState, projectionState === 'stale' ? 'warn' : '')}</div>`,
        unknown.length === 0
          ? ''
          : `<ul class="list unknowns">${unknown.map((value) => `<li>${escapeHtml(text(value))}</li>`).join('')}</ul>`,
        rows === '' ? emptyNote(t, 'common.none') : `<ul class="features">${rows}</ul>`,
        `<p class="hint" data-i18n="files.snapshotUntouched">${escapeHtml(t('files.snapshotUntouched'))}</p>`,
      ].join(''),
    ),
  ].join('');
}

export function renderFilesPage(input: {
  readonly model: FilesModel;
  readonly preview: {
    readonly path: string;
    readonly content: string;
    readonly truncated: boolean;
    readonly hash: string;
    readonly mime: string;
    readonly downloadHref: string;
  } | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const entries = input.model.entries
    .map(
      (entry) =>
        `<li class="file-entry" data-kind="${entry.kind}"><a href="/projects/${escapeHtml(input.projectId)}/files?path=${encodeURIComponent(entry.path)}"${entry.path === input.preview?.path ? ' aria-current="true"' : ''} data-i18n-project>${escapeHtml(entry.path)}</a>${entry.bytes === null ? '' : `<span class="bytes mono">${String(entry.bytes)}</span>`}</li>`,
    )
    .join('');
  const preview =
    input.error !== null
      ? `<p class="alert" role="alert" data-code="${escapeHtml(input.error.code)}">${escapeHtml(input.error.message)}</p>`
      : input.preview === null
        ? emptyNote(t, 'common.none')
        : [
            `<div class="preview-head">`,
            `<span class="mono" data-i18n-project>${escapeHtml(input.preview.path)}</span>`,
            `<span class="chip">${escapeHtml(input.preview.mime)}</span>`,
            `<span class="chip mono">${escapeHtml(input.preview.hash.slice(0, 12))}</span>`,
            `<a href="${escapeHtml(input.preview.downloadHref)}" data-i18n="detail.download">${escapeHtml(t('detail.download'))}</a>`,
            '</div>',
            input.preview.truncated
              ? `<p class="alert warn" id="fileTruncated" role="status" data-i18n="detail.previewTruncated">${escapeHtml(t('detail.previewTruncated'))}</p>`
              : '',
            `<pre class="file-content" tabindex="0" data-translatable="false" data-i18n-project>${escapeHtml(input.preview.content)}</pre>`,
          ].join('');
  return [
    section(
      { id: 'files', titleKey: 'nav.files', ariaKey: 'aria.projectFiles', t },
      [
        `<div class="chips" id="filesMeta" data-revision="${escapeHtml(input.model.revision)}" data-branch="${escapeHtml(input.model.branch)}" data-root="${escapeHtml(input.model.root)}">`,
        chip(t('files.branch'), input.model.branch),
        chip(t('files.revision'), input.model.revision),
        '</div>',
        `<form class="search" method="get" action="/projects/${escapeHtml(input.projectId)}/files" role="search">`,
        `<label for="filesQuery" data-i18n="files.search">${escapeHtml(t('files.search'))}</label>`,
        `<input id="filesQuery" name="query" type="search" value="${escapeHtml(input.model.query)}">`,
        `<button type="submit" data-i18n="common.refresh">${escapeHtml(t('common.refresh'))}</button>`,
        '</form>',
        `<ul class="file-list" id="fileList" data-i18n-aria="files.tree" aria-label="${escapeHtml(t('files.tree'))}"${input.model.truncated ? ' data-truncated="true"' : ''}>${entries}</ul>`,
        `<p class="hint" data-i18n="files.rootBoundary">${escapeHtml(t('files.rootBoundary'))}</p>`,
        `<p class="hint" data-i18n="files.snapshotUntouched">${escapeHtml(t('files.snapshotUntouched'))}</p>`,
      ].join(''),
    ),
    section({ id: 'filePreview', titleKey: 'files.preview', t }, preview),
  ].join('');
}

// ---------------------------------------------------------------------------
// Agents (read-only)
// ---------------------------------------------------------------------------

export function renderAgentsPage(input: {
  readonly model: AgentsModel;
  readonly t: Translator;
}): string {
  const t = input.t;
  const rows = input.model.roles
    .map((role) => {
      const usable =
        role.usable === null
          ? t('state.unknown')
          : role.usable
            ? t('state.valid')
            : t('agents.unavailable');
      const sources = Object.entries(role.sources)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      return [
        `<tr data-role="${escapeHtml(role.role)}" data-usable="${String(role.usable)}">`,
        `<td class="mono">${escapeHtml(role.role)}</td>`,
        `<td>${escapeHtml(role.providerId ?? '')}</td>`,
        `<td>${escapeHtml(role.modelId ?? '')}</td>`,
        `<td>${escapeHtml(role.reasoning ?? '')}</td>`,
        `<td class="mono">${escapeHtml(role.contextLimit === null ? '' : String(role.contextLimit))}</td>`,
        `<td class="${role.usable === false ? 'danger' : ''}">${escapeHtml(usable)}${role.unavailableReason === null ? '' : `: ${escapeHtml(role.unavailableReason)}`}</td>`,
        `<td class="mono">${escapeHtml(sources)}</td>`,
        `<td class="mono">${escapeHtml(role.tools.join(', '))}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');
  const providers = input.model.providers
    .map(
      (provider) =>
        `<li class="provider" data-provider="${escapeHtml(provider.providerId)}"><span class="mono">${escapeHtml(provider.providerId)}</span><span>${escapeHtml(provider.type)}</span><span class="mono">${escapeHtml(provider.baseUrl)}</span><span class="chip">${escapeHtml(provider.enabled ? t('state.valid') : t('state.invalidated'))}</span><span class="chip">${escapeHtml(provider.secretConfigured ? t('settings.secretConfigured') : t('settings.secretMissing'))}</span><span class="mono">${escapeHtml(provider.models.join(', '))}</span></li>`,
    )
    .join('');
  return [
    section(
      { id: 'agents', titleKey: 'nav.agents', ariaKey: 'aria.agents', t },
      [
        `<p class="hint" data-i18n="agents.readOnly">${escapeHtml(t('agents.readOnly'))}</p>`,
        `<table class="table" id="rolesTable"><thead><tr><th>${escapeHtml(t('agents.role'))}</th><th>provider</th><th>model</th><th>reasoning</th><th>context</th><th>${escapeHtml(t('state.valid'))}</th><th>${escapeHtml(t('agents.source'))}</th><th>${escapeHtml(t('agents.tools'))}</th></tr></thead><tbody>${rows}</tbody></table>`,
        `<p class="chips">${chip(t('runs.status'), String(input.model.activeRuns))}</p>`,
      ].join(''),
    ),
    section(
      { id: 'agentProviders', titleKey: 'settings.providers', t },
      providers === '' ? emptyNote(t, 'common.none') : `<ul class="providers">${providers}</ul>`,
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Settings (AC-075)
// ---------------------------------------------------------------------------

export function renderSettingsPage(input: {
  readonly model: SettingsModel;
  readonly settings: JsonObject;
  readonly t: Translator;
}): string {
  const t = input.t;
  const model = input.model;
  const providers = model.providers
    .map(
      (provider) =>
        `<li class="provider" data-provider="${escapeHtml(provider.providerId)}"><span class="mono">${escapeHtml(provider.providerId)}</span><span>${escapeHtml(provider.type)}</span><span class="chip">${escapeHtml(provider.enabled ? t('state.valid') : t('state.invalidated'))}</span><span class="chip">${escapeHtml(provider.secretConfigured ? t('settings.secretConfigured') : t('settings.secretMissing'))}</span><button type="button" class="test-provider" data-provider="${escapeHtml(provider.providerId)}" data-i18n="settings.test">${escapeHtml(t('settings.test'))}</button></li>`,
    )
    .join('');
  const limits = Object.entries(model.effectiveLimits)
    .map(
      ([key, value]) =>
        `<li class="limit" data-limit="${escapeHtml(key)}"><span>${escapeHtml(key)}</span><span class="mono">${escapeHtml(text(value))}</span></li>`,
    )
    .join('');
  const roleProfiles = Object.entries(model.roleProfiles)
    .map(
      ([role, profile]) =>
        `<li class="role-profile" data-role="${escapeHtml(role)}"><span class="mono">${escapeHtml(role)}</span><code data-i18n-project>${escapeHtml(JSON.stringify(profile))}</code></li>`,
    )
    .join('');
  return [
    section(
      { id: 'settings', titleKey: 'nav.settings', ariaKey: 'aria.settings', t },
      [
        `<div class="chips" id="settingsMeta" data-scope="${escapeHtml(model.scope)}" data-version="${String(model.version)}" data-revision="${escapeHtml(model.revision)}">`,
        chip(t('settings.revision'), model.revision),
        chip(t('common.version'), String(model.version)),
        '</div>',
        `<p class="hint" data-i18n="settings.unsaved">${escapeHtml(t('settings.unsaved'))}</p>`,
      ].join(''),
    ),
    section(
      { id: 'settingsProviders', titleKey: 'settings.providers', t },
      providers === '' ? emptyNote(t, 'common.none') : `<ul class="providers">${providers}</ul>`,
    ),
    section(
      { id: 'settingsDefaults', titleKey: 'settings.defaultProfile', t },
      `<pre class="config" data-translatable="false">${escapeHtml(JSON.stringify(model.defaultProfile ?? {}, null, 2))}</pre>`,
    ),
    section(
      { id: 'settingsLimits', titleKey: 'settings.limits', t },
      limits === '' ? emptyNote(t, 'common.none') : `<ul class="limits">${limits}</ul>`,
    ),
    section(
      { id: 'settingsOverrides', titleKey: 'agents.profile', t },
      roleProfiles === ''
        ? emptyNote(t, 'common.none')
        : `<ul class="role-profiles">${roleProfiles}</ul>`,
    ),
    section(
      { id: 'settingsPolicy', titleKey: 'settings.policy', t },
      `<pre class="config" data-translatable="false">${escapeHtml(JSON.stringify(model.policy, null, 2))}</pre>`,
    ),
    section(
      { id: 'settingsEdit', titleKey: 'settings.save', t },
      [
        // The editor submits the same document fields the protocol patches; a
        // rejected save keeps this textarea's value and reports the reason
        // (`AC-075`).
        `<form id="configForm" data-scope="${escapeHtml(model.scope)}" data-revision="${escapeHtml(model.revision)}">`,
        `<label for="configPatch" data-i18n="settings.save">${escapeHtml(t('settings.save'))}</label>`,
        `<textarea id="configPatch" name="patch" rows="8" data-translatable="false" aria-describedby="configHint">${escapeHtml(JSON.stringify({ roleOverrides: {}, limits: {} }, null, 2))}</textarea>`,
        `<p class="hint" id="configHint">${escapeHtml('ConfigPatch: roleOverrides, limits, permissionMode, l3Paths, l3Keywords, testCommands')}</p>`,
        `<button type="submit" id="configSave" data-i18n="settings.save">${escapeHtml(t('settings.save'))}</button>`,
        `<button type="button" id="configTest" data-role="chief" data-i18n="settings.test">${escapeHtml(t('settings.test'))}</button>`,
        `<p class="alert" id="configError" role="alert" hidden data-i18n="settings.rejected">${escapeHtml(t('settings.rejected'))}</p>`,
        `<p class="status" id="configStatus" role="status" aria-live="polite" hidden></p>`,
        '</form>',
        `<p class="hint" data-i18n="settings.unchanged">${escapeHtml(t('settings.unchanged'))}</p>`,
        `<p class="hint" data-i18n="auth.showedOnce">${escapeHtml(t('auth.showedOnce'))}</p>`,
        `<p class="hint">${escapeHtml(text(input.settings['projectId']))}</p>`,
      ].join(''),
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Inbox (AC-074)
// ---------------------------------------------------------------------------

export function renderInboxPage(input: {
  readonly model: InboxModel;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const decisionRows = input.model.decisions
    .map((row) => {
      const expired = row.expired || !row.actionable;
      const options = row.choices
        .map(
          (choice) =>
            `<button type="button" class="choice" data-decision="${escapeHtml(row.id)}" data-choice="${escapeHtml(choice)}" data-target-version="${String(row.targetVersion ?? 0)}"${expired ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(choice)}</button>`,
        )
        .join('');
      return [
        `<li class="inbox-row" data-kind="decision" data-decision="${escapeHtml(row.id)}" data-state="${escapeHtml(row.state)}"`,
        ` data-target-version="${String(row.targetVersion ?? 0)}"${expired ? ' aria-disabled="true"' : ''}>`,
        `<div class="row-head"><span class="kind">${escapeHtml(t('inbox.decision'))}</span><span class="mono">${escapeHtml(row.label)}</span>`,
        `<span class="chip">${escapeHtml(t('inbox.targetVersion'))}: ${String(row.targetVersion ?? 0)}</span>`,
        `<span class="chip${expired ? ' danger' : ' ok'}">${escapeHtml(expired ? t('inbox.expiredDisabled') : stateLabel(t, row.state))}</span></div>`,
        `<p class="hint" data-i18n="inbox.dedup">${escapeHtml(t('inbox.dedup'))}</p>`,
        `<div class="choices" data-i18n-aria="inbox.options" aria-label="${escapeHtml(t('inbox.options'))}">${options}</div>`,
        '</li>',
      ].join('');
    })
    .join('');
  const findingRows = input.model.findings
    .map(
      (row) =>
        `<li class="inbox-row" data-kind="finding" data-work="${escapeHtml(row.workId)}"><div class="row-head"><span class="kind" data-i18n="inbox.internalRepairs">${escapeHtml(t('inbox.internalRepairs'))}</span><span class="chip warn">${escapeHtml(row.severity ?? '')}</span><span class="badge attention">${String(row.count)}</span></div><p class="hint" data-i18n="inbox.finding">${escapeHtml(t('inbox.finding'))}</p></li>`,
    )
    .join('');
  const recoveryRows = input.model.recoveries
    .map(
      (row) =>
        `<li class="inbox-row" data-kind="recovery" data-run="${escapeHtml(row.runId ?? '')}"><div class="row-head"><span class="kind">${escapeHtml(t('inbox.recovery'))}</span><span class="chip danger">${escapeHtml(row.state)}</span></div></li>`,
    )
    .join('');
  const body = [decisionRows, findingRows, recoveryRows].join('');
  return [
    section(
      { id: 'inbox', titleKey: 'nav.inbox', ariaKey: 'aria.inbox', t },
      [
        `<div class="chips">${chip(t('shell.liveCount'), String(input.model.unread))}</div>`,
        `<ul class="inbox" id="inboxList" data-project="${escapeHtml(input.projectId)}">${body}</ul>`,
        body === '' ? emptyNote(t, 'inbox.empty') : '',
        `<p class="alert" id="inboxError" role="alert" hidden></p>`,
      ].join(''),
    ),
  ].join('');
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function renderRunsPage(input: {
  readonly model: RunsModel;
  readonly detail: RunDetail | null;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const row = (work: RunsModel['onBoard'][number]): string =>
    [
      `<li class="work-row" data-work="${escapeHtml(work.workId)}" data-level="${escapeHtml(work.level)}" data-status="${escapeHtml(work.status)}">`,
      `<div class="row-head"><span class="mono">${escapeHtml(work.workId)}</span><span class="chip">${escapeHtml(work.level)}</span><span class="chip">${escapeHtml(stateLabel(t, work.status))}</span>${chip(t('runs.run'), String(work.runCount))}</div>`,
      `<p data-i18n-project>${escapeHtml(work.goal)}</p>`,
      `<div class="row-actions">`,
      work.runs
        .map(
          (run) =>
            `<a class="run-link" href="/projects/${escapeHtml(input.projectId)}/runs?runId=${encodeURIComponent(run.runId)}" data-run="${escapeHtml(run.runId)}" data-outcome="${escapeHtml(run.outcome ?? '')}" data-success="${isSuccessfulRun(run) ? 'true' : 'false'}">${escapeHtml(run.role)} · ${escapeHtml(stateLabel(t, run.status))}</a>`,
        )
        .join(''),
      work.runs.length > 0 && work.status === 'active'
        ? `<button type="button" class="run-control" data-action="pause" data-work="${escapeHtml(work.workId)}" data-i18n="runs.pause">${escapeHtml(t('runs.pause'))}</button>`
        : '',
      work.runs.length > 0 && work.status === 'paused'
        ? `<button type="button" class="run-control" data-action="resume" data-work="${escapeHtml(work.workId)}" data-i18n="runs.resume">${escapeHtml(t('runs.resume'))}</button>`
        : '',
      work.runs.length > 0
        ? `<button type="button" class="run-control" data-action="cancel" data-work="${escapeHtml(work.workId)}" data-i18n="runs.cancel">${escapeHtml(t('runs.cancel'))}</button>`
        : '',
      '</div>',
      '</li>',
    ].join('');
  const detailBody =
    input.detail === null
      ? emptyNote(t, 'common.none')
      : [
          `<div class="chips" id="runDetail" data-run="${escapeHtml(input.detail.run.runId)}" data-status="${escapeHtml(input.detail.run.status)}" data-outcome="${escapeHtml(input.detail.run.outcome ?? '')}" data-success="${isSuccessfulRun(input.detail.run) ? 'true' : 'false'}">`,
          chip(t('runs.status'), stateLabel(t, input.detail.run.status)),
          chip(t('runs.outcome'), input.detail.run.outcome ?? t('common.waiting')),
          chip(t('runs.attempt'), String(input.detail.run.attemptCount)),
          chip(t('runs.epoch'), String(input.detail.run.lastEpoch ?? 0)),
          chip(t('runs.tokens'), String(input.detail.run.tokensUsed)),
          '</div>',
          `<table class="table" id="attemptTable"><thead><tr><th>attempt</th><th>${escapeHtml(t('runs.epoch'))}</th><th>${escapeHtml(t('runs.status'))}</th><th>runner</th></tr></thead><tbody>`,
          input.detail.attempts
            .map(
              (attempt) =>
                `<tr data-attempt="${escapeHtml(attempt.attemptId)}" data-epoch="${String(attempt.epoch)}"><td class="mono">${String(attempt.number)}</td><td class="mono">${String(attempt.epoch)}</td><td>${escapeHtml(stateLabel(t, attempt.status))}</td><td class="mono">${escapeHtml(attempt.runnerId ?? '')}</td></tr>`,
            )
            .join(''),
          '</tbody></table>',
          `<h3 data-i18n="runs.evidence">${escapeHtml(t('runs.evidence'))}</h3>`,
          input.detail.evidenceRefs.length === 0
            ? emptyNote(t, 'common.none')
            : `<ul class="evidence" id="runEvidence">${input.detail.evidenceRefs.map((ref) => `<li class="mono" data-ref="${escapeHtml(ref)}">${escapeHtml(ref)}</li>`).join('')}</ul>`,
        ].join('');
  return [
    section(
      { id: 'runs', titleKey: 'nav.runs', ariaKey: 'aria.runs', t },
      [
        input.model.onBoard.length === 0
          ? emptyNote(t, 'runs.empty')
          : `<ul class="work-list">${input.model.onBoard.map(row).join('')}</ul>`,
        `<h3 data-i18n="runs.l1">${escapeHtml(t('runs.l1'))}</h3>`,
        input.model.direct.length === 0
          ? emptyNote(t, 'runs.empty')
          : `<ul class="work-list direct">${input.model.direct.map(row).join('')}</ul>`,
        `<p class="alert" id="runsError" role="alert" hidden></p>`,
      ].join(''),
    ),
    section({ id: 'runDetailPanel', titleKey: 'runs.run', t }, detailBody),
  ].join('');
}

/** The Inbox count the shell badge shows; kept next to the page that computes it. */
export function inboxBadgeCount(model: InboxModel): number {
  return model.unread;
}

/** Attributes every page body needs so the client script can find its container. */
export function pageAttributes(page: string, projectId: string): string {
  return attrs({ 'data-page-body': page, 'data-project': projectId });
}
