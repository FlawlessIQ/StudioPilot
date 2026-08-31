import { randomUUID } from "node:crypto";
import { logger } from "firebase-functions/v2";

export async function captureOperationalError(code: string, tags: Record<string, string>) {
  /**
   * Cloud Logging first, and unconditionally.
   *
   * This function used to begin `if (!dsn) return`, and the production
   * `SENTRY_DSN` secret has no versions — so it returned on its first line
   * every time. A job that exhausted its retries and went to `dead_letter`
   * produced no signal anywhere: not a log line, not an alert, nothing. The
   * only way to notice was to read Firestore and look for the status.
   *
   * A structured `jsonPayload` entry is the right base layer regardless of
   * whether Sentry is ever wired up: it is always available in this runtime,
   * it costs nothing extra, and it is what Cloud Monitoring's log-based
   * metrics and alert policies can actually see. Sentry stays as the richer
   * destination when a DSN exists.
   *
   * `studiocueOperationalError` is the field alerting keys off. Renaming it
   * silently breaks the alert policy, which is why it is a literal here and
   * not derived.
   */
  logger.error("studiocueOperationalError", {
    studiocueOperationalError: true,
    code,
    ...tags,
  });
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!url.username || !projectId) return;
    const eventId = randomUUID().replaceAll("-", "");
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: eventId,
        timestamp: Date.now() / 1000,
        platform: "node",
        level: "error",
        message: code.slice(0, 160),
        tags: { surface: "functions", ...tags },
      }),
    ].join("\n");
    await fetch(`${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(url.username)}&sentry_version=7`, {
      method: "POST",
      body: envelope,
    });
  } catch {
    // Reporting failures must not hide the original operation failure.
  }
}
