import { Aperture } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo">
      <span className="brand-mark" aria-hidden="true">
        <Aperture size={18} strokeWidth={1.8} />
      </span>
      {!compact ? <span>StudioCue</span> : null}
    </span>
  );
}
