"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Columns3, List, Plus } from "lucide-react";
import {
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_TONES,
  MANUAL_LEAD_STAGES,
  effectiveLeadStage,
  leadNeedsYou,
  pipelineSummary,
  type Lead,
  type LeadStage,
} from "@/features/console/pipeline";
import { CHANNEL_LABELS, SOURCE_CHANNELS, type PartnerRef } from "@/features/console/sources";
import { HEARD_OPTIONS } from "@/features/growth/attribution";
import { relative, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { useAdmins } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { NotesPanel } from "../notes";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Pill, Stat, StatStrip } from "../ui";
import { useCommand } from "../use-command";

/**
 * Pipeline (docs/console.md, "Pipeline"): photographers who might become
 * studios. "Book a demo" on the website files them here; anyone else is
 * added by hand. Once they sign up with the same email, their studio decides
 * where they stand (features/console/pipeline.ts).
 */

type Row = Lead & { now: LeadStage; needs: "new" | "due" | null; linkedStudio: string | null };

const HEARD_LABEL = Object.fromEntries(HEARD_OPTIONS.map((option) => [option.value, option.label])) as Record<string, string>;

export function usePipeline() {
  const { studios } = useConsole();
  const leads = useLiveQuery<Lead>("console:leads", (firestore) => query(collection(firestore, "saasLeads"), limit(5000)));
  const now = useNow();
  const rows = useMemo<Row[] | null>(() => {
    if (!leads.rows || !studios.rows) return null;
    return leads.rows.map((lead) => {
      const studio = lead.tenantId ? studios.rows!.find((item) => item.tenantId === lead.tenantId) : null;
      const stage = effectiveLeadStage(lead, studio);
      return { ...lead, now: stage, needs: leadNeedsYou(lead, stage, now), linkedStudio: studio?.name ?? null };
    });
  }, [leads.rows, studios.rows, now]);
  return { rows, error: leads.error };
}

export function PipelinePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useConsole();
  const now = useNow();
  const { rows, error } = usePipeline();
  const [search, setSearch] = useState("");
  const layout = params.get("layout") === "table" ? "table" : "board";
  const openId = params.get("lead");

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const shown = (rows ?? []).filter((row) => matches(search, row.name, row.studioName, row.linkedStudio, row.email, row.instagram, row.location));
  const summary = pipelineSummary((rows ?? []).map((row) => row.now));
  const needs = (rows ?? []).filter((row) => row.needs).length;
  const open = openId === "new" ? "new" : (rows ?? []).find((row) => row.id === openId) ?? null;

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Photographer",
        accessorFn: (row) => row.name,
        meta: { width: 220, flex: true },
        cell: ({ row }) => (
          <span>
            <span className="cx-strong">{row.original.name}</span>
            {row.original.studioName ? <span className="cx-sub">{` · ${row.original.studioName}`}</span> : null}
          </span>
        ),
      },
      { id: "stage", header: "Stage", accessorFn: (row) => LEAD_STAGES.indexOf(row.now), meta: { width: 130 }, cell: ({ row }) => <Pill tone={LEAD_STAGE_TONES[row.original.now]}>{LEAD_STAGE_LABELS[row.original.now]}</Pill> },
      { id: "source", header: "Source", accessorFn: (row) => (row.source ? CHANNEL_LABELS[row.source] : ""), meta: { width: 150, priority: 3 } },
      {
        id: "next",
        header: "Next step",
        accessorFn: (row) => row.nextStepAt ?? "9999",
        meta: { width: 220, priority: 2 },
        cell: ({ row }) =>
          row.original.nextStep ? (
            <span>
              {row.original.needs === "due" ? <Pill tone="warn">Due</Pill> : null} {row.original.nextStep}
              {row.original.nextStepAt ? <span className="cx-sub">{` · ${shortDate(`${row.original.nextStepAt}T12:00:00`, now)}`}</span> : null}
            </span>
          ) : (
            <span className="cx-sub">—</span>
          ),
      },
      { id: "owner", header: "Owner", accessorFn: (row) => row.ownerEmail ?? "", meta: { width: 160, priority: 4 } },
      { id: "created", header: "Added", accessorFn: (row) => row.createdAt ?? "", meta: { width: 100, priority: 3 }, cell: ({ row }) => relative(row.original.createdAt, now) },
    ],
    [now],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Grow" }, { label: "Pipeline" }]}>
        {can("crm.write") ? (
          <Button onClick={() => set("lead", "new")} variant="primary">
            <Plus size={13} /> Add lead
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={summary.open} title="Pipeline">
          <div className="cx-segmented" style={{ width: 180 }}>
            <button aria-pressed={layout === "board"} onClick={() => set("layout", null)} type="button">
              <Columns3 size={13} /> Board
            </button>
            <button aria-pressed={layout === "table"} onClick={() => set("layout", "table")} type="button">
              <List size={13} /> Table
            </button>
          </div>
        </PageHead>
        <StatStrip>
          <Stat label="Need you" tone={needs ? "warn" : undefined} value={needs} />
          <Stat label="Demos booked" value={summary.counts.demo_booked} />
          <Stat label="In trial" value={summary.counts.trial} />
          <Stat label="Won" tone={summary.counts.won ? "ok" : undefined} value={summary.counts.won} />
          <Stat label="Win rate" value={summary.winRate === null ? "—" : `${Math.round(summary.winRate * 100)}%`} />
        </StatStrip>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <FilterBar>
          <SearchInput id="lead-search" onChange={setSearch} placeholder="Filter by name, studio, email or Instagram" value={search} />
        </FilterBar>
        {layout === "table" ? (
          <DataTable
            columns={columns}
            empty={<Empty title="No leads yet">Requests from Book a demo on the website land here. Add anyone else with Add lead.</Empty>}
            getRowId={(row) => row.id}
            initialSort={[{ id: "next", desc: false }]}
            label="Leads"
            mobile={(row) => ({ title: row.name, end: <Pill tone={LEAD_STAGE_TONES[row.now]}>{LEAD_STAGE_LABELS[row.now]}</Pill>, meta: [row.studioName, row.nextStep].filter(Boolean).join(" · ") })}
            onRowClick={(row) => set("lead", row.id)}
            rows={rows ? shown : null}
          />
        ) : (
          <div className="cx-board">
            {LEAD_STAGES.map((stage) => {
              const cards = shown
                .filter((row) => row.now === stage)
                .filter((row) => !["won", "lost"].includes(stage) || !row.stageChangedAt || now - Date.parse(row.stageChangedAt) < 60 * 86_400_000)
                .sort((a, b) => (a.nextStepAt ?? "9999").localeCompare(b.nextStepAt ?? "9999") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
              return (
                <section aria-label={LEAD_STAGE_LABELS[stage]} className="cx-board-col" key={stage}>
                  <header className="cx-board-col-head">
                    <Pill tone={LEAD_STAGE_TONES[stage]}>{LEAD_STAGE_LABELS[stage]}</Pill>
                    <span className="cx-tab-count">{cards.length}</span>
                  </header>
                  {cards.map((row) => (
                    <button className="cx-card" key={row.id} onClick={() => set("lead", row.id)} type="button">
                      <span className="cx-card-title">{row.name}</span>
                      <span className="cx-card-meta">
                        {row.studioName ? <span>{row.studioName}</span> : null}
                        {row.source ? <span>{CHANNEL_LABELS[row.source]}</span> : null}
                        {row.needs === "new" ? <Pill tone="warn">Reply</Pill> : row.needs === "due" ? <Pill tone="warn">Due</Pill> : null}
                      </span>
                      {row.nextStep ? <span className="cx-card-meta">{`${row.nextStep}${row.nextStepAt ? ` · ${shortDate(`${row.nextStepAt}T12:00:00`, now)}` : ""}`}</span> : null}
                    </button>
                  ))}
                  {!cards.length ? <span className="cx-hint" style={{ padding: "0 4px" }}>None</span> : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {open ? <LeadDrawer key={open === "new" ? "new" : open.id} lead={open === "new" ? null : open} onClose={() => set("lead", null)} onCreated={(id) => set("lead", id)} /> : null}
    </>
  );
}

function LeadDrawer({ lead, onClose, onCreated }: { lead: Row | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const admins = useAdmins(true);
  const partners = useLiveQuery<PartnerRef>("console:partners", (firestore) => query(collection(firestore, "saasPartners"), limit(2000)));
  const editable = can("crm.write");
  const [form, setForm] = useState({
    name: lead?.name ?? "",
    studioName: lead?.studioName ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    website: lead?.website ?? "",
    instagram: lead?.instagram ?? "",
    location: lead?.location ?? "",
    source: lead?.source ?? "",
    sourceDetail: lead?.sourceDetail ?? "",
    partnerId: lead?.partnerId ?? "",
    ownerUid: lead?.ownerUid ?? "",
    nextStep: lead?.nextStep ?? "",
    nextStepAt: lead?.nextStepAt ?? "",
    stage: (lead?.stage ?? "new") as LeadStage,
    lostReason: lead?.lostReason ?? "",
  });
  const [deleting, setDeleting] = useState(false);
  const field = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const linked = Boolean(lead?.tenantId);
  const valid = form.name.trim().length >= 2 && (!form.email || /\S+@\S+\.\S+/.test(form.email));
  const payload = {
    name: form.name.trim(),
    studioName: form.studioName.trim() || null,
    email: form.email.trim().toLowerCase() || null,
    phone: form.phone.trim() || null,
    website: form.website.trim() || null,
    instagram: form.instagram.trim() || null,
    location: form.location.trim() || null,
    source: form.source || null,
    sourceDetail: form.sourceDetail.trim() || null,
    partnerId: form.partnerId || null,
    ownerUid: form.ownerUid || null,
    nextStep: form.nextStep.trim() || null,
    nextStepAt: form.nextStepAt || null,
  };
  const save = async () => {
    if (!lead) {
      const result = await run<{ leadId: string }>("createLead", { ...payload, stage: form.stage === "trial" || form.stage === "won" ? "new" : form.stage }, { done: `${payload.name} added.` });
      if (result) onCreated(result.leadId);
      return;
    }
    await run(
      "updateLead",
      { leadId: lead.id, ...payload, ...(linked ? {} : { stage: form.stage, lostReason: form.stage === "lost" ? form.lostReason.trim() || null : null }) },
      { done: "Saved." },
    );
  };
  const remove = async () => {
    if (!lead) return;
    const result = await run("deleteLead", { leadId: lead.id }, { done: `${lead.name} deleted.` });
    if (result) onClose();
  };

  return (
    <Drawer
      footer={
        editable ? (
          <>
            {lead ? (
              <Button onClick={() => setDeleting(true)} variant="ghost">
                Delete
              </Button>
            ) : null}
            <Button busy={busy === "createLead" || busy === "updateLead"} disabled={!valid} onClick={() => void save()} variant="primary">
              {lead ? "Save" : "Add lead"}
            </Button>
          </>
        ) : null
      }
      onClose={onClose}
      open
      title={lead ? lead.name : "Add a lead"}
      wide
    >
      <div className="cx-form">
        {lead ? (
          <KV
            items={[
              ["Stage", <Pill key="stage" tone={LEAD_STAGE_TONES[lead.now]}>{LEAD_STAGE_LABELS[lead.now]}</Pill>],
              lead.tenantId ? ["Studio", <Link className="cx-link" href={studioHref(lead.tenantId)} key="studio">{lead.linkedStudio ?? "Open the studio"}</Link>] : null,
              ["Came in", `${lead.origin === "demo_form" ? "Book a demo" : "Added by hand"} · ${shortDate(lead.createdAt)}`],
              lead.message ? ["They wrote", lead.message] : null,
              lead.preferredTimes ? ["Good times", lead.preferredTimes] : null,
              lead.heard ? ["Heard about us", HEARD_LABEL[lead.heard] ?? lead.heard] : null,
            ]}
          />
        ) : null}
        <div className="cx-row-2">
          <LeadInput id="lead-name" label="Name" onChange={field("name")} value={form.name} />
          <LeadInput id="lead-studio" label="Studio" onChange={field("studioName")} value={form.studioName} />
        </div>
        <div className="cx-row-2">
          <LeadInput id="lead-email" label="Email" onChange={field("email")} type="email" value={form.email} />
          <LeadInput id="lead-phone" label="Phone" onChange={field("phone")} type="tel" value={form.phone} />
        </div>
        <div className="cx-row-2">
          <LeadInput id="lead-instagram" label="Instagram" onChange={field("instagram")} value={form.instagram} />
          <LeadInput id="lead-website" label="Website" onChange={field("website")} value={form.website} />
        </div>
        <LeadInput id="lead-location" label="Where they are" onChange={field("location")} value={form.location} />
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="lead-stage">Stage</label>
            <select className="cx-input" disabled={linked} id="lead-stage" onChange={field("stage")} value={linked ? lead?.now : form.stage}>
              {(linked ? LEAD_STAGES : MANUAL_LEAD_STAGES).map((stage) => (
                <option key={stage} value={stage}>{LEAD_STAGE_LABELS[stage]}</option>
              ))}
            </select>
            {linked ? <span className="cx-hint">Signed up: their studio sets the stage now.</span> : null}
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor="lead-owner">Owner</label>
            <select className="cx-input" id="lead-owner" onChange={field("ownerUid")} value={form.ownerUid}>
              <option value="">Nobody yet</option>
              {(admins.rows ?? []).map((admin) => (
                <option key={admin.uid ?? admin.id} value={admin.uid ?? admin.id}>{admin.name ?? admin.email ?? admin.id}</option>
              ))}
            </select>
          </div>
        </div>
        {!linked && form.stage === "lost" ? <LeadInput id="lead-lost" label="Why it was lost" onChange={field("lostReason")} value={form.lostReason} /> : null}
        <div className="cx-row-2">
          <LeadInput id="lead-next" label="Next step" onChange={field("nextStep")} placeholder="Send the demo recording" value={form.nextStep} />
          <LeadInput id="lead-next-at" label="By" onChange={field("nextStepAt")} type="date" value={form.nextStepAt} />
        </div>
        <div className="cx-row-2">
          <div className="cx-field">
            <label className="cx-label" htmlFor="lead-source">Source</label>
            <select className="cx-input" id="lead-source" onChange={field("source")} value={form.source}>
              <option value="">Not known</option>
              {SOURCE_CHANNELS.map((key) => (
                <option key={key} value={key}>{CHANNEL_LABELS[key]}</option>
              ))}
            </select>
          </div>
          {form.source === "partner" ? (
            <div className="cx-field">
              <label className="cx-label" htmlFor="lead-partner">Partner</label>
              <select className="cx-input" id="lead-partner" onChange={field("partnerId")} value={form.partnerId}>
                <option value="">Choose a partner</option>
                {(partners.rows ?? []).map((partner) => (
                  <option key={partner.id} value={partner.id}>{`${partner.name} · ${partner.code}`}</option>
                ))}
              </select>
            </div>
          ) : (
            <LeadInput id="lead-source-detail" label="Detail" onChange={field("sourceDetail")} placeholder="Who or what" value={form.sourceDetail} />
          )}
        </div>
        {lead ? <NotesPanel subjectKey={`lead:${lead.id}`} title="Notes" /> : null}
      </div>
      <ConfirmDialog
        busy={busy === "deleteLead"}
        confirmLabel="Delete lead"
        danger
        description="Deletes the lead and what they wrote. Their studio, if they signed up, isn't touched. Use this when someone asks to be forgotten; otherwise mark the lead Lost."
        onClose={() => setDeleting(false)}
        onConfirm={() => void remove()}
        open={deleting}
        requireReason={false}
        title={`Delete ${lead?.name ?? "this lead"}?`}
      />
    </Drawer>
  );
}

function LeadInput({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (event: { target: { value: string } }) => void; type?: string; placeholder?: string }) {
  return (
    <div className="cx-field">
      <label className="cx-label" htmlFor={id}>{label}</label>
      <input className="cx-input" id={id} onChange={onChange} placeholder={placeholder} type={type} value={value} />
    </div>
  );
}
