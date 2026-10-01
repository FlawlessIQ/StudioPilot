"use client";

/**
 * Two small charts for the Console, drawn in SVG from theme tokens so they
 * read in light and dark. One scale per chart; every label is a value the
 * chart reaches.
 */

type Point = { label: string; value: number };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

export function LineChart({ points, format, height = 180, label }: { points: Point[]; format: (value: number) => string; height?: number; label: string }) {
  const width = 640;
  const pad = { top: 12, right: 16, bottom: 26, left: 56 };
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) => pad.left + (points.length <= 1 ? innerW : (index / (points.length - 1)) * innerW);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z` : "";
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const last = points.at(-1);
  return (
    <svg aria-label={label} className="cx-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="cx-chart-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
          <text textAnchor="end" x={pad.left - 8} y={y(tick) + 4}>{format(tick)}</text>
        </g>
      ))}
      {points.length ? <path className="cx-chart-area" d={area} opacity={0.6} /> : null}
      {points.length ? <path className="cx-chart-line" d={line} /> : null}
      {points.map((point, index) =>
        index % labelEvery === 0 || index === points.length - 1 ? (
          <text key={point.label} textAnchor={index === points.length - 1 ? "end" : "middle"} x={x(index)} y={height - 8}>
            {point.label}
          </text>
        ) : null,
      )}
      {last ? <circle className="cx-chart-dot" cx={x(points.length - 1)} cy={y(last.value)} r={4} /> : null}
    </svg>
  );
}

export function BarChart({
  points,
  format,
  height = 180,
  label,
  tone,
}: {
  points: Array<Point & { tone?: "bad" | "muted" }>;
  format: (value: number) => string;
  height?: number;
  label: string;
  tone?: "bad" | "muted";
}) {
  const width = 640;
  const pad = { top: 16, right: 12, bottom: 26, left: 56 };
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = points.length ? innerW / points.length : innerW;
  const barW = Math.min(36, slot * 0.6);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  return (
    <svg aria-label={label} className="cx-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
      {[0, max / 2, max].map((tick) => (
        <g key={tick}>
          <line className="cx-chart-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
          <text textAnchor="end" x={pad.left - 8} y={y(tick) + 4}>{format(tick)}</text>
        </g>
      ))}
      {points.map((point, index) => {
        const cx = pad.left + slot * index + slot / 2;
        const top = y(point.value);
        return (
          <g key={point.label}>
            <rect className="cx-chart-bar" data-tone={point.tone ?? tone} height={Math.max(0, pad.top + innerH - top)} rx={2} width={barW} x={cx - barW / 2} y={top} />
            <text textAnchor="middle" x={cx} y={height - 8}>{point.label}</text>
            {point.value ? <text textAnchor="middle" x={cx} y={top - 4}>{format(point.value)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
