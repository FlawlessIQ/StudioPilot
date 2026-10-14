"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Download, Plus, Upload } from "lucide-react";
import {
  PARTNER_RATE_CENTS,
  PARTNER_TIER_AFTER,
  PARTNER_TOP_RATE_CENTS,
  PARTNER_VENDOR_RATE_CENTS,
  PARTNER_VENDOR_TOP_RATE_CENTS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  PAYOUT_METHODS,
  PAYOUT_METHOD_LABELS,
  REFERRAL_STAGE_LABELS,
  partnerSignupLink,
  partnerTally,
  referralStage,
  referredVendor,
  type PartnerType,
  type PayoutMethod,
  type ReferralStage,
} from "@/features/console/partner-payouts";
import { makePartnerCode, PARTNER_CODE_SUFFIX, PARTNER_EXPORT_HEADER, partnerCodeStem, partnerExportRows } from "@/features/console/partner-import";
import { normalizeReferralCode, OFFER_SUMMARY } from "@/features/subscriptions/referral-program";
import { VENDOR_OFFER_SUMMARY_THEIRS } from "@/features/subscriptions/vendor-offer";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { downloadCsv, studioHref, toCsv } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { DataTable } from "../data-table";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Stat, StatStrip, Tag } from "../ui";
import { useCommand } from "../use-command";
import { PartnerImportDrawer } from "./partner-import-drawer";

/**
 * Referral partners (features/console/partner-payouts.ts has the rules):
 * planners, DJs, hair and makeup artists with their own code. Make a code,
 * copy its signup link into the message, then watch who signs up, which
 * referrals count, and what's owed. Payouts are sent by hand and recorded
 * here.
 */

export type Partner = {
  id: string;
  code: string;
  name: string;
  business?: string | null;
  email?: string | null;
  phone?: string | null;
  type: PartnerType;
  payoutHandle?: string | null;
  notes?: string | null;
  active?: boolean;
  createdAt?: string;
};
type Payout = { id: string; partnerId: string; amountCents: number; paidOn: string; method: PayoutMethod; reference?: string | null; note?: string | null; createdAt: string };
type Referral = {
  id: string;
  tenantId: string;
  studioName?: string | null;
  partnerId?: string | null;
  status?: string;
  signedUpAt?: string | null;
  paidAt?: string | null;
  qualifiedAt?: string | null;
  forfeitedAt?: string | null;
  plan?: string | null;
};

const STAGE_TONE: Record<ReferralStage, "info" | "warn" | "ok" | "neutral"> = { trial: "info", paying: "warn", counts: "ok", canceled: "neutral" };

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://studio-cue.com";
}

/** The "New partner code" button, for the page's top bar. */
export function NewPartnerButton({ onClick }: { onClick: () => void }) {
  const { can } = useConsole();
  if (!can("codes.write")) return null;
  return (
    <Button onClick={onClick} variant="primary">
      <Plus size={13} /> New partner code
    </Button>
  );
}

export function PartnersTab({ open, setOpen }: { open: "new" | "import" | string | null; setOpen: (next: "new" | "import" | string | null) => void }) {
  const { can, toast } = useConsole();
  const partners = useLiveQuery<Partner>("console:partners", (firestore) => query(collection(firestore, "saasPartners"), limit(5000)));
  const payouts = useLiveQuery<Payout>("console:partner-payouts", (firestore) => query(collection(firestore, "saasPartnerPayouts"), limit(10000)));
  const referrals = useLiveQuery<Referral>("console:referrals", (firestore) => query(collection(firestore, "saasReferrals"), limit(10000)));
  const rows = useMemo(() => {
    const byPartner = new Map<string, Referral[]>();
    for (const referral of referrals.rows ?? []) {
      if (!referral.partnerId) continue;
      byPartner.set(referral.partnerId, [...(byPartner.get(referral.partnerId) ?? []), referral]);
    }
    return (partners.rows ?? []).map((partner) => {
      const own = byPartner.get(partner.id) ?? [];
      return { ...partner, referrals: own, tally: partnerTally(own, (payouts.rows ?? []).filter((payout) => payout.partnerId === partner.id)) };
    });
  }, [partners.rows, payouts.rows, referrals.rows]);
  type Row = (typeof rows)[number];

  const totals = rows.reduce(
    (sum, row) => ({ signedUp: sum.signedUp + row.tally.signedUp, counted: sum.counted + row.tally.counted, owed: sum.owed + Math.max(0, row.tally.owedCents), paid: sum.paid + row.tally.paidCents }),
    { signedUp: 0, counted: 0, owed: 0, paid: 0 },
  );

  const copyLink = (code: string) =>
    void navigator.clipboard
      ?.writeText(partnerSignupLink(origin(), code))
      .then(() => toast(`Signup link for ${code} copied.`, "ok"))
      .catch(() => undefined);

  /** Every partner, or just the codes given, with their signup links: a spreadsheet or an agent like Muse reads it. */
  const exportPartners = (codes?: string[]) => {
    const wanted = codes ? new Set(codes) : null;
    const chosen = rows.filter((row) => !wanted || wanted.has(row.code));
    downloadCsv(
      `studiocue-partners-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        PARTNER_EXPORT_HEADER,
        partnerExportRows(
          origin(),
          chosen.map((row) => ({ ...row, signedUp: row.tally.signedUp, counted: row.tally.counted, owedCents: row.tally.owedCents })),
        ),
      ),
    );
  };

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "partner",
        header: "Partner",
        accessorFn: (row) => row.business || row.name,
        meta: { width: 220, flex: true },
        cell: ({ row }) => (
          <span>
            <span className="cx-link">{row.original.business || row.original.name}</span>
            <span className="cx-sub">{` · ${PARTNER_TYPE_LABELS[row.original.type] ?? "Other"}${row.original.business ? ` · ${row.original.name}` : ""}`}</span>
            {row.original.active === false ? <span className="cx-sub">{" · code off"}</span> : null}
          </span>
        ),
      },
      {
        id: "code",
        header: "Code",
        accessorFn: (row) => row.code,
        meta: { width: 170 },
        cell: ({ row }) => (
          <span className="cx-inline">
            <Tag code>{row.original.code}</Tag>
            <Button
              aria-label={`Copy the signup link for ${row.original.code}`}
              icon
              onClick={(event) => {
                event.stopPropagation();
                copyLink(row.original.code);
              }}
              size="sm"
              variant="ghost"
            >
              <Copy size={13} />
            </Button>
          </span>
        ),
      },
      { id: "signed", header: "Signed up", accessorFn: (row) => row.tally.signedUp, meta: { width: 90, priority: 2 } },
      { id: "paying", header: "Paying", accessorFn: (row) => row.tally.paying, meta: { width: 80, priority: 3 } },
      { id: "counts", header: "Count", accessorFn: (row) => row.tally.counted, meta: { width: 80 } },
      { id: "rate", header: "Rate", accessorFn: (row) => row.tally.rateCents, meta: { width: 80, priority: 3 }, cell: ({ row }) => money(row.original.tally.rateCents) },
      {
        id: "owed",
        header: "Owed",
        accessorFn: (row) => row.tally.owedCents,
        meta: { width: 100 },
        cell: ({ row }) => (row.original.tally.owedCents > 0 ? <Pill tone="warn">{money(row.original.tally.owedCents)}</Pill> : money(Math.max(0, row.original.tally.owedCents))),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const current = open && open !== "new" && open !== "import" ? rows.find((row) => row.id === open) ?? null : null;

  return (
    <>
      <PageHead title="Partners">
        <StatStrip>
          <Stat label="Partners" value={rows.length} />
          <Stat label="Photographers signed up" value={totals.signedUp} />
          <Stat label="Referrals that count" value={totals.counted} />
          <Stat label="Owed now" tone={totals.owed ? "warn" : undefined} value={money(totals.owed)} />
          <Stat label="Paid so far" tone={totals.paid ? "ok" : undefined} value={money(totals.paid)} />
        </StatStrip>
      </PageHead>
      {partners.error ?? payouts.error ?? referrals.error ? <Notice tone="bad">{partners.error ?? payouts.error ?? referrals.error}</Notice> : null}
      <p className="cx-page-intro">
        {`Planners, DJs, hair and makeup artists who send photographers and other vendors our way. A photographer who signs up with a partner's code gets ${OFFER_SUMMARY}; a DJ, planner, hair or makeup artist gets ${VENDOR_OFFER_SUMMARY_THEIRS}. A referral counts once they have been paying for 3 months and still are. The partner earns ${money(PARTNER_RATE_CENTS)} per photographer and ${money(PARTNER_VENDOR_RATE_CENTS)} per vendor that counts; past ${PARTNER_TIER_AFTER} (both together), every photographer is ${money(PARTNER_TOP_RATE_CENTS)} and every vendor ${money(PARTNER_VENDOR_TOP_RATE_CENTS)}, the first ${PARTNER_TIER_AFTER} included. You pay them yourself and record it here.`}
      </p>
      <div className="cx-inline">
        {can("codes.write") ? (
          <Button onClick={() => setOpen("import")}>
            <Upload size={13} /> Import a spreadsheet
          </Button>
        ) : null}
        <Button disabled={!rows.length} onClick={() => exportPartners()}>
          <Download size={13} /> Export with signup links
        </Button>
      </div>
      <DataTable
        columns={columns}
        empty={<Empty title="No partners yet">{"Make a code for each planner, DJ, hair or makeup artist who'll share StudioCue with photographers."}</Empty>}
        getRowId={(row) => row.id}
        initialSort={[{ id: "owed", desc: true }]}
        label="Partners"
        mobile={(row) => ({ title: row.business || row.name, end: row.tally.owedCents > 0 ? <Pill tone="warn">{`${money(row.tally.owedCents)} owed`}</Pill> : <Tag code>{row.code}</Tag>, meta: `${row.tally.signedUp} signed up · ${row.tally.counted} count` })}
        onRowClick={(row) => setOpen(row.id)}
        rows={partners.rows ? rows : null}
      />
      {open === "import" ? (
        <PartnerImportDrawer existing={partners.rows ?? []} onClose={() => setOpen(null)} onDownload={exportPartners} />
      ) : null}
      {open === "new" ? <PartnerDrawer key="new" onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} partner={null} /> : null}
      {current ? (
        <PartnerDrawer
          key={current.id}
          onClose={() => setOpen(null)}
          onCopy={() => copyLink(current.code)}
          partner={current}
          payouts={(payouts.rows ?? []).filter((payout) => payout.partnerId === current.id)}
          referrals={current.referrals}
          tally={current.tally}
        />
      ) : null}
    </>
  );
}

function PartnerDrawer({
  partner,
  referrals = [],
  payouts = [],
  tally,
  onClose,
  onCreated,
  onCopy,
}: {
  partner: Partner | null;
  referrals?: Referral[];
  payouts?: Payout[];
  tally?: ReturnType<typeof partnerTally>;
  onClose: () => void;
  onCreated?: (id: string) => void;
  onCopy?: () => void;
}) {
  const { can, studios } = useConsole();
  const now = useNow();
  const { run, busy } = useCommand();
  const editable = can("codes.write");
  const names = useMemo(() => new Map((studios.rows ?? []).map((studio) => [studio.tenantId, studio.name])), [studios.rows]);
  const [form, setForm] = useState({
    name: partner?.name ?? "",
    business: partner?.business ?? "",
    email: partner?.email ?? "",
    phone: partner?.phone ?? "",
    type: (partner?.type ?? "planner") as PartnerType,
    code: partner?.code ?? "",
    payoutHandle: partner?.payoutHandle ?? "",
    notes: partner?.notes ?? "",
    active: partner?.active !== false,
  });
  const field = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  // A blank code takes the suggestion: the name plus four random characters (features/console/partner-import.ts).
  const stem = form.name.trim().length >= 2 || form.business.trim().length >= 2 ? partnerCodeStem({ name: form.name, business: form.business, type: form.type }) : "";
  const [suffix] = useState(() => makePartnerCode("", () => false));
  const suggestedCode = !partner && stem ? `${stem.slice(0, 20 - PARTNER_CODE_SUFFIX - 6)}${suffix}` : "";
  const code = normalizeReferralCode(form.code || suggestedCode);
  const valid = form.name.trim().length >= 2 && (!form.email || /\S+@\S+\.\S+/.test(form.email)) && (partner ? true : Boolean(code));
  const details = {
    name: form.name.trim(),
    business: form.business.trim() || null,
    email: form.email.trim().toLowerCase() || null,
    phone: form.phone.trim() || null,
    type: form.type,
    payoutHandle: form.payoutHandle.trim() || null,
    notes: form.notes.trim() || null,
  };
  const save = async () => {
    if (!partner) {
      const result = await run<{ partnerId: string; code: string }>("createPartner", { ...details, code: code ?? form.code }, { done: (made) => `Code ${made.code} is ready. Copy its signup link into the message.` });
      if (result) onCreated?.(result.partnerId);
      return;
    }
    await run("updatePartner", { partnerId: partner.id, ...details, active: form.active }, { done: "Saved." });
  };

  const today = new Date(now).toISOString().slice(0, 10);
  const [payout, setPayout] = useState({ amount: tally && tally.owedCents > 0 ? String(tally.owedCents / 100) : "", paidOn: today, method: "venmo" as PayoutMethod, reference: "" });
  const [removing, setRemoving] = useState<Payout | null>(null);
  const amountCents = Math.round(Number(payout.amount) * 100);
  const recordPayout = async () => {
    if (!partner) return;
    const result = await run(
      "recordPartnerPayout",
      { partnerId: partner.id, amountCents, paidOn: payout.paidOn, method: payout.method, reference: payout.reference.trim() || null },
      { done: `${money(amountCents)} recorded for ${partner.business || partner.name}.` },
    );
    if (result) setPayout((current) => ({ ...current, amount: "", reference: "" }));
  };

  return (
    <Drawer
      footer={
        editable ? (
          <Button busy={busy === "createPartner" || busy === "updatePartner"} disabled={!valid} onClick={() => void save()} variant="primary">
            {partner ? "Save" : "Make the code"}
          </Button>
        ) : null
      }
      onClose={onClose}
      open
      title={partner ? partner.business || partner.name : "New partner code"}
      wide
    >
      <div className="cx-form">
        {partner && tally ? (
          <>
            <KV
              items={[
                ["Code", <span className="cx-inline" key="code"><Tag code>{partner.code}</Tag>{partner.active === false ? <Pill tone="neutral">Off</Pill> : null}</span>],
                ["Signup link", <span className="cx-inline" key="link"><span className="cx-sub">{partnerSignupLink(origin(), partner.code)}</span><Button onClick={onCopy} size="sm">Copy</Button></span>],
                ["Signed up", `${tally.signedUp} (${tally.inTrial} in trial, ${tally.paying} paying, ${tally.canceled} canceled)`],
                ["Count", tally.toTopRate > 0 ? `${tally.counted}, ${tally.toTopRate} more to reach the top rate (${money(PARTNER_TOP_RATE_CENTS)} a photographer, ${money(PARTNER_VENDOR_TOP_RATE_CENTS)} a vendor)` : `${tally.counted}, at the top rate`],
                [
                  "Earned",
                  `${money(tally.earnedCents)} (${[
                    tally.counted - tally.countedVendors ? `${tally.counted - tally.countedVendors} photographer${tally.counted - tally.countedVendors === 1 ? "" : "s"} × ${money(tally.rateCents)}` : null,
                    tally.countedVendors ? `${tally.countedVendors} vendor${tally.countedVendors === 1 ? "" : "s"} × ${money(tally.vendorRateCents)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" + ") || "none yet"})`,
                ],
                ["Paid", money(tally.paidCents)],
                ["Owed", tally.owedCents > 0 ? <Pill key="owed" tone="warn">{money(tally.owedCents)}</Pill> : money(Math.max(0, tally.owedCents))],
              ]}
            />
          </>
        ) : (
          <p className="cx-hint">
            The code is what the partner shares: their name plus a few random characters, like <strong>SARAHMUA7KQX</strong>, so it reads as theirs but isn&apos;t just their name. Leave it blank and one is made for you. A photographer who signs up with it gets the referral price, and a DJ, planner, hair or makeup artist the vendor offer. It can&apos;t be changed once made.
          </p>
        )}
        <div className="cx-row-2">
          <PartnerInput id="partner-name" label="Name" onChange={field("name")} value={form.name} />
          <PartnerInput id="partner-business" label="Business" onChange={field("business")} value={form.business} />
        </div>
        <div className="cx-row-2">
          <PartnerInput id="partner-email" label="Email" onChange={field("email")} type="email" value={form.email} />
          <PartnerInput id="partner-phone" label="Phone" onChange={field("phone")} type="tel" value={form.phone} />
        </div>
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-type">They are a</label>
            <select className="cx-input" id="partner-type" onChange={field("type")} value={form.type}>
              {PARTNER_TYPES.map((type) => (
                <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          {partner ? (
            <div className="cx-field">
              <label className="cx-label" htmlFor="partner-active">Code</label>
              <select className="cx-input" id="partner-active" onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === "on" }))} value={form.active ? "on" : "off"}>
                <option value="on">Works</option>
                <option value="off">{"Turned off (new sign-ups can't use it)"}</option>
              </select>
            </div>
          ) : (
            <div className="cx-field">
              <label className="cx-label" htmlFor="partner-code">Code</label>
              <input className="cx-input" id="partner-code" onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder={suggestedCode || "SARAHMUA7KQX"} value={form.code} />
              {form.code && !code ? <span className="cx-hint">4 to 20 letters and numbers.</span> : null}
            </div>
          )}
        </div>
        <PartnerInput id="partner-handle" label="How you pay them" onChange={field("payoutHandle")} placeholder="Venmo @sarah-mua" value={form.payoutHandle} />
        <div className="cx-field">
          <label className="cx-label" htmlFor="partner-notes">Notes</label>
          <textarea className="cx-textarea" id="partner-notes" onChange={field("notes")} rows={3} value={form.notes} />
        </div>

        {partner ? (
          <>
            <Panel flush title="Who signed up">
              {referrals.length ? (
                <div className="cx-timeline">
                  {[...referrals]
                    .sort((a, b) => String(b.signedUpAt ?? "").localeCompare(String(a.signedUpAt ?? "")))
                    .map((referral) => {
                      const stage = referralStage(referral);
                      return (
                        <Link className="cx-item" href={studioHref(referral.tenantId)} key={referral.id}>
                          <span className="cx-item-title">
                            {names.get(referral.tenantId) ?? referral.studioName ?? referral.tenantId}
                            <span className="cx-sub">{referredVendor(referral) ? " · vendor" : " · photographer"}</span>
                          </span>
                          <span className="cx-item-time"><Pill tone={STAGE_TONE[stage]}>{REFERRAL_STAGE_LABELS[stage]}</Pill></span>
                          <span className="cx-item-snippet">
                            {[`Signed up ${shortDate(referral.signedUpAt ?? null, now)}`, referral.paidAt ? `first paid ${shortDate(referral.paidAt, now)}` : null, referral.qualifiedAt ? `counted ${shortDate(referral.qualifiedAt, now)}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </Link>
                      );
                    })}
                </div>
              ) : (
                <Empty title="Nobody yet">They show here as soon as someone signs up with this code.</Empty>
              )}
            </Panel>
            <Panel flush title="Payouts">
              {payouts.length ? (
                <div className="cx-timeline">
                  {[...payouts]
                    .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
                    .map((item) => (
                      <div className="cx-item" key={item.id}>
                        <span className="cx-item-title">{money(item.amountCents)}</span>
                        <span className="cx-item-time">{shortDate(`${item.paidOn}T12:00:00`, now)}</span>
                        <span className="cx-item-snippet">
                          {[PAYOUT_METHOD_LABELS[item.method] ?? item.method, item.reference].filter(Boolean).join(" · ")}
                          {can("billing.write") ? (
                            <>
                              {" "}
                              <Button onClick={() => setRemoving(item)} size="sm" variant="ghost">Remove</Button>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <Empty title="Nothing paid yet" />
              )}
            </Panel>
            {can("billing.write") ? (
              <Panel title="Record a payout">
                <div className="cx-form">
                  <div className="cx-row-2">
                    <PartnerInput id="payout-amount" label="Amount ($)" onChange={(event) => setPayout((current) => ({ ...current, amount: event.target.value }))} type="number" value={payout.amount} />
                    <PartnerInput id="payout-date" label="Paid on" onChange={(event) => setPayout((current) => ({ ...current, paidOn: event.target.value }))} type="date" value={payout.paidOn} />
                  </div>
                  <div className="cx-row-2">
                    <div className="cx-field">
                      <label className="cx-label" htmlFor="payout-method">How</label>
                      <select className="cx-input" id="payout-method" onChange={(event) => setPayout((current) => ({ ...current, method: event.target.value as PayoutMethod }))} value={payout.method}>
                        {PAYOUT_METHODS.map((method) => (
                          <option key={method} value={method}>{PAYOUT_METHOD_LABELS[method]}</option>
                        ))}
                      </select>
                    </div>
                    <PartnerInput id="payout-reference" label="Reference" onChange={(event) => setPayout((current) => ({ ...current, reference: event.target.value }))} placeholder="Check #, Venmo note…" value={payout.reference} />
                  </div>
                  <div>
                    <Button busy={busy === "recordPartnerPayout"} disabled={!(amountCents >= 100) || !payout.paidOn} onClick={() => void recordPayout()}>
                      Record payout
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : null}
          </>
        ) : null}
      </div>
      <ConfirmDialog
        busy={busy === "deletePartnerPayout"}
        confirmLabel="Remove payout"
        danger
        description="Use this for a payout recorded by mistake. It goes back to owed."
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          void run("deletePartnerPayout", { payoutId: removing.id }, { done: "Payout removed." }).then(() => setRemoving(null));
        }}
        open={Boolean(removing)}
        requireReason={false}
        title={removing ? `Remove the ${money(removing.amountCents)} payout?` : "Remove payout?"}
      />
    </Drawer>
  );
}

function PartnerInput({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (event: { target: { value: string } }) => void; type?: string; placeholder?: string }) {
  return (
    <div className="cx-field">
      <label className="cx-label" htmlFor={id}>{label}</label>
      <input className="cx-input" id={id} onChange={onChange} placeholder={placeholder} type={type} value={value} />
    </div>
  );
}
