"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import { FEATURE_CATALOG as CATALOG } from "@/features/console/feature-catalog";
import { relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { SearchInput, matches } from "../filters";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, Notice, PageHead, Panel, Pill } from "../ui";
import { useCommand } from "../use-command";

/**
 * Feature access (docs/console.md): which studios have the features that are
 * held back per studio. Off, some studios, or every studio; the decision is
 * written onto each studio's switches, which is what the product reads.
 */

type Flag = { id: string; key?: string; managed?: boolean; scope?: "off" | "some" | "all"; tenantIds?: string[]; updatedAt?: string; archivedAt?: string | null; enabled?: boolean; description?: string };
type TenantFeatures = { id: string } & Record<string, unknown>;

export function FeaturesPage() {
  const params = useSearchParams();
  const { studios, can } = useConsole();
  const { run, busy } = useCommand();
  const flags = useLiveQuery<Flag>("features:flags", (firestore) => query(collection(firestore, "featureFlags"), limit(200)));
  const switches = useLiveQuery<TenantFeatures>("features:tenants", (firestore) => query(collection(firestore, "tenantFeatures"), limit(5000)));
  const [openKey, setOpenKey] = useState<string | null>(params.get("studio") ? CATALOG[0]!.key : null);
  const [scopeChange, setScopeChange] = useState<{ key: string; scope: "off" | "some" | "all" } | null>(null);
  const [search, setSearch] = useState("");
  const focusStudio = params.get("studio");

  const stateOf = (key: string) => {
    const flag = (flags.rows ?? []).find((item) => item.id === key);
    const on = (switches.rows ?? []).filter((item) => item[key] === true).map((item) => item.id);
    const scope = flag?.managed ? (flag.scope ?? "off") : on.length ? "some" : "off";
    return { flag, on, scope, managed: Boolean(flag?.managed) };
  };
  const legacy = (flags.rows ?? []).filter((flag) => !CATALOG.some((item) => item.key === flag.id) && !flag.archivedAt);
  const open = CATALOG.find((item) => item.key === openKey) ?? null;
  const openState = open ? stateOf(open.key) : null;
  const studioRows = useMemo(
    () =>
      (studios.rows ?? [])
        .filter((studio) => studio.lifecycle !== "churned" && matches(search, studio.name, studio.ownerEmail))
        .sort((a, b) => (a.tenantId === focusStudio ? -1 : b.tenantId === focusStudio ? 1 : a.name.localeCompare(b.name))),
    [studios.rows, search, focusStudio],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "System" }, { label: "Feature access" }]} />
      <div className="cx-content">
        <PageHead title="Feature access" />
        <p className="cx-page-intro">Features held back per studio. Turning one on for every studio also reaches studios that sign up later.</p>
        {flags.error ? <Notice tone="bad">{flags.error}</Notice> : null}
        <div className="cx-table-wrap">
          <table aria-label="Features" className="cx-table">
            <thead>
              <tr>
                <th className="cx-th">Feature</th>
                <th className="cx-th" style={{ width: 150 }}>Access</th>
                <th className="cx-th" data-align="right" style={{ width: 110 }}>Studios on</th>
                <th className="cx-th" style={{ width: 120 }}>Changed</th>
              </tr>
            </thead>
            <tbody>
              {CATALOG.map((feature) => {
                const state = stateOf(feature.key);
                return (
                  <tr className="cx-row" data-clickable="true" key={feature.key} onClick={() => setOpenKey(feature.key)}>
                    <td className="cx-td" style={{ whiteSpace: "normal" }}>
                      <span className="cx-name-text">
                        <b>{feature.label}</b>
                        <small style={{ whiteSpace: "normal" }}>{feature.description}</small>
                      </span>
                    </td>
                    <td className="cx-td">
                      <Pill tone={state.scope === "all" ? "ok" : state.scope === "some" ? "info" : "neutral"}>{state.scope === "all" ? "Every studio" : state.scope === "some" ? "Some studios" : "Off"}</Pill>
                    </td>
                    <td className="cx-td" data-align="right">{state.scope === "all" ? "All" : state.on.length}</td>
                    <td className="cx-td">{state.flag?.updatedAt ? relative(state.flag.updatedAt) : <span className="cx-dim">Set by hand</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {legacy.length ? (
          <Panel title="Old flags nothing reads">
            <span className="cx-hint">These were created before the Console and no code checks them. Archive them to clear the list.</span>
            {legacy.map((flag) => (
              <div className="cx-inline" key={flag.id}>
                <span className="cx-mono" style={{ flex: 1 }}>{flag.id}</span>
                {can("features.write") ? (
                  <Button onClick={() => void run("archiveFlag", { key: flag.id }, { done: "Archived." })} size="sm" variant="ghost">
                    Archive
                  </Button>
                ) : null}
              </div>
            ))}
          </Panel>
        ) : null}
      </div>

      <Drawer onClose={() => setOpenKey(null)} open={Boolean(open)} title={open?.label ?? ""} wide>
        {open && openState ? (
          <>
            <p className="cx-hint">{open.description}</p>
            {can("features.write") ? (
              <div className="cx-field">
                <span className="cx-label">Who has it</span>
                <div className="cx-segmented">
                  {(["off", "some", "all"] as const).map((scope) => (
                    <button aria-pressed={openState.scope === scope} key={scope} onClick={() => scope !== openState.scope && setScopeChange({ key: open.key, scope })} type="button">
                      {scope === "off" ? "Off" : scope === "some" ? "Some studios" : "Every studio"}
                    </button>
                  ))}
                </div>
                {!openState.managed && openState.on.length ? <span className="cx-hint">Currently set by hand on {openState.on.length} studios. Changing it here keeps them.</span> : null}
              </div>
            ) : null}
            {open.requires ? <Notice tone="info">Only works for studios that also have {CATALOG.find((item) => item.key === open.requires)?.label}.</Notice> : null}
            <SearchInput id="feature-studio-search" onChange={setSearch} placeholder="Find a studio" value={search} />
            <div className="cx-table-wrap">
              <table aria-label={`Studios with ${open.label}`} className="cx-table">
                <tbody>
                  {studioRows.map((studio) => {
                    const on = openState.scope === "all" || openState.on.includes(studio.tenantId);
                    return (
                      <tr className="cx-row" data-active={studio.tenantId === focusStudio ? "true" : undefined} key={studio.tenantId}>
                        <td className="cx-td cx-strong">{studio.name}</td>
                        <td className="cx-td" style={{ width: 130, textAlign: "right" }}>
                          <label className="cx-check" style={{ justifyContent: "flex-end" }}>
                            <input
                              aria-label={`${open.label} for ${studio.name}`}
                              checked={on}
                              disabled={!can("features.write") || openState.scope === "all" || busy === "setStudioFeature"}
                              onChange={(event) => void run("setStudioFeature", { key: open.key, tenantId: studio.tenantId, enabled: event.target.checked }, { done: `${open.label} ${event.target.checked ? "on" : "off"} for ${studio.name}.` })}
                              type="checkbox"
                            />
                            {on ? "On" : "Off"}
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!studioRows.length ? <Empty title="No studios match" /> : null}
          </>
        ) : null}
      </Drawer>
      <ConfirmDialog
        busy={busy === "setFeatureScope"}
        confirmLabel="Change access"
        description={
          scopeChange?.scope === "all"
            ? "Every studio gets this now, and every studio that signs up later."
            : scopeChange?.scope === "off"
              ? "No studio has this. The list of studios is kept, so switching back to Some studios restores them."
              : "Only the studios you switch on have it."
        }
        onClose={() => setScopeChange(null)}
        onConfirm={async ({ reason }) => {
          if (!scopeChange) return;
          const result = await run<{ studiosChanged: number }>("setFeatureScope", { ...scopeChange, reason }, { done: (outcome) => `Access changed. ${outcome.studiosChanged} studios updated.` });
          if (result) setScopeChange(null);
        }}
        open={scopeChange !== null}
        title={`${CATALOG.find((item) => item.key === scopeChange?.key)?.label ?? "Feature"}: ${scopeChange?.scope === "all" ? "every studio" : scopeChange?.scope === "off" ? "off" : "some studios"}`}
      />
    </>
  );
}
