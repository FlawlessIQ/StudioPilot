import Image from "next/image";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-logo">
      <span className="brand-mark" aria-hidden="true">
        <Image alt="" height={30} src="/favicon.svg" width={30} />
      </span>
      {!compact ? <span>StudioCue</span> : null}
    </span>
  );
}
