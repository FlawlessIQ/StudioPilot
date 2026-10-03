import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  autoRequestForProject,
  coiAgentRequirement,
  coiRequestIds,
  venueKey,
  venueKeyCandidates,
  venueKeyForRequirement,
  venueProfileId,
} from "../functions/src/coi/automation";
import { approvePreparedCoi, selfServeCorrection } from "../functions/src/coi/actions";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { coiStatusSchema } from "@/features/insurance/schema";
import { COI_STATUSES_WITH_PROGRESS, coiProgress } from "@/features/insurance/progress";
import { EXPLAINERS } from "@/features/help/explainers";

/**
 * The certificate-of-insurance audit before filming (2026-10-03).
 *
 * - The automatic and prepared requests asked the agent for a certificate
 *   without the venue's additional-insured wording, waiver or
 *   primary/noncontributory flags, and the studio's standing notes for its
 *   agent reached only the manual path. Every path now builds the agent's
 *   requirement the same way (coiAgentRequirement), and the rendered email
 *   is what is checked here.
 * - A manual request wrote no venueKey, so the venue profile saved on sending
 *   was keyed by the typed legal name and the next automatic request missed it.
 * - The status track and badge on /studio/insurance, the coordinator's
 *   approve button, the self-serve "Ask agent to correct", and three pieces of
 *   copy that described chasing and the flow wrongly.
 */

const read = (path: string) => readFileSync(path, "utf8");

// ---------- A small in-memory Firestore, with batches ----------

type Data = Record<string, unknown>;
const getPath = (data: Data | undefined, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Data)[key] : undefined), data);

class FakeDb {
  store = new Map<string, Data>();
  doc(path: string) {
    return new FakeRef(this, path);
  }
  collection(name: string) {
    return new FakeQuery(this, name, []);
  }
  snapshot(path: string) {
    const data = this.store.get(path);
    const ref = this.doc(path);
    return {
      exists: data !== undefined,
      id: ref.id,
      ref,
      get: (field: string) => getPath(data, field),
      data: () => (data ? structuredClone(data) : undefined),
    };
  }
  batch() {
    const pending: Array<() => void> = [];
    return {
      create: (ref: FakeRef, data: Data) =>
        pending.push(() => {
          if (this.store.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          this.store.set(ref.path, structuredClone(data));
        }),
      set: (ref: FakeRef, data: Data, options?: { merge?: boolean }) =>
        pending.push(() =>
          this.store.set(ref.path, { ...(options?.merge ? this.store.get(ref.path) : {}), ...structuredClone(data) }),
        ),
      update: (ref: FakeRef, changes: Data) =>
        pending.push(() => {
          const current = this.store.get(ref.path);
          assert.ok(current, `update of missing ${ref.path}`);
          Object.assign(current, structuredClone(changes));
        }),
      commit: async () => {
        for (const apply of pending) apply();
      },
    };
  }
}
class FakeRef {
  constructor(readonly db: FakeDb, readonly path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  async get() {
    return this.db.snapshot(this.path);
  }
}
class FakeQuery {
  constructor(readonly db: FakeDb, readonly name: string, readonly filters: Array<[string, unknown]>) {}
  where(field: string, _op: string, value: unknown) {
    return new FakeQuery(this.db, this.name, [...this.filters, [field, value]]);
  }
  limit() {
    return this;
  }
  async get() {
    const docs = [...this.db.store.keys()]
      .filter((path) => path.startsWith(`${this.name}/`) && !path.slice(this.name.length + 1).includes("/"))
      .map((path) => this.db.snapshot(path))
      .filter((snapshot) => this.filters.every(([field, value]) => snapshot.get(field) === value));
    return { docs, empty: docs.length === 0 };
  }
}

const T = "tenant_a";
const P = "project_1";
const NOW = "2027-07-21T14:00:00.000Z";
const WORDING = "Arnold Arboretum and the President and Fellows of Harvard College";
const NOTES = "Policy HX-12345 — bill the studio, not the couple.";
const brand = { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

function studio(db: FakeDb, dial: "prepare" | "auto") {
  db.store.set(`coiSettings/${T}`, {
    tenantId: T,
    source: "agent",
    agentEmail: "agent@insure.test",
    agentNotes: NOTES,
    dial,
  });
  db.store.set(`subscriptions/${T}`, { tenantId: T, entitlements: { coiEnabled: true } });
  db.store.set(`projects/${P}`, {
    tenantId: T,
    state: "BOOKED",
    eventDate: "2027-09-18",
    insuranceRequired: "required",
    venueName: "Arnold Arboretum",
    venue: { placeId: "ChIJ-arboretum", formatted: "125 Arborway, Boston, MA 02130" },
  });
  // Remembered from a certificate a manual request sent before requests
  // carried the place's key: saved under the venue's name.
  const nameKey = venueKey({ name: "Arnold Arboretum" })!;
  db.store.set(`venueCoiProfiles/${venueProfileId(T, nameKey)}`, {
    tenantId: T,
    venueKey: nameKey,
    certificateHolder: "President and Fellows of Harvard College",
    venueLegalName: "Arnold Arboretum",
    venueAddress: "125 Arborway, Boston, MA 02130",
    additionalInsuredWording: WORDING,
    requiredLimits: { generalLiability: 200_000_000 },
    coverageTypes: ["General liability"],
    submissionEmail: "events@arboretum.test",
    waiverOfSubrogation: true,
    primaryNoncontributory: true,
  });
}

function assertAgentEmailCarriesEverything(job: Data | undefined) {
  assert.ok(job, "the agent's email was queued");
  const rendered = renderEmailTemplate({ key: "coi_request", brand, values: job! });
  assert.match(rendered.text, new RegExp(`Additional insured, worded exactly: "${WORDING}"`));
  assert.match(rendered.text, /Include a waiver of subrogation\./);
  assert.match(rendered.text, /Include primary and noncontributory wording\./);
  assert.ok(rendered.text.includes(NOTES), "the studio's standing notes reach the agent");
  assert.match(rendered.text, /general liability \$2,000,000/);
}

test("an automatic request tells the agent the venue's wording and the studio's notes", async () => {
  process.env.SENDGRID_INBOUND_DOMAIN = "reply.studiocue.test";
  const db = new FakeDb();
  studio(db, "auto");
  const project = db.snapshot(`projects/${P}`);
  const outcome = await autoRequestForProject(db as unknown as Firestore, project as never, NOW);
  assert.equal(outcome, "requested");
  const { requestId, requirementId } = coiRequestIds(P);
  assert.equal(db.store.get(`insuranceRequests/${requestId}`)?.fromVenueMemory, true, "found by the name fallback");
  // The requirement keeps the venue's wording, not the studio's notes.
  const requirement = db.store.get(`insuranceRequirements/${requirementId}`);
  assert.equal(requirement?.additionalInsuredWording, WORDING);
  assert.equal(requirement?.specialInstructions, null);
  assert.equal(requirement?.venueKey, venueKey({ placeId: "ChIJ-arboretum" }));
  assertAgentEmailCarriesEverything(db.store.get(`emailJobs/coi_request_${requestId}`));
});

test("a prepared request, approved, tells the agent the same", async () => {
  process.env.SENDGRID_INBOUND_DOMAIN = "reply.studiocue.test";
  const db = new FakeDb();
  studio(db, "prepare");
  const outcome = await autoRequestForProject(db as unknown as Firestore, db.snapshot(`projects/${P}`) as never, NOW);
  assert.equal(outcome, "prepared");
  const { requestId } = coiRequestIds(P);
  assert.ok(!db.store.has(`emailJobs/coi_request_${requestId}`), "nothing sent while prepared");
  await approvePreparedCoi(
    db as unknown as Firestore,
    { tenantId: T, actorId: "owner", role: "studio_owner", now: NOW },
    { projectId: P, requestId },
  );
  assertAgentEmailCarriesEverything(db.store.get(`emailJobs/coi_request_${requestId}`));
});

test("the agent's requirement is built one way, the notes once each", () => {
  const built = coiAgentRequirement(
    {
      certificateHolder: "Holder",
      additionalInsuredWording: "  The venue  ",
      waiverOfSubrogation: true,
      primaryNoncontributory: "yes",
      specialInstructions: NOTES,
    },
    NOTES,
  );
  assert.equal(built.additionalInsuredWording, "The venue");
  assert.equal(built.waiverOfSubrogation, true);
  assert.equal(built.primaryNoncontributory, false, "only a true flag asks for the wording");
  assert.equal(built.specialInstructions, NOTES, "an older automatic request stored the notes: not twice");
  assert.equal(coiAgentRequirement({ specialInstructions: "Venue's note." }, NOTES).specialInstructions, `Venue's note.\n${NOTES}`);
  assert.equal(coiAgentRequirement({}, null).specialInstructions, null);

  // The manual path builds it with the same helper, with the saved notes.
  const commands = read("functions/src/planning/commands.ts");
  const at = commands.indexOf('} else if (parsed.type === "createCoiRequest")');
  const manual = commands.slice(at, commands.indexOf('} else if (parsed.type === "decideCoi")', at));
  assert.match(manual, /requirement: coiAgentRequirement\(/);
  assert.match(manual, /savedCoiSettings\?\.agentNotes/);
});

test("a manual request keys its venue as the automatic request looks it up", async () => {
  const commands = read("functions/src/planning/commands.ts");
  const at = commands.indexOf('} else if (parsed.type === "createCoiRequest")');
  const manual = commands.slice(at, commands.indexOf('} else if (parsed.type === "decideCoi")', at));
  assert.match(manual, /venueKey\(projectVenue\(coiProject\)\)/);
  assert.match(manual, /venueKey: coiVenueKey,/);

  // A requirement with no key — every manual one before this — is keyed by
  // its job's venue when the profile is saved, not by the typed legal name.
  const db = new FakeDb();
  db.store.set(`projects/${P}`, { tenantId: T, venueName: "Arnold Arboretum", venue: { placeId: "ChIJ-arboretum" } });
  db.store.set(`insuranceRequirements/r1`, { tenantId: T, projectId: P, venueLegalName: "President and Fellows of Harvard College" });
  const key = await venueKeyForRequirement(db as unknown as Firestore, db.snapshot("insuranceRequirements/r1") as never);
  assert.equal(key, venueKey({ placeId: "ChIJ-arboretum" }));
  db.store.set(`insuranceRequirements/r2`, { tenantId: T, projectId: "gone", venueLegalName: "Lakeside Lodge" });
  assert.equal(
    await venueKeyForRequirement(db as unknown as Firestore, db.snapshot("insuranceRequirements/r2") as never),
    venueKey({ name: "Lakeside Lodge" }),
  );
  // Looked up by place, then by name.
  assert.deepEqual(venueKeyCandidates({ placeId: "p", name: "Lodge" }), [venueKey({ placeId: "p" }), venueKey({ name: "Lodge" })]);
  assert.deepEqual(venueKeyCandidates({ name: "Lodge" }), [venueKey({ name: "Lodge" })]);

  // Every place that saves a profile uses the same fallback.
  for (const source of [commands, read("functions/src/coi/actions.ts")]) {
    assert.doesNotMatch(source, /venueKey\(\{ name: requirement\.get\("venueLegalName"\) \}\)/);
  }
});

test("every certificate status has a track and a badge that say where it is", () => {
  assert.deepEqual([...COI_STATUSES_WITH_PROGRESS].sort(), [...coiStatusSchema.options].sort());
  for (const status of ["prepared", "needs_details", "self_serve", "cancelled", "failed", "received", "venue_acknowledged"]) {
    assert.ok(coiStatusSchema.safeParse(status).success, `${status} is a real state`);
  }
  const complete = (status: string) => coiProgress(status).steps.filter((step) => step.state === "complete").length;
  assert.equal(complete("prepared"), 0);
  assert.equal(coiProgress("prepared").tone, "neutral");
  assert.equal(coiProgress("needs_details").tone, "neutral");
  assert.equal(complete("requested"), 1);
  assert.equal(complete("received"), 2, "received fills Received");
  assert.equal(coiProgress("received").steps[1]?.label, "Received");
  for (const status of ["sent_to_venue", "venue_acknowledged"]) {
    assert.equal(complete(status), 4);
    assert.equal(coiProgress(status).tone, "success", `${status} is done`);
  }
  assert.notEqual(coiProgress("approved").tone, "success", "approved is not done: the venue doesn't have it");
  assert.equal(coiProgress("failed").tone, "danger");
  assert.equal(coiProgress("failed").steps[1]?.state, "needs-action");
  assert.equal(coiProgress("correction_required").steps[1]?.label, "Needs correction");
  assert.equal(coiProgress("something_new").tone, "neutral");

  const panel = read("components/planning/coi-workflow-panel.tsx");
  assert.match(panel, /<StatusBadge tone=\{progress\.tone\}>/);
  assert.doesNotMatch(panel, /request\.status === "approved" \? "success"/);
});

test("a coordinator is not offered a decision the server refuses", () => {
  const actions = read("components/planning/coi-request-actions.tsx");
  assert.match(actions, /\(status === "under_review" \|\| status === "approved"\) && !ownerOrAdmin/);
  assert.match(actions, /status === "failed" && !ownerOrAdmin/);
  assert.match(actions, /Only the studio owner or an admin can approve a certificate/);
  // The server is still the authority.
  const server = read("functions/src/coi/actions.ts");
  assert.match(server, /approveAndSendCoi[\s\S]*?if \(!\["studio_owner", "studio_admin"\]\.includes\(context\.role\)\) throw new Error\("FORBIDDEN"\)/);
});

test("a self-serve certificate is corrected by upload, not by asking an agent", () => {
  assert.equal(selfServeCorrection("under_review", null), true);
  assert.equal(selfServeCorrection("under_review", "agent@insure.test"), false);
  assert.equal(selfServeCorrection("requested", null), false);
  const actions = read("components/planning/coi-request-actions.tsx");
  assert.match(actions, /status === "under_review" && selfServe \? uploadButton\("Upload a corrected PDF"\)/);
  assert.match(actions, /status === "under_review" && !selfServe \? \(/);
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /throw new Error\("COI_SELF_SERVE_UPLOAD_CORRECTION"\)/);
});

test("the chasing copy says what chaseDecision does", () => {
  const settings = read("components/settings/coi-settings.tsx");
  assert.doesNotMatch(settings, /Every day in the final week/);
  assert.match(settings, /tells you on Today/);
  const panel = read("components/planning/coi-workflow-panel.tsx");
  assert.doesNotMatch(panel, /daily in the last week/);
  // The mechanism the copy relies on: escalation at the limit, or 5 days out.
  const scheduler = read("functions/src/planning/coi-chase-scheduler.ts");
  assert.match(scheduler, /if \(input\.chaseCount >= input\.maxChases \|\| daysToDue <= 5\) return "escalate";/);
});

test("the guide describes the certificate flow as it now runs", () => {
  const guide = EXPLAINERS.find((item) => item.id === "coi")!;
  assert.doesNotMatch(guide.title, /venue's insurance certificate/i, "it is the studio's certificate, naming the venue");
  const all = [guide.purpose, ...guide.steps, guide.next ?? "", ...(guide.goodToKnow ?? [])].join(" ");
  for (const claim of [/Studio settings/, /Prepare it/, /Yes, it does/, /60 days/, /every 3 days, up to 4 times/, /Approve & send to venue/, /readiness checkpoint/]) {
    assert.match(all, claim);
  }
  const words = all.replace(/\*\*/g, "").split(/\s+/).length;
  assert.ok(words >= 120 && words <= 250, `${words} words`);
});

test("every follow-up says which one it is, for a request and for a correction", () => {
  const requirement = { venueLegalName: "Willow Creek Barn LLC", certificateHolder: "Willow Creek Barn LLC", eventDate: "2027-06-12", dueDate: "2027-05-22" };
  const render = (key: string, chaseNumber: number) =>
    renderEmailTemplate({ key, brand, values: { requirement, chaseNumber, reason: "The venue needs $1,000,000 each occurrence." } });
  const first = render("coi_request", 0);
  assert.match(first.subject, /^Certificate of insurance request/);
  const second = render("coi_request", 2);
  assert.match(second.subject, /^Second follow-up: certificate for Willow Creek Barn LLC/);
  assert.match(second.text, /Second follow-up on our certificate request/);
  assert.notEqual(render("coi_request", 1).subject, second.subject);
  const correction = render("coi_correction", 0);
  assert.match(correction.subject, /^Certificate correction requested/);
  const correctionChase = render("coi_correction", 3);
  assert.match(correctionChase.subject, /^Third follow-up: corrected certificate for Willow Creek Barn LLC/);
  assert.match(correctionChase.text, /\$1,000,000 each occurrence/);
  assert.notEqual(correctionChase.text, correction.text);
});
