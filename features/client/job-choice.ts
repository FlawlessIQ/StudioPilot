/**
 * Which of a client's jobs the portal opens, and the list they switch between.
 *
 * A client can have more than one job with a studio — Priya Shah's wedding
 * and, booked later, her Sangeet (Jess Styles Bridal, 2026-10-12). The portal
 * opened whichever job it remembered, and nothing in it said there was another
 * or let her move to it. Now:
 *
 *   - a link from an email names its job (`?project=<id>`, added by the email
 *     renderer — functions/src/communications/email-templates.ts,
 *     portalLinkForJob), and the portal opens that job when the client's
 *     membership lists it;
 *   - a link to a job the membership does not list is never honoured: the
 *     portal opens the job it would have anyway and says, plainly, that the
 *     link's job isn't on this account. The server refuses such a job on its
 *     own (app/api/client/portal/route.ts, requireClientMembership) — this
 *     only decides what to show;
 *   - a client with two or more jobs sees them all, the open one marked, and
 *     can switch; a client with one sees nothing new. A job that is put away
 *     or not going ahead (clientJobClosed) is left off the list unless it is
 *     the one open: an inquiry the studio declined does not sit beside the
 *     client's bookings for good.
 *
 * Pure: no browser, no Firebase.
 */

import { todayLocalIso } from "@/lib/format/event-date";

/**
 * A job that is over without being a booking the client is working on:
 * archived, or not going ahead (LOST). Still theirs to open by a link; never
 * offered in the list beside their live ones, and never opened by default
 * over one.
 */
export function clientJobClosed(project: { state?: unknown; archivedAt?: unknown }): boolean {
  return Boolean(project.archivedAt) || project.state === "LOST" || project.state === "ARCHIVED";
}

/** The query parameter a portal link names its job with. */
export const PROJECT_PARAM = "project";

/** Firestore document ids as the portal's own schema accepts them (max 160). */
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

/** The job a portal URL names, or null when it names none (or nothing sane). */
export function requestedProjectFrom(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get(PROJECT_PARAM)?.trim() ?? "";
  return PROJECT_ID.test(value) ? value : null;
}

/** The URL's search string without the job parameter, for after it is honoured. */
export function searchWithoutProject(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PROJECT_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

type MembershipLike = { tenantId: string; projectIds: readonly string[] };

/**
 * Which studio's membership the portal opens: the one whose jobs include the
 * link's job, else the one remembered, else the first. A link never moves a
 * client into a studio they have no membership with — `permitted` is theirs.
 */
export function chooseClientMembership<T extends MembershipLike>(
  permitted: readonly T[],
  storedTenantId: string | null,
  requestedProjectId: string | null,
): T | undefined {
  if (requestedProjectId) {
    const holder = permitted.find((membership) => membership.projectIds.includes(requestedProjectId));
    if (holder) return holder;
  }
  return permitted.find((membership) => membership.tenantId === storedTenantId) ?? permitted[0];
}

export type ClientProjectChoice = {
  projectId: string | null;
  /**
   * The link named a job this account can't open. The portal opens
   * `projectId` instead and says so (unavailableJobNotice).
   */
  requestedUnavailable: boolean;
};

/**
 * Which job opens: the link's job when it is one of theirs, else the one they
 * last chose, else the first — preferring, without a link, a job that is not
 * closed (clientJobClosed) over one that is. `projects` is the server's list,
 * which is the membership's — so a link can only ever pick from what they
 * already have.
 */
export function chooseClientProject(input: {
  projects: ReadonlyArray<{ id: string; closed?: boolean }>;
  requestedProjectId: string | null;
  storedProjectId: string | null;
}): ClientProjectChoice {
  const ids = input.projects.map((project) => project.id);
  if (input.requestedProjectId && ids.includes(input.requestedProjectId))
    return { projectId: input.requestedProjectId, requestedUnavailable: false };
  const open = input.projects.filter((project) => !project.closed).map((project) => project.id);
  const stored = input.storedProjectId && ids.includes(input.storedProjectId) ? input.storedProjectId : null;
  const fallback =
    (stored && open.includes(stored) ? stored : null) ?? open[0] ?? stored ?? ids[0] ?? null;
  return { projectId: fallback, requestedUnavailable: Boolean(input.requestedProjectId) };
}

/** What the portal says when a link's job isn't on this account. */
export function unavailableJobNotice(openedName: string | null): string {
  return openedName
    ? `The link you followed is for a booking this account can't open, so we've opened ${openedName}. If you expected something else, sign in with the email address your studio wrote to, or message them.`
    : "The link you followed is for a booking this account can't open. If you expected something else, sign in with the email address your studio wrote to, or message them.";
}

export type JobSwitcherItem = {
  id: string;
  name: string;
  eventDate: string | null;
  active: boolean;
};

/**
 * Where a job sits in the list: still to come, not yet dated, or past. A
 * returning client is here for the job ahead of them, not the one they
 * finished last year; an undated one is still being arranged, so it comes
 * before what is over.
 */
function listBand(eventDate: string, today: string): 0 | 1 | 2 {
  if (!eventDate) return 1;
  return eventDate >= today ? 0 : 2;
}

/**
 * The jobs a client switches between, the open one marked: the ones still to
 * come first, soonest first; then any not yet dated; then past ones, most
 * recent first. A closed job (clientJobClosed) is left off unless it is the
 * open one. Null for one job or none: a client with a single job sees
 * nothing new.
 *
 * `today` is the client's own date (YYYY-MM-DD), the device's by default.
 */
export function clientJobSwitcherItems(
  projects: ReadonlyArray<{ id: string; name: string; eventDate: string | null; closed?: boolean }>,
  activeProjectId: string | null,
  today: string = todayLocalIso(),
): JobSwitcherItem[] | null {
  const unique = projects.filter(
    (project, index) =>
      project.id &&
      projects.findIndex((other) => other.id === project.id) === index &&
      (!project.closed || project.id === activeProjectId),
  );
  if (unique.length < 2) return null;
  return unique
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const a = left.project.eventDate ?? "";
      const b = right.project.eventDate ?? "";
      const bandA = listBand(a, today);
      const bandB = listBand(b, today);
      if (bandA !== bandB) return bandA - bandB;
      if (a !== b) return (bandA === 2 ? b < a : a < b) ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ project }) => ({
      id: project.id,
      name: project.name,
      eventDate: project.eventDate,
      active: project.id === activeProjectId,
    }));
}
