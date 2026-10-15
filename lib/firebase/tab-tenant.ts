/**
 * Which studio this tab is working in.
 *
 * The choice used to live only in localStorage, which every tab shares: open
 * a second tab on another studio and the first tab's Data & account screen
 * exported that other studio while its sidebar still named the first (prod
 * test, 2026-10-15). Settings screens that save — identity, branding,
 * availability, billing — could do the same. Now each tab keeps its own
 * choice in sessionStorage, and localStorage only remembers the last one for a
 * new tab to start from.
 */
const KEY = "studiohub.activeTenantId";

export function preferredTenantId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const here = window.sessionStorage.getItem(KEY);
    if (here) return here;
  } catch {
    // Storage refused: fall through to the shared choice.
  }
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberTenantId(tenantId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, tenantId);
  } catch {
    // Private mode: the choice lasts this page only.
  }
  try {
    window.localStorage.setItem(KEY, tenantId);
  } catch {
    // As above.
  }
}
