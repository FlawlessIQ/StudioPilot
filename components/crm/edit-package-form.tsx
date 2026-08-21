"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useTenantDocuments, refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import { formatCents } from "@/lib/format/money";

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

  const name = edits.name ?? String(record?.name ?? "");
  const basePrice =
    edits.basePrice ?? String(Number(record?.basePriceCents ?? 0) / 100);
  const mode = edits.mode ?? storedMode;
  const amount = edits.amount ?? String(storedAmount);
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
          Math.max(1, Number(record.includedPhotographers ?? 1));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await runCrmCommand("updatePackage", {
        packageId,
        name: name.trim(),
        basePriceCents: priceCents,
        retainerRule:
          mode === "percentage"
            ? { type: "percentage", basisPoints: Math.round(amountValue * 100) }
            : mode === "fixed"
              ? { type: "fixed", amountCents: Math.round(amountValue * 100) }
              : {
                  type: "per_crew_member",
                  amountPerCrewCents: Math.round(amountValue * 100),
                },
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
        </label>
        <label className="form-checkbox">
          <input
            checked={publicVisible}
            onChange={(event) => set("publicVisible", event.target.checked)}
            type="checkbox"
          />
          <span>Show this package to clients</span>
          <small>
            Off keeps it internal — it stays out of quotes and the client portal.
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
          <CheckCircle2 size={15} /> Saved. New proposals use these numbers;
          proposals already sent keep the price they were built with.
        </p>
      ) : null}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" size={16} /> : null}
        Save package
      </button>
    </form>
  );
}
