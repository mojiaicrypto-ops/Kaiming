/**
 * The production ports `buildContext` needs (`context.md` §1).
 *
 * The Context layer deliberately owns no I/O: `SourceResolverPort`,
 * `ContentFetchPort`, `ContextGatesPort` and `SnapshotWriterPort` are injected. This
 * module is the one place that binds them to real sources, so the read-only
 * `context.preview` and a real Run's preparation assemble their context with exactly
 * the same policy, role contract, Git blobs and artifacts:
 *
 * - policy revision: `Work.policyRevision`;
 * - policy content: the Project's config policy (`policyConfigSchema`);
 * - role contract: the committed `docs/rules/agents.md` (`cold-start.ts`
 *   `CHIEF_RULES_PATH`), with the fixed-rules text as the only fallback;
 * - git sources: committed blobs at the source's revision (never the working tree);
 * - artifact sources: `ArtifactService` (id@version, content hash);
 * - snapshot writer: `createSnapshotDirectoryWriter` over the Project's data dir.
 */
import { createHash } from 'node:crypto';

import {
  CHIEF_RULES_PATH,
  ROLE_STAGES,
  createSnapshotDirectoryWriter,
  type ArtifactService,
  type ConfigStore,
  type ContentFetchPort,
  type ContextGatesPort,
  type ContextSourceRef,
  type ContextStage,
  type ProjectScope,
  type SnapshotWriterPort,
  type SourceResolutionResult,
  type SourceResolverPort,
} from '@agentdev/core';
import type { Role } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

/**
 * The narrow Git reader the resolver needs.
 *
 * It is the `WorktreeGitPort.readBlob` subset (`git cat-file blob`), so the daemon can
 * hand the very port the save/settlement paths use without an adapter.
 */
export interface ContextGitReader {
  readBlob(
    repoRoot: string,
    revision: string,
    path: string,
  ): { readonly ok: true; readonly value: string | null } | { readonly ok: false };
}

export interface ContextAssemblyOptions {
  readonly store: ProjectStore;
  readonly artifacts: ArtifactService;
  readonly config: ConfigStore;
  readonly git: ContextGitReader;
  readonly projectId: string;
  readonly workId: string;
  readonly role: Role;
  /** The Work's frozen policy revision (`Work.policyRevision`). */
  readonly policyRevision: number;
  /** Runtime stage spelling (`develop-L2`, `assist`, …); the caller resolves it. */
  readonly stage: ContextStage;
  /** The revision every relative git source is resolved at (`Work.baseRevision`). */
  readonly baseRevision: string;
  /** Root under which immutable snapshot directories are written. */
  readonly snapshotRoot: string;
  /** Reads one message body blob; absent means message sources cannot be resolved. */
  readonly readMessageBody?: (relativeBlobPath: string) => string | null;
}

export interface ContextAssembly {
  readonly project: ProjectScope;
  readonly gates: ContextGatesPort;
  readonly resolver: SourceResolverPort;
  readonly content: ContentFetchPort;
  readonly snapshotWriter: SnapshotWriterPort;
  readonly policyHash: string;
  /** The committed role contract the gate reports. */
  readonly roleContractBody: string;
  /** Reads one committed text file at the frozen base revision. */
  readGitText(path: string): string | null;
}

/** SHA256 hex of raw bytes (`data.md` §4 content identity). */
export function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The stage a role is evaluated at (`rules/workflow.md` §2).
 *
 * A modifying role's stage is level-derived (`develop-L1/L2/L3`); every other role
 * uses its own first registered stage. The ACL then decides what that stage may read,
 * so a wider selection is refused exactly like a real Run's.
 */
export function stageForRole(role: Role, level: string | undefined): ContextStage {
  const stages = (ROLE_STAGES as Record<string, readonly ContextStage[]>)[role] ?? [];
  if (role === 'backend' || role === 'frontend') {
    const candidate: ContextStage =
      level === 'L1' ? 'develop-L1' : level === 'L3' ? 'develop-L3' : 'develop-L2';
    if (stages.includes(candidate)) return candidate;
  }
  return stages[0] ?? 'assist';
}

/** The fixed rules a build falls back to when `docs/rules/agents.md` is absent. */
export const CHIEF_RULES_FALLBACK =
  '# Agent 固定规则\n\nChief 决定上下文；Builder 只校验并冻结；开发聊天不可输入。\n';

/**
 * The SHA256 the `VerificationManifest.policyHash` binds: the Project's config
 * policy serialized deterministically (the same value `context.preview` reports).
 */
export function projectPolicyHash(config: ConfigStore): string {
  return sha256Hex(Buffer.from(canonicalJson(config.project().policy), 'utf8'));
}

/** Binds the Context ports to this Project's real policy, Git tree and artifacts. */
export function createContextAssembly(options: ContextAssemblyOptions): ContextAssembly {
  const project = options.store.projects.find(options.projectId);
  if (project === undefined) {
    throw new Error(`Project ${options.projectId} is not registered`);
  }
  const root = project.gitRoot ?? project.root;
  const policyContent = canonicalJson(options.config.project().policy);
  const policyHash = sha256Hex(Buffer.from(policyContent, 'utf8'));
  const policyRevision = String(options.policyRevision);
  const readGitText = (path: string): string | null => {
    if (root === '' || options.baseRevision === '') return null;
    const blob = options.git.readBlob(root, options.baseRevision, path);
    return blob.ok ? blob.value : null;
  };
  const roleContractBody = readGitText(CHIEF_RULES_PATH) ?? CHIEF_RULES_FALLBACK;
  const projectScope: ProjectScope = {
    projectId: options.projectId,
    codeRoot: project.codeRoot,
    documentRoot: project.documentRoot,
    deliveryBranch: project.deliveryBranch,
    workId: options.workId,
  };
  const gates: ContextGatesPort = {
    current: () => ({
      ok: true,
      policyRevision,
      policyContent,
      roleContract: { id: CHIEF_RULES_PATH, body: roleContractBody },
    }),
  };
  const resolver: SourceResolverPort = {
    resolve: (input) =>
      resolveContextSource(input.ref, {
        artifacts: options.artifacts,
        git: options.git,
        ...(options.readMessageBody === undefined
          ? {}
          : { readMessageBody: options.readMessageBody }),
        root,
        baseRevision: options.baseRevision,
        policyContent,
        policyHash,
        policyRevision,
        role: options.role,
        roleContractBody,
      }),
  };
  const content: ContentFetchPort = {
    fetch: (ref) => {
      if (ref.kind === 'git') {
        const blob = options.git.readBlob(root, ref.revision, ref.path);
        if (!blob.ok || blob.value === null) {
          return { ok: false, code: 'NOT_FOUND', message: `${ref.path}@${ref.revision} 不存在` };
        }
        return { ok: true, content: blob.value };
      }
      try {
        const artifact = options.artifacts.get(ref.id, Number(ref.version));
        return {
          ok: true,
          content: Buffer.from(options.artifacts.read(artifact)).toString('utf8'),
        };
      } catch {
        return { ok: false, code: 'ARTIFACT_MISSING', message: `artifact ${ref.id} 不可读` };
      }
    },
  };
  return {
    project: projectScope,
    gates,
    resolver,
    content,
    snapshotWriter: createSnapshotDirectoryWriter({ root: options.snapshotRoot }),
    policyHash,
    roleContractBody,
    readGitText,
  };
}

/**
 * Resolves one authorised context source into its frozen identity (`context.md` §1).
 *
 * The builder performs the ACL/scope checks before calling this; the resolver only
 * answers "what bytes, at which revision, with which hash". A transcript is refused
 * outright (`agents.md` §2), and a kind this deployment cannot read honestly is
 * `CONTEXT_FORBIDDEN` rather than a fabricated hash.
 */
function resolveContextSource(
  ref: ContextSourceRef,
  context: {
    readonly artifacts: ArtifactService;
    readonly git: ContextGitReader;
    readonly readMessageBody?: (relativeBlobPath: string) => string | null;
    readonly root: string;
    readonly baseRevision: string;
    readonly policyContent: string;
    readonly policyHash: string;
    readonly policyRevision: string;
    readonly role: Role;
    readonly roleContractBody: string;
  },
): SourceResolutionResult {
  switch (ref.kind) {
    case 'git':
    case 'knowledge': {
      const revision = ref.version ?? context.baseRevision;
      const path = ref.path ?? ref.id;
      if (revision === '') {
        return { ok: false, code: 'NOT_FOUND', message: `${path} 没有可用 revision` };
      }
      const blob = context.git.readBlob(context.root, revision, path);
      if (!blob.ok || blob.value === null) {
        return { ok: false, code: 'NOT_FOUND', message: `${path}@${revision} 不存在` };
      }
      return {
        ok: true,
        kind: 'git',
        path,
        revision,
        hash: sha256Hex(Buffer.from(blob.value, 'utf8')),
        fetch: { kind: 'git', revision },
        fetchRef: { kind: 'git', path, revision },
      };
    }
    case 'artifact': {
      const version = ref.version ?? '1';
      try {
        const artifact = context.artifacts.get(ref.id, Number(version));
        return {
          ok: true,
          kind: 'artifact',
          version,
          hash: artifact.contentHash,
          fetch: { kind: 'artifact' },
          fetchRef: { kind: 'artifact', id: ref.id, version },
        };
      } catch {
        return { ok: false, code: 'NOT_FOUND', message: `artifact ${ref.id}@${version} 不存在` };
      }
    }
    case 'policy':
      return {
        ok: true,
        kind: 'policy',
        revision: context.policyRevision,
        hash: context.policyHash,
        fetch: { kind: 'none' },
        content: context.policyContent,
      };
    case 'role_contract':
      return {
        ok: true,
        kind: 'role_contract',
        role: context.role as never,
        revision: context.policyRevision,
        hash: sha256Hex(Buffer.from(context.roleContractBody, 'utf8')),
        fetch: { kind: 'none' },
        content: context.roleContractBody,
      };
    case 'message': {
      const text = context.readMessageBody?.(ref.id) ?? null;
      if (text === null) {
        return { ok: false, code: 'NOT_FOUND', message: `message ${ref.id} has no readable body` };
      }
      return {
        ok: true,
        kind: 'policy',
        revision: ref.version ?? '1',
        hash: sha256Hex(Buffer.from(text, 'utf8')),
        fetch: { kind: 'none' },
        content: text,
      };
    }
    case 'transcript':
      return {
        ok: false,
        code: 'CONTEXT_FORBIDDEN',
        message: `transcript ${ref.id} 禁止作为上下文输入（agents.md §2）`,
      };
    default:
      return {
        ok: false,
        code: 'CONTEXT_FORBIDDEN',
        message: `source kind ${String(ref.kind)} 不可作为上下文内容输入`,
      };
  }
}

/** Deterministic JSON for the policy payload (`data.md` §4 Hash 一致). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}
