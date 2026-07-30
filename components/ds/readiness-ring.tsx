/**
 * Editorial readiness ring — claret arc on a warm track, serif numeral centered.
 * Part of the StudioCue design-system preview (`.ds-root` scope).
 */
export function ReadinessRing({
  value,
  size = 46,
  stroke = 4,
}: {
  value: number;
  size?: number;
  stroke?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const arc = clamped >= 100 ? "var(--ds-forest)" : "var(--ds-claret)";
  return (
    <span className="ds-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ds-brass-soft)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={arc}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className="ds-ring-label"
        style={{ fontSize: size * 0.32 }}
        aria-label={`${clamped}% ready`}
      >
        {clamped}
      </span>
    </span>
  );
}
