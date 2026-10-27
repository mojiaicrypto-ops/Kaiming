import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type Translate } from '../i18n/I18nProvider';
import type { CatalogModel } from './config-model';

/**
 * Pick one model from Pi's catalogue by typing part of it.
 *
 * The catalogue is the authority: choosing a model here is the whole declaration, because the entry
 * already says which protocol it speaks, whether it reasons and which levels it accepts. That is why
 * this control replaced the old free-text alias plus a "supports reasoning" box — two fields whose
 * right values only the catalogue knew.
 *
 * Matching is subsequence-fuzzy over "provider/id name", ranked so that the tightest, earliest match
 * wins: typing `d4f` finds `deepseek-v4-flash`, and typing a provider name narrows to it.
 */
export function ModelPicker({
  models,
  value,
  excludeProvider,
  placeholder,
  onChange,
}: {
  models: readonly CatalogModel[];
  /** "provider/id" of the chosen model; empty means nothing is chosen. */
  value: string;
  /** Rows belonging to the provider being edited are not offered: an alias cannot point at itself. */
  excludeProvider: string;
  placeholder: string;
  onChange: (chosen: CatalogModel | null) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  /** Where the list is drawn: measured from the input, so no scrolling ancestor can clip it. */
  const [box, setBox] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const chosen = models.find((model) => keyOf(model) === value && model.providerId !== excludeProvider);
  const matches = useMemo(
    () => rank(models, query, excludeProvider).slice(0, 40),
    [models, query, excludeProvider],
  );

  // Clicking anywhere else closes the list. A picker that stays open over the form hides the row the
  // user is trying to check.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the list under (or above, near the bottom edge) its input while it is open. Measuring on
  // every scroll and resize is cheap here: one open picker at a time.
  useEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const place = (): void => {
      const element = input.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = spaceBelow < 240 && rect.top > spaceBelow;
      setBox({
        top: up ? Math.max(8, rect.top - Math.min(280, rect.top - 8) - 4) : rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        up,
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const choose = (model: CatalogModel): void => {
    onChange(model);
    setQuery(keyOf(model));
    setOpen(false);
  };

  return (
    <div className="picker" ref={wrap}>
      <input
        ref={input}
        className="inp"
        role="combobox"
        aria-expanded={open}
        aria-controls="model-picker-list"
        autoComplete="off"
        value={open ? query : (chosen === undefined ? query : keyOf(chosen))}
        placeholder={placeholder}
        title={t('settings.modelPickerHint')}
        onFocus={() => {
          setOpen(true);
          setQuery(chosen === undefined ? '' : keyOf(chosen));
          setCursor(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setCursor(0);
          // Typing replaces the choice: leaving a stale model selected while the text says another
          // would make Save record something the row does not show.
          if (chosen !== undefined && event.target.value !== keyOf(chosen)) onChange(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setCursor((at) => Math.min(at + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor((at) => Math.max(at - 1, 0));
          } else if (event.key === 'Enter') {
            const pick = matches[cursor];
            if (open && pick !== undefined) {
              event.preventDefault();
              choose(pick);
            }
          } else if (event.key === 'Escape' && open) {
            // With the list open, Escape dismisses the list and nothing else: the form behind may
            // hold unsaved edits, and losing them to a closed dropdown would be a trap. With it
            // closed, Escape is the dialog's to handle, so it is left to bubble.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        data-testid="provider-model-picker"
      />
      {open && (
        <ul
          className="picker-list"
          id="model-picker-list"
          role="listbox"
          style={
            box === null
              ? undefined
              : { top: box.top, left: box.left, width: box.width, maxHeight: box.up ? 280 : undefined }
          }
          data-testid="provider-model-options"
        >
          {matches.length === 0 ? (
            <li className="picker-empty">{t('settings.modelPickerEmpty')}</li>
          ) : (
            matches.map((model, index) => (
              <li
                key={keyOf(model)}
                role="option"
                aria-selected={index === cursor}
                className={index === cursor ? 'picker-row on' : 'picker-row'}
                onMouseDown={(event) => {
                  // mousedown, not click: the input's blur would close the list first.
                  event.preventDefault();
                  choose(model);
                }}
                onMouseEnter={() => setCursor(index)}
                data-testid="provider-model-option"
              >
                <span className="pk-id">{model.id}</span>
                {/* The row is one line: the facts that decide a choice (levels, context) lead, and the
                    rest is readable in the summary once the model is picked. */}
                <span className="pk-meta">{brief(model, t)}</span>
              </li>
            ))
          )}
        </ul>
      )}
      {/* The summary always says what the current value is (a resolved model, or text the catalogue
          does not know), so the row is readable without opening the list. */}
      {!open && (
        <span className={chosen === undefined && value !== '' ? 'meta warn' : 'meta'} data-testid="provider-model-alias-facts">
          {chosen !== undefined ? describe(chosen, t) : value === '' ? '' : t('settings.modelPickerUnknown')}
        </span>
      )}
    </div>
  );
}

/** The one-line version for a list row: how much effort it offers and how much it holds. */
function brief(model: CatalogModel, t: Translate): string {
  const levels = model.thinkingLevels.length > 1 ? model.thinkingLevels.join('/') : t('settings.level.unsupported');
  return `${levels} · ${size(model.contextWindow)}/${size(model.maxTokens)}`;
}

/** What the summary line says about a picked model: provider, protocol, effort, both size limits. */
function describe(model: CatalogModel, t: Translate): string {
  const levels = model.thinkingLevels.length > 1 ? model.thinkingLevels.join('/') : t('settings.level.unsupported');
  return [
    `${model.providerId} · ${model.api}`,
    levels,
    `${t('settings.modelFactsCtx')} ${size(model.contextWindow)}`,
    `${t('settings.modelFactsOut')} ${size(model.maxTokens)}`,
  ].join(' · ');
}

function size(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

export function keyOf(model: { providerId: string; id: string }): string {
  return `${model.providerId}/${model.id}`;
}

/**
 * Rank the catalogue against a typed query.
 *
 * An empty query lists everything (provider by provider, as the server sends it). Otherwise a model
 * scores by how tightly the query's characters appear in `provider/id name`: a contiguous substring
 * beats a scattered subsequence, an earlier match beats a later one, and a shorter name beats a long
 * one, so `glm` puts `zai/glm-5-3` above `openrouter/zai-org/glm-4.6-air`.
 */
export function rank(
  models: readonly CatalogModel[],
  query: string,
  excludeProvider: string,
): readonly CatalogModel[] {
  const usable = models.filter((model) => model.providerId !== excludeProvider);
  const needle = query.trim().toLowerCase();
  if (needle === '') return usable;
  const scored: Array<{ model: CatalogModel; score: number }> = [];
  for (const model of usable) {
    const haystack = `${keyOf(model)} ${model.name}`.toLowerCase();
    const score = fuzzyScore(haystack, needle);
    if (score !== null) scored.push({ model, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.model);
}

/**
 * `null` when the query is not a subsequence; higher is better. Contiguous runs and an early start
 * dominate, so the obvious pick stays first as the user keeps typing.
 */
function fuzzyScore(haystack: string, needle: string): number | null {
  const at = haystack.indexOf(needle);
  if (at >= 0) return 1000 - at * 2 - haystack.length * 0.01;
  let score = 0;
  let from = 0;
  let streak = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, from);
    if (found < 0) return null;
    streak = found === from ? streak + 1 : 0;
    score += 10 + streak * 6 - Math.min(found - from, 20) * 0.1;
    from = found + 1;
  }
  return score - haystack.length * 0.01;
}
