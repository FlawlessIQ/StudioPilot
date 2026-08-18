/**
 * The Cue Mark — StudioCue's logo.
 *
 * A lens inside a film frame, with the projectionist's cue mark in the
 * corner: the dot that appears on screen to signal "now". One next step,
 * on cue.
 */
export function CueMark({ size = 38 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 96 96" width={size} height={size}>
      <rect x="8" y="8" width="80" height="80" rx="22" fill="#1E2521" />
      <circle cx="48" cy="48" r="21" fill="none" stroke="#FFFFFF" strokeWidth="5.5" />
      <circle cx="48" cy="48" r="7" fill="#FFFFFF" />
      <circle cx="71.5" cy="24.5" r="5.5" fill="#C9973D" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo">
      <span className="ds-brand-mark ds-brand-mark-logo" aria-hidden="true">
        <CueMark size={38} />
      </span>
      {!compact ? <span>StudioCue</span> : null}
    </span>
  );
}
