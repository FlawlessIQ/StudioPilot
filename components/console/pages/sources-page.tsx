"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { HEARD_OPTIONS } from "@/features/growth/attribution";
import type { ConsoleStudio } from "@/features/console/model";
import {
  BASIS_LABELS,
  CHANNEL_LABELS,
  SOURCE_CHANNELS,
  classifyStudio,
  funnelBy,
  funnelStage,
  rate,
  type AttributionRecord,
  type FunnelRow,
  type ReferralCodeRef,
  type ReferralRef,
  type SourceChannel,
  type StudioSource,
} from "@/features/console/sources";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Stat, StatStrip, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * Sources (docs/console.md, "Sources"): where studios come from, and which
 * of those channels and referring studios turn into paying studios.
 *
 * Conor, 2026-10-07: the Console should lead with growth: which referrals work
 * best, and whether studios come from the website or Instagram. Each studio gets one channel
 * (features/console/sources.ts); the drawer shows everything recorded and
 * lets an operator file it by hand.
 */

const PERIODS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

export type SourcedStudio = { studio: ConsoleStudio; source: StudioSource; attribution: AttributionRecord | null };

const STAGE_LABEL = { signed_up: "No card yet", card: "In trial", paying: "Paying", churned: "Canceled" } as const;
const STAGE_TONE = { signed_up: "warn", card: "info", paying: "ok", churned: "neutral" } as const;
const HEARD_LABEL = Object.fromEntries(HEARD_OPTIONS.map((option) => [option.value, option.label])) as Record<string, string>;

/** Every studio with its source. Shared with Home. */
export function useSourcedStudios(): { rows: SourcedStudio[] | null; referrals: ReferralRef[]; error: string | null } {
  const { studios } = useConsole();
  const attributions = useLiveQuery<AttributionRecord>("console:attribution", (firestore) => query(collection(firestore, "saasAttribution"), limit(10000)));
  const codes = useLiveQuery<ReferralCodeRef & { id: string }>("console:referral-codes", (firestore) => query(collection(firestore, "saasReferralCodes"), limit(10000)));
  const referrals = useLiveQuery<ReferralRef & { id: string }>("console:referrals", (firestore) => query(collection(firestore, "saasReferrals"), limit(10000)));
  const rows = useMemo<SourcedStudio[] | null>(() => {
    if (!studios.rows || !attributions.rows || !codes.rows || !referrals.rows) return null;
    const byTenant = new Map(attributions.rows.map((record) => [record.tenantId ?? record.id, record]));
    const referralByTenant = new Map(referrals.rows.map((referral) => [referral.tenantId ?? referral.id, referral]));
    const codeOwners = new Map(codes.rows.map((code) => [code.code ?? code.id, code.tenantId]));
    const names = new Map(studios.rows.map((studio) => [studio.tenantId, studio.name]));
    return studios.rows
      .filter((studio) => !studio.removed)
      .map((studio) => {
        const attribution = byTenant.get(studio.tenantId) ?? null;
        return {
          studio,
          attribution,
          source: classifyStudio({
            tenantId: studio.tenantId,
            attribution,
            referral: referralByTenant.get(studio.tenantId),
            codes: codeOwners,
            studioName: (tenantId) => names.get(tenantId) ?? null,
          }),
        };
      });
  }, [studios.rows, attributions.rows, codes.rows, referrals.rows]);
  return { rows, referrals: referrals.rows ?? [], error: attributions.error ?? codes.error ?? referrals.error };
}

export function SourcesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();
  const { rows, error } = useSourcedStudios();
  const period = (PERIODS.find((item) => item.key === params.get("period"))?.key ?? "90") as PeriodKey;
  const channel = params.get("channel") as SourceChannel | null;
  const openId = params.get("studio");

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const days = PERIODS.find((item) => item.key === period)?.days ?? null;
  const inPeriod = useMemo(
    () => (rows ?? []).filter((row) => days === null || (row.studio.createdAt && now - Date.parse(row.studio.createdAt) <= days * 86_400_000)),
    [rows, days, now],
  );
  const counted = inPeriod.filter((row) => !row.studio.comped);
  const carded = counted.filter((row) => funnelStage(row.studio) !== "signed_up").length;
  const paying = counted.filter((row) => funnelStage(row.studio) === "paying").length;
  const fromReferrals = counted.filter((row) => row.source.channel === "referral").length;
  const known = counted.filter((row) => row.source.channel !== "unknown" && row.source.channel !== "direct").length;

  const byChannel = funnelBy(inPeriod, (row) => ({ key: row.source.channel, label: CHANNEL_LABELS[row.source.channel] }));
  const byLink = funnelBy(inPeriod, (row) => (row.source.linkChannel ? { key: row.source.linkChannel, label: CHANNEL_LABELS[row.source.linkChannel] } : null));
  const byCampaign = funnelBy(inPeriod, (row) => (row.source.campaign ? { key: row.source.campaign, label: row.source.campaign } : null));

  // Referring studios are judged on everything they've brought in, not just this period.
  const leaders = useMemo(
    () =>
      funnelBy(
        (rows ?? []).filter((row) => row.source.referrerTenantId),
        (row) => ({ key: row.source.referrerTenantId!, label: (rows ?? []).find((other) => other.studio.tenantId === row.source.referrerTenantId)?.studio.name ?? "A studio" }),
      ).slice(0, 8),
    [rows],
  );
  const viaInvites = useMemo(() => (rows ?? []).filter((row) => row.source.channel === "referral" && row.source.detail?.endsWith("vendor invite")), [rows]);

  const listed = channel ? inPeriod.filter((row) => row.source.channel === channel) : inPeriod;
  const open = (rows ?? []).find((row) => row.studio.tenantId === openId) ?? null;

  const columns = useMemo<ColumnDef<SourcedStudio, unknown>[]>(
    () => [
      { id: "name", header: "Studio", accessorFn: (row) => row.studio.name, meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.studio.name}</span> },
      {
        id: "channel",
        header: "Source",
        accessorFn: (row) => CHANNEL_LABELS[row.source.channel],
        meta: { width: 200 },
        cell: ({ row }) => (
          <span>
            {CHANNEL_LABELS[row.original.source.channel]}
            {row.original.source.detail ? <span className="cx-sub">{` · ${row.original.source.detail}`}</span> : null}
          </span>
        ),
      },
      { id: "basis", header: "How we know", accessorFn: (row) => BASIS_LABELS[row.source.basis], meta: { width: 130, priority: 3 } },
      { id: "created", header: "Signed up", accessorFn: (row) => row.studio.createdAt ?? "", meta: { width: 110, priority: 2 }, cell: ({ row }) => shortDate(row.original.studio.createdAt, now) },
      {
        id: "stage",
        header: "Now",
        accessorFn: (row) => funnelStage(row.studio),
        meta: { width: 120 },
        cell: ({ row }) => (row.original.studio.comped ? <Pill tone="neutral">Comped</Pill> : <Pill tone={STAGE_TONE[funnelStage(row.original.studio)]}>{STAGE_LABEL[funnelStage(row.original.studio)]}</Pill>),
      },
    ],
    [now],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Grow" }, { label: "Sources" }]} />
      <div className="cx-content">
        <PageHead title="Sources">
          <StatStrip>
            <Stat label="Signups" value={counted.length} />
            <Stat label="Added a card" value={`${carded} · ${rate(carded, counted.length)}`} />
            <Stat label="Paying" tone={paying ? "ok" : undefined} value={`${paying} · ${rate(paying, counted.length)}`} />
            <Stat label="From referrals" value={fromReferrals} />
            <Stat label="Source known" value={rate(known, counted.length)} />
          </StatStrip>
        </PageHead>
        <Tabs label="Period" onChange={(key) => set("period", key === "90" ? null : key)} tabs={PERIODS.map((item) => ({ key: item.key, label: item.label }))} value={period} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <p className="cx-page-intro">
          {"Each studio counts once, under what an operator filed it as, then another studio's referral code, then what the owner told us at signup, then the link they arrived on. Comped studios are left out of the numbers. Studios from before October 7, 2026 show as Before tracking until someone files them."}
        </p>
        <div className="cx-grid-2">
          <Panel flush title="By channel">
            <FunnelTable active={channel} empty="No signups in this period." label="Signups by channel" onPick={(key) => set("channel", key === channel ? null : key)} rows={byChannel} />
          </Panel>
          <Panel flush title="Top referring studios, all time">
            {leaders.length ? (
              <div className="cx-timeline">
                {leaders.map((row) => (
                  <Link className="cx-item" href={studioHref(row.key)} key={row.key}>
                    <span className="cx-item-title">{row.label}</span>
                    <span className="cx-item-time">{`${row.paying} paying`}</span>
                    <span className="cx-item-snippet">{`${row.studios} ${row.studios === 1 ? "studio" : "studios"} referred · ${rate(row.paying, row.studios)} paying`}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No referred studios yet" action={<Link className="cx-btn" data-size="sm" href="/platform-admin/referrals">Open Referrals</Link>}>
                Once a studio signs up with another studio&apos;s code, the studios bringing them in show here.
              </Empty>
            )}
          </Panel>
          <Panel flush title="From vendor invites, all time">
            <FunnelTable empty="No studios from vendor invites yet." label="Studios from vendor invites" rows={funnelBy(viaInvites, () => ({ key: "vendor_invite", label: "Vendor invites" }))} />
          </Panel>
          <Panel flush title="The link they arrived on">
            <FunnelTable empty="No tracked links in this period. Tag links with utm_source and utm_campaign to see them here." label="Signups by link" rows={byLink} />
          </Panel>
        </div>
        {byCampaign.length ? (
          <Panel flush title="Campaigns">
            <FunnelTable empty="" label="Signups by campaign" rows={byCampaign} />
          </Panel>
        ) : null}
        <PageHead count={listed.length} title={channel ? `Studios · ${CHANNEL_LABELS[channel]}` : "Studios"}>
          {channel ? <Button onClick={() => set("channel", null)} size="sm" variant="ghost">Show every channel</Button> : null}
        </PageHead>
        <DataTable
          columns={columns}
          empty={<Empty title="No studios in this period" />}
          getRowId={(row) => row.studio.tenantId}
          initialSort={[{ id: "created", desc: true }]}
          label="Studios by source"
          mobile={(row) => ({ title: row.studio.name, end: CHANNEL_LABELS[row.source.channel], meta: `${shortDate(row.studio.createdAt, now)} · ${row.studio.comped ? "Comped" : STAGE_LABEL[funnelStage(row.studio)]}` })}
          onRowClick={(row) => set("studio", row.studio.tenantId)}
          rows={rows ? listed : null}
        />
      </div>
      {open ? <SourceDrawer onClose={() => set("studio", null)} row={open} /> : null}
    </>
  );
}

function FunnelTable({ rows, label, empty, onPick, active }: { rows: FunnelRow[]; label: string; empty: string; onPick?: (key: string) => void; active?: string | null }) {
  if (!rows.length) return <Empty title={empty || "Nothing yet"} />;
  return (
    <div className="cx-table-wrap" style={{ border: 0, borderRadius: 0 }}>
      <table aria-label={label} className="cx-table">
        <thead>
          <tr>
            <th className="cx-th">Source</th>
            <th className="cx-th" data-align="right">Signups</th>
            <th className="cx-th" data-align="right">Card</th>
            <th className="cx-th" data-align="right">Paying</th>
            <th className="cx-th" data-align="right">Converted</th>
            <th className="cx-th" data-align="right">MRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr aria-selected={active === row.key ? true : undefined} className="cx-row" key={row.key}>
              <td className="cx-td">
                {onPick ? (
                  <button className="cx-link" onClick={() => onPick(row.key)} type="button">
                    {row.label}
                  </button>
                ) : (
                  row.label
                )}
              </td>
              <td className="cx-td" data-align="right">{row.studios}</td>
              <td className="cx-td" data-align="right">{rate(row.carded, row.studios)}</td>
              <td className="cx-td" data-align="right">{row.paying}</td>
              <td className="cx-td" data-align="right">{rate(row.paying, row.studios)}</td>
              <td className="cx-td" data-align="right">{money(row.mrrCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function touchText(touch: AttributionRecord["first"]): string | null {
  if (!touch) return null;
  const parts = [
    touch.source ? `utm_source ${touch.source}` : null,
    touch.medium ? `medium ${touch.medium}` : null,
    touch.campaign ? `campaign ${touch.campaign}` : null,
    touch.referrer ? `from ${touch.referrer}` : null,
    touch.code ? `code ${touch.code}` : null,
  ].filter(Boolean);
  return `${touch.landing}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}

function SourceDrawer({ row, onClose }: { row: SourcedStudio; onClose: () => void }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const manual = row.attribution?.manual ?? null;
  const [channel, setChannel] = useState<string>(manual?.channel ?? "");
  const [detail, setDetail] = useState(manual?.detail ?? "");
  const attribution = row.attribution;
  const save = async (clear = false) => {
    const result = await run(
      "setStudioSource",
      { tenantId: row.studio.tenantId, channel: clear || !channel ? null : channel, detail: clear ? null : detail.trim() || null },
      { done: () => (clear || !channel ? "Back to what was recorded at signup." : `Filed under ${CHANNEL_LABELS[channel as SourceChannel]}.`) },
    );
    if (result) onClose();
  };
  return (
    <Drawer
      footer={
        can("crm.write") ? (
          <>
            {manual ? (
              <Button busy={busy === "setStudioSource"} onClick={() => void save(true)} variant="ghost">
                Clear
              </Button>
            ) : null}
            <Button busy={busy === "setStudioSource"} disabled={!channel} onClick={() => void save()} variant="primary">
              Save
            </Button>
          </>
        ) : null
      }
      onClose={onClose}
      open
      title={row.studio.name}
    >
      <div className="cx-form">
        <KV
          items={[
            ["Source", `${CHANNEL_LABELS[row.source.channel]}${row.source.detail ? ` · ${row.source.detail}` : ""}`],
            ["How we know", BASIS_LABELS[row.source.basis]],
            ["They told us", attribution?.heard ? `${HEARD_LABEL[attribution.heard] ?? attribution.heard}${attribution.heardDetail ? ` · ${attribution.heardDetail}` : ""}` : "Nothing"],
            ["First link", touchText(attribution?.first) ?? "Nothing recorded"],
            attribution?.last && attribution.last.at !== attribution.first?.at ? ["Latest link", touchText(attribution.last) ?? ""] : null,
            ["Code at signup", attribution?.promotionCode ?? "None"],
            ["Signed up", shortDate(row.studio.createdAt)],
          ]}
        />
        <Link className="cx-link" href={studioHref(row.studio.tenantId)}>
          Open the studio
        </Link>
        {can("crm.write") ? (
          <>
            <div className="cx-field">
              <label className="cx-label" htmlFor="source-channel">File under</label>
              <select className="cx-input" id="source-channel" onChange={(event) => setChannel(event.target.value)} value={channel}>
                <option value="">Choose a channel</option>
                {SOURCE_CHANNELS.map((key) => (
                  <option key={key} value={key}>{CHANNEL_LABELS[key]}</option>
                ))}
              </select>
            </div>
            <div className="cx-field">
              <label className="cx-label" htmlFor="source-detail">Detail (optional)</label>
              <input className="cx-input" id="source-detail" maxLength={120} onChange={(event) => setDetail(event.target.value)} placeholder="Who or what, e.g. Sarah, a planner, or WPPI" value={detail} />
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
