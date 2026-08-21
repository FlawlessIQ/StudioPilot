"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MapPin, X } from "lucide-react";
import { addPlaceTag, type PlaceSuggestion } from "@/features/places/schema";
import {
  newPlacesSession,
  suggestPlaces,
  type PlacesSource,
} from "@/lib/places/client";

/**
 * Several places, as chips.
 *
 * Service areas are not one address — they are a list of towns and regions
 * a photographer will travel to, and they were a single comma-separated
 * box. "New York City, Hudson Valley" typed by hand becomes "NYC, hudson
 * valley" on the next profile, and nothing can match a crew member to a
 * job by area when the areas are prose.
 *
 * The differences from AddressField are deliberate. There is no resolve
 * step: a service area needs a name, not a postcode, so choosing a
 * suggestion costs one request rather than two. And typing a comma or
 * pressing Enter commits whatever is in the box, because a photographer
 * who covers "the Catskills" should not have to find it in a dropdown.
 */
export function PlaceTagsField({
  hint,
  label,
  name,
  onChange,
  placeholder,
  required,
  source = { kind: "studio" },
  value,
}: {
  hint?: string;
  label: string;
  /** Writes the comma-joined list into a hidden input for plain form posts. */
  name?: string;
  onChange: (values: string[]) => void;
  placeholder?: string;
  required?: boolean;
  source?: PlacesSource;
  value: string[];
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [searched, setSearched] = useState("");
  const session = useRef<string>(newPlacesSession());
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  /**
   * `source` is a fresh object on every render, so depending on it directly
   * would refetch on each keystroke. It is a two-case union, so the effect
   * rebuilds it from the two primitives that can actually change the
   * answer — which the dependency checker can verify, unlike a ref.
   */
  const sourceKind = source.kind;
  const tenantSlug = "tenantSlug" in source ? source.tenantSlug : null;

  const query = text.trim();
  const visible = query.length >= 2 ? suggestions : [];

  useEffect(() => {
    if (query.length < 2) return;
    if (live === false) return;
    const target: PlacesSource =
      sourceKind === "public" && tenantSlug
        ? { kind: "public", tenantSlug }
        : { kind: "studio" };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      suggestPlaces(
        { query, sessionToken: session.current, source: target },
        controller.signal,
      )
        .then((result) => {
          setSuggestions(result.value);
          setLive(result.live);
          setOpen(result.value.length > 0);
          setSearched(query);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setBusy(false));
    }, 260);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, live, sourceKind, tenantSlug]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function add(entry: string) {
    // The rules live in addPlaceTag, in the pure layer, where they are
    // testable — trimming, the trailing comma from typing "Hudson Valley,",
    // and case-insensitive dedupe.
    const next = addPlaceTag(value, entry);
    if (next !== value) onChange(next);
    setText("");
    setSuggestions([]);
    setOpen(false);
  }

  function remove(entry: string) {
    onChange(value.filter((existing) => existing !== entry));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // Enter here adds an area rather than submitting the form, which is
      // what someone typing a list expects it to do.
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const status =
    live === false
      ? "Area lookup is not connected. Type an area and press Enter to add it."
      : query.length >= 2 && searched === query && !busy && visible.length === 0
        ? "No match found. Press Enter to add it anyway."
        : null;

  return (
    <div className="address-field place-tags" ref={box}>
      <label htmlFor={`${label}-input`}>{label}</label>
      <div className="address-field-input">
        <MapPin aria-hidden="true" size={15} />
        <span className="place-tag-list">
          {value.map((entry) => (
            <span className="place-tag" key={entry}>
              {entry}
              <button
                aria-label={`Remove ${entry}`}
                onClick={() => remove(entry)}
                type="button"
              >
                <X aria-hidden="true" size={11} />
              </button>
            </span>
          ))}
          <input
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open}
            autoComplete="off"
            id={`${label}-input`}
            onBlur={() => add(text)}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={value.length ? "" : placeholder}
            // Required is satisfied by the chips, not the typing box —
            // otherwise a filled field with an empty box blocks submission.
            required={required && value.length === 0}
            role="combobox"
            type="text"
            value={text}
          />
        </span>
        {busy ? (
          <LoaderCircle aria-hidden="true" className="address-spin" size={14} />
        ) : null}
      </div>

      {name ? <input name={name} type="hidden" value={value.join(", ")} /> : null}

      {open && visible.length ? (
        <ul className="address-suggestions" id={listId} role="listbox">
          {visible.map((suggestion) => (
            <li
              key={suggestion.placeId}
              onMouseDown={(event) => {
                event.preventDefault();
                add(
                  suggestion.secondary
                    ? `${suggestion.primary}, ${suggestion.secondary.split(",")[0].trim()}`
                    : suggestion.primary,
                );
              }}
              role="option"
              aria-selected={false}
            >
              <strong>{suggestion.primary}</strong>
              {suggestion.secondary ? <small>{suggestion.secondary}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {status ? (
        <small className="address-field-hint is-status">{status}</small>
      ) : hint ? (
        <small className="address-field-hint">{hint}</small>
      ) : null}
    </div>
  );
}
