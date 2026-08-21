"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, MapPin } from "lucide-react";
import {
  placeLabel,
  unverifiedPlace,
  type CapturedPlace,
  type PlaceSuggestion,
} from "@/features/places/schema";
import {
  newPlacesSession,
  resolvePlace,
  suggestPlaces,
  type PlacesSource,
} from "@/lib/places/client";

/**
 * One address box, everywhere an address is captured.
 *
 * The rules it exists to enforce:
 *
 * **Typing always wins.** A barn on a family farm has no listing, and a
 * field that refuses what someone types is worse than a plain input. The
 * value is committed on every keystroke as an unverified place; choosing a
 * suggestion upgrades it. Nothing is ever blocked or cleared.
 *
 * **Verified is visible.** `CapturedPlace.verified` decides whether a
 * certificate of insurance can trust the address, so the reader can see
 * which one they have rather than assuming.
 *
 * **A provider outage costs autocomplete, not the field.** Every failure
 * path falls back to plain typing, silently — a photographer entering a
 * venue does not need to hear that Places returned a 503.
 */
export function AddressField({
  country = "US",
  disabled,
  id,
  label,
  name,
  onChange,
  placeholder,
  required,
  source = { kind: "studio" },
  value,
  hint,
}: {
  /** Bias suggestions to one country. Null searches worldwide. */
  country?: string | null;
  disabled?: boolean;
  id?: string;
  label: string;
  /** Emits the formatted line into a hidden input for plain form posts. */
  name?: string;
  onChange: (place: CapturedPlace | null) => void;
  placeholder?: string;
  required?: boolean;
  source?: PlacesSource;
  value: CapturedPlace | null;
  hint?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-suggestions`;
  const [text, setText] = useState(() => (value ? placeLabel(value) : ""));
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [live, setLive] = useState<boolean | null>(null);
  /** The query the last completed search was for. */
  const [searched, setSearched] = useState("");
  const session = useRef<string>(newPlacesSession());
  const box = useRef<HTMLDivElement>(null);
  // Set while a suggestion is being applied, so the resulting text change
  // does not immediately fetch suggestions for the text we just wrote.
  const applying = useRef(false);

  // Follow the value when the form resets or a record loads underneath us
  // — the copilot filling a venue out of a client's email is the common
  // case. Adjusted during render rather than in an effect: an effect here
  // renders once with stale text and then again with fresh, which is the
  // cascading-render pattern React warns about.
  const committed = value ? placeLabel(value) : "";
  const [lastCommitted, setLastCommitted] = useState(committed);
  if (committed !== lastCommitted) {
    setLastCommitted(committed);
    setText(committed);
  }

  /**
   * `source` is a fresh object on every render, so depending on it directly
   * would refetch on each keystroke. It is a two-case union, so the effect
   * rebuilds it from the two primitives that can actually change the
   * answer — which the dependency checker can verify, unlike a ref.
   */
  const sourceKind = source.kind;
  const tenantSlug = "tenantSlug" in source ? source.tenantSlug : null;

  const query = text.trim();
  // Derived, not cleared in an effect: a query too short to search has no
  // suggestions by definition, and saying so with state means two renders
  // and a flash of the previous list.
  const visible = query.length >= 3 ? suggestions : [];

  const status =
    live === false
      ? "Address lookup is not connected, so there is nothing to choose from. What you type is saved as you type it."
      : query.length >= 3 && searched === query && !busy && visible.length === 0
        ? "No match found. What you type is saved as you type it."
        : null;

  useEffect(() => {
    if (applying.current) {
      applying.current = false;
      return;
    }
    if (query.length < 3) return;
    // Once the provider has told us it is not configured, stop asking. The
    // answer will not change within this page load, and the notice below
    // already says so.
    if (live === false) return;
    const target: PlacesSource =
      sourceKind === "public" && tenantSlug
        ? { kind: "public", tenantSlug }
        : { kind: "studio" };
    const controller = new AbortController();
    // Long enough that a normal typing rhythm produces one request per
    // pause rather than one per letter.
    const timer = setTimeout(() => {
      setBusy(true);
      suggestPlaces(
        { query, country, sessionToken: session.current, source: target },
        controller.signal,
      )
        .then((result) => {
          setSuggestions(result.value);
          setLive(result.live);
          setOpen(result.value.length > 0);
          setActive(-1);
          setSearched(query);
        })
        // Autocomplete is an enhancement. Losing it is not an error the
        // person filling in a venue needs to hear about.
        .catch(() => setSuggestions([]))
        .finally(() => setBusy(false));
    }, 260);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // `source` is a fresh object each render for the studio case; keying on
    // its kind and slug keeps this from re-running every render.
  }, [query, country, live, sourceKind, tenantSlug]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function type(next: string) {
    setText(next);
    // Commit as we go. If they stop here, the words are kept — flagged
    // unverified, never discarded.
    onChange(unverifiedPlace(next));
  }

  async function choose(suggestion: PlaceSuggestion) {
    applying.current = true;
    setOpen(false);
    setBusy(true);
    const controller = new AbortController();
    try {
      const result = await resolvePlace(
        { placeId: suggestion.placeId, sessionToken: session.current, source },
        controller.signal,
      );
      if (result.value) {
        setText(placeLabel(result.value));
        onChange(result.value);
      } else {
        const fallback = [suggestion.primary, suggestion.secondary]
          .filter(Boolean)
          .join(", ");
        setText(fallback);
        onChange(unverifiedPlace(fallback));
      }
    } catch {
      const fallback = [suggestion.primary, suggestion.secondary]
        .filter(Boolean)
        .join(", ");
      setText(fallback);
      onChange(unverifiedPlace(fallback));
    } finally {
      setBusy(false);
      // A resolved place ends the billable session; the next edit starts
      // a new one.
      session.current = newPlacesSession();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || visible.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % visible.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? visible.length - 1 : current - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // Only intercept Enter when a suggestion is highlighted, so the form
      // still submits normally the rest of the time.
      event.preventDefault();
      void choose(visible[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="address-field" ref={box}>
      <label htmlFor={inputId}>{label}</label>
      <div className="address-field-input">
        <MapPin aria-hidden="true" size={15} />
        <input
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          autoComplete="off"
          disabled={disabled}
          id={inputId}
          onChange={(event) => type(event.target.value)}
          onFocus={() => setOpen(visible.length > 0)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          required={required}
          role="combobox"
          type="text"
          value={text}
        />
        {busy ? (
          <LoaderCircle aria-hidden="true" className="address-spin" size={14} />
        ) : value?.verified ? (
          <span className="address-verified" title="Address confirmed">
            <Check aria-hidden="true" size={13} />
          </span>
        ) : null}
      </div>

      {name ? (
        <input name={name} type="hidden" value={value?.formatted ?? ""} />
      ) : null}

      {open && visible.length ? (
        <ul className="address-suggestions" id={listId} role="listbox">
          {visible.map((suggestion, index) => (
            <li
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              id={`${listId}-${index}`}
              key={suggestion.placeId}
              onMouseDown={(event) => {
                // mousedown, not click: the input's blur would close the
                // list before a click ever landed.
                event.preventDefault();
                void choose(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              role="option"
            >
              <strong>{suggestion.primary}</strong>
              {suggestion.secondary ? <small>{suggestion.secondary}</small> : null}
            </li>
          ))}

        </ul>
      ) : null}

      {/* A field that searches and says nothing is indistinguishable from a
          broken one. The reported symptom was exactly this: typing a real
          venue into an unconfigured deployment looked like the feature had
          failed, because the only disclosure lived inside a suggestion
          list that never appeared. */}
      {status ? (
        <small className="address-field-hint is-status">{status}</small>
      ) : hint ? (
        <small className="address-field-hint">{hint}</small>
      ) : null}
    </div>
  );
}
