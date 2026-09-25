"use client";

import { useState } from "react";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { runCrmCommand } from "@/lib/crm/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Reviewing an inquiry StudioCue read from the studio's inbox.
 *
 * A captured lead is filled by rules (the form's labels) and then a model (the
 * couple's sentences). The studio is the authority on both: every fact can be
 * corrected in place, and a fact the model inferred says so beside it, so the
 * studio can tell "they typed this in a field" from "we read it in their
 * message". Corrections go through `updateLead`, which marks them as the
 * studio's own.
 *
 * Deliberately free of tenant-records imports — that module renders this.
 */

type Lead = Record<string, unknown> & { id: string };

type Provenance = Record<string, { source?: string } | undefined>;

const PROVENANCE_KEY: Record<string, string> = {
  estimatedGuestCount: "guestCount",
  budgetRange: "budget",
  servicesRequested: "services",
};

/** "From their message" beside a value the model read out of prose. */
export function InferredTag({ lead, field }: { lead: Lead; field: string }) {
  const provenance = (lead.fieldProvenance ?? {}) as Provenance;
  const source = provenance[PROVENANCE_KEY[field] ?? field]?.source;
  if (source !== "message") return null;
  return (
    <small className="lead-inferred" title="Read from their message, not a form field. Check it.">
      from their message
    </small>
  );
}

/** Where a captured inquiry came from, in the studio's words. */
export function leadSourceLabel(lead: Lead): string {
  const builder = typeof lead.formBuilderLabel === "string" ? lead.formBuilderLabel : "";
  const source = String(lead.source ?? "");
  if (source.startsWith("marketplace_") && builder) return builder;
  // The builder's label already names the thing: "Wix form", "Jotform".
  if (source === "website_form") return builder || "Website form";
  if (source === "forwarded_email") return "Forwarded email";
  return String(lead.referralSource ?? "Direct");
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

type Draft = {
  firstName: string;
  lastName: string;
  partnerName: string;
  email: string;
  phone: string;
  eventDate: string;
  venue: string;
  city: string;
  ceremonyTime: string;
  estimatedGuestCount: string;
  budgetRange: string;
  referralSource: string;
};

function draftFrom(lead: Lead): Draft {
  return {
    firstName: text(lead.firstName),
    lastName: text(lead.lastName),
    partnerName: text(lead.partnerName),
    email: text(lead.email),
    phone: text(lead.phone),
    eventDate: text(lead.eventDate),
    venue: text(lead.venue),
    city: text(lead.city),
    ceremonyTime: text(lead.ceremonyTime),
    estimatedGuestCount:
      typeof lead.estimatedGuestCount === "number" ? String(lead.estimatedGuestCount) : "",
    budgetRange: text(lead.budgetRange),
    referralSource: text(lead.referralSource),
  };
}

const FIELDS: Array<{ key: keyof Draft; label: string; type?: string; wide?: boolean }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "partnerName", label: "Partner" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "eventDate", label: "Date", type: "date" },
  { key: "venue", label: "Venue" },
  { key: "city", label: "City or town" },
  { key: "ceremonyTime", label: "Ceremony time" },
  { key: "estimatedGuestCount", label: "Guests", type: "number" },
  { key: "budgetRange", label: "Budget" },
  { key: "referralSource", label: "How they found you" },
];

/** Only what changed is sent, so untouched facts keep their provenance. */
function changesBetween(before: Draft, after: Draft): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const { key } of FIELDS) {
    if (before[key] === after[key]) continue;
    const value = after[key].trim();
    if (key === "estimatedGuestCount") {
      const count = Number.parseInt(value, 10);
      changes[key] = Number.isFinite(count) && count > 0 ? count : null;
    } else {
      changes[key] = value || null;
    }
  }
  return changes;
}

/** "Edit details" — the captured facts, correctable in place. */
export function LeadDetailsEditor({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(lead));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="button button-light"
        onClick={() => {
          setDraft(draftFrom(lead));
          setNotice(null);
          setOpen(true);
        }}
        type="button"
      >
        <Pencil /> Edit details
      </button>
    );
  }

  async function save() {
    const changes = changesBetween(draftFrom(lead), draft);
    if (!Object.keys(changes).length) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("updateLead", { leadId: lead.id, ...changes });
      if (!response.persisted) {
        setNotice("Preview: these corrections would be saved to the inquiry.");
        return;
      }
      setOpen(false);
      onSaved();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "We couldn't save those details. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="panel lead-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="panel-heading">
        <div>
          <h2>Edit details</h2>
          <p>Your corrections replace what was read from the email.</p>
        </div>
      </div>
      <div className="lead-edit-grid">
        {FIELDS.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              inputMode={field.type === "number" ? "numeric" : undefined}
              min={field.type === "number" ? 1 : undefined}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              type={field.type ?? "text"}
              value={draft[field.key]}
            />
          </label>
        ))}
      </div>
      <div className="lead-action-row">
        <button className="button button-dark" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" /> : <Check />}{" "}Save
        </button>
        <button className="button button-light" disabled={busy} onClick={() => setOpen(false)} type="button">
          <X /> Cancel
        </button>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}

/**
 * "Is this an inquiry?" — for a capture the reader wasn't sure about.
 *
 * Yes keeps it and remembers the form's sender; No files it away and stops
 * capturing that sender. Either answer teaches capture, so the same question
 * is not asked twice about the same form.
 */
export function MaybeInquiryPrompt({
  lead,
  onAnswered,
  compact = false,
}: {
  lead: Lead;
  onAnswered: (answer: "inquiry" | "not_inquiry") => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"inquiry" | "not_inquiry" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function answer(choice: "inquiry" | "not_inquiry") {
    setBusy(choice);
    setNotice(null);
    try {
      const response =
        choice === "inquiry"
          ? await runCrmCommand("updateLead", { leadId: lead.id, confirmInquiry: true })
          : await runCrmCommand("markLeadNotInquiry", { leadId: lead.id });
      if (!response.persisted) {
        setNotice("Preview: your answer would be saved.");
        return;
      }
      onAnswered(choice);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "We couldn't save that. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "maybe-inquiry maybe-inquiry-compact" : "maybe-inquiry"}>
      {compact ? null : (
        <span>
          <strong>Is this an inquiry?</strong>
          <small>
            We weren&apos;t sure, so it isn&apos;t on Today yet. Your answer teaches
            StudioCue about this sender.
          </small>
        </span>
      )}
      <div className="lead-action-row">
        <button className="button button-dark button-sm" disabled={busy !== null} onClick={() => void answer("inquiry")} type="button">
          {busy === "inquiry" ? <LoaderCircle className="spin" /> : <Check />}{" "}Yes, an inquiry
        </button>
        <button className="button button-light button-sm" disabled={busy !== null} onClick={() => void answer("not_inquiry")} type="button">
          {busy === "not_inquiry" ? <LoaderCircle className="spin" /> : <X />}{" "}Not an inquiry
        </button>
      </div>
      {notice ? <small className="form-notice" role="status">{notice}</small> : null}
    </div>
  );
}
