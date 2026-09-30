"use client";

import { useState } from "react";
import { Check, Copy, LoaderCircle, Send } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

type Refreshed = { vendorContactId: string; company: string; emailed: boolean; shareUrl: string | null };

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * "Your vendors have the old timeline" — and one button that fixes it.
 *
 * Republishing tells the crew and resets their acknowledgements, but a vendor
 * share is pinned to the version it was made from, so the planner and the
 * venue went on reading the timeline the studio had just replaced. This shows
 * whenever any share on the job is behind the current version, and re-shares
 * all of them through `refreshRunOfShowShares`: a fresh link each, emailed to
 * the vendors with an address, handed back for the rest. Renders nothing when
 * every vendor is current.
 */
export function VendorReshareBanner({ projectId }: { projectId: string }) {
  const { records: shares } = useTenantDocuments("scheduleShares");
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: vendors } = useTenantDocuments("vendors");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<Refreshed[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const current = (schedules ?? [])
    .filter((schedule) => schedule.projectId === projectId)
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const archived = new Set((vendors ?? []).filter((vendor) => vendor.archivedAt).map((vendor) => vendor.id));
  const stale =
    current && current.status === "published"
      ? (shares ?? []).filter(
          (share) =>
            share.projectId === projectId &&
            text(share.status) !== "revoked" &&
            !share.revokedAt &&
            text(share.scheduleId) &&
            share.scheduleId !== current.id &&
            !archived.has(text(share.vendorContactId)),
        )
      : [];

  async function reshare() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("refreshRunOfShowShares", { projectId, message: message.trim() });
      if (!response.persisted) {
        setNotice("Preview mode: nothing was sent.");
        return;
      }
      const result = response.result as { refreshed?: Refreshed[] };
      setRefreshed(result.refreshed ?? []);
      refreshTenantRecords("scheduleShares");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The new timeline could not be shared."));
    } finally {
      setBusy(false);
    }
  }

  if (refreshed) {
    const handOver = refreshed.filter((entry) => entry.shareUrl);
    return (
      <section className="panel focused-tool-link" aria-label="Vendors re-shared">
        <div>
          <p className="eyebrow">Run of show</p>
          <h2>Vendors have version {Number(current?.version ?? 0)}</h2>
          <p>
            {refreshed.filter((entry) => entry.emailed).map((entry) => entry.company || "A vendor").join(", ") ||
              "Nobody"}{" "}
            {refreshed.some((entry) => entry.emailed) ? "were emailed their new link." : "was emailed."}
            {handOver.length ? " These have no email address on file, so send them their link yourself:" : ""}
          </p>
          {handOver.map((entry) => (
            <div className="vendor-share-link" key={entry.vendorContactId}>
              <input aria-label={`${entry.company} link`} readOnly value={entry.shareUrl ?? ""} />
              <button
                className="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(entry.shareUrl ?? "");
                  setCopied(entry.vendorContactId);
                }}
                type="button"
              >
                {copied === entry.vendorContactId ? <Check size={14} /> : <Copy size={14} />}
                {copied === entry.vendorContactId ? "Copied" : `Copy ${entry.company || "link"}`}
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!stale.length) return null;
  const names = stale.map((share) => text(share.vendorCompany) || "a vendor");
  return (
    <section className="panel focused-tool-link" aria-label="Vendors with an older timeline">
      <div>
        <p className="eyebrow">Run of show</p>
        <h2>
          {`${stale.length === 1 ? "1 vendor has" : `${stale.length} vendors have`} an older timeline`}
        </h2>
        <p>
          {names.join(", ")} {stale.length === 1 ? "is" : "are"} still on the version before {Number(current?.version ?? 0)}. Their
          links keep showing that one until you share this one. Each gets a fresh link; their old one stops opening.
        </p>
        <label className="record-edit-span">
          A note with it (optional)
          <textarea
            maxLength={4000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="The ceremony moved to 4:30 — everything after it shifts by half an hour."
            rows={2}
            value={message}
          />
        </label>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      <button className="button button-dark" disabled={busy} onClick={() => void reshare()} type="button">
        {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
        Re-share the new timeline to {stale.length === 1 ? "1 vendor" : `${stale.length} vendors`}
      </button>
    </section>
  );
}
