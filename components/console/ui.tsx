"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Info, TriangleAlert, CircleAlert, CircleCheck } from "lucide-react";
import type { Tone } from "@/features/console/model";
import { dateTime, initials, relative, shortId } from "@/lib/console/format";

/** Small Console primitives. Every class is defined in app/console.css. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger" | "danger-solid";
  size?: "md" | "sm";
  icon?: boolean;
  busy?: boolean;
};

export function Button({ variant = "default", size = "md", icon = false, busy = false, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      className="cx-btn"
      data-icon={icon ? "true" : undefined}
      data-size={size === "sm" ? "sm" : undefined}
      data-variant={variant === "default" ? undefined : variant}
      disabled={disabled || busy}
      type={type}
      {...rest}
    >
      {busy ? <span aria-hidden className="cx-spinner" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "default", size = "md" }: { href: string; children: ReactNode; variant?: "default" | "primary" | "ghost"; size?: "md" | "sm" }) {
  const external = /^https?:/.test(href);
  return external ? (
    <a className="cx-btn" data-size={size === "sm" ? "sm" : undefined} data-variant={variant === "default" ? undefined : variant} href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ) : (
    <Link className="cx-btn" data-size={size === "sm" ? "sm" : undefined} data-variant={variant === "default" ? undefined : variant} href={href}>
      {children}
    </Link>
  );
}

export function Pill({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className="cx-pill" data-dot={dot ? undefined : "false"} data-tone={tone === "neutral" ? undefined : tone}>
      {children}
    </span>
  );
}

export function Tag({ children, code = false }: { children: ReactNode; code?: boolean }) {
  return (
    <span className="cx-tag" data-tone={code ? "code" : undefined}>
      {children}
    </span>
  );
}

export function Avatar({ name, round = false, large = false }: { name: string | null | undefined; round?: boolean; large?: boolean }) {
  return (
    <span aria-hidden className="cx-avatar" data-shape={round ? "round" : undefined} data-size={large ? "lg" : undefined}>
      {initials(name)}
    </span>
  );
}

export function NameCell({ name, sub, round = false }: { name: string; sub?: string | null; round?: boolean }) {
  return (
    <span className="cx-name">
      <Avatar name={name} round={round} />
      <span className="cx-name-text">
        <b>{name}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
    </span>
  );
}

export function Health({ band, score }: { band: "good" | "fair" | "poor" | "none"; score?: number }) {
  const label = band === "none" ? "n/a" : band === "good" ? "Good" : band === "fair" ? "Fair" : "Poor";
  return (
    <span className="cx-health" data-band={band}>
      {score !== undefined && band !== "none" ? `${score} · ${label}` : label}
    </span>
  );
}

export function Segments({ done, total = 6 }: { done: number; total?: number }) {
  return (
    <span aria-label={`${done} of ${total}`} className="cx-inline">
      <span aria-hidden className="cx-seg">
        {Array.from({ length: total }, (_, index) => (
          <span className="cx-seg-cell" data-on={index < done ? "true" : "false"} key={index} />
        ))}
      </span>
      <span className="cx-num">
        {done}/{total}
      </span>
    </span>
  );
}

/** "2h ago" with the exact time on hover. */
export function When({ at, dimEmpty = true }: { at: string | null | undefined; dimEmpty?: boolean }) {
  if (!at) return <span className={dimEmpty ? "cx-dim" : undefined}>—</span>;
  return (
    <time dateTime={at} title={dateTime(at)}>
      {relative(at)}
    </time>
  );
}

export function CopyId({ value, label }: { value: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="cx-dim">—</span>;
  return (
    <button
      aria-label={`Copy ${label ?? "id"} ${value}`}
      className="cx-copy"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => undefined);
      }}
      title={value}
      type="button"
    >
      {shortId(value)}
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="cx-stats">{children}</div>;
}

export function Stat({ label, value, tone, onClick, active }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad"; onClick?: () => void; active?: boolean }) {
  const content = (
    <>
      <span className="cx-stat-label">{label}</span>
      <span className="cx-stat-value">{value}</span>
    </>
  );
  return onClick ? (
    <button aria-pressed={active} className="cx-stat" data-tone={tone} onClick={onClick} type="button">
      {content}
    </button>
  ) : (
    <div className="cx-stat" data-tone={tone}>
      {content}
    </div>
  );
}

export function Panel({ title, actions, children, flush = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="cx-panel">
      {title ? (
        <header className="cx-panel-head">
          <span>{title}</span>
          {actions ? <span className="cx-panel-head-end">{actions}</span> : null}
        </header>
      ) : null}
      <div className="cx-panel-body" data-flush={flush ? "true" : undefined}>
        {children}
      </div>
    </section>
  );
}

export function KV({ items }: { items: Array<[string, ReactNode] | null | false> }) {
  return (
    <dl className="cx-kv">
      {items.filter((item): item is [string, ReactNode] => Boolean(item)).map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cx-empty">
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", title, children, actions }: { tone?: "info" | "warn" | "bad" | "ok"; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const Icon = tone === "bad" ? CircleAlert : tone === "warn" ? TriangleAlert : tone === "ok" ? CircleCheck : Info;
  return (
    <div className="cx-notice" data-tone={tone === "ok" ? undefined : tone} role={tone === "bad" ? "alert" : undefined}>
      <Icon size={15} />
      <div className="cx-notice-body">
        {title ? <b>{title}</b> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {actions ? <div className="cx-notice-actions">{actions}</div> : null}
    </div>
  );
}

export function UsageBar({ value, limit }: { value: number; limit: number | null }) {
  const percent = limit ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  return (
    <div aria-hidden className="cx-bar">
      <span className="cx-bar-fill" data-tone={percent >= 90 ? "bad" : percent >= 75 ? "warn" : undefined} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Tabs<Key extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ key: Key; label: string; count?: number | null }>;
  value: Key;
  onChange: (key: Key) => void;
  label: string;
}) {
  return (
    <div aria-label={label} className="cx-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.key === value}
          className="cx-tab"
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          type="button"
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null ? <span className="cx-tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ title, count, children }: { title: string; count?: number | null; children?: ReactNode }) {
  return (
    <div className="cx-page-head">
      <h1 className="cx-page-title">{title}</h1>
      {count !== undefined && count !== null ? <span className="cx-count">{count}</span> : null}
      {children ? <div className="cx-page-head-actions">{children}</div> : null}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span aria-label={label} className="cx-spinner" role="status" />;
}
