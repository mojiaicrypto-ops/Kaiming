import { useCallback, useEffect, useMemo, useState } from 'react';
import { detectLocale, I18nProvider, LOCALE_STORAGE_KEY, storedLocale } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/catalog';
import { readStored, writeStored } from '../lib/storage';

export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';
export type ThemePreference = Theme | 'system';

const THEME_KEY = 'kaiming.theme';
const DENSITY_KEY = 'kaiming.density';

/**
 * User preferences: interface language, theme and density. All three live in localStorage and
 * are applied to `<html>` (so CSS owns the colours) — components never read a stored key, they
 * read this hook. `theme: system` follows `prefers-color-scheme` and is not written to the
 * root when the OS changes, only re-resolved.
 */
export interface PreferencesApi {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly theme: Theme;
  readonly themePreference: ThemePreference;
  readonly setThemePreference: (preference: ThemePreference) => void;
  readonly density: Density;
  readonly setDensity: (density: Density) => void;
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** A stored value only counts when it is one of the options this build still supports. */
function storedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = typeof localStorage === 'undefined' ? null : readStored(key);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function usePreferences(): PreferencesApi {
  const [locale, setLocaleState] = useState<Locale>(() => storedLocale());
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    storedChoice<ThemePreference>(THEME_KEY, ['dark', 'light', 'system'], 'dark'),
  );
  const [system, setSystem] = useState<Theme>(systemTheme);
  const [density, setDensityState] = useState<Density>(() =>
    storedChoice<Density>(DENSITY_KEY, ['comfortable', 'compact'], 'comfortable'),
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = (): void => setSystem(systemTheme());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const theme: Theme = themePreference === 'system' ? system : themePreference;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset['density'] = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    writeStored(LOCALE_STORAGE_KEY, next);
  }, []);

  const setThemePreference = useCallback((next: ThemePreference): void => {
    setThemePreferenceState(next);
    writeStored(THEME_KEY, next);
  }, []);

  const setDensity = useCallback((next: Density): void => {
    setDensityState(next);
    writeStored(DENSITY_KEY, next);
  }, []);

  return useMemo(
    () => ({ locale, setLocale, theme, themePreference, setThemePreference, density, setDensity }),
    [locale, setLocale, theme, themePreference, setThemePreference, density, setDensity],
  );
}

