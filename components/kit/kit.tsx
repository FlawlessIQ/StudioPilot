"use client";

import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { studioThemeStyle } from "@/features/design/studio-theme";

/**
 * The StudioCue mobile kit: the building blocks every couple and crew screen
 * is made from (docs/mobile-first-client-crew-plan-2026-09-28.md, M1). Styles
 * live in app/kit.css and read only the tokens from design/tokens.json plus
 * the studio's accent, so a screen built from these is consistent by
 * construction. Preview them at /kit.
 */

export type Studio = {
  name: string;
  /** The studio's brand colour; clamped to a readable accent. */
  color?: string | null;
  logoUrl?: string | null;
};

/** The root of every kit screen: sets the studio's theme for everything inside. */
export function KitRoot({
  studio,
  children,
  className,
}: {
  studio?: Pick<Studio, "color"> | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["kit", className].filter(Boolean).join(" ")}
      style={studioThemeStyle(studio?.color) as CSSProperties}
    >
      {children}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="kit-screen">{children}</div>;
}

export function Main({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <main aria-label={label} className="kit-main">
      {children}
    </main>
  );
}

/** The studio's logo if it has one, else its initial on its colour. */
export function StudioMark({ studio, size = 28 }: { studio: Studio; size?: number }) {
  const initial = studio.name.trim().charAt(0).toUpperCase() || "S";
  return (
    <span
      aria-hidden="true"
      className="kit-mark"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {studio.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a studio's uploaded logo, any host
        <img alt="" src={studio.logoUrl} />
      ) : (
        initial
      )}
    </span>
  );
}

export function AppBar({
  studio,
  title,
  back,
  action,
}: {
  studio?: Studio;
  /** A screen title instead of the studio's name. */
  title?: string;
  back?: { href: string; label?: string };
  action?: ReactNode;
}) {
  return (
    <header className="kit-appbar">
      {back ? (
        <Link aria-label={back.label ?? "Back"} className="kit-icon-button" href={back.href}>
          <ChevronLeft aria-hidden="true" size={24} />
        </Link>
      ) : (
        <span />
      )}
      <span className="kit-appbar-centre">
        {title ? (
          <span className="kit-appbar-title">{title}</span>
        ) : studio ? (
          <span className="kit-brand">
            <StudioMark size={26} studio={studio} />
            <span className="kit-brand-name">{studio.name}</span>
          </span>
        ) : null}
      </span>
      {action ?? <span />}
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "dark" | "soft" | "danger";

type ButtonProps = {
  variant?: ButtonVariant;
  size?: "full" | "compact";
  icon?: LucideIcon;
  children: ReactNode;
};

/** A link when it has an `href`, otherwise a real button. */
export function Button({
  variant = "primary",
  size = "full",
  icon: Icon,
  children,
  href,
  ...rest
}: ButtonProps &
  ({ href: string } | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>))) {
  const shared = {
    className: "kit-button",
    "data-variant": variant === "primary" ? undefined : variant,
    "data-size": size === "compact" ? "compact" : undefined,
  };
  const content = (
    <>
      {Icon ? <Icon aria-hidden="true" size={20} /> : null}
      {children}
    </>
  );
  if (href) {
    return (
      <Link {...shared} href={href}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" {...shared} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  icon: Icon,
  ...input
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  icon?: LucideIcon;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <label className="kit-field">
      {label}
      <span className="kit-input-wrap" data-icon={Icon ? "" : undefined}>
        {Icon ? (
          <span className="kit-input-icon">
            <Icon aria-hidden="true" size={20} />
          </span>
        ) : null}
        <input
          aria-describedby={described || undefined}
          aria-invalid={error ? true : undefined}
          className="kit-input"
          {...input}
        />
      </span>
      {hint ? (
        <span className="kit-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="kit-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  ...textarea
}: { label: ReactNode; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <label className="kit-field">
      {label}
      <textarea aria-describedby={hint ? `${id}-hint` : undefined} className="kit-input" {...textarea} />
      {hint ? (
        <span className="kit-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** Choice chips: one answer (or several with `multiple`), always visible, never a <select>. */
export function Choices<T extends string>({
  legend,
  options,
  value,
  onChange,
  multiple = false,
}: {
  legend: ReactNode;
  options: readonly { value: T; label: string }[];
  value: T | readonly T[] | null;
  onChange: (next: T | T[]) => void;
  multiple?: boolean;
}) {
  const selected = new Set<T>(
    Array.isArray(value) ? value : value === null ? [] : [value as T],
  );
  return (
    <fieldset className="kit-choices">
      <legend>{legend}</legend>
      <span className="kit-chip-list">
        {options.map((option) => {
          const on = selected.has(option.value);
          return (
            <button
              aria-pressed={on}
              className="kit-chip"
              key={option.value}
              onClick={() => {
                if (!multiple) return onChange(option.value);
                const next = new Set(selected);
                if (on) next.delete(option.value);
                else next.add(option.value);
                onChange([...next]);
              }}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </span>
    </fieldset>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="kit-toggle"
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    />
  );
}

export function Card({
  children,
  tone,
  as: As = "section",
}: {
  children: ReactNode;
  tone?: "accent";
  as?: "section" | "div" | "article";
}) {
  return (
    <As className="kit-card" data-tone={tone}>
      {children}
    </As>
  );
}

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="kit-list">
      {children}
    </ul>
  );
}

/** One row of a List. A link when it has an `href`; a chevron then trails by default. */
export function Row({
  icon: Icon,
  title,
  subtitle,
  trailing,
  href,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      {Icon ? (
        <span className="kit-row-icon">
          <Icon aria-hidden="true" size={20} />
        </span>
      ) : null}
      <span className="kit-row-text">
        <span className="kit-row-title">{title}</span>
        {subtitle ? <span className="kit-row-subtitle">{subtitle}</span> : null}
      </span>
      <span className="kit-row-trailing">
        {trailing}
        {href && trailing === undefined ? <ChevronRight aria-hidden="true" size={18} /> : null}
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link className="kit-row" href={href}>
          {body}
        </Link>
      ) : (
        <div className="kit-row">{body}</div>
      )}
    </li>
  );
}

export function Pill({
  children,
  tone,
  icon: Icon,
}: {
  children: ReactNode;
  tone?: "accent" | "danger";
  icon?: LucideIcon;
}) {
  return (
    <span className="kit-pill" data-tone={tone}>
      {Icon ? <Icon aria-hidden="true" size={14} /> : null}
      {children}
    </span>
  );
}

export function Note({
  children,
  tone,
  icon: Icon,
}: {
  children: ReactNode;
  tone?: "accent" | "danger";
  icon?: LucideIcon;
}) {
  return (
    <p className="kit-note" data-tone={tone}>
      {Icon ? <Icon aria-hidden="true" size={18} /> : null}
      <span>{children}</span>
    </p>
  );
}

export function Steps({ step, total }: { step: number; total: number }) {
  return (
    <div
      aria-label={`Step ${step} of ${total}`}
      aria-valuemax={total}
      aria-valuemin={0}
      aria-valuenow={step}
      className="kit-steps"
      role="progressbar"
    >
      {Array.from({ length: total }, (_, index) => (
        <span data-done={index < step} key={index} />
      ))}
    </div>
  );
}

/** The screen's one primary action (and at most one alternative), in the thumb zone. */
export function Actions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="kit-actions">
      {children}
      {note ? <p className="kit-actions-note">{note}</p> : null}
    </div>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="kit-button-row">{children}</div>;
}

export type Tab = { href: string; label: string; icon: LucideIcon };

export function TabBar({ tabs, active }: { tabs: readonly Tab[]; active: string }) {
  return (
    <nav aria-label="Main" className="kit-tabbar">
      {tabs.map(({ href, label, icon: Icon }) => {
        const current = label === active;
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className="kit-tab"
            href={href}
            key={label}
          >
            <Icon aria-hidden="true" size={24} strokeWidth={current ? 2.2 : 1.8} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PoweredBy() {
  return <p className="kit-powered">Powered by StudioCue</p>;
}
