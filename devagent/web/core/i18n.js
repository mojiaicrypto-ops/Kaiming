/**
 * i18n: the mock's own copy (keys and strings extracted from webui/index.html) applied to
 * `data-i18n` / `data-i18n-aria` attributes. The language is a local preference, not server state.
 */

export class I18n {
  constructor(messages, language = 'zh-CN') {
    this.messages = messages;
    this.language = language;
    this.listeners = new Set();
  }

  static async load(url = '/i18n.json', language) {
    const stored = localStorage.getItem('agentdev.language');
    const response = await fetch(url, { cache: 'no-store' });
    const messages = response.ok ? await response.json() : { en: {}, 'zh-CN': {} };
    const chosen =
      language ?? stored ?? (navigator.language?.startsWith('zh') === true ? 'zh-CN' : 'en');
    return new I18n(messages, chosen);
  }

  /** The string for a key, falling back to the other language and then to the key itself. */
  t(key) {
    return this.messages[this.language]?.[key] ?? this.messages['en']?.[key] ?? key;
  }

  setLanguage(language) {
    if (this.language === language) {
      return;
    }
    this.language = language;
    localStorage.setItem('agentdev.language', language);
    this.apply(document);
    for (const listener of this.listeners) {
      listener(language);
    }
  }

  onLanguage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply the current language to a subtree (default: the whole document). */
  apply(root = document) {
    document.documentElement.lang = this.language;
    for (const node of root.querySelectorAll('[data-i18n]')) {
      node.textContent = this.t(node.dataset.i18n);
    }
    for (const node of root.querySelectorAll('[data-i18n-aria]')) {
      node.setAttribute('aria-label', this.t(node.dataset.i18nAria));
    }
    // Placeholders carry the same copy as labels; without this the markup's fallback text stays.
    for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
      node.setAttribute('placeholder', this.t(node.dataset.i18nPlaceholder));
    }
  }
}
