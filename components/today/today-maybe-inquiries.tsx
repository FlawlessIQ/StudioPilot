"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MaybeInquiryPrompt } from "@/components/leads/lead-capture-review";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import type { TodayMaybeInquiry } from "@/features/today/inbox";

/** Enough to clear a morning's worth; the rest wait on the Leads page. */
const SHOWN = 3;

/**
 * "Maybe an inquiry", answered from Today.
 *
 * These used to wait in a tray on the Leads page, which has no nav entry —
 * so a real couple the reader wasn't sure about could sit unanswered until
 * someone happened to look. They are still kept out of the queue (not
 * counted, never the headline, never above a couple), but asked about here,
 * one compact row each: Yes turns it into an inquiry card above, No files it
 * away and stops capturing that sender.
 *
 * `form` is the same prompt for website-form and marketplace submissions,
 * which Today places near the top: by content they are inquiries, and only
 * the forwarder couldn't be confirmed. Beneath a long queue, a studio that
 * had just forwarded one could not find it (backlog H8).
 */
export function TodayMaybeInquiries({
  items,
  onAnswered,
  variant = "other",
}: {
  items: TodayMaybeInquiry[];
  onAnswered: (leadId: string) => void;
  variant?: "form" | "other";
}) {
  if (!items.length) return null;
  const shown = items.slice(0, SHOWN);
  const more = items.length - shown.length;
  const form = variant === "form";
  const heading = form
    ? items.length === 1
      ? "New inquiry? Confirm it"
      : "New inquiries? Confirm them"
    : "Maybe an inquiry";
  return (
    <section className={form ? "today-maybe is-form" : "today-maybe"} aria-label={heading}>
      <div className="today-lane-heading">
        <h2>{heading}</h2>
        <span>{items.length}</span>
      </div>
      <p className="today-maybe-intro">
        {form
          ? items.length === 1
            ? "This came through an inquiry form, but StudioCue couldn't confirm who sent it on. Yes makes it a job."
            : "These came through an inquiry form, but StudioCue couldn't confirm who sent them on. Yes makes each one a job."
          : items.length === 1
            ? "One email we weren't sure about. Your answer teaches StudioCue about the sender."
            : "Emails we weren't sure about. Your answer teaches StudioCue about each sender."}
      </p>
      <ul>
        {shown.map((item) => (
          <li key={item.leadId}>
            <Link className="today-maybe-what" href={item.href}>
              <strong>{item.sender}</strong>
              <small>
                {[item.evidence, item.snippet || "No message"].join(" · ")}
              </small>
            </Link>
            <MaybeInquiryPrompt
              compact
              leadId={item.leadId}
              sender={item.ignorableSender}
              onAnswered={() => {
                onAnswered(item.leadId);
                refreshTenantRecords("leads", "projects", "conversations", "contacts");
              }}
            />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <Link className="today-maybe-more" href="/studio/leads">
          {more} more on the Leads page <ArrowRight size={13} />
        </Link>
      ) : null}
    </section>
  );
}
