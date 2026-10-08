"use client";

import { useMemo } from "react";
import Link from "next/link";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { OFFER_SUMMARY, REFERRAL_CREDIT_CENTS } from "@/features/subscriptions/referral-program";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { Empty, Notice, PageHead, Panel, Pill, Stat, StatStrip } from "../ui";

/**
 * Referrals (docs/console.md, "Referrals"): every studio's code, who signed up
 * with one, and the one-off $100 credits, each paid once the new studio has
 * been paying for three months (saas/referrals.ts). It
 * replaces Partners (2026-10-07), so there is nothing to run here: codes are
 * made for every studio, credits go on by themselves, and vendor invites send
 * themselves. This page is where to check they did.
 */

type Referral = {
  id: string;
  tenantId: string;
  studioName?: string | null;
  referrerTenantId: string;
  referrerName?: string | null;
  code?: string;
  via?: string | null;
  status?: string;
  signedUpAt?: string | null;
  paidAt?: string | null;
  creditedAt?: string | null;
  forfeitedAt?: string | null;
};
type Credit = { id: string; referrerTenantId: string; referredTenantId: string; amountCents: number; createdAt: string };
type Invite = { id: string; tenantId: string; vendorType?: string; createdAt: string; signedUpTenantId?: string | null };

type State = "trial" | "paying" | "credited" | "forfeited";
const STATE_LABEL: Record<State, string> = { trial: "In trial", paying: "Paying, credit at 3 months", credited: "Credited", forfeited: "Canceled, no credit" };
const STATE_TONE = { trial: "info", paying: "warn", credited: "ok", forfeited: "neutral" } as const;
const stateOf = (row: Referral): State => (row.creditedAt ? "credited" : row.forfeitedAt ? "forfeited" : row.paidAt ? "paying" : "trial");

export function ReferralsPage() {
  const { studios } = useConsole();
  const now = useNow();
  const referrals = useLiveQuery<Referral>("console:referrals", (firestore) => query(collection(firestore, "saasReferrals"), limit(10000)));
  const credits = useLiveQuery<Credit>("console:referral-credits", (firestore) => query(collection(firestore, "saasReferralCredits"), limit(5000)));
  const invites = useLiveQuery<Invite>("console:vendor-invites", (firestore) => query(collection(firestore, "vendorInvites"), limit(10000)));
  const names = useMemo(() => new Map((studios.rows ?? []).map((studio) => [studio.tenantId, studio.name])), [studios.rows]);
  const rows = referrals.rows ?? [];
  const paying = rows.filter((row) => stateOf(row) === "paying").length;
  const creditedCents = (credits.rows ?? []).reduce((sum, credit) => sum + Number(credit.amountCents ?? 0), 0);
  const invited = invites.rows ?? [];
  const inviteSignups = invited.filter((invite) => invite.signedUpTenantId).length;

  const byStudio = useMemo(() => {
    const counts = new Map<string, { invites: number; referrals: number }>();
    for (const invite of invited) counts.set(invite.tenantId, { invites: (counts.get(invite.tenantId)?.invites ?? 0) + 1, referrals: counts.get(invite.tenantId)?.referrals ?? 0 });
    for (const row of rows) counts.set(row.referrerTenantId, { invites: counts.get(row.referrerTenantId)?.invites ?? 0, referrals: (counts.get(row.referrerTenantId)?.referrals ?? 0) + 1 });
    return [...counts.entries()].sort((a, b) => b[1].referrals - a[1].referrals || b[1].invites - a[1].invites).slice(0, 10);
  }, [invited, rows]);

  const columns = useMemo<ColumnDef<Referral, unknown>[]>(
    () => [
      {
        id: "studio",
        header: "Studio",
        accessorFn: (row) => names.get(row.tenantId) ?? row.studioName ?? row.tenantId,
        meta: { width: 200, flex: true },
        cell: ({ row }) => <Link className="cx-link" href={studioHref(row.original.tenantId)}>{names.get(row.original.tenantId) ?? row.original.studioName ?? row.original.tenantId}</Link>,
      },
      {
        id: "referrer",
        header: "Referred by",
        accessorFn: (row) => names.get(row.referrerTenantId) ?? row.referrerName ?? "",
        meta: { width: 200 },
        cell: ({ row }) => (
          <span>
            <Link className="cx-link" href={studioHref(row.original.referrerTenantId)}>{names.get(row.original.referrerTenantId) ?? row.original.referrerName ?? row.original.referrerTenantId}</Link>
            {row.original.via === "vendor_invite" ? <span className="cx-sub">{" · vendor invite"}</span> : null}
          </span>
        ),
      },
      { id: "signed", header: "Signed up", accessorFn: (row) => row.signedUpAt ?? "", meta: { width: 110, priority: 2 }, cell: ({ row }) => shortDate(row.original.signedUpAt ?? null, now) },
      { id: "paid", header: "First paid", accessorFn: (row) => row.paidAt ?? "", meta: { width: 110, priority: 3 }, cell: ({ row }) => (row.original.paidAt ? shortDate(row.original.paidAt, now) : "—") },
      {
        id: "state",
        header: "Credit",
        accessorFn: (row) => stateOf(row),
        meta: { width: 170 },
        cell: ({ row }) => <Pill tone={STATE_TONE[stateOf(row.original)]}>{stateOf(row.original) === "credited" && row.original.creditedAt ? `Credited ${shortDate(row.original.creditedAt, now)}` : STATE_LABEL[stateOf(row.original)]}</Pill>,
      },
    ],
    [names, now],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Grow" }, { label: "Referrals" }]} />
      <div className="cx-content">
        <PageHead title="Referrals">
          <StatStrip>
            <Stat label="Referred studios" value={rows.length} />
            <Stat label="Credit still to come" tone={paying ? "warn" : undefined} value={money(paying * REFERRAL_CREDIT_CENTS)} />
            <Stat label="Credited so far" tone={creditedCents ? "ok" : undefined} value={money(creditedCents)} />
            <Stat label="Vendors invited" value={invited.length} />
            <Stat label="Signed up from an invite" value={inviteSignups} />
          </StatStrip>
        </PageHead>
        {referrals.error ?? credits.error ?? invites.error ? <Notice tone="bad">{referrals.error ?? credits.error ?? invites.error}</Notice> : null}
        <p className="cx-page-intro">
          {`Every studio has a referral code on its Subscription page. A studio that signs up with one gets ${OFFER_SUMMARY}. The studio whose code it was earns a one-off ${money(REFERRAL_CREDIT_CENTS)} credit, added to its Stripe balance once the new studio has been paying for 3 months and is still paying. Vendors on studios' booked jobs are invited once, by themselves, with the studio's code.`}
        </p>
        <div className="cx-grid-2">
          <Panel flush title="Studios bringing others in">
            {byStudio.length ? (
              <div className="cx-timeline">
                {byStudio.map(([tenantId, counts]) => (
                  <Link className="cx-item" href={studioHref(tenantId)} key={tenantId}>
                    <span className="cx-item-title">{names.get(tenantId) ?? tenantId}</span>
                    <span className="cx-item-time">{`${counts.referrals} referred`}</span>
                    <span className="cx-item-snippet">{`${counts.invites} ${counts.invites === 1 ? "vendor" : "vendors"} invited`}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Nobody referred yet">Studios show here once one signs up with another&apos;s code, or once vendor invites go out.</Empty>
            )}
          </Panel>
          <Panel flush title="Credits added">
            {(credits.rows ?? []).length ? (
              <div className="cx-timeline">
                {[...(credits.rows ?? [])]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 12)
                  .map((credit) => (
                    <Link className="cx-item" href={studioHref(credit.referrerTenantId)} key={credit.id}>
                      <span className="cx-item-title">{names.get(credit.referrerTenantId) ?? credit.referrerTenantId}</span>
                      <span className="cx-item-time">{shortDate(credit.createdAt, now)}</span>
                      <span className="cx-item-snippet">{`${money(credit.amountCents)} for referring ${names.get(credit.referredTenantId) ?? "a studio"}`}</span>
                    </Link>
                  ))}
              </div>
            ) : (
              <Empty title="No credits yet">Each is added three months after a referred studio first pays.</Empty>
            )}
          </Panel>
        </div>
        <PageHead count={rows.length} title="Referred studios" />
        <DataTable
          columns={columns}
          empty={<Empty title="No referred studios yet" />}
          getRowId={(row) => row.id}
          initialSort={[{ id: "signed", desc: true }]}
          label="Referred studios"
          rows={referrals.rows}
        />
      </div>
    </>
  );
}
