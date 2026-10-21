import { useI18n } from '../i18n/I18nProvider';
import { hrefOf, navigate, type Route, type SettingsTab } from '../app/router';
import type { Locale } from '../i18n/catalog';
import type { Density, ThemePreference } from '../app/usePreferences';
import { ProvidersPage } from './ProvidersPage';
import { ModelsPage } from './ModelsPage';
import { AppearancePage } from './AppearancePage';
import type { RpcClient } from '../api/rpc';

export interface SettingsPageProps {
  readonly route: Extract<Route, { view: 'settings' }>;
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly locale: Locale;
  readonly onLocale: (locale: Locale) => void;
  readonly theme: ThemePreference;
  readonly onTheme: (theme: ThemePreference) => void;
  readonly density: Density;
  readonly onDensity: (density: Density) => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
}

const TABS: ReadonlyArray<{ tab: SettingsTab; key: 'settings.providers' | 'settings.models' | 'settings.appearance' }> = [
  { tab: 'providers', key: 'settings.providers' },
  { tab: 'models', key: 'settings.models' },
  { tab: 'appearance', key: 'settings.appearance' },
];

/**
 * Settings: a left menu and one pane. The menu becomes a horizontal bar below 860px; the pane is
 * the same component either way. Each pane owns its own data read so switching tabs never shows
 * another pane's state.
 */
export function SettingsPage({ route, rpc, projectId, locale, onLocale, theme, onTheme, density, onDensity, onNotice }: SettingsPageProps) {
  const { t } = useI18n();
  return (
    <div className="settings">
      <aside className="menu" aria-label={t('nav.settings')}>
        <div className="h">{t('settings.title')}</div>
        {TABS.map((entry) => (
          <button
            key={entry.tab}
            type="button"
            className="s"
            aria-current={route.tab === entry.tab ? 'true' : undefined}
            onClick={() => navigate(hrefOf({ view: 'settings', tab: entry.tab }))}
            data-testid={`settings-tab-${entry.tab}`}
          >
            {t(entry.key)}
          </button>
        ))}
      </aside>
      {route.tab === 'providers' && <ProvidersPage rpc={rpc} projectId={projectId} />}
      {route.tab === 'models' && (
        <ModelsPage
          rpc={rpc}
          projectId={projectId}
          onSaved={(message) => onNotice(message, 'success')}
          onError={(message) => onNotice(message, 'error')}
        />
      )}
      {route.tab === 'appearance' && (
        <AppearancePage
          locale={locale}
          onLocale={onLocale}
          theme={theme}
          onTheme={onTheme}
          density={density}
          onDensity={onDensity}
        />
      )}
    </div>
  );
}
