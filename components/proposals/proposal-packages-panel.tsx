"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, X } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import { useWorkspace } from "@/features/auth/workspace-context";
import { extraIdeasFor } from "@/features/packages/extra-ideas";
import { tradeOf, tradeVocab } from "@/features/trades/trades";
import {
  REVISABLE_PROPOSAL_STATUSES,
  oneOffReplaceConfirmText,
  packageChangeAlreadyApplied,
} from "@/features/proposals/workspace-guards";
import { isCataloguePackage, oneOffProjectId } from "@/features/packages/one-off";
import { oneOffFormValuesFrom, type OneOffPackageInput } from "@/features/packages/one-off-form";
import { OneOffPackageForm } from "@/components/proposals/one-off-package-form";
import { JobAddOnsEditor, type JobAddOnLine } from "@/components/proposals/job-add-ons-editor";
import { discountFromForm, discountLabel, discountRuleOf } from "@/features/proposals/package-discount";
import { InfoHint } from "@/components/ui/info-hint";

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
const REVISABLE = new Set<string>(REVISABLE_PROPOSAL_STATUSES);

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
  const workspace = useWorkspace();
  // "quote" for a makeup artist or hair stylist (trades.ts).
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  const projects = useTenantDocuments("projects");
  const snapshots = useTenantDocuments("packageSnapshots");
  const packages = useTenantDocuments("packages");
  const contracts = useTenantDocuments("contracts");
  const [picking, setPicking] = useState<"add" | "replace" | null>(null);
  // "Write a one-off package", inside the picker (GR, 2026-10-01).
  const [writing, setWriting] = useState(false);
  const [extrasFor, setExtrasFor] = useState<string | null>(null);
  // "Edit" on a one-off line: the same form, filled in (updateOneOffPackage).
  const [editingFor, setEditingFor] = useState<string | null>(null);
  // The discount editor, one package at a time. The composer set a discount
  // only when a package was first locked; after that it could not change.
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [discountKind, setDiscountKind] = useState<"none" | "percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const project = (projects.records ?? []).find((record) => record.id === projectId) as Row | undefined;
  if (!project || !REVISABLE.has(status) || !EDITABLE_JOB_STATES.has(text(project.state))) return null;
  // Every change here ends in revise_packages, which is owner/admin only. A
  // coordinator's change landed and the re-price was refused, leaving the
  // couple holding a proposal they could no longer accept; the server now
  // refuses the change itself, and the panel doesn't offer it.
  if (workspace.role !== "studio_owner" && workspace.role !== "studio_admin") return null;

  const primaryId = text(project.packageSnapshotId);
  const extraIds = Array.isArray(project.additionalPackageSnapshotIds)
    ? (project.additionalPackageSnapshotIds as unknown[]).map(String)
    : [];
  const snapshotById = new Map((snapshots.records ?? []).map((record) => [record.id, record as Row]));
  const onJob = [primaryId, ...extraIds].filter(Boolean).map((id) => ({ id, snapshot: snapshotById.get(id) }));
  // The studio's library, plus a one-off written for this job; never another
  // couple's one-off (features/packages/one-off.ts).
  const active = (packages.records ?? []).filter(
    (record) => record.active === true && isCataloguePackage(record, { projectId }),
  ) as Row[];
  const sentToCouple = ["sent", "viewed", "accepted"].includes(status);
  // Once the agreement has gone out, its packages are what the couple is
  // signing: say so rather than offer buttons the server will refuse.
  const agreementOut = (contracts.records ?? []).some(
    (contract) =>
      contract.projectId === projectId &&
      ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"].includes(text(contract.status)),
  );

  /**
   * `loses` names what the change takes off the job ("Photo booth", a whole
   * package). On a draft that went through on one tap and was gone; now it is
   * said first, sent or not.
   */
  async function change(label: string, action: () => Promise<unknown>, loses: string | null = null) {
    if (
      sentToCouple &&
      !window.confirm(
        [
          loses,
          status === "accepted"
            ? `${coupleName} have accepted this ${offer}. Changing the packages makes a revised ${offer} for them to accept — the accepted one stays in the version history, and the agreement waits for the new one. Go ahead?`
            : `${coupleName} have already been sent this ${offer}. Changing the packages makes a revised version to send them; this one stays in the version history. Go ahead?`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
    ) {
      return;
    }
    if (!sentToCouple && loses && !window.confirm(`${loses}\n\nGo ahead?`)) return;
    setBusy(label);
    setError(null);
    try {
      try {
        await action();
      } catch (caught: unknown) {
        // A retry after the change landed and the re-price didn't: the change
        // is already there, and the proposal still has to follow it.
        if (!packageChangeAlreadyApplied(caught)) throw caught;
      }
      const revised = await runProposalCommand("revise_packages", { proposalId });
      refreshTenantRecords("projects", "packageSnapshots", "proposals", "tasks");
      setPicking(null);
      setWriting(false);
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

  const extrasOf = (snapshot: Row | undefined) =>
    (Array.isArray(snapshot?.addOns) ? (snapshot.addOns as Row[]) : []).map((line) => text(line.name, "Extra"));
  const add = (packageId: string, mode: "add" | "replace") => {
    // A swap replaces the one package on the job: its extras don't carry
    // over (they were priced for it); its discount does ("keep").
    const replaced = onJob[0]?.snapshot;
    const lostExtras = mode === "replace" ? extrasOf(replaced) : [];
    const newName = text(active.find((option) => option.id === packageId)?.name, "the new package");
    return change(
      `${mode}-${packageId}`,
      async () => {
        await runCrmCommand("selectPackage", {
          projectId,
          packageId,
          selectedAddOns: [],
          mode,
          confirmReplace: mode === "replace",
          // Swap used to send "none" and silently drop a discount the couple
          // was promised. "keep" carries it to the new package.
          discount: { type: "keep" },
        });
      },
      mode === "replace" && lostExtras.length
        ? `Swapping ${text(replaced?.packageName, "the package")} for ${newName} takes its extras off: ${lostExtras.join(", ")}. Add them again to ${newName} if they still want them.`
        : null,
    );
  };
  /**
   * A package written for this couple: made and put on the job in one
   * command, then the proposal is priced again exactly as for a library
   * package added here. The form's key makes a retry after a failed re-price
   * return the package already made instead of writing a second one.
   */
  const writeOneOff = (input: OneOffPackageInput, idempotencyKey: string) => {
    const replacing = input.mode === "replace";
    return change(
      "one-off",
      async () => {
        await runCrmCommand(
          "createOneOffPackage",
          { projectId, ...input, confirmReplace: replacing },
          { idempotencyKey },
        );
        refreshTenantRecords("packages");
      },
      replacing
        ? oneOffReplaceConfirmText(
            input.name,
            onJob.map(({ snapshot }) => ({ name: text(snapshot?.packageName, "a package") })),
          )
        : null,
    );
  };
  /**
   * The package document behind a line on the job, when it is this job's own
   * one-off. A one-off saved to the Library is an ordinary package again, so
   * this reads the package, not the snapshot's copied `oneOff` flag.
   */
  const oneOffBehind = (snapshot: Row | undefined): Row | null => {
    const record = (packages.records ?? []).find((item) => item.id === text(snapshot?.packageId)) as Row | undefined;
    return record && oneOffProjectId(record) === projectId ? record : null;
  };
  /**
   * Correct a one-off on this job — name, price, what's included, coverage.
   * The package and the job's copy of it change together, then the proposal
   * is priced again like any other package change here.
   */
  const editOneOff = (packageId: string, input: OneOffPackageInput, idempotencyKey: string) =>
    change(`edit-${packageId}`, async () => {
      await runCrmCommand(
        "updateOneOffPackage",
        {
          projectId,
          packageId,
          name: input.name,
          basePriceCents: input.basePriceCents,
          included: input.included,
          ...(input.includedCoverage ? { includedCoverage: input.includedCoverage } : {}),
          ...(input.includedCoverageMinutes ? { includedCoverageMinutes: input.includedCoverageMinutes } : {}),
        },
        { idempotencyKey },
      );
      setEditingFor(null);
      refreshTenantRecords("packages");
    });
  /**
   * Keep a one-off for other couples. It joins the Library as an ordinary
   * package, hidden from client pages until published. Nothing on this job's
   * price changes, so the proposal is not revised.
   */
  async function saveToLibrary(packageId: string, name: string) {
    if (
      !window.confirm(
        `Save ${name} to your Library? You'll be able to offer it to other couples. Clients won't see it on your client pages unless you publish it.`,
      )
    ) {
      return;
    }
    setBusy(`library-${packageId}`);
    setError(null);
    try {
      await runCrmCommand("saveOneOffToLibrary", { packageId });
      refreshTenantRecords("packages");
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The package couldn't be saved to your Library. Try again."));
    } finally {
      setBusy(null);
    }
  }
  const setExtras = (packageSnapshotId: string, lines: JobAddOnLine[]) => {
    const snapshot = snapshotById.get(packageSnapshotId);
    const kept = new Set(lines.map((line) => line.name));
    const dropped = extrasOf(snapshot).filter((name) => !kept.has(name));
    return change(`extras-${packageSnapshotId}`,
      async () => {
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
      },
      dropped.length
        ? `This takes ${dropped.join(", ")} off ${text(snapshot?.packageName, "the package")}, and the price comes down with it.`
        : null,
    );
  };
  const remove = (packageSnapshotId: string) => {
    const snapshot = snapshotById.get(packageSnapshotId);
    const extras = extrasOf(snapshot);
    return change(
      `remove-${packageSnapshotId}`,
      () => runCrmCommand("removePackage", { projectId, packageSnapshotId }),
      `This takes ${text(snapshot?.packageName, "the package")} (${money(cents(snapshot?.totalCents), text(snapshot?.currency, "USD"))}) off the job${
        extras.length ? `, with its extras: ${extras.join(", ")}` : ""
      }. Adding it back later starts it at today's price.`,
    );
  };
  const saveDiscount = (packageSnapshotId: string) => {
    const parsed = discountFromForm(discountKind, discountValue);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    return change(`discount-${packageSnapshotId}`, async () => {
      await runCrmCommand("setPackageDiscount", { projectId, packageSnapshotId, discount: parsed.rule });
      setDiscountFor(null);
    });
  };
  const openDiscount = (id: string, snapshot: Row | undefined) => {
    const rule = discountRuleOf(snapshot);
    setDiscountKind(rule.type === "none" ? "percentage" : rule.type);
    setDiscountValue(
      rule.type === "percentage" ? String(rule.basisPoints / 100) : rule.type === "fixed" ? (rule.amountCents / 100).toFixed(2) : "",
    );
    setDiscountFor(discountFor === id ? null : id);
  };

  return (
    <section className="proposal-packages-panel" aria-labelledby="proposal-packages-title">
      <div className="proposal-packages-heading">
        <div>
          {/* Not "Packages": the priced list above now carries that name. */}
          <p className="eyebrow">Change packages</p>
          <h2 id="proposal-packages-title">
            What they&apos;re booking
            <InfoHint label="What they're booking">
              {`Change packages freely until the agreement goes out. Once the ${offer} has been sent, a change becomes a new version for the couple to accept.`}
            </InfoHint>
          </h2>
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
      {/* "We should add a way to add custom stuff … engagement shoot, photo
          booth" — the Extras editor already did, behind a button labelled
          only "Extras" (GR, 2026-09-30). Say what it is for. */}
      {!agreementOut ? (
        <p className="proposal-packages-hint">
          {tradeOf(workspace.tenantTrade) === "photographer"
            ? "Engagement shoot, photo booth, an extra hour? Add them to a package with Add extras — from your library, or written just for this couple."
            : `${extraIdeasFor(workspace.tenantTrade)
                .slice(0, 2)
                .map((idea, index) => (index ? idea.name.toLowerCase() : idea.name))
                .join(", ")}? Add them to a package with Add extras — from your library, or written just for this client.`}
        </p>
      ) : null}
      <ul className="proposal-packages-list">
        {onJob.map(({ id, snapshot }, index) => {
          const oneOffPackage = oneOffBehind(snapshot);
          // The package decides once it has loaded: saved to the Library, the
          // line is no longer a one-off, whatever its snapshot copied.
          const isOneOff = oneOffPackage !== null || (packages.records == null && snapshot?.oneOff === true);
          return (
          <li key={id}>
            <span>
              <strong>
                {text(snapshot?.packageName, "Package")}
                {isOneOff ? <span className="one-off-tag">One-off</span> : null}
              </strong>
              <small>
                {money(cents(snapshot?.totalCents), text(snapshot?.currency, "USD"))}
                {index === 0 && onJob.length > 1 ? " · main package" : ""}
                {discountLabel(discountRuleOf(snapshot), text(snapshot?.currency, "USD"))
                  ? ` · ${discountLabel(discountRuleOf(snapshot), text(snapshot?.currency, "USD"))}`
                  : ""}
              </small>
            </span>
            {oneOffPackage && !agreementOut ? (
              <button
                aria-label={`Edit ${text(snapshot?.packageName, "this one-off package")}`}
                className="button button-light"
                disabled={busy !== null}
                onClick={() => setEditingFor(editingFor === id ? null : id)}
                type="button"
              >
                Edit
              </button>
            ) : null}
            {oneOffPackage ? (
              <button
                className="button button-light"
                disabled={busy !== null}
                onClick={() => void saveToLibrary(oneOffPackage.id, text(snapshot?.packageName, "this package"))}
                type="button"
              >
                {busy === `library-${oneOffPackage.id}` ? <LoaderCircle className="spin" size={14} /> : null}
                Save to my Library
              </button>
            ) : null}
            {agreementOut ? null : (
              <button
                className="button button-light"
                disabled={busy !== null}
                onClick={() => openDiscount(id, snapshot)}
                type="button"
              >
                Discount
              </button>
            )}
            {agreementOut ? null : (
              <button
                className="button button-light"
                disabled={busy !== null}
                onClick={() => setExtrasFor(extrasFor === id ? null : id)}
                type="button"
              >
                <Plus size={14} />
                {Array.isArray(snapshot?.addOns) && snapshot.addOns.length
                  ? `Extras (${snapshot.addOns.length})`
                  : "Add extras"}
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
            {discountFor === id ? (
              <div className="proposal-packages-picker proposal-packages-discount" role="group" aria-label={`Discount on ${text(snapshot?.packageName, "this package")}`}>
                <small>
                  {`A percentage stays a percentage when extras change; an amount stays that amount. The ${offer} is priced again.`}
                </small>
                <label className="proposal-field">
                  Discount
                  <select
                    onChange={(event) => setDiscountKind(event.target.value as "none" | "percentage" | "fixed")}
                    value={discountKind}
                  >
                    <option value="percentage">Percent off</option>
                    <option value="fixed">Amount off</option>
                    <option value="none">No discount</option>
                  </select>
                </label>
                {discountKind !== "none" ? (
                  <label className="proposal-field">
                    {discountKind === "percentage" ? "Percent" : "Amount"}
                    <input
                      inputMode="decimal"
                      onChange={(event) => setDiscountValue(event.target.value)}
                      placeholder={discountKind === "percentage" ? "10" : "250.00"}
                      value={discountValue}
                    />
                  </label>
                ) : null}
                <span>
                  <button className="button button-light" disabled={busy !== null} onClick={() => setDiscountFor(null)} type="button">
                    Cancel
                  </button>{" "}
                  <button
                    className="button button-dark"
                    disabled={busy !== null}
                    onClick={() => void saveDiscount(id)}
                    type="button"
                  >
                    {busy === `discount-${id}` ? <LoaderCircle className="spin" size={14} /> : null}
                    Save the discount
                  </button>
                </span>
              </div>
            ) : null}
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
            {editingFor === id && oneOffPackage && !agreementOut ? (
              <OneOffPackageForm
                busy={busy === `edit-${oneOffPackage.id}`}
                currency={text(snapshot?.currency, "USD")}
                defaultHours={
                  cents(snapshot?.includedCoverageMinutes) > 0
                    ? Math.round((cents(snapshot?.includedCoverageMinutes) / 60) * 10) / 10
                    : null
                }
                hasPackage
                initial={oneOffFormValuesFrom(oneOffPackage)}
                initialMode="add"
                record={oneOffPackage}
                key={`edit-${id}`}
                onCancel={() => setEditingFor(null)}
                onSubmit={(input, key) => void editOneOff(oneOffPackage.id, input, key)}
              />
            ) : null}
          </li>
          );
        })}
      </ul>
      {picking ? (
        <div className="proposal-packages-picker">
          <small>
            {picking === "add"
              ? `Choose a package to add. The ${offer} is priced again with both.`
              : discountLabel(discountRuleOf(onJob[0]?.snapshot))
                ? `Choose the package to use instead. Their discount (${discountLabel(discountRuleOf(onJob[0]?.snapshot), text(onJob[0]?.snapshot?.currency, "USD"))}) carries over.`
                : "Choose the package to use instead."}
          </small>
          {active.length === 0 ? (
            <small>Nothing in your Library yet. Write one just for this couple below, or add one in Library → Packages.</small>
          ) : null}
          {active.map((option) => (
            <article key={option.id}>
              <span>
                <strong>
                  {text(option.name, "Package")}
                  {isCataloguePackage(option) ? null : <span className="one-off-tag">One-off</span>}
                </strong>
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
          {writing ? (
            <OneOffPackageForm
              busy={busy === "one-off"}
              currency={text(onJob[0]?.snapshot?.currency, "USD")}
              defaultHours={
                cents(onJob[0]?.snapshot?.includedCoverageMinutes) > 0
                  ? Math.round((cents(onJob[0]?.snapshot?.includedCoverageMinutes) / 60) * 10) / 10
                  : null
              }
              hasPackage={onJob.length > 0}
              initialMode={picking}
              key={picking}
              onCancel={() => setWriting(false)}
              onSubmit={(input, key) => void writeOneOff(input, key)}
            />
          ) : (
            <button
              className="button button-light one-off-package-open"
              disabled={busy !== null}
              onClick={() => setWriting(true)}
              type="button"
            >
              <Plus size={14} /> Write a one-off package
            </button>
          )}
        </div>
      ) : null}
      {agreementOut ? (
        <small className="proposal-packages-note">
          The agreement has gone out for these packages. To change them, void it on the job&apos;s Booking tab first.
        </small>
      ) : sentToCouple ? (
        <small className="proposal-packages-note">
          {status === "accepted"
            ? `Any change here becomes a revised ${offer} for them to accept.`
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
