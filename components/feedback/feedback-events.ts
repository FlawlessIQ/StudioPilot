/**
 * Lets anything in the studio workspace — the phone drawer, the How-to popup,
 * an error screen — open the feedback sheet, the same way openHowTo opens a
 * guide. The launcher registers itself while mounted.
 */

const EVENT = "studiocue:feedback";
let hosts = 0;

/** Opens the feedback sheet. False when no launcher is mounted to open it. */
export function openFeedback(): boolean {
  if (typeof window === "undefined" || hosts === 0) return false;
  window.dispatchEvent(new CustomEvent(EVENT));
  return true;
}

/** For the launcher: listen for open requests while mounted. */
export function listenForFeedback(onOpen: () => void): () => void {
  const handler = () => onOpen();
  hosts += 1;
  window.addEventListener(EVENT, handler);
  return () => {
    hosts -= 1;
    window.removeEventListener(EVENT, handler);
  };
}

/**
 * The last error the page hit, so a "Something's broken" report carries it
 * without the studio having to copy it out. Only the message, and only for
 * ten minutes: an error from this morning is not what they're reporting.
 */
let lastError: { message: string; at: number } | null = null;
let listening = false;

export function rememberPageErrors(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const record = (message: string) => {
    if (message) lastError = { message: message.slice(0, 600), at: Date.now() };
  };
  window.addEventListener("error", (event) => record(event.message || String(event.error ?? "")));
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    record(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "");
  });
}

export function recentPageError(): string | null {
  return lastError && Date.now() - lastError.at < 10 * 60_000 ? lastError.message : null;
}
