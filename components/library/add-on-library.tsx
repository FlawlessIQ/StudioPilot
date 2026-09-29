"use client";

import { useState } from "react";
import { Archive, CheckCircle2, LoaderCircle, Pencil, Plus } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { runCrmCommand } from "@/lib/crm/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

type Row = Record<string, unknown> & { id: string };
type Draft = {
  addOnId: string | null;
  name: string;
  description: string;
  price: string;
  taxable: boolean;
  allowQuantity: boolean;
};

const EMPTY: Draft = { addOnId: null, name: "", description: "", price: "", taxable: true, allowQuantity: false };
const text = (value: unknown) => (typeof value === "string" ? value : "");

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

/**
 * Library → Add-ons (H2, docs/proposal-agreement-and-addons-plan-2026-09-28.md).
 *
 * The extras a studio sells on top of a package — an engagement session, an
 * extra hour, a second shooter's hour, travel past the included area. Written
 * once here, suggested by the packages that fit, and chosen per job. A
 * package form used to hard-code "no add-ons", so none could exist.
 */
export function AddOnLibrary() {
  const workspace = useWorkspace();
  const canEdit = ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? ""));
  const { records, loading } = useTenantDocuments("addOns");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The studio's currency is the one its packages are priced in.
  const packages = useTenantDocuments("packages");
  const currency = text((packages.records ?? [])[0]?.currency) || "USD";

  const rows = ((records ?? []) as Row[])
    .filter((row) => !row.archivedAt)
    .sort((a, b) => text(a.name).localeCompare(text(b.name)));

  async function save(next: Draft, archived = false) {
    const cents = Math.round(Number(next.price) * 100);
    if (!archived && (!next.name.trim() || !Number.isFinite(cents) || cents < 0)) {
      setError("Give it a name and a price.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await runCrmCommand("saveAddOn", {
        addOnId: next.addOnId,
        name: next.name.trim(),
        description: next.description.trim(),
        unitPriceCents: Number.isFinite(cents) ? cents : 0,
        taxable: next.taxable,
        allowQuantity: next.allowQuantity,
        archived,
      });
      refreshTenantRecords("addOns");
      setDraft(null);
      setNotice(
        !outcome.persisted
          ? "Development preview — nothing was saved."
          : archived
            ? `${next.name} archived. Proposals that already have it keep it.`
            : `${next.name} saved.`,
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That add-on could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const editor = draft ? (
    <form
      className="crm-form add-on-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <div className="crm-form-grid">
        <label>
          Name
          <input
            autoFocus
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="e.g. Engagement session"
            required
            value={draft.name}
          />
        </label>
        <label>
          Price ({currency})
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            placeholder="450"
            required
            step="0.01"
            type="number"
            value={draft.price}
          />
        </label>
        <label className="form-span">
          What the couple gets <span className="field-hint">optional</span>
          <textarea
            maxLength={1000}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder="A one-hour session at a place that matters to you, 30 edited images."
            value={draft.description}
          />
        </label>
        <label className="form-checkbox">
          <input
            checked={draft.taxable}
            onChange={(event) => setDraft({ ...draft, taxable: event.target.checked })}
            type="checkbox"
          />
          <span>Charge tax on it</span>
        </label>
        <label className="form-checkbox">
          <input
            checked={draft.allowQuantity}
            onChange={(event) => setDraft({ ...draft, allowQuantity: event.target.checked })}
            type="checkbox"
          />
          <span>Sold by the unit (hours, prints) — pick how many</span>
        </label>
      </div>
      <footer className="add-on-editor-actions">
        <button className="button button-dark" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          Save add-on
        </button>
        <button className="button button-quiet" disabled={busy} onClick={() => setDraft(null)} type="button">
          Cancel
        </button>
      </footer>
    </form>
  ) : null;

  return (
    <section className="add-on-library">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {draft && !draft.addOnId ? editor : null}
      {loading && !records ? <p className="field-hint">Loading your add-ons…</p> : null}
      {!loading && rows.length === 0 && !draft ? (
        <p className="add-on-empty">
          No add-ons yet. Add the extras you sell on top of a package — then any package can suggest them, and you
          pick them per job.
        </p>
      ) : null}
      <ul className="add-on-list">
        {rows.map((row) =>
          draft?.addOnId === row.id ? (
            <li key={row.id}>{editor}</li>
          ) : (
            <li key={row.id}>
              <span>
                <strong>{text(row.name)}</strong>
                {text(row.description) ? <small>{text(row.description)}</small> : null}
                <small>
                  {money(Number(row.unitPriceCents ?? 0), currency)}
                  {row.allowQuantity ? " each" : ""}
                  {row.taxable === false ? " · no tax" : ""}
                </small>
              </span>
              {canEdit ? (
                <span className="add-on-row-actions">
                  <button
                    aria-label={`Edit ${text(row.name)}`}
                    className="button button-quiet button-sm"
                    onClick={() =>
                      setDraft({
                        addOnId: row.id,
                        name: text(row.name),
                        description: text(row.description),
                        price: (Number(row.unitPriceCents ?? 0) / 100).toString(),
                        taxable: row.taxable !== false,
                        allowQuantity: row.allowQuantity === true,
                      })
                    }
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} /> Edit
                  </button>
                  <button
                    aria-label={`Archive ${text(row.name)}`}
                    className="button button-quiet button-sm"
                    disabled={busy}
                    onClick={() =>
                      void save(
                        {
                          addOnId: row.id,
                          name: text(row.name),
                          description: text(row.description),
                          price: (Number(row.unitPriceCents ?? 0) / 100).toString(),
                          taxable: row.taxable !== false,
                          allowQuantity: row.allowQuantity === true,
                        },
                        true,
                      )
                    }
                    type="button"
                  >
                    <Archive aria-hidden="true" size={14} /> Archive
                  </button>
                </span>
              ) : null}
            </li>
          ),
        )}
      </ul>
      {canEdit && !draft ? (
        <button className="button button-dark" onClick={() => setDraft({ ...EMPTY })} type="button">
          <Plus size={16} /> New add-on
        </button>
      ) : null}
    </section>
  );
}
