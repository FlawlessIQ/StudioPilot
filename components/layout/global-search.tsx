"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  ContactRound,
  FolderKanban,
  ListTodo,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: "Project" | "Client" | "Task";
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const { records: tasks } = useTenantDocuments("tasks");

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
        detail: [text(project.eventType), text(project.eventDate)]
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
        detail: text(task.projectName) || text(task.dueDate),
        href: task.projectId
          ? `/studio/projects/${String(task.projectId)}`
          : "/studio/tasks",
        kind: "Task" as const,
      })),
    ];
    return values
      .filter((result) =>
        `${result.label} ${result.detail} ${result.kind}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 10);
  }, [contacts, projects, query, tasks]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="command-search"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search size={17} />
        <span>Search projects, clients, or tasks</span>
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
                aria-label="Search projects, clients, or tasks"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, date, email, or task"
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
                <Link href="/studio/projects/new" onClick={close}>
                  <Plus size={17} />
                  <span>
                    <strong>Create project</strong>
                    <small>Start a new photography job</small>
                  </span>
                </Link>
                <Link href="/studio/clients/new" onClick={close}>
                  <UserPlus size={17} />
                  <span>
                    <strong>Add client</strong>
                    <small>Create a client contact</small>
                  </span>
                </Link>
                <Link href="/studio/calendar" onClick={close}>
                  <CalendarPlus size={17} />
                  <span>
                    <strong>Schedule consultation</strong>
                    <small>Find a time and create the meeting</small>
                  </span>
                </Link>
              </div>
            ) : results.length ? (
              <div className="search-results">
                {results.map((result) => {
                  const Icon =
                    result.kind === "Project"
                      ? FolderKanban
                      : result.kind === "Client"
                        ? ContactRound
                        : ListTodo;
                  return (
                    <Link href={result.href} key={result.id} onClick={close}>
                      <Icon size={17} />
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
                <small>Try a client name, project date, or task title.</small>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
