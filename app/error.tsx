"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/observability/error-reporter";
import { StatusPage, statusPageStyles } from "@/components/observability/status-page";

/**
 * A page that threw while rendering. The error is reported the same way an
 * uncaught one is (app/api/client-errors, or Sentry when a DSN is set); the
 * person sees a calm page and a way to try again.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <StatusPage
      eyebrow="Something went wrong"
      title="This page hit a problem."
      lead="It's been logged and we'll look into it. Anything you'd already saved is safe — try again, and if it keeps happening, let us know."
      action={
        <button type="button" onClick={reset} style={statusPageStyles.primary}>
          Try again
        </button>
      }
    />
  );
}
