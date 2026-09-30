"use client";

import { useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, Lock } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import {
  DELIVERY_GATE_STEPS,
  deliveryGateCleared,
  postProductionRows,
  type PostProductionStepKey,
} from "@/features/post-production/checklist";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The darkroom, between the wedding and the gallery.
 *
 * `completePostProductionStep` existed and no screen called it, so the three
 * steps `recordDelivery` insists on could never be ticked and a finished
 * wedding could not be delivered. This is that screen.
 *
 * Only the rung whose dependency is satisfied is offered, because the command
 * enforces the order and a button that will be refused is worse than no button.
 * The last three rungs belong to other flows and are shown but not tickable —
 * see features/post-production/checklist.ts.
 */
export function PostProductionChecklist({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged?: () => void;
}) {
  const { records: productionRecords } = useTenantDocuments(
    "postProductionRecords",
  );
  const { records: galleryInboxes } = useTenantDocuments("galleryInboxes");
  const { records: projects } = useTenantDocuments("projects");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const production = (productionRecords ?? []).find(
    (item) => item.projectId === projectId,
  );

  /**
   * Absent until the job reaches post-production, which is when the trigger in
   * functions/src/post-event/post-production-start.ts opens the record.
   *
   * Rendering nothing left the delivery page instructing "work through
   * post-production, then record the gallery" with nothing to work through,
   * and — worse — the delivery gate's refusal names this checklist by name
   * ("Backup, editing and gallery-ready all have to be ticked on this job's
   * post-production checklist first"), so the studio was sent to a thing that
   * was not on the screen. Say why it is not here yet.
   */
  if (!production) {
    /**
     * "Opens after the event" names the wrong condition.
     *
     * The record is opened when the job reaches POST_PRODUCTION, and a job
     * that has been shot is not there yet — it gets there when the studio
     * confirms editing has started. So a studio who had marked the wedding
     * shot was told to wait for an event that was three weeks behind them,
     * with the thing that would actually open this sitting on the job page.
     */
    const state = String(
      (projects ?? []).find((item) => item.id === projectId)?.state ?? "",
    );
    // EVENT_COMPLETE is the state; "Shot" is only its label. Matching on
    // "SHOT" meant this branch never ran, and a shot wedding was still told
    // to wait for the event (walked on production, 2026-09-28).
    const shot = ["EVENT_COMPLETE", "POST_PRODUCTION"].includes(state);
    return (
      <section className="panel post-production-pending">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Post-production</p>
            <h2>{shot ? "Opens once editing starts" : "Opens after the event"}</h2>
          </div>
        </div>
        <p>
          {shot
            ? "The post-production checks appear here as soon as you confirm editing has started on this job. Anything can be released once the cards are backed up."
            : "The post-production checks appear here once the event has been covered. Anything can be released once the cards are backed up."}
        </p>
      </section>
    );
  }

  const steps = record(production.steps) as Record<
    string,
    { complete?: boolean; completedBy?: unknown } | undefined
  >;
  const rows = postProductionRows(steps);
  const inbox = (galleryInboxes ?? []).find(
    (item) => item.projectId === projectId,
  );
  const inboxNeedsSetup = inbox?.status === "configuration_required";
  const inboxAddress =
    typeof inbox?.inboundAddress === "string" ? inbox.inboundAddress : "";

  const cleared = deliveryGateCleared(steps);
  const done = rows.filter((row) => row.complete).length;

  async function complete(step: PostProductionStepKey) {
    setBusy(step);
    setNotice(null);
    try {
      await sendPostEventCommand("completePostProductionStep", {
        projectId,
        step,
        evidenceId: null,
        notes: null,
      });
      // The record is read from the shared tenant cache, so without this the
      // row stayed unticked and the count stayed put while the write had
      // already landed — the list would look broken until a reload.
      refreshTenantRecords("postProductionRecords", "galleryInboxes");
      onChanged?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That step could not be recorded."));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Untick one step ticked by mistake (Wave 2). The ladder only went forward,
   * so "Editing finished" on the wrong wedding stayed finished in the
   * couple's brief. The server audits it and refuses what may not be undone.
   */
  async function undo(step: PostProductionStepKey) {
    setBusy(step);
    setNotice(null);
    try {
      await sendPostEventCommand("undoPostProductionStep", {
        projectId,
        step,
        notes: null,
      });
      refreshTenantRecords("postProductionRecords");
      onChanged?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That step could not be unticked."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="post-production-checklist">
      <header>
        <div>
          <p className="eyebrow">After the day</p>
          <h2>Post-production</h2>
          <p>
            {cleared
              ? "The cards are backed up, so anything below can go out when it's ready. The rest here is progress, in any order."
              : "Back up the cards first — it's the one step that protects the files, and nothing is released before it."}
          </p>
        </div>
        <span className="post-production-count">
          {done}/{rows.length}
        </span>
      </header>
      {/* The gallery-ready step promises a private address for the provider's
          email, and it cannot always deliver one: without an inbound domain
          configured the inbox is created in `configuration_required` with no
          address. Saying so beats a promise the studio will wait on. */}
      {/* Until the job is filed away, not until the gallery: a film's notice
          still needs somewhere to go after the photos have gone (D10). */}
      {inboxAddress && steps.project_archived?.complete !== true ? (
        <div className="post-production-inbox">
          <p>
            <strong>Skip the typing.</strong>{" "}Forward your gallery or video
            host&rsquo;s &ldquo;ready&rdquo; email here, or copy this address in when they email
            the couple. StudioCue reads the link and prepares the release; a photo
            gallery marks editing and gallery-ready for you.
          </p>
          <span>
            <code>{inboxAddress}</code>
            <button
              className="button button-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(inboxAddress).then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </div>
      ) : null}
      {inboxNeedsSetup ? (
        <p className="post-production-inbox-warning" role="status">
          The gallery inbox has no address yet — inbound email is not configured
          for this workspace, so your provider&rsquo;s notification will not file
          itself. Everything else here still works.
        </p>
      ) : null}
      <ol>
        {rows.map((row) => (
          <li
            className={
              row.complete
                ? "is-complete"
                : row.actionable
                  ? "is-next"
                  : "is-waiting"
            }
            key={row.key}
          >
            <span className="post-production-mark">
              {row.complete ? (
                <CheckCircle2 aria-hidden="true" size={17} />
              ) : row.actionable ? (
                <Circle aria-hidden="true" size={17} />
              ) : (
                <Lock aria-hidden="true" size={15} />
              )}
            </span>
            <span className="post-production-copy">
              <strong>{row.label}</strong>
              {/* Which of the nine actually stop a release: the backup, and
                  only that (Q23). The rest is progress. */}
              {DELIVERY_GATE_STEPS.includes(row.key) ? (
                <span className="post-production-gates">
                  Required for release
                </span>
              ) : null}
              <small>
                {row.fromGalleryEmail
                  ? "Marked from your gallery provider's email."
                  : row.detail}
              </small>
              {/* Whose step it is, when it is not the studio's. Saying it
                  outright is what stops "why can I not tick this?". */}
              {!row.complete && !row.actionable ? (
                <em>
                  {row.waitingOn
                    ? `Waiting on: ${row.waitingOn}`
                    : `Set by: ${row.owner}`}
                </em>
              ) : null}
            </span>
            {row.actionable ? (
              <button
                className="button"
                disabled={busy !== null}
                onClick={() => void complete(row.key)}
                type="button"
              >
                {busy === row.key ? (
                  <LoaderCircle className="spin" size={14} />
                ) : null}
                Mark done
              </button>
            ) : row.undoable ? (
              <button
                className="button button-quiet button-sm"
                disabled={busy !== null}
                onClick={() => void undo(row.key)}
                title="Ticked by mistake? Untick it. Recorded in the audit log."
                type="button"
              >
                {busy === row.key ? (
                  <LoaderCircle className="spin" size={14} />
                ) : null}
                Untick
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
