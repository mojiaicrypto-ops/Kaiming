import { useState } from 'react';
import type { PendingInteraction } from '../api/stream';

interface Props {
  interaction: PendingInteraction;
  sourceRole?: string;
  onAnswer: (response: unknown) => Promise<void>;
}

/** The interaction bridge (M5): confirm/select/input, answered through interaction.respond. */
export function InteractionCard({ interaction, sourceRole, onAnswer }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (response: unknown): Promise<void> => {
    setBusy(true);
    try {
      await onAnswer(response);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`interaction-card interaction-${interaction.method}`} data-interaction-id={interaction.interactionId}>
      <div className="interaction-head">
        <strong>{interaction.title}</strong>
        {sourceRole !== undefined && <span className="interaction-source">{sourceRole}</span>}
      </div>
      {interaction.message !== null && interaction.message !== '' && (
        <p className="interaction-message">{interaction.message}</p>
      )}
      {interaction.method === 'confirm' && (
        <div className="interaction-actions">
          <button type="button" disabled={busy} onClick={() => void answer({ confirmed: true })}>确认</button>
          <button type="button" disabled={busy} onClick={() => void answer({ confirmed: false })}>取消</button>
        </div>
      )}
      {interaction.method === 'select' && interaction.options !== null && (
        <div className="interaction-options">
          {interaction.options.map((option) => (
            <button key={option} type="button" disabled={busy} onClick={() => void answer({ value: option })}>
              {option}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => void answer({ cancelled: true })}>不选择</button>
        </div>
      )}
      {interaction.method === 'input' && (
        <form
          className="interaction-input"
          onSubmit={(event) => {
            event.preventDefault();
            void answer({ value });
          }}
        >
          <input
            value={value}
            placeholder={interaction.placeholder ?? ''}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={busy}>发送</button>
        </form>
      )}
    </div>
  );
}
