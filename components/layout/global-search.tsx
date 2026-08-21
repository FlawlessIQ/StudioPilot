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
  ListTodo,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { KindGlyph } from "@/components/library/kind-glyph";
import { formatDueDate } from "@/lib/format/event-date";
import type { LibraryKind } from "@/features/library/kinds";

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind:
    | "Project"
    | "Client"
    | "Task"
    | "Contract"
    | "Schedule"
    | "Message"
    | "AI review";
};

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
  Client: { kind: null, icon: ContactRound },
  "AI review": { kind: null, icon: BrainCircuit },
  Task: { kind: "task" },
  Contract: { kind: "contract" },
  Schedule: { kind: "schedule" },
  Message: { kind: "message" },
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function GlobalSearch() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { records: projects } = useTenantDocuments("projects");
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const operator = [
    "studio_owner",
    "studio_admin",
    "studio_coordinator",
  ].includes(workspace.role ?? "");
  const { records: contacts } = useTenantDocuments("contacts", {
    enabled: privileged,
  });
  const { records: tasks } = useTenantDocuments("tasks");
  const { records: contracts } = useTenantDocuments("contracts", {
    enabled: operator,
  });
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: messages } = useTenantDocuments("messages", {
    enabled: operator,
  });
  const { records: aiActions } = useTenantDocuments("aiActions", {
    enabled: operator,
  });

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
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const values: SearchResult[] = [
      ...(projects ?? []).map((project) => ({
        id: `project-${project.id}`,
        label: text(project.name) || "Untitled project",
        detail: [
          text(project.eventType),
          // Search results are read at a glance; a machine date is the one
          // thing in this line the reader has to decode.
          text(project.eventDate) ? formatDueDate(project.eventDate) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/studio/projects/${project.id}`,
        kind: "Project" as const,
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
          href: "/studio/ai-queue",
          kind: "AI review" as const,
        })),
    ];
    return values
      .filter((result) =>
        `${result.label} ${result.detail} ${result.kind}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 10);
  }, [
    aiActions,
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
        aria-label="Ask StudioCue, search, or create"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="command-search"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search size={17} />
        <span>Ask StudioCue, search, or create</span>
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
                placeholder="Ask a question, find a record, or start something"
                ref={inputRef}
                value={query}
              />
              <button aria-label="Close search" onClick={close} type="button">
                <X size={18} />
              </button>
            </header>
            {!query.trim() ? (
              <div className="search-quick-actions">
                <p>Ask or create</p>
                <Link href="/studio/copilot" onClick={close}>
                  <BrainCircuit size={17} />
                  <span>
                    <strong>Ask StudioCue</strong>
                    <small>Get a grounded answer or prepare project work</small>
                  </span>
                </Link>
                {operator ? <Link href="/studio/projects/new" onClick={close}>
                  <Plus size={17} />
                  <span>
                    <strong>Create project</strong>
                    <small>Start a new photography job</small>
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
                    <strong>Schedule consultation</strong>
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
                  <Link href="/studio/ai-queue" onClick={close}>
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
                <strong>No matching records</strong>
                <small>
                  Try a project name, date, contract, schedule, message, or task.
                </small>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
