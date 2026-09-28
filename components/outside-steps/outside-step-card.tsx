"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  LifeBuoy,
  LoaderCircle,
  Send,
} from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { Copyable, OpenLink, Path, Rich, Tip } from "@/components/outside-steps/guide-parts";
import {
  outsideStepAsText,
  shareStepHref,
  supportStepHref,
} from "@/features/outside-steps/share";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  OUTSIDE_STEPS,
  type OutsideStepId,
  type OutsideStepStatus,
} from "@/features/outside-steps/registry";
import { setOutsideStep } from "@/lib/integrations/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { formatDueDate } from "@/lib/format/event-date";

const ICON = {
  not_started: ExternalLink,
  waiting: Clock,
  done: CheckCircle2,
  attention: AlertTriangle,
} as const;

/**
 * One step the studio takes outside StudioCue: a row saying where it stands,
 * and a guide that says exactly what to do there (features/outside-steps).
 *
 * `action` is the in-StudioCue control the step ends with, when there is one
 * — the reconnect button for QuickBooks' payments permission.
 */
export function OutsideStepCard({
  stepId,
  status,
  action,
  number,
}: {
  stepId: OutsideStepId;
  status: OutsideStepStatus;
  action?: ReactNode;
  /** Shown as one numbered step of a sequence (Autopay's three), not a row. */
  number?: number;
}) {
  const step = OUTSIDE_STEPS[stepId];
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const Icon = ICON[status.state];

  async function mark(state: "waiting" | "done" | null) {
    if (!workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const { persisted } = await setOutsideStep(stepId, state, workspace.tenantId);
      refreshTenantRecords("tenants");
      if (!persisted) setNotice("Preview mode: this wasn't saved.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That step could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  const since = status.since ? formatDueDate(status.since) : null;

  return (
    <>
      {number ? (
        <button
          className={`outside-step-tile is-${status.state}`}
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="outside-step-tile-top">
            <span className="outside-step-tile-number">
              {status.state === "done" ? <CheckCircle2 aria-hidden="true" size={15} /> : number}
            </span>
            <small>In {step.where.replace(/ \(.*\)$/, "")}</small>
          </span>
          <strong>{step.title}</strong>
          <em>
            <Icon aria-hidden="true" size={13} /> {status.label}
            {since && status.state === "waiting" ? ` since ${since}` : ""}
          </em>
          <span className="outside-step-card-go">
            {status.state === "done" ? "Details" : "Show me how"} <ArrowRight aria-hidden="true" size={14} />
          </span>
        </button>
      ) : (
      <button
        className={`outside-step-card is-${status.state}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="outside-step-card-icon">
          <Icon aria-hidden="true" size={16} />
        </span>
        <span className="outside-step-card-body">
          <small>Outside StudioCue · in {step.where}</small>
          <strong>{step.title}</strong>
          <em>
            {status.label}
            {since && status.state === "waiting" ? ` since ${since}` : ""}
          </em>
        </span>
        <span className="outside-step-card-go">
          {status.state === "done" ? "Details" : "Show me how"} <ArrowRight aria-hidden="true" size={14} />
        </span>
      </button>
      )}

      <SheetDialog label={step.title} onClose={() => setOpen(false)} open={open}>
        <div className="record-sheet outside-step-guide">
          <header>
            <p className="eyebrow">Outside StudioCue · in {step.where}</p>
            <h3>{step.title}</h3>
            <p>{step.why}</p>
          </header>
          <dl className="outside-step-facts">
            <div>
              <dt>Who does it</dt>
              <dd>{step.who}</dd>
            </div>
            {step.wait ? (
              <div>
                <dt>How long</dt>
                <dd>{step.wait}</dd>
              </div>
            ) : null}
            <div>
              <dt>What it unlocks</dt>
              <dd>{step.unlocks}</dd>
            </div>
          </dl>
          <ol className="outside-step-list">
            {step.instructions.map((instruction, index) => (
              <li key={instruction.title}>
                <span className="outside-step-number">{index + 1}</span>
                <div>
                  <strong>{instruction.title}</strong>
                  <p>
                    <Rich text={instruction.text} />
                  </p>
                  {instruction.path ? <Path steps={instruction.path} /> : null}
                  {instruction.link ? (
                    <OpenLink href={instruction.link.href} label={instruction.link.label} />
                  ) : null}
                  {instruction.tip ? <Tip>{instruction.tip}</Tip> : null}
                </div>
              </li>
            ))}
          </ol>
          <div className={`outside-step-status is-${status.state}`} role="status">
            <Icon aria-hidden="true" size={16} />
            <span>
              <strong>{status.label}</strong>
              {status.detected
                ? " — StudioCue saw this for itself."
                : step.detection === "automatic"
                  ? " — StudioCue will tick this off by itself."
                  : since
                    ? ` — you told us on ${since}.`
                    : ""}
            </span>
          </div>
          {/* Someone else does it, or it isn't working: hand it on with
              everything they need, or ask us with the context attached. */}
          <div className="outside-step-help">
            <a
              className="button button-light button-sm"
              href={shareStepHref(stepId, workspace.tenantName)}
            >
              <Send aria-hidden="true" size={13} /> Send these steps to…
            </a>
            <Copyable label="Copy steps" value={outsideStepAsText(stepId, workspace.tenantName)} />
            <a
              className="outside-step-support"
              href={supportStepHref(stepId, status, {
                studioName: workspace.tenantName,
                tenantId: workspace.tenantId,
                page: typeof window === "undefined" ? step.home : window.location.pathname + window.location.search,
              })}
            >
              <LifeBuoy aria-hidden="true" size={13} /> Stuck? Email us
            </a>
          </div>
          {notice ? (
            <p className="form-error" role="alert">
              {notice}
            </p>
          ) : null}
          <footer>
            {step.detection === "manual" && !status.detected ? (
              status.state === "not_started" ? (
                <button
                  className="button button-dark"
                  disabled={busy}
                  onClick={() => void mark("waiting")}
                  type="button"
                >
                  {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
                  I&apos;ve applied
                </button>
              ) : status.state === "waiting" || status.state === "attention" ? (
                <>
                  <button
                    className="button button-light"
                    disabled={busy}
                    onClick={() => void mark(null)}
                    type="button"
                  >
                    I haven&apos;t applied yet
                  </button>
                  <button
                    className="button button-dark"
                    disabled={busy}
                    onClick={() => void mark("done")}
                    type="button"
                  >
                    {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
                    Intuit approved me
                  </button>
                </>
              ) : (
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={() => void mark("waiting")}
                  type="button"
                >
                  Not approved after all
                </button>
              )
            ) : step.markLabel && !status.detected ? (
              status.state === "not_started" ? (
                <button
                  className="button button-dark"
                  disabled={busy}
                  onClick={() => void mark("waiting")}
                  type="button"
                >
                  {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
                  {step.markLabel}
                </button>
              ) : (
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={() => void mark(null)}
                  type="button"
                >
                  Not set up yet
                </button>
              )
            ) : null}
            {action ?? null}
            <button className="button button-light" onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </footer>
        </div>
      </SheetDialog>
    </>
  );
}
