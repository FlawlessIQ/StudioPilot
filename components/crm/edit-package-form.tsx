"use client";

import {
  billedRolesFrom,
  coverageFrom,
} from "@/components/crm/package-coverage-fields";
import { coverageCount, coverageRoleLabel, resolveCoverage, type CoverageRole } from "@/features/packages/coverage";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { billedCrewCount } from "@/features/packages/create-snapshot";
import { perCrewRetainerProblem } from "@/features/packages/retainer-check";
import { useState } from "react";
import {
  isPaymentShape,
  jobKindOf,
  journeyProfile,
  PAYMENT_SHAPE_LABELS,
  PAYMENT_SHAPES,
  type PaymentShape,
} from "@/features/job-kinds/job-kinds";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useTenantDocuments, refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import { formatCents } from "@/lib/format/money";
import {
  PackageDeliverablesEditor,
  type EditableDeliverable,
} from "@/components/crm/package-deliverables-editor";
import { PackageAddOnPicker } from "@/components/crm/package-add-on-picker";
import { expectedDeliverables } from "@/features/post-event/deliverables";

type RetainerMode = "percentage" | "fixed" | "per_crew_member";

/**
 * Correct an existing package.
 *
 * Packages could be created and never edited, which mattered most for
 * imported ones: a price list rarely states a retainer or says whether the
 * pricing may be shown to clients, so every imported package arrived with a
 * zero deposit and hidden from clients, permanently.
 */
export function EditPackageForm({ packageId }: { packageId: string }) {
  // The studio's own crew roles and whether it delivers anything (trades.ts).
  const trade = useWorkspace().tenantTrade;
  const tradeShape = tradeProfile(trade);
  // What a package is offered in: a photographer's or a DJ's proposal, a
  // makeup artist's or hair stylist's quote (trades.ts).
  const offer = tradeVocab(trade).proposal.toLowerCase();
  const roles = tradeShape.coverageRoles as readonly CoverageRole[];
  const router = useRouter();
  const { records, loading } = useTenantDocuments("packages");
  const record = (records ?? []).find((row) => row.id === packageId);

  // Each field holds null until it is edited, and falls back to the stored
  // package. No copying-into-state effect, so the form cannot show a stale
  // value while the record is still loading.
  const [edits, setEdits] = useState<{
    name?: string;
    basePrice?: string;
    mode?: RetainerMode;
    amount?: string;
    publicVisible?: boolean;
    active?: boolean;
    photographers?: string;
    videographers?: string;
    billPhotographers?: boolean;
    billVideographers?: boolean;
    deliverables?: EditableDeliverable[];
    addOnIds?: string[];
    description?: string;
    terms?: string;
    paymentShape?: PaymentShape;
  }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rule = (record?.retainerRule ?? {}) as Record<string, unknown>;
  const storedMode = String(rule.type ?? "percentage") as RetainerMode;
  const storedAmount =
    storedMode === "percentage"
      ? Number(rule.basisPoints ?? 0) / 100
      : storedMode === "fixed"
        ? Number(rule.amountCents ?? 0) / 100
        : Number(rule.amountPerCrewCents ?? 0) / 100;

  /**
   * The package's coverage, from whichever shape it was written in. A package
   * imported before roles existed reads as photographers only, and gains the
   * new field the moment this form saves it.
   */
  const storedCoverage = resolveCoverage(record);
  const storedBilledRoles = Array.isArray(rule.billedRoles)
    ? (rule.billedRoles as string[])
    : null;

  // How jobs on this package are paid (job-kinds.ts): stored, else the
  // usual way for the package's kind of job.
  const paymentShape: PaymentShape =
    edits.paymentShape ??
    (isPaymentShape(record?.paymentShape)
      ? record.paymentShape
      : journeyProfile(jobKindOf({ eventTypeId: record?.eventTypeId, eventType: record?.eventTypeLabel })).payment);
  const hasDeposit = paymentShape === "deposit_and_balance";
  const name = edits.name ?? String(record?.name ?? "");
  const description = edits.description ?? String(record?.description ?? "");
  const terms = edits.terms ?? String(record?.terms ?? "");
  const basePrice =
    edits.basePrice ?? String(Number(record?.basePriceCents ?? 0) / 100);
  const mode = edits.mode ?? storedMode;
  const amount = edits.amount ?? String(storedAmount);
  const photographers =
    edits.photographers ??
    String(coverageCount(storedCoverage, roles[0] ?? "photographer"));
  const videographers =
    edits.videographers ??
    String(roles[1] ? coverageCount(storedCoverage, roles[1]) : 0);
  // A stored per-crew rule shows what it bills: its roles, or — with none
  // named — photographers, which is what it meant before roles existed.
  // A package switching to per-crew starts on everyone it sends: ticking
  // photographers alone made GR's two-videographer package charge "per
  // photographer" for nobody (features/packages/retainer-check.ts).
  const storedPerCrew = storedMode === "per_crew_member";
  const billPhotographers =
    edits.billPhotographers ??
    (storedPerCrew
      ? storedBilledRoles ? storedBilledRoles.includes(roles[0] ?? "photographer") : true
      : Number(photographers || 0) > 0);
  const billVideographers =
    edits.billVideographers ??
    (storedPerCrew
      ? storedBilledRoles && roles[1] ? storedBilledRoles.includes(roles[1]) : false
      : Number(videographers || 0) > 0);
  // Stored when the studio has set them; until then, what the package's
  // coverage and wording imply — the same list a job would get.
  const deliverables: EditableDeliverable[] =
    edits.deliverables ??
    expectedDeliverables({
      deliverables: record?.deliverables,
      includedDeliverables: record?.includedDeliverables,
      coverage: {
        photographers: Math.max(0, Math.round(Number(photographers || 0))),
        videographers: Math.max(0, Math.round(Number(videographers || 0))),
      },
    }).map(({ kind, label, turnaroundDays, final }) => ({ kind, label, turnaroundDays, final }));
  const addOnIds =
    edits.addOnIds ??
    (Array.isArray(record?.addOns) ? (record.addOns as Array<{ id?: unknown }>).map((item) => String(item.id ?? "")) : []);
  const publicVisible = edits.publicVisible ?? record?.publicVisible !== false;
  const active = edits.active ?? record?.active !== false;
  const set = <K extends keyof typeof edits>(
    key: K,
    value: (typeof edits)[K],
  ) => setEdits((current) => ({ ...current, [key]: value }));

  if (loading && !record)
    return <p className="form-notice">Loading the package…</p>;
  if (!record)
    return (
      <p className="form-notice">
        That package could not be found.{" "}
        <Link href="/studio/packages">Back to packages</Link>
      </p>
    );

  const priceCents = Math.round(Number(basePrice || 0) * 100);
  const amountValue = Number(amount || 0);
  // What the client will actually be asked for, shown as you type — the
  // number that matters is the deposit, not the rule that produced it.
  const retainerPreview =
    mode === "percentage"
      ? Math.round((priceCents * Math.round(amountValue * 100)) / 10_000)
      : mode === "fixed"
        ? Math.round(amountValue * 100)
        : Math.round(amountValue * 100) *
          billedCrewCount(
            coverageFrom({
              photographers: Math.max(0, Math.round(Number(photographers || 0))),
              videographers: Math.max(0, Math.round(Number(videographers || 0))),
            }, roles),
            billedRolesFrom({ billPhotographers, billVideographers }, roles),
          );

  const perCrewProblem =
    hasDeposit && mode === "per_crew_member"
      ? perCrewRetainerProblem({
          coverage: coverageFrom({
            photographers: Math.max(0, Math.round(Number(photographers || 0))),
            videographers: Math.max(0, Math.round(Number(videographers || 0))),
          }, roles),
          billedRoles: billedRolesFrom({ billPhotographers, billVideographers }, roles),
        })
      : null;

  async function save() {
    const crew =
      Math.max(0, Math.round(Number(photographers || 0))) +
      Math.max(0, Math.round(Number(videographers || 0)));
    if (crew < 1) {
      setError("A package includes at least one person.");
      return;
    }
    if (mode === "per_crew_member" && !billPhotographers && !billVideographers) {
      setError("Choose at least one role the retainer charges for.");
      return;
    }
    if (perCrewProblem) {
      setError(perCrewProblem);
      return;
    }
    if (edits.description !== undefined && description.trim().length < 10) {
      setError("Say what the package includes — at least a line.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await runCrmCommand("updatePackage", {
        packageId,
        name: name.trim(),
        basePriceCents: priceCents,
        paymentShape,
        retainerRule:
          paymentShape === "paid_in_full"
            ? { type: "percentage", basisPoints: 10000 }
            : !hasDeposit
              ? { type: "fixed", amountCents: 0 }
              : mode === "percentage"
            ? { type: "percentage", basisPoints: Math.round(amountValue * 100) }
            : mode === "fixed"
              ? { type: "fixed", amountCents: Math.round(amountValue * 100) }
              : {
                  type: "per_crew_member",
                  amountPerCrewCents: Math.round(amountValue * 100),
                  billedRoles: billedRolesFrom({
                    billPhotographers,
                    billVideographers,
                  }),
                },
        includedCoverage: coverageFrom({
          photographers: Math.max(0, Math.round(Number(photographers || 0))),
          videographers: Math.max(0, Math.round(Number(videographers || 0))),
        }, roles),
        deliverables: deliverables.map((item) => ({
          kind: item.kind,
          label: item.label,
          turnaroundDays: item.turnaroundDays ?? 0,
          final: item.final,
        })),
        // Only when changed: an untouched list is left exactly as stored.
        ...(edits.addOnIds ? { addOnIds: edits.addOnIds } : {}),
        ...(edits.description !== undefined ? { description: description.trim() } : {}),
        ...(edits.terms !== undefined ? { terms: terms.trim() } : {}),
        active,
        publicVisible,
      });
      refreshTenantRecords("packages");
      setSaved(true);
      router.refresh();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The package could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="crm-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="crm-form-grid">
        <label className="form-span">
          Package name
          <input onChange={(event) => set("name", event.target.value)} value={name} />
        </label>
        {/* It could be written only when the package was made. GR asked to
            turn a paragraph into bullets and had nowhere to do it
            (2026-09-30). Each line is a bullet on the proposal. */}
        <label className="form-span">
          What&apos;s included
          <textarea
            onChange={(event) => set("description", event.target.value)}
            rows={8}
            value={description}
          />
          <small>
            {`One item per line — each line is a bullet on the ${offer}. A paragraph is split at its sentences.`}
          </small>
        </label>
        <label className="form-span">
          Terms
          <textarea
            onChange={(event) => set("terms", event.target.value)}
            rows={3}
            value={terms}
          />
          <small>
            {`Shown on the ${offer} as its terms summary. Leave it empty and ${offer}s use standard wording you can change on each one.`}
          </small>
        </label>
        <label>
          Price (USD)
          <input
            min="0"
            onChange={(event) => set("basePrice", event.target.value)}
            step="0.01"
            type="number"
            value={basePrice}
          />
        </label>
        <label>
          How it&rsquo;s paid
          <select
            onChange={(event) => set("paymentShape", event.target.value as PaymentShape)}
            value={paymentShape}
          >
            {PAYMENT_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {PAYMENT_SHAPE_LABELS[shape]}
              </option>
            ))}
          </select>
          <small>
            {paymentShape === "paid_in_full"
              ? `Clients pay ${formatCents(priceCents)} to book.`
              : paymentShape === "on_the_day"
                ? "Nothing to book; the invoice is due on the day."
                : paymentShape === "invoice_after"
                  ? "Nothing to book; invoiced after the event."
                  : "A deposit to book, the balance before the day."}
          </small>
        </label>
        {hasDeposit ? (
        <>
        <label>
          Retainer type
          <select
            onChange={(event) => set("mode", event.target.value as RetainerMode)}
            value={mode}
          >
            <option value="percentage">Percent of total</option>
            <option value="fixed">Fixed amount</option>
            <option value="per_crew_member">Per crew member</option>
          </select>
        </label>
        <label>
          {mode === "percentage"
            ? "Retainer percent"
            : mode === "fixed"
              ? "Retainer amount (USD)"
              : "Amount per crew member (USD)"}
          <input
            min="0"
            onChange={(event) => set("amount", event.target.value)}
            step="0.01"
            type="number"
            value={amount}
          />
          <small>Clients are asked for {formatCents(retainerPreview)}.</small>
          {perCrewProblem ? (
            <small className="form-error" role="alert">
              {perCrewProblem}
            </small>
          ) : null}
        </label>
        {mode === "per_crew_member" ? (
          <>
            <label className="form-checkbox">
              <input
                checked={billPhotographers}
                onChange={(event) =>
                  set("billPhotographers", event.target.checked)
                }
                type="checkbox"
              />
              <span>{`Charge this per ${coverageRoleLabel(roles[0] ?? "photographer", 1)}`}</span>
            </label>
            {roles[1] ? (
              <label className="form-checkbox">
                <input
                  checked={billVideographers}
                  onChange={(event) =>
                    set("billVideographers", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{`Charge this per ${coverageRoleLabel(roles[1], 1)}`}</span>
              </label>
            ) : null}
          </>
        ) : null}
        </>
        ) : null}
        <label>
          {roleHeading(roles[0])}
          <input
            min="0"
            onChange={(event) => set("photographers", event.target.value)}
            type="number"
            value={photographers}
          />
        </label>
        {roles[1] ? (
          <label>
            {roleHeading(roles[1])}
            <input
              min="0"
              onChange={(event) => set("videographers", event.target.value)}
              type="number"
              value={videographers}
            />
          </label>
        ) : null}
        <p className="field-hint form-span">
          {roles[1] ? "Who your studio sends. At least one, in either row." : "Who your studio sends. At least one."}
        </p>
        {/* Nothing is delivered after a DJ's night (trades.ts): no gallery or film to list. */}
        {tradeShape.delivery ? (
          <PackageDeliverablesEditor onChange={(next) => set("deliverables", next)} value={deliverables} />
        ) : null}
        <PackageAddOnPicker
          currency={String(record?.currency ?? "USD")}
          onChange={(next) => set("addOnIds", next)}
          value={addOnIds}
        />
        <label className="form-checkbox">
          <input
            checked={publicVisible}
            onChange={(event) => set("publicVisible", event.target.checked)}
            type="checkbox"
          />
          <span>Show this package to clients</span>
          <small>
            Off keeps couples from choosing or asking for it in their portal,
            and keeps it out of drafted replies. You can still put it in a{" "}
            {`${offer} yourself.`}
          </small>
        </label>
        <label className="form-checkbox">
          <input
            checked={active}
            onChange={(event) => set("active", event.target.checked)}
            type="checkbox"
          />
          <span>Available to book</span>
          <small>Off retires it without deleting past bookings.</small>
        </label>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="form-notice" role="status">
          <CheckCircle2 size={15} />{" "}
          {`Saved. New ${offer}s use these numbers; ${offer}s already sent keep the price they were built with.`}
        </p>
      ) : null}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" size={16} /> : null}
        Save package
      </button>
    </form>
  );
}

/** "Photographers", "DJs": a count's heading. */
function roleHeading(role: CoverageRole | undefined): string {
  const label = coverageRoleLabel(role ?? "photographer", 2);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
