"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FileText, LoaderCircle } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useTenantDocuments, refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { readContractDetailsAttachment, type ContractDetailsReadResult } from "@/lib/ai/copilot-client";
import { applyContractDetails, attachSignedCopyToImportedBooking } from "@/lib/booking/command-client";

/**
 * Filling in imported jobs from their signed contracts (GR Productions,
 * 2026-10-27; functions/src/planning/contract-details.ts).
 *
 * An imported job knew its date and venue and nothing else of the day, so
 * the client's forms asked for names, places and times already in a signed
 * contract on the studio's disk. Here the studio drops the contracts in;
 * Cue reads each one against the studio's own questions and finds its job;
 * the studio checks every answer; and what it keeps fills the job's open
 * forms, every form sent later, and Schedule A. The PDF is filed on the job.
 *
 * Several at once from the import page, or one from a job (`projectId`).
 * Nothing reaches the client: their forms are filled for when they open them.
 */

type Item = {
  id: string;
  file: File;
  phase: "waiting" | "reading" | "scanning" | "read" | "failed";
  result?: ContractDetailsReadResult;
  error?: string;
};

const dateLabel = (value: string) => {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

/** The browser's own box for a time or a date, so "15:30" reads as the studio sets it. */
const inputType = (type: string) =>
  type === "time" ? "time" : type === "date" ? "date" : type === "email" ? "email" : type === "phone" ? "tel" : "text";

export function ContractDetailsReader({
  projectId,
  projectName,
  onKept,
  file,
}: {
  projectId?: string;
  projectName?: string;
  /** Called once a contract's details are kept, so a page can show them. */
  onKept?: () => void;
  /** A contract already in hand (dropped into Cue): read at once, no picker. */
  file?: File;
}) {
  const workspace = useWorkspace();
  const [items, setItems] = useState<Item[]>(() => (file ? [{ id: crypto.randomUUID(), file, phase: "waiting" }] : []));
  const update = (id: string, patch: Partial<Item>) =>
    setItems((prior) => prior.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  // One reading at a time, in the order they were added: each spends the
  // studio's AI allowance, and a dozen at once would race the safety scan.
  const next = items.find((item) => item.phase === "waiting");
  const busy = items.some((item) => item.phase === "reading" || item.phase === "scanning");
  // Each reading once, even when React runs an effect twice.
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (!next || busy || !workspace.tenantId) return;
    const attempt = `${next.id}:${next.error ?? ""}`;
    if (started.current.has(attempt)) return;
    started.current.add(attempt);
    update(next.id, { phase: "reading" });
    readContractDetailsAttachment({
      tenantId: workspace.tenantId,
      file: next.file,
      projectId,
      onScanning: () => update(next.id, { phase: "scanning" }),
    })
      .then((result) => update(next.id, { phase: "read", result }))
      .catch((caught: unknown) => update(next.id, { phase: "failed", error: friendlyError(caught, "Cue couldn't read that contract.") }));
  }, [next, busy, workspace.tenantId, projectId]);

  function add(files: FileList | null) {
    const chosen = Array.from(files ?? []).slice(0, projectId ? 1 : 40);
    setItems((prior) => [
      ...(projectId ? [] : prior),
      ...chosen.map((file) => ({ id: crypto.randomUUID(), file, phase: "waiting" as const })),
    ]);
  }

  return (
    <div className="contract-details">
      {file ? null : (
      <label className="contract-details-pick">
        <FileText size={16} aria-hidden="true" />
        <span>{projectId ? "Choose the signed contract" : "Choose signed contracts"}</span>
        <input
          accept="application/pdf,image/jpeg,image/png"
          multiple={!projectId}
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
          type="file"
        />
      </label>
      )}
      {items.map((item) => (
        <ContractCard
          item={item}
          key={item.id}
          onKept={onKept}
          onRetry={() => update(item.id, { phase: "waiting", error: `${item.error ?? ""}+` })}
          projectId={projectId}
          projectName={projectName}
        />
      ))}
    </div>
  );
}

function ContractCard({
  item,
  onKept,
  onRetry,
  projectId,
  projectName,
}: {
  item: Item;
  onKept?: () => void;
  onRetry: () => void;
  projectId?: string;
  projectName?: string;
}) {
  if (item.phase === "read" && item.result)
    return (
      <ContractCheck file={item.file} fileId={item.id} onKept={onKept} projectId={projectId} projectName={projectName} result={item.result} />
    );
  return (
    <section className="contract-details-card" aria-live="polite">
      <p className="contract-details-file">{item.file.name}</p>
      {item.phase === "failed" ? (
        <p className="contract-details-problem" role="alert">
          <CircleAlert size={15} aria-hidden="true" /> {item.error}{" "}
          <button className="contract-details-link" onClick={onRetry} type="button">
            Try again
          </button>
        </p>
      ) : (
        <p className="contract-details-status">
          <LoaderCircle className="spin" size={15} aria-hidden="true" />
          {item.phase === "waiting" ? "Waiting its turn" : item.phase === "scanning" ? "Checking the file is safe" : "Reading the contract"}
        </p>
      )}
    </section>
  );
}

/** One contract read: the studio checks it, then keeps it on the job. */
function ContractCheck({
  file,
  fileId,
  onKept,
  projectId,
  projectName,
  result,
}: {
  file: File;
  fileId: string;
  onKept?: () => void;
  projectId?: string;
  projectName?: string;
  result: ContractDetailsReadResult;
}) {
  const projectRecords = useTenantDocuments("projects").records;
  const contracts = useTenantDocuments("contracts").records ?? [];
  const imported = useMemo(
    () =>
      (projectRecords ?? [])
        .filter((project) => typeof project.importedAt === "string" && !project.archivedAt)
        .sort((left, right) => String(left.eventDate ?? "").localeCompare(String(right.eventDate ?? ""))),
    [projectRecords],
  );
  // Starts from what was read: the job it matched and each answer.
  const [jobId, setJobId] = useState(projectId ?? result.match?.projectId ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(result.rows.map((row) => [row.key, row.value])));
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"checking" | "saving" | "done" | "skipped">("checking");
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState<{ kept: number; answersFilled: number; formsFilled: number; filed: boolean } | null>(null);

  const jobName =
    projectName ||
    String(imported.find((project) => project.id === jobId)?.name ?? (result.match?.projectId === jobId ? result.match.name : ""));

  if (phase === "skipped")
    return (
      <section className="contract-details-card is-done">
        <p className="contract-details-file">{file.name}</p>
        <p className="contract-details-status">Skipped. Nothing was kept from it.</p>
      </section>
    );

  if (phase === "done" && done)
    return (
      <section className="contract-details-card is-done" aria-live="polite">
        <p className="contract-details-file">{file.name}</p>
        <p className="contract-details-done">
          <CircleCheck size={16} aria-hidden="true" />
          <span>
            {`${jobName}: ${done.kept} detail${done.kept === 1 ? "" : "s"} kept from the contract. `}
            {done.formsFilled
              ? `${done.answersFilled} answer${done.answersFilled === 1 ? "" : "s"} filled in on ${done.formsFilled} form${done.formsFilled === 1 ? "" : "s"}, and every form you send later starts with them. `
              : "Every form you send starts with them. "}
            {done.filed ? "The signed contract is filed on the job." : ""}
          </span>
        </p>
        <Link className="button button-sm" href={`/studio/projects/${jobId}`}>
          Open {jobName}
        </Link>
      </section>
    );

  const answeredKeys = new Set(result.rows.map((row) => row.key));
  const unanswered = result.questions.filter((question) => !answeredKeys.has(question.key));
  const kept = [
    ...result.rows.filter((row) => !skipped[row.key] && (values[row.key] ?? "").trim()),
    ...unanswered.filter((question) => (values[question.key] ?? "").trim()),
  ].map((row) => ({ label: row.label, type: row.type, value: (values[row.key] ?? "").trim(), ...(row.section ? { section: row.section } : {}) }));

  async function save() {
    if (!jobId || !kept.length) return;
    setPhase("saving");
    setProblem("");
    try {
      const drop = result.rows.filter((row) => skipped[row.key]).map((row) => row.label);
      const saved = await applyContractDetails({ projectId: jobId, rows: kept, ...(drop.length ? { drop } : {}) });
      if (saved.mode === "preview") {
        setProblem("Development preview: nothing was kept.");
        setPhase("checking");
        return;
      }
      // The paper with the record, when the job has none yet.
      const unfiled = contracts.some(
        (contract) => contract.projectId === jobId && contract.completionAuthority === "imported" && !contract.signedDocumentId,
      );
      let filed = false;
      if (unfiled)
        try {
          filed = (await attachSignedCopyToImportedBooking({ projectId: jobId, signedCopy: file })).mode === "live";
        } catch {
          filed = false;
        }
      setDone({ kept: saved.kept, answersFilled: saved.answersFilled, formsFilled: saved.formsFilled, filed });
      setPhase("done");
      refreshTenantRecords("projects", "questionnaireResponses", "contracts");
      onKept?.();
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "The details couldn't be kept."));
      setPhase("checking");
    }
  }

  const said = [result.clientNames.join(" & "), result.eventDate ? dateLabel(result.eventDate) : ""].filter(Boolean).join(", ");
  return (
    <section className="contract-details-card">
      <p className="contract-details-file">{file.name}</p>
      {result.mode === "unavailable" ? (
        <p className="contract-details-note">
          Cue couldn&rsquo;t read this one, so nothing is filled in. Type what the contract says below, or skip it.
        </p>
      ) : !result.isAgreement ? (
        <p className="contract-details-note">
          <CircleAlert size={15} aria-hidden="true" /> This doesn&rsquo;t read like a signed client agreement. Check it&rsquo;s the right file.
        </p>
      ) : null}
      {projectId ? null : (
        <label className="contract-details-job">
          <span>
            {result.match ? `For ${result.match.name}` : "Which job is it for?"}
            {said ? <small>{`The contract names ${said}.`}</small> : null}
          </span>
          <select onChange={(event) => setJobId(event.target.value)} value={jobId}>
            <option value="">Choose the job</option>
            {imported.map((project) => (
              <option key={project.id} value={project.id}>
                {`${String(project.name ?? project.id)}${project.eventDate ? ` · ${dateLabel(String(project.eventDate))}` : ""}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {result.rows.length ? (
        <div className="contract-details-rows">
          <p className="contract-details-lead">
            {`What the contract says (${result.rows.length}). Check each one: it fills in your client's forms.`}
          </p>
          {result.rows.map((row) => (
            <div className={`contract-details-row${skipped[row.key] ? " is-skipped" : ""}`} key={row.key}>
              <label className="contract-details-question" htmlFor={`${fileId}-${row.key}`}>
                {row.label}
                {row.section ? <small>{row.section}</small> : null}
              </label>
              <input
                disabled={skipped[row.key]}
                id={`${fileId}-${row.key}`}
                type={inputType(row.type)}
                onChange={(event) => setValues((prior) => ({ ...prior, [row.key]: event.target.value }))}
                value={values[row.key] ?? ""}
              />
              <label className="contract-details-use">
                <input
                  checked={!skipped[row.key]}
                  onChange={(event) => setSkipped((prior) => ({ ...prior, [row.key]: !event.target.checked }))}
                  type="checkbox"
                />
                Use
              </label>
            </div>
          ))}
        </div>
      ) : result.mode === "ai" ? (
        <p className="contract-details-note">The contract didn&rsquo;t answer any of your forms&rsquo; questions.</p>
      ) : null}
      {unanswered.length ? (
        <details className="contract-details-more" open={!result.rows.length}>
          <summary>{`Questions the contract didn't answer (${unanswered.length})`}</summary>
          {unanswered.map((question) => (
            <div className="contract-details-row" key={question.key}>
              <label className="contract-details-question" htmlFor={`${fileId}-${question.key}`}>
                {question.label}
                {question.section ? <small>{question.section}</small> : null}
              </label>
              <input
                id={`${fileId}-${question.key}`}
                type={inputType(question.type)}
                onChange={(event) => setValues((prior) => ({ ...prior, [question.key]: event.target.value }))}
                value={values[question.key] ?? ""}
              />
            </div>
          ))}
        </details>
      ) : null}
      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="contract-details-actions">
        <button
          className="button button-dark button-sm"
          disabled={phase === "saving" || !jobId || !kept.length}
          onClick={() => void save()}
          type="button"
        >
          {phase === "saving" ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
          {jobId ? `Fill in ${jobName || "the job"}` : "Choose the job first"}
        </button>
        <button className="button button-sm" disabled={phase === "saving"} onClick={() => setPhase("skipped")} type="button">
          Skip this one
        </button>
      </div>
    </section>
  );
}
