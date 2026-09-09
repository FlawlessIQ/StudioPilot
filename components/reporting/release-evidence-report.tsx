"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Gauge,
  Info,
  Plug,
  Rocket,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  summarizeReleaseEvidence,
  type ReleaseGateStatus,
} from "@/features/operations/release-evidence";

// Each gate's status maps to one semantic tone. "needs_evidence" is the amber
// state — not failing, just unproven until a real pilot produces the sample.
const GATE_TONE: Record<
  ReleaseGateStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  passed: { label: "Pass", className: "is-pass", Icon: CheckCircle2 },
  needs_evidence: {
    label: "Needs evidence",
    className: "is-amber",
    Icon: AlertTriangle,
  },
  failed: { label: "Not met", className: "is-fail", Icon: XCircle },
};

export function ReleaseEvidenceReport() {
  const productEvents = useTenantDocuments("productEvents");
  const aiActions = useTenantDocuments("aiActions");
  const actionReceipts = useTenantDocuments("actionReceipts");
  const automationRuns = useTenantDocuments("automationRuns");
  const crewCascades = useTenantDocuments("crewCascades");
  const providerJobs = useTenantDocuments("providerJobs");
  // The gate model calls this input "incidents"; the collection is
  // "incidentRecords" (tenant-scoped, owner/admin readable).
  const incidents = useTenantDocuments("incidentRecords");

  const states = [
    productEvents,
    aiActions,
    actionReceipts,
    automationRuns,
    crewCascades,
    providerJobs,
    incidents,
  ];
  const loading = states.some((state) => state.loading);
  const error = states.find((state) => state.error)?.error ?? null;

  const summary = summarizeReleaseEvidence({
    productEvents: productEvents.records ?? [],
    aiActions: aiActions.records ?? [],
    actionReceipts: actionReceipts.records ?? [],
    automationRuns: automationRuns.records ?? [],
    crewCascades: crewCascades.records ?? [],
    providerJobs: providerJobs.records ?? [],
    incidents: incidents.records ?? [],
  });

  const passed = summary.gates.filter((gate) => gate.status === "passed").length;
  const amber = summary.gates.filter(
    (gate) => gate.status === "needs_evidence",
  ).length;
  const failed = summary.gates.filter((gate) => gate.status === "failed").length;
  const providerBlocking = summary.providers.failures > 0;

  // What still stands between this tenant and a clean launch, in words.
  const blockers: string[] = [];
  if (failed) blockers.push(`${failed} gate${failed === 1 ? "" : "s"} not met`);
  if (amber)
    blockers.push(`${amber} gate${amber === 1 ? "" : "s"} awaiting pilot evidence`);
  if (providerBlocking)
    blockers.push(
      `${summary.providers.failures} provider job${summary.providers.failures === 1 ? "" : "s"} failing`,
    );

  return (
    <div className="post-event-page release-evidence-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Launch readiness</p>
          <h1>Release evidence</h1>
          <p>
            The launch gates, computed live from this studio&rsquo;s own
            records — no gate passes on a number StudioCue invented. Amber means
            the check is sound but has no real sample yet; clear it by running
            the acceptance pilot, not by editing anything here.
          </p>
        </div>
        <Link className="button button-light" href="/studio/reports">
          <ArrowLeft aria-hidden="true" /> Back to insights
        </Link>
      </header>

      {error ? <p className="form-notice">{error}</p> : null}

      <section
        className={`panel release-verdict ${
          summary.ready ? "is-ready" : "is-not-ready"
        }`}
      >
        <span className="release-verdict-icon">
          <Rocket aria-hidden="true" />
        </span>
        <div className="release-verdict-copy">
          <strong>
            {loading
              ? "Reading the evidence…"
              : summary.ready
                ? "Cleared to launch"
                : "Not yet cleared to launch"}
          </strong>
          <p>
            {loading
              ? "Gathering this studio's operational records."
              : summary.ready
                ? "Every gate passed and no provider jobs are failing."
                : `Still outstanding: ${blockers.join(" · ")}.`}
          </p>
        </div>
        <span className="release-verdict-tally" aria-hidden="true">
          <b className="is-pass">{loading ? "—" : passed}</b> pass
          <b className="is-amber">{loading ? "—" : amber}</b> amber
          <b className="is-fail">{loading ? "—" : failed}</b> not met
        </span>
      </section>

      <section className="release-gates">
        {summary.gates.map((gate) => {
          const tone = GATE_TONE[gate.status];
          const { Icon } = tone;
          return (
            <article key={gate.key} className={`panel release-gate ${tone.className}`}>
              <span className="release-gate-icon">
                <Icon aria-hidden="true" />
              </span>
              <div className="release-gate-copy">
                <div className="release-gate-head">
                  <strong>{gate.label}</strong>
                  <span className={`release-gate-pill ${tone.className}`}>
                    {tone.label}
                  </span>
                </div>
                <p>{loading ? "Reading the evidence…" : gate.evidence}</p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="release-supporting">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Supporting signals</p>
            <h2>The numbers behind the gates</h2>
            <p>
              Each figure is measured from live records, so it moves with real
              activity rather than with data entry.
            </p>
          </div>
        </div>
        <div className="release-signal-grid">
          <article className="panel release-signal">
            <ShieldCheck aria-hidden="true" />
            <span>
              <small>AI authority violations</small>
              <strong>{loading ? "—" : summary.ai.authorityViolations}</strong>
              <p>
                Across {summary.ai.decided} decided AI actions ·{" "}
                {summary.ai.acceptanceRate === null
                  ? "no acceptance sample"
                  : `${summary.ai.acceptanceRate}% accepted`}
              </p>
            </span>
          </article>
          <article className="panel release-signal">
            <Bot aria-hidden="true" />
            <span>
              <small>Automation reliability</small>
              <strong>
                {loading
                  ? "—"
                  : summary.automation.reliability === null
                    ? "Needs data"
                    : `${summary.automation.reliability}%`}
              </strong>
              <p>
                {summary.automation.completed} completed ·{" "}
                {summary.automation.failed} failed
              </p>
            </span>
          </article>
          <article className="panel release-signal">
            <Users aria-hidden="true" />
            <span>
              <small>Median staffing time</small>
              <strong>
                {loading
                  ? "—"
                  : summary.crew.medianMinutes === null
                    ? "Needs data"
                    : `${Math.round(summary.crew.medianMinutes)}m`}
              </strong>
              <p>
                {summary.crew.completedCascades} completed cascade
                {summary.crew.completedCascades === 1 ? "" : "s"} measured
              </p>
            </span>
          </article>
          <article className="panel release-signal">
            <Gauge aria-hidden="true" />
            <span>
              <small>Verified time reclaimed</small>
              <strong>
                {loading
                  ? "—"
                  : summary.verifiedHandlingEventCount
                    ? `${summary.verifiedMinutesSaved}m`
                    : "Needs data"}
              </strong>
              <p>
                {summary.verifiedHandlingEventCount} measured event
                {summary.verifiedHandlingEventCount === 1 ? "" : "s"}
                {summary.ownerEstimatedMinutesSaved
                  ? ` · ${summary.ownerEstimatedMinutesSaved}m owner-estimated`
                  : ""}
              </p>
            </span>
          </article>
        </div>
        <article
          className={`panel release-provider ${
            summary.providers.health === "attention" ? "is-attention" : ""
          }`}
        >
          <Plug aria-hidden="true" />
          <span>
            <small>Provider integrations</small>
            <strong>
              {loading
                ? "—"
                : summary.providers.health === "unmeasured"
                  ? "No provider jobs yet"
                  : summary.providers.health === "healthy"
                    ? "Healthy"
                    : `${summary.providers.failures} failing`}
            </strong>
            <p>
              {summary.providers.jobs} provider job
              {summary.providers.jobs === 1 ? "" : "s"} tracked. Failures here
              usually mean an integration (e-signature, accounting, calendar)
              has not completed production OAuth and certification.
            </p>
          </span>
        </article>
      </section>

      <aside className="panel report-source-note">
        <Info aria-hidden="true" />
        <span>
          <h2>How to read this</h2>
          <p>
            A gate turns green only when live records prove it. An amber gate is
            correct but unproven — it clears when a real acceptance pilot
            produces the measurement, never by hand. Failing provider jobs are
            an operational signal, not a code defect; certify the integration
            and re-run the job.
          </p>
        </span>
      </aside>
    </div>
  );
}
