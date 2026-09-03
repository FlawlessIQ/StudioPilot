import assert from "node:assert/strict";
import { test } from "node:test";
import { crewAttention } from "@/features/crew/attention";
import { splitUpcomingAndPast } from "@/features/ordering/attention";

/**
 * The rule this file holds: nothing a crew member's money depends on is ever
 * left off their front page — and nothing they cannot act on is ever put on it.
 *
 * Sibling to tests/journey-preconditions.test.ts (studio) and
 * tests/portal-next-action.test.ts (couple). The crew home page used to build
 * its headline inline from two clauses and left closeout out, so a shooter
 * owed $800 read "Nothing needs you right now." This drives the one derivation
 * that now exists over every combination of assignment records it can build.
 */

const now = new Date("2026-09-03T12:00:00.000Z");
const PAST = { arrivalAt: "2026-08-15T17:15:00.000Z", departureAt: "2026-08-16T01:30:00.000Z" };
const FUTURE = { arrivalAt: "2026-10-03T17:15:00.000Z", departureAt: "2026-10-04T01:30:00.000Z" };

const STATUSES = ["invited", "viewed", "accepted", "completed", "declined", "withdrawn"] as const;
const WHENS = [PAST, FUTURE] as const;
const CLOSEOUTS = [undefined, "", "submitted", "needs_changes", "approved", "paid"] as const;
const SCHEDULES = [
  { currentScheduleVersion: 0, acknowledgedScheduleVersion: null },
  { currentScheduleVersion: 4, acknowledgedScheduleVersion: 3 },
  { currentScheduleVersion: 4, acknowledgedScheduleVersion: 4 },
] as const;
const EXPIRIES = ["2026-08-02T08:00:00.000Z", "2026-12-01T08:00:00.000Z"] as const;

type Rec = {
  id: string;
  status: string;
  arrivalAt: string;
  departureAt: string;
  inviteExpiresAt: string;
  currentScheduleVersion: number;
  acknowledgedScheduleVersion: number | null;
  closeout?: { status: string };
};

function* singles(): Generator<Rec> {
  let n = 0;
  for (const status of STATUSES)
    for (const when of WHENS)
      for (const closeout of CLOSEOUTS)
        for (const schedule of SCHEDULES)
          for (const inviteExpiresAt of EXPIRIES) {
            yield {
              id: `a${n++}`,
              status,
              ...when,
              inviteExpiresAt,
              ...schedule,
              ...(closeout === undefined ? {} : { closeout: { status: closeout } }),
            };
          }
}

const describe = (r: Rec) =>
  `${r.status} ${r.arrivalAt === PAST.arrivalAt ? "past" : "future"} closeout=${r.closeout?.status ?? "—"} sched=${r.acknowledgedScheduleVersion}/${r.currentScheduleVersion} expires=${r.inviteExpiresAt.slice(0, 10)}`;

test("a work record the studio is waiting on is always on the front page", () => {
  const failures: string[] = [];
  for (const rec of singles()) {
    const a = crewAttention([rec], now);
    const owed =
      ["accepted", "completed"].includes(rec.status) &&
      rec.arrivalAt === PAST.arrivalAt &&
      !["submitted", "approved", "paid"].includes(rec.closeout?.status ?? "");
    const named = a.closeoutsDue.some((c) => c.assignment.id === rec.id);
    const inHeadline = /work record/.test(a.headline);
    if (owed !== named || owed !== inHeadline) {
      failures.push(`${describe(rec)} → owed=${owed} listed=${named} headline="${a.headline}"`);
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], `\n${failures.slice(0, 6).join("\n")}`);
});

test("nothing they cannot act on is put on the front page", () => {
  /**
   * A lapsed offer is not an invitation; a past day's schedule is not a
   * blocker. Both once led the page — one 26 days after its deadline, one
   * thirteen days after the wedding.
   */
  const failures: string[] = [];
  for (const rec of singles()) {
    const a = crewAttention([rec], now);
    const lapsed = ["invited", "viewed"].includes(rec.status) && rec.inviteExpiresAt < now.toISOString();
    if (lapsed && a.invitations.length) failures.push(`lapsed offer listed: ${describe(rec)}`);
    const pastAck =
      rec.status === "accepted" &&
      rec.arrivalAt === PAST.arrivalAt &&
      rec.currentScheduleVersion > 0 &&
      rec.acknowledgedScheduleVersion !== rec.currentScheduleVersion;
    if (pastAck && a.acknowledgementDue) failures.push(`past-day acknowledgement listed: ${describe(rec)}`);
  }
  assert.deepEqual(failures.slice(0, 6), [], `\n${failures.slice(0, 6).join("\n")}`);
});

test("the headline is empty exactly when nothing is due", () => {
  for (const rec of singles()) {
    const a = crewAttention([rec], now);
    const anything = a.invitations.length || a.acknowledgementDue || a.closeoutsDue.length;
    assert.equal(
      a.headline === "Nothing needs you right now.",
      !anything,
      `${describe(rec)} → "${a.headline}"`,
    );
  }
});

test("past work is counted the way the Jobs page counts it", () => {
  // Home said 1, Jobs said 2: one filtered accepted, the other split by date.
  const all = [...singles()].slice(0, 40);
  const a = crewAttention(all, now);
  const jobs = splitUpcomingAndPast(all, (r) => r.arrivalAt, now).past;
  assert.deepEqual(a.behindThem.map((r) => r.id), jobs.map((r) => r.id));
});

test("Jordan's actual records", () => {
  // The seed the walk was made on: an unsubmitted record on a shot wedding,
  // and an offer that expired 2 August for a day on 22 August.
  const a = crewAttention(
    [
      { id: "booked", status: "accepted", ...PAST, inviteExpiresAt: "2026-07-01T00:00:00.000Z", currentScheduleVersion: 4, acknowledgedScheduleVersion: 3 },
      { id: "ready", status: "invited", arrivalAt: "2026-08-22T18:00:00.000Z", departureAt: "2026-08-23T00:00:00.000Z", inviteExpiresAt: "2026-08-02T08:00:00.000Z", currentScheduleVersion: 0, acknowledgedScheduleVersion: null },
    ],
    now,
  );
  assert.equal(a.headline, "You have 1 work record to send in.");
  assert.equal(a.invitations.length, 0);
  assert.equal(a.acknowledgementDue, null);
  assert.equal(a.behindThem.length, 2);
});
