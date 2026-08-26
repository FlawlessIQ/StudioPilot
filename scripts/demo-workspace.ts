/**
 * A realistic studio, mid-season.
 *
 * `npm run seed` produces the minimum records the app needs to function.
 * This produces a studio that looks like a working business: a dozen jobs
 * spread across the year and across the journey, real money, real venues,
 * inquiries that read like people wrote them, work StudioCue has already
 * handled, and a few things genuinely going wrong. It is what you show a
 * prospective customer, and what you walk when you want to know whether the
 * product actually feels good to use.
 *
 * Emulator-only, like the seed it builds on. Run after `npm run seed`:
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true npx tsx scripts/demo-workspace.ts
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
  throw new Error("The demo workspace is restricted to Firebase emulator mode.");
}

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev";
const app = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId });
const firestore = getFirestore(app!);

const now = new Date();
const iso = now.toISOString();

/**
 * A date `days` from today, as YYYY-MM-DD.
 *
 * Built from the local calendar day rather than `toISOString()`, which would
 * roll the whole demo forward by one once the machine is west of UTC and
 * past evening — the seed would then disagree with the dates the UI shows.
 */
const day = (days: number): string => {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${String(value.getDate()).padStart(2, "0")}`;
};
/**
 * Six run-of-show items in the shape the app actually reads.
 *
 * Times are built as offsets from the event date in New York so the fixture
 * stays valid whenever the demo is regenerated.
 */
const scheduleItems = (
  eventDate: string,
): Array<Record<string, unknown>> => {
  const moments: Array<[string, string, number, number, string]> = [
    ["getting-ready", "Getting ready — bridal suite", 13, 90, "Bridal suite"],
    ["first-look", "First look", 15.5, 30, "Garden path"],
    ["ceremony", "Ceremony", 16.5, 45, "Ceremony lawn"],
    ["family", "Family photographs", 17.25, 40, "South terrace"],
    ["golden-hour", "Golden hour portraits", 18, 45, "Meadow"],
    ["exit", "Sparkler exit", 22.5, 15, "Front drive"],
  ];
  const stamp = (hours: number): string => {
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    return `${eventDate}T${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-04:00`;
  };
  return moments.map(([id, title, start, durationMinutes, location]) => ({
    id,
    title,
    startAt: stamp(start),
    endAt: stamp(start + durationMinutes / 60),
    location,
    visibility: "shared",
  }));
};

/** A timestamp `days` from now. */
const at = (days: number, hour = 10): string => {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
};

const tenantSnapshot = await firestore.collection("tenants").limit(1).get();
const tenant = tenantSnapshot.docs[0];
if (!tenant) throw new Error("Run `npm run seed` first — no tenant found.");
const tenantId = tenant.id;

const ownerSnapshot = await firestore
  .collection("memberships")
  .where("tenantId", "==", tenantId)
  .where("role", "==", "studio_owner")
  .limit(1)
  .get();
const ownerId = String(ownerSnapshot.docs[0]?.get("userId") ?? "demo-owner");

/**
 * The crew portal filters assignments by userId, so an assignment written
 * without one is invisible to the person it was offered to — the portal
 * showed "0 invitations" while two offers were outstanding.
 */
const crewMembershipSnapshot = await firestore
  .collection("memberships")
  .where("tenantId", "==", tenantId)
  .where("role", "==", "subcontractor")
  .limit(1)
  .get();
const crewUserId = crewMembershipSnapshot.docs[0]?.get("userId") ?? null;

const audit = {
  tenantId,
  createdAt: iso,
  updatedAt: iso,
  createdBy: ownerId,
  updatedBy: ownerId,
  archivedAt: null,
};

/** Clear anything a previous demo run created, so this is repeatable. */
const demoCollections = [
  "projects",
  "contacts",
  "leads",
  "packages",
  "packageSnapshots",
  "consultations",
  "proposals",
  "contracts",
  "invoiceReferences",
  "questionnaireResponses",
  "schedules",
  "crewAssignments",
  "crewCascades",
  "insuranceRequests",
  "deliveryRecords",
  "messages",
  "aiActions",
  "actionReceipts",
  "tasks",
  "workflowRuns",
  "checkpoints",
  "readinessAssessments",
  "bookingOrchestrations",
];
for (const name of demoCollections) {
  const existing = await firestore
    .collection(name)
    .where("tenantId", "==", tenantId)
    .get();
  let batch = firestore.batch();
  let count = 0;
  for (const document of existing.docs) {
    batch.delete(document.ref);
    if (++count === 400) {
      await batch.commit();
      batch = firestore.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();
}

const writes: Array<[string, Record<string, unknown>]> = [];
const put = (path: string, data: Record<string, unknown>) =>
  writes.push([path, data]);

// ── The studio's offering ──────────────────────────────────────────
const packages = [
  {
    id: "pkg-heirloom",
    name: "The Heirloom Collection",
    description:
      "Ten hours of coverage with two photographers, a second-shooter for preparations, and a hand-finished album.",
    basePriceCents: 895000,
    coverage: 600,
    photographers: 2,
  },
  {
    id: "pkg-signature",
    name: "The Signature Collection",
    description:
      "Eight hours of candid, documentary coverage with two photographers and a complete edited gallery.",
    basePriceCents: 650000,
    coverage: 480,
    photographers: 2,
  },
  {
    id: "pkg-intimate",
    name: "The Intimate Day",
    description:
      "Six hours for smaller weddings and elopements, with one photographer and a same-week preview gallery.",
    basePriceCents: 425000,
    coverage: 360,
    photographers: 1,
  },
];
for (const item of packages) {
  put(`packages/${item.id}`, {
    ...audit,
    id: item.id,
    name: item.name,
    description: item.description,
    eventTypeId: "wedding",
    eventTypeLabel: "Wedding",
    basePriceCents: item.basePriceCents,
    currency: "USD",
    retainerRule: { type: "percentage", basisPoints: 3000 },
    includedCoverageMinutes: item.coverage,
    includedPhotographers: item.photographers,
    includedDeliverables: [
      "Online gallery",
      "High-resolution downloads",
      "Print release",
    ],
    includedTravelArea: "Within 60 miles of Montclair",
    addOns: [],
    taxRateBasisPoints: 0,
    terms:
      "Coverage, deliverables, and payment schedule are governed by the completed studio agreement.",
    active: true,
    publicVisible: true,
    displayOrder: 0,
    internalNotes: null,
    version: 1,
  });
}

// ── The jobs ───────────────────────────────────────────────────────
type Job = {
  id: string;
  couple: string;
  first: string;
  last: string;
  partner: string;
  email: string;
  phone: string;
  eventDays: number;
  venue: string;
  city: string;
  state: string;
  packageId: string;
  priceCents: number;
};

const jobs: Job[] = [
  {
    id: "job-castillo",
    couple: "Maren & Diego Castillo",
    first: "Maren",
    last: "Castillo",
    partner: "Diego",
    email: "maren.castillo@example.com",
    phone: "(908) 555-0164",
    eventDays: 4,
    venue: "The Ryland Inn",
    city: "Whitehouse Station, NJ",
    state: "READY",
    packageId: "pkg-heirloom",
    priceCents: 895000,
  },
  {
    id: "job-okafor",
    couple: "Ada & Tobi Okafor",
    first: "Ada",
    last: "Okafor",
    partner: "Tobi",
    email: "ada.okafor@example.com",
    phone: "(973) 555-0119",
    eventDays: 23,
    venue: "Liberty House",
    city: "Jersey City, NJ",
    state: "PLANNING",
    packageId: "pkg-signature",
    priceCents: 650000,
  },
  {
    id: "job-bianchi",
    couple: "Sofia & Luca Bianchi",
    first: "Sofia",
    last: "Bianchi",
    partner: "Luca",
    email: "sofia.bianchi@example.com",
    phone: "(201) 555-0177",
    eventDays: 58,
    venue: "The Park Savoy Estate",
    city: "Florham Park, NJ",
    state: "BOOKED",
    packageId: "pkg-signature",
    priceCents: 650000,
  },
  {
    id: "job-nowak",
    couple: "Julia & Piotr Nowak",
    first: "Julia",
    last: "Nowak",
    partner: "Piotr",
    email: "julia.nowak@example.com",
    phone: "(862) 555-0143",
    eventDays: 96,
    venue: "Pleasantdale Chateau",
    city: "West Orange, NJ",
    state: "RETAINER_PENDING",
    packageId: "pkg-heirloom",
    priceCents: 895000,
  },
  {
    id: "job-ferrante",
    couple: "Nina & Gabriel Ferrante",
    first: "Nina",
    last: "Ferrante",
    partner: "Gabriel",
    email: "nina.ferrante@example.com",
    phone: "(917) 555-0188",
    eventDays: 141,
    venue: "The Estate at Florentine Gardens",
    city: "River Vale, NJ",
    state: "CONTRACT_PENDING",
    packageId: "pkg-signature",
    priceCents: 650000,
  },
  {
    id: "job-haddad",
    couple: "Layla & Sam Haddad",
    first: "Layla",
    last: "Haddad",
    partner: "Sam",
    email: "layla.haddad@example.com",
    phone: "(551) 555-0132",
    eventDays: 205,
    venue: "Nanina's in the Park",
    city: "Belleville, NJ",
    state: "PROPOSAL",
    packageId: "pkg-signature",
    priceCents: 650000,
  },
  {
    id: "job-mcbride",
    couple: "Erin & Cal McBride",
    first: "Erin",
    last: "McBride",
    partner: "Cal",
    email: "erin.mcbride@example.com",
    phone: "(646) 555-0155",
    eventDays: 268,
    venue: "The Ashford Estate",
    city: "Allentown, NJ",
    state: "CONSULTATION",
    packageId: "pkg-intimate",
    priceCents: 425000,
  },
  {
    id: "job-rivera",
    couple: "Camila & Andrés Rivera",
    first: "Camila",
    last: "Rivera",
    partner: "Andrés",
    email: "camila.rivera@example.com",
    phone: "(732) 555-0126",
    eventDays: -26,
    venue: "The Village at Grand Cascades",
    city: "Hamburg, NJ",
    state: "POST_PRODUCTION",
    packageId: "pkg-signature",
    priceCents: 650000,
  },
  {
    id: "job-whitfield",
    couple: "Priya & Jordan Whitfield",
    first: "Priya",
    last: "Whitfield",
    partner: "Jordan",
    email: "priya.whitfield@example.com",
    phone: "(908) 555-0171",
    eventDays: -61,
    venue: "Crossed Keys Estate",
    city: "Andover, NJ",
    state: "DELIVERED",
    packageId: "pkg-heirloom",
    priceCents: 895000,
  },
];

const bookedStates = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
]);

for (const job of jobs) {
  const contactId = `contact-${job.id}`;
  const snapshotId = `snapshot-${job.id}`;
  const retainerCents = Math.round(job.priceCents * 0.3);
  const hasSnapshot = job.state !== "CONSULTATION";
  /**
   * How far through the five readiness checkpoints this job has got. A job
   * that is READY has cleared them all; one still in PLANNING has cleared
   * the early ones. This is what gives the readiness score something real
   * to be derived from.
   */
  const readyDepth =
    job.state === "READY"
      ? 5
      : job.state === "PLANNING"
        ? 2
        : job.state === "BOOKED"
          ? 1
          : 0;

  put(`contacts/${contactId}`, {
    ...audit,
    id: contactId,
    firstName: job.first,
    lastName: job.last,
    displayName: `${job.first} ${job.last}`,
    email: job.email,
    normalizedEmail: job.email,
    phone: job.phone,
    normalizedPhone: job.phone.replace(/\D/g, ""),
    company: null,
    contactTypes: ["client"],
    projectIds: [job.id],
    portalUserId: null,
    marketingConsent: true,
    notes: null,
  });

  if (hasSnapshot) {
    const chosen = packages.find((item) => item.id === job.packageId)!;
    put(`packageSnapshots/${snapshotId}`, {
      ...audit,
      id: snapshotId,
      projectId: job.id,
      packageId: job.packageId,
      packageVersion: 1,
      packageName: chosen.name,
      description: chosen.description,
      currency: "USD",
      basePriceCents: job.priceCents,
      addOns: [],
      discountCents: 0,
      subtotalCents: job.priceCents,
      taxCents: 0,
      retainerCents,
      totalCents: job.priceCents,
      includedCoverageMinutes: chosen.coverage,
      includedPhotographers: chosen.photographers,
      includedDeliverables: [
        "Online gallery",
        "High-resolution downloads",
        "Print release",
      ],
      includedTravelArea: "Within 60 miles of Montclair",
      terms:
        "Coverage, deliverables, and payment schedule are governed by the completed studio agreement.",
      selectionDate: at(-120),
      selectedBy: ownerId,
      immutable: true,
    });
  }

  put(`projects/${job.id}`, {
    ...audit,
    id: job.id,
    projectId: job.id,
    name: job.couple,
    eventType: "Wedding",
    eventTypeId: "wedding",
    eventDate: day(job.eventDays),
    timezone: "America/New_York",
    state: job.state,
    stateVersion: 3,
    clientContactIds: [contactId],
    leadPhotographerId: null,
    leadPhotographerName: "You",
    leadId: null,
    venueName: job.venue,
    city: job.city,
    packageSnapshotId: hasSnapshot ? snapshotId : null,
    readinessScore:
      job.state === "READY" ? 100 : job.state === "PLANNING" ? 68 : 0,
    nextAction: null,
    createdAt: at(job.eventDays - 300),
  });

  // Consultation: everything past the lead stage had one.
  put(`consultations/consult-${job.id}`, {
    ...audit,
    id: `consult-${job.id}`,
    projectId: job.id,
    contactId,
    mode: "zoom",
    status: job.state === "CONSULTATION" ? "scheduled" : "completed",
    startsAt: at(job.eventDays - 280, 18),
    endsAt: at(job.eventDays - 280, 19),
    timezone: "America/New_York",
    location: "https://zoom.example.test/j/demo",
    calendarEventId: null,
    calendarHtmlLink: null,
    meetingId: null,
    joinUrl: "https://zoom.example.test/j/demo",
    internalNotes:
      job.state === "CONSULTATION"
        ? null
        : `${job.first} and ${job.partner} want candid, documentary coverage. Getting ready at two locations. Family photos kept short.`,
    reminderJobIds: [],
    supersedesId: null,
    createdAt: at(job.eventDays - 290),
  });

  // Proposal from the proposal stage onward.
  if (hasSnapshot) {
    const accepted = job.state !== "PROPOSAL";
    put(`proposals/proposal-${job.id}`, {
      ...audit,
      id: `proposal-${job.id}`,
      projectId: job.id,
      packageSnapshotId: snapshotId,
      version: 1,
      status: accepted ? "accepted" : "sent",
      draftRevision: 1,
      clientSnapshot: {
        displayName: `${job.first} ${job.last}`,
        email: job.email,
      },
      eventSnapshot: {
        name: job.couple,
        eventType: "Wedding photography",
        eventDate: day(job.eventDays),
        timezone: "America/New_York",
        venue: job.venue,
      },
      pricingSnapshot: {
        currency: "USD",
        packageName: packages.find((item) => item.id === job.packageId)!.name,
        subtotalCents: job.priceCents,
        discountCents: 0,
        taxCents: 0,
        retainerCents,
        totalCents: job.priceCents,
        lineItems: [
          {
            description: packages.find((item) => item.id === job.packageId)!
              .name,
            quantity: 1,
            unitPriceCents: job.priceCents,
            lineTotalCents: job.priceCents,
          },
        ],
      },
      notes: `Thank you both for such a lovely conversation. This reflects the day you described — candid coverage, the two of you first, and family photographs kept short and painless.`,
      termsSummary:
        "Coverage and deliverables are governed by the completed studio agreement.",
      expiresAt: at(job.eventDays - 250),
      sentAt: at(job.eventDays - 270),
      viewedAt: at(job.eventDays - 269),
      acceptedAt: accepted ? at(job.eventDays - 265) : null,
      declinedAt: null,
      pdfState: "ready",
      createdAt: at(job.eventDays - 272),
    });
  }

  // Contract + retainer once the agreement is out.
  if (job.state !== "CONSULTATION" && job.state !== "PROPOSAL") {
    const signed = job.state !== "CONTRACT_PENDING";
    put(`contracts/contract-${job.id}`, {
      ...audit,
      id: `contract-${job.id}`,
      projectId: job.id,
      proposalId: `proposal-${job.id}`,
      status: signed ? "completed" : "partially_signed",
      provider: "docusign",
      providerEnvelopeId: `envelope-${job.id}`,
      templateId: "studio-agreement-v4",
      signers: [
        { name: `${job.first} ${job.last}`, email: job.email, role: "Client", order: 1, status: signed ? "completed" : "sent" },
      ],
      sentAt: at(job.eventDays - 262),
      completedAt: signed ? at(job.eventDays - 260) : null,
      signedDocumentId: null,
      certificateDocumentId: null,
      completionEvidence: signed
        ? { provider: "docusign", eventId: `evt-${job.id}` }
        : null,
      fileHash: null,
      lastProviderEventId: null,
      providerState: "completed_mock",
      createdAt: at(job.eventDays - 262),
    });

    const retainerPaid = bookedStates.has(job.state);
    put(`invoiceReferences/retainer-${job.id}`, {
      ...audit,
      id: `retainer-${job.id}`,
      projectId: job.id,
      kind: "retainer",
      provider: "quickbooks",
      providerInvoiceId: `qb-${job.id}-r`,
      status: retainerPaid ? "paid" : "sent",
      amountCents: retainerCents,
      balanceCents: retainerPaid ? 0 : retainerCents,
      currency: "USD",
      dueDate: day(job.eventDays - 255),
      issuedAt: at(job.eventDays - 258),
      paidAt: retainerPaid ? at(job.eventDays - 256) : null,
      hostedInvoiceUrl: "https://quickbooks.example.test/invoice/demo",
      createdAt: at(job.eventDays - 258),
    });

    // Final balance for jobs close to or past their date.
    if (job.eventDays < 40) {
      const finalPaid = job.eventDays < -20;
      put(`invoiceReferences/final-${job.id}`, {
        ...audit,
        id: `final-${job.id}`,
        projectId: job.id,
        kind: "final",
        provider: "quickbooks",
        providerInvoiceId: `qb-${job.id}-f`,
        status: finalPaid ? "paid" : "sent",
        amountCents: job.priceCents - retainerCents,
        balanceCents: finalPaid ? 0 : job.priceCents - retainerCents,
        currency: "USD",
        dueDate: day(job.eventDays - 30),
        issuedAt: at(job.eventDays - 45),
        paidAt: finalPaid ? at(job.eventDays - 28) : null,
        hostedInvoiceUrl: "https://quickbooks.example.test/invoice/demo",
        createdAt: at(job.eventDays - 45),
      });
    }
  }

  // Planning records for booked jobs.
  if (bookedStates.has(job.state)) {
    put(`questionnaireResponses/form-${job.id}`, {
      ...audit,
      id: `form-${job.id}`,
      projectId: job.id,
      templateId: "template-wedding-details",
      contactId,
      status: job.eventDays < 60 ? "submitted" : "assigned",
      assignedAt: at(job.eventDays - 120),
      submittedAt: job.eventDays < 60 ? at(job.eventDays - 90) : null,
      dueDate: day(job.eventDays - 45),
      // Was `{}` on every job, including the submitted ones. A submitted form
      // holding no answers is the defect, not a fixture: the client portal read
      // "0% complete" beside "Submitted to your studio", and the readiness
      // checkpoint counted it done.
      answers:
        job.eventDays < 60
          ? {
              planner: "Wren Atwood, Atwood Events",
              ceremonyTime: "4:30pm",
              familyPhotoList: [
                `${job.first}'s parents`,
                `${job.last} grandparents`,
                "Both families together",
              ],
              accessibilityNeeds: "One guest uses a wheelchair — step-free routes please.",
              firstLook: "Yes, before the ceremony",
            }
          : {},
    });

    if (job.eventDays < 60) {
      put(`schedules/schedule-${job.id}`, {
        ...audit,
        id: `schedule-${job.id}`,
        projectId: job.id,
        version: 2,
        status: job.eventDays < 20 ? "approved" : "client_review",
        timezone: "America/New_York",
        // These were `{ time, label }`, a shape no reader understands. The
        // schema is `startAt`/`endAt`/`title`/`location`
        // (functions/src/planning/commands.ts), so the client portal rendered
        // "Invalid Date" six times and the studio's own detail page rendered 24
        // em-dashes — while every summary view reported "Items 6 · approved".
        // Seeding the canonical shape is what makes those screens auditable.
        items: scheduleItems(day(job.eventDays)),
        publishedAt: at(job.eventDays - 30),
      });

      put(`crewAssignments/crew-${job.id}`, {
        ...audit,
        id: `crew-${job.id}`,
        projectId: job.id,
        crewProfileId: "crew-jordan",
        userId: crewUserId,
        crewName: "Jordan Reid",
        role: "Second photographer",
        // What a real offer carries. Without these the crew portal shows a
        // job with no fee, no place and no duties under an "Accept" button.
        compensationType: "flat",
        compensationCents: 80000,
        currency: "USD",
        compensationVisibleToCrew: true,
        inviteExpiresAt: at(job.eventDays - 30),
        locations: [{ name: job.venue, address: job.city }],
        responsibilities: [
          "Ceremony reactions from the rear",
          "Cocktail-hour candids",
          "Backup primary photographer",
        ],
        // "offered" is not in assignmentStatusSchema; the system writes
        // "invited" when a role offer is released.
        status: job.eventDays < 12 ? "accepted" : "invited",
        arrivalAt: at(job.eventDays, 13),
        departureAt: at(job.eventDays, 23),
        respondedAt: job.eventDays < 12 ? at(job.eventDays - 20) : null,
      });

      // Readiness checkpoints — the thing the readiness score is derived
      // from. Without these the job page has a score it cannot explain, and
      // the whole readiness surface goes unexercised in the demo.
      // Named as things still outstanding, because that is how they are
      // listed when they block: "3 blockers: Final balance settled" reads as
      // an announcement that it is done.
      const checkpoints: Array<[string, string, string, number]> = [
        ["questionnaire", "Client details form", "client", 60],
        ["schedule", "Run of show approval", "studio", 21],
        ["crew", "Crew for the day", "subcontractor", 14],
        ["insurance", "Certificate of insurance for the venue", "studio", 10],
        ["balance", "Final balance", "client", 7],
      ];
      // What the records this job actually holds can support. Readiness is
      // derived from these checkpoints, so marking one complete while its
      // record says otherwise is how a wedding three days out reported 100%
      // ready with $6,265 outstanding and an empty details form.
      const recordSupports: Record<string, boolean> = {
        questionnaire: job.eventDays < 60,
        schedule: job.eventDays < 60,
        crew: true,
        insurance: true,
        // The final invoice is only written for jobs inside 40 days, and only
        // paid once well past the event.
        balance: job.eventDays < 40 && job.eventDays < -20,
      };
      checkpoints.forEach(([key, name, ownerType, daysBefore], index) => {
        // Progression along the job, AND a record that backs it up.
        const done =
          (job.eventDays < 0 || index < readyDepth) &&
          (recordSupports[key] ?? true);
        put(`checkpoints/checkpoint-${job.id}-${key}`, {
          ...audit,
          id: `checkpoint-${job.id}-${key}`,
          projectId: job.id,
          workflowRunId: `run-${job.id}`,
          templateKey: key,
          name,
          ownerType,
          blocking: true,
          status: done ? "complete" : index === readyDepth ? "in_progress" : "not_started",
          resolvedDueDate: day(job.eventDays - daysBefore),
          waiverExpiresAt: null,
          completedAt: done ? at(job.eventDays - daysBefore - 1) : null,
        });
      });

      put(`insuranceRequests/coi-${job.id}`, {
        ...audit,
        id: `coi-${job.id}`,
        projectId: job.id,
        requirementId: "req-standard",
        venueName: job.venue,
        status: job.eventDays < 15 ? "sent_to_venue" : "requested",
        scanStatus: "clean",
        requestedAt: at(job.eventDays - 40),
      });
    }
  }

  // Delivery for finished work.
  if (job.state === "DELIVERED") {
    put(`deliveryRecords/delivery-${job.id}`, {
      ...audit,
      id: `delivery-${job.id}`,
      projectId: job.id,
      provider: "manual",
      galleryUrl: "https://gallery.example.test/whitfield",
      accessCode: "WHITFIELD",
      expirationDate: day(300),
      deliveryDate: day(job.eventDays + 21),
      notes: "Full wedding gallery, 812 images, with print release.",
      status: "downloaded",
      sentAt: at(job.eventDays + 21),
      viewedAt: at(job.eventDays + 22),
      downloadedAt: at(job.eventDays + 23),
      providerDeliveryId: null,
    });
  }

  // A couple of real messages so the thread reads like a relationship.
  put(`messages/msg-${job.id}-1`, {
    ...audit,
    id: `msg-${job.id}-1`,
    projectId: job.id,
    direction: "outbound",
    subject: "Lovely to meet you both",
    preview:
      "Thank you for the call — I've put everything we discussed into a proposal for you.",
    sentAt: at(job.eventDays - 271),
    status: "sent",
  });
  if (bookedStates.has(job.state)) {
    put(`messages/msg-${job.id}-2`, {
      ...audit,
      id: `msg-${job.id}-2`,
      projectId: job.id,
      direction: "inbound",
      subject: "Re: Your wedding details form",
      preview:
        "Just sent the form back! One change — my mum's side is bigger than we thought, so family photos might run long.",
      sentAt: at(job.eventDays - 88),
      status: "received",
    });
  }
}

// ── Two live inquiries, in the words people actually use ───────────
put("leads/lead-donnelly", {
  ...audit,
  id: "lead-donnelly",
  firstName: "Aoife",
  lastName: "Donnelly",
  displayName: "Aoife Donnelly",
  partnerName: "Ruairi",
  email: "aoife.donnelly@example.com",
  phone: "(973) 555-0198",
  eventDate: day(412),
  eventType: "Wedding",
  eventTypeLabel: "Wedding",
  venue: "Perona Farms",
  city: "Andover, NJ",
  estimatedGuestCount: 165,
  servicesRequested: ["photography"],
  budgetRange: "$8,000–$12,000",
  referralSource: "Instagram",
  message:
    "Hi! We're getting married next October at Perona Farms and your work is exactly the feeling we want — nothing posed, just the day as it happens. Are you free, and roughly what do your collections run?",
  consent: true,
  status: "new",
  source: "public_inquiry",
  primaryContactId: null,
  createdAt: at(-2, 21),
});

put("leads/lead-park", {
  ...audit,
  id: "lead-park",
  firstName: "Hana",
  lastName: "Park",
  displayName: "Hana Park",
  partnerName: "Min",
  email: "hana.park@example.com",
  phone: "(201) 555-0107",
  eventDate: day(310),
  eventType: "Wedding",
  eventTypeLabel: "Wedding",
  venue: "The Rockleigh",
  city: "Rockleigh, NJ",
  estimatedGuestCount: 220,
  servicesRequested: ["photography", "videography"],
  budgetRange: "$5,000–$8,000",
  referralSource: "Referred by Priya Whitfield",
  message:
    "Priya said we had to talk to you. We're at The Rockleigh in June and would love both photo and video if you offer it.",
  consent: true,
  status: "new",
  source: "public_inquiry",
  primaryContactId: null,
  createdAt: at(-5, 9),
});

// ── Work StudioCue has already handled ─────────────────────────────
// The project each receipt names must be the project it is filed against —
// a receipt about the Bianchis appearing in the Castillos' thread is exactly
// the kind of cross-client bleed a photographer would never forgive.
const handled: Array<[string, string, number, string]> = [
  ["Booking confirmed automatically", "Signature and retainer verified for Sofia & Luca Bianchi, then the project folders and calendar hold were created.", -1, "job-bianchi"],
  ["Reminder sent", "Ada & Tobi Okafor were reminded about their wedding details form.", -2, "job-okafor"],
  ["Run of show shared", "The approved schedule went to Jordan Reid and the venue coordinator.", -3, "job-castillo"],
  ["Gallery follow-up sent", "Priya & Jordan Whitfield were reminded their gallery expires in 30 days.", -4, "job-whitfield"],
  ["Insurance certificate delivered", "The certificate for The Ryland Inn was sent and acknowledged.", -5, "job-castillo"],
];
handled.forEach(([title, summary, days, projectId], index) => {
  const id = `receipt-demo-${index}`;
  put(`actionReceipts/${id}`, {
    ...audit,
    id,
    projectId,
    title,
    summary,
    status: "completed",
    source: "studiocue",
    affectedEntityType: "project",
    affectedEntityId: projectId,
    providerEvidence: {},
    reversible: false,
    retryable: false,
    canCancel: false,
    canRetry: false,
    attempts: 1,
    completedAt: at(Number(days)),
  });
});

// ── Work waiting for the studio's approval ─────────────────────────
const drafts = [
  {
    id: "ai-demo-reply",
    projectId: "job-mcbride",
    title: "Reply to Erin & Cal about album options",
    subject: "Re: Albums",
    body: "Hi Erin,\n\nAbsolutely — the album upgrade adds a larger 12x12 with a linen cover, and we can decide after you've seen the gallery, so there's no rush.\n\nSpeak soon,",
  },
  {
    id: "ai-demo-checklist",
    projectId: "job-castillo",
    title: "Day-before checklist for Maren & Diego",
    subject: "Tomorrow!",
    body: "Hi Maren,\n\nWe're all set for tomorrow. If you can have the dress, shoes, rings, invitation suite and any heirlooms together in one place before 1pm, we'll photograph them while you're getting ready.\n\nSee you tomorrow,",
  },
  {
    id: "ai-demo-timeline",
    projectId: "job-okafor",
    title: "Run of show drafted from the details form",
    subject: null,
    body: "Ada and Tobi's form is in. Drafted timings around a 4:30pm ceremony with golden hour at 7:10pm, and left 40 minutes for family photographs as they asked.",
  },
];
for (const draft of drafts) {
  put(`aiActions/${draft.id}`, {
    ...audit,
    id: draft.id,
    projectId: draft.projectId,
    actorId: "vertex-ai-worker",
    modelProvider: "google_vertex_ai",
    modelVersion: "demo",
    instructionVersion: "demo-v1",
    outputSchemaVersion: "demo-v1",
    title: draft.title,
    capability: "message_draft",
    authorityBoundary: "human_approval_required",
    status: "review_required",
    structuredOutput: { subject: draft.subject, body: draft.body },
    confidence: { overall: 0.9, label: "high", uncertainFields: [] },
    decision: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
      latencyMs: 0,
      estimatedMinutesSaved: 14,
    },
    failure: null,
    snoozedUntil: null,
    sourceReferences: [
      {
        entityType: "project",
        entityId: draft.projectId,
        versionId: null,
        label:
          jobs.find((job) => job.id === draft.projectId)?.couple ?? "Project",
        locator: null,
      },
    ],
    validation: { status: "passed", issues: [] },
    downstreamCommand: null,
  });
}

// ── One thing genuinely going wrong ────────────────────────────────
put("tasks/task-demo-shotlist", {
  ...audit,
  id: "task-demo-shotlist",
  projectId: "job-okafor",
  projectName: "Ada & Tobi Okafor",
  title: "Confirm the family photo list with Ada's mother",
  description: "She asked to add her side of the family — needs a name list.",
  assignedRole: "studio_coordinator",
  dueDate: day(-3),
  priority: "high",
  status: "not_started",
  blocking: true,
  completedAt: null,
  completedBy: null,
  source: "studio",
});

let batch = firestore.batch();
let queued = 0;
for (const [path, data] of writes) {
  batch.set(firestore.doc(path), data);
  if (++queued === 400) {
    await batch.commit();
    batch = firestore.batch();
    queued = 0;
  }
}
if (queued) await batch.commit();

/**
 * Point the demo's client at a real job.
 *
 * The base seed binds client@studiohub.test to a project this script wipes,
 * so the client portal opened on "No project is assigned to this portal
 * membership" — which meant the half of the product a paying couple sees was
 * never exercised by the demo at all.
 */
const portalJob = jobs[0]!;
const clientMemberships = await firestore
  .collection("memberships")
  .where("tenantId", "==", tenantId)
  .where("role", "==", "client")
  .get();
for (const membership of clientMemberships.docs) {
  await membership.ref.update({
    projectIds: [portalJob.id],
    status: "active",
    updatedAt: iso,
    updatedBy: ownerId,
  });
  // The portal needs a person on the project, not only a membership.
  await firestore.doc(`projects/${portalJob.id}`).update({
    clientContactIds: [`contact-${portalJob.id}`],
    portalUserIds: [membership.get("userId")],
    updatedAt: iso,
    updatedBy: ownerId,
  });
}

/**
 * Point the demo's crew member at the jobs he is actually assigned to.
 *
 * Same gap as the client above: the base seed binds crew@studiohub.test to
 * projects this script wipes, so the crew portal — what a second shooter
 * sees when you offer them a role — showed nothing at all.
 */
const crewJobIds = jobs
  .filter((job) => job.eventDays > -60)
  .map((job) => job.id);
const crewMemberships = await firestore
  .collection("memberships")
  .where("tenantId", "==", tenantId)
  .where("role", "==", "subcontractor")
  .get();
for (const membership of crewMemberships.docs) {
  await membership.ref.update({
    projectIds: crewJobIds,
    status: "active",
    updatedAt: iso,
    updatedBy: ownerId,
  });
}

console.log(
  `Demo workspace ready for ${tenantId}: ${jobs.length} jobs, ${packages.length} packages, 2 inquiries, ${drafts.length} drafts awaiting approval, ${handled.length} things already handled. Client portal: ${portalJob.couple}.`,
);
