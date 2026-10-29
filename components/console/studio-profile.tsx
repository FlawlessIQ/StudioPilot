"use client";

import { useEffect, useState } from "react";
import { ROLE_LABELS } from "@/features/console/model";
import { ACTION_AREA_LABELS, actionAreas, describeAction } from "@/features/console/studio-actions";
import { TRADE_LABELS, type Trade } from "@/features/trades/trades";
import { runConsoleCommand } from "@/lib/console/command-client";
import { dateTime, humanize, money, relative, shortDate } from "@/lib/console/format";
import { Empty, KV, Panel, Pill, Spinner } from "./ui";

/**
 * The long form of one studio on its Console record: what they told us, what
 * they built, their business in StudioCue, and what their people did
 * (functions/src/console/studio-profile.ts). Conor, 2026-10-28: "since we are
 * small scale at the moment i would like much more info when i click on each
 * studio". Read when the record opens, never stored.
 */

type Profile = {
  about: {
    businessName: string | null;
    legalName: string | null;
    brandName: string | null;
    trade: string;
    timezone: string | null;
    currency: string | null;
    address: string | null;
    replyTo: string | null;
    inquiryUrl: string | null;
    signedUpAt: string | null;
    attribution: {
      heard: string | null;
      heardDetail: string | null;
      source: string | null;
      medium: string | null;
      campaign: string | null;
      referrer: string | null;
      landing: string | null;
      code: string | null;
      manual: string | null;
    } | null;
  };
  team: Array<{ name: string | null; email: string | null; role: string; lastSignInAt: string | null }>;
  built: {
    packages: Array<{ name: string; priceCents: number | null; eventType: string | null; active: boolean }>;
    forms: Array<{ name: string; status: string | null; starter?: boolean }>;
    agreement: { signatureMode: string | null; hasTemplate: boolean; nativeSigning: boolean; signingProviders: string[] };
    consultation: { mode: string | null; durationMinutes: number | null; windows: Array<{ day: string; startMinute: number | null; endMinute: number | null }> } | null;
    inquiries: { lastForwardedAt: string | null; lastTestAt: string | null; formInquiries: number };
    customizedTemplates: string[];
    integrations: Array<{ provider: string; status: string | null }>;
    branding: { logo: boolean; color: string | null };
    insurance: boolean;
  };
  business: {
    jobsByState: Record<string, number>;
    booked: number;
    imported: number;
    upcoming60: number;
    recentJobs: Array<{ name: string; state: string | null; eventDate: string | null; createdAt: string | null; imported: boolean; kind: string | null }>;
    inquiries: { total: number; last30: number; bySource: Record<string, number> };
    clients: number;
    crew: number;
    emails30d: number;
    emailsFailed: number;
  };
  actions: Array<{ at: string; action: string; actorType: string; actorName: string | null; projectName: string | null }>;
  readAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  public_inquiry: "Website form",
  email_capture: "Forwarded email",
  inbox_capture: "Forwarded email",
  manual: "Added by hand",
  import: "Imported",
  studio_import: "Imported",
};

const SIGNATURE_LABELS: Record<string, string> = {
  record_own: "Their own contract, signed outside",
  native: "Signs in StudioCue",
  docusign: "DocuSign",
  dropbox_sign: "Dropbox Sign",
};

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function clock(minute: number | null): string {
  if (minute === null) return "?";
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hours >= 12 && hours < 24 ? "pm" : "am";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes ? `${hour12}:${String(minutes).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`;
}

/** "Mon–Fri 9am–5pm · Sat 10am–2pm", one line per distinct span. */
export function hoursSummary(windows: ReadonlyArray<{ day: string; startMinute: number | null; endMinute: number | null }>): string {
  const bySpan = new Map<string, string[]>();
  for (const window of [...windows].sort((a, b) => DAY_ORDER.indexOf(a.day.slice(0, 3).toLowerCase()) - DAY_ORDER.indexOf(b.day.slice(0, 3).toLowerCase()))) {
    const span = `${clock(window.startMinute)}–${clock(window.endMinute)}`;
    const day = window.day.slice(0, 3);
    bySpan.set(span, [...(bySpan.get(span) ?? []), day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()]);
  }
  return [...bySpan.entries()].map(([span, days]) => `${days.join(", ")} ${span}`).join(" · ");
}

function useStudioProfile(tenantId: string) {
  const [state, setState] = useState<{ tenantId: string | null; data: Profile | null; error: string | null }>({ tenantId: null, data: null, error: null });
  useEffect(() => {
    let active = true;
    runConsoleCommand<Profile>("studioProfile", { tenantId })
      .then((data) => active && setState({ tenantId, data, error: null }))
      .catch((caught: unknown) => active && setState({ tenantId, data: null, error: caught instanceof Error ? caught.message : String(caught) }));
    return () => {
      active = false;
    };
  }, [tenantId]);
  // Another studio's answer is not this one's: loading until ours arrives.
  return state.tenantId === tenantId ? { ...state, loading: false } : { data: null, error: null, loading: true };
}

const none = <span className="cx-dim">None yet</span>;

export function StudioProfilePanels({ tenantId }: { tenantId: string }) {
  const { data, error, loading } = useStudioProfile(tenantId);
  if (loading)
    return (
      <Panel title="About this studio">
        <div className="cx-empty">
          <Spinner label="Reading the studio" />
        </div>
      </Panel>
    );
  if (!data || error)
    return (
      <Panel title="About this studio">
        <Empty title="Couldn't read this studio's details">{error ?? "Try again in a moment."}</Empty>
      </Panel>
    );
  const { about, built, business, team, actions } = data;
  const ownForms = built.forms.filter((form) => !form.starter);
  const starterForms = built.forms.filter((form) => form.starter);
  const heard = about.attribution;
  const source = heard
    ? [heard.manual, heard.heard ? humanize(heard.heard) : null, heard.heardDetail, heard.source ? `${heard.source}${heard.medium ? ` / ${heard.medium}` : ""}` : null, heard.campaign, heard.referrer]
        .filter(Boolean)
        .join(" · ")
    : null;
  const states = Object.entries(business.jobsByState).sort((a, b) => b[1] - a[1]);
  const sources = Object.entries(business.inquiries.bySource).sort((a, b) => b[1] - a[1]);
  const areas = actionAreas(actions, new Date(Date.parse(data.readAt) - 30 * 86_400_000).toISOString());
  const agreement = built.agreement.signatureMode
    ? (SIGNATURE_LABELS[built.agreement.signatureMode] ?? humanize(built.agreement.signatureMode))
    : built.agreement.signingProviders.length
      ? built.agreement.signingProviders.map((provider) => SIGNATURE_LABELS[provider] ?? humanize(provider)).join(", ")
      : built.agreement.nativeSigning && built.agreement.hasTemplate
        ? "Signs in StudioCue"
        : null;

  return (
    <>
      <div className="cx-grid-2">
        <Panel title="About them">
          <KV
            items={[
              ["Business", about.businessName ?? about.brandName ?? "—"],
              about.legalName && about.legalName !== about.businessName ? ["Legal name", about.legalName] : null,
              ["Trade", TRADE_LABELS[about.trade as Trade] ?? humanize(about.trade)],
              ["Address", about.address ?? <span className="cx-dim">Not given</span>],
              ["Replies go to", about.replyTo ?? <span className="cx-dim">Their sign-in email</span>],
              ["Time zone", [about.timezone, about.currency].filter(Boolean).join(" · ") || "—"],
              ["Inquiry form", about.inquiryUrl ? <a className="cx-link" href={about.inquiryUrl} key="i" rel="noreferrer" target="_blank">{about.inquiryUrl.replace(/^https?:\/\//, "")}</a> : "—"],
              ["Found us", source || <span className="cx-dim">Not recorded</span>],
              heard?.code ? ["Code used", <span className="cx-mono" key="c">{heard.code}</span>] : null,
              heard?.landing ? ["Landed on", heard.landing] : null,
              ["Team", team.length ? team.map((person) => `${person.name ?? person.email ?? "Unknown"} (${ROLE_LABELS[person.role] ?? humanize(person.role)})`).join(", ") : "—"],
            ]}
          />
        </Panel>
        <Panel title="What they've set up">
          <KV
            items={[
              [
                `Packages · ${built.packages.length}`,
                built.packages.length
                  ? built.packages
                      .slice(0, 6)
                      .map((item) => `${item.name} ${item.priceCents !== null ? money(item.priceCents) : ""}${item.active ? "" : " (off)"}`.trim())
                      .join(" · ") + (built.packages.length > 6 ? ` · +${built.packages.length - 6} more` : "")
                  : none,
              ],
              // Signup adds starter forms to every studio; only the ones they
              // made or changed are theirs.
              [`Forms · ${ownForms.length}`, ownForms.length ? ownForms.map((form) => form.name).join(" · ") : none],
              ...(starterForms.length
                ? [[`Starter forms · ${starterForms.length}`, "Added at signup, unchanged"] as [string, string]]
                : []),
              ["How clients sign", agreement ?? none],
              [
                "Consultation hours",
                built.consultation
                  ? built.consultation.mode === "open_default"
                    ? `Open by default${built.consultation.durationMinutes ? ` · ${built.consultation.durationMinutes} min calls` : ""}`
                    : built.consultation.windows.length
                      ? `${hoursSummary(built.consultation.windows)}${built.consultation.durationMinutes ? ` · ${built.consultation.durationMinutes} min` : ""}`
                      : none
                  : none,
              ],
              [
                "Inquiries in",
                [
                  built.inquiries.lastForwardedAt ? `forwarding, last ${relative(built.inquiries.lastForwardedAt)}` : null,
                  built.inquiries.formInquiries ? `${built.inquiries.formInquiries} from the website form` : null,
                  !built.inquiries.lastForwardedAt && built.inquiries.lastTestAt ? `test forward ${relative(built.inquiries.lastTestAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || none,
              ],
              [`Own email templates · ${built.customizedTemplates.length}`, built.customizedTemplates.length ? built.customizedTemplates.map((key) => humanize(key)).join(" · ") : <span className="cx-dim">Using ours</span>],
              ["Integrations", built.integrations.length ? built.integrations.map((item) => `${humanize(item.provider)}${item.status && item.status !== "connected" ? ` (${humanize(item.status).toLowerCase()})` : ""}`).join(" · ") : none],
              ["Branding", [built.branding.logo ? "Logo" : null, built.branding.color ? `Color ${built.branding.color}` : null].filter(Boolean).join(" · ") || none],
              ["Insurance certificates", built.insurance ? "Set up" : none],
            ]}
          />
        </Panel>
      </div>

      <div className="cx-grid-2">
        <Panel title="Their business in StudioCue">
          <KV
            items={[
              ["Jobs", states.length ? states.map(([state, count]) => `${count} ${humanize(state.toLowerCase()).toLowerCase()}`).join(" · ") : none],
              ["Booked", `${business.booked}${business.imported ? ` · ${business.imported} imported` : ""}`],
              ["Events next 60 days", String(business.upcoming60)],
              ["Inquiries", `${business.inquiries.total} total · ${business.inquiries.last30} in 30 days`],
              sources.length ? ["Inquiries from", sources.map(([key, count]) => `${SOURCE_LABELS[key] ?? humanize(key)} ${count}`).join(" · ")] : null,
              ["People", `${business.clients} clients · ${business.crew} crew`],
              ["Emails, 30 days", `${business.emails30d}${business.emailsFailed ? ` · ${business.emailsFailed} failed` : ""}`],
            ]}
          />
        </Panel>
        <Panel flush title="Latest jobs">
          {business.recentJobs.length ? (
            <div className="cx-timeline">
              {business.recentJobs.map((job, index) => (
                <div className="cx-tl-row" key={`${job.name}-${index}`}>
                  <time className="cx-tl-time" dateTime={job.createdAt ?? undefined} title={job.createdAt ? dateTime(job.createdAt) : undefined}>
                    {job.createdAt ? relative(job.createdAt) : "—"}
                  </time>
                  <span>
                    <Pill tone={job.imported ? "neutral" : "info"}>{job.imported ? "Imported" : "New"}</Pill>
                  </span>
                  <div className="cx-tl-body">
                    <span className="cx-strong">{job.name}</span>
                    <small>{[job.state ? humanize(job.state.toLowerCase()) : null, job.eventDate ? shortDate(job.eventDate) : null, job.kind ? humanize(job.kind) : null].filter(Boolean).join(" · ")}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No jobs yet" />
          )}
        </Panel>
      </div>

      <Panel
        actions={
          areas.length ? (
            <span className="cx-tags">
              {areas.map((item) => (
                <span className="cx-tag" key={item.area}>
                  {ACTION_AREA_LABELS[item.area]} {item.count}
                </span>
              ))}
            </span>
          ) : null
        }
        flush
        title={`What they've done · ${actions.length ? `last ${actions.length}` : "nothing yet"}`}
      >
        {actions.length ? (
          <div className="cx-timeline">
            {actions.slice(0, 40).map((item, index) => {
              const described = describeAction(item.action);
              const who = item.actorName ?? (item.actorType === "client" ? "A client" : item.actorType === "subcontractor" ? "Crew" : "Someone at the studio");
              return (
                <div className="cx-tl-row" key={`${item.at}-${index}`}>
                  <time className="cx-tl-time" dateTime={item.at} title={dateTime(item.at)}>
                    {relative(item.at)}
                  </time>
                  <span>
                    <Pill tone={item.actorType === "user" ? "accent" : "neutral"}>{ACTION_AREA_LABELS[described.area]}</Pill>
                  </span>
                  <div className="cx-tl-body">
                    <span className="cx-strong">{described.label}</span>
                    <small>{[who, item.projectName].filter(Boolean).join(" · ")}</small>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="Nothing yet">Their people haven&apos;t done anything we record.</Empty>
        )}
      </Panel>
    </>
  );
}
