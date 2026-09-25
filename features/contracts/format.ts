/** "September 26, 2026 at 8:41 PM", in the reader's own time zone. */
export function formatSignedAt(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .replace(/, (\d{1,2}:\d{2})/, " at $1");
}
