/**
 * WP-09 T3 unit coverage for the rendered HTML.
 *
 * These assertions are the AC-071/072/073 evidence that does not need a browser: the
 * ARIA roles and labels exist, the controls are keyboard reachable in the documented
 * order, the interface dictionary covers every rendered key in both locales, project
 * content is marked non-translatable and escaped, and the panel-mode attribute is on
 * the shell so the top bar restores the last mode across pages.
 */
import { describe, expect, it } from 'vitest';
import {
  PANEL_MODES,
  isPanelMode,
  nextPanelMode,
  panelModeAriaKey,
  renderShell,
} from '../src/shell.js';
import {
  renderAgentsPage,
  renderBoardPage,
  renderChiefPage,
  renderDocsPage,
  renderFilesPage,
  renderInboxPage,
  renderProjectsPage,
  renderRequirementPage,
  renderRunsPage,
  renderSettingsPage,
} from '../src/pages.js';
import { UI_STRINGS, translator, translationKeys, type Language } from '../src/i18n.js';
import { escapeHtml, renderDocument } from '../src/html.js';
import type { JsonObject, JsonValue } from '@agentdev/contracts';
import { planCard, planVersionOf } from '../src/app.js';
import {
  agentsModel,
  boardModel,
  chiefModel,
  inboxModel,
  requirementDetail,
  runDetail,
  runsModel,
  settingsModel,
} from '../src/views.js';

const t = translator('en');
const tzh = translator('zh');

function shellOf(
  page: Parameters<typeof renderShell>[0]['page'],
  extra: Record<string, unknown> = {},
) {
  return renderShell(
    {
      projectId: 'proj-1',
      projectName: 'agentdev',
      page,
      language: 'en',
      panelMode: 'open',
      ...extra,
    },
    '<section id="body">body</section>',
    t,
  );
}

/** The `data-i18n` and `data-i18n-aria` keys one HTML string uses. */
function usedKeys(html: string): string[] {
  const keys: string[] = [];
  for (const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/gu)) {
    if (match[1] !== undefined) keys.push(match[1]);
  }
  return [...new Set(keys)];
}

// ---------------------------------------------------------------------------
// Shell (AC-071 / AC-072 / AC-073)
// ---------------------------------------------------------------------------

describe('shared shell', () => {
  it('carries the panel mode on the shell so the top bar restores it (AC-071)', () => {
    for (const mode of PANEL_MODES) {
      const html = shellOf('requirements', { panelMode: mode });
      expect(html).toContain(`data-panel-mode="${mode}"`);
      expect(html).toContain('id="liveDockToggle"');
      expect(html).toContain(`aria-expanded="${mode === 'open' ? 'true' : 'false'}"`);
      expect(html).toContain(`data-i18n-aria="${panelModeAriaKey(mode)}"`);
      // The count stays visible with the panel compact or hidden.
      expect(html).toContain('id="liveCount"');
    }
  });

  it('cycles Open → Compact → Hidden and treats an unknown stored mode as the default', () => {
    expect(nextPanelMode('open')).toBe('compact');
    expect(nextPanelMode('compact')).toBe('hidden');
    expect(nextPanelMode('hidden')).toBe('open');
    expect(isPanelMode('open')).toBe(true);
    expect(isPanelMode('nonsense')).toBe(false);
  });

  it('keeps the restore control before the panel contents in the tab order (AC-071)', () => {
    const html = shellOf('chief');
    const toggle = html.indexOf('id="liveDockToggle"');
    const nav = html.indexOf('class="sidebar"');
    const dock = html.indexOf('id="liveDock"');
    expect(toggle).toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(nav);
    expect(nav).toBeLessThan(dock);
    // Closing the overlay from the panel returns focus to the same top-bar button.
    expect(html).toContain('id="liveDockClose"');
    expect(html).toContain('aria-controls="liveDock"');
  });

  it('offers no conversation create/switch control outside Chief (AC-072)', () => {
    const pages = [
      'projects',
      'requirements',
      'docs',
      'files',
      'agents',
      'runs',
      'inbox',
      'settings',
    ] as const;
    for (const page of pages) {
      const html = shellOf(page);
      expect(html).not.toContain('id="newConversation"');
      expect(html).not.toContain('id="switchConversation"');
      // The only path into the conversation is the deep link carrying the object ref.
      expect(html).toContain('id="discussInChief"');
      expect(html).toContain('/chief');
    }
    const chief = shellOf('chief');
    expect(chief).toContain('id="newConversation"');
    expect(chief).toContain('id="switchConversation"');
  });

  it('renders all nine surfaces plus Projects as keyboard-reachable links', () => {
    const html = shellOf('chief');
    for (const page of [
      'chief',
      'requirements',
      'docs',
      'files',
      'agents',
      'runs',
      'inbox',
      'settings',
    ]) {
      expect(html).toContain(`data-page="${page}"`);
    }
    expect(html).toContain('href="/projects"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-i18n-aria="nav.primary"');
  });

  it('exposes a language switch that only touches the interface dictionary (AC-073)', () => {
    const html = shellOf('chief');
    expect(html).toContain('id="languageSelect"');
    expect(html).toContain('value="en"');
    expect(html).toContain('value="zh"');
    expect(html).toContain('data-storage-key="agentdev.language"');
    // Every dictionary key renders in both locales, and the interface strings differ.
    for (const key of translationKeys()) {
      const entry = UI_STRINGS[key];
      expect(entry, key).toBeDefined();
      expect(entry?.en.length ?? 0).toBeGreaterThan(0);
      expect(entry?.zh.length ?? 0).toBeGreaterThan(0);
      expect(translator('en')(key)).not.toBe('');
      expect(translator('zh')(key)).not.toBe('');
    }
    expect(t('nav.chief')).not.toBe(tzh('nav.chief'));
  });

  it('uses a dictionary entry for every key the shell renders', () => {
    for (const page of [
      'chief',
      'requirements',
      'docs',
      'files',
      'agents',
      'runs',
      'inbox',
      'settings',
    ] as const) {
      for (const key of usedKeys(shellOf(page))) {
        expect(UI_STRINGS[key], `missing dictionary entry for ${key}`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Chief (AC-069 / AC-084)
// ---------------------------------------------------------------------------

describe('chief page', () => {
  const model = chiefModel({
    conversation: { id: 'c1', title: 'Chief' },
    conversations: [
      { id: 'c1', title: 'Chief' },
      { id: 'c2', title: 'older' },
    ],
    messages: [
      {
        id: 'm1',
        seq: 1,
        role: 'user',
        state: 'received',
        body: '<script>x</script>',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'm2',
        seq: 2,
        role: 'chief',
        state: 'processing',
        body: 'working',
        createdAt: '2026-01-01T00:01:00Z',
      },
    ],
    providerReady: false,
  });

  it('renders a real composer with the message state visible', () => {
    const html = renderChiefPage({ model, projectId: 'proj-1', t });
    expect(html).toContain('id="composer"');
    expect(html).toContain('id="composerBody"');
    expect(html).toContain('maxlength="64000"');
    expect(html).toContain('id="composerSend"');
    expect(html).toContain('data-state="received"');
    expect(html).toContain('data-state="processing"');
    expect(html).toContain('data-i18n-aria="aria.composer"');
    expect(html).toContain('aria-live="polite"');
  });

  it('never lets message text become markup and marks it untranslatable', () => {
    const html = renderChiefPage({ model, projectId: 'proj-1', t });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('data-translatable="false"');
  });

  it('keeps the draft path visible when no provider is usable', () => {
    const html = renderChiefPage({ model, projectId: 'proj-1', t });
    expect(html).toContain('id="providerMissing"');
    expect(html).toContain('data-i18n="chief.providerMissing"');
  });

  it('documents the attachment limits and accepts the documented types', () => {
    const html = renderChiefPage({ model, projectId: 'proj-1', t });
    expect(html).toContain('id="composerAttachments"');
    expect(html).toContain('multiple');
    expect(html).toContain('image/png');
    expect(html).toContain('application/pdf');
    expect(html).toContain('data-i18n="chief.attachmentLimits"');
    for (const key of usedKeys(html)) expect(UI_STRINGS[key], key).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Board (AC-068)
// ---------------------------------------------------------------------------

describe('board page', () => {
  const model = boardModel({
    columns: {
      queued: [
        {
          requirementId: 'req-q',
          identity: 'req-q',
          title: 'cancel me',
          goal: 'g',
          lifecycle: 'queued',
          recordVersion: 1,
          executionAvailability: 'needs_replan',
          evidenceAvailability: 'summary_only',
          saveState: 'saved',
          work: null,
          tasks: { total: 0, done: 0 },
          awaitingDecision: 0,
          canCancelWithoutWork: true,
          canPause: false,
        },
      ],
      active: [
        {
          requirementId: 'req-a',
          identity: 'req-a',
          title: 'running',
          goal: 'g',
          lifecycle: 'active',
          phase: 'execute',
          recordVersion: 2,
          executionAvailability: 'local',
          evidenceAvailability: 'full',
          saveState: 'saved',
          work: {
            id: 'work-1',
            status: 'running',
            level: 'L2',
            intent: 'delivery',
            blockers: ['b1'],
          },
          tasks: { total: 3, done: 1 },
          awaitingDecision: 2,
          canCancelWithoutWork: false,
          canPause: true,
        },
      ],
      completed: [],
      archived: [],
    },
    excludedWorkIds: ['l1-work'],
    rule: {
      l1NotOnBoard: true,
      queuedWithoutWorkCancellable: true,
      pauseQueuedWithoutWork: 'INVALID_STATE',
    },
  });

  it('renders the four columns with the requirement identity on every card', () => {
    const html = renderBoardPage({ model, projectId: 'proj-1', t });
    for (const column of ['queued', 'active', 'completed', 'archived']) {
      expect(html).toContain(`data-column="${column}"`);
    }
    expect(html).toContain('data-identity="req-q"');
    expect(html).toContain('data-identity="req-a"');
    expect(html).toContain('data-work="work-1"');
    expect(html).toContain('role="group"');
  });

  it('offers a direct cancel and a refused pause for Queued without Work (AC-068)', () => {
    const html = renderBoardPage({ model, projectId: 'proj-1', t });
    expect(html).toContain('data-action="cancel" data-requirement="req-q"');
    expect(html).toContain(
      'data-action="pause" data-requirement="req-q" data-refused="INVALID_STATE"',
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-i18n="board.pauseQueuedRefused"');
  });

  it('states that L1 work stays off the board', () => {
    const html = renderBoardPage({ model, projectId: 'proj-1', t });
    expect(html).toContain('data-i18n="board.l1Hidden"');
    expect(html).toContain('data-excluded="l1-work"');
  });

  it('renders the branch, commit and push state and offers the lifecycle actions (AC-090)', () => {
    const gitModel = boardModel(
      {
        columns: {
          queued: [
            {
              requirementId: 'req-q',
              identity: 'req-q',
              lifecycle: 'queued',
              recordVersion: 2,
              saveState: 'saved',
              portableRef: { path: 'p', revision: 'd'.repeat(40) },
              canCancelWithoutWork: true,
            },
          ],
          active: [
            {
              requirementId: 'req-a',
              identity: 'req-a',
              lifecycle: 'active',
              recordVersion: 4,
              saveState: 'saved',
              portableRef: { path: 'p', revision: 'e'.repeat(40) },
              git: { unpushed: true },
              canPause: true,
              work: { id: 'work-1', status: 'running', version: 6 },
            },
          ],
          completed: [
            {
              requirementId: 'req-c',
              identity: 'req-c',
              lifecycle: 'completed',
              recordVersion: 3,
              saveState: 'saved',
            },
          ],
          archived: [],
        },
      },
      { branch: 'agentdev/main' },
    );
    const html = renderBoardPage({ model: gitModel, projectId: 'proj-1', t });
    // The real payload values reach the card, full commit and all.
    expect(html).toContain('data-git-branch="agentdev/main"');
    expect(html).toContain(`data-git-commit="${'e'.repeat(40)}"`);
    expect(html).toContain('data-git-unpushed="true"');
    expect(html).toContain('Delivery branch: agentdev/main');
    expect(html).toContain(`Commit: ${'e'.repeat(12)}`);
    expect(html).toContain('Push state: Unpushed');
    // A payload with no push state says so instead of claiming unpushed.
    expect(html).toContain('data-git-unpushed="unreported"');
    expect(html).toContain('Push state: Push state not reported');
    // The card actions carry the requirement id the command needs.
    expect(html).toContain('data-action="pause" data-work="work-1"');
    expect(html).toContain('data-action="complete" data-requirement="req-a"');
    expect(html).toContain('data-record-version="4"');
    expect(html).toContain('data-work-version="6"');
    expect(html).toContain('data-action="archive" data-requirement="req-q"');
    expect(html).toContain('data-action="archive" data-requirement="req-c"');
    expect(html).toContain('data-i18n-aria="board.actions"');
  });

  it('offers Continue only for a record that waits to continue (AC-089)', () => {
    const imported = boardModel({
      columns: {
        active: [
          {
            requirementId: 'req-i',
            identity: 'req-i',
            lifecycle: 'active',
            recordVersion: 1,
            executionAvailability: 'needs_replan',
          },
        ],
      },
    });
    const html = renderBoardPage({ model: imported, projectId: 'proj-1', t });
    expect(html).toContain('data-action="continue" data-requirement="req-i"');
    // The ordinary active card from the fixture never shows Continue.
    expect(renderBoardPage({ model, projectId: 'proj-1', t })).not.toContain(
      'data-action="continue"',
    );
  });
});

// ---------------------------------------------------------------------------
// Detail (AC-070)
// ---------------------------------------------------------------------------

describe('requirement detail page', () => {
  const baseDetail = requirementDetail({
    requirement: {
      id: 'req-1',
      title: 'Ship <it>',
      goal: 'goal',
      lifecycle: 'active',
      recordVersion: 4,
      saveState: 'saved',
      work: { id: 'work-1', status: 'running' },
      acceptance: [],
      openQuestions: [],
    },
    artifacts: [],
    runs: [],
  });

  it('disables the approve control for an expired plan version and shows why', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 1,
        work: { id: 'work-1', status: 'running' },
      },
      artifacts: [],
      runs: [],
      plan: { workId: 'work-1', revision: 'rev', currentVersion: 9, requestedVersion: 8 },
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-expired="true"');
    expect(html).toContain('data-current-version="9"');
    expect(html).toContain('data-requested-version="8"');
    expect(html).toContain('id="planExpired"');
    expect(html).toMatch(/id="approvePlan"[^>]*disabled/u);
  });

  it('leaves a current plan version approvable with its version on the button', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 1,
        work: { id: 'w' },
      },
      artifacts: [],
      runs: [],
      plan: { workId: 'w', revision: 'rev', currentVersion: 5, requestedVersion: 5 },
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-plan-version="5"');
    expect(html).not.toMatch(/id="approvePlan"[^>]*disabled/u);
  });

  it('renders the truncation notice and the full-download entry for a preview', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 1,
        work: { id: 'w' },
      },
      artifacts: [
        {
          id: 'art-1',
          kind: 'diff',
          authorRole: 'backend',
          artifactVersion: 3,
          validity: 'valid',
          mime: 'text/plain',
          bytes: 2_000_000,
          hash: 'h',
        },
      ],
      runs: [],
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-artifact="art-1"');
    expect(html).toContain('data-version="3"');
    expect(html).toContain('data-i18n="detail.previewTruncated"');
    expect(html).toContain('data-i18n="detail.download"');
    expect(html).toContain('data-download-artifact="art-1"');
  });

  it('shows a Superseded badge for an invalidated artifact version', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 1,
        work: { id: 'w' },
      },
      artifacts: [
        {
          id: 'art-1',
          kind: 'plan',
          authorRole: 'planning',
          artifactVersion: 1,
          validity: 'invalidated',
          mime: 'text/plain',
        },
      ],
      runs: [],
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-validity="invalidated"');
    expect(html).toContain('Superseded');
  });

  it('escapes project content instead of rendering it as markup', () => {
    const html = renderRequirementPage({ detail: baseDetail, projectId: 'proj-1', t });
    expect(html).toContain('Ship &lt;it&gt;');
    expect(html).not.toContain('Ship <it>');
  });

  it('renders the delivery branch, commit, push state and the card actions (AC-090)', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 7,
        saveState: 'saved',
        portableRef: { path: 'p', revision: 'f'.repeat(40) },
        git: { unpushed: true },
        work: { id: 'work-1', status: 'running', version: 5 },
      },
      artifacts: [],
      runs: [],
      branch: 'agentdev/main',
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-git-branch="agentdev/main"');
    expect(html).toContain(`data-git-commit="${'f'.repeat(40)}"`);
    expect(html).toContain('data-git-unpushed="true"');
    expect(html).toContain(`Commit: ${'f'.repeat(12)}`);
    expect(html).toContain('Push state: Unpushed');
    expect(html).toContain('id="detailActions"');
    expect(html).toContain('data-action="complete" data-requirement="req-1"');
    expect(html).toContain('data-action="pause" data-requirement="req-1" data-work="work-1"');
    expect(html).toContain('data-work-version="5"');
    expect(html).toContain('id="detailError"');
  });

  it('says the push state is unreported when the read payload carries none (AC-090)', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'queued',
        recordVersion: 1,
        work: null,
      },
      artifacts: [],
      runs: [],
      branch: 'agentdev/main',
    });
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-git-unpushed="unreported"');
    expect(html).toContain('Push state: Push state not reported');
    expect(html).toContain('data-action="archive" data-requirement="req-1"');
  });

  it('renders an attempt/epoch table and evidence for a Run detail', () => {
    const detail = runDetail({
      run: { id: 'run-1', workId: 'w', role: 'backend', status: 'running' },
      attempts: [{ id: 'att-1', number: 1, ownerEpoch: 4, status: 'running', runnerId: 'r1' }],
      stageResults: [
        { id: 'sr-1', stage: 'execute', status: 'completed', evidenceRefs: ['ref-1'] },
      ],
    });
    const html = renderRunsPage({
      model: { onBoard: [], direct: [] },
      detail,
      projectId: 'proj-1',
      t,
    });
    expect(html).toContain('data-epoch="4"');
    expect(html).toContain('data-attempt="att-1"');
    expect(html).toContain('data-ref="ref-1"');
    expect(html).toContain('data-success="false"');
  });

  it('never marks a non-completed Run as successful', () => {
    const detail = runDetail({
      run: { id: 'run-1', workId: 'w', role: 'backend', status: 'cancelled' },
      attempts: [],
      stageResults: [],
    });
    const html = renderRunsPage({
      model: { onBoard: [], direct: [] },
      detail,
      projectId: 'proj-1',
      t,
    });
    expect(html).toContain('data-success="false"');
  });

  it('derives the plan version only from the gate answer, not from plan artifacts (W9R1-12)', () => {
    const gateAnswer = {
      workId: 'w',
      revision: 'rev',
      currentVersion: 2,
      requestedVersion: 2,
      current: true,
      approved: true,
      gateStatus: 'approved',
      approvedVersion: 2,
      approvedAt: '2026-01-01T00:00:00.000Z',
      authorizationId: 'auth-1',
      plan: { goal: 'g', tasks: [{ id: 't1' }] },
      approval: { enabled: true, reason: null },
    };
    const card = planCard({ work: {}, workId: 'w', revision: 'rev', planCurrent: gateAnswer });
    expect(card.currentVersion).toBe(2);
    expect(card.expired).toBe(false);
    expect(card.approvalEnabled).toBe(true);
    // A stale gate stays expired even when a historical artifact claims the version.
    const stale = planCard({
      work: {},
      workId: 'w',
      revision: 'rev',
      planCurrent: { ...gateAnswer, gateStatus: 'stale' },
    });
    expect(stale.expired).toBe(true);
    // Without the gate answer the card must not promise an approval the page cannot build.
    const missing = planCard({ work: {}, workId: 'w', revision: 'rev' });
    expect(missing.approvalEnabled).toBe(false);
    expect(missing.approvalReason).not.toBeNull();
  });

  it('parses the planVersion query parameter and rejects a malformed one (W9R1-02)', () => {
    expect(planVersionOf('3')).toBe(3);
    expect(planVersionOf('0')).toBe(0);
    expect(planVersionOf(null)).toBeUndefined();
    expect(planVersionOf('')).toBeUndefined();
    expect(planVersionOf('abc')).toBeUndefined();
    expect(planVersionOf('-1')).toBeUndefined();
    expect(planVersionOf('2.5')).toBeUndefined();
  });

  it('disables approval with a visible reason when the gate cannot hand over the Plan (W9R1-01)', () => {
    const requirement = {
      id: 'req-1',
      title: 'x',
      goal: 'g',
      lifecycle: 'active',
      recordVersion: 1,
      work: { id: 'w' },
    };
    const blocked = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: {
        workId: 'w',
        revision: 'rev',
        currentVersion: 4,
        requestedVersion: 4,
        approvalEnabled: false,
        approvalReason: 'the Plan body could not be read back from the artifact store',
      },
    });
    expect(blocked.plan?.approvalEnabled).toBe(false);
    expect(blocked.plan?.approvalReason).toBe(
      'the Plan body could not be read back from the artifact store',
    );
    const html = renderRequirementPage({ detail: blocked, projectId: 'proj-1', t });
    expect(html).toContain('data-approvable="false"');
    expect(html).toContain('id="approveBlocked"');
    expect(html).toContain('the Plan body could not be read back from the artifact store');
    expect(html).toMatch(/id="approvePlan"[^>]*disabled/u);
    // The card is current, so it must not claim the version is expired.
    expect(html).not.toContain('id="planExpired"');

    const allowed = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: {
        workId: 'w',
        revision: 'rev',
        currentVersion: 4,
        requestedVersion: 4,
        approvalEnabled: true,
        approvalReason: null,
      },
    });
    const allowedHtml = renderRequirementPage({ detail: allowed, projectId: 'proj-1', t });
    expect(allowedHtml).toContain('data-approvable="true"');
    expect(allowedHtml).not.toMatch(/id="approvePlan"[^>]*disabled/u);
  });

  it('renders the disabled approval reason from the dictionary, not the daemon sentence (W9R2-05)', () => {
    const requirement = {
      id: 'req-1',
      title: 'x',
      goal: 'g',
      lifecycle: 'active',
      recordVersion: 1,
      work: { id: 'w' },
    };
    const blocked = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: {
        workId: 'w',
        revision: 'rev',
        currentVersion: 0,
        requestedVersion: 0,
        approvalEnabled: false,
        // The daemon's English diagnostic plus its machine-readable code.
        approvalReason: 'the gate holds no approved Plan for this Work revision',
        approvalReasonCode: 'no_plan',
      },
    });
    const zh = renderRequirementPage({ detail: blocked, projectId: 'proj-1', t: tzh });
    // The Chinese page shows the Chinese interface string …
    expect(zh).toContain(tzh('detail.approveReason.no_plan'));
    expect(zh).toContain('data-i18n="detail.approveReason.no_plan"');
    // … and the daemon's English sentence survives only as a diagnostic tooltip.
    expect(zh).toContain('title="the gate holds no approved Plan for this Work revision"');
    expect(zh).not.toMatch(/>the gate holds no approved Plan for this Work revision</u);
    // `data-approve-reason` on the card is the machine-readable code.
    expect(zh).toContain('data-approve-reason="no_plan"');

    // A code the dictionary does not know falls back to the generic wording rather
    // than rendering the raw code or the daemon's sentence as the visible text.
    const unknown = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: {
        workId: 'w',
        revision: 'rev',
        currentVersion: 0,
        requestedVersion: 0,
        approvalEnabled: false,
        approvalReason: 'something the daemon invented',
        approvalReasonCode: 'not_a_known_code',
      },
    });
    const fallback = renderRequirementPage({ detail: unknown, projectId: 'proj-1', t: tzh });
    expect(fallback).toContain(tzh('detail.approveUnavailable'));
    expect(fallback).not.toMatch(/>something the daemon invented</u);
  });

  it('renders an explicit expired card for a requested historical version (W9R1-02)', () => {
    const detail = requirementDetail({
      requirement: {
        id: 'req-1',
        title: 'x',
        goal: 'g',
        lifecycle: 'active',
        recordVersion: 1,
        work: { id: 'w' },
      },
      artifacts: [],
      runs: [],
      plan: {
        workId: 'w',
        revision: 'rev',
        currentVersion: 5,
        requestedVersion: 4,
        approvalEnabled: false,
      },
    });
    expect(detail.plan?.expired).toBe(true);
    const html = renderRequirementPage({ detail, projectId: 'proj-1', t });
    expect(html).toContain('data-requested-version="4"');
    expect(html).toContain('data-current-version="5"');
    expect(html).toContain('data-expired="true"');
    expect(html).toContain('id="planExpired"');
    expect(html).toMatch(/id="approvePlan"[^>]*disabled/u);
  });
});

// ---------------------------------------------------------------------------
// Docs / Files / Agents / Settings / Inbox / Runs
// ---------------------------------------------------------------------------

describe('docs page', () => {
  it('names the three views, the revision and the search box', () => {
    const html = renderDocsPage({
      views: {
        delivered: {
          items: [{ featureId: 'F-1', documentPath: 'docs/F-1.md', state: 'valid' }],
          sourceRevision: 'abc',
          projectionState: 'valid',
          unknown: [],
        },
        design: { items: [] },
        work: { items: [] },
      },
      activeView: 'delivered',
      query: 'F-1',
      projectId: 'proj-1',
      t,
    });
    expect(html).toContain('view=delivered');
    expect(html).toContain('view=design');
    expect(html).toContain('view=work');
    expect(html).toContain('data-feature="F-1"');
    expect(html).toContain('id="docsQuery"');
    expect(html).toContain('abc');
    expect(html).toContain('data-i18n="files.snapshotUntouched"');
  });
});

describe('files page (AC-077)', () => {
  it('shows the branch, the target revision and the read-only boundary', () => {
    const html = renderFilesPage({
      model: {
        root: '/repo',
        revision: 'rev-1',
        branch: 'agentdev/main',
        query: '',
        truncated: false,
        entries: [{ path: 'src/index.ts', kind: 'file', bytes: 10 }],
      },
      preview: {
        path: 'src/index.ts',
        content: 'export {};',
        truncated: true,
        hash: 'h',
        mime: 'text/plain',
        downloadHref: '/x',
      },
      error: null,
      projectId: 'proj-1',
      t,
    });
    expect(html).toContain('data-revision="rev-1"');
    expect(html).toContain('data-branch="agentdev/main"');
    expect(html).toContain('data-i18n="files.rootBoundary"');
    expect(html).toContain('data-i18n="files.snapshotUntouched"');
    expect(html).toContain('src/index.ts');
    expect(html).toContain('id="fileTruncated"');
  });

  it('renders a refused path as an error with its code, not an empty tree', () => {
    const html = renderFilesPage({
      model: {
        root: '/repo',
        revision: 'rev-1',
        branch: 'agentdev/main',
        query: '',
        truncated: false,
        entries: [],
      },
      preview: null,
      error: { code: 'NOT_FOUND', message: 'path /etc/passwd is outside the project root' },
      projectId: 'proj-1',
      t,
    });
    expect(html).toContain('data-code="NOT_FOUND"');
    expect(html).toContain('outside the project root');
  });
});

describe('agents page', () => {
  it('is read-only and reports an unusable role with its reason', () => {
    const model = agentsModel({
      roles: [
        {
          role: 'chief',
          usable: false,
          unavailableReason: 'provider p is not configured',
          profile: null,
        },
        {
          role: 'backend',
          usable: true,
          profile: {
            providerId: 'p',
            modelId: 'm',
            reasoning: 'high',
            sources: { modelId: 'globalRole' },
            toolSubset: ['read_file'],
          },
        },
      ],
      providers: [],
      activeRuns: 0,
    });
    const html = renderAgentsPage({ model, t });
    expect(html).toContain('data-i18n="agents.readOnly"');
    expect(html).toContain('data-role="chief"');
    expect(html).toContain('not configured');
    expect(html).toContain('read_file');
    expect(html).not.toContain('<button');
  });
});

describe('settings page (AC-075)', () => {
  it('renders the active revision, the editor and the test control', () => {
    const model = settingsModel({
      scope: 'global',
      version: 2,
      revision: '2',
      providers: [],
      roleProfiles: {},
      limits: {},
      effectiveLimits: {},
      policy: {},
    });
    const html = renderSettingsPage({ model, settings: { projectId: 'proj-1' }, t });
    expect(html).toContain('data-revision="2"');
    expect(html).toContain('id="configForm"');
    expect(html).toContain('id="configPatch"');
    expect(html).toContain('id="configSave"');
    expect(html).toContain('id="configTest"');
    expect(html).toContain('data-i18n="settings.unchanged"');
  });

  /** One provider, as `config.get` answers it after a successful save. */
  const providerModel = (secretConfigured: boolean) =>
    settingsModel({
      scope: 'global',
      version: 4,
      revision: '4',
      providers: [
        {
          providerId: 'p1',
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          enabled: true,
          secretConfigured,
          models: [
            {
              id: 'claude-sonnet',
              contextWindow: 200000,
              maxOutputTokens: 8192,
              reasoningLevels: ['off', 'low'],
              vision: true,
            },
          ],
        },
      ],
      roleProfiles: {},
      limits: {},
      effectiveLimits: {},
      policy: {},
    });

  it('gives every provider row a real editor with a never-pre-filled password field (WP-12 T1.2B)', () => {
    const html = renderSettingsPage({
      model: providerModel(true),
      settings: { projectId: 'proj-1' },
      t,
    });
    expect(html).toContain('data-provider="p1"');
    expect(html).toContain('class="provider-form"');
    // The four `ProviderInput` fields the operator can edit, plus the secret.
    for (const field of ['providerId', 'type', 'baseUrl', 'enabled', 'models', 'secret']) {
      expect(html).toContain(`data-field="${field}"`);
    }
    // The key control is a password field that never carries a value and is never
    // translated or autocompleted.
    expect(html).toMatch(
      /data-field="secret"[^>]*type="password"[^>]*value=""[^>]*autocomplete="off"[^>]*data-translatable="false"/u,
    );
    expect(html).not.toMatch(/data-field="secret"[^>]*value="[^"]+"/u);
    expect(html).toContain('data-i18n="settings.providerSave"');
    expect(html).toContain('data-i18n="settings.providerTest"');
    expect(html).toContain('data-i18n="settings.apiKeyHint"');
    expect(html).toContain('data-i18n="settings.newProvider"');
    expect(html).toContain('data-i18n="settings.providerTypeAnthropic" selected');
    // The declared model is the choice for the connection test.
    expect(html).toContain('class="provider-test-model"');
    expect(html).toContain('<option value="claude-sonnet">claude-sonnet</option>');
    // A provider-less installation still gets the create form.
    expect(html).toContain('data-new="true"');
    for (const key of usedKeys(html)) expect(UI_STRINGS[key], key).toBeDefined();
  });

  it('never renders a provider secret value, even for post-save state (WP-12 T1.2B)', () => {
    const secret = 'sk-live-DO-NOT-LEAK-12345';
    // After `provider.upsert` the page re-renders from `config.get` with the new
    // version and `secretConfigured:true` — and the daemon may still carry a stray
    // legacy field. Neither may reach the HTML or the serialized model.
    const raw = {
      scope: 'global',
      version: 6,
      revision: '6',
      providers: [
        {
          providerId: 'p1',
          type: 'openai-compatible',
          baseUrl: 'https://api.example/v1',
          enabled: true,
          secretRef: 'provider/p1',
          secretConfigured: true,
          secret,
          apiKey: secret,
          models: [
            {
              id: 'm',
              contextWindow: 1000,
              maxOutputTokens: 100,
              reasoningLevels: ['off'],
              vision: false,
              apiKey: secret,
            },
          ],
        },
      ],
      roleProfiles: {},
      limits: {},
      effectiveLimits: {},
      policy: {},
    };
    const model = settingsModel(raw);
    const html = renderSettingsPage({ model, settings: { projectId: 'proj-1' }, t });
    for (const rendered of [html, JSON.stringify(model)]) {
      expect(rendered).not.toContain(secret);
      expect(rendered).not.toContain('sk-live');
      expect(rendered).not.toContain('secretRef');
    }
    // Only the boolean state is rendered.
    expect(html).toContain('Secret configured');
  });

  it('disables the connection test until a provider declares a model', () => {
    const model = settingsModel({
      scope: 'global',
      version: 1,
      revision: '1',
      providers: [
        {
          providerId: 'p1',
          type: 'google',
          baseUrl: 'https://generativelanguage.googleapis.com',
          enabled: true,
          secretConfigured: false,
          models: [],
        },
      ],
      roleProfiles: {},
      limits: {},
      effectiveLimits: {},
      policy: {},
    });
    const html = renderSettingsPage({ model, settings: {}, t });
    expect(html).toContain('data-i18n="settings.testNeedsModel"');
    expect(html).toMatch(/class="provider-test"[^>]*disabled/u);
  });
});

describe('inbox page (AC-074)', () => {
  it('renders one row per target version and disables an expired decision', () => {
    const model = inboxModel({
      items: [
        {
          kind: 'decision',
          id: 'd1',
          workId: 'w1',
          decisionKind: 'start',
          targetRef: { id: 't', version: 3 },
          targetVersion: 3,
          choices: ['now', 'later'],
          state: 'pending',
          actionable: true,
        },
        {
          kind: 'decision',
          id: 'd2',
          workId: 'w1',
          decisionKind: 'start',
          targetRef: { id: 't', version: 4 },
          targetVersion: 4,
          choices: ['now', 'later'],
          state: 'expired',
          actionable: false,
        },
        { kind: 'finding', id: 'f1', workId: 'w1', severity: 'P1', count: 3, actionable: true },
      ],
      unread: 1,
    });
    const html = renderInboxPage({ model, projectId: 'proj-1', t });
    expect(html.match(/data-kind="decision"/gu) ?? []).toHaveLength(2);
    expect(html).toContain('data-target-version="4"');
    expect(html).toMatch(/data-decision="d2"[^>]*data-choice="now"[^>]*disabled/u);
    expect(html).toContain('data-i18n="inbox.dedup"');
    // An expired decision says so in text, not only through its disabled styling.
    expect(html).toContain('An expired decision can no longer be applied.');
    expect(html).toContain('data-state="expired"');
    // The three blocking findings are summarised as one row with the true count.
    expect(html.match(/data-kind="finding"/gu) ?? []).toHaveLength(1);
    expect(html).toContain('>3<');
  });
});

describe('inbox request cards (WP-12 T4c, AC-074)', () => {
  const productItem: JsonObject = {
    kind: 'decision',
    id: 'd-product',
    workId: 'w1',
    decisionKind: 'product',
    targetRef: { id: 'artifact-1', version: 2, hash: 'hash-1' },
    targetVersion: 2,
    choices: ['accept', 'decline'],
    state: 'pending',
    actionable: true,
  };
  const permissionItem: JsonObject = {
    kind: 'decision',
    id: 'd-permission',
    workId: 'w2',
    decisionKind: 'permission',
    targetRef: { id: 'tool-op-1', version: 1, hash: 'binding-1' },
    targetVersion: 1,
    choices: ['approve', 'deny'],
    state: 'pending',
    actionable: true,
    operation: 'bash',
    targets: ['/tmp/repo'],
    inputHash: 'input-1',
  };
  const waitingRun = {
    runId: 'run-2',
    role: 'backend',
    stage: 'execute',
    status: 'waiting_permission',
  };
  const render = (items: readonly JsonValue[], context = {}): string =>
    renderInboxPage({
      model: inboxModel({ items: [...items], unread: items.length }, context),
      projectId: 'proj-1',
      t,
    });

  it('renders a product decision with its question, choices, target and raiser', () => {
    const html = render([productItem], {
      questions: { 'artifact-1:2': { text: 'Ship the smaller change?', error: null } },
    });
    expect(html).toContain('data-entry="decision"');
    expect(html).toContain('data-question-body');
    expect(html).toContain('Ship the smaller change?');
    // The question is project content: marked as never translated (AC-073).
    expect(html).toMatch(/data-question-body data-i18n-project/u);
    expect(html).toContain('data-i18n="inbox.question"');
    expect(html).toContain('data-artifact-ref="artifact-1"');
    expect(html).toContain('data-choice="accept"');
    expect(html).toContain('data-target-version="2"');
    // `protocol.md` §6: a product decision is raised by the Chief.
    expect(html).toContain('Chief');
    for (const key of usedKeys(html)) expect(UI_STRINGS[key], key).toBeDefined();
  });

  it('states an unreadable question and an empty question instead of an empty card', () => {
    const failed = render([productItem], {
      questions: { 'artifact-1:2': { text: '', error: 'ARTIFACT_MISSING: gone' } },
    });
    expect(failed).toContain('data-question-error');
    expect(failed).toContain('The question text could not be read from the decision artifact.');
    // The daemon's diagnostic is a title, never the visible sentence (W9R2-05).
    expect(failed).toContain('title="ARTIFACT_MISSING: gone"');

    const empty = render([productItem], {
      questions: { 'artifact-1:2': { text: '   ', error: null } },
    });
    expect(empty).toContain('data-question-empty');
    expect(empty).toContain('The decision artifact carried no question text.');
    expect(empty).not.toContain('data-question-body');
  });

  it('shows what an approval grants before the click, with a required denial reason', () => {
    const html = render([permissionItem], { waitingRuns: { w2: waitingRun } });
    expect(html).toContain('data-entry="permission"');
    expect(html).toContain('data-tool-operation="tool-op-1"');
    expect(html).toContain('data-binding-operation>bash<');
    expect(html).toContain('data-binding-targets>/tmp/repo<');
    expect(html).toContain('data-binding-input-hash>input-1<');
    expect(html).toContain('data-binding-hash>binding-1<');
    expect(html).toContain('data-binding-run>run-2<');
    expect(html).toContain('data-binding-raised-by>backend · execute · Waiting for permission<');
    expect(html).toContain('data-binding-missing="false"');
    // The approval is offered, not taken: a named button, no auto-approval.
    const approve = html.slice(html.indexOf('data-permission="approve"'));
    expect(approve.slice(0, approve.indexOf('</button>'))).not.toContain('disabled');
    expect(html).toContain('data-permission="deny"');
    expect(html).toContain('data-permission-reason');
    expect(html).toContain('data-i18n="inbox.denyReason"');
    expect(html).toContain('data-i18n="inbox.permissionBinding"');
    for (const key of usedKeys(html)) expect(UI_STRINGS[key], key).toBeDefined();
  });

  it('disables a blind approval and still offers a recorded denial', () => {
    const html = render([
      {
        kind: 'decision',
        id: 'd-blind',
        workId: 'w3',
        decisionKind: 'permission',
        targetRef: { id: 'tool-op-2', version: 1, hash: 'binding-2' },
        targetVersion: 1,
        choices: ['approve', 'deny'],
        state: 'pending',
        actionable: true,
      },
    ]);
    expect(html).toContain('data-binding-missing="true"');
    expect(html).toMatch(/data-permission="approve"[^>]*disabled/u);
    expect(html).toContain('data-i18n="inbox.bindingMissing"');
    const deny = html.slice(html.indexOf('data-permission="deny"'));
    expect(deny.slice(0, deny.indexOf('</button>'))).not.toContain('disabled');
  });

  it('renders a resolved permission request inert and a legacy decision as before', () => {
    const html = render([
      {
        ...permissionItem,
        id: 'd-done',
        state: 'accepted',
        actionable: false,
        operation: 'bash',
        targets: [],
        inputHash: 'input-1',
      },
      { ...productItem, id: 'd-expired', state: 'expired', actionable: false },
    ]);
    expect(html).toMatch(/data-decision="d-done"[^>]*aria-disabled="true"/u);
    expect(html).toMatch(/data-permission="approve"[^>]*disabled/u);
    expect(html).toMatch(/data-decision="d-expired"[^>]*aria-disabled="true"/u);
    // An empty target list is stated, not rendered as a blank value.
    expect(html).toContain('No targets recorded (a command operation).');
  });

  it('never renders a secret value or a secretRef in either entry kind', () => {
    const secret = 'sk-live-DO-NOT-LEAK-12345';
    const html = render([
      {
        ...permissionItem,
        secret,
        secretRef: 'provider/p1',
        targetRef: { id: 'op-1', version: 1, hash: 'h', secretRef: 'provider/p1' },
      },
      { ...productItem, secret, secretRef: 'provider/p1' },
    ]);
    expect(html).not.toContain(secret);
    expect(html).not.toContain('secretRef');
    expect(html).not.toContain('sk-live');
  });
});

describe('runs page', () => {
  it('separates board work from direct/L1 work', () => {
    const model = runsModel([
      { id: 'w1', goal: 'g', level: 'L2', intent: 'delivery', status: 'running', runCount: 1 },
      { id: 'w2', goal: 'g', level: 'L1', intent: 'delivery', status: 'completed', runCount: 0 },
    ]);
    const html = renderRunsPage({ model, detail: null, projectId: 'proj-1', t });
    expect(html).toContain('data-i18n="runs.l1"');
    expect(html).toContain('data-work="w1"');
    expect(html).toContain('data-work="w2"');
  });
});

describe('projects page', () => {
  it('links the open project into each surface and states the Chief-only rule', () => {
    const html = renderProjectsPage({
      projects: [
        { id: 'proj-1', root: '/repo', head: 'abcdef0123456789', state: 'open', trust: 'trusted' },
      ],
      currentProjectId: 'proj-1',
      counts: { works: 2, requirements: 1 },
      t,
      language: 'en',
      panelMode: 'open',
    });
    expect(html).toContain('data-project="proj-1"');
    expect(html).toContain('/projects/proj-1/chief');
    expect(html).toContain('data-i18n="shell.chiefOnlyControls"');
  });
});

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

describe('document rendering', () => {
  it('declares the document language and escapes text', () => {
    const html = renderDocument({
      lang: 'zh-CN',
      title: 'a <b>',
      body: '<main id="main"></main>',
      statusText: 'ready',
    });
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('a &lt;b&gt;');
    expect(html).toContain('/assets/app.js');
    expect(html).toContain('/assets/styles.css');
  });

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  const languages: readonly Language[] = ['en', 'zh'];
  it('has a non-empty string for every key in every locale', () => {
    for (const language of languages) {
      const translate = translator(language);
      for (const key of translationKeys()) {
        expect(translate(key).length, `${language}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});
