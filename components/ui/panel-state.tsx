"use client";

import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, RotateCw } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";

/** How long a panel may sit in "loading" before we call it a failure. */
const stallMs = 12_000;

export function PanelLoading({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="panel panel-state is-loading" role="status">
      <LoaderCircle aria-hidden="true" className="panel-state-spin" size={18} />
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

export function PanelError({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="panel panel-state is-error" role="alert">
      <CircleAlert aria-hidden="true" size={18} />
      <span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {onRetry ? (
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={onRetry} type="button">
          <RotateCw aria-hidden="true" size={14} /> Try again
        </button>
      ) : null}
    </div>
  );
}

export type WorkspaceGate =
  | { status: "ready"; tenantId: string }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void };

/**
 * Resolves the workspace before a panel tries to load tenant data.
 *
 * Panels that gate their fetch on `workspace.tenantId` never start when the
 * workspace itself fails — auth never resolves, `tenantId` stays null, and the
 * panel sits on its loading state indefinitely with no error and no timeout.
 * That is how a broken client config presented as a spinner that ran forever.
 *
 * This returns an explicit error once the workspace reports one, or once
 * loading has stalled past `stallMs`, so the caller can always say something.
 */
export function useWorkspaceGate(): WorkspaceGate {
  const workspace = useWorkspace();
  // Keyed by the wait we are timing, so a new attempt clears the previous
  // stall by derivation rather than by resetting state inside an effect.
  const waitKey = `${workspace.loading}:${workspace.tenantId ?? ""}`;
  const [stalledKey, setStalledKey] = useState<string | null>(null);
  const stalled = stalledKey === waitKey;

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId) return;
    const timer = setTimeout(() => setStalledKey(waitKey), stallMs);
    return () => clearTimeout(timer);
  }, [waitKey, workspace.loading, workspace.tenantId]);

  if (workspace.tenantId) {
    return { status: "ready", tenantId: workspace.tenantId };
  }
  if (workspace.error) {
    return { status: "error", message: workspace.error, retry: workspace.retry };
  }
  if (stalled) {
    return {
      status: "error",
      message:
        "This workspace is taking longer than expected to load. Check your connection and try again.",
      retry: workspace.retry,
    };
  }
  return { status: "loading" };
}
