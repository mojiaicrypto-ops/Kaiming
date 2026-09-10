/**
 * Toolchain baseline.
 *
 * `docs/architecture/ARCHITECTURE.md` §3 pins exact dependency versions and
 * `docs/delivery/implementation.md` §3 fixes the engineering commands. This
 * module is the single in-code source of truth for both, so `doctor` and the
 * tests check the same numbers the specification states.
 */

export const NODE_MINIMUM = '24.0.0';
export const NODE_BASELINE_MAJOR = 24;

export const PACKAGE_MANAGER = { name: 'pnpm', version: '12.3.4' } as const;

/** Runtime dependencies whose versions the specification fixes. */
export const PINNED_DEPENDENCIES = {
  typescript: '7.0.2',
  react: '19.3.0',
  vite: '8.2.2',
  fastify: '5.12.3',
  'better-sqlite3': '13.0.3',
  ws: '8.21.3',
  zod: '4.5.4',
  '@earendil-works/pi-coding-agent': '0.85.1',
  '@earendil-works/pi-ai': '0.85.1',
  vitest: '5.0.0',
  '@playwright/test': '1.63.0',
} as const;

export type PinnedDependency = keyof typeof PINNED_DEPENDENCIES;

/** The Pi SDK package this deployment supports; a different version must fail a check. */
export const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent' as const;
export const PI_SDK_VERSION = PINNED_DEPENDENCIES[PI_SDK_PACKAGE];

/**
 * Engineering commands from `implementation.md` §3. `owner` names the work
 * package that must make the command real; `pnpm callCommand` on a command
 * whose owner has not landed fails with NOT_IMPLEMENTED instead of passing.
 */
export const ENGINEERING_COMMANDS = [
  {
    script: 'install',
    command: 'pnpm install --frozen-lockfile',
    owner: 'WP-00',
    purpose: '固定依赖一致且安装退出 0',
  },
  { script: 'typecheck', command: 'pnpm typecheck', owner: 'WP-00', purpose: 'strict 无错误' },
  { script: 'lint', command: 'pnpm lint', owner: 'WP-00', purpose: 'TypeScript 与格式检查退出 0' },
  {
    script: 'test:unit',
    command: 'pnpm test:unit',
    owner: 'WP-00',
    purpose: 'Vitest 领域/Schema 全通过',
  },
  {
    script: 'test:integration',
    command: 'pnpm test:integration',
    owner: 'WP-00',
    purpose: 'SQLite/Git/Pi/WS/容器集成全通过',
  },
  { script: 'test:e2e', command: 'pnpm test:e2e', owner: 'WP-09', purpose: 'UI 与协议一致' },
  {
    script: 'test:acceptance',
    command: 'pnpm test:acceptance',
    owner: 'WP-10',
    purpose: '必需 AC 全有结果',
  },
  {
    script: 'test:live',
    command: 'pnpm test:live',
    owner: 'WP-10',
    purpose: '真实 Provider 三路径演练',
  },
  {
    script: 'docs:check',
    command: 'pnpm docs:check',
    owner: 'WP-00',
    purpose: '无断链或未定义引用',
  },
  { script: 'build', command: 'pnpm build', owner: 'WP-00', purpose: '可启动发布产物' },
] as const;

export type EngineeringCommand = (typeof ENGINEERING_COMMANDS)[number];

/** Parses a `major.minor.patch` string; returns null when malformed. */
export function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** `true` when `actual` is at least `minimum` (semver field comparison). */
export function satisfiesMinimum(actual: string, minimum: string): boolean {
  const a = parseSemver(actual);
  const b = parseSemver(minimum);
  if (a === null || b === null) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

/** Compares two versions for exact equality of their release fields. */
export function versionEquals(actual: string, expected: string): boolean {
  const a = parseSemver(actual);
  const b = parseSemver(expected);
  if (a === null || b === null) return false;
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}
