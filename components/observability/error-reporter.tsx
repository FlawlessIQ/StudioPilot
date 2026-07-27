"use client";

import { useEffect } from "react";

function eventId() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function report(code: string) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!url.username || !projectId) return;
    const id = eventId();
    const envelope = [
      JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: id,
        timestamp: Date.now() / 1000,
        platform: "javascript",
        level: "error",
        message: code.slice(0, 160),
        tags: { surface: "web", release: process.env.NEXT_PUBLIC_APP_VERSION ?? "development" },
      }),
    ].join("\n");
    await fetch(`${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(url.username)}&sentry_version=7`, {
      method: "POST",
      body: envelope,
      keepalive: true,
    });
  } catch {
    // Observability must never break the application error path.
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const error = (event: ErrorEvent) => { void report(event.error?.name ?? "UNHANDLED_WEB_ERROR"); };
    const rejection = (event: PromiseRejectionEvent) => {
      void report(event.reason instanceof Error ? event.reason.name : "UNHANDLED_PROMISE_REJECTION");
    };
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, []);
  return null;
}
