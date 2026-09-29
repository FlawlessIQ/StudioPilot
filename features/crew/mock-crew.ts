/**
 * A crew member for mock mode, so every crew screen can be walked and tested
 * (the couple's side has features/client/mock-project.ts).
 *
 * Dates are relative to `now`, so the offer is always open, the next job is
 * always ahead and the last one always behind. Three jobs cover the three
 * moments the crew workspace exists for: an offer to answer, an upcoming job
 * whose run of show changed since it was read, and a past job whose hours
 * are owed.
 */

type Value = Record<string, unknown> & { id: string };

const TIMEZONE = "America/New_York";

/** The UTC offset of New York at an instant, in minutes ("GMT-4" → -240). */
function newYorkOffset(instant: number): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, timeZoneName: "shortOffset" })
      .formatToParts(new Date(instant))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** `days` from now, at `hour:minute` on a New York wall clock, in any season. */
function at(now: Date, days: number, hour: number, minute = 0): string {
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + days);
  const wall = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute);
  return new Date(wall - newYorkOffset(wall) * 60_000).toISOString();
}

export function mockCrewData(now: Date): {
  assignments: Value[];
  projects: Record<string, Value>;
  profile: Value;
  availability: Value[];
  studio: Value;
} {
  const upcoming = 6;
  return {
    assignments: [
      {
        id: "demo-offer",
        projectId: "demo-offer-project",
        projectName: "Nguyen & Park wedding",
        status: "invited",
        role: "Second photographer",
        arrivalAt: at(now, 20, 13),
        departureAt: at(now, 20, 22),
        inviteExpiresAt: at(now, 2, 17),
        compensationVisibleToCrew: true,
        compensationCents: 85000,
        compensationType: "flat",
        currency: "USD",
        responsibilities: ["Groom's preparation", "Ceremony second angle", "Candids through cocktail hour"],
        locations: [{ name: "Harbor View Estate", address: "40 Shore Road, Gloucester, MA" }],
      },
      {
        id: "demo-upcoming",
        projectId: "demo-project",
        status: "accepted",
        role: "Second photographer",
        arrivalAt: at(now, upcoming, 13),
        departureAt: at(now, upcoming, 23),
        compensationVisibleToCrew: true,
        compensationCents: 90000,
        compensationType: "flat",
        currency: "USD",
        currentScheduleId: "demo-schedule",
        currentScheduleVersion: 2,
        acknowledgedScheduleVersion: 1,
        calendarStatus: "not_added",
        responsibilities: ["Getting ready (groom)", "Ceremony wide angle", "Family formals with the lead"],
        locations: [{ name: "The Garden Conservatory", address: "25 Garden Lane, Brookline, MA" }],
        requirements: [
          { id: "schedule", kind: "acknowledgement", name: "Read the run of show", required: true, status: "missing" },
          { id: "gear", kind: "equipment", name: "Two bodies and backup cards", required: true, status: "missing" },
          { id: "w9", kind: "w9", name: "W-9", required: true, status: "missing", instructions: "The IRS form, signed." },
          { id: "coi", kind: "insurance", name: "Certificate of insurance", required: true, status: "complete" },
        ],
      },
      {
        id: "demo-past",
        projectId: "demo-past-project",
        status: "accepted",
        role: "Second photographer",
        arrivalAt: at(now, -10, 14),
        departureAt: at(now, -10, 22),
        compensationVisibleToCrew: true,
        compensationCents: 80000,
        compensationType: "flat",
        currency: "USD",
        currentScheduleVersion: 3,
        acknowledgedScheduleVersion: 3,
        locations: [{ name: "Lakeside Lodge", address: "9 Lake Street, Concord, MA" }],
        closeout: {},
      },
    ],
    projects: {
      "demo-project": {
        id: "demo-project",
        name: "Rivera wedding",
        venueName: "The Garden Conservatory",
        timezone: TIMEZONE,
      },
      "demo-past-project": { id: "demo-past-project", name: "Lopez wedding", venueName: "Lakeside Lodge" },
    },
    profile: {
      id: "demo-crew-profile",
      name: "Sam Carter",
      active: true,
      phone: "+1 617 555 0199",
      trades: ["photographer"],
      specialties: ["Weddings", "Portraits"],
      serviceAreas: ["Boston", "Providence"],
      travelRadiusMiles: 60,
      equipment: ["Canon R5", "Canon R6", "24-70mm f/2.8"],
      w9Status: "missing",
      insuranceStatus: "received",
      contractStatus: "signed",
      emergencyContact: { name: "Alex Carter", phone: "+1 617 555 0123", relationship: "Partner" },
    },
    availability: [
      { id: "demo-away", startsAt: at(now, 3, 0), endsAt: at(now, 5, 0), status: "unavailable", notes: "Family trip" },
      { id: "demo-free", startsAt: at(now, 12, 0), endsAt: at(now, 13, 0), status: "available", notes: null },
    ],
    studio: { id: "demo-tenant", brandName: "StudioCue Demo Studio", eventDayPhone: "+1 617 555 0142" },
  };
}

/** The run of show for the upcoming job, as `crewScheduleViews` holds it. */
export function mockCrewSchedule(now: Date): Value {
  return {
    id: "demo-schedule_demo-upcoming",
    sourceScheduleId: "demo-schedule",
    version: 2,
    timezone: TIMEZONE,
    items: [
      { id: "arrive", startAt: at(now, 6, 13), endAt: at(now, 6, 13, 30), title: "Arrive, meet the lead", location: "Staff entrance", visibility: "crew" },
      { id: "prep", startAt: at(now, 6, 13, 30), endAt: at(now, 6, 15), title: "Groom getting ready", location: "Carriage house", visibility: "shared" },
      { id: "ceremony", startAt: at(now, 6, 17), endAt: at(now, 6, 17, 30), title: "Ceremony", location: "Garden ceremony space", visibility: "shared", description: "Wide angle from the back row. No flash." },
      { id: "formals", startAt: at(now, 6, 17, 35), endAt: at(now, 6, 18, 5), title: "Family formals", location: "Conservatory steps", visibility: "shared" },
      { id: "reception", startAt: at(now, 6, 19), endAt: at(now, 6, 23), title: "Reception", location: "Glass hall", visibility: "shared" },
    ],
  };
}
