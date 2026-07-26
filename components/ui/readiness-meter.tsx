import { cn } from "@/lib/utils";

type ReadinessMeterProps = {
  value: number;
  size?: "sm" | "md" | "lg";
  label?: string;
};

export function ReadinessMeter({
  value,
  size = "md",
  label = "readiness",
}: ReadinessMeterProps) {
  const safeValue = Math.max(0, Math.min(100, value));
  const tone = safeValue === 100 ? "ready" : safeValue < 50 ? "risk" : "progress";

  return (
    <div
      className={cn("readiness-meter", `readiness-${size}`, `readiness-${tone}`)}
      aria-label={`${safeValue}% ${label}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="meter-track" cx="22" cy="22" r="18" />
        <circle
          className="meter-value"
          cx="22"
          cy="22"
          r="18"
          pathLength="100"
          strokeDasharray={`${safeValue} 100`}
        />
      </svg>
      <strong>{safeValue}</strong>
    </div>
  );
}
