import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { RpcClient } from '../api/rpc';

export interface ProviderModel {
  readonly id: string;
  readonly name?: string;
}

export interface ProviderView {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api?: string;
  readonly models: readonly ProviderModel[];
  readonly credentialConfigured: boolean;
  readonly revision: number;
}

export interface ConfigView {
  readonly effective: { readonly providerId: string; readonly modelId: string; readonly source: string };
  readonly providers: readonly ProviderView[];
}

/** Roles the workbench assigns models to; the ids are the server's. */
export const ROLES = ['chief', 'designer', 'developer', 'reviewer', 'tester', 'settler', 'investigator'] as const;
export type RoleId = (typeof ROLES)[number];

/**
 * Every role's effective configuration for one scope, read in parallel: the Models page needs the
 * whole column, and a per-row read would show a role's value only after that row was focused.
 */
export function useRoleConfigs(rpc: RpcClient, projectId: string | undefined) {
  const [configs, setConfigs] = useState<readonly ConfigView[]>([]);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    const reads = await Promise.all(
      ROLES.map((roleId) =>
        rpc
          .call<ConfigView>('config.get', {
            roleId,
            ...(projectId === undefined || projectId === '' ? {} : { projectId }),
          })
          .catch(() => null),
      ),
    );
    setConfigs(reads.filter((entry): entry is ConfigView => entry !== null));
    setFailed(reads.every((entry) => entry === null));
  }, [rpc, projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { configs, failed, reload };
}

/**
 * One role's effective configuration, optionally scoped to a project. The server resolves
 * run → project → role → default; this hook reads the result and re-reads after a save.
 */
export function useConfig(rpc: RpcClient, projectId: string | undefined, roleId: string) {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    const read = await rpc.call<ConfigView>('config.get', {
      roleId,
      ...(projectId === undefined || projectId === '' ? {} : { projectId }),
    });
    setConfig(read);
    setFailed(false);
  }, [rpc, projectId, roleId]);
  useEffect(() => {
    void reload().catch(() => setFailed(true));
  }, [reload]);
  return { config, failed, reload };
}
