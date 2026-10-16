"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CalendarPlus,
  CalendarRange,
  ContactRound,
  FolderKanban,
  Inbox,
  ListTodo,
  Plus,
  Search,
  UserPlus,
  X,
  Settings,
  CircleHelp,
  Package,
} from "lucide-react";
import { searchStudio, studioSearchDestinations, type StudioSearchResult } from "@/features/search/studio-search";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { KindGlyph } from "@/components/library/kind-glyph";
import { formatDueDate } from "@/lib/format/event-date";
import type { LibraryKind } from "@/features/library/kinds";
import { preBookingStates } from "@/features/inquiries/stages";
import { callWords, newJobLine } from "@/components/studio/trade-words";

type SearchResult = StudioSearchResult;

/**
 * Search is the one list in the product that is always mixed, which makes
 * it the place kind-colour earns its keep with no explanation at all: five
 * results, five record types, told apart before a word is read.
 *
 * A project and a person are not one of the five families and take the
 * tile without a colour, rather than being assigned a hue to look
 * consistent.
 */
const searchResultGlyphs: Record<
  SearchResult["kind"],
  { kind: LibraryKind | null; icon?: typeof FolderKanban }
> = {
  Project: { kind: null, icon: FolderKanban },
  Inquiry: { kind: null, icon: Inbox },
  Client: { kind: null, icon: ContactRound },
  Approval: { kind: null, icon: BrainCircuit },
  Action: { kind: null, icon: Plus },
  Settings: { kind: null, icon: Settings },
  Help: { kind: null, icon: CircleHelp },
  Package: { kind: null, icon: Package },
  Task: { kind: "task" },
  Contract: { kind: "contract" },
  Schedule: { kind: "schedule" },
  Message: { kind: "message" },
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Hidden matching terms; displayed dates still use formatDueDate. */
function searchKeywords(...values: unknown[]): string {
  return values.map(text).filter(Boolean).join(" ");
}

export function GlobalSearch() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const projectsRead = useTenantDocuments("projects", { enabled: open });
  const { records: projects } = projectsRead;
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const operator = [
    "studio_owner",
    "studio_admin",
    "studio_coordinator",
  ].includes(workspace.role ?? "");
  const contactsRead = useTenantDocuments("contacts", {
    enabled: open && privileged,
  });
  const tasksRead = useTenantDocuments("tasks", { enabled: open });
  const { records: tasks } = tasksRead;
  const contractsRead = useTenantDocuments("contracts", {
    enabled: open && operator,
  });
  const schedulesRead = useTenantDocuments("schedules", { enabled: open });
  const { records: schedules } = schedulesRead;
  const messagesRead = useTenantDocuments("messages", {
    enabled: open && operator,
  });
  const aiActionsRead = useTenantDocuments("aiActions", {
    enabled: open && operator,
  });
  const leadsRead = useTenantDocuments("leads", { enabled: open && operator });

  const packagesRead = useTenantDocuments("packages", { enabled: open && privileged });
  const { records: contacts } = contactsRead;
  const { records: contracts } = contractsRead;
  const { records: messages } = messagesRead;
  const { records: aiActions } = aiActionsRead;
  const { records: leads } = leadsRead;
  const reads = [projectsRead, tasksRead, schedulesRead, contactsRead, contractsRead, messagesRead, aiActionsRead, leadsRead, packagesRead];
  const loading = reads.some((read) => read.loading);
  const readFailed = reads.some((read) => read.error);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timeout);
      trigger?.focus();
    };
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const values: SearchResult[] = [
      ...studioSearchDestinations(workspace.role, workspace.tenantTrade),
      ...(packagesRead.records ?? []).map((entry) => ({ id: `package-${entry.id}`, label: text(entry.name) || "Package", detail: "Your package", href: `/studio/packages/${entry.id}`, kind: "Package" as const })),
      ...(projects ?? []).map((project) => ({
        id: `project-${project.id}`,
        label: text(project.name) || "Untitled project",
        // A couple who hasn't booked is an inquiry, and says so.
        kind: preBookingStates.has(text(project.state))
          ? ("Inquiry" as const)
          : ("Project" as const),
        detail: [
          text(project.eventType),
          // Search results are read at a glance; a machine date is the one
          // thing in this line the reader has to decode.
          text(project.eventDate) ? formatDueDate(project.eventDate) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/studio/projects/${project.id}`,
        searchText: searchKeywords(project.eventDate, project.venueName, project.city),
      })),
      // Inquiries that aren't a job yet (no date, or not confirmed): found by
      // the couple's name or email, which is how a studio remembers them.
      ...(leads ?? [])
        .filter((lead) => !text(lead.projectId) && lead.notInquiry !== true)
        .map((lead) => ({
          id: `lead-${lead.id}`,
          label:
            text(lead.displayName) ||
            `${text(lead.firstName)} ${text(lead.lastName)}`.trim() ||
            text(lead.email) ||
            "Inquiry",
          detail: [text(lead.email), text(lead.eventDate) ? formatDueDate(lead.eventDate) : ""]
            .filter(Boolean)
            .join(" · "),
          href: `/studio/leads/${lead.id}`,
          searchText: searchKeywords(lead.eventDate),
          kind: "Inquiry" as const,
        })),
      ...(contacts ?? []).map((contact) => ({
        id: `client-${contact.id}`,
        label: text(contact.displayName) || text(contact.email) || "Client",
        detail: text(contact.email),
        href: `/studio/clients?q=${encodeURIComponent(
          text(contact.displayName) || text(contact.email),
        )}`,
        kind: "Client" as const,
      })),
      ...(tasks ?? []).map((task) => ({
        id: `task-${task.id}`,
        label: text(task.title) || text(task.name) || "Task",
        detail:
          text(task.projectName) ||
          (text(task.dueDate) ? `Due ${formatDueDate(task.dueDate)}` : ""),
        href: task.projectId
          ? `/studio/projects/${String(task.projectId)}`
          : "/studio/tasks",
        kind: "Task" as const,
      })),
      ...(contracts ?? []).map((contract) => ({
        id: `contract-${contract.id}`,
        label:
          text(contract.projectName) ||
          text(contract.title) ||
          "Project contract",
        detail: text(contract.status),
        href: `/studio/contracts?project=${encodeURIComponent(
          text(contract.projectId),
        )}`,
        kind: "Contract" as const,
      })),
      ...(schedules ?? []).map((schedule) => ({
        id: `schedule-${schedule.id}`,
        label:
          text(schedule.projectName) ||
          text(schedule.name) ||
          "Project schedule",
        detail: [
          text(schedule.status),
          schedule.version ? `Version ${String(schedule.version)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/studio/schedules/${schedule.id}`,
        kind: "Schedule" as const,
      })),
      ...(messages ?? []).map((message) => ({
        id: `message-${message.id}`,
        label:
          text(message.subject) ||
          text(message.bodyPreview) ||
          "Client message",
        detail: text(message.deliveryStatus) || text(message.channel),
        searchText: searchKeywords(message.bodyPreview, message.body, message.projectName),
        href: `/studio/messages?project=${encodeURIComponent(
          text(message.projectId),
        )}`,
        kind: "Message" as const,
      })),
      ...(aiActions ?? [])
        .filter((action) => action.status === "review_required")
        .map((action) => ({
          id: `ai-${action.id}`,
          label:
            text(action.title) ||
            `Review ${text(action.capability).replaceAll("_", " ")}`,
          detail: "AI approval required",
          // Approvals are worked where they belong: on the job, or on Today.
          href: text(action.projectId) ? `/studio/projects/${text(action.projectId)}` : "/studio",
          kind: "Approval" as const,
        })),
    ];
    return searchStudio(values, needle).slice(0, 12);
  }, [
    aiActions,
    packagesRead.records,
    workspace.role,
    workspace.tenantTrade,
    leads,
    contacts,
    contracts,
    messages,
    projects,
    query,
    schedules,
    tasks,
  ]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        aria-label="Search StudioCue"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="command-search"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search size={17} />
        <span>Search StudioCue</span>
        <kbd>⌘ K</kbd>
      </button>
      {open ? (
        <div className="search-dialog-backdrop" role="presentation">
          <button
            aria-label="Close search"
            className="search-dialog-dismiss"
            onClick={close}
            type="button"
          />
          <section
            ref={dialogRef}
            onKeyDown={(event) => {
              const panel = dialogRef.current;
              if (!panel) return;
              const links = Array.from(panel.querySelectorAll<HTMLAnchorElement>("a[href]"));
              const index = links.indexOf(document.activeElement as HTMLAnchorElement);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next = event.key === "ArrowDown" ? index + 1 : index < 0 ? links.length - 1 : index - 1;
                if (next < 0 || next >= links.length) inputRef.current?.focus();
                else links[next]?.focus();
              } else if (event.key === "Enter" && event.target === inputRef.current) {
                event.preventDefault();
                links[0]?.click();
              } else if (event.key === "Tab") {
                const controls = Array.from(panel.querySelectorAll<HTMLElement>("input, button, a[href]"));
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}
            aria-label="Search StudioCue"
            aria-modal="true"
            className="search-dialog"
            role="dialog"
          >
            <header>
              <Search size={19} />
              <input
                aria-label="Search records and commands"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search names, jobs, settings, or how to do something…"
                ref={inputRef}
                value={query}
              />
              <button aria-label="Close search" onClick={close} type="button">
                <X size={18} />
              </button>
            </header>
            {!query.trim() ? (
              <div className="search-quick-actions">
                <p>Quick actions</p>
                {privileged ? <Link href="/studio/packages/new" onClick={close}><Package size={17} /><span><strong>Add a package</strong><small>Set your services and prices</small></span></Link> : null}
                {operator ? <Link href="/studio/projects/new" onClick={close}>
                  <Plus size={17} />
                  <span>
                    <strong>New job</strong>
                    <small>{newJobLine(workspace.tenantTrade)}</small>
                  </span>
                </Link> : null}
                {operator ? <Link href="/studio/clients/new" onClick={close}>
                  <UserPlus size={17} />
                  <span>
                    <strong>Add client</strong>
                    <small>Create a client contact</small>
                  </span>
                </Link> : null}
                {operator ? <Link href="/studio/calendar" onClick={close}>
                  <CalendarPlus size={17} />
                  <span>
                    <strong>{callWords(workspace.tenantTrade).scheduleAction}</strong>
                    <small>Find a time and create the meeting</small>
                  </span>
                </Link> : null}
                {operator ? (
                  <Link href="/studio/schedules/new" onClick={close}>
                    <CalendarRange size={17} />
                    <span>
                      <strong>Draft a run of show</strong>
                      <small>Generate a schedule draft to review</small>
                    </span>
                  </Link>
                ) : null}
                {operator ? (
                  <Link href="/studio" onClick={close}>
                    <BrainCircuit size={17} />
                    <span>
                      <strong>Review prepared work</strong>
                      <small>Approve the decisions StudioCue cannot make for you</small>
                    </span>
                  </Link>
                ) : null}
              </div>
            ) : results.length ? (
              <div className="search-results">
                {results.map((result) => {
                  const entry = searchResultGlyphs[result.kind] ?? {
                    kind: null,
                    icon: ListTodo,
                  };
                  return (
                    <Link href={result.href} key={result.id} onClick={close}>
                      <KindGlyph
                        icon={entry.icon}
                        kind={entry.kind}
                        size={30}
                      />
                      <span>
                        <strong>{result.label}</strong>
                        <small>
                          {result.kind}
                          {result.detail ? ` · ${result.detail}` : ""}
                        </small>
                      </span>
                      <ArrowRight size={15} />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="search-no-results">
                <Search size={20} />
                <strong>{loading ? "Searching your studio…" : readFailed ? "Some records could not be searched" : "No matches yet"}</strong>
                <small>
                  {readFailed ? "Close search and try again. You can still find settings and guides." : 'Try a name, date, or something you want to do, like “add packages”.'}
                </small>
              </div>
            )}
            {query.trim() && results.length > 0 && (loading || readFailed) ? (
              <p className="search-status" role="status">{readFailed ? "Some records could not be searched. Close search and try again." : "Still searching your records…"}</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
