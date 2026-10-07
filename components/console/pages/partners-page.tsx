"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Plus } from "lucide-react";
import {
  PARTNER_BOOST_AT,
  PARTNER_KIND_LABELS,
  form1099Cents,
  partnerEarnedCents,
  suggestPartnerCode,
  untilBoost,
} from "@/features/console/partners";
import { money, shortDate } from "@/lib/console/format";
import { downloadCsv, toCsv } from "@/lib/console/studio-display";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Tabs } from "../ui";
import { useCommand } from "../use-command";
import { signupLink } from "./codes-page";

/**
 * Partners (docs/console.md, "Partners"): the DJs, hair and makeup artists,
 * planners and others who sell StudioCue to the studios they work with.
 *
 * Conor and GR Productions, 2026-10-07. Each partner gets their own code;
 * a studio using it gets year 1 on the annual plan for $900. The partner
 * earns $100 a studio once that first annual payment clears, and at ten
 * every one is worth $200 (features/console/partners.ts). Payouts are
 * recorded here, not sent from here.
 */

type Partner = {
  id: string;
  name: string;
  kind: string;
  business?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  code: string;
  active?: boolean;
  paidOutCents?: number;
  payoutMethod?: string | null;
  payoutHandle?: string | null;
  taxFormStatus?: "not_requested" | "requested" | "received";
  taxFormReceivedOn?: string | null;
  statementToken?: string | null;
  statementLinkAt?: string | null;
  createdAt?: string;
};

type Payout = { id: string; partnerId: string; amountCents: number; paidOn: string; method?: string | null; reference?: string | null; note?: string | null };

const PAYOUT_METHOD_LABELS: Record<string, string> = { venmo: "Venmo", zelle: "Zelle", paypal: "PayPal", check: "Check", bank: "Bank transfer", other: "Other" };
const TAX_FORM_LABELS: Record<string, string> = { not_requested: "Not asked", requested: "Asked for", received: "On file" };

const PAGE_VIEWS = [
  { key: "partners", label: "Partners" },
  { key: "payouts", label: "Payouts" },
  { key: "tax", label: "1099s" },
] as const;
type PageView = (typeof PAGE_VIEWS)[number]["key"];

type Referral = {
  id: string;
  tenantId: string;
  partnerId: string;
  status?: string;
  signedUpAt?: string | null;
  paidAt?: string | null;
  amountPaidCents?: number | null;
};

type Row = Partner & { trials: number; paid: number; earnedCents: number; owedCents: number };

function copy(text: string, done: () => void) {
  void navigator.clipboard?.writeText(text).then(done).catch(() => undefined);
}

export function PartnersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, studios, toast } = useConsole();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const partners = useLiveQuery<Partner>("console:partners", (firestore) => query(collection(firestore, "saasPartners"), limit(2000)));
  const referrals = useLiveQuery<Referral>("console:referrals", (firestore) => query(collection(firestore, "saasReferrals"), limit(10000)));
  const openId = params.get("partner");
  const view = (PAGE_VIEWS.find((item) => item.key === params.get("view"))?.key ?? "partners") as PageView;
  const payouts = useLiveQuery<Payout>("console:partner-payouts", (firestore) => query(collection(firestore, "saasPartnerPayouts"), limit(10000)));

  const rows = useMemo<Row[] | null>(() => {
    if (!partners.rows || !referrals.rows) return null;
    return partners.rows
      .map((partner) => {
        const mine = referrals.rows!.filter((referral) => referral.partnerId === partner.id);
        const paid = mine.filter((referral) => referral.paidAt).length;
        const earnedCents = partnerEarnedCents(paid);
        return {
          ...partner,
          trials: mine.length - paid,
          paid,
          earnedCents,
          owedCents: Math.max(0, earnedCents - (partner.paidOutCents ?? 0)),
        };
      })
      .filter((row) => matches(search, row.name, row.business ?? "", row.code, PARTNER_KIND_LABELS[row.kind] ?? row.kind));
  }, [partners.rows, referrals.rows, search]);

  const set = (value: string | null, key = "partner") => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const open = rows?.find((row) => row.id === openId) ?? null;
  const totals = (rows ?? []).reduce(
    (sum, row) => ({ paid: sum.paid + row.paid, owed: sum.owed + row.owedCents }),
    { paid: 0, owed: 0 },
  );

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Partner",
        accessorFn: (row) => row.name,
        meta: { width: 220, flex: true },
        cell: ({ row }) => (
          <span>
            <span className="cx-strong">{row.original.name}</span>
            {row.original.business ? <span className="cx-sub"> · {row.original.business}</span> : null}
          </span>
        ),
      },
      { id: "kind", header: "Type", accessorFn: (row) => PARTNER_KIND_LABELS[row.kind] ?? row.kind, meta: { width: 120, priority: 3 } },
      { id: "code", header: "Code", accessorFn: (row) => row.code, meta: { width: 130 }, cell: ({ row }) => <span className="cx-mono cx-strong">{row.original.code}</span> },
      { id: "trials", header: "In trial", accessorFn: (row) => row.trials, meta: { width: 90, align: "right", priority: 2 } },
      { id: "paid", header: "Paid", accessorFn: (row) => row.paid, meta: { width: 80, align: "right" } },
      { id: "earned", header: "Earned", accessorFn: (row) => row.earnedCents, meta: { width: 100, align: "right" }, cell: ({ row }) => money(row.original.earnedCents) },
      { id: "owed", header: "Owed", accessorFn: (row) => row.owedCents, meta: { width: 100, align: "right" }, cell: ({ row }) => (row.original.owedCents ? <span className="cx-strong">{money(row.original.owedCents)}</span> : "—") },
    ],
    [],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Grow" }, { label: "Partners" }]}>
        {can("partners.write") ? (
          <Button onClick={() => setAdding(true)} variant="primary">
            <Plus size={13} /> Add partner
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={rows?.length ?? null} title="Partners" />
        <p className="cx-page-intro">
          {`Vendors who sell StudioCue to the studios they work with. A studio using a partner's code gets its first year on the annual plan for $900, half the $1,800 list price. The partner earns $100 a studio once that first payment clears, and at ${PARTNER_BOOST_AT} every one is worth $200.`}
        </p>
        {partners.error || referrals.error ? <Notice tone="bad">{partners.error ?? referrals.error}</Notice> : null}
        {rows && rows.length ? (
          <Notice tone="info">{`${totals.paid} paid ${totals.paid === 1 ? "studio" : "studios"} from partners · ${money(totals.owed)} owed`}</Notice>
        ) : null}
        <Tabs label="Partner views" onChange={(key) => set(key === "partners" ? null : key, "view")} tabs={PAGE_VIEWS.map((item) => ({ key: item.key, label: item.label, count: item.key === "payouts" ? (rows ?? []).filter((row) => row.owedCents > 0).length : null }))} value={view} />
        {view === "partners" ? (
          <>
            <FilterBar>
              <SearchInput id="partner-search" onChange={setSearch} placeholder="Filter by name, business, type or code" value={search} />
            </FilterBar>
            <DataTable
              columns={columns}
              empty={<Empty title="No partners yet">Add a DJ, hair or makeup artist or planner, and send them their code.</Empty>}
              getRowId={(row) => row.id}
              initialSort={[{ id: "paid", desc: true }]}
              label="Partners"
              mobile={(row) => ({ title: row.name, end: <span className="cx-mono">{row.code}</span>, meta: `${PARTNER_KIND_LABELS[row.kind] ?? row.kind} · ${row.paid} paid · ${money(row.owedCents)} owed` })}
              onRowClick={(row) => set(row.id)}
              rows={rows}
            />
          </>
        ) : null}
        {view === "payouts" ? <PayoutsView onOpen={(id) => set(id)} rows={rows} /> : null}
        {view === "tax" ? <TaxView partners={rows} payouts={payouts.rows} /> : null}
      </div>

      {adding ? <AddPartner onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); set(id); }} /> : null}
      {open ? (
        <PartnerDrawer
          onClose={() => set(null)}
          partner={open}
          referrals={(referrals.rows ?? []).filter((referral) => referral.partnerId === open.id)}
          studioName={(tenantId) => studios.rows?.find((studio) => studio.tenantId === tenantId || studio.id === tenantId)?.name ?? tenantId}
          toast={toast}
        />
      ) : null}
    </>
  );
}

function AddPartner({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("dj");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const shownCode = codeTouched ? code : name.trim() ? suggestPartnerCode(name) : "";
  const cleanCode = shownCode.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const valid = name.trim().length >= 2 && /^[A-Z0-9][A-Z0-9_-]{2,30}$/.test(cleanCode) && (!email || /\S+@\S+\.\S+/.test(email));
  const submit = async () => {
    const result = await run<{ partnerId: string; code: string }>(
      "createPartner",
      {
        name: name.trim(),
        kind,
        business: business.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        code: cleanCode,
      },
      { done: (outcome) => `${outcome.code} is ready to share.` },
    );
    if (result) onCreated(result.partnerId);
  };
  return (
    <Drawer
      footer={
        <>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button busy={busy === "createPartner"} disabled={!valid} onClick={() => void submit()} variant="primary">
            Add partner
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Add a partner"
    >
      <div className="cx-form">
        <div className="cx-field">
          <label className="cx-label" htmlFor="partner-name">Name</label>
          <input className="cx-input" id="partner-name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Albert Gershengoren" value={name} />
        </div>
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-kind">Type</label>
            <select className="cx-input" id="partner-kind" onChange={(event) => setKind(event.target.value)} value={kind}>
              {Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-business">Business (optional)</label>
            <input className="cx-input" id="partner-business" maxLength={160} onChange={(event) => setBusiness(event.target.value)} value={business} />
          </div>
        </div>
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-email">Email (optional)</label>
            <input className="cx-input" id="partner-email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-phone">Phone (optional)</label>
            <input className="cx-input" id="partner-phone" maxLength={40} onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
          </div>
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="partner-code">Their code</label>
          <input
            className="cx-input cx-mono"
            id="partner-code"
            maxLength={31}
            onChange={(event) => {
              setCodeTouched(true);
              setCode(event.target.value.toUpperCase());
            }}
            value={shownCode}
          />
          <span className="cx-hint">Studios type this at checkout, or open the signup link with it already applied.</span>
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="partner-notes">Notes (optional)</label>
          <textarea className="cx-input" id="partner-notes" maxLength={2000} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
        </div>
      </div>
    </Drawer>
  );
}

function PartnerDrawer({
  partner,
  referrals,
  studioName,
  onClose,
  toast,
}: {
  partner: Row;
  referrals: Referral[];
  studioName: (tenantId: string) => string;
  onClose: () => void;
  toast: (message: string, tone?: "ok" | "bad") => void;
}) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const link = signupLink(partner.code);
  const payoutDollars = amount ? Number(amount) : partner.owedCents / 100;
  const recordPayout = async () => {
    const result = await run(
      "recordPartnerPayout",
      { partnerId: partner.id, amountCents: Math.round(payoutDollars * 100), paidOn, method: partner.payoutMethod ?? null, note: note.trim() || null },
      { done: `${money(Math.round(payoutDollars * 100))} recorded for ${partner.name}.` },
    );
    if (result) {
      setAmount("");
      setNote("");
    }
  };
  const toGo = untilBoost(partner.paid);
  return (
    <Drawer onClose={onClose} open title={partner.name}>
      <KV
        items={[
          ["Type", PARTNER_KIND_LABELS[partner.kind] ?? partner.kind],
          partner.business ? ["Business", partner.business] : null,
          partner.email ? ["Email", partner.email] : null,
          partner.phone ? ["Phone", partner.phone] : null,
          ["Code", <span className="cx-mono cx-strong" key="code">{partner.code}</span>],
          ["Paid studios", `${partner.paid}${toGo ? ` · ${toGo} more to $200 each` : " · $200 each"}`],
          ["Earned", money(partner.earnedCents)],
          ["Paid out", money(partner.paidOutCents ?? 0)],
          ["Owed", money(partner.owedCents)],
          ["Paid by", partner.payoutMethod ? `${PAYOUT_METHOD_LABELS[partner.payoutMethod] ?? partner.payoutMethod}${partner.payoutHandle ? ` · ${partner.payoutHandle}` : ""}` : "Not set"],
          ["W-9", `${TAX_FORM_LABELS[partner.taxFormStatus ?? "not_requested"]}${partner.taxFormReceivedOn ? ` · ${shortDate(`${partner.taxFormReceivedOn}T12:00:00`)}` : ""}`],
        ]}
      />
      <Panel title="Their signup link">
        <div className="cx-inline">
          <input className="cx-input cx-mono" readOnly value={link} />
          <Button onClick={() => copy(link, () => toast("Link copied.", "ok"))}>
            <Copy size={13} /> Copy
          </Button>
        </div>
      </Panel>
      <StatementLinkPanel partner={partner} toast={toast} />
      {can("partners.write") ? <PartnerDetails partner={partner} /> : null}
      <Panel title={`Studios (${referrals.length})`}>
        {referrals.length ? (
          <ul className="cx-partner-studios">
            {referrals
              .slice()
              .sort((left, right) => String(right.signedUpAt ?? "").localeCompare(String(left.signedUpAt ?? "")))
              .map((referral) => (
                <li key={referral.id}>
                  <a href={studioHref(referral.tenantId)}>{studioName(referral.tenantId)}</a>{" "}
                  {referral.paidAt ? (
                    <Pill tone="ok">{`Paid ${shortDate(referral.paidAt)}`}</Pill>
                  ) : (
                    <Pill tone="neutral">{`Signed up ${shortDate(referral.signedUpAt ?? null)}`}</Pill>
                  )}
                </li>
              ))}
          </ul>
        ) : (
          <Empty title="No studios yet">They count here when a studio checks out with this code.</Empty>
        )}
      </Panel>
      {can("partners.write") ? (
        <Panel title="Record a payout">
          <div className="cx-form">
            <div className="cx-row-2">
              <div className="cx-field">
                <label className="cx-label" htmlFor="payout-amount">Amount (USD)</label>
                <input className="cx-input" id="payout-amount" min={1} onChange={(event) => setAmount(event.target.value)} placeholder={String(partner.owedCents / 100)} type="number" value={amount} />
              </div>
              <div className="cx-field">
                <label className="cx-label" htmlFor="payout-date">Paid on</label>
                <input className="cx-input" id="payout-date" onChange={(event) => setPaidOn(event.target.value)} type="date" value={paidOn} />
              </div>
            </div>
            <div className="cx-field">
              <label className="cx-label" htmlFor="payout-note">Note (optional)</label>
              <input className="cx-input" id="payout-note" maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Venmo, check #…" value={note} />
            </div>
            <Button busy={busy === "recordPartnerPayout"} disabled={!(payoutDollars >= 1)} onClick={() => void recordPayout()} variant="primary">
              Record payout
            </Button>
          </div>
        </Panel>
      ) : null}
    </Drawer>
  );
}

/** How they're paid, their W-9, and the rest of their details. */
function PartnerDetails({ partner }: { partner: Row }) {
  const { run, busy } = useCommand();
  const [form, setForm] = useState({
    name: partner.name,
    kind: partner.kind,
    business: partner.business ?? "",
    email: partner.email ?? "",
    phone: partner.phone ?? "",
    notes: partner.notes ?? "",
    payoutMethod: partner.payoutMethod ?? "",
    payoutHandle: partner.payoutHandle ?? "",
    taxFormStatus: partner.taxFormStatus ?? "not_requested",
    taxFormReceivedOn: partner.taxFormReceivedOn ?? "",
  });
  const field = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = () =>
    void run(
      "updatePartner",
      {
        partnerId: partner.id,
        name: form.name.trim(),
        kind: form.kind,
        business: form.business.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        payoutMethod: form.payoutMethod || null,
        payoutHandle: form.payoutHandle.trim() || null,
        taxFormStatus: form.taxFormStatus,
        taxFormReceivedOn: form.taxFormStatus === "received" ? form.taxFormReceivedOn || new Date().toISOString().slice(0, 10) : null,
      },
      { done: "Saved." },
    );
  return (
    <Panel
      actions={
        <Button busy={busy === "updatePartner"} disabled={form.name.trim().length < 2} onClick={save} size="sm" variant="primary">
          Save
        </Button>
      }
      title="Details and payment"
    >
      <div className="cx-form">
        <div className="cx-row-2">
          <PartnerInput id="partner-edit-name" label="Name" onChange={field("name")} value={form.name} />
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-edit-kind">Type</label>
            <select className="cx-input" id="partner-edit-kind" onChange={field("kind")} value={form.kind}>
              {Object.entries(PARTNER_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="cx-row-2">
          <PartnerInput id="partner-edit-email" label="Email" onChange={field("email")} type="email" value={form.email} />
          <PartnerInput id="partner-edit-phone" label="Phone" onChange={field("phone")} type="tel" value={form.phone} />
        </div>
        <PartnerInput id="partner-edit-business" label="Business" onChange={field("business")} value={form.business} />
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-edit-method">Paid by</label>
            <select className="cx-input" id="partner-edit-method" onChange={field("payoutMethod")} value={form.payoutMethod}>
              <option value="">Not set</option>
              {Object.entries(PAYOUT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <PartnerInput id="partner-edit-handle" label="Handle or account" onChange={field("payoutHandle")} placeholder="@venmo, Zelle phone…" value={form.payoutHandle} />
        </div>
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="partner-edit-w9">W-9</label>
            <select className="cx-input" id="partner-edit-w9" onChange={field("taxFormStatus")} value={form.taxFormStatus}>
              {Object.entries(TAX_FORM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {form.taxFormStatus === "received" ? <PartnerInput id="partner-edit-w9-on" label="Received on" onChange={field("taxFormReceivedOn")} type="date" value={form.taxFormReceivedOn} /> : null}
        </div>
        <span className="cx-hint">Keep the W-9 itself, with their taxpayer ID, outside StudioCue. Only whether it's on file is recorded here.</span>
        <div className="cx-field">
          <label className="cx-label" htmlFor="partner-edit-notes">Notes</label>
          <textarea className="cx-input" id="partner-edit-notes" maxLength={2000} onChange={field("notes")} rows={3} value={form.notes} />
        </div>
      </div>
    </Panel>
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

/** The partner's own statement page: no account, just this link. */
function StatementLinkPanel({ partner, toast }: { partner: Row; toast: (message: string, tone?: "ok" | "bad") => void }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://studio-cue.com";
  const link = partner.statementToken ? `${origin}/partner/${partner.statementToken}` : null;
  const issue = async () => {
    const result = await run<{ token: string }>("issuePartnerLink", { partnerId: partner.id }, { done: link ? "New link made. The old one no longer works." : "Link made." });
    if (result?.token) copy(`${origin}/partner/${result.token}`, () => toast("Link copied.", "ok"));
  };
  return (
    <Panel title="Their statement page">
      <span className="cx-hint">What they see: their code and link, how many studios signed up and paid (by date, not by name), what they've earned and been paid. No account needed.</span>
      {link ? (
        <div className="cx-inline">
          <input className="cx-input cx-mono" readOnly value={link} />
          <Button onClick={() => copy(link, () => toast("Link copied.", "ok"))}>
            <Copy size={13} /> Copy
          </Button>
        </div>
      ) : null}
      {can("partners.write") ? (
        <div className="cx-inline">
          <Button busy={busy === "issuePartnerLink"} onClick={() => void issue()} size="sm" variant={link ? "ghost" : "primary"}>
            {link ? "Make a new link" : "Make their link"}
          </Button>
          {link ? (
            <Button busy={busy === "revokePartnerLink"} onClick={() => void run("revokePartnerLink", { partnerId: partner.id }, { done: "Link turned off." })} size="sm" variant="ghost">
              Turn off
            </Button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** Everything owed, paid in one go. Paying happens in Venmo or the bank; this records it. */
function PayoutsView({ rows, onOpen }: { rows: Row[] | null; onOpen: (id: string) => void }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const owed = (rows ?? []).filter((row) => row.owedCents > 0);
  const [selected, setSelected] = useState<string[] | null>(null);
  const chosen = selected ?? owed.map((row) => row.id);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const picked = owed.filter((row) => chosen.includes(row.id));
  const total = picked.reduce((sum, row) => sum + row.owedCents, 0);
  const noW9 = picked.filter((row) => row.taxFormStatus !== "received");
  const record = async () => {
    const result = await run(
      "recordPartnerPayouts",
      { payouts: picked.map((row) => ({ partnerId: row.id, amountCents: row.owedCents, paidOn, method: row.payoutMethod ?? null, reference: reference.trim() || null })) },
      { done: `${money(total)} recorded across ${picked.length} ${picked.length === 1 ? "partner" : "partners"}.` },
    );
    if (result) setSelected(null);
  };
  const exportCsv = () =>
    downloadCsv(
      `partner-payouts-${paidOn}.csv`,
      toCsv(["Partner", "Business", "Code", "Owed (USD)", "Paid by", "Handle", "W-9"], picked.map((row) => [row.name, row.business ?? "", row.code, (row.owedCents / 100).toFixed(2), PAYOUT_METHOD_LABELS[row.payoutMethod ?? ""] ?? "", row.payoutHandle ?? "", TAX_FORM_LABELS[row.taxFormStatus ?? "not_requested"]])),
    );
  if (!rows) return <Empty title="Loading…" />;
  if (!owed.length) return <Empty title="Nothing owed">Commission shows here once a partner's studio pays its first annual invoice.</Empty>;
  return (
    <Panel
      actions={
        <>
          <Button disabled={!picked.length} onClick={exportCsv} size="sm" variant="ghost">Export CSV</Button>
          {can("partners.write") ? (
            <Button busy={busy === "recordPartnerPayouts"} disabled={!picked.length} onClick={() => void record()} size="sm" variant="primary">
              {`Record ${money(total)} paid`}
            </Button>
          ) : null}
        </>
      }
      flush
      title={`Owed · ${money(owed.reduce((sum, row) => sum + row.owedCents, 0))}`}
    >
      <div className="cx-form" style={{ padding: 12 }}>
        <div className="cx-row-2">
          <PartnerInput id="payouts-date" label="Paid on" onChange={(event) => setPaidOn(event.target.value)} type="date" value={paidOn} />
          <PartnerInput id="payouts-ref" label="Reference (optional)" onChange={(event) => setReference(event.target.value)} placeholder="October payouts" value={reference} />
        </div>
        {noW9.length ? <Notice tone="warn">{`No W-9 on file for ${noW9.map((row) => row.name).join(", ")}. Ask for one before paying: anyone paid ${money(form1099Cents(Number(paidOn.slice(0, 4))))} or more in a year needs a 1099-NEC.`}</Notice> : null}
      </div>
      <div className="cx-table-wrap" style={{ border: 0, borderRadius: 0 }}>
        <table aria-label="Commission owed" className="cx-table">
          <thead>
            <tr>
              <th className="cx-th">Pay</th>
              <th className="cx-th">Partner</th>
              <th className="cx-th" data-align="right">Owed</th>
              <th className="cx-th">Paid by</th>
              <th className="cx-th">W-9</th>
            </tr>
          </thead>
          <tbody>
            {owed.map((row) => (
              <tr className="cx-row" key={row.id}>
                <td className="cx-td">
                  <input
                    aria-label={`Pay ${row.name}`}
                    checked={chosen.includes(row.id)}
                    onChange={(event) => setSelected(event.target.checked ? [...chosen, row.id] : chosen.filter((id) => id !== row.id))}
                    type="checkbox"
                  />
                </td>
                <td className="cx-td">
                  <button className="cx-link" onClick={() => onOpen(row.id)} type="button">{row.name}</button>
                </td>
                <td className="cx-td" data-align="right">{money(row.owedCents)}</td>
                <td className="cx-td">{row.payoutMethod ? `${PAYOUT_METHOD_LABELS[row.payoutMethod] ?? row.payoutMethod}${row.payoutHandle ? ` · ${row.payoutHandle}` : ""}` : "Not set"}</td>
                <td className="cx-td">
                  <Pill tone={row.taxFormStatus === "received" ? "ok" : "warn"}>{TAX_FORM_LABELS[row.taxFormStatus ?? "not_requested"]}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** What each partner was paid in a calendar year, and who needs a 1099-NEC. */
function TaxView({ partners, payouts }: { partners: Row[] | null; payouts: Payout[] | null }) {
  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set([thisYear, ...(payouts ?? []).map((payout) => Number(payout.paidOn.slice(0, 4)))])).sort((a, b) => b - a);
  const [year, setYear] = useState(thisYear);
  if (!partners || !payouts) return <Empty title="Loading…" />;
  const totals = partners
    .map((partner) => ({
      partner,
      cents: payouts.filter((payout) => payout.partnerId === partner.id && payout.paidOn.startsWith(String(year))).reduce((sum, payout) => sum + payout.amountCents, 0),
    }))
    .filter((row) => row.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const line = form1099Cents(year);
  const needs = totals.filter((row) => row.cents >= line);
  const exportCsv = () =>
    downloadCsv(
      `partner-1099-${year}.csv`,
      toCsv(["Partner", "Business", "Email", `Paid in ${year} (USD)`, "1099-NEC", "W-9"], totals.map((row) => [row.partner.name, row.partner.business ?? "", row.partner.email ?? "", (row.cents / 100).toFixed(2), row.cents >= line ? "Yes" : "No", TAX_FORM_LABELS[row.partner.taxFormStatus ?? "not_requested"]])),
    );
  return (
    <Panel
      actions={
        <>
          <select aria-label="Year" className="cx-input" onChange={(event) => setYear(Number(event.target.value))} style={{ width: 110 }} value={year}>
            {years.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <Button disabled={!totals.length} onClick={exportCsv} size="sm" variant="ghost">Export CSV</Button>
        </>
      }
      flush
      title={`Paid in ${year} · ${needs.length} need a 1099-NEC`}
    >
      {totals.length ? (
        <div className="cx-table-wrap" style={{ border: 0, borderRadius: 0 }}>
          <table aria-label={`Partner payments in ${year}`} className="cx-table">
            <thead>
              <tr>
                <th className="cx-th">Partner</th>
                <th className="cx-th" data-align="right">{`Paid in ${year}`}</th>
                <th className="cx-th">1099-NEC</th>
                <th className="cx-th">W-9</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr className="cx-row" key={row.partner.id}>
                  <td className="cx-td">{row.partner.name}</td>
                  <td className="cx-td" data-align="right">{money(row.cents)}</td>
                  <td className="cx-td">{row.cents >= line ? <Pill tone="warn">Needed</Pill> : <span className="cx-sub">{`Under ${money(line)}`}</span>}</td>
                  <td className="cx-td">
                    <Pill tone={row.partner.taxFormStatus === "received" ? "ok" : "warn"}>{TAX_FORM_LABELS[row.partner.taxFormStatus ?? "not_requested"]}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={`No payouts recorded in ${year}`} />
      )}
      <p className="cx-hint" style={{ padding: 12 }}>
        {`A 1099-NEC goes to each partner paid ${money(line)} or more in ${year}, by January 31, and to the IRS. Totals are by the date each payout was recorded as paid. Confirm the threshold with your accountant.`}
      </p>
    </Panel>
  );
}
