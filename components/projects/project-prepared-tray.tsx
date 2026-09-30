"use client";

import { Check, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AiQueueCard,
  AutomationApprovalCard,
} from "@/components/ai/ai-approval-queue";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import {
  PreparedCompactRow as CompactRow,
  type PreparedItem,
} from "@/components/ai/prepared-compact-row";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  groupPrepared,
  staleReason,
  type PreparedGroup,
} from "@/features/ai/prepared-groups";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { InfoHint } from "@/components/ui/info-hint";
import { ConfirmStep } from "@/components/ui/confirm-step";

type RecordValue = Record<string, unknown> & { id: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * How many decisions show before "Show all". Enough to act on today; the
 * rest is one click away rather than a scroll past every one.
 */
const PREVIEW = 5;

type TrayItem = PreparedItem;

/**
 * The job's prepared decisions: one compact row per decision, each opening
 * its full card in a sheet.
 *
 * It rendered every pending draft as a full card — preview, "why", five
 * buttons — so a job with 21 pending was an endless scroll, and 15 of those 21
 * were versions of the same retainer reminder, on a job whose retainer was
 * already paid (docs/ui-audit-2026-09-27.md). Now versions of one decision
 * fold into one row (features/ai/prepared-groups.ts), out-of-date ones say
 * so, and the older versions can be dismissed together.
 */
export function ProjectPreparedTray({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const aiState = useTenantDocuments("aiActions");
  const automationState = useTenantDocuments("automationApprovals", {
    enabled: privileged,
  });
  const { records: projects } = useTenantDocuments("projects");
  const projectState = text(
    (projects ?? []).find((project) => project.id === projectId)?.state,
  );
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  /**
   * Which bulk dismiss is waiting on its confirm step ("stale", or a group's
   * key). "Dismiss them" put several drafts away on one tap, for good — a
   * dismissed draft can't be restored (wave 3).
   */
  const [confirmingClear, setConfirmingClear] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = useMemo<TrayItem[]>(
    () => [
      ...(aiState.records ?? [])
        .filter(
          (item) =>
            text(item.projectId) === projectId &&
            ["review_required", "queued", "running"].includes(
              decisions[item.id] ?? text(item.status),
            ),
        )
        .map((record) => ({ kind: "ai" as const, record: record as RecordValue })),
      ...(automationState.records ?? [])
        .filter(
          (item) =>
            text(item.projectId) === projectId &&
            (decisions[item.id] ?? text(item.status)) === "pending",
        )
        .map((record) => ({ kind: "automation" as const, record: record as RecordValue })),
    ],
    [aiState.records, automationState.records, decisions, projectId],
  );
  const groups = useMemo(() => groupPrepared(items), [items]);
  const staleOf = (group: PreparedGroup<TrayItem>) =>
    staleReason(group.topic, projectState);
  // Out-of-date drafts go last: what is still worth deciding comes first.
  const ordered = [...groups].sort(
    (a, b) => Number(Boolean(staleOf(a))) - Number(Boolean(staleOf(b))),
  );
  const staleDrafts = groups
    .filter((group) => staleOf(group))
    .flatMap((group) => group.entries.filter((entry) => entry.kind === "ai"));
  const staleReasons = [...new Set(groups.map(staleOf).filter(Boolean))];
  const visible = showAll ? ordered : ordered.slice(0, PREVIEW);
  const reviewing = groups.find((group) => group.key === reviewingKey) ?? null;

  const onDecision = (id: string, status: string) => {
    setDecisions((current) => ({ ...current, [id]: status }));
    // Once the lead is decided the sheet has done its job; the older versions,
    // if any, are still in the list as their own row.
    setReviewingKey(null);
  };

  /** Dismiss several drafts at once: the older versions, or the stale ones. */
  async function dismissAll(entries: TrayItem[], label: string) {
    const drafts = entries.filter((entry) => entry.kind === "ai");
    if (!drafts.length) return;
    setClearing(label);
    setNotice(null);
    let done = 0;
    try {
      for (const entry of drafts) {
        await runAiQueueCommand({
          type: "decideAiAction",
          input: { actionId: entry.record.id, decision: "dismissed" },
        });
        done += 1;
        setDecisions((current) => ({ ...current, [entry.record.id]: "dismissed" }));
      }
      setNotice(`Dismissed ${done} ${done === 1 ? "draft" : "drafts"}. Nothing was sent.`);
    } catch (caught: unknown) {
      setNotice(
        `${done ? `Dismissed ${done}, then ` : ""}${friendlyError(caught, "the rest could not be dismissed.")}`,
      );
    } finally {
      setClearing(null);
    }
  }

  const count = groups.length;
  const drafts = items.length;

  return (
    <section className="project-prepared-tray" id="prepared">
      <header>
        <span><Sparkles size={18} /></span>
        <div>
          <p className="eyebrow">
            Prepared for you <InfoHint term="prepared" />
          </p>
          <h2>{count ? `${count} ${count === 1 ? "decision" : "decisions"} ready` : "Nothing needs approval"}</h2>
          <p>
            {drafts > count
              ? `${drafts} drafts, grouped where they're versions of the same thing. Open one to review it.`
              : "StudioCue prepares the work here. You retain every consequential decision."}
          </p>
        </div>
      </header>
      {staleDrafts.length ? (
        <div className="prepared-stale-banner" role="status">
          <TriangleAlert aria-hidden="true" size={16} />
          <span>
            <strong>
              {`${staleDrafts.length} ${staleDrafts.length === 1 ? "draft is" : "drafts are"} out of date.`}
            </strong>{" "}
            {staleReasons.join(" ")}
          </span>
          {confirmingClear === "stale" ? null : (
            <button
              className="button button-light"
              disabled={clearing !== null}
              onClick={() => setConfirmingClear("stale")}
              type="button"
            >
              Dismiss them
            </button>
          )}
        </div>
      ) : null}
      {staleDrafts.length && confirmingClear === "stale" ? (
        <ConfirmStep
          busy={clearing === "stale"}
          cancelLabel="Keep them"
          confirmLabel={`Dismiss ${staleDrafts.length === 1 ? "it" : `all ${staleDrafts.length}`}`}
          label="Dismiss the out-of-date drafts?"
          onCancel={() => setConfirmingClear(null)}
          onConfirm={() => void dismissAll(staleDrafts, "stale").then(() => setConfirmingClear(null))}
        >
          {`${staleDrafts.length === 1 ? "The draft is" : `All ${staleDrafts.length} drafts are`} put away for good — nothing is sent, and they can't be brought back. StudioCue prepares a new one if it's needed again.`}
        </ConfirmStep>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {count ? (
        <div className="project-prepared-compact">
          {visible.map((group) => (
            <CompactRow
              item={group.lead}
              key={group.key}
              onOpen={() => setReviewingKey(group.key)}
              stale={staleOf(group)}
              versions={group.entries.length}
            />
          ))}
          {ordered.length > PREVIEW ? (
            <button
              type="button"
              className="prepared-compact-more"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Show fewer" : `Show all ${ordered.length}`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="project-prepared-empty">
          <Check size={17} />
          <span>
            <strong>You are caught up.</strong>
            <small>New drafts and workflow decisions for this project will appear here.</small>
          </span>
        </div>
      )}
      <SheetDialog
        label="Review prepared decision"
        onClose={() => {
          setReviewingKey(null);
          setConfirmingClear(null);
        }}
        open={reviewing != null}
      >
        {reviewing ? (
          <div className="prepared-review">
            {staleOf(reviewing) || reviewing.entries.length > 1 ? (
              <div
                className={
                  staleOf(reviewing) ? "prepared-review-note is-stale" : "prepared-review-note"
                }
              >
                <span>
                  {staleOf(reviewing) ? (
                    <strong>Out of date. {staleOf(reviewing)}</strong>
                  ) : null}
                  {reviewing.entries.length > 1
                    ? ` This is the newest of ${reviewing.entries.length} versions.`
                    : ""}
                </span>
                {confirmingClear === reviewing.key ? (
                  // Out of date: the whole group goes. Otherwise only the
                  // older versions do, and the newest stays to decide.
                  <ConfirmStep
                    busy={clearing === reviewing.key}
                    cancelLabel="Keep them"
                    confirmLabel={
                      staleOf(reviewing)
                        ? `Dismiss ${reviewing.entries.length > 1 ? `all ${reviewing.entries.length}` : "it"}`
                        : `Dismiss the ${reviewing.entries.length - 1} older`
                    }
                    label="Dismiss these drafts?"
                    onCancel={() => setConfirmingClear(null)}
                    onConfirm={() =>
                      void (
                        staleOf(reviewing)
                          ? dismissAll(reviewing.entries, reviewing.key).then(() => setReviewingKey(null))
                          : dismissAll(reviewing.entries.slice(1), reviewing.key)
                      ).then(() => setConfirmingClear(null))
                    }
                  >
                    Dismissed drafts are put away for good — nothing is sent, and they can&rsquo;t be brought back.
                  </ConfirmStep>
                ) : staleOf(reviewing) ? (
                  <button
                    className="button button-dark"
                    disabled={clearing !== null}
                    onClick={() => setConfirmingClear(reviewing.key)}
                    type="button"
                  >
                    {`Dismiss ${reviewing.entries.length > 1 ? `all ${reviewing.entries.length}` : "it"}`}
                  </button>
                ) : reviewing.entries.some((entry, index) => index > 0 && entry.kind === "ai") ? (
                  <button
                    className="button button-light"
                    disabled={clearing !== null}
                    onClick={() => setConfirmingClear(reviewing.key)}
                    type="button"
                  >
                    {`Dismiss the ${reviewing.entries.length - 1} older`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {reviewing.lead.kind === "ai" ? (
              <AiQueueCard action={reviewing.lead.record} onDecision={onDecision} />
            ) : (
              <AutomationApprovalCard
                approval={reviewing.lead.record}
                onDecision={onDecision}
              />
            )}
          </div>
        ) : (
          <span />
        )}
      </SheetDialog>
    </section>
  );
}
