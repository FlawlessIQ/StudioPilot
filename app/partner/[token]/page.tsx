import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { PARTNER_BOOST_AT, partnerEarnedCents, untilBoost } from "@/features/console/partners";
import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your StudioCue partner statement", robots: { index: false, follow: false } };

/**
 * A partner's own statement (docs/console.md, "Partners"): their code, their
 * link, how many studios have signed up with it and what that has earned. The
 * link is the only key (`saasPartnerLinks/{sha256(token)}`, issued from
 * Console → Partners); there is no account to make. Studios are shown by date
 * and status, not by name: a studio never agreed to share its subscription
 * with the vendor who referred it.
 */

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export default async function PartnerStatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await adminFirestore.doc(`saasPartnerLinks/${createHash("sha256").update(token).digest("hex")}`).get();
  const partnerId = link.get("partnerId") as string | undefined;
  const partner = partnerId ? await adminFirestore.doc(`saasPartners/${partnerId}`).get() : null;

  if (!partner?.exists || partner.get("active") === false) {
    return (
      <main className="ds-root legal-page" data-ds-theme="emerald">
        <header>
          <Link href="/"><Logo /></Link>
        </header>
        <article>
          <p className="eyebrow">Partner statement</p>
          <h1>This link doesn&apos;t work any more</h1>
          <p>Ask the StudioCue team for a new one.</p>
        </article>
      </main>
    );
  }

  const [referrals, payouts] = await Promise.all([
    adminFirestore.collection("saasReferrals").where("partnerId", "==", partnerId).limit(1000).get(),
    adminFirestore.collection("saasPartnerPayouts").where("partnerId", "==", partnerId).limit(1000).get(),
  ]);
  const studios = referrals.docs
    .map((doc) => ({ signedUpAt: (doc.get("signedUpAt") as string | null) ?? null, paidAt: (doc.get("paidAt") as string | null) ?? null }))
    .sort((a, b) => (b.signedUpAt ?? "").localeCompare(a.signedUpAt ?? ""));
  const paid = studios.filter((studio) => studio.paidAt).length;
  const earned = partnerEarnedCents(paid);
  const paidOut = Number(partner.get("paidOutCents") ?? 0);
  const owed = Math.max(0, earned - paidOut);
  const toGo = untilBoost(paid);
  const code = String(partner.get("code") ?? "");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const signup = `${appUrl}/auth/register?code=${encodeURIComponent(code)}`;
  const history = payouts.docs
    .map((doc) => ({ id: doc.id, amountCents: Number(doc.get("amountCents") ?? 0), paidOn: String(doc.get("paidOn") ?? "") }))
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn));

  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header>
        <Link href="/"><Logo /></Link>
      </header>
      <article>
        <p className="eyebrow">Partner statement</p>
        <h1>{`Hi ${String(partner.get("name") ?? "").split(" ")[0] || "there"}`}</h1>
        <p className="legal-lead">
          {"Photographers who sign up with your code get their first year of StudioCue for $900, half the $1,800 list price, after a free 14-day trial."}
        </p>

        <h2>Your code</h2>
        <p className="partner-statement-code">{code}</p>
        <p>
          {"Your sign-up link: "}
          <a href={signup}>{signup}</a>
        </p>

        <h2>So far</h2>
        <dl className="partner-statement-stats">
          <div><dt>Signed up</dt><dd>{studios.length}</dd></div>
          <div><dt>Paid</dt><dd>{paid}</dd></div>
          <div><dt>Earned</dt><dd>{money(earned)}</dd></div>
          <div><dt>Paid to you</dt><dd>{money(paidOut)}</dd></div>
          <div><dt>Still to come</dt><dd>{money(owed)}</dd></div>
        </dl>
        <p>
          {toGo
            ? `You earn $100 for each studio once its first annual payment clears. ${toGo} more and every studio you've brought in is worth $200, the first ${PARTNER_BOOST_AT} included.`
            : "You've passed ten paid studios: every one is worth $200, and each new one adds $200."}
        </p>

        <h2>Your studios</h2>
        {studios.length ? (
          <ul className="legal-list">
            {studios.map((studio, index) => (
              <li key={`${studio.signedUpAt}-${index}`}>
                {`Signed up ${day(studio.signedUpAt)} · ${studio.paidAt ? `paid ${day(studio.paidAt)}` : "in their trial, or not paid yet"}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nobody has signed up with your code yet. Studios show here, by date, as they do.</p>
        )}

        {history.length ? (
          <>
            <h2>Payments to you</h2>
            <ul className="legal-list">
              {history.map((payout) => (
                <li key={payout.id}>{`${money(payout.amountCents)} on ${day(payout.paidOn)}`}</li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="partner-statement-note">
          {"Questions about a payment? Email "}
          <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>
          {". Keep this link to yourself: anyone with it can see this page."}
        </p>
      </article>
    </main>
  );
}
