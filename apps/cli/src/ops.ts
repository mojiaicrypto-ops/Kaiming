/**
 * `agentdev backup|restore|relocate` — installation maintenance (WP-12 T6).
 *
 * `docs/architecture/reliability.md` §7 fixes the command names and `§8` fixes what the
 * operations must do:
 *
 * > CLI命令契约：…；backup <projectId> --output <dir>；restore <backupDir> --root <path>；
 * > relocate <projectId> --root <path>。失败退出非零并输出error code和operationId。
 * > backup将Project暂停到一致检查点…；restore在目标无活动Project、目录为空或已明确授权
 * > 替换且已备份时执行；校验清单→恢复Git与文件→恢复SQLite→更新canonical root映射→撤销所有
 * > 旧租约/capability→标原活动Run interrupted→doctor→显示恢复结果。Provider Secret由单独
 * > 导入/重新配置，缺凭证时保持provider阻断。
 *
 * Three rules shape this module:
 *
 * 1. **It works when the daemon does not.** Backup, restore and relocate are the operations an
 *    operator needs after a crash, so they run in-process against the installation state
 *    through `@agentdev/core` (loaded lazily, like `secret.ts`), never through a live daemon.
 *    The documented "pause integrations" step has no daemon entry point yet; a backup taken
 *    while a daemon is running therefore reports `paused:false` instead of pretending.
 * 2. **Every refusal is explicit and typed.** A target with an active Project, a non-empty
 *    target without `--replace`, a missing/incomplete/tampered manifest, and a credential a
 *    restore cannot resolve all produce a stable error/state instead of a hopeful success.
 * 3. **A success says what really happened** — paths, revisions, revoked leases, Runs marked
 *    `interrupted`, the doctor outcome, and the credential the operator must re-enter.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { projectStateDir, runtimePaths } from '@agentdev/contracts';
import type * as CoreModule from '@agentdev/core';

import { waitForRuntime } from './runtime.js';

/** Directory inside a backup that carries the installation-level configuration. */
const INSTALLATION_DIR = 'installation';
/** The CLI-owned sidecar describing the installation copy. */
const INSTALLATION_RECORD = 'installation.json';
/** The global configuration file name (`ARCHITECTURE.md` §5). */
const GLOBAL_CONFIG_FILE = 'config.toml';
/** Version of the CLI-owned installation sidecar; a restore refuses anything else. */
const INSTALLATION_RECORD_VERSION = 1;

/** The three installation-maintenance commands this module owns. */
export type OpsCommandName = 'backup' | 'restore' | 'relocate';

export interface OpsIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export interface OpsCommandInput {
  readonly command: OpsCommandName;
  readonly rest: readonly string[];
  readonly home: string;
  readonly io: OpsIo;
}

/** One machine-readable note attached to a successful result. */
interface OpsWarning {
  readonly code: string;
  readonly message: string;
}

/**
 * The CLI-owned record of the installation-level (never secret) configuration in a backup.
 *
 * `reliability.md` §8 backs up the Project, not the installation: Core's manifest carries the
 * database, blobs, knowledge and Git. Provider and role *definitions* live in the global
 * `config.toml` (`ARCHITECTURE.md` §5) and have to travel with a backup for a fresh
 * installation to be usable at all — but the credential values never do; they are re-entered
 * with `agentdev secret set` and a missing one keeps its Provider blocked.
 */
interface InstallationRecord {
  readonly schemaVersion: number;
  readonly complete: boolean;
  readonly copiedAt: string;
  readonly sourceHome: string;
  readonly config: {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  } | null;
  /** Secret *identifiers* the copied configuration references; never a value. */
  readonly secretRefs: readonly string[];
  /** `true` only when the copy was refused because a value was found in the config file. */
  readonly containsSecretValues: boolean;
}

/** One Provider definition read back from a restored configuration. */
interface RestoredProvider {
  readonly providerId: string;
  readonly enabled: boolean;
  readonly models: readonly string[];
  readonly secretRef?: string;
}

/** What the CLI did with the installation-level configuration during a restore. */
interface InstallationRestoreOutcome {
  readonly configRestored: boolean;
  readonly configPath: string;
  readonly providers: readonly RestoredProvider[];
  readonly secretRefs: readonly string[];
  readonly resolvableSecretRefs: readonly string[];
  readonly containsSecretValues: boolean;
  readonly notes: readonly string[];
}

/** Implements one of `backup`/`restore`/`relocate`; returns the process exit code. */
export async function runOpsCommand(input: OpsCommandInput): Promise<number> {
  const { command, rest, home, io } = input;
  try {
    if (command === 'backup') return await runBackup({ rest, home, io });
    if (command === 'restore') return await runRestore({ rest, home, io });
    return await runRelocate({ rest, home, io });
  } catch (error) {
    // `reliability.md` §7: a failing command reports an error code *and* an operationId.
    return fail(io, errorCode(error, 'OPS_FAILED'), errorMessage(error));
  }
}

/** Prints the shared failure shape and returns the non-zero exit code. */
function fail(io: OpsIo, code: string, message: string, details?: Record<string, unknown>): number {
  io.err(
    `${JSON.stringify({
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      operationId: randomUUID(),
    })}\n`,
  );
  return 1;
}

/** Prints the shared success shape. */
function ok(io: OpsIo, value: Record<string, unknown>): number {
  io.out(`${JSON.stringify({ ok: true, ...value }, null, 2)}\n`);
  return 0;
}

/**
 * Prints the operator-facing warning lines **before** the JSON result.
 *
 * A blocked restore (a credential the target installation cannot resolve) or a failed doctor
 * is something a human must act on, so it is a leading `WARNING [CODE]` line on stdout, not a
 * field buried in a long JSON document. Scripts read the JSON from the first `{`.
 */
function warn(io: OpsIo, warnings: readonly OpsWarning[]): void {
  for (const warning of warnings) io.out(`WARNING [${warning.code}] ${warning.message}\n`);
}

/** Content hash used by the installation sidecar (self-consistent, no extra dependency). */
function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------

interface BackupArgs {
  readonly projectId?: string;
  readonly root?: string;
  readonly outputDir: string;
  readonly replace: boolean;
}

/**
 * `agentdev backup [<projectId>] --output <dir> [--root <path>] [--replace]`.
 *
 * `reliability.md` §7 spells the command `backup <projectId> --output <dir>`; the project id
 * may be omitted when the installation holds exactly one Project (the common single-project
 * case), and `--out` is accepted as an alias because the work package names it that way.
 */
async function runBackup(input: {
  readonly rest: readonly string[];
  readonly home: string;
  readonly io: OpsIo;
}): Promise<number> {
  const { rest, home, io } = input;
  const parsed = parseBackupArgs(rest);
  if (!parsed.ok) return fail(io, 'VALIDATION_ERROR', parsed.message);
  const args = parsed.value;

  const core = await import('@agentdev/core');
  const resolved = resolveProject({
    core,
    home,
    ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
    ...(args.root === undefined ? {} : { root: args.root }),
    action: 'backup',
  });
  if (!resolved.ok) return fail(io, resolved.code, resolved.message, resolved.details);

  const project = resolved.value;
  const storage = await import('@agentdev/storage');
  const store = storage.ProjectStore.open({
    dataDir: project.dataDir,
    projectId: project.projectId,
  });
  let outcome: ReturnType<typeof core.backupProject>;
  try {
    outcome = core.backupProject({
      store,
      git: core.createNodeBackupGitPort(),
      outputDir: resolve(args.outputDir),
      replace: args.replace,
      // Secret *identifiers* only (`reliability.md` §8); the value is never backed up.
      secretRefs: providerSecretRefs(core, home),
    });
  } finally {
    store.close();
  }

  if (!outcome.ok) {
    return fail(io, outcome.code, outcome.message, {
      reasons: [...outcome.reasons],
      incomplete: outcome.incomplete,
      outputDir: outcome.incomplete ? resolve(args.outputDir) : null,
      hint:
        outcome.code === 'INVALID_STATE'
          ? '备份目标是空目录时才允许写入；确认已有其它备份后用 --replace 覆盖（reliability.md §8）'
          : undefined,
    });
  }

  // The Project snapshot is Core's; the installation-level configuration (Provider and role
  // *definitions*) is the CLI's, because a backup restored into a fresh installation has no
  // providers at all otherwise. Values are never copied (`reliability.md` §8).
  const installation = copyInstallationConfig({ core, home, backupDir: outcome.directory });
  if (!installation.ok) return fail(io, installation.code, installation.message);

  const live = await liveInstances(home);
  const warnings: OpsWarning[] = [
    {
      code: 'PAUSE_NOT_IMPLEMENTED',
      message:
        'reliability.md §8 的「暂停 Project / 暂停新集成」在当前 daemon 没有入口；本次备份用 SQLite 在线一致快照（VACUUM INTO）+ 当前知识树 + 交付 ref 的 Git bundle',
    },
  ];
  if (installation.record.config === null) {
    warnings.push({
      code: 'NO_INSTALLATION_CONFIG',
      message: `安装没有 ${GLOBAL_CONFIG_FILE}；备份只含 Project 状态，恢复到新安装后需要重新配置 Provider 与角色 Profile`,
    });
  } else {
    warnings.push({
      code: 'SECRETS_NOT_BACKED_UP',
      message: `凭证值不随备份迁移（仅记录 ${installation.record.secretRefs.length} 个 secretRef 标识）；恢复后请用 agentdev secret set <ref> 重新录入`,
    });
  }
  if (live.projectIds.includes(project.projectId)) {
    warnings.push({
      code: 'PROJECT_OPEN_WHILE_BACKUP',
      message: `备份期间 daemon 仍打开着该 Project（pid ${String(live.pid)}）；快照一致但知识树取自当时工作树`,
    });
  }
  if (outcome.manifest.secretRefs.length === 0) {
    warnings.push({
      code: 'NO_SECRET_REFS_RECORDED',
      message:
        '安装配置里没有带 secretRef 的 Provider，备份未记录凭证标识；恢复时无法据此判定 Provider 阻断',
    });
  }

  warn(io, warnings);
  return ok(io, {
    command: 'backup',
    operationId: outcome.manifest.operationId,
    backupId: outcome.backupId,
    projectId: project.projectId,
    directory: outcome.directory,
    manifestPath: outcome.manifestPath,
    repoRoot: outcome.manifest.canonicalRoot,
    deliveryBranch: outcome.manifest.deliveryBranch,
    ref: outcome.manifest.ref,
    revision: outcome.manifest.revision,
    tree: outcome.manifest.tree,
    complete: outcome.manifest.complete,
    gitIncluded: outcome.manifest.git !== null,
    files: outcome.manifest.files.length,
    knowledgeFiles: outcome.manifest.knowledge.files.length,
    knowledgeTreeHash: outcome.manifest.knowledge.treeHash,
    evidence: outcome.manifest.evidence.length,
    secretRefs: outcome.manifest.secretRefs,
    installation: {
      directory: `${INSTALLATION_DIR}/`,
      recordPath: join(outcome.directory, INSTALLATION_DIR, INSTALLATION_RECORD),
      configCopied: installation.record.config !== null,
      configPath: installation.record.config?.path ?? null,
      configSha256: installation.record.config?.sha256 ?? null,
      providers: installation.record.secretRefs.length,
      containsSecretValues: installation.record.containsSecretValues,
    },
    paused: false,
    warnings,
  });
}

function parseBackupArgs(
  rest: readonly string[],
):
  | { readonly ok: true; readonly value: BackupArgs }
  | { readonly ok: false; readonly message: string } {
  let projectId: string | undefined;
  let root: string | undefined;
  let outputDir: string | undefined;
  let replace = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === '--output' || arg === '--out') {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        return { ok: false, message: `${arg} requires a directory` };
      }
      outputDir = value;
      index += 1;
      continue;
    }
    if (arg === '--root') {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        return { ok: false, message: '--root requires a path' };
      }
      root = value;
      index += 1;
      continue;
    }
    if (arg === '--replace') {
      replace = true;
      continue;
    }
    if (arg.startsWith('--')) return { ok: false, message: `unknown option: ${arg}` };
    if (projectId !== undefined) {
      return { ok: false, message: `unexpected argument: ${arg}` };
    }
    projectId = arg;
  }
  if (outputDir === undefined) {
    return { ok: false, message: 'backup requires --output <dir> (or --out <dir>)' };
  }
  return {
    ok: true,
    value: {
      ...(projectId === undefined ? {} : { projectId }),
      ...(root === undefined ? {} : { root }),
      outputDir,
      replace,
    },
  };
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

interface RestoreArgs {
  readonly backupDir: string;
  readonly root?: string;
  readonly replace: boolean;
}

/**
 * `agentdev restore <backupDir> --root <path> [--replace]`.
 *
 * The refusal order follows `reliability.md` §8 literally: an active Project on the target
 * first, then the manifest, then the empty (or explicitly replaced) directory, then the
 * credentials the restored Project would need.
 */
async function runRestore(input: {
  readonly rest: readonly string[];
  readonly home: string;
  readonly io: OpsIo;
}): Promise<number> {
  const { rest, home, io } = input;
  const parsed = parseRestoreArgs(rest);
  if (!parsed.ok) return fail(io, 'VALIDATION_ERROR', parsed.message);
  const args = parsed.value;

  const core = await import('@agentdev/core');
  const backupDir = resolve(args.backupDir);
  const manifest = readManifestForTarget(core, backupDir);
  if (!manifest.ok) return fail(io, manifest.code, manifest.message, { backupDir });

  const entry = manifest.value;
  const targetRoot = args.root === undefined ? entry.canonicalRoot : resolve(args.root);
  const target = canonicalOrResolved(core, targetRoot);

  // `reliability.md` §8: "restore在目标无活动Project…时执行". The live record plus a real
  // `/health` answer is the only evidence that a Project is *active*; a stale registry entry
  // for a stopped daemon is not.
  const live = await liveRuntime(home);
  if (live !== null) {
    const active = live.record.instances.find(
      (instance) =>
        instance.projectId === entry.projectId ||
        canonicalOrResolved(core, instance.root) === target,
    );
    if (active !== undefined) {
      return fail(
        io,
        'INVALID_STATE',
        `恢复目标 ${target} 上存在活动 Project（projectId=${active.projectId}，daemon pid=${String(
          live.record.pid,
        )}）；reliability.md §8 要求目标无活动 Project，请先 agentdev stop`,
        { target, projectId: active.projectId, daemonPid: live.record.pid },
      );
    }
  }

  // Verify the installation-level sidecar (hash + leak scan) *before* Core writes anything,
  // so a tampered config refuses the whole restore instead of leaving a half-restored install.
  const installationRecord = readInstallationRecord(backupDir);
  if (!installationRecord.ok) {
    return fail(io, installationRecord.code, installationRecord.message, { backupDir });
  }
  const verified = verifyInstallationConfig({
    core,
    home,
    backupDir,
    record: installationRecord.record,
  });
  if (!verified.ok) return fail(io, verified.code, verified.message, { backupDir, home });

  const secrets = await secretAvailability(home);
  const dataDir = projectStateDir(home, entry.projectId);
  const outcome = core.restoreProject({
    backupDir,
    targetDir: target,
    repoRoot: target,
    dataDir,
    git: core.createNodeBackupGitPort(),
    replace: args.replace,
    secretAvailable: secrets,
  });
  if (!outcome.ok) {
    return fail(io, outcome.code, outcome.message, {
      reasons: [...outcome.reasons],
      partial: outcome.partial,
      backupDir,
      target,
      hint:
        outcome.code === 'INVALID_STATE'
          ? '恢复目标必须为空目录；确认已对现有内容备份后用 --replace 明确授权替换（reliability.md §8）'
          : undefined,
    });
  }

  // The installation-level configuration travels beside Core's manifest: Provider and role
  // definitions must come back for a fresh installation to be usable, while the credential
  // values never do (`reliability.md` §8). A home that already has a configuration keeps it.
  let installation: InstallationRestoreOutcome | null = null;
  if (installationRecord.record !== null) {
    const applied = applyInstallationConfig({
      core,
      home,
      record: installationRecord.record,
      text: verified.text,
      secretAvailable: secrets,
    });
    if (!applied.ok) {
      return fail(io, applied.code, applied.message, {
        backupDir,
        home,
        projectStateRestored: true,
        dataDir: outcome.dataDir,
        repoRoot: outcome.repoRoot,
        note: 'Project 状态已恢复，仅安装级配置写入失败；修复后可用 --replace 重跑或手工放置 config.toml',
      });
    }
    installation = applied.value;
  }

  // The Project row inside the restored database is Core's job; the installation-level
  // `projects.json` mapping is the CLI's (`ARCHITECTURE.md` §5).
  const sameRoot = target === entry.canonicalRoot;
  let registryUpdated = false;
  if (sameRoot) {
    core.registerProject(home, {
      root: target,
      projectId: entry.projectId,
      at: new Date().toISOString(),
    });
    registryUpdated = true;
  }

  // Most actionable first: a missing credential is something the operator must act on, so
  // its `WARNING [PROVIDER_BLOCKED]` line is the first thing on stdout.
  const warnings: OpsWarning[] = [];
  if (outcome.provider.blocked) {
    warnings.push({
      code: 'PROVIDER_BLOCKED',
      message: `缺少 Provider Secret：${outcome.provider.missingSecretRefs.join(
        '、',
      )}；恢复已完成（status=blocked），凭证不在备份中（reliability.md §8），Provider 保持阻断，请重新录入：${outcome.provider.missingSecretRefs
        .map((ref) => `agentdev secret set ${ref}`)
        .join('；')}（值从 stdin 读入）`,
    });
  }
  if (!outcome.doctor.ok) {
    warnings.push({
      code: 'DOCTOR_FAILED',
      message: `恢复后 doctor 未通过：${outcome.doctor.checks
        .filter((check) => !check.ok)
        .map((check) => check.name)
        .join('、')}`,
    });
  }
  if (installation === null) {
    warnings.push({
      code: 'NO_INSTALLATION_RECORD',
      message: `备份没有 ${INSTALLATION_DIR}/${INSTALLATION_RECORD}（旧格式或非 CLI 生成）：本次只恢复 Project 状态，Provider/Profile 定义需在目标安装中自行配置`,
    });
  } else if (installation.notes.includes('TARGET_CONFIG_PRESENT')) {
    warnings.push({
      code: 'TARGET_CONFIG_PRESENT',
      message: `目标安装已有 ${installation.configPath}，未覆盖：安装级 Provider/Profile 定义保持目标现有配置`,
    });
  }
  if (!sameRoot) {
    warnings.push({
      code: 'ROOT_DIFFERS_FROM_BACKUP',
      message:
        '目标 root 与备份记录的 canonical root 不同：projectId 由 canonical root 派生（ARCHITECTURE.md §4），daemon 在 --root 处会派生新的 projectId 与状态目录，本次恢复因此未写安装级 root 映射（跨 root 迁移由「项目身份持久化」切片关闭）',
    });
  }

  warn(io, warnings);
  return ok(io, {
    command: 'restore',
    operationId: randomUUID(),
    backupId: entry.backupId,
    backup: {
      directory: backupDir,
      createdAt: entry.createdAt,
      revision: entry.revision,
      tree: entry.tree,
    },
    projectId: entry.projectId,
    repoRoot: outcome.repoRoot,
    dataDir: outcome.dataDir,
    revision: outcome.revision,
    tree: outcome.tree,
    status: outcome.status,
    consistency: outcome.consistency,
    recovery: outcome.recovery,
    doctor: outcome.doctor,
    provider: outcome.provider,
    installation:
      installation === null
        ? { restored: false, reason: 'NO_INSTALLATION_RECORD' }
        : {
            configRestored: installation.configRestored,
            configPath: installation.configPath,
            providers: installation.providers,
            secretRefs: installation.secretRefs,
            resolvableSecretRefs: installation.resolvableSecretRefs,
            containsSecretValues: installation.containsSecretValues,
            notes: installation.notes,
          },
    registryUpdated,
    daemonOpenable: sameRoot,
    nextSteps: outcome.provider.blocked
      ? outcome.provider.missingSecretRefs.map(
          (ref) => `agentdev secret set ${ref}   # 值从 stdin 读入`,
        )
      : [],
    warnings,
  });
}

function parseRestoreArgs(
  rest: readonly string[],
):
  | { readonly ok: true; readonly value: RestoreArgs }
  | { readonly ok: false; readonly message: string } {
  let backupDir: string | undefined;
  let root: string | undefined;
  let replace = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === '--root') {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        return { ok: false, message: '--root requires a path' };
      }
      root = value;
      index += 1;
      continue;
    }
    if (arg === '--replace') {
      replace = true;
      continue;
    }
    if (arg.startsWith('--')) return { ok: false, message: `unknown option: ${arg}` };
    if (backupDir !== undefined) return { ok: false, message: `unexpected argument: ${arg}` };
    backupDir = arg;
  }
  if (backupDir === undefined) {
    return { ok: false, message: 'restore requires a backup directory' };
  }
  return {
    ok: true,
    value: { backupDir, ...(root === undefined ? {} : { root }), replace },
  };
}

/**
 * Reads just enough of the manifest to locate the target state directory.
 *
 * `restoreProject` re-reads and re-validates the manifest authoritatively; this read exists so
 * the CLI can refuse a missing/incomplete backup and compute `~/.agentdev/projects/<id>`
 * before Core touches the filesystem.
 */
function readManifestForTarget(
  core: typeof CoreModule,
  backupDir: string,
):
  | { readonly ok: true; readonly value: BackupManifestFacts }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const path = `${backupDir}/${core.BACKUP_MANIFEST_NAME}`;
  if (!existsSync(path)) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `备份缺少 ${core.BACKUP_MANIFEST_NAME}：${backupDir}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `${core.BACKUP_MANIFEST_NAME} 不是有效 JSON：${errorMessage(error)}`,
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '备份清单必须是对象' };
  }
  const manifest = raw as Record<string, unknown>;
  if (manifest['schemaVersion'] !== core.BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `不支持的备份格式版本 ${String(manifest['schemaVersion'])}`,
    };
  }
  if (manifest['complete'] !== true) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: '备份标记为 incomplete（生成中断）；restore 拒绝不完整备份（reliability.md §8）',
    };
  }
  const projectId = manifest['projectId'];
  const canonicalRoot = manifest['canonicalRoot'];
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '备份清单缺少 projectId' };
  }
  if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '备份清单缺少 canonicalRoot' };
  }
  return {
    ok: true,
    value: {
      backupId: typeof manifest['backupId'] === 'string' ? manifest['backupId'] : 'unknown',
      createdAt: typeof manifest['createdAt'] === 'string' ? manifest['createdAt'] : 'unknown',
      projectId,
      canonicalRoot,
      revision: typeof manifest['revision'] === 'string' ? manifest['revision'] : null,
      tree: typeof manifest['tree'] === 'string' ? manifest['tree'] : null,
    },
  };
}

/** The manifest fields the CLI's own reporting needs. */
interface BackupManifestFacts {
  readonly backupId: string;
  readonly createdAt: string;
  readonly projectId: string;
  readonly canonicalRoot: string;
  readonly revision: string | null;
  readonly tree: string | null;
}

// ---------------------------------------------------------------------------
// installation-level configuration (never secret values)
// ---------------------------------------------------------------------------

/**
 * Copies the installation's global configuration beside Core's manifest.
 *
 * `ARCHITECTURE.md` §5 keeps Provider and role *definitions* in `~/.agentdev/config.toml`,
 * outside the Project database, so without this copy a restore into a fresh installation
 * would come back with no Provider at all. The values are never copied: the file is scanned
 * against every value the credential repository can resolve, and a hit refuses the backup
 * instead of writing a credential into the backup directory (`reliability.md` §8).
 */
function copyInstallationConfig(input: {
  readonly core: typeof CoreModule;
  readonly home: string;
  readonly backupDir: string;
}):
  | { readonly ok: true; readonly record: InstallationRecord }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const { core, home, backupDir } = input;
  const secretRefs = providerSecretRefs(core, home);
  const configPath = runtimePaths(home).config;
  const directory = join(backupDir, INSTALLATION_DIR);
  const base = {
    schemaVersion: INSTALLATION_RECORD_VERSION,
    copiedAt: new Date().toISOString(),
    sourceHome: home,
    secretRefs,
  } as const;
  try {
    if (!existsSync(configPath)) {
      const record: InstallationRecord = {
        ...base,
        complete: true,
        config: null,
        containsSecretValues: false,
      };
      writeInstallationRecord(directory, record);
      return { ok: true, record };
    }
    const text = readFileSync(configPath, 'utf8');
    const values = knownSecretValuesFrom(core, home);
    if (values.length > 0 && core.scanForLeaks(text, values).length > 0) {
      const record: InstallationRecord = {
        ...base,
        complete: false,
        config: null,
        containsSecretValues: true,
      };
      writeInstallationRecord(directory, record);
      return {
        ok: false,
        code: 'SECRET_VALUE_IN_CONFIG',
        message: `${configPath} 含有已注册的 Secret 明文；备份拒绝把它写入备份目录（reliability.md §8）`,
      };
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const relative = `${INSTALLATION_DIR}/${GLOBAL_CONFIG_FILE}`;
    writeFileSync(join(backupDir, relative), text, { mode: 0o600 });
    const record: InstallationRecord = {
      ...base,
      complete: true,
      config: { path: relative, sha256: sha256Of(text), bytes: Buffer.byteLength(text) },
      containsSecretValues: false,
    };
    writeInstallationRecord(directory, record);
    return { ok: true, record };
  } catch (error) {
    const record: InstallationRecord = {
      ...base,
      complete: false,
      config: null,
      containsSecretValues: false,
    };
    try {
      writeInstallationRecord(directory, record);
    } catch {
      // A directory that cannot even hold the refusal note is reported by the message below.
    }
    return { ok: false, code: 'CONFIG_BACKUP_FAILED', message: errorMessage(error) };
  }
}

function writeInstallationRecord(directory: string, record: InstallationRecord): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, INSTALLATION_RECORD), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Reads the CLI sidecar; a missing one is an older/core-only backup, not an error. */
function readInstallationRecord(
  backupDir: string,
):
  | { readonly ok: true; readonly record: InstallationRecord | null }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const path = join(backupDir, INSTALLATION_DIR, INSTALLATION_RECORD);
  if (!existsSync(path)) return { ok: true, record: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `${INSTALLATION_DIR}/${INSTALLATION_RECORD} 不是有效 JSON：${errorMessage(error)}`,
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '安装级配置记录必须是对象' };
  }
  const record = raw as InstallationRecord;
  if (record.schemaVersion !== INSTALLATION_RECORD_VERSION) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `不支持的安装级配置记录版本 ${String(record.schemaVersion)}`,
    };
  }
  if (record.complete !== true) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: '备份的安装级配置不完整；restore 拒绝不完整的备份（reliability.md §8）',
    };
  }
  return { ok: true, record };
}

/**
 * Verifies the backed-up configuration before anything is written.
 *
 * The copied bytes must match the sidecar hash and must not contain a value the target
 * installation can already resolve. Running this *before* Core restores the Project keeps a
 * tampered or credential-bearing configuration from leaving a half-restored installation.
 */
function verifyInstallationConfig(input: {
  readonly core: typeof CoreModule;
  readonly home: string;
  readonly backupDir: string;
  readonly record: InstallationRecord | null;
}):
  | { readonly ok: true; readonly text: string | null }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const { core, home, backupDir, record } = input;
  if (record === null || record.config === null) return { ok: true, text: null };
  const source = join(backupDir, record.config.path);
  if (!existsSync(source)) {
    return { ok: false, code: 'NOT_FOUND', message: `备份缺少安装级配置 ${record.config.path}` };
  }
  const text = readFileSync(source, 'utf8');
  if (sha256Of(text) !== record.config.sha256 || Buffer.byteLength(text) !== record.config.bytes) {
    return {
      ok: false,
      code: 'STALE_ARTIFACT',
      message: `安装级配置 ${record.config.path} 的哈希与清单不一致`,
    };
  }
  // Defense in depth: the authoritative refusal happens at backup time, where every value of
  // the source installation is known. Here only the target's own values can be compared.
  const values = knownSecretValuesFrom(core, home);
  if (values.length > 0 && core.scanForLeaks(text, values).length > 0) {
    return {
      ok: false,
      code: 'SECRET_VALUE_IN_CONFIG',
      message: `备份的 ${record.config.path} 含有目标安装已注册的 Secret 明文；拒绝写入安装（reliability.md §8）`,
    };
  }
  return { ok: true, text };
}

/**
 * Installs the verified configuration into the target home, never overwriting one.
 *
 * Overwriting a live `config.toml` would silently discard Providers the operator configured
 * after the backup, so a home that already has a configuration keeps it and the result says
 * so.
 */
function applyInstallationConfig(input: {
  readonly core: typeof CoreModule;
  readonly home: string;
  readonly record: InstallationRecord;
  readonly text: string | null;
  readonly secretAvailable: (ref: string) => boolean;
}):
  | { readonly ok: true; readonly value: InstallationRestoreOutcome }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const { core, home, record, text, secretAvailable } = input;
  const configPath = runtimePaths(home).config;
  const notes: string[] = [];
  const secretRefs = [...record.secretRefs];
  const resolvableSecretRefs = secretRefs.filter((ref) => secretAvailable(ref));

  if (text === null) {
    return {
      ok: true,
      value: {
        configRestored: false,
        configPath,
        providers: [],
        secretRefs,
        resolvableSecretRefs,
        containsSecretValues: record.containsSecretValues,
        notes: ['NO_CONFIG_IN_BACKUP'],
      },
    };
  }

  let configRestored = false;
  try {
    if (existsSync(configPath)) {
      notes.push('TARGET_CONFIG_PRESENT');
    } else {
      mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
      writeFileSync(configPath, text, { mode: 0o600 });
      configRestored = true;
    }
  } catch (error) {
    return { ok: false, code: 'CONFIG_RESTORE_FAILED', message: errorMessage(error) };
  }

  let providers: readonly RestoredProvider[] = [];
  try {
    const config = core.ConfigStore.open({ globalDir: home });
    providers = config.global().providers.map((provider) => ({
      providerId: provider.providerId,
      enabled: provider.enabled,
      models: provider.models.map((model) => model.id),
      ...(provider.secretRef === undefined ? {} : { secretRef: provider.secretRef }),
    }));
  } catch (error) {
    notes.push(`CONFIG_UNREADABLE:${errorMessage(error)}`);
  }

  return {
    ok: true,
    value: {
      configRestored,
      configPath,
      providers,
      secretRefs,
      resolvableSecretRefs,
      containsSecretValues: record.containsSecretValues,
      notes,
    },
  };
}

/** Every value the installation's credential repository can currently resolve. */
function knownSecretValuesFrom(core: typeof CoreModule, home: string): readonly string[] {
  try {
    const repository = core.createSecretRepository({ home });
    const values: string[] = [];
    for (const entry of repository.list()) {
      const stored = repository.get(entry.ref);
      if (stored !== null && stored.value.length > 0) values.push(stored.value);
    }
    return values;
  } catch {
    // An unreadable repository yields no known values; the leak scan then has nothing to
    // compare against, which is reported by the caller's own credential check.
    return [];
  }
}

// ---------------------------------------------------------------------------
// relocate
// ---------------------------------------------------------------------------

interface RelocateArgs {
  readonly projectId?: string;
  readonly newRoot: string;
  readonly move: boolean;
}

/**
 * `agentdev relocate <projectId> --root <path> [--move]`.
 *
 * `reliability.md` §7 fixes the documented shape; `relocate <newRoot>` (the work package's
 * shorthand) is accepted too, and resolves the Project from the installation when there is
 * exactly one. A live daemon must be stopped first: `ARCHITECTURE.md` §4 relocates "在无活动
 * Run时", and a running daemon holds the state directory open.
 */
async function runRelocate(input: {
  readonly rest: readonly string[];
  readonly home: string;
  readonly io: OpsIo;
}): Promise<number> {
  const { rest, home, io } = input;
  const parsed = parseRelocateArgs(rest);
  if (!parsed.ok) return fail(io, 'VALIDATION_ERROR', parsed.message);
  const args = parsed.value;

  const core = await import('@agentdev/core');
  const resolved = resolveProject({
    core,
    home,
    ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
    action: 'relocate',
  });
  if (!resolved.ok) return fail(io, resolved.code, resolved.message, resolved.details);
  const project = resolved.value;

  const live = await liveRuntime(home);
  if (live !== null) {
    const active = live.record.instances.find(
      (instance) =>
        instance.projectId === project.projectId ||
        canonicalOrResolved(core, instance.root) === canonicalOrResolved(core, project.root),
    );
    if (active !== undefined) {
      return fail(
        io,
        'INVALID_STATE',
        `Project ${project.projectId} 正被 daemon（pid ${String(
          live.record.pid,
        )}）打开；relocate 要求无活动 Run，请先 agentdev stop`,
        { projectId: project.projectId, daemonPid: live.record.pid },
      );
    }
  }

  // Fail closed on an identity change. `ARCHITECTURE.md` §4 derives a Project's id — and
  // therefore its state directory — from the canonical root, so a target that derives a
  // different id would be opened by the daemon as a *new, empty* Project and the migrated
  // state would be orphaned. Until the runtime persists Project identity across roots, the
  // relocation is refused before anything is moved or rewritten.
  const targetCanonical = canonicalOrResolved(core, resolve(args.newRoot));
  const storage = await import('@agentdev/storage');
  const derivedProjectId = storage.projectIdFromRoot(targetCanonical);
  if (derivedProjectId !== project.projectId) {
    return fail(
      io,
      'PROJECT_IDENTITY_MOVE_UNSUPPORTED',
      `拒绝跨 root 迁移：projectId 由 canonical root 派生（ARCHITECTURE.md §4），目标 ${targetCanonical} 会派生 ${derivedProjectId} ≠ 当前 ${project.projectId}；当前 runtime 尚不支持迁移 Project 身份，daemon 会把迁移后的根当成一个新安装打开而让 ${project.dataDir} 成为孤儿。relocate 只接受派生同一 projectId 的目标（例如指向同一 canonical root 的别名路径）`,
      {
        projectId: project.projectId,
        previousRoot: project.root,
        newRoot: resolve(args.newRoot),
        derivedProjectId,
        hint: '把仓库保持在原 canonical root、把状态目录保留在 ~/.agentdev/projects/<projectId>；跨 root 迁移由「项目身份持久化」切片关闭',
      },
    );
  }

  const secrets = await secretAvailability(home);
  const outcome = core.relocateProject({
    dataDir: project.dataDir,
    newRoot: resolve(args.newRoot),
    move: args.move,
    secretRefs: providerSecretRefs(core, home),
    secretAvailable: secrets,
  });
  if (!outcome.ok) {
    return fail(io, outcome.code, outcome.message, {
      reasons: [...outcome.reasons],
      projectId: project.projectId,
      newRoot: resolve(args.newRoot),
      hint:
        outcome.code === 'NOT_FOUND'
          ? '--move 的目标必须不存在；不带 --move 时目标必须是同一交付仓库（同 revision/tree、工作树干净）（reliability.md §7/§8）'
          : undefined,
    });
  }

  const newRoot = canonicalOrResolved(core, outcome.repoRoot);
  if (outcome.previousRoot !== outcome.repoRoot) {
    core.unregisterProject(home, outcome.previousRoot);
  }
  core.registerProject(home, {
    root: newRoot,
    projectId: outcome.projectId,
    at: new Date().toISOString(),
  });

  const derived = storage.projectIdFromRoot(newRoot);
  const warnings: OpsWarning[] = [];

  warn(io, warnings);
  return ok(io, {
    command: 'relocate',
    operationId: randomUUID(),
    projectId: outcome.projectId,
    previousRoot: outcome.previousRoot,
    repoRoot: outcome.repoRoot,
    dataDir: outcome.dataDir,
    derivedProjectId: derived,
    identityPreserved: true,
    daemonOpenable: true,
    registryUpdated: true,
    registryPath: `${home}/projects.json`,
    recovery: outcome.recovery,
    doctor: outcome.doctor,
    warnings,
  });
}

function parseRelocateArgs(
  rest: readonly string[],
):
  | { readonly ok: true; readonly value: RelocateArgs }
  | { readonly ok: false; readonly message: string } {
  const positional: string[] = [];
  let root: string | undefined;
  let move = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === '--root') {
      const value = rest[index + 1];
      if (value === undefined || value.length === 0) {
        return { ok: false, message: '--root requires a path' };
      }
      root = value;
      index += 1;
      continue;
    }
    if (arg === '--move') {
      move = true;
      continue;
    }
    if (arg.startsWith('--')) return { ok: false, message: `unknown option: ${arg}` };
    positional.push(arg);
  }
  const projectId =
    positional[0] !== undefined && /^[0-9a-f]{32}$/u.test(positional[0])
      ? positional[0]
      : undefined;
  const newRoot = root ?? (projectId === undefined ? positional[0] : positional[1]);
  if (projectId === undefined && root !== undefined && positional.length > 0) {
    return { ok: false, message: `unexpected argument: ${positional[0] as string}` };
  }
  if (newRoot === undefined) {
    return { ok: false, message: 'relocate requires a new root (--root <path>)' };
  }
  if (positional.length > 2) return { ok: false, message: 'relocate takes at most two paths' };
  return {
    ok: true,
    value: { ...(projectId === undefined ? {} : { projectId }), newRoot, move },
  };
}

// ---------------------------------------------------------------------------
// shared resolution
// ---------------------------------------------------------------------------

interface ResolvedProject {
  readonly projectId: string;
  readonly root: string;
  readonly dataDir: string;
}

type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedProject }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly details?: Record<string, unknown>;
    };

/**
 * Resolves which Project an installation-level operation targets.
 *
 * Selectors, in order: an explicit `projectId`, an explicit `--root`, or the single Project
 * the installation holds. Ambiguity is a refusal that lists the candidates instead of
 * guessing, because a maintenance operation must never touch the wrong project.
 */
function resolveProject(input: {
  readonly core: typeof CoreModule;
  readonly home: string;
  readonly projectId?: string;
  readonly root?: string;
  readonly action: 'backup' | 'relocate';
}): ResolveResult {
  const { core, home, projectId, root, action } = input;
  let registry;
  try {
    registry = core.readProjectRegistry(home);
  } catch (error) {
    return { ok: false, code: 'PROJECT_REGISTRY_INVALID', message: errorMessage(error) };
  }
  const entries = registry.projects;

  let chosen = entries[0];
  if (projectId !== undefined) {
    chosen = entries.find((entry) => entry.projectId === projectId);
    if (chosen === undefined) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `安装注册表里没有 projectId=${projectId}（${home}/projects.json）`,
        details: {
          known: entries.map((entry) => ({ projectId: entry.projectId, root: entry.root })),
        },
      };
    }
  } else if (root !== undefined) {
    const wanted = canonicalOrResolved(core, root);
    chosen = entries.find((entry) => canonicalOrResolved(core, entry.root) === wanted);
    if (chosen === undefined) {
      const derived = safeProjectId(core, wanted);
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `${wanted} 未注册到本安装（projects.json）；先运行 agentdev open ${wanted}`,
        details: derived === null ? {} : { derivedProjectId: derived },
      };
    }
  } else if (entries.length !== 1) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message:
        entries.length === 0
          ? `安装里没有已注册的 Project（${home}/projects.json）；先运行 agentdev open <path>`
          : `${action} 需要指定 <projectId>（安装里有 ${String(entries.length)} 个 Project）`,
      details: {
        known: entries.map((entry) => ({ projectId: entry.projectId, root: entry.root })),
      },
    };
  }

  if (chosen === undefined) {
    return { ok: false, code: 'NOT_FOUND', message: '没有可用的 Project 注册项' };
  }
  const dataDir = projectStateDir(home, chosen.projectId);
  if (!existsSync(`${dataDir}/project.sqlite`)) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Project ${chosen.projectId} 的安装状态目录不存在：${dataDir}；先运行 agentdev open ${chosen.root}`,
      details: { dataDir },
    };
  }
  return { ok: true, value: { projectId: chosen.projectId, root: chosen.root, dataDir } };
}

/** Canonicalises a path through Core's real identity rule, falling back for missing paths. */
function canonicalOrResolved(core: typeof CoreModule, path: string): string {
  try {
    return core.resolveProjectIdentity(path).canonicalRoot;
  } catch {
    // The target of a restore need not exist yet, so `realpath` cannot canonicalise it.
    return resolve(path);
  }
}

/** The project id a root derives, or `null` when the root is unreadable. */
function safeProjectId(core: typeof CoreModule, root: string): string | null {
  try {
    return core.resolveProjectIdentity(root).projectId;
  } catch {
    return null;
  }
}

/** The live daemon record, but only when its admin surface really answers. */
async function liveRuntime(home: string): Promise<Awaited<ReturnType<typeof waitForRuntime>>> {
  try {
    return await waitForRuntime(home, { timeoutMs: 0 });
  } catch {
    // A malformed `runtime.json` must not turn a maintenance operation into a crash.
    return null;
  }
}

/** The opened instances of a healthy daemon, with the daemon pid for the messages. */
async function liveInstances(
  home: string,
): Promise<{ readonly pid: number | null; readonly projectIds: readonly string[] }> {
  const live = await liveRuntime(home);
  if (live === null) return { pid: null, projectIds: [] };
  return {
    pid: live.record.pid,
    projectIds: live.record.instances.map((instance) => instance.projectId),
  };
}

/** Provider `secretRef`s declared by the installation's global configuration. */
function providerSecretRefs(core: typeof CoreModule, home: string): string[] {
  try {
    const config = core.ConfigStore.open({ globalDir: home });
    const refs = config
      .global()
      .providers.map((provider) => provider.secretRef)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    return [...new Set(refs)].sort();
  } catch {
    // A broken config must not block a backup; it only means no ref is recorded.
    return [];
  }
}

/** Whether one secret ref really resolves in the installation credential repository. */
async function secretAvailability(home: string): Promise<(ref: string) => boolean> {
  try {
    const core = await import('@agentdev/core');
    const repository = core.createSecretRepository({ home });
    const healthy = new Set(
      repository
        .list()
        .filter((entry) => entry.health === 'ok')
        .map((entry) => entry.ref),
    );
    return (ref) => healthy.has(ref);
  } catch {
    // An unreadable repository means "not resolvable", which keeps the restore fail-closed.
    return () => false;
  }
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
