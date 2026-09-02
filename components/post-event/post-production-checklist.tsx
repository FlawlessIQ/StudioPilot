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
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const production = (productionRecords ?? []).find(
    (item) => item.projectId === projectId,
  );

  // Absent until the job reaches post-production, which is when the trigger in
  // functions/src/post-event/post-production-start.ts opens the record.
  if (!production) return null;

  const steps = record(production.steps) as Record<
    string,
    { complete?: boolean } | undefined
  >;
  const rows = postProductionRows(steps);
  const inbox = (galleryInboxes ?? []).find(
    (item) => item.projectId === projectId,
  );
  const inboxNeedsSetup =
    steps.gallery_ready?.complete === true &&
    inbox?.status === "configuration_required";
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

  return (
    <section className="post-production-checklist">
      <header>
        <div>
          <p className="eyebrow">After the day</p>
          <h2>Post-production</h2>
          <p>
            {cleared
              ? "Backup, editing and the gallery are done — the delivery below can go out."
              : "The gallery cannot be released until the cards are backed up, the editing is finished and the gallery is ready."}
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
              {/* Which of the nine actually stop a release. Three do, and the
                  header said so in prose while the rows themselves gave no
                  clue — so ticking "Cull finished" or "Editing started" felt
                  like progress towards a gate it has no bearing on. */}
              {DELIVERY_GATE_STEPS.includes(row.key) ? (
                <span className="post-production-gates">
                  Required for release
                </span>
              ) : null}
              <small>{row.detail}</small>
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
