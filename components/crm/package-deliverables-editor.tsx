"use client";

import { Plus, X } from "lucide-react";
import {
  DELIVERABLE_KINDS,
  kindDefaults,
  type DeliverableKind,
  type ExpectedDeliverable,
} from "@/features/post-event/deliverables";

export type EditableDeliverable = Pick<ExpectedDeliverable, "kind" | "label" | "turnaroundDays" | "final">;

const KIND_LABEL: Record<DeliverableKind, string> = {
  sneak_peek: "Sneak peek",
  gallery: "Photo gallery",
  highlight_film: "Highlight film",
  full_film: "Full film",
  teaser: "Film teaser",
  raw_files: "Raw files",
  album: "Album",
  other: "Something else",
};

/**
 * What a package delivers, and how long each takes (H4,
 * docs/delivery-plan-2026-09-28.md).
 *
 * Each job's expected deliveries, and their due dates, come from here. Before
 * it, every job was due 42 days after the event whatever it included, and a
 * film was never expected at all.
 */
export function PackageDeliverablesEditor({
  value,
  onChange,
}: {
  value: EditableDeliverable[];
  onChange: (next: EditableDeliverable[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableDeliverable>) =>
    onChange(value.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const unused = DELIVERABLE_KINDS.filter((kind) => !value.some((item) => item.kind === kind));
  return (
    <fieldset className="package-deliverables form-span">
      <legend>What this package delivers</legend>
      <p className="field-hint">
        Each is due this many days after the event. &ldquo;Counts as delivered&rdquo; items must all go out before the
        job is delivered and the review asks start.
      </p>
      {value.map((item, index) => (
        <div className="package-deliverable-row" key={`${item.kind}-${index}`}>
          <select
            aria-label="What it is"
            onChange={(event) => {
              const kind = event.target.value as DeliverableKind;
              const defaults = kindDefaults(kind);
              update(index, { kind, label: defaults.label, final: defaults.final, turnaroundDays: defaults.turnaroundDays });
            }}
            value={item.kind}
          >
            {DELIVERABLE_KINDS.filter((kind) => kind === item.kind || unused.includes(kind)).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <label>
            <input
              aria-label={`${item.label} turnaround in days`}
              max={730}
              min={0}
              onChange={(event) => update(index, { turnaroundDays: Math.max(0, Math.min(730, Number(event.target.value) || 0)) })}
              type="number"
              value={item.turnaroundDays ?? 0}
            />
            <span>days</span>
          </label>
          <label className="form-checkbox">
            <input checked={item.final} onChange={(event) => update(index, { final: event.target.checked })} type="checkbox" />
            <span>Counts as delivered</span>
          </label>
          <button
            aria-label={`Remove ${item.label}`}
            className="button button-quiet button-sm"
            onClick={() => onChange(value.filter((_, at) => at !== index))}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
      {unused.length && value.length < 8 ? (
        <button
          className="button button-light button-sm"
          onClick={() => {
            const kind = unused.find((candidate) => candidate !== "album") ?? unused[0]!;
            const defaults = kindDefaults(kind);
            onChange([...value, { kind, label: defaults.label, final: defaults.final, turnaroundDays: defaults.turnaroundDays }]);
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={14} /> Add a deliverable
        </button>
      ) : null}
    </fieldset>
  );
}
