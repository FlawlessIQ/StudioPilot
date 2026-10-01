"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Copy, Download, Plus, RefreshCw } from "lucide-react";
import { describeDiscount, previewDiscount } from "@/features/console/discount-preview";
import { PLAN_LABELS, PLAN_LIST_PRICE_CENTS } from "@/features/console/model";
import { money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { downloadCsv, studioHref, toCsv } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { BulkBar, FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * Discount codes (docs/console.md): Stripe promotion codes limited to
 * StudioCue's products. Studios type one at Checkout or arrive with it on a
 * signup link. Create one, or a batch of single-use codes, from here.
 */
type Code = {
  id: string;
  kind: "promotion_code" | "batch";
  code?: string;
  couponId?: string;
  label?: string | null;
  summary?: string;
  percentOff?: number | null;
  amountOffCents?: number | null;
  duration?: "once" | "repeating" | "forever";
  durationMonths?: number | null;
  plans?: Array<"studio" | "multi_brand">;
  maxRedemptions?: number | null;
  timesRedeemed?: number;
  expiresAt?: string | null;
  firstTimeOnly?: boolean;
  active?: boolean;
  batchId?: string | null;
  prefix?: string;
  count?: number;
  createdAt?: string;
};

type View = "active" | "ended" | "inactive" | "batches";

function codeState(code: Code, now = Date.now()): "active" | "expired" | "used_up" | "inactive" {
  if (code.active === false) return "inactive";
  if (code.expiresAt && Date.parse(code.expiresAt) <= now) return "expired";
  if (code.maxRedemptions && (code.timesRedeemed ?? 0) >= code.maxRedemptions) return "used_up";
  return "active";
}

const STATE_LABEL = { active: "Active", expired: "Expired", used_up: "Used up", inactive: "Deactivated" } as const;
const STATE_TONE = { active: "ok", expired: "neutral", used_up: "neutral", inactive: "neutral" } as const;

export function signupLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://studio-cue.com";
  return `${origin}/auth/register?code=${encodeURIComponent(code)}`;
}

function copy(text: string, done: () => void) {
  void navigator.clipboard?.writeText(text).then(done).catch(() => undefined);
}

export function CodesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, studios, toast } = useConsole();
  const { run, busy } = useCommand();
  const view = (["active", "ended", "inactive", "batches"].includes(params.get("view") ?? "") ? params.get("view") : "active") as View;
  const openId = params.get("code");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<null | "single" | "batch">(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [deactivating, setDeactivating] = useState<string[] | null>(null);
  const codes = useLiveQuery<Code>("console:codes", (firestore) => query(collection(firestore, "saasDiscounts"), limit(5000)));
  const all = codes.rows;
  const promos = (all ?? []).filter((code) => code.kind === "promotion_code");
  const batches = (all ?? []).filter((code) => code.kind === "batch");
  const studiosByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const studio of studios.rows ?? []) if (studio.discount?.code) map.set(studio.discount.code, (map.get(studio.discount.code) ?? 0) + 1);
    return map;
  }, [studios.rows]);
  const rows = useMemo(() => {
    if (!all) return null;
    const list = promos.filter((code) => {
      const state = codeState(code);
      if (view === "active") return state === "active";
      if (view === "ended") return state === "expired" || state === "used_up";
      if (view === "inactive") return state === "inactive";
      return false;
    });
    // A batch's hundred codes would bury everything else; they live under Batches.
    return list.filter((code) => (view === "active" ? !code.batchId : true) && matches(search, code.code, code.label, code.summary));
  }, [all, promos, view, search]);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const open = promos.find((code) => code.id === openId) ?? null;
  const openBatch = batches.find((batch) => batch.id === openId) ?? null;

  const columns = useMemo<ColumnDef<Code, unknown>[]>(
    () => [
      {
        id: "code",
        header: "Code",
        accessorFn: (code) => code.code ?? "",
        meta: { width: 170 },
        cell: ({ row }) => <span className="cx-mono cx-strong">{row.original.code}</span>,
      },
      { id: "discount", header: "Discount", accessorFn: (code) => code.summary ?? "", meta: { width: 200, flex: true }, cell: ({ row }) => <span>{row.original.summary}{row.original.label ? <span className="cx-sub"> · {row.original.label}</span> : null}</span> },
      { id: "plans", header: "Plans", accessorFn: (code) => (code.plans ?? []).join(","), meta: { width: 140, priority: 4 }, cell: ({ row }) => (row.original.plans ?? []).map((plan) => PLAN_LABELS[plan] ?? plan).join(", ") || "All" },
      {
        id: "redeemed",
        header: "Redeemed",
        accessorFn: (code) => code.timesRedeemed ?? 0,
        meta: { width: 100, align: "right" },
        cell: ({ row }) => `${row.original.timesRedeemed ?? 0} / ${row.original.maxRedemptions ?? "∞"}`,
      },
      { id: "studios", header: "Studios on it", accessorFn: (code) => studiosByCode.get(code.code ?? "") ?? 0, meta: { width: 110, align: "right", priority: 2 }, cell: ({ row }) => studiosByCode.get(row.original.code ?? "") ?? 0 },
      { id: "expires", header: "Expires", accessorFn: (code) => code.expiresAt ?? "9999", meta: { width: 100, priority: 3 }, cell: ({ row }) => (row.original.expiresAt ? shortDate(row.original.expiresAt) : <span className="cx-dim">Never</span>) },
      {
        id: "state",
        header: "Status",
        accessorFn: (code) => codeState(code),
        meta: { width: 110 },
        cell: ({ row }) => {
          const state = codeState(row.original);
          return <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>;
        },
      },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) => (
          <ActionMenu
            iconOnly
            items={[
              { label: "Copy code", onSelect: () => copy(row.original.code ?? "", () => toast("Code copied.")) },
              { label: "Copy signup link", onSelect: () => copy(signupLink(row.original.code ?? ""), () => toast("Signup link copied.")) },
              ...(can("codes.write") && row.original.active !== false ? [{ kind: "separator" as const }, { label: "Deactivate…", danger: true, onSelect: () => setDeactivating([row.original.id]) }] : []),
            ]}
            label={`Actions for ${row.original.code}`}
          />
        ),
      },
    ],
    [can, studiosByCode, toast],
  );

  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  return (
    <>
      <Topbar crumbs={[{ label: "Billing" }, { label: "Discount codes" }]}>
        <Button busy={busy === "syncCodes"} onClick={() => void run("syncCodes", {}, { done: (result: { updated?: number }) => (result.updated ? `${result.updated} codes refreshed from Stripe.` : "Codes are up to date.") })} variant="ghost">
          <RefreshCw size={13} /> Sync
        </Button>
        {can("codes.write") ? (
          <>
            <Button onClick={() => setCreating("batch")}>Generate batch</Button>
            <Button onClick={() => setCreating("single")} variant="primary">
              <Plus size={13} /> New code
            </Button>
          </>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={promos.filter((code) => codeState(code) === "active").length} title="Discount codes" />
        <p className="cx-page-intro">Codes apply only to StudioCue&apos;s plans in Stripe. A studio types one at checkout, or opens a signup link with it already applied.</p>
        {codes.error ? <Notice tone="bad">{codes.error}</Notice> : null}
        <Tabs
          label="Code views"
          onChange={(key) => set("view", key === "active" ? null : key)}
          tabs={[
            { key: "active" as const, label: "Active", count: promos.filter((code) => codeState(code) === "active" && !code.batchId).length },
            { key: "ended" as const, label: "Expired or used up", count: promos.filter((code) => ["expired", "used_up"].includes(codeState(code))).length },
            { key: "inactive" as const, label: "Deactivated", count: promos.filter((code) => codeState(code) === "inactive").length },
            { key: "batches" as const, label: "Batches", count: batches.length },
          ]}
          value={view}
        />
        {view === "batches" ? (
          <DataTable
            columns={[
              { id: "prefix", header: "Batch", accessorFn: (batch: Code) => batch.prefix ?? "", meta: { width: 160 }, cell: ({ row }) => <span className="cx-mono cx-strong">{row.original.prefix}-****</span> },
              { id: "summary", header: "Discount", accessorFn: (batch: Code) => batch.summary ?? "", meta: { width: 220, flex: true }, cell: ({ row }) => <span>{row.original.summary}{row.original.label ? <span className="cx-sub"> · {row.original.label}</span> : null}</span> },
              { id: "used", header: "Redeemed", accessorFn: (batch: Code) => promos.filter((code) => code.batchId === batch.id && (code.timesRedeemed ?? 0) > 0).length, meta: { width: 110, align: "right" }, cell: ({ row }) => `${promos.filter((code) => code.batchId === row.original.id && (code.timesRedeemed ?? 0) > 0).length} / ${row.original.count ?? 0}` },
              { id: "expires", header: "Expires", accessorFn: (batch: Code) => batch.expiresAt ?? "", meta: { width: 110 }, cell: ({ row }) => (row.original.expiresAt ? shortDate(row.original.expiresAt) : "Never") },
              { id: "created", header: "Created", accessorFn: (batch: Code) => batch.createdAt ?? "", meta: { width: 110, priority: 2 }, cell: ({ row }) => shortDate(row.original.createdAt) },
            ]}
            empty={<Empty title="No batches">Generate a batch of single-use codes for a show or a mailing.</Empty>}
            getRowId={(batch) => batch.id}
            label="Batches"
            onRowClick={(batch) => set("code", batch.id)}
            rows={all ? batches : null}
          />
        ) : (
          <>
            {selectedIds.length ? (
              <BulkBar count={selectedIds.length} onClear={() => setSelection({})}>
                <button className="cx-btn" onClick={() => setDeactivating(selectedIds)} type="button">
                  Deactivate
                </button>
              </BulkBar>
            ) : (
              <FilterBar>
                <SearchInput id="code-search" onChange={setSearch} placeholder="Filter by code or label" value={search} />
              </FilterBar>
            )}
            <DataTable
              columns={columns}
              empty={<Empty title={promos.length ? "No codes in this view" : "No discount codes yet"}>Create a code to give a studio money off.</Empty>}
              getRowId={(code) => code.id}
              initialSort={[{ id: "redeemed", desc: true }]}
              label="Discount codes"
              mobile={(code) => ({ title: code.code, end: <Pill tone={STATE_TONE[codeState(code)]}>{STATE_LABEL[codeState(code)]}</Pill>, meta: `${code.summary} · ${code.timesRedeemed ?? 0} redeemed` })}
              onRowClick={(code) => set("code", code.id)}
              onSelectionChange={setSelection}
              rows={rows}
              selectable={can("codes.write") && view === "active"}
              selection={selection}
            />
          </>
        )}
      </div>

      <CodeDrawer
        batchCodes={openBatch ? promos.filter((code) => code.batchId === openBatch.id) : []}
        code={open}
        onClose={() => set("code", null)}
        onDeactivate={(ids) => setDeactivating(ids)}
        batch={openBatch}
      />
      <CreateCodeDrawer mode={creating} onClose={() => setCreating(null)} />
      <ConfirmDialog
        busy={busy === "deactivateCode"}
        confirmLabel={deactivating && deactivating.length > 1 ? `Deactivate ${deactivating.length} codes` : "Deactivate code"}
        danger
        description="It can't be redeemed after this. Studios already using it keep their discount until it runs out."
        onClose={() => setDeactivating(null)}
        onConfirm={async () => {
          if (!deactivating) return;
          const result = await run("deactivateCode", { ids: deactivating }, { done: deactivating.length > 1 ? `${deactivating.length} codes deactivated.` : "Code deactivated." });
          if (result) {
            setDeactivating(null);
            setSelection({});
          }
        }}
        open={deactivating !== null}
        requireReason={false}
        title="Deactivate"
      />
    </>
  );
}

function CodeDrawer({ code, batch, batchCodes, onClose, onDeactivate }: { code: Code | null; batch: Code | null; batchCodes: Code[]; onClose: () => void; onDeactivate: (ids: string[]) => void }) {
  const { studios, toast, can } = useConsole();
  const router = useRouter();
  if (batch) {
    return (
      <Drawer
        footer={
          <Button
            onClick={() =>
              downloadCsv(
                `${batch.prefix}-codes.csv`,
                toCsv(["Code", "Signup link", "Redeemed", "Active"], batchCodes.map((item) => [item.code, signupLink(item.code ?? ""), item.timesRedeemed ?? 0, item.active === false ? "no" : "yes"])),
              )
            }
          >
            <Download size={13} /> Download codes
          </Button>
        }
        onClose={onClose}
        open
        title={`${batch.prefix} batch`}
        wide
      >
        <KV items={[["Discount", batch.summary ?? "—"], ["Codes", String(batch.count ?? batchCodes.length)], ["Redeemed", String(batchCodes.filter((item) => (item.timesRedeemed ?? 0) > 0).length)], ["Expires", batch.expiresAt ? shortDate(batch.expiresAt) : "Never"]]} />
        <div className="cx-table-wrap">
          <table className="cx-table" aria-label="Codes in this batch">
            <thead>
              <tr>
                <th className="cx-th">Code</th>
                <th className="cx-th" data-align="right">Redeemed</th>
              </tr>
            </thead>
            <tbody>
              {batchCodes.map((item) => (
                <tr className="cx-row" key={item.id}>
                  <td className="cx-td"><span className="cx-mono">{item.code}</span></td>
                  <td className="cx-td" data-align="right">{item.timesRedeemed ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Drawer>
    );
  }
  if (!code) return null;
  const users = (studios.rows ?? []).filter((studio) => studio.discount?.code === code.code);
  const link = signupLink(code.code ?? "");
  const state = codeState(code);
  return (
    <Drawer
      footer={
        can("codes.write") && code.active !== false ? (
          <Button onClick={() => onDeactivate([code.id])} variant="danger">
            Deactivate
          </Button>
        ) : undefined
      }
      onClose={onClose}
      open
      title={code.code ?? "Code"}
    >
      <div className="cx-inline">
        <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
        <span>{code.summary}</span>
      </div>
      <Panel title="Share">
        <div className="cx-inline">
          <span className="cx-mono cx-strong" style={{ flex: 1 }}>{code.code}</span>
          <Button onClick={() => copy(code.code ?? "", () => toast("Code copied."))} size="sm">
            <Copy size={12} /> Copy
          </Button>
        </div>
        <div className="cx-inline">
          <span className="cx-mono cx-sub" style={{ flex: 1 }}>{link}</span>
          <Button onClick={() => copy(link, () => toast("Signup link copied."))} size="sm">
            <Copy size={12} /> Copy link
          </Button>
        </div>
      </Panel>
      <Panel title="Terms">
        <KV
          items={[
            ["Discount", code.summary ?? "—"],
            ["Plans", (code.plans ?? []).map((plan) => PLAN_LABELS[plan] ?? plan).join(", ") || "All"],
            ["Redeemed", `${code.timesRedeemed ?? 0} of ${code.maxRedemptions ?? "unlimited"}`],
            ["Expires", code.expiresAt ? shortDate(code.expiresAt) : "Never"],
            ["New studios only", code.firstTimeOnly ? "Yes" : "No"],
            code.label ? ["Label", code.label] : null,
            ["Created", shortDate(code.createdAt)],
          ]}
        />
      </Panel>
      <Panel flush title={`Studios on it · ${users.length}`}>
        {users.length ? (
          <div className="cx-timeline">
            {users.map((studio) => (
              <button className="cx-item" key={studio.tenantId} onClick={() => router.push(studioHref(studio.tenantId, "billing"))} type="button">
                <span className="cx-item-title">{studio.name}</span>
                <span className="cx-item-time">{money(studio.mrrCents)}/mo</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No studio has it applied right now" />
        )}
      </Panel>
    </Drawer>
  );
}

function CreateCodeDrawer({ mode, onClose }: { mode: null | "single" | "batch"; onClose: () => void }) {
  // Mounts fresh each time, so a code half-made for one batch never carries over.
  return mode ? <CreateCodeBody key={mode} mode={mode} onClose={onClose} /> : null;
}

function CreateCodeBody({ mode, onClose }: { mode: "single" | "batch"; onClose: () => void }) {
  const { run, busy } = useCommand();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [prefix, setPrefix] = useState("SHOW");
  const [count, setCount] = useState(50);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState(20);
  const [duration, setDuration] = useState<"once" | "repeating" | "forever">("repeating");
  const [months, setMonths] = useState(3);
  const [plans, setPlans] = useState<Array<"studio" | "multi_brand">>(["studio", "multi_brand"]);
  const [max, setMax] = useState<string>("");
  const [expires, setExpires] = useState("");
  const [firstTime, setFirstTime] = useState(true);
  const [previewPlan, setPreviewPlan] = useState("studio:monthly");
  const [created, setCreated] = useState<string[] | null>(null);
  const now = useNow();
  const terms = {
    percentOff: kind === "percent" ? value : null,
    amountOffCents: kind === "amount" ? Math.round(value * 100) : null,
    duration,
    durationMonths: duration === "repeating" ? months : null,
  };
  const [planKey, cadence] = previewPlan.split(":") as ["studio" | "multi_brand", "monthly" | "yearly"];
  const preview = previewDiscount(terms, PLAN_LIST_PRICE_CENTS[planKey]![cadence], cadence);
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const valid =
    (mode === "batch" ? /^[A-Z0-9]{2,12}$/.test(prefix) && count >= 2 && count <= 200 : /^[A-Z0-9][A-Z0-9_-]{2,30}$/.test(cleanCode)) &&
    value > 0 &&
    (kind === "amount" || value <= 100) &&
    plans.length > 0;
  const payload = {
    label: label.trim() || null,
    ...terms,
    plans,
    maxRedemptions: mode === "batch" ? null : max ? Number(max) : null,
    expiresAt: expires ? new Date(`${expires}T23:59:00`).toISOString() : null,
    firstTimeOnly: firstTime,
  };
  const submit = async () => {
    if (mode === "single") {
      const result = await run<{ id: string; code: string }>("createDiscountCode", { code: cleanCode, terms: payload }, { done: (outcome) => `${outcome.code} created.` });
      if (result) {
        onClose();
        router.replace(`/platform-admin/codes?code=${encodeURIComponent(result.id)}`);
      }
    } else {
      const result = await run<{ codes: string[] }>("generateCodeBatch", { prefix, count, terms: payload }, { done: (outcome) => `${outcome.codes.length} codes created.` });
      if (result) setCreated(result.codes);
    }
  };
  const randomCode = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    setCode(`SC-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`);
  };

  return (
    <Drawer
      footer={
        created ? (
          <>
            <Button onClick={() => downloadCsv(`${prefix}-codes.csv`, toCsv(["Code", "Signup link"], created.map((item) => [item, signupLink(item)])))}>
              <Download size={13} /> Download codes
            </Button>
            <Button onClick={onClose} variant="primary">Done</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} variant="ghost">Cancel</Button>
            <Button busy={busy === "createDiscountCode" || busy === "generateCodeBatch"} disabled={!valid} onClick={() => void submit()} variant="primary">
              {mode === "batch" ? `Create ${count} codes` : "Create code"}
            </Button>
          </>
        )
      }
      onClose={onClose}
      open
      title={mode === "batch" ? "Generate a batch of codes" : "New discount code"}
    >
      {created ? (
        <Notice tone="ok" title={`${created.length} single-use codes created`}>
          Download them now; each works once, for one studio. They&apos;re also under Batches.
        </Notice>
      ) : (
        <div className="cx-form">
          {mode === "single" ? (
            <div className="cx-field">
              <label className="cx-label" htmlFor="code-code">Code</label>
              <div className="cx-inline">
                <input className="cx-input cx-mono" id="code-code" maxLength={31} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="WINTER25" value={code} />
                <Button onClick={randomCode}>Generate</Button>
              </div>
              <span className="cx-hint">Letters, numbers, dashes. Studios type this at checkout.</span>
            </div>
          ) : (
            <div className="cx-row-2">
              <div className="cx-field">
                <label className="cx-label" htmlFor="code-prefix">Prefix</label>
                <input className="cx-input cx-mono" id="code-prefix" maxLength={12} onChange={(event) => setPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} value={prefix} />
              </div>
              <div className="cx-field">
                <label className="cx-label" htmlFor="code-count">How many</label>
                <input className="cx-input" id="code-count" max={200} min={2} onChange={(event) => setCount(Number(event.target.value))} type="number" value={count} />
              </div>
            </div>
          )}
          <div className="cx-field">
            <label className="cx-label" htmlFor="code-label">Label (for you)</label>
            <input className="cx-input" id="code-label" maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="Fall promo, WPPI 2027…" value={label} />
          </div>
          <div className="cx-field">
            <span className="cx-label">Discount</span>
            <div className="cx-row-2">
              <div className="cx-segmented">
                <button aria-pressed={kind === "percent"} onClick={() => setKind("percent")} type="button">Percent</button>
                <button aria-pressed={kind === "amount"} onClick={() => setKind("amount")} type="button">Amount ($)</button>
              </div>
              <input aria-label={kind === "percent" ? "Percent off" : "Dollars off"} className="cx-input" min={1} onChange={(event) => setValue(Number(event.target.value))} step={kind === "percent" ? 1 : 0.01} type="number" value={value} />
            </div>
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor="code-duration">Lasts</label>
            <div className="cx-row-2">
              <select className="cx-select-input" id="code-duration" onChange={(event) => setDuration(event.target.value as typeof duration)} value={duration}>
                <option value="once">First payment only</option>
                <option value="repeating">A number of months</option>
                <option value="forever">Forever</option>
              </select>
              {duration === "repeating" ? <input aria-label="Months" className="cx-input" max={36} min={1} onChange={(event) => setMonths(Number(event.target.value))} type="number" value={months} /> : <span />}
            </div>
          </div>
          <div className="cx-field">
            <span className="cx-label">Applies to</span>
            <div className="cx-checks">
              {(["studio", "multi_brand"] as const).map((plan) => (
                <label className="cx-check" key={plan}>
                  <input checked={plans.includes(plan)} onChange={(event) => setPlans((list) => (event.target.checked ? [...list, plan] : list.filter((item) => item !== plan)))} type="checkbox" />
                  {PLAN_LABELS[plan]}
                </label>
              ))}
            </div>
          </div>
          <div className="cx-row-2">
            {mode === "single" ? (
              <div className="cx-field">
                <label className="cx-label" htmlFor="code-max">Max redemptions</label>
                <input className="cx-input" id="code-max" min={1} onChange={(event) => setMax(event.target.value)} placeholder="Unlimited" type="number" value={max} />
              </div>
            ) : (
              <div className="cx-field">
                <span className="cx-label">Redemptions</span>
                <span className="cx-hint">Each code works once.</span>
              </div>
            )}
            <div className="cx-field">
              <label className="cx-label" htmlFor="code-expires">Expires</label>
              <input className="cx-input" id="code-expires" min={new Date(now + 86_400_000).toISOString().slice(0, 10)} onChange={(event) => setExpires(event.target.value)} type="date" value={expires} />
            </div>
          </div>
          <label className="cx-check">
            <input checked={firstTime} onChange={(event) => setFirstTime(event.target.checked)} type="checkbox" />
            New studios only (their first subscription)
          </label>
          <div className="cx-field">
            <label className="cx-label" htmlFor="code-preview-plan">Preview on</label>
            <select className="cx-select-input" id="code-preview-plan" onChange={(event) => setPreviewPlan(event.target.value)} value={previewPlan}>
              {Object.entries(PLAN_LIST_PRICE_CENTS).flatMap(([plan, prices]) =>
                (["monthly", "yearly"] as const).map((item) => (
                  <option key={`${plan}:${item}`} value={`${plan}:${item}`}>
                    {PLAN_LABELS[plan]}, {item} ({money(prices[item])})
                  </option>
                )),
              )}
            </select>
          </div>
          <div aria-live="polite" className="cx-preview">
            <span className="cx-preview-big">{preview.summary}</span>
            <span className="cx-hint">
              {preview.periods === null ? `Saves the studio ${money(preview.savingCents, { cents: true })} every ${cadence === "yearly" ? "year" : "month"}.` : `Then ${money(preview.listCents, { cents: true })}. Saves the studio ${money(preview.savingCents, { cents: true })}.`}
            </span>
            <span className="cx-hint">{describeDiscount(terms)}</span>
          </div>
        </div>
      )}
    </Drawer>
  );
}
