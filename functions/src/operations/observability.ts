import { randomUUID } from "node:crypto";

export async function captureOperationalError(code: string, tags: Record<string, string>) {
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
