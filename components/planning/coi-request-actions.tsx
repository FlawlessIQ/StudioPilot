"use client";

import { useEffect, useState } from "react";
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
import { formatDueDate, formatEventDate } from "@/lib/format/event-date";
import { ActionHint } from "@/components/ui/info-hint";
import { certificateKitFields, insurerLink } from "@/features/insurance/certificate-kit";
import { tradeVocab } from "@/features/trades/trades";

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
  // A re-send of the certificate the venue already took needs no new
  // judgment: the reason is written, and approving is one click.
  const [reason, setReason] = useState(
    request.reusedFromRequestId ? "Same certificate the venue already has; the policy still covers this date." : "",
  );
  const [venueEmail, setVenueEmail] = useState("");
  const [legalName, setLegalName] = useState(text(requirement?.venueLegalName) || text(request.venueName));
  const [address, setAddress] = useState<CapturedPlace | null>(null);
  const status = text(request.status);
  const projectId = text(request.projectId);
  const files = FILE_BEARING.insuranceRequests(request);
  // The job's own address for the certificate (coi/reuse.ts). A request made
  // before requests carried one gets it the first time its kit is opened.
  const [inboxAddress, setInboxAddress] = useState(text(request.inboxAddress));
  const wantsInbox = status === "self_serve" && !text(request.inboxAddress) && !text(request.requestEmail);
  useEffect(() => {
    if (!wantsInbox) return;
    let active = true;
    void sendPlanningCommand("ensureCoiInbox", { projectId, requestId: request.id })
      .then((outcome) => {
        const address = text((outcome as { result?: { inboxAddress?: unknown } }).result?.inboxAddress);
        if (active && address) setInboxAddress(address);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId, request.id, wantsInbox]);

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
  // Convenience only: approveAndSendCoi and decideCoi refuse anyone else, and
  // a coordinator was shown buttons that could only fail.
  const ownerOrAdmin = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  // Made in the insurer's portal: no agent to ask (coi/actions.ts
  // selfServeCorrection reads the same field).
  const selfServe = !text(request.requestEmail);

  // The certificate from the insurer's portal, dropped here. Offered wherever
  // the server takes an upload (coi/actions.ts attachCoiUpload), not only on
  // the self-serve card: a corrected PDF is the usual answer to a correction.
  const uploadButton = (label: string) => (
    <label className="button button-dark coi-upload">
      <Upload aria-hidden="true" size={15} /> {busy ? "Uploading…" : label}
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
  );
  const upload = uploadButton("Upload the certificate (PDF)");
  const holder = text(requirement?.certificateHolder) || text(requirement?.venueLegalName);
  const venueAddress = text(requirement?.venueAddress);
  const eventDate = text(requirement?.eventDate);

  let body: React.ReactNode;
  if (status === "prepared") {
    body = (
      <>
        <p className="coi-status-note">
          {`Cue prepared this request to ${text(request.requestEmail) || text(settings?.agentEmail) || "your agent"}${
            text(request.dueDate) ? `, due ${formatEventDate(text(request.dueDate))}` : ""
          }. Nothing has been sent.${request.fromVenueMemory ? " The venue's details are from the last certificate you sent them." : ""}`}
        </p>
        <button className="button button-dark" disabled={busy} onClick={() => void run("approvePreparedCoi", {}, "Sent to your agent. StudioCue follows up until it's back.")} type="button">
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
  } else if (status === "self_serve" || (status === "failed" && (selfServe || text(settings?.source) === "self_serve"))) {
    const insurer = insurerLink(settings);
    const kit = certificateKitFields({
      holder,
      venueAddress,
      venueName: text(requirement?.venueLegalName) || text(request.venueName),
      // With the year: it goes on a legal document.
      eventDateLabel: eventDate ? formatDueDate(eventDate) : "",
      service: tradeVocab(workspace.tenantTrade).service,
      additionalInsuredWording: text(requirement?.additionalInsuredWording),
    });
    body = (
      <div className="coi-inline-form">
        {/* Two minutes, not fifteen: the details in the order a certificate
            form asks for them, the insurer's page, and an address the
            certificate can be emailed straight to (self-serve kit,
            2026-10-14). */}
        <p className="coi-status-note">
          {`Make it on ${insurer.label === "your insurer" ? "your insurer\u2019s website" : `${insurer.label}\u2019s website`} with these details${
            text(request.dueDate) ? `, by ${formatEventDate(text(request.dueDate))}` : ""
          }. StudioCue checks it before anything goes to the venue.`}
        </p>
        <ol className="coi-kit-steps">
          <li>
            <span>
              <strong>1. Open {insurer.label === "your insurer" ? "your insurer\u2019s website" : insurer.label}</strong>
              {insurer.label === "NEXT" ? <small>Certificate → Create Custom Certificate</small> : null}
            </span>
            {insurer.url ? (
              <a className="button button-light button-sm" href={insurer.url} rel="noopener noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={14} /> Open {insurer.label === "your insurer" ? "it" : insurer.label}
              </a>
            ) : null}
          </li>
        </ol>
        <p className="coi-kit-label"><strong>2. Copy in these details</strong></p>
        <ul className="coi-copy-list">
          {kit.map(({ label, value }) => (
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
        <p className="coi-kit-label"><strong>3. Get the certificate to StudioCue</strong></p>
        {inboxAddress ? (
          <ul className="coi-copy-list">
            <li>
              <span>
                <small>Email it here — in the insurer&rsquo;s &ldquo;send to&rdquo; box, or forward their email</small>
                <strong className="coi-kit-address">{inboxAddress}</strong>
              </span>
              <button aria-label="Copy the address" className="button button-quiet button-sm" onClick={() => copy(inboxAddress)} type="button">
                <Copy aria-hidden="true" size={14} />
              </button>
            </li>
          </ul>
        ) : null}
        <div className="coi-kit-upload">
          {inboxAddress ? <small>Or upload the PDF</small> : null}
          {upload}
        </div>
      </div>
    );
  } else if ((status === "under_review" || status === "approved") && !ownerOrAdmin) {
    // The server takes the decision from an owner or admin only. Show the
    // certificate and say who decides — and, for one the studio made itself,
    // the corrected upload anyone on the studio may make.
    body = (
      <div className="coi-inline-form">
        <FileLinks files={files} />
        <p className="coi-status-note">
          {status === "under_review"
            ? "Ready for review. Only the studio owner or an admin can approve a certificate and send it to the venue, or send it back."
            : "Approved. Only the studio owner or an admin can send it to the venue."}
        </p>
        {status === "under_review" && selfServe ? uploadButton("Upload a corrected PDF") : null}
      </div>
    );
  } else if (
    status === "under_review" ||
    status === "approved" ||
    // Sent back, then judged right after all (or the agent explained): the
    // studio can approve it from here, as decideCoi always allowed, or drop
    // in the corrected PDF themselves.
    (status === "correction_required" && files.length > 0 && ownerOrAdmin)
  ) {
    const needsVenueEmail = !text(requirement?.submissionEmail);
    body = (
      <div className="coi-inline-form">
        {status === "correction_required" ? (
          <p className="coi-status-note">
            Sent back to your agent for a correction. If it was right after all, approve it here — or upload the
            corrected PDF yourself.
          </p>
        ) : null}
        {request.reusedFromRequestId ? (
          // The certificate this venue already has, still good for this date
          // (coi/reuse.ts): one approval re-sends it, no new certificate.
          <p className="coi-status-note">
            {`The certificate you sent ${text(requirement?.venueLegalName) || "this venue"} before still covers this date${
              text((request.extractedData as Record<string, unknown> | undefined)?.policyExpirationDate)
                ? ` — the policy on it runs through ${formatEventDate(text((request.extractedData as Record<string, unknown>).policyExpirationDate))}`
                : ""
            }. Approve to send it again; no new certificate needed.`}
          </p>
        ) : null}
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
          {/* Made in the insurer's portal: there is no agent to ask, so the
              correction is a fixed PDF (decideCoi refuses the send-back). */}
          {status === "under_review" && selfServe ? uploadButton("Upload a corrected PDF") : null}
          {status === "under_review" && !selfServe ? (
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
        {status === "correction_required" ? upload : null}
      </div>
    );
  } else if (status === "failed" && !ownerOrAdmin) {
    body = (
      <p className="coi-status-note">
        The PDF that came back didn&rsquo;t pass the safety check, so StudioCue won&rsquo;t open or send it. Only the
        studio owner or an admin can ask your agent to send it again.
      </p>
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
              ? `Your agent hasn't replied after ${Number(request.chaseCount ?? 0)} follow-ups — Cue stopped following up.${text(settings?.agentPhone) ? ` Call ${text(settings?.agentPhone)}.` : ""}`
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
        {/* The server takes an upload while it is still being asked for. */}
        {status === "requested" || status === "correction_required" ? upload : null}
        {status === "requested" || status === "correction_required" ? (
          <CoiResendToAgent
            busy={busy}
            onResend={(changes) =>
              void run("resendCoi", changes, "Sent again with the corrected details. StudioCue follows up on the new one.")
            }
            requestEmail={text(request.requestEmail) || text(settings?.agentEmail)}
            requirement={requirement}
          />
        ) : null}
        {(status === "sent_to_venue" || status === "venue_acknowledged") && ownerOrAdmin ? (
          <CoiResendToVenue
            busy={busy}
            current={text(requirement?.submissionEmail)}
            onResend={(submissionEmail) =>
              void run("resendCoi", { submissionEmail }, `Sent again to ${submissionEmail}. Their reply is recorded when it comes.`)
            }
          />
        ) : null}
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

/**
 * The request went out with the wrong venue details, or to the wrong agent:
 * send it again corrected (coi/actions.ts resendCoi). Only what changed is
 * sent; the reply comes back to the same address either way.
 */
function CoiResendToAgent({
  requirement,
  requestEmail,
  busy,
  onResend,
}: {
  requirement: Row | undefined;
  requestEmail: string;
  busy: boolean;
  onResend: (changes: Record<string, unknown>) => void;
}) {
  const [legalName, setLegalName] = useState(text(requirement?.venueLegalName));
  const [holder, setHolder] = useState(text(requirement?.certificateHolder));
  const [address, setAddress] = useState(text(requirement?.venueAddress));
  const [agentEmail, setAgentEmail] = useState(requestEmail);
  const changes: Record<string, unknown> = {
    ...(legalName.trim() && legalName.trim() !== text(requirement?.venueLegalName) ? { venueLegalName: legalName.trim() } : {}),
    ...(holder.trim() && holder.trim() !== text(requirement?.certificateHolder) ? { certificateHolder: holder.trim() } : {}),
    ...(address.trim() && address.trim() !== text(requirement?.venueAddress) ? { venueAddress: address.trim() } : {}),
    ...(agentEmail.trim() && agentEmail.trim() !== requestEmail ? { agentEmail: agentEmail.trim() } : {}),
  };
  return (
    <details className="coi-resend">
      <summary>Wrong details on the request? Send it again corrected</summary>
      <div className="coi-inline-form">
        <label>
          Venue&rsquo;s legal name
          <input onChange={(event) => setLegalName(event.target.value)} value={legalName} />
        </label>
        <label>
          Certificate holder
          <input onChange={(event) => setHolder(event.target.value)} value={holder} />
        </label>
        <label>
          Venue address
          <input onChange={(event) => setAddress(event.target.value)} value={address} />
        </label>
        <label>
          Your agent&rsquo;s email
          <input onChange={(event) => setAgentEmail(event.target.value)} type="email" value={agentEmail} />
        </label>
        <footer>
          <button
            className="button button-dark"
            disabled={busy || !Object.keys(changes).length}
            onClick={() => onResend(changes)}
            type="button"
          >
            <Send /> Send it again
          </button>
        </footer>
      </div>
    </details>
  );
}

/** It went to the wrong venue address: send it again to the right one. */
function CoiResendToVenue({
  current,
  busy,
  onResend,
}: {
  current: string;
  busy: boolean;
  onResend: (submissionEmail: string) => void;
}) {
  const [email, setEmail] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim() !== current;
  return (
    <details className="coi-resend">
      <summary>Sent to the wrong address? Send it again</summary>
      <div className="coi-inline-form">
        <label>
          The venue&rsquo;s right email
          <input onChange={(event) => setEmail(event.target.value)} placeholder={current} type="email" value={email} />
        </label>
        <footer>
          <button className="button button-dark" disabled={busy || !valid} onClick={() => onResend(email.trim())} type="button">
            <Send /> Send it to the venue again
          </button>
        </footer>
      </div>
    </details>
  );
}
