"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LiveRecordsState, useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectInquiryClose } from "@/components/projects/project-inquiry-close";
import { inquiryPipeline, type InquiryRow } from "@/features/inquiries/pipeline";
import { inquiryStageLabel } from "@/features/inquiries/stages";
import { waitingDays } from "@/features/ordering/attention";
import { formatEventDate } from "@/lib/format/event-date";

/**
 * Inquiries — everyone who hasn't booked, and whose move it is.
 *
 * Replaces the list of lead records. Most inquiries are a job from the moment
 * they arrive, so a list of leads showed almost nothing once they converted
 * themselves; this lists the couple wherever their record is, by the stage
 * they're at (features/inquiries/pipeline.ts).
 */


function whoseMove(row: InquiryRow): string {
  if (row.stage === "closed") return row.closedReason ?? "Closed";
  const days = waitingDays(row.waitingSince, new Date());
  const since = days === null ? "" : days === 0 ? " · today" : ` · ${days} day${days === 1 ? "" : "s"}`;
  if (row.owner === null) return "In progress";
  return row.owner === "studio" ? `Your move${since}` : `Waiting on them${since}`;
}

function stageLabel(row: InquiryRow): string {
  return row.stage === "closed" ? "Closed" : inquiryStageLabel[row.stage];
}

export function InquiryPipelineRows({ view, q }: { view: string; q: string }) {
  const projects = useTenantDocuments("projects");
  const leads = useTenantDocuments("leads");
  const conversations = useTenantDocuments("conversations");
  const loading = projects.loading || leads.loading;
  const error = projects.error ?? leads.error;
  if (loading) {
    return <LiveRecordsState kind="loading" state="Loading inquiries…" detail="Gathering everyone who hasn't booked yet." />;
  }
  if (error) {
    return <LiveRecordsState kind="error" state="Inquiries could not be loaded" detail={error} />;
  }
  const needle = q.trim().toLowerCase();
  const rows = inquiryPipeline({
    projects: projects.records ?? [],
    leads: leads.records ?? [],
    conversations: conversations.records ?? [],
  })
    .filter((row) =>
      view === "open" ? row.stage !== "closed" : row.stage === view,
    )
    .filter(
      (row) =>
        !needle ||
        row.name.toLowerCase().includes(needle) ||
        (row.email ?? "").toLowerCase().includes(needle),
    );
  if (rows.length === 0) {
    return (
      <LiveRecordsState
        kind="empty"
        state={view === "closed" ? "Nothing closed yet" : "No inquiries in this view"}
        detail={
          view === "closed"
            ? "Inquiries you close — went quiet, booked elsewhere — are kept here."
            : "New inquiries land here from your website form and your inbox."
        }
      />
    );
  }
  return (
    <>
      {rows.map((row) => (
        <article key={`${row.kind}-${row.id}`}>
          <span className="crm-primary">
            <strong>{row.name}</strong>
            <small>{whoseMove(row)}</small>
          </span>
          <span>
            <strong>{row.eventDate ? formatEventDate(row.eventDate) : "Date to confirm"}</strong>
            <small>
              {row.availability === "conflict"
                ? "Date already booked"
                : row.availability === "available"
                  ? "Date free"
                  : "Availability unknown"}
            </small>
          </span>
          <span>{row.source}</span>
          <span>
            <StatusBadge
              dot
              tone={
                row.stage === "closed"
                  ? "neutral"
                  : row.owner === "studio"
                    ? "warning"
                    : row.owner === "couple"
                      ? "info"
                      : "neutral"
              }
            >
              {stageLabel(row)}
            </StatusBadge>
          </span>
          {/* Close one that went quiet (or reopen it) without opening it:
              the same reasons sheet as the job page, "Went quiet" first. */}
          <span className="inquiry-row-actions">
            <ProjectInquiryClose
              className="inquiry-row-action"
              compact
              leadId={row.kind === "lead" ? row.id : null}
              projectId={row.kind === "job" ? row.id : null}
              state={row.state}
            />
          </span>
          <Link aria-label={`Open ${row.name}`} href={row.href}>
            <ArrowUpRight size={16} />
          </Link>
        </article>
      ))}
    </>
  );
}
