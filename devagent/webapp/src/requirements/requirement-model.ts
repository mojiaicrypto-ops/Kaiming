import { useCallback, useEffect, useState } from 'react';
import type { RpcClient } from '../api/rpc';

export interface RequirementSummary {
  readonly id: string;
  readonly kind: 'proposal' | 'implementation';
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly sourceRequirementIds: readonly string[];
  readonly linkedTaskIds: readonly string[];
}

export interface InvalidRequirementFile {
  readonly file: string;
  readonly issues: readonly string[];
}

export interface RequirementRead {
  readonly requirementId: string;
  readonly path: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
  readonly issues: readonly string[];
}

export type Column = 'proposal' | 'todo' | 'doing' | 'done';

/**
 * Which board column a record belongs to: a projection of its own status, never a second status.
 * A proposal is always a proposal; an implementation requirement moves when the server says so.
 */
export function columnOf(record: RequirementSummary): Column {
  if (record.kind === 'proposal') return 'proposal';
  if (record.status === 'completed') return 'done';
  if (record.status === 'in_progress') return 'doing';
  return 'todo';
}

/** The `## heading` sections the requirement format defines, in document order. */
export function sectionsOf(text: string): Record<string, string> {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const out: Record<string, string> = {};
  for (const part of body.split(/^##\s+/m).slice(1)) {
    const newline = part.indexOf('\n');
    if (newline < 0) continue;
    out[part.slice(0, newline).trim()] = part.slice(newline + 1).trim();
  }
  return out;
}

export function useRequirements(rpc: RpcClient, projectId: string) {
  const [items, setItems] = useState<readonly RequirementSummary[]>([]);
  const [invalid, setInvalid] = useState<readonly InvalidRequirementFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (): Promise<void> => {
    if (projectId === '') {
      setLoading(false);
      return;
    }
    try {
      const read = await rpc.call<{ items: RequirementSummary[]; invalidFiles: InvalidRequirementFile[] }>(
        'requirement.list',
        { projectId, limit: 200 },
      );
      setItems(read.items);
      setInvalid(read.invalidFiles);
      setError(null);
    } catch (cause) {
      // Keep whatever was on screen and say the read failed: an empty board would read as "no
      // requirements", which is a different and much worse statement.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [rpc, projectId]);
  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);
  return { items, invalid, loading, error, reload };
}
