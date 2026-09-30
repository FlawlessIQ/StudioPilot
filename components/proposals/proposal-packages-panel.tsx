"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, X } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import { JobAddOnsEditor, type JobAddOnLine } from "@/components/proposals/job-add-ons-editor";

/**
 * The packages on this proposal, and the way to change them.
 *
 * A couple who wants video on top of their photography — or a different
 * package altogether — used to be told the package "cannot be edited once
 * set": the job refused a second package, and an accepted proposal could not
 * be revised at all. Now, until the agreement goes out, the studio adds,
 * swaps or removes a package here and the proposal is priced again from them
 * (booking/proposals.ts "revise_packages"). Something the couple has already
 * been sent becomes a new version for them to accept; the old one stays in
 * the version history.
 */

type Row = Record<string, unknown> & { id: string };

const text = (value: unknown, fallback = ""): string => (typeof value === "string" && value ? value : fallback);
const cents = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value / 100);
}

const EDITABLE_JOB_STATES = new Set(["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING"]);
const REVISABLE = new Set(["draft", "internal_review", "approved", "sent", "viewed", "accepted"]);

export function ProposalPackagesPanel({
  proposalId,
  projectId,
  status,
  coupleName,
  onRevisedInPlace,
}: {
  proposalId: string;
  projectId: string;
  status: string;
  coupleName: string;
  /** The same proposal was re-priced; the page re-reads it. */
  onRevisedInPlace: () => void;
}) {
  const router = useRouter();
  const projects = useTenantDocuments("projects");
  const snapshots = useTenantDocuments("packageSnapshots");
  const packages = useTenantDocuments("packages");
  const contracts = useTenantDocuments("contracts");
  const [picking, setPicking] = useState<"add" | "replace" | null>(null);
  const [extrasFor, setExtrasFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const project = (projects.records ?? []).find((record) => record.id === projectId) as Row | undefined;
  if (!project || !REVISABLE.has(status) || !EDITABLE_JOB_STATES.has(text(project.state))) return null;

  const primaryId = text(project.packageSnapshotId);
  const extraIds = Array.isArray(project.additionalPackageSnapshotIds)
    ? (project.additionalPackageSnapshotIds as unknown[]).map(String)
    : [];
  const snapshotById = new Map((snapshots.records ?? []).map((record) => [record.id, record as Row]));
  const onJob = [primaryId, ...extraIds].filter(Boolean).map((id) => ({ id, snapshot: snapshotById.get(id) }));
  const active = (packages.records ?? []).filter((record) => record.active === true) as Row[];
  const sentToCouple = ["sent", "viewed", "accepted"].includes(status);
  // Once the agreement has gone out, its packages are what the couple is
  // signing: say so rather than offer buttons the server will refuse.
  const agreementOut = (contracts.records ?? []).some(
    (contract) =>
      contract.projectId === projectId &&
      ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"].includes(text(contract.status)),
  );

  async function change(label: string, action: () => Promise<unknown>) {
    if (
      sentToCouple &&
      !window.confirm(
        status === "accepted"
          ? `${coupleName} have accepted this proposal. Changing the packages makes a revised proposal for them to accept — the accepted one stays in the version history, and the agreement waits for the new one. Go ahead?`
          : `${coupleName} have already been sent this proposal. Changing the packages makes a revised version to send them; this one stays in the version history. Go ahead?`,
      )
    ) {
      return;
    }
    setBusy(label);
    setError(null);
    try {
      await action();
      const revised = await runProposalCommand("revise_packages", { proposalId });
      refreshTenantRecords("projects", "packageSnapshots", "proposals", "tasks");
      setPicking(null);
      const nextId = text(revised.result.proposalId, proposalId);
      if (revised.result.superseded === true && nextId !== proposalId) {
        router.push(`/studio/proposals/${nextId}`);
      } else {
        onRevisedInPlace();
      }
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The packages couldn't be changed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const add = (packageId: string, mode: "add" | "replace") =>
    change(`${mode}-${packageId}`, async () => {
      await runCrmCommand("selectPackage", {
        projectId,
        packageId,
        selectedAddOns: [],
        mode,
        confirmReplace: mode === "replace",
        discount: { type: "none" },
      });
    });
  const setExtras = (packageSnapshotId: string, lines: JobAddOnLine[]) =>
    change(`extras-${packageSnapshotId}`, async () => {
      await runCrmCommand("setJobAddOns", {
        projectId,
        packageSnapshotId,
        addOns: lines.map((line) =>
          line.addOnId
            ? { addOnId: line.addOnId, quantity: line.quantity }
            : {
                addOnId: null,
                name: line.name,
                unitPriceCents: line.unitPriceCents,
                taxable: line.taxable,
                quantity: line.quantity,
                saveToLibrary: line.saveToLibrary === true,
              },
        ),
      });
      setExtrasFor(null);
      refreshTenantRecords("addOns");
    });
  const remove = (packageSnapshotId: string) =>
    change(`remove-${packageSnapshotId}`, () => runCrmCommand("removePackage", { projectId, packageSnapshotId }));

  return (
    <section className="proposal-packages-panel" aria-labelledby="proposal-packages-title">
      <div className="proposal-packages-heading">
        <div>
          {/* Not "Packages": the priced list above now carries that name. */}
          <p className="eyebrow">Change packages</p>
          <h2 id="proposal-packages-title">What they&apos;re booking</h2>
        </div>
        {onJob.length < 4 && !agreementOut ? (
          <button
            className="button button-light"
            disabled={busy !== null}
            onClick={() => setPicking(picking === "add" ? null : "add")}
            type="button"
          >
            <Plus size={14} /> Add a package
          </button>
        ) : null}
      </div>
      <ul className="proposal-packages-list">
        {onJob.map(({ id, snapshot }, index) => (
          <li key={id}>
            <span>
              <strong>{text(snapshot?.packageName, "Package")}</strong>
              <small>
                {money(cents(snapshot?.totalCents), text(snapshot?.currency, "USD"))}
                {index === 0 && onJob.length > 1 ? " · main package" : ""}
              </small>
            </span>
            {agreementOut ? null : (
              <button
                className="button button-light"
                disabled={busy !== null}
                onClick={() => setExtrasFor(extrasFor === id ? null : id)}
                type="button"
              >
                Extras{Array.isArray(snapshot?.addOns) && snapshot.addOns.length ? ` (${snapshot.addOns.length})` : ""}
              </button>
            )}
            {agreementOut ? null : onJob.length > 1 ? (
              <button
                aria-label={`Remove ${text(snapshot?.packageName, "this package")}`}
                className="button button-light"
                disabled={busy !== null}
                onClick={() => void remove(id)}
                type="button"
              >
                {busy === `remove-${id}` ? <LoaderCircle className="spin" size={14} /> : <X size={14} />}
                Remove
              </button>
            ) : (
              <button
                className="button button-light"
                disabled={busy !== null}
                onClick={() => setPicking(picking === "replace" ? null : "replace")}
                type="button"
              >
                Swap
              </button>
            )}
            {extrasFor === id ? (
              <JobAddOnsEditor
                busy={busy === `extras-${id}`}
                currency={text(snapshot?.currency, "USD")}
                onCancel={() => setExtrasFor(null)}
                onSave={(lines) => void setExtras(id, lines)}
                snapshot={snapshot}
                suggested={
                  (Array.isArray(
                    (packages.records ?? []).find((record) => record.id === text(snapshot?.packageId))?.addOns,
                  )
                    ? ((packages.records ?? []).find((record) => record.id === text(snapshot?.packageId))!.addOns as Row[])
                    : []
                  ).filter((row) => row.active !== false)
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
      {picking ? (
        <div className="proposal-packages-picker">
          <small>
            {picking === "add"
              ? "Choose a package to add. The proposal is priced again with both."
              : "Choose the package to use instead."}
          </small>
          {active.length === 0 ? <small>No active packages. Add one in Library → Packages.</small> : null}
          {active.map((option) => (
            <article key={option.id}>
              <span>
                <strong>{text(option.name, "Package")}</strong>
                <small>{money(cents(option.basePriceCents), text(option.currency, "USD"))}</small>
              </span>
              <button
                className="button button-dark"
                disabled={busy !== null}
                onClick={() => void add(option.id, picking)}
                type="button"
              >
                {busy === `${picking}-${option.id}` ? <LoaderCircle className="spin" size={14} /> : null}
                {picking === "add" ? "Add" : "Use this"}
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {agreementOut ? (
        <small className="proposal-packages-note">
          The agreement has gone out for these packages. To change them, void it on the job&apos;s Booking tab first.
        </small>
      ) : sentToCouple ? (
        <small className="proposal-packages-note">
          {status === "accepted"
            ? "Any change here becomes a revised proposal for them to accept."
            : "Any change here becomes a new version to send them."}
        </small>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
