"use client";

import { useEffect, useState } from "react";
import { Copy, Gift } from "lucide-react";
import { REFERRAL_CREDIT_CENTS } from "@/features/subscriptions/referral-program";
import { billingCommand } from "@/lib/billing/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

type ReferralState = "trial" | "paying" | "credited" | "canceled";
type Status = {
  code: string;
  link: string;
  offer: string;
  creditCents: number;
  referrals: Array<{ signedUpAt: string | null; via: string; state: ReferralState }>;
  creditedCents: number;
  pendingCents: number;
  vendorInvites: { enabled: boolean; sent: number };
};

const STATE_LABEL: Record<ReferralState, string> = {
  trial: "In their free trial",
  paying: "Paying: your credit is added next quarter",
  credited: "Credited",
  canceled: "Canceled before the credit",
};
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * Refer a studio (saas/referrals.ts): the studio's own code and link, what a
 * friend gets, what the studio has earned, and whether the vendors on its jobs
 * are invited. Owners only, like the rest of billing.
 */
export function ReferralCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    billingCommand<Status>("referralStatus")
      .then((result) => {
        if (!active) return;
        if (result) setStatus(result);
        else setNotice("Development preview: your referral code shows here once billing is connected.");
      })
      .catch((caught: unknown) => active && setNotice(friendlyError(caught, "Your referral code could not be loaded.")));
    return () => {
      active = false;
    };
  }, []);

  const copy = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Copy didn't work here. Select the link and copy it yourself.");
    }
  };

  const toggleInvites = async (enabled: boolean) => {
    if (!status) return;
    setSaving(true);
    try {
      await billingCommand("setVendorInvites", { enabled });
      setStatus({ ...status, vendorInvites: { ...status.vendorInvites, enabled } });
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That setting could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel referral-card" aria-labelledby="referral-heading">
      <div className="referral-card-head">
        <Gift aria-hidden="true" />
        <span>
          <h2 id="referral-heading">Refer a studio, get {dollars(REFERRAL_CREDIT_CENTS)}</h2>
          <p>
            {status
              ? `Studios that sign up with your code get ${status.offer}. You get ${dollars(status.creditCents)} off your StudioCue bill for each one that pays, added every quarter.`
              : `Studios that sign up with your code get up to half off their first year. You get ${dollars(REFERRAL_CREDIT_CENTS)} off your bill for each one that pays.`}
          </p>
        </span>
      </div>
      {status ? (
        <>
          <div className="referral-code-row">
            <span>
              <small>Your code</small>
              <strong>{status.code}</strong>
            </span>
            <span className="referral-link">
              <small>Your link</small>
              <code>{status.link}</code>
            </span>
            <button className="button" type="button" onClick={() => void copy()}>
              <Copy size={16} aria-hidden="true" /> {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <dl className="referral-stats">
            <div><dt>Signed up</dt><dd>{status.referrals.length}</dd></div>
            <div><dt>Credit on its way</dt><dd>{dollars(status.pendingCents)}</dd></div>
            <div><dt>Credited so far</dt><dd>{dollars(status.creditedCents)}</dd></div>
          </dl>
          {status.referrals.length ? (
            <ul className="referral-list">
              {status.referrals.map((referral, index) => (
                <li key={`${referral.signedUpAt}-${index}`}>
                  <span>{`Signed up ${day(referral.signedUpAt)}${referral.via === "vendor_invite" ? " from a vendor invite" : ""}`}</span>
                  <small>{STATE_LABEL[referral.state]}</small>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="referral-invites">
            <input
              checked={status.vendorInvites.enabled}
              disabled={saving}
              onChange={(event) => void toggleInvites(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Invite the vendors on my jobs</strong>
              <small>
                {`Once a job is booked, its planner, DJ, florist, hair and makeup and other vendors get one email from StudioCue with your code. Never venues, and never anyone twice. ${status.vendorInvites.sent} invited so far.`}
              </small>
            </span>
          </label>
        </>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
