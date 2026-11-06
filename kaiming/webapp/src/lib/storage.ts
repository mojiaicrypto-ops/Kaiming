/**
 * Browser storage that cannot take the shell down. A blocked store (private mode, a policy, a full
 * quota) makes every read and write throw, and an exception inside a state initializer would leave
 * a blank page — so the shell treats storage as an optimisation, not a requirement.
 *
 * Two scopes, on purpose: `localStorage` is one profile and therefore one value for every tab,
 * while `sessionStorage` is one tab. A project choice belongs to the tab that made it; a shared
 * "last project" is only a default for a tab that has not chosen yet.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Losing the remembered preference is acceptable; losing the page is not.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}

export function readTab(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeTab(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Same as the shared store: a lost preference must not become a lost page.
  }
}

export function removeTab(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
