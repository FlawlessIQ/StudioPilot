/**
 * Whether StudioCue may still write to this couple on the studio's behalf.
 *
 * The two post-event schedulers — review requests and album reminders — read
 * only their own queue and, for the album, the workflow's status. Neither ever
 * looked at the project. So a reminder scheduled at delivery goes out seven and
 * fourteen days later no matter what has happened to the job in between.
 *
 * Found on production: the Iris & Theo wedding was delivered, closed and
 * archived on 2026-09-18, and its two album reminders sat `scheduled` for
 * 2026-09-25 and 2026-10-02. A week after the studio filed the job away,
 * StudioCue would have asked the couple to choose their album photographs.
 *
 * `dueLifecycleMessages` already honours `clientAutomationsPausedAt` — the
 * quiet-by-default guard imported bookings rely on (ADR 0005). These two
 * schedulers bypass it entirely, which means an imported booking's couple can
 * be written to by the album reminder while every other automation stays quiet.
 *
 * Deliberately narrow. Each reason is an explicit studio act meaning "stop
 * talking to these people": they put the job away, they paused client
 * automation, or the wedding is not happening. `CLOSED` on its own is *not*
 * here — closeout settles the album and review requirements, but a studio that
 * closes a job without archiving it has not said the couple should hear
 * nothing, and an album genuinely still outstanding is worth one more ask.
 *
 * The functions copy. features/post-event/client-outreach.ts is the source of
 * truth; functions/ is a separate package with no "@/features" path, so the
 * rule is duplicated and tests/post-event-outreach-guard.test.ts asserts the
 * two files stay byte-identical below their headers.
 *
 * Pure.
 */

export type ClientOutreachStop =
  /** ARCHIVED, or carrying `archivedAt` — the studio filed the job away. */
  | "put_away"
  /** `clientAutomationsPausedAt` is set — quiet by the studio's choice. */
  | "automations_paused"
  /** The wedding is not happening. */
  | "cancelled";

export function clientOutreachStop(project: unknown): ClientOutreachStop | null {
  const fields = (project ?? {}) as {
    state?: unknown;
    archivedAt?: unknown;
    clientAutomationsPausedAt?: unknown;
  };
  const state = String(fields.state ?? "");
  if (state === "ARCHIVED" || Boolean(fields.archivedAt)) return "put_away";
  if (typeof fields.clientAutomationsPausedAt === "string")
    return "automations_paused";
  if (state === "CANCELLED") return "cancelled";
  return null;
}

/** A missing project is not a reason to write to somebody. */
export function mayContactClient(project: unknown): boolean {
  return Boolean(project) && clientOutreachStop(project) === null;
}
