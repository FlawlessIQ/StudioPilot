"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  readSignedAgreementAttachment,
  type SignedAgreementReadResult,
} from "@/lib/ai/copilot-client";
import { recordSignedAgreement } from "@/lib/booking/command-client";

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

  const jobs = result?.candidates.filter((candidate) => candidate.proposalId) ?? [];
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
            against your name. {job.projectName} is now waiting on the retainer.
          </p>
          <Link className="button button-light button-sm" href={`/studio/projects/${job.projectId}`}>
            Open {job.projectName}
          </Link>
        </div>
      ) : null}

      {phase === "ready" && result ? (
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

          {jobs.length === 0 ? (
            <p className="cue-signed-agreement-note">
              No job is waiting on a signature, so there is nothing to record
              this against yet. A contract can be recorded once its proposal has
              been accepted.
            </p>
          ) : (
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
