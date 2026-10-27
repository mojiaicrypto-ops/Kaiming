import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { RpcClient } from '../api/rpc';

export interface ProviderModel {
  readonly id: string;
  readonly name?: string;
  /** Declared by the user: Pi offers thinking levels other than `off` only for such a model. */
  readonly reasoning?: boolean;
  /**
   * The catalogue model this gateway alias really is. A gateway names models its own way, and the
   * facts below are copied from the real model instead of Pi's fallback (128k context, 16k output).
   */
  readonly baseModel?: { readonly providerId: string; readonly modelId: string };
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  /** What Pi would accept for this model; the page renders these, it never keeps its own list. */
  readonly thinkingLevels?: readonly string[];
}

/** One catalogue name the alias picker offers. */
export interface CatalogModel {
  readonly providerId: string;
  readonly id: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface ProviderView {
  readonly providerId: string;
  /** Display label; the server falls back to providerId when nobody named it. */
  readonly name: string;
  readonly baseUrl: string;
  readonly api: string | null;
  readonly models: readonly ProviderModel[];
  readonly credentialConfigured: boolean;
  readonly revision: number;
}

/** One saved override, or null when that layer inherits. */
export interface Assignment {
  readonly providerId: string;
  readonly modelId: string;
  /** Pi thinking level saved with this model; empty means the row never set one. */
  readonly thinkingLevel?: string;
  readonly revision: number;
}

export interface ConfigView {
  readonly roleId: string;
  readonly effective: {
    readonly providerId: string;
    readonly modelId: string;
    readonly thinkingLevel: string;
    readonly thinkingLevels?: readonly string[];
    readonly source: string;
  };
  /** What each layer stores — an inherited model is not a saved choice. */
  readonly overrides: {
    readonly role: Assignment | null;
    readonly project: Assignment | null;
    readonly projectRole: Assignment | null;
  };
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
 * The catalogue's model names, read once for the alias picker. It is a long list (order of a thousand
 * entries), so it is its own call: every settings row would otherwise carry it.
 */
export function useCatalog(rpc: RpcClient) {
  const [models, setModels] = useState<readonly CatalogModel[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void rpc
      .call<{
        providers: Array<{
          providerId: string;
          models: Array<{ id: string; reasoning: boolean; contextWindow: number; maxTokens: number }>;
        }>;
      }>('config.catalog', {})
      .then((read) => {
        if (cancelled) return;
        setModels(
          read.providers.flatMap((provider) =>
            provider.models.map((model) => ({
              providerId: provider.providerId,
              id: model.id,
              reasoning: model.reasoning,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            })),
          ),
        );
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);
  return { models, failed };
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
