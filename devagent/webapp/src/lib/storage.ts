/**
 * `localStorage` access that cannot take the shell down. A blocked store (private mode, a policy,
 * a full quota) makes every read and write throw, and an exception inside a state initializer
 * would leave a blank page — so the shell treats storage as an optimisation, not a requirement.
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
