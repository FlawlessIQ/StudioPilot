"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { ContractDetailsReader } from "@/components/imports/contract-details-reader";
import { importedJobForContract } from "@/features/imports/contract-match";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  readSignedAgreementAttachment,
  type SignedAgreementReadResult,
} from "@/lib/ai/copilot-client";
import { recordSignedAgreement } from "@/lib/booking/command-client";
import { useWorkspace } from "@/features/auth/workspace-context";
import { crewRoleFromHeader, importCrewRoles } from "@/features/imports/sheet-columns";
import {
  ExistingBookingForm,
  type ExistingBookingFormValues,
} from "@/components/imports/existing-booking-form";

/**
 * A signed agreement dropped into Cue, read and ready for a person to record.
 *
 * Cue fills in the form a studio would otherwise type from the PDF — the job,
 * who signed, when — and lists anything about the document that disagrees with
 * the job. It does not record. The button runs the same `recordSignedAgreement`
 * as the form on the job page: owner or admin only, a manual attestation, and
 * the project moves to awaiting the retainer only if it was waiting on this
 * signature with an accepted proposal. Every field stays editable, because the
 * reading is a draft of what the studio is about to vouch for.
 */
export function SignedAgreementCard({
  file,
  tenantId,
}: {
  file: File;
  tenantId: string;
}) {
  const trade = useWorkspace().tenantTrade;
  const [phase, setPhase] = useState<"reading" | "scanning" | "ready" | "failed" | "recorded">(
    "reading",
  );
  const [result, setResult] = useState<SignedAgreementReadResult | null>(null);
  const [failure, setFailure] = useState("");
  const [projectId, setProjectId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [method, setMethod] = useState("Signed copy attached in Cue");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // One reading per attachment, even when React mounts effects twice.
    if (started.current) return;
    started.current = true;
    void readSignedAgreementAttachment({
      tenantId,
      file,
      onScanning: () => setPhase("scanning"),
    })
      .then((read) => {
        setResult(read);
        const suggestion = read.assessment.suggestion;
        setProjectId(suggestion?.projectId ?? "");
        setSignerName(suggestion?.signerName ?? read.reading.signerNames[0] ?? "");
        setSignedAt(suggestion?.signedAt ?? "");
        setPhase("ready");
      })
      .catch((caught: unknown) => {
        setFailure(friendlyError(caught, "Cue couldn't read that file."));
        setPhase("failed");
      });
  }, [file, tenantId]);

  const [importing, setImporting] = useState(false);
  const [filling, setFilling] = useState(false);
  const jobs = result?.candidates.filter((candidate) => candidate.proposalId) ?? [];
  // A contract for a booking already imported fills that job's forms; it is
  // never a signature to record nor a booking to import again (Gabe, Kim
  // Karpinski & Drew Gizzi, 2026-10-28: Cue offered to import their wedding a
  // second time and the Final schedule stayed at 9%).
  const projectRecords = useTenantDocuments("projects").records;
  const importedJobs = useMemo(
    () =>
      (projectRecords ?? [])
        .filter((project) => typeof project.importedAt === "string" && !project.archivedAt)
        .map((project) => ({ id: String(project.id), name: String(project.name ?? ""), eventDate: typeof project.eventDate === "string" ? project.eventDate : null })),
    [projectRecords],
  );
  const importedMatch = result && !result.assessment.suggestion ? importedJobForContract(result.reading, importedJobs) : null;
  // A signed contract that belongs to no job waiting on a signature is, far
  // more often than not, a booking the studio made before StudioCue. Offer to
  // bring it in as one — prefilled, with this same PDF attached — rather than
  // leave the studio at a dead end.
  const flagCodes = result?.assessment.flags.map((flag) => flag.code) ?? [];
  const offerImport =
    result !== null &&
    !result.assessment.suggestion &&
    !importedMatch &&
    !flagCodes.includes("NOT_A_SIGNED_AGREEMENT") &&
    (jobs.length === 0 ||
      flagCodes.includes("NO_MATCHING_JOB") ||
      result.mode === "unavailable");
  const job = jobs.find((candidate) => candidate.projectId === projectId) ?? null;

  async function record() {
    if (!job?.proposalId) return;
    setBusy(true);
    setNotice("");
    try {
      const recorded = await recordSignedAgreement({
        projectId: job.projectId,
        proposalId: job.proposalId,
        signerName: signerName.trim(),
        signedAt,
        method: method.trim(),
        file,
      });
      if ("mode" in recorded && recorded.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      refreshTenantRecords("projects");
      setPhase("recorded");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The signature could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel cue-signed-agreement" aria-live="polite">
      <header>
        <FileCheck2 aria-hidden="true" size={16} />
        <span>
          <strong>Signed agreement</strong>
          <small>{file.name}</small>
        </span>
      </header>

      {phase === "reading" || phase === "scanning" ? (
        <p className="cue-signed-agreement-status">
          <LoaderCircle className="spin" size={14} aria-hidden="true" />
          {phase === "scanning"
            ? "Checking the file is safe to open…"
            : "Reading the agreement…"}
        </p>
      ) : null}

      {phase === "failed" ? (
        <p className="form-error" role="status">
          {failure}
        </p>
      ) : null}

      {phase === "recorded" && job ? (
        <div className="cue-signed-agreement-done">
          <p>
            <ShieldCheck size={14} aria-hidden="true" /> Signature recorded
            against your name. {job.projectName}{" "} is now waiting on the retainer.
          </p>
          <Link className="button button-light button-sm" href={`/studio/projects/${job.projectId}`}>
            Open {job.projectName}
          </Link>
        </div>
      ) : null}

      {phase === "ready" && result && importing ? (
        <div className="cue-signed-agreement-import">
          <p className="cue-signed-agreement-note">
            Importing it as a booking you already have. Cue filled in what the
            contract states — check everything, and add what it doesn&rsquo;t say.
          </p>
          <ExistingBookingForm
            compact
            initial={prefillFromReading(result, trade)}
            signedCopy={file}
            source="cue"
          />
          <button
            className="booking-import-another"
            onClick={() => setImporting(false)}
            type="button"
          >
            Back to recording a signature
          </button>
        </div>
      ) : null}

      {phase === "ready" && result && filling ? (
        <div className="cue-signed-agreement-import">
          <ContractDetailsReader
            file={file}
            onKept={() => refreshTenantRecords("projects")}
            projectId={importedMatch?.id}
            projectName={importedMatch?.name}
          />
          <button className="booking-import-another" onClick={() => setFilling(false)} type="button">
            Back
          </button>
        </div>
      ) : null}

      {phase === "ready" && result && !importing && !filling ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void record();
          }}
        >
          {result.mode === "unavailable" ? (
            <p className="cue-signed-agreement-note">
              Document reading isn&rsquo;t switched on for this workspace, so
              Cue hasn&rsquo;t read the file. Fill in the details from it — the
              signed copy is still saved to the job when you record.
            </p>
          ) : null}

          {result.assessment.flags.length > 0 ? (
            <ul className="cue-signed-agreement-flags">
              {result.assessment.flags.map((flag) => (
                <li key={flag.code}>
                  <CircleAlert size={14} aria-hidden="true" />
                  {flag.message}
                </li>
              ))}
            </ul>
          ) : null}

          {importedMatch ? (
            <div className="cue-signed-agreement-offer">
              <p className="cue-signed-agreement-note">
                This is the contract for {importedMatch.name}, a booking you imported. Cue can fill in their forms from it:
                the names, places and times. You check every answer before anything is kept.
              </p>
              <button className="button button-light button-sm" onClick={() => setFilling(true)} type="button">
                Fill in {importedMatch.name}&rsquo;s forms
              </button>
            </div>
          ) : offerImport && importedJobs.length ? (
            <div className="cue-signed-agreement-offer">
              <p className="cue-signed-agreement-note">
                Is this a booking you already imported? Fill in its forms from the contract instead.
              </p>
              <button className="button button-light button-sm" onClick={() => setFilling(true)} type="button">
                Fill in an imported booking&rsquo;s forms
              </button>
            </div>
          ) : null}

          {offerImport ? (
            <div className="cue-signed-agreement-offer">
              <p className="cue-signed-agreement-note">
                {jobs.length === 0
                  ? "No job is waiting on a signature. If this is a wedding you booked before StudioCue, import it — nothing will be sent to the couple."
                  : "If this is a wedding you booked before StudioCue, import it instead — nothing will be sent to the couple."}
              </p>
              <button
                className="button button-light button-sm"
                onClick={() => setImporting(true)}
                type="button"
              >
                Import as a booking you already have
              </button>
            </div>
          ) : null}
          {jobs.length === 0 ? null : (
            <>
              <label>
                Job
                <select
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                  value={projectId}
                >
                  <option value="">Choose the job this belongs to</option>
                  {jobs.map((candidate) => (
                    <option key={candidate.projectId} value={candidate.projectId}>
                      {candidate.projectName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Who signed
                <input
                  maxLength={160}
                  onChange={(event) => setSignerName(event.target.value)}
                  required
                  value={signerName}
                />
              </label>
              <label>
                Date signed
                <input
                  onChange={(event) => setSignedAt(event.target.value)}
                  required
                  type="date"
                  value={signedAt}
                />
              </label>
              <label>
                How it was signed
                <input
                  maxLength={200}
                  onChange={(event) => setMethod(event.target.value)}
                  required
                  value={method}
                />
              </label>
              <p className="cue-signed-agreement-note">
                Recording this is your attestation, not a verified signature.
                The signed copy is saved to the job and the audit log shows you
                vouched for it.
              </p>
              <button className="button button-dark" disabled={busy || !job} type="submit">
                {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
                Record the signature
              </button>
            </>
          )}

          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/**
 * The contract's crew as the form's lines: each role as written ("Second
 * shooter", "Hair assistant") mapped to the studio's own (sheet-columns.ts),
 * with how many and who when the contract says. Nothing stated, one line of
 * the studio's own role with the count left for the studio to fill.
 */
function crewFromReading(
  details: SignedAgreementReadResult["details"],
  trade: unknown,
): ExistingBookingFormValues["crew"] {
  const roles = importCrewRoles(trade);
  const lines = (details.crew ?? []).flatMap((line) => {
    const found = crewRoleFromHeader(line.role, trade);
    const role = found?.role ?? roles[0]!;
    const names = line.names.filter(Boolean);
    const count = line.count ?? (names.length || null);
    return count === null && !names.length ? [] : [{ role, count: count === null ? "" : String(count), names: names.join(", ") }];
  });
  if (lines.length) return lines;
  // An older reading's two counts, for a photographer.
  const legacy = [
    details.photographers ? { role: roles[0]!, count: String(details.photographers), names: "" } : null,
    details.videographers && roles.includes("videographer") ? { role: "videographer" as const, count: String(details.videographers), names: "" } : null,
  ].filter((line): line is NonNullable<typeof line> => line !== null);
  return legacy.length ? legacy : [{ role: roles[0]!, count: "", names: "" }];
}

/** The reading as the import form's starting values. Only what the page stated. */
function prefillFromReading(
  result: SignedAgreementReadResult,
  trade: unknown,
): Partial<ExistingBookingFormValues> {
  const split = (name: string | undefined) => {
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
  };
  const { reading, details } = result;
  const primary = split(reading.clientNames[0] ?? reading.signerNames[0]);
  const partner = split(reading.clientNames[1]);
  const amount = (value: number | null) =>
    value === null ? "" : String(Math.round(value * 100) / 100);
  return {
    firstName: primary.first,
    lastName: primary.last,
    email: details.clientEmails[0] ?? "",
    phone: details.clientPhones[0] ?? "",
    partnerFirstName: partner.first,
    partnerLastName: partner.last,
    partnerEmail: details.clientEmails[1] ?? "",
    eventDate: reading.eventDate ?? "",
    venueName: details.venueName ?? "",
    city: details.city ?? "",
    packageName: details.packageName ?? "",
    total: amount(details.contractTotal),
    tax: details.taxAmount === null ? "0" : amount(details.taxAmount),
    // Left empty when the contract doesn't say (2026-10-26): "8 hours" and
    // "1 photographer" read exactly like values Cue had found.
    coverageHours: details.coverageHours === null ? "" : String(details.coverageHours),
    crew: crewFromReading(details, trade),
    signedOn: reading.signedDate ?? "",
    signerName: reading.signerNames[0] ?? "",
    // The contract says what the retainer is, not when it arrived: the date
    // is left for the studio, who knows.
    payments:
      details.retainerAmount !== null
        ? [{ amount: amount(details.retainerAmount), paidOn: "", method: "Retainer" }]
        : undefined,
  };
}
