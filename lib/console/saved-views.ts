"use client";

import { useState } from "react";

/**
 * Views a person saves on a Console table: a name and the filters it applies.
 * Kept in this browser only — a convenience, not a shared record — so it
 * survives refreshes and stays out of everyone else's way.
 */
export type SavedView = { id: string; name: string; filters: Record<string, string> };

function read(key: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed.filter((item) => item && typeof item === "object" && typeof item.name === "string") as SavedView[]) : [];
  } catch {
    return [];
  }
}

export function useSavedViews(table: string) {
  const key = `studiocue.console.views.${table}`;
  const [views, setViews] = useState<SavedView[]>(() => read(key));
  const write = (next: SavedView[]) => {
    setViews(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage refused: the view lasts for this visit.
    }
  };
  return {
    views,
    save: (name: string, filters: Record<string, string>) => write([...views.filter((view) => view.name !== name), { id: `${Date.now()}`, name, filters }]),
    remove: (id: string) => write(views.filter((view) => view.id !== id)),
  };
}
