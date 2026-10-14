"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import {
  OFFER_STATE_LABELS,
  PROSPECT_LABELS,
  SOURCE_LABELS,
  partnerCandidate,
  partnerTypeFor,
  suggestedPartnerCode,
  type VendorOfferState,
  type VendorProspect,
} from "@/features/console/vendor-database";
import { PARTNER_TYPES, PARTNER_TYPE_LABELS, type PartnerType } from "@/features/console/partner-payouts";
import { normalizeReferralCode } from "@/features/subscriptions/referral-program";
import { vendorCategoryLabel } from "@/features/vendors/team";
import { shortDate } from "@/lib/console/format";
import { runConsoleCommand } from "@/lib/console/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Stat, StatStrip, Tag } from "../ui";
import { useCommand } from "../use-command";

/**
 * Console → Grow → Vendors (docs/console.md, "Vendors";
 * docs/vendor-network-plan-2026-10-12.md, Phase 4): every vendor booked on
 * any studio's job, once, with where each stands with StudioCue's offer.
 * Business contacts only; the database has no browser read, so the rows come
 * through listPlatformVendors (console/handlers/vendors.ts) and an export is
 * audited. A planner, DJ or beauty vendor working with several studios is
 * one click from a partner code.
 */

type Row = {
  id: string;
  email: string;
  kind: string;
  kinds: string[];
  company: string | null;
  contactName: string | null;
  phone: string | null;
  website: string | null;
  region: string | null;
  city: string | null;
  sources: string[];
  jobsSeen: number;
  studiosSeen: number;
  prospect: VendorProspect;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  offer: VendorOfferState;
  offerCode: string | null;
  signedUpTenantId: string | null;
  invitedByTenantId: string | null;
  invitedAt: string | null;
};

const OFFER_TONE: Record<VendorOfferState, "info" | "warn" | "ok" | "neutral" | "bad"> = {
  none: "neutral",
  invited: "info",
  offered: "info",
  claimed: "warn",
  signed_up: "ok",
  opted_out: "neutral",
};

const nameOf = (row: Row) => row.company || row.contactName || row.email;

export function VendorsPage() {
  const { can } = useConsole();
  const now = useNow();
  const { run, busy } = useCommand();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [region, setRegion] = useState("");
  const [offer, setOffer] = useState<VendorOfferState | "">("");
  const [prospect, setProspect] = useState<VendorProspect | "">("");
  const [open, setOpen] = useState<string | null>(null);

  // Loaded through the handler (the database has no browser read); Refresh asks again.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let active = true;
    runConsoleCommand<{ rows: Row[]; truncated: boolean }>("listPlatformVendors", {})
      .then((result) => {
        if (!active) return;
        setRows(result.rows);
        setTruncated(result.truncated);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(friendlyError(caught, "The vendor list didn't load. Try again."));
        setRows((current) => current ?? []);
      });
    return () => {
      active = false;
    };
  }, [asked]);

  const all = useMemo(() => rows ?? [], [rows]);
  const kinds = useMemo(() => [...new Set(all.map((row) => row.kind))].sort(), [all]);
  const regions = useMemo(() => [...new Set(all.map((row) => row.region).filter((value): value is string => Boolean(value)))].sort(), [all]);
  const shown = useMemo(
    () =>
      all.filter(
        (row) =>
          (!kind || row.kind === kind) &&
          (!region || row.region === region) &&
          (!offer || row.offer === offer) &&
          (!prospect || row.prospect === prospect) &&
          matches(search, row.company, row.contactName, row.email, row.city, row.region),
      ),
    [all, kind, region, offer, prospect, search],
  );

  const exportCsv = async () => {
    const filtered = shown.length !== all.length;
    const result = await run<{ csv: string; count: number }>(
      "exportPlatformVendors",
      filtered ? { ids: shown.map((row) => row.id) } : {},
      { done: (made) => `Exported ${made.count} ${made.count === 1 ? "vendor" : "vendors"}.` },
    );
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `studiocue-vendors-${new Date(now).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "vendor",
        header: "Vendor",
        accessorFn: nameOf,
        meta: { width: 220, flex: true },
        cell: ({ row }) => (
          <span>
            <span className="cx-link">{nameOf(row.original)}</span>
            <span className="cx-sub">{` · ${vendorCategoryLabel(row.original.kind)}${row.original.contactName && row.original.company ? ` · ${row.original.contactName}` : ""}`}</span>
          </span>
        ),
      },
      {
        id: "where",
        header: "Where",
        accessorFn: (row) => [row.city, row.region].filter(Boolean).join(", "),
        meta: { width: 150, priority: 2 },
      },
      { id: "studios", header: "Studios", accessorFn: (row) => row.studiosSeen, meta: { width: 80, align: "right" } },
      { id: "jobs", header: "Jobs", accessorFn: (row) => row.jobsSeen, meta: { width: 70, align: "right", priority: 3 } },
      {
        id: "prospect",
        header: "Prospect",
        accessorFn: (row) => row.prospect,
        meta: { width: 130, priority: 2 },
        cell: ({ row }) => PROSPECT_LABELS[row.original.prospect] ?? row.original.prospect,
      },
      {
        id: "offer",
        header: "Offer",
        accessorFn: (row) => row.offer,
        meta: { width: 130 },
        cell: ({ row }) => <Pill tone={OFFER_TONE[row.original.offer]}>{OFFER_STATE_LABELS[row.original.offer]}</Pill>,
      },
      {
        id: "seen",
        header: "Last seen",
        accessorFn: (row) => row.lastSeenAt ?? "",
        meta: { width: 110, priority: 1 },
        cell: ({ row }) => shortDate(row.original.lastSeenAt, now),
      },
    ],
    [now],
  );

  const current = open ? all.find((row) => row.id === open) ?? null : null;
  const count = (test: (row: Row) => boolean) => all.filter(test).length;

  return (
    <>
      <Topbar crumbs={[{ label: "Grow" }, { label: "Vendors" }]}>
        <Button aria-label="Refresh" icon onClick={() => setAsked((count) => count + 1)} variant="ghost">
          <RefreshCw size={13} />
        </Button>
        {can("crm.write") ? (
          <Button busy={busy === "exportPlatformVendors"} disabled={!shown.length} onClick={() => void exportCsv()}>
            <Download size={13} /> Export CSV
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={rows ? all.length : null} title="Vendors">
          <StatStrip>
            <Stat label="Vendors" value={all.length} />
            <Stat label="At 2+ studios" value={count((row) => row.studiosSeen > 1)} />
            <Stat active={prospect === "vendor_plan"} label="Vendor-plan prospects" onClick={() => setProspect(prospect === "vendor_plan" ? "" : "vendor_plan")} value={count((row) => row.prospect === "vendor_plan")} />
            <Stat active={prospect === "studio_plan"} label="Studio-plan prospects" onClick={() => setProspect(prospect === "studio_plan" ? "" : "studio_plan")} value={count((row) => row.prospect === "studio_plan")} />
            <Stat label="Offered" value={count((row) => row.offer === "offered" || row.offer === "claimed")} />
            <Stat label="Signed up" tone={count((row) => row.offer === "signed_up") ? "ok" : undefined} value={count((row) => row.offer === "signed_up")} />
          </StatStrip>
        </PageHead>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {truncated ? <Notice tone="warn">Showing the 5,000 seen most recently.</Notice> : null}
        <p className="cx-page-intro">
          Every vendor booked on a studio&apos;s job with an email address, once across all studios: who they are, where they work, how many studios and jobs they&apos;ve been on, and where they stand with StudioCue&apos;s offer. Business contacts only, never the client, the date or the venue.
        </p>
        <FilterBar>
          <SearchInput id="vendor-search" onChange={setSearch} placeholder="Search vendors" value={search} />
          <ChipSelect label="Kind" onChange={setKind} options={kinds.map((value) => ({ value, label: vendorCategoryLabel(value) }))} value={kind} />
          <ChipSelect label="State" onChange={setRegion} options={regions.map((value) => ({ value, label: value }))} value={region} />
          <ChipSelect
            label="Offer"
            onChange={setOffer}
            options={(Object.keys(OFFER_STATE_LABELS) as VendorOfferState[]).map((value) => ({ value, label: OFFER_STATE_LABELS[value] }))}
            value={offer}
          />
          <ChipSelect
            label="Prospect"
            onChange={setProspect}
            options={(Object.keys(PROSPECT_LABELS) as VendorProspect[]).map((value) => ({ value, label: PROSPECT_LABELS[value] }))}
            value={prospect}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          empty={<Empty title={all.length ? "No vendors match" : "No vendors yet"}>{all.length ? "Clear a filter to see more." : "Vendors appear here as studios and their clients add them to booked jobs."}</Empty>}
          getRowId={(row) => row.id}
          initialSort={[{ id: "studios", desc: true }]}
          label="Vendors"
          mobile={(row) => ({
            title: nameOf(row),
            meta: `${vendorCategoryLabel(row.kind)} · ${row.studiosSeen} ${row.studiosSeen === 1 ? "studio" : "studios"}`,
            end: <Pill tone={OFFER_TONE[row.offer]}>{OFFER_STATE_LABELS[row.offer]}</Pill>,
          })}
          onRowClick={(row) => setOpen(row.id)}
          rows={rows ? shown : null}
        />
      </div>
      {current ? <VendorDrawer key={current.id} onClose={() => setOpen(null)} row={current} /> : null}
    </>
  );
}

function VendorDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const { can, studios } = useConsole();
  const now = useNow();
  const { run, busy } = useCommand();
  const names = useMemo(() => new Map((studios.rows ?? []).map((studio) => [studio.tenantId, studio.name])), [studios.rows]);
  const [code, setCode] = useState(suggestedPartnerCode(row.company, row.contactName));
  const [type, setType] = useState<PartnerType>(partnerTypeFor(row.kind));
  const [made, setMade] = useState<string | null>(null);
  const valid = Boolean(normalizeReferralCode(code));

  const makePartner = async () => {
    const result = await run<{ partnerId: string; code: string }>(
      "createPartner",
      {
        name: row.contactName || row.company || row.email,
        business: row.company,
        email: row.email,
        phone: row.phone,
        type,
        code,
        notes: `From the vendor database: ${row.studiosSeen} ${row.studiosSeen === 1 ? "studio" : "studios"}, ${row.jobsSeen} jobs.`,
      },
      { done: (partner) => `Partner code ${partner.code} is ready in Referrals → Partners.` },
    );
    if (result) setMade(result.code);
  };

  return (
    <Drawer onClose={onClose} open title={nameOf(row)} wide>
      <div className="cx-form">
        <KV
          items={[
            ["Kind", row.kinds.map((value) => vendorCategoryLabel(value)).join(", ") || vendorCategoryLabel(row.kind)],
            ["Contact", row.contactName || "—"],
            ["Email", <a href={`mailto:${row.email}`} key="email">{row.email}</a>],
            ["Phone", row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} key="phone">{row.phone}</a> : "—"],
            ["Website", row.website ? <a href={row.website} key="web" rel="noreferrer" target="_blank">{row.website}</a> : "—"],
            ["Where", [row.city, row.region].filter(Boolean).join(", ") || "—"],
            ["Seen", `${row.jobsSeen} ${row.jobsSeen === 1 ? "job" : "jobs"} at ${row.studiosSeen} ${row.studiosSeen === 1 ? "studio" : "studios"}, first ${shortDate(row.firstSeenAt, now)}, last ${shortDate(row.lastSeenAt, now)}`],
            ["How", row.sources.map((source) => SOURCE_LABELS[source] ?? source).join(", ") || "—"],
            ["Prospect", PROSPECT_LABELS[row.prospect]],
          ]}
        />
        <Panel title="StudioCue's offer">
          <KV
            items={[
              ["State", <Pill key="state" tone={OFFER_TONE[row.offer]}>{OFFER_STATE_LABELS[row.offer]}</Pill>],
              row.offerCode ? ["Their code", <Tag code key="code">{row.offerCode}</Tag>] : null,
              row.invitedByTenantId
                ? [
                    "Through",
                    <Link href={studioHref(row.invitedByTenantId)} key="studio">
                      {names.get(row.invitedByTenantId) ?? row.invitedByTenantId}
                    </Link>,
                  ]
                : null,
              row.invitedAt ? ["Since", shortDate(row.invitedAt, now)] : null,
              row.signedUpTenantId
                ? ["Their studio", <Link href={studioHref(row.signedUpTenantId)} key="own">{names.get(row.signedUpTenantId) ?? row.signedUpTenantId}</Link>]
                : null,
            ]}
          />
        </Panel>
        {can("codes.write") && partnerCandidate(row) ? (
          <Panel title="Make them a partner">
            {made ? (
              <p className="cx-hint">
                Code <strong>{made}</strong> is ready. Copy its signup link from <Link href="/platform-admin/referrals">Referrals → Partners</Link>.
              </p>
            ) : (
              <div className="cx-form">
                <p className="cx-hint">A partner code gives the photographers they send the referral price and the vendors the vendor offer, and pays them for each one that counts.</p>
                <div className="cx-row-2">
                  <div className="cx-field">
                    <label className="cx-label" htmlFor="vendor-partner-code">Code</label>
                    <input className="cx-input" id="vendor-partner-code" onChange={(event) => setCode(event.target.value.toUpperCase())} value={code} />
                    {code && !valid ? <span className="cx-hint">4 to 20 letters and numbers.</span> : null}
                  </div>
                  <div className="cx-field">
                    <label className="cx-label" htmlFor="vendor-partner-type">They are a</label>
                    <select className="cx-input" id="vendor-partner-type" onChange={(event) => setType(event.target.value as PartnerType)} value={type}>
                      {PARTNER_TYPES.map((value) => (
                        <option key={value} value={value}>{PARTNER_TYPE_LABELS[value]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <Button busy={busy === "createPartner"} disabled={!valid} onClick={() => void makePartner()} variant="primary">
                    Make the partner code
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </Drawer>
  );
}
