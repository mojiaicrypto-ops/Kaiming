import { useEffect, useState } from 'react';

/**
 * One source of truth for the viewport tier. Components read `tier` (and never a media query of
 * their own) so the CSS breakpoint and the component branch can only disagree if this file is
 * edited, not if two places drift apart.
 *
 * The thresholds are the TUI authority's: 860 collapses the session rail and the settings menu,
 * 1100 turns the requirement board from four columns into two, 560 is the phone floor.
 */
export type Tier = 'wide' | 'mid' | 'compact' | 'phone';

const QUERIES: ReadonlyArray<{ tier: Tier; query: string }> = [
  { tier: 'wide', query: '(min-width: 1101px)' },
  { tier: 'mid', query: '(min-width: 861px) and (max-width: 1100px)' },
  { tier: 'compact', query: '(min-width: 561px) and (max-width: 860px)' },
  { tier: 'phone', query: '(max-width: 560px)' },
];

function currentTier(): Tier {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  for (const entry of QUERIES) {
    if (window.matchMedia(entry.query).matches) return entry.tier;
  }
  return 'wide';
}

export function useTier(): Tier {
  const [tier, setTier] = useState<Tier>(currentTier);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const lists = QUERIES.map((entry) => window.matchMedia(entry.query));
    const update = (): void => setTier(currentTier());
    for (const list of lists) list.addEventListener('change', update);
    update();
    return () => {
      for (const list of lists) list.removeEventListener('change', update);
    };
  }, []);
  return tier;
}

