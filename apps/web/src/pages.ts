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
import { SENSITIVE_FILE_TODO_KIND } from '@agentdev/core';
import { attrs, badge, escapeHtml, isoUtc, pair, stateLabel } from './html.js';
import { UI_STRINGS, type Translator } from './i18n.js';
import {
  BOARD_COLUMNS,
  isSuccessfulRun,
  providerModelsInput,
  type AgentsModel,
  type ArtifactView,
  type BoardModel,
  type ChiefModel,
  type FilesModel,
  type InboxModel,
  type InboxRow,
  type ProviderEditorView,
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

/**
 * The Git facts a card or the detail header states (`requirements.md` §3, AC-090).
 *
 * The branch comes from `project.snapshot.get`, the commit from the record's real
 * `portableRef.revision`, and the push state only from an explicit `git.unpushed`.
 * A payload that reports no push state renders "not reported" — the UI never turns a
 * local branch into an "unpushed" claim.
 */
function gitChips(input: {
  readonly branch: string;
  readonly commit: string | null;
  readonly unpushed: boolean | null;
  readonly t: Translator;
}): string {
  const t = input.t;
  const commit = input.commit === null ? t('common.none') : input.commit.slice(0, 12);
  const push =
    input.unpushed === null
      ? chip(t('detail.pushState'), t('board.card.pushUnknown'), 'warn')
      : chip(
          t('detail.pushState'),
          t(input.unpushed ? 'board.card.unpushed' : 'board.card.pushed'),
          input.unpushed ? 'warn' : 'ok',
        );
  return [
    input.branch === '' ? '' : chip(t('detail.branch'), input.branch),
    `<span class="chip"${input.commit === null ? '' : ` title="${escapeHtml(input.commit)}"`}>${escapeHtml(t('detail.commit'))}: ${escapeHtml(commit)}</span>`,
    push,
  ].join('');
}

/**
 * The data attributes one requirement action button carries.
 *
 * `data-record-version` is the record version the user was looking at, and
 * `data-work-version` the Work version a `resume` must send as `expectedVersion`
 * (`protocol.md` §1). Both are omitted when the payload does not carry them.
 */
function actionButton(input: {
  readonly action: string;
  readonly labelKey: string;
  readonly requirementId: string;
  readonly recordVersion: number;
  readonly workId: string | null;
  readonly workVersion: number | null;
  readonly t: Translator;
  readonly className?: string;
}): string {
  const recordVersion =
    input.recordVersion > 0 ? ` data-record-version="${String(input.recordVersion)}"` : '';
  const workVersion =
    input.workVersion === null ? '' : ` data-work-version="${String(input.workVersion)}"`;
  return [
    `<button type="button" class="${escapeHtml(input.className ?? 'requirement-action')}"`,
    ` data-action="${escapeHtml(input.action)}"`,
    ` data-requirement="${escapeHtml(input.requirementId)}"`,
    input.workId === null ? '' : ` data-work="${escapeHtml(input.workId)}"`,
    recordVersion,
    workVersion,
    ` data-i18n="${escapeHtml(input.labelKey)}"`,
    `>${escapeHtml(input.t(input.labelKey))}</button>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * `/projects` — the installation's project list and switcher (WP-12 T5).
 *
 * `experience.md` §1: the page lists what this installation serves and lets the user
 * move between projects; `protocol.md` §3 `project.list` is the data source. A
 * project that cannot be navigated to (a missing root, a damaged registry entry)
 * renders its typed reason instead of a dead link, and the lifecycle/init facts the
 * daemon reports are shown as chips so "initializing" is never implicit.
 */
export function renderProjectsPage(input: {
  readonly projects: readonly JsonObject[];
  readonly currentProjectId: string;
  readonly counts: Readonly<Record<string, number>>;
  /** Damaged registry entries the installation skipped (WP-12 T5 Q2). */
  readonly problems?: readonly string[];
  readonly t: Translator;
  readonly language: string;
  readonly panelMode: string;
}): string {
  const t = input.t;
  const rows = input.projects
    .map((project) => {
      const id = text(project['id']);
      const name = text(project['name'], text(project['root']));
      const root = text(project['root']);
      const head = text(project['head']);
      const state = text(project['state'], 'open');
      const lifecycle = text(project['lifecycleState'], state);
      const trust = text(project['trust'], 'untrusted');
      const problem = text(project['problem']);
      const initialization = text(project['initialization']);
      const runningRuns = project['runningRuns'];
      const current = id === input.currentProjectId;
      // A project that is not navigable is not a link: the switcher must never offer a
      // destination the installation cannot serve.
      const navigable = problem === '' && lifecycle !== 'missing' && lifecycle !== 'unreadable';
      const trusted = trust === 'trusted';
      // WP-12 project UX: every project row carries its real actions and its real
      // state. "Read-only until trusted" is shown in words, and the toggle, initialize
      // and close actions are the same protocol methods the CLI uses.
      const actions = [
        navigable
          ? `<a class="project-action" href="/projects/${escapeHtml(id)}/chief" data-action="switch" data-project="${escapeHtml(id)}" data-i18n="projects.switch">${escapeHtml(t('projects.switch'))}</a>`
          : '',
        navigable
          ? `<button type="button" class="project-action" data-action="trust" data-project="${escapeHtml(id)}" data-trusted="${trusted ? 'true' : 'false'}" data-i18n="${trusted ? 'projects.untrustNow' : 'projects.trustNow'}">${escapeHtml(t(trusted ? 'projects.untrustNow' : 'projects.trustNow'))}</button>`
          : '',
        navigable
          ? `<button type="button" class="project-action" data-action="initialize" data-project="${escapeHtml(id)}" data-i18n="projects.initialize">${escapeHtml(t('projects.initialize'))}</button>`
          : '',
        lifecycle === 'closed'
          ? `<button type="button" class="project-action" data-action="open" data-root="${escapeHtml(root)}" data-i18n="projects.openAction">${escapeHtml(t('projects.openAction'))}</button>`
          : '',
        navigable && lifecycle === 'open'
          ? `<button type="button" class="project-action" data-action="close" data-project="${escapeHtml(id)}" data-i18n="projects.close">${escapeHtml(t('projects.close'))}</button>`
          : '',
      ]
        .filter((part) => part !== '')
        .join('');
      return [
        `<li class="project-row${current ? ' current' : ''}" data-project="${escapeHtml(id)}" data-state="${escapeHtml(lifecycle)}" data-trust="${escapeHtml(trust)}" data-i18n-project="${escapeHtml(id)}">`,
        navigable
          ? `<a class="project-link" href="/projects/${escapeHtml(id)}/chief"${current ? ' aria-current="page"' : ''}>${escapeHtml(name)}</a>`
          : `<span class="project-link unavailable" aria-disabled="true" title="${escapeHtml(problem)}">${escapeHtml(name)}</span>`,
        `<span class="project-meta mono">${escapeHtml(root)}</span>`,
        `<span class="project-meta mono">${escapeHtml(head.slice(0, 12))}</span>`,
        chip(t('projects.state'), t(lifecycleChipKey(lifecycle))),
        chip(t('projects.chipTrust'), t(trusted ? 'projects.trusted' : 'projects.untrusted')),
        typeof runningRuns === 'number' && runningRuns > 0
          ? chip(t('projects.chipRuns'), String(runningRuns), 'attention')
          : '',
        initialization === '' ? '' : `${chip(t('projects.chipInit'), initialization)}`,
        problem === ''
          ? ''
          : `<span class="project-problem" role="status">${escapeHtml(problem)}</span>`,
        actions === '' ? '' : `<div class="project-actions">${actions}</div>`,
        '</li>',
      ].join('');
    })
    .join('');
  const counts = Object.entries(input.counts)
    .map(([key, value]) => chip(key, String(value)))
    .join('');
  const problems = (input.problems ?? [])
    .map((problem) => `<li class="registry-problem" role="status">${escapeHtml(problem)}</li>`)
    .join('');
  const firstRun = input.projects.length === 0;
  return [
    section(
      { id: 'projects', titleKey: 'nav.projects', t },
      [
        firstRun
          ? [
              `<p class="first-run" data-i18n="projects.firstRunTitle">${escapeHtml(t('projects.firstRunTitle'))}</p>`,
              `<p class="hint" data-i18n="projects.firstRunHint">${escapeHtml(t('projects.firstRunHint'))}</p>`,
            ].join('')
          : '',
        rows === '' ? '' : `<ul class="project-list">${rows}</ul>`,
        rows === ''
          ? ''
          : `<p class="hint project-trust-effect" data-i18n="projects.trustEffect">${escapeHtml(t('projects.trustEffect'))}</p>`,
        problems === '' ? '' : `<ul class="registry-problems">${problems}</ul>`,
        `<p class="hint" id="currentProject" data-project="${escapeHtml(input.currentProjectId)}">${escapeHtml(input.currentProjectId)}</p>`,
        `<div class="chips">${counts}</div>`,
        `<p class="hint" data-i18n="board.l1Hidden">${escapeHtml(t('board.l1Hidden'))}</p>`,
      ]
        .filter((part) => part !== '')
        .join(''),
    ),
    section(
      { id: 'projectActions', titleKey: 'projects.actions', t },
      [
        `<div class="project-actions-bar">`,
        `<button type="button" id="openFolder" data-action="open-folder" data-i18n="projects.openFolder">${escapeHtml(t('projects.openFolder'))}</button>`,
        `<button type="button" id="createFolder" data-action="create-folder" data-i18n="projects.createFolder">${escapeHtml(t('projects.createFolder'))}</button>`,
        `</div>`,
        `<form id="cloneForm" class="project-form">`,
        `<label for="cloneRemote" data-i18n="projects.remoteUrl">${escapeHtml(t('projects.remoteUrl'))}</label>`,
        `<input id="cloneRemote" name="remoteUrl" required autocomplete="off" spellcheck="false">`,
        `<label for="cloneRoot" data-i18n="projects.path">${escapeHtml(t('projects.path'))}</label>`,
        `<span class="picker-field"><input id="cloneRoot" name="root" required autocomplete="off" spellcheck="false"><button type="button" id="clonePick" data-i18n="projects.pick">${escapeHtml(t('projects.pick'))}</button></span>`,
        `<button type="submit" id="cloneSubmit" data-i18n="projects.clone">${escapeHtml(t('projects.clone'))}</button>`,
        `<span class="hint" data-i18n="projects.cloneHint">${escapeHtml(t('projects.cloneHint'))}</span>`,
        `</form>`,
        `<p class="alert" id="projectsError" role="alert" hidden></p>`,
        `<p class="hint" id="projectsStatus" role="status" hidden></p>`,
        `<p class="hint" data-i18n="shell.chiefOnlyControls">${escapeHtml(t('shell.chiefOnlyControls'))}</p>`,
        // With no project open there is no Chief surface to link to; the first-run
        // guidance above is the only action that makes sense.
        firstRun ? '' : discussLink(input.currentProjectId, t, 'chief'),
      ].join(''),
    ),
    renderFolderPicker(t),
  ].join('');
}

/** The dictionary key for one lifecycle state (`protocol.md` §3 `project.list`). */
function lifecycleChipKey(lifecycle: string): string {
  switch (lifecycle) {
    case 'open':
      return 'projects.lifecycleOpen';
    case 'missing':
      return 'projects.lifecycleMissing';
    case 'unreadable':
      return 'projects.lifecycleUnreadable';
    default:
      return 'projects.lifecycleClosed';
  }
}

/**
 * The global folder picker and the one-time trust prompt.
 *
 * Both are plain `<dialog>` elements the client script drives; the picker only ever
 * calls the BFF's `GET /picker/list` (names only, audited) and the trust prompt only
 * calls the documented `project.trust` method. The markup is server-rendered so the
 * labels exist in both locales before any script runs.
 */
function renderFolderPicker(t: Translator): string {
  return [
    `<dialog id="folderPicker" class="picker-dialog" data-mode="open" aria-labelledby="folderPickerTitle">`,
    `<h2 id="folderPickerTitle" data-i18n="picker.title">${escapeHtml(t('picker.title'))}</h2>`,
    `<p class="hint" data-i18n="projects.pickerHint">${escapeHtml(t('projects.pickerHint'))}</p>`,
    `<form id="pickerPathForm">`,
    `<label for="pickerPath" data-i18n="picker.path">${escapeHtml(t('picker.path'))}</label>`,
    `<span class="picker-field"><input id="pickerPath" name="path" autocomplete="off" spellcheck="false"><button type="submit" data-i18n="picker.go">${escapeHtml(t('picker.go'))}</button></span>`,
    `<span class="picker-field"><button type="button" id="pickerUp" data-i18n="picker.up">${escapeHtml(t('picker.up'))}</button><button type="button" id="pickerHome" data-i18n="picker.home">${escapeHtml(t('picker.home'))}</button><button type="button" id="pickerRoot" data-i18n="picker.root">${escapeHtml(t('picker.root'))}</button></span>`,
    `</form>`,
    `<ul class="picker-entries" id="pickerEntries" data-i18n-aria="picker.title" aria-label="${escapeHtml(t('picker.title'))}"></ul>`,
    `<div class="picker-create" id="pickerCreate" hidden>`,
    `<label for="pickerName" data-i18n="projects.name">${escapeHtml(t('projects.name'))}</label>`,
    `<input id="pickerName" name="name" autocomplete="off">`,
    `</div>`,
    `<p class="hint" id="pickerStatus" data-i18n="picker.loading" role="status">${escapeHtml(t('picker.loading'))}</p>`,
    `<p class="hint" data-i18n="picker.readOnlyNotice">${escapeHtml(t('picker.readOnlyNotice'))}</p>`,
    `<div class="dialog-actions">`,
    `<button type="button" id="pickerCancel" data-i18n="picker.cancel">${escapeHtml(t('picker.cancel'))}</button>`,
    `<button type="button" id="pickerSelect" data-i18n="picker.select">${escapeHtml(t('picker.select'))}</button>`,
    `</div>`,
    `</dialog>`,
    `<dialog id="trustPrompt" class="picker-dialog" data-project="" aria-labelledby="trustPromptTitle">`,
    `<h2 id="trustPromptTitle" data-i18n="projects.trustPromptTitle">${escapeHtml(t('projects.trustPromptTitle'))}</h2>`,
    `<p data-i18n="projects.trustPromptBody">${escapeHtml(t('projects.trustPromptBody'))}</p>`,
    `<div class="dialog-actions">`,
    `<button type="button" id="trustReadOnly" data-i18n="projects.readOnly">${escapeHtml(t('projects.readOnly'))}</button>`,
    `<button type="button" id="trustAccept" data-i18n="projects.trust">${escapeHtml(t('projects.trust'))}</button>`,
    `</div>`,
    `</dialog>`,
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
    ` data-record-version="${String(card.recordVersion)}"`,
    ` data-git-branch="${escapeHtml(card.branch)}" data-git-commit="${escapeHtml(card.commit ?? '')}"`,
    ` data-git-unpushed="${card.unpushed === null ? 'unreported' : String(card.unpushed)}"`,
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
    // AC-090: the record's delivery branch, commit and (when reported) push state.
    gitChips({
      branch: card.branch,
      commit: card.commit,
      unpushed: card.unpushed,
      t,
    }),
    '</div>',
    card.waitingToContinue
      ? `<p class="chip warn" data-i18n="board.card.waitingToContinue">${escapeHtml(t('board.card.waitingToContinue'))}</p>`
      : '',
    `<div class="card-actions" role="group" data-i18n-aria="board.actions" aria-label="${escapeHtml(t('board.actions'))}">`,
    // Every requirement action names the record version it was rendered from and the
    // idempotency key the client adds, so a refusal carries the real protocol code
    // and the card is left exactly as it was (`protocol.md` §1, AC-068).
    card.canPause
      ? `<button type="button" class="pause" data-action="pause" data-work="${escapeHtml(card.work?.workId ?? '')}" data-i18n="board.action.pause">${escapeHtml(t('board.action.pause'))}</button>`
      : `<button type="button" class="pause" data-action="pause" data-requirement="${escapeHtml(card.requirementId)}" data-refused="INVALID_STATE" aria-disabled="true" title="${escapeHtml(t('board.pauseQueuedRefused'))}" data-i18n="board.action.pause">${escapeHtml(t('board.action.pause'))}</button>`,
    card.canResume
      ? actionButton({
          action: 'resume',
          labelKey: 'board.action.resume',
          requirementId: card.requirementId,
          recordVersion: card.recordVersion,
          workId: card.work?.workId ?? null,
          workVersion: card.workVersion,
          className: 'resume',
          t,
        })
      : '',
    card.canContinue
      ? actionButton({
          action: 'continue',
          labelKey: 'board.action.continue',
          requirementId: card.requirementId,
          recordVersion: card.recordVersion,
          workId: card.work?.workId ?? null,
          workVersion: card.workVersion,
          className: 'continue',
          t,
        })
      : '',
    card.canComplete
      ? actionButton({
          action: 'complete',
          labelKey: 'board.action.complete',
          requirementId: card.requirementId,
          recordVersion: card.recordVersion,
          workId: card.work?.workId ?? null,
          workVersion: card.workVersion,
          className: 'complete',
          t,
        })
      : '',
    card.canArchive
      ? actionButton({
          action: 'archive',
          labelKey: 'board.action.archive',
          requirementId: card.requirementId,
          recordVersion: card.recordVersion,
          workId: card.work?.workId ?? null,
          workVersion: card.workVersion,
          className: 'archive',
          t,
        })
      : '',
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
  // The requirement actions call the real commands with the record version they were
  // rendered from; a refusal renders the protocol code plus message in
  // `#detailError` and leaves every field of the card untouched (`AC-068`, `AC-089`).
  const action = (key: string, action_: string, className: string): string =>
    actionButton({
      action: action_,
      labelKey: key,
      requirementId: detail.requirementId,
      recordVersion: detail.recordVersion,
      workId: detail.workId,
      workVersion: detail.workVersion,
      className,
      t,
    });
  const actions = [
    detail.canPause ? action('board.action.pause', 'pause', 'pause') : '',
    detail.canResume ? action('board.action.resume', 'resume', 'resume') : '',
    detail.canContinue ? action('board.action.continue', 'continue', 'continue') : '',
    detail.canComplete ? action('board.action.complete', 'complete', 'complete') : '',
    detail.canArchive ? action('board.action.archive', 'archive', 'archive') : '',
    detail.canCancel ? action('board.action.cancel', 'cancel', 'cancel') : '',
  ].join('');
  return [
    section(
      {
        id: 'requirement',
        titleKey: 'aria.detail',
        t,
      },
      [
        `<h2 class="requirement-title" id="requirementTitle" data-i18n-project>${escapeHtml(detail.title)}</h2>`,
        `<div class="chips" id="requirementMeta" data-requirement="${escapeHtml(detail.requirementId)}" data-record-version="${String(detail.recordVersion)}" data-git-branch="${escapeHtml(detail.branch)}" data-git-commit="${escapeHtml(detail.commit ?? '')}" data-git-unpushed="${detail.unpushed === null ? 'unreported' : String(detail.unpushed)}">`,
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
        gitChips({
          branch: detail.branch,
          commit: detail.commit,
          unpushed: detail.unpushed,
          t,
        }),
        '</div>',
        detail.waitingToContinue
          ? `<p class="chip warn" data-i18n="board.card.waitingToContinue">${escapeHtml(t('board.card.waitingToContinue'))}</p>`
          : '',
        discussLink(input.projectId, t, `requirement-${detail.requirementId}`),
      ].join(''),
    ),
    section(
      { id: 'requirementActions', titleKey: 'board.actions', ariaKey: 'board.actions', t },
      [
        actions === ''
          ? emptyNote(t, 'common.none')
          : `<div class="card-actions" id="detailActions" role="group" data-i18n-aria="board.actions" aria-label="${escapeHtml(t('board.actions'))}">${actions}</div>`,
        `<p class="alert" id="detailError" role="alert" hidden></p>`,
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

/** The provider types `providerInputSchema` accepts (`rules/agents.md` §5). */
const PROVIDER_TYPES = ['openai-compatible', 'anthropic', 'google'] as const;

const PROVIDER_TYPE_KEYS: Readonly<Record<string, string>> = {
  'openai-compatible': 'settings.providerTypeOpenai',
  anthropic: 'settings.providerTypeAnthropic',
  google: 'settings.providerTypeGoogle',
};

/** One provider type's interface-string key, with a safe default for a fixture. */
function providerTypeKey(type: string): string {
  return PROVIDER_TYPE_KEYS[type] ?? 'settings.providerTypeOpenai';
}

/**
 * One provider's real editor (`experience.md` §2 `/settings`: "连接测试、Secret配置").
 *
 * The API key is a `type="password"` field that is never pre-filled and never
 * echoed: `protocol.md` §5 takes the value as a separate `secret` parameter and
 * creates `secretRef` on the server, so this control posts exactly what the
 * operator typed — or, when it is left empty, no `secret` at all, which means
 * "keep the stored credential". The client script owns that rule; nothing here
 * ever renders a value back.
 */
function renderProviderEditor(input: {
  readonly provider: ProviderEditorView | null;
  readonly key: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const provider = input.provider;
  const key = input.key;
  const providerId = provider === null ? '' : provider.providerId;
  const id = (field: string): string => `provider-${field}-${key}`;
  const type = provider === null ? PROVIDER_TYPES[0] : provider.type;
  const models = provider === null ? [] : provider.models;
  const hasModel = models.length > 0;
  const typeOptions = PROVIDER_TYPES.map((value) => {
    const labelKey = providerTypeKey(value);
    return `<option value="${escapeHtml(value)}" data-i18n="${escapeHtml(labelKey)}"${value === type ? ' selected' : ''}>${escapeHtml(t(labelKey))}</option>`;
  }).join('');
  const modelOptions = models
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`)
    .join('');
  return [
    `<form class="provider-form" data-provider="${escapeHtml(providerId)}" data-new="${provider === null ? 'true' : 'false'}">`,
    `<div class="field"><label for="${id('id')}" data-i18n="settings.providerId">${escapeHtml(t('settings.providerId'))}</label>`,
    `<input id="${id('id')}" data-field="providerId" type="text" value="${escapeHtml(providerId)}" data-translatable="false" autocomplete="off" aria-describedby="${id('id-hint')}">`,
    `<p class="hint" id="${id('id-hint')}" data-i18n="settings.providerIdHint">${escapeHtml(t('settings.providerIdHint'))}</p></div>`,
    `<div class="field"><label for="${id('type')}" data-i18n="settings.providerType">${escapeHtml(t('settings.providerType'))}</label>`,
    `<select id="${id('type')}" data-field="type">${typeOptions}</select></div>`,
    `<div class="field"><label for="${id('baseUrl')}" data-i18n="settings.baseUrl">${escapeHtml(t('settings.baseUrl'))}</label>`,
    `<input id="${id('baseUrl')}" data-field="baseUrl" type="url" value="${escapeHtml(provider === null ? '' : provider.baseUrl)}" data-translatable="false" autocomplete="off"></div>`,
    `<div class="field"><label for="${id('enabled')}" data-i18n="settings.enabled"><input id="${id('enabled')}" data-field="enabled" type="checkbox"${provider === null || provider.enabled ? ' checked' : ''}> ${escapeHtml(t('settings.enabled'))}</label></div>`,
    `<div class="field"><label for="${id('models')}" data-i18n="settings.models">${escapeHtml(t('settings.models'))}</label>`,
    `<textarea id="${id('models')}" data-field="models" rows="6" data-translatable="false" aria-describedby="${id('models-hint')}">${escapeHtml(JSON.stringify(providerModelsInput(models), null, 2))}</textarea>`,
    `<p class="hint" id="${id('models-hint')}" data-i18n="settings.modelsHint">${escapeHtml(t('settings.modelsHint'))}</p></div>`,
    `<div class="field"><label for="${id('secret')}" data-i18n="settings.apiKey">${escapeHtml(t('settings.apiKey'))}</label>`,
    `<input id="${id('secret')}" data-field="secret" type="password" value="" autocomplete="off" data-translatable="false" aria-describedby="${id('secret-hint')}">`,
    `<p class="hint" id="${id('secret-hint')}" data-i18n="settings.apiKeyHint">${escapeHtml(t('settings.apiKeyHint'))}</p></div>`,
    `<button type="submit" class="provider-save" data-i18n="settings.providerSave">${escapeHtml(t('settings.providerSave'))}</button>`,
    `<div class="field"><label for="${id('test-model')}" data-i18n="settings.testModel">${escapeHtml(t('settings.testModel'))}</label>`,
    `<select id="${id('test-model')}" class="provider-test-model" data-translatable="false"${hasModel ? '' : ' disabled aria-disabled="true"'}>${modelOptions}</select>`,
    hasModel
      ? ''
      : `<p class="hint" data-i18n="settings.testNeedsModel">${escapeHtml(t('settings.testNeedsModel'))}</p>`,
    '</div>',
    `<button type="button" class="provider-test" data-provider="${escapeHtml(providerId)}" data-i18n="settings.providerTest"${hasModel ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(t('settings.providerTest'))}</button>`,
    // The result region is rendered up front and toggled by the client, so every
    // sentence comes from the interface dictionary in the active language — the
    // daemon's `ui.translate` catalogue is a separate list and does not know these
    // keys (WP-12 T1.2b known gap).
    '<div class="provider-result" hidden>',
    `<p class="status" data-role="saved" role="status" aria-live="polite"><span data-i18n="settings.providerSaved">${escapeHtml(t('settings.providerSaved'))}</span> <span class="mono" data-role="saved-detail"></span></p>`,
    `<p class="status" data-role="test-accepted" role="status" aria-live="polite"><span data-i18n="settings.testAccepted">${escapeHtml(t('settings.testAccepted'))}</span> <span data-i18n="settings.testPending">${escapeHtml(t('settings.testPending'))}</span></p>`,
    `<p class="status" data-role="test-completed" role="status" aria-live="polite"><span data-i18n="settings.testCompleted">${escapeHtml(t('settings.testCompleted'))}</span> <span data-i18n="settings.testOk" data-role="test-ok" hidden>${escapeHtml(t('settings.testOk'))}</span><span data-i18n="settings.testFailed" data-role="test-failed" hidden>${escapeHtml(t('settings.testFailed'))}</span> <span class="mono" data-role="test-detail"></span></p>`,
    '</div>',
    // The error stays outside the result region: a refusal must be visible even
    // before any result exists.
    `<p class="alert" data-role="error" role="alert" hidden></p>`,
    '</form>',
  ].join('');
}

export function renderSettingsPage(input: {
  readonly model: SettingsModel;
  readonly settings: JsonObject;
  readonly t: Translator;
}): string {
  const t = input.t;
  const model = input.model;
  const providers = model.providers
    .map(
      (provider, index) =>
        `<li class="provider" data-provider="${escapeHtml(provider.providerId)}"><div class="row-head"><span class="mono">${escapeHtml(provider.providerId)}</span><span>${escapeHtml(provider.type)}</span><span class="chip">${escapeHtml(provider.enabled ? t('state.valid') : t('state.invalidated'))}</span><span class="chip">${escapeHtml(provider.secretConfigured ? t('settings.secretConfigured') : t('settings.secretMissing'))}</span></div>${renderProviderEditor({ provider, key: String(index), t })}</li>`,
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
      [
        providers === '' ? emptyNote(t, 'common.none') : `<ul class="providers">${providers}</ul>`,
        // A provider-less installation is exactly the broken state this entry point
        // exists to fix, so the create form is always offered.
        `<h3 data-i18n="settings.newProvider">${escapeHtml(t('settings.newProvider'))}</h3>`,
        renderProviderEditor({ provider: null, key: 'new', t }),
      ].join(''),
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

/**
 * The question block for one `product` decision.
 *
 * `protocol.md` §6 fixes the rendering contract: the question is the markdown body
 * of the Artifact in `targetRef`, and the choices are the rendered buttons. A body
 * that could not be read, or that is empty, says so — an empty card would hide the
 * one fact the user needs.
 */
function inboxQuestionBlock(row: InboxRow, t: Translator): string {
  const question = row.question;
  if (question === null) return '';
  const artifact = row.artifactId ?? '';
  const ref =
    row.artifactVersion === null
      ? artifact
      : `${artifact} · ${t('common.version')} ${String(row.artifactVersion)}`;
  const heading = `<h4 data-i18n="inbox.question">${escapeHtml(t('inbox.question'))}</h4>`;
  const body =
    question.error !== null
      ? `<p class="alert" role="alert" data-question-error data-i18n="inbox.questionUnavailable" title="${escapeHtml(question.error)}">${escapeHtml(t('inbox.questionUnavailable'))}</p>`
      : question.text.trim() === ''
        ? `<p class="hint" data-question-empty data-i18n="inbox.questionEmpty">${escapeHtml(t('inbox.questionEmpty'))}</p>`
        : `<blockquote class="inbox-question" data-question-body data-i18n-project data-translatable="false">${escapeHtml(question.text)}</blockquote>`;
  return [
    heading,
    body,
    `<p class="hint mono" data-artifact-ref="${escapeHtml(artifact)}" data-artifact-version="${String(row.artifactVersion ?? 0)}">${escapeHtml(ref)}</p>`,
  ].join('');
}

/** One `product`/other decision card: choices resolve through `decision.resolve`. */
function inboxDecisionRow(row: InboxRow, t: Translator): string {
  const expired = row.expired || !row.actionable;
  const options = row.choices
    .map(
      (choice) =>
        `<button type="button" class="choice" data-decision="${escapeHtml(row.id)}" data-choice="${escapeHtml(choice)}" data-target-version="${String(row.targetVersion ?? 0)}"${expired ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(choice)}</button>`,
    )
    .join('');
  return [
    `<li class="inbox-row" data-kind="decision" data-entry="decision" data-decision="${escapeHtml(row.id)}" data-state="${escapeHtml(row.state)}"`,
    ` data-target-version="${String(row.targetVersion ?? 0)}" data-target-id="${escapeHtml(row.targetId)}"${expired ? ' aria-disabled="true"' : ''}>`,
    `<div class="row-head"><span class="kind" data-i18n="inbox.decision">${escapeHtml(t('inbox.decision'))}</span><span class="mono">${escapeHtml(row.label)}</span>`,
    `<span class="chip">${escapeHtml(t('inbox.targetVersion'))}: ${String(row.targetVersion ?? 0)}</span>`,
    `<span class="chip${expired ? ' danger' : ' ok'}">${escapeHtml(expired ? t('inbox.expiredDisabled') : stateLabel(t, row.state))}</span></div>`,
    // The choices stay next to the head so a disabled control is never buried under
    // a long project question (the expired-control assertions read the row in order).
    `<div class="choices" data-i18n-aria="inbox.options" aria-label="${escapeHtml(t('inbox.options'))}">${options}</div>`,
    `<p class="hint" data-i18n="inbox.dedup">${escapeHtml(t('inbox.dedup'))}</p>`,
    inboxQuestionBlock(row, t),
    `<div class="chips">${chip(t('inbox.work'), row.workId)}${chip(t('inbox.raisedBy'), row.decisionKind === 'product' ? t('inbox.raisedByChief') : row.decisionKind)}</div>`,
    '</li>',
  ].join('');
}

/**
 * One `permission` request card.
 *
 * The bound tool call is stated before the buttons (`protocol.md` §4 "show exactly
 * what will be granted"): the operation, its targets, the input hash and the Run it
 * parks. Approving is a deliberate click on a named control and is disabled while the
 * binding is unknown, because a blind approval would authorize a call the user never
 * saw. Denial carries a required reason.
 */
function inboxPermissionRow(row: InboxRow, t: Translator): string {
  const expired = row.expired || !row.actionable;
  const binding = row.binding;
  const missing = row.bindingMissing || binding === null;
  const approveDisabled = missing || expired;
  const approve = `<button type="button" class="choice" data-permission="approve" data-decision="${escapeHtml(row.id)}" data-target-version="${String(row.targetVersion ?? 0)}" data-tool-operation="${escapeHtml(row.targetId)}"${approveDisabled ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(t('inbox.approve'))}</button>`;
  const deny = `<button type="button" class="choice" data-permission="deny" data-decision="${escapeHtml(row.id)}" data-target-version="${String(row.targetVersion ?? 0)}" data-tool-operation="${escapeHtml(row.targetId)}"${expired ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(t('inbox.deny'))}</button>`;
  const targets =
    binding === null
      ? ''
      : binding.targets.length === 0
        ? t('inbox.noTargets')
        : binding.targets.join(', ');
  const field_ = (labelKey: string, value: string, name: string): string =>
    `<div class="pair"><dt data-i18n="${escapeHtml(labelKey)}">${escapeHtml(t(labelKey))}</dt><dd class="mono" data-binding-${escapeHtml(name)}>${escapeHtml(value)}</dd></div>`;
  return [
    `<li class="inbox-row" data-kind="decision" data-entry="permission" data-decision="${escapeHtml(row.id)}" data-state="${escapeHtml(row.state)}"`,
    ` data-target-version="${String(row.targetVersion ?? 0)}" data-target-id="${escapeHtml(row.targetId)}" data-tool-operation="${escapeHtml(row.targetId)}"`,
    ` data-work="${escapeHtml(row.workId)}" data-binding-missing="${missing ? 'true' : 'false'}"${expired ? ' aria-disabled="true"' : ''}>`,
    `<div class="row-head"><span class="kind" data-i18n="inbox.permission">${escapeHtml(t('inbox.permission'))}</span>`,
    `<span class="mono" data-binding-operation>${escapeHtml(binding?.operation ?? '')}</span>`,
    `<span class="chip">${escapeHtml(t('inbox.targetVersion'))}: ${String(row.targetVersion ?? 0)}</span>`,
    `<span class="chip${expired ? ' danger' : ' ok'}">${escapeHtml(expired ? t('inbox.expiredDisabled') : stateLabel(t, row.state))}</span></div>`,
    `<div class="choices" data-i18n-aria="inbox.options" aria-label="${escapeHtml(t('inbox.options'))}">${approve}${deny}</div>`,
    `<p class="alert" role="alert" data-binding-notice data-i18n="inbox.bindingMissing"${missing ? '' : ' hidden'}>${escapeHtml(t('inbox.bindingMissing'))}</p>`,
    `<h4 data-i18n="inbox.permissionBinding">${escapeHtml(t('inbox.permissionBinding'))}</h4>`,
    '<dl class="binding">',
    field_('inbox.targets', targets, 'targets'),
    field_('inbox.inputHash', binding?.inputHash ?? '', 'input-hash'),
    field_('inbox.bindingHash', row.targetHash ?? '', 'hash'),
    field_('inbox.grantScope', t('inbox.grantScopeOnce'), 'scope'),
    field_('inbox.run', row.runId ?? '', 'run'),
    field_('inbox.work', row.workId, 'work'),
    field_(
      'inbox.raisedBy',
      row.role === null
        ? t('inbox.raisedByRun')
        : `${row.role}${row.stage === null ? '' : ` · ${row.stage}`}${row.runStatus === null ? '' : ` · ${stateLabel(t, row.runStatus)}`}`,
      'raised-by',
    ),
    '</dl>',
    `<label for="deny-reason-${escapeHtml(row.id)}" data-i18n="inbox.denyReason">${escapeHtml(t('inbox.denyReason'))}</label>`,
    `<textarea id="deny-reason-${escapeHtml(row.id)}" data-permission-reason rows="2" data-translatable="false"></textarea>`,
    '</li>',
  ].join('');
}

/**
 * One user-facing Chief todo card (`protocol.md` §7).
 *
 * The frozen permission spec (`T3-implementation.md` 附录 A.1-3) files a
 * `chief_action_required(kind='sensitive_file')` when the agent is refused a file on
 * the sensitive-file table and names the reader: the user handles that file themselves.
 * The card therefore states exactly what was refused, which file and rule matched,
 * which Work/Run asked for it and when — every value the daemon reported, with an
 * explicit "not reported" where a field is absent, and never the file's content.
 *
 * There is deliberately no resolution control: the documentation defines the user's
 * action (handle the file outside the agent) but no way to clear the todo, so the page
 * does not invent one. The "discuss in Chief" link carries the Work reference, which is
 * the documented way to bring an object back to the Chief.
 */
function inboxTodoRow(row: InboxRow, t: Translator, projectId: string): string {
  const todo = row.todo;
  const kind = todo?.kind ?? '';
  const sensitive = kind === SENSITIVE_FILE_TODO_KIND;
  const unavailable = t('inbox.todoFieldUnavailable');
  const value = (text: string | null): string =>
    text === null || text.trim() === '' ? unavailable : text;
  const field_ = (labelKey: string, fieldValue: string, name: string): string =>
    `<div class="pair"><dt data-i18n="${escapeHtml(labelKey)}">${escapeHtml(t(labelKey))}</dt><dd class="mono" data-todo-${escapeHtml(name)}>${escapeHtml(fieldValue)}</dd></div>`;
  const work = row.workId === '' ? unavailable : row.workId;
  const raisedAt = row.createdAt === null ? unavailable : isoUtc(row.createdAt);
  const detail = sensitive
    ? [
        `<p data-i18n="inbox.todoSensitiveWhat">${escapeHtml(t('inbox.todoSensitiveWhat'))}</p>`,
        '<dl class="binding">',
        field_('inbox.todoAction', value(todo?.action ?? null), 'action'),
        field_('inbox.todoPath', value(todo?.path ?? null), 'path'),
        field_('inbox.todoPattern', value(todo?.pattern ?? null), 'pattern'),
        field_('inbox.todoConfigPolicy', value(todo?.configPolicy ?? null), 'config-policy'),
        field_('inbox.work', work, 'work'),
        field_('inbox.run', value(row.runId), 'run'),
        field_('inbox.raisedBy', value(row.role), 'raised-by'),
        field_('inbox.raisedAt', raisedAt, 'raised-at'),
        '</dl>',
        // The documented resolution: the user handles the file, the agent does not.
        `<p class="hint" data-i18n="inbox.todoHandling">${escapeHtml(t('inbox.todoHandling'))}</p>`,
      ].join('')
    : [
        `<p class="hint" data-i18n="inbox.todoOtherHint">${escapeHtml(t('inbox.todoOtherHint'))}</p>`,
        '<dl class="binding">',
        field_('inbox.todoKind', kind === '' ? unavailable : kind, 'kind'),
        field_('inbox.work', work, 'work'),
        field_('inbox.run', value(row.runId), 'run'),
        field_('inbox.raisedAt', raisedAt, 'raised-at'),
        '</dl>',
      ].join('');
  const diagnostic =
    todo === null || todo.reason === null ? '' : ` title="${escapeHtml(todo.reason)}"`;
  const headingKey = sensitive ? 'inbox.todoSensitiveFile' : 'inbox.todo';
  return [
    `<li class="inbox-row" data-kind="todo" data-entry="todo" data-todo="${escapeHtml(row.id)}" data-todo-kind="${escapeHtml(kind)}"`,
    ` data-work="${escapeHtml(row.workId)}" data-run="${escapeHtml(row.runId ?? '')}"${diagnostic}`,
    `${row.actionable ? '' : ' aria-disabled="true"'}>`,
    `<div class="row-head"><span class="kind" data-i18n="${escapeHtml(headingKey)}">${escapeHtml(t(headingKey))}</span>`,
    `<span class="chip warn">${escapeHtml(kind === '' ? t('inbox.todoKindUnknown') : kind)}</span>`,
    `<span class="chip">${escapeHtml(t('inbox.raisedAt'))}: ${escapeHtml(raisedAt)}</span></div>`,
    detail,
    // The two closing actions (`protocol.md` §4 `chief.todo.resolve`). They are an
    // acknowledgement, not an authorization: closing the todo neither admits the
    // refused call nor changes the sensitive-file tier.
    `<div class="choices" data-i18n-aria="inbox.todoActions" aria-label="${escapeHtml(t('inbox.todoActions'))}">`,
    `<button type="button" class="choice" data-todo-disposition="handled" data-todo="${escapeHtml(row.id)}" data-work="${escapeHtml(row.workId)}"${row.actionable ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(t('inbox.todoHandled'))}</button>`,
    `<button type="button" class="choice" data-todo-disposition="dismissed" data-todo="${escapeHtml(row.id)}" data-work="${escapeHtml(row.workId)}"${row.actionable ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(t('inbox.todoDismissed'))}</button>`,
    '</div>',
    `<label for="todo-reason-${escapeHtml(row.id)}" data-i18n="inbox.todoReason">${escapeHtml(t('inbox.todoReason'))}</label>`,
    `<textarea id="todo-reason-${escapeHtml(row.id)}" data-todo-reason rows="2" data-translatable="false"></textarea>`,
    row.workId === '' ? '' : discussLink(projectId, t, `work-${row.workId}`),
    '</li>',
  ].join('');
}

/**
 * One explicit L3 confirmation card (`AC-011`).
 *
 * The routing decision already decided this delivery is high risk, so the card states
 * everything the user is being asked to accept before any high-risk step runs: the
 * Work and Requirement, the revision, the risk flags the routing actually produced,
 * the operation and write/read scope the implementation would run under, and why the
 * routing called it high risk. Confirm and decline are the decision's own saved
 * choices; declining carries a required reason, exactly like a permission denial.
 *
 * The frozen question body (the `inbox.question` block) stays part of the card: it is
 * the same `protocol.md` §6 contract a Chief question uses, so the long-form rationale
 * and the structured facts are both visible.
 */
function inboxL3ConfirmationRow(row: InboxRow, t: Translator): string {
  const confirmation = row.l3Confirmation;
  if (confirmation === null) return inboxDecisionRow(row, t);
  const expired = row.expired || !row.actionable;
  const list = (values: readonly string[], emptyKey: string): string =>
    values.length === 0
      ? `<span class="hint" data-i18n="${escapeHtml(emptyKey)}">${escapeHtml(t(emptyKey))}</span>`
      : `<span class="mono" data-l3-scope-list>${values.map((entry) => escapeHtml(entry)).join(', ')}</span>`;
  /** A value the daemon may not have reported renders its own "not reported" text. */
  const optional = (text: string | null): string =>
    text === null || text.trim() === ''
      ? `<span class="hint" data-i18n="inbox.l3FieldUnavailable">${escapeHtml(t('inbox.l3FieldUnavailable'))}</span>`
      : `<span class="mono">${escapeHtml(text)}</span>`;
  const options = row.choices
    .map(
      (choice) =>
        `<button type="button" class="choice" data-decision="${escapeHtml(row.id)}" data-choice="${escapeHtml(choice)}" data-target-version="${String(row.targetVersion ?? 0)}"${expired ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(choice)}</button>`,
    )
    .join('');
  const riskFlags =
    confirmation.riskFlags.length === 0
      ? `<span class="hint" data-i18n="inbox.l3NoRiskFlags">${escapeHtml(t('inbox.l3NoRiskFlags'))}</span>`
      : confirmation.riskFlags
          .map(
            (flag) =>
              `<span class="chip danger" data-l3-risk-flag="${escapeHtml(flag)}">${escapeHtml(flag)}</span>`,
          )
          .join('');
  const pair = (labelKey: string, content: string, name: string): string =>
    `<div class="pair"><dt data-i18n="${escapeHtml(labelKey)}">${escapeHtml(t(labelKey))}</dt><dd data-l3-${escapeHtml(name)}>${content}</dd></div>`;
  return [
    `<li class="inbox-row" data-kind="decision" data-entry="l3-confirmation" data-decision="${escapeHtml(row.id)}" data-state="${escapeHtml(row.state)}"`,
    ` data-target-version="${String(row.targetVersion ?? 0)}" data-target-id="${escapeHtml(row.targetId)}"`,
    ` data-work="${escapeHtml(confirmation.workId)}" data-l3-outcome="${escapeHtml(confirmation.outcome)}"`,
    ` data-l3-confirmation="true"${expired ? ' aria-disabled="true"' : ''}>`,
    `<div class="row-head"><span class="kind" data-i18n="inbox.l3">${escapeHtml(t('inbox.l3'))}</span>`,
    `<span class="mono" data-l3-level>${escapeHtml(confirmation.level)}</span>`,
    `<span class="chip">${escapeHtml(t('inbox.targetVersion'))}: ${String(row.targetVersion ?? 0)}</span>`,
    `<span class="chip${expired ? ' danger' : ' ok'}">${escapeHtml(expired ? t('inbox.expiredDisabled') : stateLabel(t, row.state))}</span></div>`,
    `<div class="choices" data-i18n-aria="inbox.options" aria-label="${escapeHtml(t('inbox.options'))}">${options}</div>`,
    `<h4 data-i18n="inbox.l3RiskFlags">${escapeHtml(t('inbox.l3RiskFlags'))}</h4>`,
    `<div class="chips" data-l3-risk-flags>${riskFlags}</div>`,
    `<h4 data-i18n="inbox.l3What">${escapeHtml(t('inbox.l3What'))}</h4>`,
    '<dl class="binding">',
    pair('inbox.l3Work', `<span class="mono">${escapeHtml(confirmation.workId)}</span>`, 'work-id'),
    pair('inbox.l3Requirement', optional(confirmation.requirementId), 'requirement'),
    pair('inbox.l3Revision', optional(confirmation.revision), 'revision'),
    pair('inbox.l3Reason', optional(confirmation.reason), 'reason-text'),
    pair(
      'inbox.l3WritePaths',
      list(confirmation.scope.writePaths, 'inbox.l3NoPaths'),
      'write-paths',
    ),
    pair('inbox.l3ReadPaths', list(confirmation.scope.readPaths, 'inbox.l3NoPaths'), 'read-paths'),
    pair(
      'inbox.l3Operations',
      list(confirmation.scope.operations, 'inbox.l3NoOperations'),
      'operations',
    ),
    pair(
      'inbox.l3NetworkTargets',
      list(confirmation.scope.networkTargets, 'inbox.l3NoTargets'),
      'network-targets',
    ),
    '</dl>',
    inboxQuestionBlock(row, t),
    `<p class="hint" data-i18n="inbox.l3HoldNote">${escapeHtml(t('inbox.l3HoldNote'))}</p>`,
    `<label for="l3-reason-${escapeHtml(row.id)}" data-i18n="inbox.l3DeclineReason">${escapeHtml(t('inbox.l3DeclineReason'))}</label>`,
    `<textarea id="l3-reason-${escapeHtml(row.id)}" data-l3-reason rows="2" data-translatable="false"></textarea>`,
    confirmation.declineReason === null
      ? ''
      : `<p class="hint" data-l3-decline-reason data-i18n-project data-translatable="false">${escapeHtml(confirmation.declineReason)}</p>`,
    `<div class="chips">${chip(t('inbox.work'), confirmation.workId)}${chip(t('inbox.raisedBy'), t('inbox.raisedByChief'))}</div>`,
    '</li>',
  ].join('');
}

export function renderInboxPage(input: {
  readonly model: InboxModel;
  readonly projectId: string;
  readonly t: Translator;
}): string {
  const t = input.t;
  const decisionRows = input.model.decisions
    .map((row) =>
      row.entry === 'permission'
        ? inboxPermissionRow(row, t)
        : row.l3Confirmation === null
          ? inboxDecisionRow(row, t)
          : inboxL3ConfirmationRow(row, t),
    )
    .join('');
  const todoRows = input.model.todos.map((row) => inboxTodoRow(row, t, input.projectId)).join('');
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
  const body = [decisionRows, todoRows, findingRows, recoveryRows].join('');
  return [
    section(
      { id: 'inbox', titleKey: 'nav.inbox', ariaKey: 'aria.inbox', t },
      [
        `<div class="chips">${chip(t('shell.liveCount'), String(input.model.unread))}</div>`,
        `<ul class="inbox" id="inboxList" data-project="${escapeHtml(input.projectId)}" data-unread="${String(input.model.unread)}">${body}</ul>`,
        `<p class="empty" id="inboxEmpty" data-i18n="inbox.empty"${body === '' ? '' : ' hidden'}>${escapeHtml(t('inbox.empty'))}</p>`,
        `<p class="alert" id="inboxError" role="alert" hidden></p>`,
        `<p class="status" id="inboxStatus" role="status" aria-live="polite" hidden></p>`,
        `<p class="alert" id="inboxRefreshError" role="alert" hidden></p>`,
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
