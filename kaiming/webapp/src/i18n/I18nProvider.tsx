import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { CATALOG, LOCALES, format, type Locale, type MessageKey } from './catalog';
import { readStored, writeStored } from '../lib/storage';

const STORAGE_KEY = 'kaiming.locale';

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

interface I18nValue {
  readonly locale: Locale;
  readonly t: Translate;
  readonly setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Browser language → supported locale. Chinese scripts land on zh-CN, everything else on en. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const tag = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return tag.startsWith('zh') ? 'zh-CN' : 'en';
}

export function storedLocale(): Locale {
  if (typeof localStorage === 'undefined') return detectLocale();
  const stored = readStored(STORAGE_KEY);
  return LOCALES.includes(stored as Locale) ? (stored as Locale) : detectLocale();
}

export function I18nProvider({ locale, onLocale, children }: { locale: Locale; onLocale: (locale: Locale) => void; children: ReactNode }) {
  const t = useCallback<Translate>(
    (key, values) => format(CATALOG[locale][key] ?? CATALOG.en[key] ?? key, values),
    [locale],
  );
  const value = useMemo<I18nValue>(() => ({ locale, t, setLocale: onLocale }), [locale, t, onLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}

export { STORAGE_KEY as LOCALE_STORAGE_KEY };
