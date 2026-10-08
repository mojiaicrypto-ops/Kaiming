/**
 * The method handlers this server ships (R1's table). Later slices add the project/session/task/
 * requirement/interaction methods; this file stays the one place that binds a public method name to
 * its handler, so the contract's table and the code cannot drift apart silently.
 */
import { RpcError, type RpcRouter } from './rpc.ts';
import { redactEffectiveConfig, resolveEffectiveConfig, type RuntimeDefaults } from '../runtime/config.ts';
import type { Store } from '../store/store.ts';

export interface CoreMethodsOptions {
  readonly store: Store;
  /** The server-level default configuration this installation runs with. */
  readonly server: RuntimeDefaults;
  /** Per-role model overrides configured on this installation. */
  readonly roleOverrides?: Readonly<Record<string, { providerId: string; modelId: string }>>;
}

export function registerCoreMethods(router: RpcRouter, options: CoreMethodsOptions): void {
  router.register('config.get', {
    write: false,
    run: (params): unknown => {
      const roleId = typeof params['roleId'] === 'string' && params['roleId'] !== '' ? params['roleId'] : 'chief';
      const projectId = typeof params['projectId'] === 'string' ? params['projectId'] : undefined;
      let project;
      if (projectId !== undefined) {
        const row = options.store.getProject(projectId);
        if (row === undefined) {
          throw new RpcError('NOT_FOUND', `project ${projectId} does not exist`, { projectId });
        }
        // Project-level overrides are stored with config.save (a later slice); until then the default
        // resolution is reported truthfully instead of pretending an override exists.
        project = undefined;
      }
      const effective = resolveEffectiveConfig({
        roleId,
        server: options.server,
        ...(project !== undefined ? { project } : {}),
        ...(options.roleOverrides !== undefined ? { roleOverrides: options.roleOverrides } : {}),
      });
      return {
        roleId,
        ...(projectId !== undefined ? { projectId } : {}),
        effective: redactEffectiveConfig(effective),
        // Secrets are referenced, never echoed: only availability travels.
        credentials: { mode: 'reference', inResponse: false },
      };
    },
  });
}
