/**
 * Turning an auth/provider failure into something a photographer can act on.
 *
 * The audit hit this by accident and it was the worst non-client screen found:
 * when the ID token was revoked, `/studio` rendered
 *
 *   "Studio data is temporarily unavailable — The Firebase ID token has been
 *    revoked."            (provider internals, verbatim)
 *   "Good morning, Signed-in"   (a placeholder used as a person's name)
 *   "Catching up… / Reading your studio…"   (forever)
 *
 * with a Retry button that could never succeed, because the token was gone
 * rather than late. Nothing sent the user to sign in.
 *
 * Two things are needed: never show a provider string, and know the difference
 * between "try again" and "your session ended". Pure, no I/O.
 */

export type SessionFailureKind =
  /** The session is gone. Retrying cannot help; sign in again. */
  | "session_ended"
  /** Reachable but refused — a permissions or membership problem. */
  | "not_permitted"
  /** Transient. Retrying is the right offer. */
  | "unavailable";

export type SessionFailure = {
  kind: SessionFailureKind;
  /** One sentence, no provider vocabulary. */
  message: string;
  /** Whether offering "Retry" makes sense at all. */
  retryable: boolean;
};

/**
 * Signatures that mean the credential is no longer valid. Matched loosely
 * because they arrive from several layers (Firebase Auth, the Admin SDK, our own
 * command endpoints) with different wording.
 */
const SESSION_ENDED = [
  /id ?token .*(revoked|expired)/i,
  /token.*(revoked|expired)/i,
  /auth\/(id-token-expired|id-token-revoked|user-token-expired|user-disabled|invalid-user-token)/i,
  /credential.*(no longer valid|expired)/i,
  /\bunauthenticated\b/i,
  /sign in to (load|access)/i,
];

const NOT_PERMITTED = [
  /permission[-_ ]denied/i,
  /\bforbidden\b/i,
  /missing or insufficient permissions/i,
  /membership.*(inactive|not found)/i,
  /access denied/i,
];

/**
 * Classify a failure. Unknown causes are treated as transient, because offering
 * a retry on something recoverable is a smaller error than telling somebody
 * their session ended when it did not.
 */
export function classifySessionFailure(raw: unknown): SessionFailure {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";

  if (SESSION_ENDED.some((pattern) => pattern.test(text))) {
    return {
      kind: "session_ended",
      message: "Your session has ended. Sign in again to continue.",
      retryable: false,
    };
  }
  if (NOT_PERMITTED.some((pattern) => pattern.test(text))) {
    return {
      kind: "not_permitted",
      message:
        "This workspace is not available to your account. Ask the studio owner to check your access.",
      retryable: false,
    };
  }
  return {
    kind: "unavailable",
    message:
      "We could not reach your studio just now. This is usually temporary.",
    retryable: true,
  };
}

/**
 * A first name for a greeting, or null when there isn't one.
 *
 * Returning null matters: the fallback display name is the literal string
 * "Signed-in user", and `.split(" ")[0]` on it produced "Good morning,
 * Signed-in." A greeting with no name is fine; a greeting addressed to a
 * placeholder is not.
 */
export function greetingName(displayName: unknown): string | null {
  if (typeof displayName !== "string") return null;
  const trimmed = displayName.trim();
  if (!trimmed) return null;
  // Placeholders that must never be read as a person.
  if (/^(signed-in( user)?|unknown|user|guest|member)$/i.test(trimmed)) {
    return null;
  }
  const first = trimmed.split(/\s+/)[0];
  return first && !/^signed-in$/i.test(first) ? first : null;
}
