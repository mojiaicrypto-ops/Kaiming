import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Drawer } from '../app/Drawer';
import { Markdown } from '../chat/Markdown';
import type { RpcClient } from '../api/rpc';
import { sectionsOf, type InvalidRequirementFile, type RequirementRead, type RequirementSummary } from './requirement-model';

export interface RequirementDrawerProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly invalidFile: string | null;
  readonly card: RequirementSummary | undefined;
  readonly invalid: InvalidRequirementFile | undefined;
  readonly onClose: () => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
}

// The proposal body the server's own template produces (requirementStore.requirementTemplate):
// 目标 / 来源与决定 / 处理记录. Anything else in a proposal is shown after these.
const PROPOSAL_SECTIONS = ['目标', '来源与决定', '处理记录'];
const IMPL_SECTIONS = ['目标', '范围', '行为与异常', '验收', '来源与决定', '未知', '完成摘要'];

/** Section headings are Chinese by the requirement format contract; the drawer maps them to labels. */
type SectionKey =
  | 'req.sec.intent'
  | 'req.sec.goal'
  | 'req.sec.scope'
  | 'req.sec.behavior'
  | 'req.sec.acceptance'
  | 'req.sec.source'
  | 'req.sec.unknown'
  | 'req.sec.summary'
  | 'req.sec.history';

const SECTION_LABEL: Record<string, SectionKey> = {
  意图: 'req.sec.intent',
  目标: 'req.sec.goal',
  范围: 'req.sec.scope',
  行为与异常: 'req.sec.behavior',
  验收: 'req.sec.acceptance',
  来源: 'req.sec.source',
  来源与决定: 'req.sec.source',
  未知: 'req.sec.unknown',
  完成摘要: 'req.sec.summary',
  处理记录: 'req.sec.history',
};

/**
 * Requirement detail. The two kinds are genuinely different documents — a proposal carries intent,
 * source and unknowns; an implementation requirement carries goal, scope, acceptance and (once
 * done) a completion summary — so the drawer shows each its own sections instead of a union with
 * empty rows. An unparsable file shows its path, line, reason and the raw source.
 */
/** Status in the user's language: the record's own enum never reaches the screen. */
function statusWord(
  card: RequirementSummary,
  t: (key: 'req.state.idle' | 'req.state.todo' | 'req.state.done' | 'req.state.paused') => string,
): string {
  if (card.status === 'completed') return t('req.state.done');
  if (card.status === 'in_progress') return t('req.state.todo');
  if (card.status === 'cancelled' || card.status === 'archived') return t('req.state.paused');
  return card.kind === 'proposal' ? t('req.state.idle') : t('req.state.todo');
}

export function RequirementDrawer({ rpc, projectId, invalidFile, card, invalid, onClose, onNotice }: RequirementDrawerProps) {
  const { t } = useI18n();
  const [read, setRead] = useState<RequirementRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A cancelled flag, not just a dependency: switching cards quickly must not paint the previous
  // document under the new title.
  useEffect(() => {
    if (invalidFile !== null || card === undefined) return;
    let cancelled = false;
    setRead(null);
    setError(null);
    void rpc
      .call<RequirementRead>('requirement.get', { projectId, requirementId: card.id })
      .then((value) => {
        if (!cancelled) setRead(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, card, invalidFile]);

  const sections = read === null ? {} : sectionsOf(read.text);
  const kind = card?.kind ?? 'implementation';
  const wanted = kind === 'proposal' ? PROPOSAL_SECTIONS : IMPL_SECTIONS;

  // The board cannot start work by itself: it hands the request to the chat composer, which is
  // where a session actually begins. Saying "sent" without that would be a false confirmation.
  const handToChief = useCallback(
    (text: string): void => {
      onNotice(text, 'info');
      onClose();
    },
    [onNotice, onClose],
  );

  if (invalidFile !== null) {
    return (
      <Drawer
        eyebrow={invalidFile}
        title={<State kind="block">{t('req.invalidView')}</State>}
        onClose={onClose}
        footer={
          <button type="button" className="btn pri" onClick={() => handToChief(t('req.fixReady', { id: invalidFile }))}>
            {t('req.askChiefFix')}
          </button>
        }
      >
        <div className="sec">
          <div className="sh">{t('req.sec.status')}</div>
          <ul>
            {(invalid?.issues ?? []).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
        <div className="f3">{t('req.invalidKeep')}</div>
      </Drawer>
    );
  }

  if (card === undefined) return null;

  return (
    <Drawer
      eyebrow={`${card.id} · ${card.kind === 'proposal' ? t('req.kindProposal') : t('req.kindImpl')}`}
      title={card.title}
      onClose={onClose}
      footer={
        card.kind === 'proposal' ? (
          <button type="button" className="btn pri" onClick={() => handToChief(t('req.delegateDesignReady', { id: card.id }))}>
            {t('req.delegateDesign')}
          </button>
        ) : (
          <button type="button" className="btn pri" onClick={() => handToChief(t('req.implementReady', { id: card.id }))}>
            {t('req.implement')}
          </button>
        )
      }
    >
      <div className="sec">
        <div className="sh">{t('req.sec.status')}</div>
        <div>
          <State kind={card.kind === 'proposal' ? 'idle' : card.status === 'completed' ? 'done' : card.status === 'in_progress' ? 'run' : 'wait'}>
            {statusWord(card, t)}
          </State>
        </div>
      </div>
      {error !== null && <div className="f3">{error}</div>}
      {read === null && error === null && <div className="f3">{t('common.loading')}</div>}
      {/* Known sections first, in the format's order; then anything else the document carries —
          a record written before a heading existed must not lose its body. */}
      {[...wanted, ...Object.keys(sections).filter((heading) => !wanted.includes(heading))].map((heading) => {
        const body = sections[heading];
        if (body === undefined || body === '') return null;
        const key = SECTION_LABEL[heading];
        return (
          <div className="sec" key={heading}>
            <div className="sh">{key === undefined ? heading : t(key)}</div>
            <div className="md">
              <Markdown text={body} />
            </div>
          </div>
        );
      })}
    </Drawer>
  );
}
