"use client";

import { Plus, Trash2 } from "lucide-react";

type StructuredValue = Record<string, unknown>;

const hiddenByDefault = new Set(["sourceText"]);

const labels: Record<string, string> = {
  actionLabel: "Button label",
  actionUrl: "Button destination",
  amountCents: "Amount (cents)",
  body: "Message or document body",
  durationMinutes: "Duration (minutes)",
  lineItems: "Pricing items",
  signatureAnchors: "Signature fields",
  sourceText: "Original extracted text",
  timingRules: "Timing rules",
};

function labelFor(key: string) {
  return (
    labels[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function isRecord(value: unknown): value is StructuredValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultListItem(key: string): unknown {
  if (key === "fields") return { label: "", type: "text", required: false };
  if (key === "items") return { time: "", title: "", durationMinutes: null };
  if (key === "lineItems") return { description: "", amountCents: 0 };
  if (key === "signers") return { name: "", email: "", role: "Client" };
  if (key === "signatureAnchors") return { label: "", anchor: "" };
  return "";
}

function PrimitiveField({
  fieldKey,
  value,
  disabled,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <label className="structured-field structured-field-toggle">
        <input
          checked={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{labelFor(fieldKey)}</span>
      </label>
    );
  }
  const multiline =
    fieldKey === "body" ||
    fieldKey === "sourceText" ||
    String(value ?? "").length > 140;
  return (
    <label className="structured-field">
      <span>{labelFor(fieldKey)}</span>
      {multiline ? (
        <textarea
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={fieldKey === "sourceText" ? 5 : 4}
          value={String(value ?? "")}
        />
      ) : (
        <input
          disabled={disabled}
          onChange={(event) => {
            if (typeof value === "number") {
              onChange(event.target.value === "" ? null : Number(event.target.value));
              return;
            }
            onChange(event.target.value);
          }}
          type={typeof value === "number" ? "number" : "text"}
          value={value === null || value === undefined ? "" : String(value)}
        />
      )}
    </label>
  );
}

function ObjectFields({
  value,
  disabled,
  depth,
  onChange,
}: {
  value: StructuredValue;
  disabled: boolean;
  depth: number;
  onChange: (value: StructuredValue) => void;
}) {
  return (
    <div className={depth ? "structured-object is-nested" : "structured-object"}>
      {Object.entries(value)
        .filter(([key]) => !hiddenByDefault.has(key))
        .map(([key, fieldValue]) => (
          <StructuredField
            disabled={disabled}
            fieldKey={key}
            key={key}
            onChange={(next) => onChange({ ...value, [key]: next })}
            value={fieldValue}
            depth={depth}
          />
        ))}
      {Object.entries(value)
        .filter(([key]) => hiddenByDefault.has(key))
        .map(([key, fieldValue]) => (
          <details className="structured-source" key={key}>
            <summary>{labelFor(key)}</summary>
            <PrimitiveField
              disabled={disabled}
              fieldKey={key}
              onChange={(next) => onChange({ ...value, [key]: next })}
              value={fieldValue}
            />
          </details>
        ))}
    </div>
  );
}

function StructuredField({
  fieldKey,
  value,
  disabled,
  depth,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  disabled: boolean;
  depth: number;
  onChange: (value: unknown) => void;
}) {
  if (Array.isArray(value)) {
    const objectItems = value.some(isRecord);
    if (!objectItems && value.length > 0) {
      return (
        <label className="structured-field">
          <span>{labelFor(fieldKey)}</span>
          <textarea
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            rows={Math.min(8, Math.max(3, value.length + 1))}
            value={value.map(String).join("\n")}
          />
          <small>One item per line</small>
        </label>
      );
    }
    return (
      <fieldset className="structured-list">
        <legend>{labelFor(fieldKey)}</legend>
        {value.map((item, index) => (
          <div className="structured-list-item" key={`${fieldKey}-${index}`}>
            <span className="structured-list-number">{index + 1}</span>
            {isRecord(item) ? (
              <ObjectFields
                depth={depth + 1}
                disabled={disabled}
                onChange={(next) =>
                  onChange(value.map((current, itemIndex) => (itemIndex === index ? next : current)))
                }
                value={item}
              />
            ) : (
              <PrimitiveField
                disabled={disabled}
                fieldKey="Item"
                onChange={(next) =>
                  onChange(value.map((current, itemIndex) => (itemIndex === index ? next : current)))
                }
                value={item}
              />
            )}
            <button
              aria-label={`Remove ${labelFor(fieldKey)} item ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          className="structured-add"
          disabled={disabled}
          onClick={() => onChange([...value, defaultListItem(fieldKey)])}
          type="button"
        >
          <Plus size={14} /> Add {labelFor(fieldKey).toLowerCase()} item
        </button>
      </fieldset>
    );
  }
  if (isRecord(value)) {
    return (
      <fieldset className="structured-group">
        <legend>{labelFor(fieldKey)}</legend>
        <ObjectFields
          depth={depth + 1}
          disabled={disabled}
          onChange={onChange}
          value={value}
        />
      </fieldset>
    );
  }
  return (
    <PrimitiveField
      disabled={disabled}
      fieldKey={fieldKey}
      onChange={onChange}
      value={value}
    />
  );
}

export function StructuredContentFields({
  value,
  disabled = false,
  onChange,
}: {
  value: StructuredValue;
  disabled?: boolean;
  onChange: (value: StructuredValue) => void;
}) {
  return (
    <ObjectFields
      depth={0}
      disabled={disabled}
      onChange={onChange}
      value={value}
    />
  );
}

/** Long-form text is the draft itself, and reads as prose, not as a field. */
const proseKeys = new Set(["body", "summary", "message", "notes"]);

const isEmpty = (item: unknown) =>
  item === null ||
  item === undefined ||
  (typeof item === "string" && !item.trim()) ||
  (Array.isArray(item) && item.length === 0);

/**
 * A read-only look at prepared work.
 *
 * This is what a photographer sees before approving, so it shows the draft
 * rather than the shape of the record holding it: the written body reads as
 * prose, and a field the model left blank is omitted instead of announcing
 * itself as "Subject · Not set".
 */
export function StructuredContentPreview({ value }: { value: StructuredValue }) {
  const entries = Object.entries(value).filter(
    ([key, item]) => !hiddenByDefault.has(key) && !isEmpty(item),
  );
  const prose = entries.filter(([key]) => proseKeys.has(key));
  const facts = entries.filter(([key]) => !proseKeys.has(key));

  return (
    <div className="structured-preview-body">
      {prose.map(([key, item]) => (
        <p className="structured-preview-prose" key={key}>
          {String(item)}
        </p>
      ))}
      {facts.length ? (
        <dl className="structured-preview">
          {facts.map(([key, item]) => (
            <div key={key}>
              <dt>{labelFor(key)}</dt>
              <dd>
                {Array.isArray(item)
                  ? `${item.length} ${item.length === 1 ? "item" : "items"}`
                  : isRecord(item)
                    ? Object.entries(item)
                        .map(
                          ([nestedKey, nested]) =>
                            `${labelFor(nestedKey)}: ${String(nested)}`,
                        )
                        .join(" · ")
                    : String(item)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
