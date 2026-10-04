"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, Clock3 } from "lucide-react";
import type { SubscriptionAccess } from "@/features/subscriptions/access";
import { billingNotice } from "@/features/subscriptions/billing-notice";

const DISMISS_KEY = "studiohub.trialNoticeDismissed";

export function BillingBanner({
  access,
  isOwner,
}: {
  access: SubscriptionAccess | null | undefined;
  isOwner: boolean;
}) {
  const notice = billingNotice(access, isOwner);
  // Read once, on the client: billing state only arrives after the workspace
  // loads, so this never renders on the server.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === new Date().toDateString();
    } catch {
      return false; // Storage blocked: the reminder simply shows.
    }
  });
  if (!notice || (notice.dismissible && dismissed)) return null;
  const Icon = notice.tone === "bad" ? CircleAlert : Clock3;
  return (
    <div className={`ds-billing-banner is-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
      <span className="ds-alert-ico">
        <Icon size={18} />
      </span>
      <div className="ds-alert-copy">
        <strong>{notice.title}</strong>
        <small>{notice.body}</small>
      </div>
      <div className="ds-billing-banner-actions">
        {notice.action === "manage" ? (
          <Link className="ds-btn ds-btn-sm ds-btn-primary" href="/studio/subscription">
            Plan &amp; billing
          </Link>
        ) : null}
        {notice.dismissible ? (
          <button
            className="ds-btn ds-btn-ghost ds-btn-sm"
            onClick={() => {
              setDismissed(true);
              try {
                window.localStorage.setItem(DISMISS_KEY, new Date().toDateString());
              } catch {
                // Not remembered; it hides for this visit.
              }
            }}
            type="button"
          >
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
