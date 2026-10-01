"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, limit, query, where } from "firebase/firestore";
import type { ConsolePerson } from "@/features/console/model";
import { PERSON_TYPE_LABELS } from "@/features/console/model";
import { useLiveQuery } from "@/lib/console/live";
import { useConsole } from "./console-context";
import { CONSOLE_NAV } from "./nav";
import { matches } from "./filters";
import { Avatar } from "./ui";

/**
 * ⌘K: jump to any studio, person, issue, code or page by typing part of its
 * name. Reads the rows the Console already holds; people, issues and codes
 * load the first time it opens.
 */
type Result = { key: string; group: string; title: string; sub?: string | null; href: string; avatar?: string };

export function CommandPalette() {
  const { paletteOpen } = useConsole();
  // Mounts fresh on every open: an empty box, the first result highlighted.
  return paletteOpen ? <PaletteBody /> : null;
}

function PaletteBody() {
  const { setPaletteOpen, studios } = useConsole();
  const router = useRouter();
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const people = useLiveQuery<ConsolePerson>("palette:people", (firestore) =>
    query(collection(firestore, "consolePeople"), where("removed", "==", false), limit(2000)),
  );
  const issues = useLiveQuery<{ id: string; number?: number; title?: string; status?: string }>("palette:issues", (firestore) =>
    query(collection(firestore, "issues"), limit(500)),
  );
  const codes = useLiveQuery<{ id: string; code?: string; label?: string }>("palette:codes", (firestore) =>
    query(collection(firestore, "saasDiscounts"), where("kind", "==", "promotion_code"), limit(500)),
  );

  const results = useMemo<Result[]>(() => {
    const term = text.trim();
    const pages: Result[] = CONSOLE_NAV.flatMap((section) => section.items)
      .filter((item) => matches(term, item.label, "go to " + item.label))
      .map((item) => ({ key: `page:${item.href}`, group: "Pages", title: item.label, href: item.href }));
    if (!term) return pages.slice(0, 8);
    const studioRows: Result[] = (studios.rows ?? [])
      .filter((studio) => matches(term, studio.name, studio.ownerName, studio.ownerEmail, studio.slug, studio.tenantId, studio.legalName))
      .slice(0, 8)
      .map((studio) => ({
        key: `studio:${studio.tenantId}`,
        group: "Studios",
        title: studio.name,
        sub: [studio.ownerName, studio.ownerEmail].filter(Boolean).join(" · ") || null,
        href: `/platform-admin/studios/${encodeURIComponent(studio.tenantId)}`,
        avatar: studio.name,
      }));
    const personRows: Result[] = (people.rows ?? [])
      .filter((person) => matches(term, person.name, person.email, person.uid))
      .slice(0, 8)
      .map((person) => ({
        key: `person:${person.uid}`,
        group: "People",
        title: person.name ?? person.email ?? person.uid,
        sub: [person.email, PERSON_TYPE_LABELS[person.type]].filter(Boolean).join(" · "),
        href: `/platform-admin/people/${encodeURIComponent(person.uid)}`,
        avatar: person.name ?? person.email ?? "?",
      }));
    const issueRows: Result[] = (issues.rows ?? [])
      .filter((issue) => matches(term, issue.title, issue.number ? `#${issue.number}` : null))
      .slice(0, 5)
      .map((issue) => ({
        key: `issue:${issue.id}`,
        group: "Issues",
        title: `${issue.number ? `#${issue.number} ` : ""}${issue.title ?? "Untitled issue"}`,
        href: `/platform-admin/issues/${encodeURIComponent(issue.id)}`,
      }));
    const codeRows: Result[] = (codes.rows ?? [])
      .filter((code) => matches(term, code.code, code.label))
      .slice(0, 5)
      .map((code) => ({ key: `code:${code.id}`, group: "Discount codes", title: code.code ?? code.id, sub: code.label, href: `/platform-admin/codes?code=${encodeURIComponent(code.id)}` }));
    return [...studioRows, ...personRows, ...issueRows, ...codeRows, ...pages.slice(0, 4)];
  }, [text, studios.rows, people.rows, issues.rows, codes.rows]);

  const go = (result: Result | undefined) => {
    if (!result) return;
    setPaletteOpen(false);
    router.push(result.href);
  };
  return (
    <>
      <div aria-hidden className="cx-overlay" onClick={() => setPaletteOpen(false)} />
      <div aria-label="Search the Console" aria-modal="true" className="cx-palette" role="dialog">
        <input
          aria-activedescendant={results[cursor] ? `palette-${cursor}` : undefined}
          aria-controls="palette-results"
          aria-label="Search studios, people, issues, codes and pages"
          className="cx-palette-input"
          onChange={(event) => {
            setText(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPaletteOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((current) => Math.min(results.length - 1, current + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((current) => Math.max(0, current - 1));
            }
            if (event.key === "Enter") go(results[cursor]);
          }}
          placeholder="Search studios, people, issues, codes and pages"
          ref={input}
          role="combobox"
          aria-expanded="true"
          value={text}
        />
        <div className="cx-palette-list" id="palette-results" role="listbox">
          {results.length === 0 ? <div className="cx-empty">Nothing matches “{text}”.</div> : null}
          {results.map((result, index) => {
            const header = index === 0 || results[index - 1]!.group !== result.group ? result.group : null;
            return (
              <div key={result.key}>
                {header ? <div className="cx-palette-group">{header}</div> : null}
                <button
                  aria-selected={index === cursor}
                  className="cx-palette-item"
                  id={`palette-${index}`}
                  onClick={() => go(result)}
                  onMouseEnter={() => setCursor(index)}
                  role="option"
                  type="button"
                >
                  {result.avatar ? <Avatar name={result.avatar} /> : null}
                  <span className="cx-palette-item-text">
                    <b>{result.title}</b>
                    {result.sub ? <small>{result.sub}</small> : null}
                  </span>
                  <span className="cx-palette-item-kind">{result.group}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="cx-palette-foot">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </>
  );
}
