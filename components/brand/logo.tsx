export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo">
      <span className="ds-brand-mark" aria-hidden="true">
        S
      </span>
      {!compact ? <span>StudioCue</span> : null}
    </span>
  );
}
