/**
 * Project tool (P3-e): `project.initialize` establishes the fixed knowledge entries a project
 * workspace is usable through (K-02/P-02).
 *
 * The tool never guesses: it shows the real entry gaps, the authority it reuses and the exact content
 * it would write; it writes only when the chief asks for write use *and* cites the user's explicit
 * consent. The program remembers what this session last saw, so a file changed by someone else is
 * returned instead of silently replaced; no version is carried by the model. `ready` means the entries
 * really exist, not that the call succeeded.
 */
import { readFileSync } from 'node:fs';
import { digestOfText, initializeProject, resolveProjectFile, reusedAuthorityIssues } from '../runtime/project-store.ts';
import { resolveAuthorizationRefs } from '../runtime/authorization.ts';
import { asRecord, fail, messageOf, ok, readString, readStringArray } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import type { Store } from '../store/store.ts';

export interface ProjectToolContext {
  readonly store: Store;
  readonly projectId: string;
  readonly cwd: string;
  readonly roleId: string;
  readonly sessionId: string;
}

export type ProjectToolContextResolver = () => ProjectToolContext;

interface PlannedEntry {
  readonly path: string;
  readonly content: string;
}

/**
 * What this session has shown the chief about each project entry (digest, or null for "does not
 * exist"). A write may only replace a file whose current content is the one that was shown.
 */
const observed = new Map<string, string | null>();

function observedKey(context: ProjectToolContext, path: string): string {
  return `${context.cwd}\0${context.sessionId}\0${path}`;
}

function currentEntryVersion(cwd: string, path: string): string | null {
  const resolved = resolveProjectFile(cwd, path);
  if (resolved === undefined) {
    return null;
  }
  try {
    return digestOfText(readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
}

function currentEntryText(cwd: string, path: string): string | undefined {
  const resolved = resolveProjectFile(cwd, path);
  if (resolved === undefined) {
    return undefined;
  }
  try {
    return readFileSync(resolved, 'utf8');
  } catch {
    return undefined;
  }
}

export function createProjectTool(contextOf: ProjectToolContextResolver): DomainTool {
  return {
    name: 'project',
    label: 'project',
    description: [
      'Initialize the project knowledge entries: a preview shows the real gaps and the exact files; writing needs the user decision cited.',
      'Write the same content you previewed. If someone changed a file in between, the current content is returned instead of overwriting it.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['initialize'] },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
        reusedAuthorityRefs: { type: 'array', items: { type: 'string' } },
        requestWriteUse: { type: 'boolean' },
        authorizationRef: {
          type: 'object',
          properties: { inputId: { type: 'string' }, interactionId: { type: 'string' } },
          additionalProperties: false,
        },
      },
      required: ['op', 'files', 'requestWriteUse'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams) {
      const context = contextOf();
      const params = asRecord(rawParams);
      if (params === undefined) {
        return fail('INVALID_ARGUMENT', 'params must be an object');
      }
      if ((readString(params, 'op') ?? 'initialize') !== 'initialize') {
        return fail('INVALID_ARGUMENT', `unknown op ${String(params['op'])}`);
      }
      if (context.roleId !== 'chief') {
        return fail('FORBIDDEN', 'only the chief session establishes the project entries');
      }
      const project = context.store.getProject(context.projectId);
      if (project === undefined) {
        return fail('NOT_FOUND', `project ${context.projectId} does not exist`);
      }
      const files = parseFiles(params['files']);
      if (files === undefined || files.length === 0) {
        return fail('INVALID_ARGUMENT', 'files must be a non-empty list of {path, content}');
      }
      const emptyContent = files.filter((entry) => entry.content.trim() === '');
      if (emptyContent.length > 0) {
        // The preview must not promise an entry the write would refuse.
        return fail('INVALID_ARGUMENT', 'every entry needs content', {
          paths: emptyContent.map((entry) => entry.path),
        });
      }
      const reusedAuthorityRefs = readStringArray(params, 'reusedAuthorityRefs') ?? [];
      const authorityIssues = reusedAuthorityIssues(context.cwd, reusedAuthorityRefs);
      if (authorityIssues.length > 0) {
        return fail('INVALID_ARGUMENT', 'the reused authority cannot be verified', {
          issues: authorityIssues,
          reusedAuthorityRefs,
        });
      }

      // A planned entry must be a real project-relative path, and no two entries may fight over one
      // file: both are argument errors, caught before anything is planned or written.
      const escaping = files.filter((entry) => resolveProjectFile(context.cwd, entry.path) === undefined);
      if (escaping.length > 0) {
        return fail('INVALID_ARGUMENT', 'every entry path must stay inside the project', {
          paths: escaping.map((entry) => entry.path),
        });
      }
      const resolvedPaths = files.map((entry) => resolveProjectFile(context.cwd, entry.path) as string);
      const duplicates = resolvedPaths.filter((path, index) => resolvedPaths.indexOf(path) !== index);
      if (duplicates.length > 0) {
        return fail('INVALID_ARGUMENT', 'the same file is planned more than once', {
          paths: [...new Set(duplicates)],
        });
      }
      const plan = planEntries(context.cwd, files);
      const requestWriteUse = params['requestWriteUse'] === true;
      if (!requestWriteUse) {
        // A preview is a real answer: the chief shows this to the user before asking for consent, and
        // the program remembers it as the content this session has seen.
        for (const entry of plan) {
          observed.set(observedKey(context, entry.path), entry.currentVersion);
        }
        return ok(
          `Project entry plan: ${plan.length} file(s), ${plan.filter((entry) => entry.action !== 'unchanged').length} to write`,
          {
            wrote: false,
            ready: false,
            cwd: context.cwd,
            reusedAuthorityRefs,
            files: plan,
            entryGaps: plan.filter((entry) => entry.action === 'create').map((entry) => entry.path),
            note: 'entries are written only when the user decision is cited',
          },
        );
      }

      const authorization = resolveAuthorizationRefs(context.store, context.projectId, params['authorizationRef']);
      if (!authorization.ok) {
        // The consent is the user's; without a real decision there is nothing to verify and no write.
        return fail('FORBIDDEN', `writing into this project needs the user's explicit consent (${authorization.message})`, {
          wrote: false,
          needsConsent: true,
          cwd: context.cwd,
          files: plan,
          reusedAuthorityRefs,
        });
      }
      // Never replace a file this session has not seen in its current state.
      for (const entry of plan) {
        if (entry.currentVersion === null) {
          continue;
        }
        const seen = observed.get(observedKey(context, entry.path));
        if (seen !== entry.currentVersion) {
          return fail(
            'VERSION_CONFLICT',
            seen === undefined
              ? `the entry ${entry.path} was not read in this session; preview it first`
              : `the entry ${entry.path} changed since it was shown; preview it again`,
            { wrote: false, files: plan, path: entry.path, currentText: currentEntryText(context.cwd, entry.path) ?? null },
          );
        }
      }
      const blockingConflict = plan.find((entry) => entry.action === 'conflict');
      if (blockingConflict !== undefined) {
        return fail('VERSION_CONFLICT', `the entry ${blockingConflict.path} changed since it was read`, {
          wrote: false,
          files: plan,
        });
      }

      let initialized;
      try {
        initialized = initializeProject({
          cwd: context.cwd,
          files: files.map((entry) => ({
            path: entry.path,
            expectedVersion: currentEntryVersion(context.cwd, entry.path),
            content: entry.content,
          })),
          recordSave: (entry) => {
            context.store.registerFileSave({
              requestKey: `${context.sessionId}:${entry.requestKey}`,
              target: entry.target,
              ...(entry.expectedVersion !== null ? { expectedVersion: entry.expectedVersion } : {}),
              contentHash: entry.contentHash,
              content: entry.content,
              state: entry.state,
              ...(entry.receipt !== undefined ? { receipt: entry.receipt } : {}),
            });
          },
        });
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the entries could not be written: ${messageOf(error)}`, {
          wrote: false,
          files: plan,
        });
      }

      const details = { cwd: context.cwd, files: initialized.files, reusedAuthorityRefs };
      if (!initialized.ready) {
        const conflict = initialized.files.some((entry) => entry.outcome === 'conflict');
        return fail(
          conflict ? 'VERSION_CONFLICT' : 'STORAGE_UNAVAILABLE',
          conflict
            ? 'at least one entry changed since it was read; nothing was overwritten'
            : 'the entries are not all in place yet',
          { ...details, missing: initialized.missing, ready: false, wrote: true },
        );
      }
      try {
        const updated = context.store.setProjectInitialization({
          projectId: context.projectId,
          initializationRef: {
            schemaVersion: 1,
            files: initialized.files.map((entry) => ({ path: entry.path, sha256: entry.version })),
            reusedAuthorityRefs,
          },
        });
        // The session has now seen exactly the written content.
        for (const entry of initialized.files) {
          if (entry.version !== null) {
            observed.set(observedKey(context, entry.path), entry.version);
          }
        }
        return ok(`Project ${context.projectId} entries are ready`, {
          ...details,
          ready: true,
          wrote: true,
          initializationRef: updated.initializationRef,
        });
      } catch (error) {
        // The files are really there; only the project record could not be updated.
        return fail('STORAGE_UNAVAILABLE', messageOf(error), {
          ...details,
          missing: [],
          ready: true,
          wrote: true,
        });
      }
    },
  };
}

/** What the entries really are right now, so the chief can show the user a truthful difference. */
function planEntries(
  cwd: string,
  files: readonly PlannedEntry[],
): Array<{
  readonly path: string;
  readonly action: 'create' | 'replace' | 'unchanged' | 'conflict';
  readonly currentVersion: string | null;
  readonly content: string;
}> {
  return files.map((entry) => {
    const resolved = resolveProjectFile(cwd, entry.path);
    const content = entry.content;
    if (resolved === undefined) {
      return { path: entry.path, action: 'conflict', currentVersion: null, content };
    }
    const currentVersion = currentEntryVersion(cwd, entry.path);
    return {
      path: entry.path,
      action:
        currentVersion === null
          ? 'create'
          : currentVersion === digestOfText(content)
            ? 'unchanged'
            : 'replace',
      currentVersion,
      content,
    };
  });
}

function parseFiles(value: unknown): PlannedEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const files: PlannedEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined) {
      return undefined;
    }
    const path = readString(record, 'path');
    const content = typeof record['content'] === 'string' ? (record['content'] as string) : undefined;
    if (path === undefined || content === undefined) {
      return undefined;
    }
    files.push({ path, content });
  }
  return files;
}
