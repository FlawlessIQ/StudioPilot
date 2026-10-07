"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Plus } from "lucide-react";
import {
  PARTNER_BOOST_AT,
  PARTNER_KIND_LABELS,
  partnerEarnedCents,
  suggestPartnerCode,
  untilBoost,
} from "@/features/console/partners";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill } from "../ui";
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
  createdAt?: string;
};

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

  const set = (value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete("partner");
    else next.set("partner", value);
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
      <Topbar crumbs={[{ label: "Billing" }, { label: "Partners" }]}>
        {can("partners.write") ? (
          <Button onClick={() => setAdding(true)} variant="primary">
            <Plus size={13} /> Add partner
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={rows?.length ?? null} title="Partners" />
        <p className="cx-page-intro">
          {`Vendors who sell StudioCue to the studios they work with. A studio using a partner's code gets its first year on the annual plan for $900. The partner earns $100 a studio once that first payment clears, and at ${PARTNER_BOOST_AT} every one is worth $200.`}
        </p>
        {partners.error || referrals.error ? <Notice tone="bad">{partners.error ?? referrals.error}</Notice> : null}
        {rows && rows.length ? (
          <Notice tone="info">{`${totals.paid} paid ${totals.paid === 1 ? "studio" : "studios"} from partners · ${money(totals.owed)} owed`}</Notice>
        ) : null}
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
      { partnerId: partner.id, amountCents: Math.round(payoutDollars * 100), paidOn, note: note.trim() || null },
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
