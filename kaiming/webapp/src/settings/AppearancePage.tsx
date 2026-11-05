import { useI18n } from '../i18n/I18nProvider';
import { LOCALES, LOCALE_LABELS, type Locale } from '../i18n/catalog';
import type { Density, ThemePreference } from '../app/usePreferences';

export interface AppearancePageProps {
  readonly locale: Locale;
  readonly onLocale: (locale: Locale) => void;
  readonly theme: ThemePreference;
  readonly onTheme: (theme: ThemePreference) => void;
  readonly density: Density;
  readonly onDensity: (density: Density) => void;
}

/**
 * Appearance: theme, interface language and density. Language lives here (not in a separate
 * "Language" screen) because it is a presentation choice like the other two, and switching it
 * takes effect immediately — no reload, no lost draft.
 */
export function AppearancePage({ locale, onLocale, theme, onTheme, density, onDensity }: AppearancePageProps) {
  const { t } = useI18n();
  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('settings.appearance')}</h1>
        <p className="f3">{t('settings.appearanceDesc')}</p>
        <div className="set-body" data-testid="appearance">
          <div className="rl">
            <span>{t('settings.theme')}</span>
            <span className="seg">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>
                {t('settings.theme.dark')}
              </button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>
                {t('settings.theme.light')}
              </button>
              <button type="button" aria-pressed={theme === 'system'} onClick={() => onTheme('system')}>
                {t('settings.theme.system')}
              </button>
            </span>
            <span />
          </div>
          <div className="rl">
            <span>{t('settings.language')}</span>
            <select
              className="sel"
              aria-label={t('settings.language')}
              value={locale}
              onChange={(event) => onLocale(event.target.value as Locale)}
              data-testid="language"
            >
              {LOCALES.map((entry) => (
                <option key={entry} value={entry}>
                  {LOCALE_LABELS[entry]}
                </option>
              ))}
            </select>
            <span />
          </div>
          <div className="rl">
            <span>{t('settings.density')}</span>
            <span className="seg">
              <button type="button" aria-pressed={density === 'comfortable'} onClick={() => onDensity('comfortable')}>
                {t('settings.density.comfortable')}
              </button>
              <button type="button" aria-pressed={density === 'compact'} onClick={() => onDensity('compact')}>
                {t('settings.density.compact')}
              </button>
            </span>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
