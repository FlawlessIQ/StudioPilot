"use client";

import { useEffect } from "react";
import { CLIENT_ERROR_LIMITS, sanitizeClientErrorReport } from "@/lib/observability/client-error";

function eventId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function reportHandledError(code: string) {
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

/**
 * Without a DSN, errors go to our own route (app/api/client-errors), which
 * logs them at ERROR. One page load sends at most this many, and never the
 * same error twice — a render loop must not become a request loop.
 */
const MAX_REPORTS_PER_PAGE_LOAD = 5;
const reported = new Set<string>();
let sent = 0;

/**
 * Report an uncaught browser error. Used by the window listeners below and by
 * app/error.tsx. Never throws and never waits: it must not stand between a
 * failing page and its error screen.
 */
export function reportClientError(caught: unknown) {
  try {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      void reportHandledError(caught instanceof Error ? caught.name : "UNHANDLED_WEB_ERROR");
      return;
    }
    if (typeof window === "undefined" || sent >= MAX_REPORTS_PER_PAGE_LOAD) return;
    const error =
      caught instanceof Error
        ? caught
        : { name: "NonErrorThrown", message: String(caught ?? "unknown"), stack: "" };
    const report = sanitizeClientErrorReport({
      message: error.message,
      name: error.name,
      stack: (error.stack ?? "").slice(0, CLIENT_ERROR_LIMITS.stack),
      route: window.location.pathname,
      userAgent: navigator.userAgent,
    });
    if (!report) return;
    const key = `${report.name}|${report.message}|${report.stack.split("\n")[1] ?? ""}`;
    if (reported.has(key)) return;
    reported.add(key);
    sent += 1;
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Observability must never break the application error path.
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const error = (event: ErrorEvent) => {
      // A failed <img>/<script> load fires "error" with no error object and no
      // message; there is nothing to report and nothing a stack would explain.
      if (!event.error && !event.message) return;
      reportClientError(event.error ?? new Error(event.message));
    };
    const rejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason);
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
