import * as logger from "firebase-functions/logger";
import { ZodError } from "zod";
import { invalidCommandResponse } from "./invalid-command.js";

/**
 * How a command endpoint answers when its handler throws.
 *
 * Every command endpoint ended in the same catch: `400 { error: message }`
 * for anything at all. A refusal the code meant ("FORBIDDEN",
 * "PROJECT_VERSION_CONFLICT") and a crash nobody meant (a Firestore timeout, a
 * `TypeError`, Stripe's prose) left the same way — as a 400, which no alert
 * watches, carrying whatever the exception said, which the browser then showed
 * the studio because it "looked human". A broken onboarding produced no log
 * line and no 5xx; the only witness was the person it failed.
 *
 * So the catch now sorts the two:
 *
 * - **Known** — a business code (`UPPER_SNAKE`, optionally `:detail`), a
 *   schema failure (`ZodError`), or a Firebase token refusal from
 *   `requireIdentity` / `requireAppCheck` (`auth/…`, `app-check/…`). These keep
 *   the status they always had, and their code, because the client's copy map
 *   is keyed on it.
 * - **Unexpected** — anything else. Logged at ERROR with its stack, answered
 *   500 `{ error: "INTERNAL" }`, so Cloud Run's 5xx alert fires and nothing
 *   internal reaches the browser.
 */

/** `PROJECT_NOT_FOUND`, `INVALID_TRANSITION:BOOKED>READY`, `APP_CHECK_REQUIRED`. */
const BUSINESS_CODE = /^[A-Z][A-Z0-9_]*$/;

const firebaseTokenRefusal = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^(auth|app-check)\//.test(code);
};

const isZodError = (error: unknown): error is ZodError =>
  error instanceof ZodError ||
  (error instanceof Error && error.name === "ZodError" && Array.isArray((error as ZodError).issues));

export function isKnownCommandError(error: unknown): boolean {
  if (isZodError(error)) return true;
  if (firebaseTokenRefusal(error)) return true;
  if (!(error instanceof Error)) return false;
  const code = error.message.split(":")[0] ?? "";
  return BUSINESS_CODE.test(code);
}

export type CommandErrorOutcome =
  | { kind: "known"; status: number; body: Record<string, unknown> }
  | { kind: "unexpected"; status: 500; body: { error: "INTERNAL" } };

export type CommandErrorContext = {
  /** The function's name, for the log line: `${name}_unexpected`. */
  name: string;
  /** The command's `type`, when the request carried one. */
  commandType?: string;
  /**
   * The status for a known code. Each endpoint had its own (403 for
   * FORBIDDEN, 404 for *_NOT_FOUND, 429 for RATE_LIMITED); default 400.
   */
  status?: (message: string) => number;
};

/** The decision alone, without the response — what the tests pin. */
export function classifyCommandError(
  error: unknown,
  context: Pick<CommandErrorContext, "status"> = {},
): CommandErrorOutcome {
  if (isZodError(error))
    return { kind: "known", status: 400, body: invalidCommandResponse(error) };
  if (firebaseTokenRefusal(error))
    // The status these always had. The message is Firebase's own sentence
    // about the token, which is what the clients have always received.
    return { kind: "known", status: 400, body: { error: (error as Error).message } };
  if (isKnownCommandError(error)) {
    const message = (error as Error).message;
    return { kind: "known", status: context.status?.(message) ?? 400, body: { error: message } };
  }
  return { kind: "unexpected", status: 500, body: { error: "INTERNAL" } };
}

type JsonResponse = {
  status(code: number): { json(body: unknown): unknown };
};

/** The command type from a raw request body, bounded for the log line. */
export function commandTypeOf(body: unknown): string | undefined {
  const type = (body as { type?: unknown } | null | undefined)?.type;
  return typeof type === "string" ? type.slice(0, 80) : undefined;
}

export function respondToCommandError(
  response: JsonResponse,
  error: unknown,
  context: CommandErrorContext,
): void {
  const outcome = classifyCommandError(error, context);
  if (outcome.kind === "unexpected") {
    logger.error(`${context.name}_unexpected`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      commandType: context.commandType,
    });
  }
  response.status(outcome.status).json(outcome.body);
}
