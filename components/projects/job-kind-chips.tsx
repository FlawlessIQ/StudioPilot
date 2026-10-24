"use client";

import Link from "next/link";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { JOB_KIND_LABELS, JOB_KINDS, jobKindOf, type JobKind } from "@/features/job-kinds/job-kinds";

/**
 * The Jobs list's one-tap kind filter, for the kinds this studio has jobs in.
 *
 * It listed all eleven kinds to every studio, so a new studio with no jobs at
 * all met a row of Bar & bat mitzvah, Quinceañera, Sports… above "No booked
 * jobs yet", and a wedding-only studio filtered between ten empty lists
 * (onboarding audit, 2026-10-24). A filter that can't narrow anything isn't
 * shown; the kind in the address always is, so a link to it still reads.
 */
export function JobKindChips({ type, view }: { type: string; view: string }) {
  const { records } = useTenantDocuments("projects");
  if (records === null) return null;
  const present = new Set<string>(records.map((project) => jobKindOf(project)));
  if (type !== "all") present.add(type);
  const kinds = JOB_KINDS.filter((kind: JobKind) => present.has(kind));
  if (type === "all" && kinds.length < 2) return null;
  return (
    <nav aria-label="Project type" className="crm-type-chips">
      {[["all", "All"], ...kinds.map((kind) => [kind, JOB_KIND_LABELS[kind]])].map(([value, label]) => (
        <Link
          aria-current={type === value ? "page" : undefined}
          className={type === value ? "active" : ""}
          href={`?view=${view}&type=${value}`}
          key={value}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
