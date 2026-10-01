"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

/** The filter bar's parts: a search box, select chips, and the bulk bar that replaces them. */

export function SearchInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  id: string;
}) {
  return (
    <label className="cx-search" htmlFor={id}>
      <Search aria-hidden size={13} />
      <input
        aria-label={placeholder}
        autoComplete="off"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  );
}

/**
 * A filter chip that is a real <select>: keyboard, screen readers and phones
 * all get the native control. Dashed when unset, filled when set.
 */
export function ChipSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
  allLabel = "Any",
}: {
  label: string;
  value: Value | "";
  options: Array<{ value: Value; label: string }>;
  onChange: (value: Value | "") => void;
  allLabel?: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <span className="cx-chip" data-active={value ? "true" : undefined}>
      <select aria-label={label} onChange={(event) => onChange(event.target.value as Value | "")} value={value}>
        <option value="">
          {label}: {allLabel}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {label}: {option.label}
          </option>
        ))}
      </select>
      <span hidden>{current?.label}</span>
    </span>
  );
}

export function FilterBar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="cx-filterbar">
      {children}
      {end ? <div className="cx-filterbar-end">{end}</div> : null}
    </div>
  );
}

export function BulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  return (
    <div aria-live="polite" className="cx-bulk">
      <span>{count} selected</span>
      <div className="cx-bulk-actions">
        {children}
        <button className="cx-btn" onClick={onClear} type="button">
          Clear
        </button>
      </div>
    </div>
  );
}

/** Case- and accent-insensitive "does any of these contain the query". */
export function matches(query: string, ...values: Array<string | null | undefined>): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  return values.some((value) => value && normalise(value).includes(needle));
}

function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
