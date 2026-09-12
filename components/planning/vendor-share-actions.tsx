"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Link2, LoaderCircle } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { draftVendorShareMessage } from "@/features/schedules/vendor-share";
import { formatEventDate } from "@/lib/format/event-date";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Sharing the run of show with one external vendor.
 *
 * The link is the vendor's whole credential — no account — so this control
 * exists only in a project context (the run of show belongs to a project). The
 * message is drafted for the operator to edit and approve; nothing sends
 * without them. Persisted view/acknowledge status is read straight from
 * `scheduleShares` (the rules let a studio read it), so the studio can see
 * whether a vendor has opened the timeline without re-sending.
 */
type ShareStatus = {
  status: string;
  sharedVersion: number | null;
  viewedAt: string | null;
  acknowledgedAt: string | null;
  sendCount: number | null;
};

const num = (value: unknown): number | null =>
  typeof value === "number" ? value : null;
const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function statusLine(share: ShareStatus): string {
  const day = (iso: string | null) => (iso ? formatEventDate(iso) : "");
  switch (share.status) {
    case "acknowledged":
      return `✓ Confirmed${share.acknowledgedAt ? ` on ${day(share.acknowledgedAt)}` : ""}`;
    case "viewed":
      return `Viewed${share.viewedAt ? ` on ${day(share.viewedAt)}` : ""} — not confirmed yet`;
    case "revoked":
      return "Link revoked";
    default:
      return "Sent — not opened yet";
  }
}

export function VendorShareActions({
  vendor,
}: {
  vendor: { id: string; company: string; contactName: string; type: string };
}) {
  const params = useSearchParams();
  const projectId = params.get("project");
  const [share, setShare] = useState<ShareStatus | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<"vendor" | "full">("vendor");
  const [message, setMessage] = useState(() =>
    draftVendorShareMessage({
      vendorType: vendor.type,
      vendorContactName: vendor.contactName,
    }),
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { firestore } = getFirebaseClient();
        const snapshot = await getDocs(
          query(
            collection(firestore, "scheduleShares"),
            where("vendorContactId", "==", vendor.id),
            limit(20),
          ),
        );
        const doc = snapshot.docs
          .map((entry) => entry.data())
          .find((data) => data.projectId === projectId);
        if (!cancelled && doc) {
          setShare({
            status: String(doc.status ?? "sent"),
            sharedVersion: num(doc.sharedVersion),
            viewedAt: str(doc.viewedAt),
            acknowledgedAt: str(doc.acknowledgedAt),
            sendCount: num(doc.sendCount),
          });
        }
      } catch {
        // Status is a convenience; a read failure must not break the control.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, vendor.id]);

  if (!projectId) {
    return (
      <details className="ds-people-invite record-edit vendor-share">
        <summary>
          <Link2 aria-hidden="true" size={14} /> Share run of show
        </summary>
        <div>
          <p className="form-notice">
            Open this page from a project to share its run of show — the timeline
            belongs to a specific wedding. Pick a project first, then come back
            to Vendors.
          </p>
        </div>
      </details>
    );
  }

  async function createShare() {
    setBusy(true);
    setNotice(null);
    setCopied(false);
    try {
      const response = await sendPlanningCommand("shareRunOfShow", {
        projectId,
        vendorContactId: vendor.id,
        scope,
        message,
      });
      const result = response.result as Record<string, unknown>;
      const url = str(result.shareUrl);
      if (url) {
        setLink(url);
        setNotice("Link ready — copy it and send it to the vendor.");
      } else {
        setNotice(
          "Preview mode: connect the planning functions to generate a real link.",
        );
      }
      setShare({
        status: "sent",
        sharedVersion: num(result.sharedVersion),
        viewedAt: null,
        acknowledgedAt: null,
        sendCount: num(result.sendCount),
      });
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That run of show could not be shared."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setNotice(null);
    try {
      await sendPlanningCommand("revokeRunOfShowShare", {
        projectId,
        vendorContactId: vendor.id,
      });
      setShare((prior) =>
        prior
          ? { ...prior, status: "revoked" }
          : {
              status: "revoked",
              sharedVersion: null,
              viewedAt: null,
              acknowledgedAt: null,
              sendCount: null,
            },
      );
      setLink(null);
      setNotice("Revoked — the vendor's link no longer opens.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That share could not be revoked."));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const active = share && share.status !== "revoked";

  return (
    <details className="ds-people-invite record-edit vendor-share">
      <summary>
        <Link2 aria-hidden="true" size={14} /> Share run of show
        {active ? <span className="vendor-share-dot" aria-hidden="true" /> : null}
      </summary>
      <div>
        {share ? (
          <p
            className={`vendor-share-status vendor-share-status-${share.status}`}
            role="status"
          >
            {statusLine(share)}
            {share.sharedVersion ? ` · v${share.sharedVersion}` : ""}
          </p>
        ) : null}

        <label>
          What to share
          <select
            value={scope}
            onChange={(event) =>
              setScope(event.target.value === "full" ? "full" : "vendor")
            }
          >
            <option value="vendor">
              Their segments only (recommended)
            </option>
            <option value="full">The full timeline</option>
          </select>
        </label>

        <label className="record-edit-span">
          Message to the vendor
          <textarea
            maxLength={4000}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            value={message}
          />
        </label>

        <button
          className="button button-dark"
          disabled={busy}
          onClick={() => void createShare()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {share ? "Update & get new link" : "Create share link"}
        </button>

        {link ? (
          <div className="vendor-share-link">
            <input readOnly value={link} />
            <button
              className="button"
              onClick={() => void copyLink()}
              type="button"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}

        {active ? (
          <button
            className="text-link vendor-share-revoke"
            disabled={busy}
            onClick={() => void revoke()}
            type="button"
          >
            Revoke this link
          </button>
        ) : null}

        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
