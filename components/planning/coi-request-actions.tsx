"use client";

import { useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Send, Upload, XCircle } from "lucide-react";
import { FileLinks } from "@/components/documents/file-link";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { AddressField } from "@/components/forms/address-field";
import type { CapturedPlace } from "@/features/places/schema";
import { useWorkspace } from "@/features/auth/workspace-context";
import { FILE_BEARING } from "@/features/documents/file-ref";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { uploadCoiPdf } from "@/lib/planning/coi-upload";
import { friendlyError } from "@/lib/ai/friendly-error";
import { formatEventDate } from "@/lib/format/event-date";
import { ActionHint } from "@/components/ui/info-hint";

type Row = Record<string, unknown> & { id: string };
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * What the studio does with a certificate at each point (H3,
 * docs/coi-automation-plan-2026-09-28.md): approve the prepared request, give
 * it the venue details it lacked, make it in the insurer's portal and drop the
 * PDF here, or — when it's back — approve and send it to the venue in one
 * command. The request card on /studio/insurance, and the target of every
 * Today COI card.
 */
export function CoiRequestActions({
  request,
  requirement,
  settings,
}: {
  request: Row;
  requirement: Row | undefined;
  settings: Row | undefined;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [venueEmail, setVenueEmail] = useState("");
  const [legalName, setLegalName] = useState(text(requirement?.venueLegalName) || text(request.venueName));
  const [address, setAddress] = useState<CapturedPlace | null>(null);
  const status = text(request.status);
  const projectId = text(request.projectId);
  const files = FILE_BEARING.insuranceRequests(request);

  async function run(type: string, input: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand(type, { projectId, requestId: request.id, ...input });
      setNotice(outcome.persisted ? success : "Development preview — nothing was sent.");
      // This card listens live; the list above it reads the shared store,
      // which kept saying "under review" after a request was sent back.
      if (outcome.persisted) refreshTenantRecords("insuranceRequests", "projects", "checkpoints");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const copy = (value: string) => void navigator.clipboard?.writeText(value);
  const holder = text(requirement?.certificateHolder) || text(requirement?.venueLegalName);
  const venueAddress = text(requirement?.venueAddress);
  const eventDate = text(requirement?.eventDate);

  let body: React.ReactNode;
  if (status === "prepared") {
    body = (
      <>
        <p className="coi-status-note">
          {`StudioCue prepared this request to ${text(request.requestEmail) || text(settings?.agentEmail) || "your agent"}${
            text(request.dueDate) ? `, due ${formatEventDate(text(request.dueDate))}` : ""
          }. Nothing has been sent.${request.fromVenueMemory ? " The venue's details are from the last certificate you sent them." : ""}`}
        </p>
        <button className="button button-dark" disabled={busy} onClick={() => void run("approvePreparedCoi", {}, "Sent to your agent. StudioCue chases it until it's back.")} type="button">
          <Send /> Send to your agent
        </button>
      </>
    );
  } else if (status === "needs_details") {
    body = (
      <form
        className="coi-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            "completeCoiDetails",
            {
              venueLegalName: legalName,
              venueAddress: address?.formatted ?? "",
              submissionEmail: venueEmail || null,
            },
            "Details saved — the request carries on.",
          );
        }}
      >
        <p className="coi-status-note">The request is ready except for the venue&rsquo;s details.</p>
        <label>
          Venue&rsquo;s legal name
          <input onChange={(event) => setLegalName(event.target.value)} required value={legalName} />
        </label>
        <AddressField label="Venue address" name="venueAddress" onChange={setAddress} placeholder="Venue street address" required value={address} />
        <label>
          Venue&rsquo;s email for the certificate <span className="coi-optional">optional</span>
          <input onChange={(event) => setVenueEmail(event.target.value)} type="email" value={venueEmail} />
        </label>
        <button className="button button-dark" disabled={busy} type="submit">
          <CheckCircle2 /> Save and continue
        </button>
      </form>
    );
  } else if (status === "self_serve" || (status === "failed" && text(settings?.source) === "self_serve")) {
    body = (
      <div className="coi-inline-form">
        <p className="coi-status-note">
          Make the certificate in your insurer&rsquo;s portal with these details, then drop the PDF here. StudioCue checks
          it before it goes anywhere.
        </p>
        <ul className="coi-copy-list">
          {(
            [
              ["Certificate holder", holder],
              ["Venue address", venueAddress],
              ["Event date", eventDate ? formatEventDate(eventDate) : ""],
              ["Additional insured", text(requirement?.additionalInsuredWording)],
            ] as const
          )
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <li key={label}>
                <span>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </span>
                <button aria-label={`Copy ${label}`} className="button button-quiet button-sm" onClick={() => copy(value)} type="button">
                  <Copy aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
        </ul>
        {text(settings?.portalUrl) ? (
          <a className="button button-light" href={text(settings?.portalUrl)} rel="noopener noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={15} /> Open your insurer&rsquo;s portal
          </a>
        ) : null}
        <label className="button button-dark coi-upload">
          <Upload aria-hidden="true" size={15} /> {busy ? "Uploading…" : "Upload the certificate (PDF)"}
          <input
            accept="application/pdf"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file || !workspace.tenantId) return;
              setBusy(true);
              setNotice(null);
              void uploadCoiPdf({ tenantId: workspace.tenantId, projectId, requestId: request.id, file })
                .then((uploaded) =>
                  sendPlanningCommand("attachCoiUpload", { projectId, requestId: request.id, ...uploaded }),
                )
                .then(() => setNotice("Uploaded. It's being checked — you'll approve it in a minute."))
                .catch((caught: unknown) => setNotice(friendlyError(caught, "That upload didn't work.")))
                .finally(() => setBusy(false));
            }}
            type="file"
          />
        </label>
      </div>
    );
  } else if (status === "under_review" || status === "approved") {
    const needsVenueEmail = !text(requirement?.submissionEmail);
    body = (
      <div className="coi-inline-form">
        <FileLinks files={files} />
        {needsVenueEmail ? (
          <label>
            Venue&rsquo;s email for the certificate
            <input onChange={(event) => setVenueEmail(event.target.value)} required type="email" value={venueEmail} />
          </label>
        ) : (
          <p className="coi-status-note">It goes to {text(requirement?.submissionEmail)}.</p>
        )}
        <label>
          Why you&rsquo;re approving it, or what needs correcting
          <textarea
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Holder, address and limits match the venue contract."
            value={reason}
          />
        </label>
        <footer>
          <ActionHint hint="Emails the venue the certificate PDF with the event date. Your note is saved as the reason, and their reply is recorded here.">
            <button
              className="button button-dark"
              disabled={busy || reason.trim().length < 5 || (needsVenueEmail && !venueEmail)}
              onClick={() =>
                void run(
                  "approveAndSendCoi",
                  { reason, submissionEmail: venueEmail || null },
                  "Approved and sent to the venue. Their reply is recorded when it comes.",
                )
              }
              type="button"
            >
              <Send /> Approve &amp; send to venue
            </button>
          </ActionHint>
          {status === "under_review" ? (
            <button
              className="button button-danger"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void run("decideCoi", { decision: "rejected", reason }, "Sent back to your agent with your note.")}
              type="button"
            >
              <XCircle /> Ask agent to correct
            </button>
          ) : null}
        </footer>
      </div>
    );
  } else if (status === "failed") {
    body = (
      <div className="coi-inline-form">
        <p className="coi-status-note">
          The PDF that came back didn&rsquo;t pass the safety check, so StudioCue won&rsquo;t open or send it. Ask your
          agent to send it again — their reply comes straight back here.
        </p>
        <label>
          Note for your agent
          <textarea
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. The file didn't come through — could you send the certificate again as a PDF?"
            value={reason}
          />
        </label>
        <footer>
          <button
            className="button button-dark"
            disabled={busy || reason.trim().length < 5}
            onClick={() => void run("decideCoi", { decision: "rejected", reason }, "Asked your agent to send it again.")}
            type="button"
          >
            <Send /> Ask agent to resend
          </button>
        </footer>
      </div>
    );
  } else {
    body = (
      <>
        {files.length ? <FileLinks files={files} /> : null}
        <p className="coi-status-note">
          {status === "requested"
            ? request.escalatedAt
              ? `Your agent hasn't replied after ${Number(request.chaseCount ?? 0)} follow-ups — StudioCue stopped chasing.${text(settings?.agentPhone) ? ` Call ${text(settings?.agentPhone)}.` : ""}`
              : `With your agent${Number(request.chaseCount ?? 0) ? ` · followed up ${Number(request.chaseCount)} time${Number(request.chaseCount) === 1 ? "" : "s"}` : ""}. Their reply with the PDF comes straight back here.`
            : status === "correction_required"
              ? "Sent back to your agent for a correction. StudioCue follows up until it's back."
              : status === "venue_acknowledged"
                ? "The venue confirmed they have it."
                : status === "sent_to_venue"
                  ? "Sent to the venue. Their reply is recorded when it comes."
                  : status === "received"
                    ? "Arrived — being checked. It'll be ready to approve shortly."
                    : "StudioCue is waiting for the next step."}
        </p>
      </>
    );
  }

  return (
    <>
      {body}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
