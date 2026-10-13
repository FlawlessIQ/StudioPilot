/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line. */
// @ts-nocheck -- an Admin SDK + HTTP harness run through tsx; it reads untyped Firestore documents. Not part of the app.
/**
 * The planning checklist walk (docs/planner-journey-plan.md, Phase 3, N8): a
 * planner studio made through the real onboarding function with trade
 * "planner"; a full-planning wedding eleven months out booked through the
 * real proposal, agreement and retainer, whose checklist the project trigger
 * writes; the date moved through updateProject; one item done, one moved by
 * hand, one one-off added; the studio's own list saved; a second full job
 * booked after it gets the new list; a month-of job gets none. Setup and the
 * booking helpers are the Phase 2 planner walk's.
 *
 *   firebase emulators:start --config firebase.walk.json --project studiohub-dev
 *   next dev -p 3300 (live data mode, pointed at the same emulator)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8380 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9399 \
 *     UAT_FUNCTIONS_ORIGIN=http://127.0.0.1:5301 UAT_APP_URL=http://localhost:3300 \
 *     npx tsx scripts/uat/planning-checklist-walk.mts
 *
 * Every line prints PASS or FAIL with what was read back; the exit code is the
 * number of failures.
 */
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Refusing to run without the emulator hosts.");
}
const projectId = process.env.GCLOUD_PROJECT ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
const FUNCTIONS = `${process.env.UAT_FUNCTIONS_ORIGIN ?? "http://127.0.0.1:5001"}/${projectId}/us-east4`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const APP = process.env.UAT_APP_URL ?? "http://localhost:3000";

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
functionsRequire("firebase-admin/app").initializeApp({ projectId });
const auth = functionsRequire("firebase-admin/auth").getAuth();
const db = functionsRequire("firebase-admin/firestore").getFirestore();

// ── Reporting ───────────────────────────────────────────────────────────────
const results: Array<{ journey: string; step: string; ok: boolean; detail: string }> = [];
let journey = "setup";
function record(step: string, ok: boolean, detail: string) {
  results.push({ journey, step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${journey}] ${step} — ${detail}`);
  return ok;
}
async function attempt<T>(step: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    record(step, false, `threw: ${String((error as Error)?.message ?? error).slice(0, 300)}`);
    return null;
  }
}

// ── Accounts and commands ───────────────────────────────────────────────────
const run = Date.now().toString(36);
const PASSWORD = randomBytes(12).toString("base64url");
const tokens = new Map<string, string>();
async function account(email: string, displayName: string): Promise<string> {
  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing) await auth.deleteUser(existing.uid);
  const user = await auth.createUser({ email, password: PASSWORD, emailVerified: true, displayName });
  return user.uid;
}
async function token(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const response = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`);
  tokens.set(email, body.idToken);
  return body.idToken;
}
async function command(fn: string, type: string, tenantId: string, input: Record<string, unknown>, email: string) {
  const response = await fetch(`${FUNCTIONS}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token(email)}` },
    body: JSON.stringify({ type, tenantId, idempotencyKey: randomUUID(), input }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${fn}/${type}: ${response.status} ${String(body.error ?? body.raw ?? "")}`);
  return body;
}
async function post(fn: string, payload: unknown, email?: string) {
  const response = await fetch(`${FUNCTIONS}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(email ? { authorization: `Bearer ${await token(email)}` } : {}) },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${fn}: ${response.status} ${String(body.error ?? body.raw ?? "")}`);
  return body;
}
async function portal(type: string, body: Record<string, unknown>, email: string) {
  const response = await fetch(`${APP}/api/client/portal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token(email)}` },
    body: JSON.stringify({ type, idempotencyKey: randomUUID(), ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`portal/${type}: ${response.status} ${String(result.error ?? result.code ?? "")}`);
  return result;
}
const data = async (path: string) => (await db.doc(path).get()).data() ?? null;
const query = async (collection: string, tenantId: string, where: Record<string, unknown> = {}) => {
  let q = db.collection(collection).where("tenantId", "==", tenantId);
  for (const [key, value] of Object.entries(where)) q = q.where(key, "==", value);
  return (await q.get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const tokenFrom = (url: unknown) => new URL(String(url), "http://x").searchParams.get("token") ?? "";
const waitFor = async <T,>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    value = await read();
  }
  return value;
};

// ── In-process workers and schedulers (the emulator never fires schedules) ──
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { PLANNER_STARTER_AGREEMENT, starterAgreementFor } = await import(`${REPO}/features/contracts/sample.ts`);
const { clientAsks } = await import(`${REPO}/features/journey/burden.ts`);
const { examplePackagesFor } = await import(`${REPO}/features/job-kinds/example-packages.ts`);


async function drain(collection: string, id: string) {
  await processJobDocument(collection, id).catch(() => undefined);
  for (let i = 0; i < 20; i += 1) {
    const status = String((await data(`${collection}/${id}`))?.status ?? "");
    if (!["queued", "processing", "retry_scheduled", "claimed"].includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return String((await data(`${collection}/${id}`))?.status ?? "");
}
async function drainAll(collection: string, tenantId: string) {
  for (const job of await query(collection, tenantId)) {
    if (["queued", "retry_scheduled"].includes(String(job.status))) await drain(collection, job.id);
  }
}
async function emails(tenantId: string, type: string, projectId?: string) {
  const jobs = (await query("emailJobs", tenantId, { type })).filter((job) => !projectId || job.projectId === projectId);
  const out = [];
  for (const job of jobs.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))) {
    await drain("emailJobs", job.id);
    const message = await data(`messages/${job.id}`);
    out.push({ job: (await data(`emailJobs/${job.id}`)) ?? job, subject: String(message?.subject ?? ""), text: String(message?.sentText ?? ""), recipient: String(message?.recipient ?? ""), id: job.id });
  }
  return out;
}
const email = async (tenantId: string, type: string, projectId?: string) => (await emails(tenantId, type, projectId)).at(-1) ?? null;


// ═══════════════════════════ The studio ═════════════════════════════════════
const owner = `uat-planner-${run}@studiohub.test`;
await account(owner, "Claire Wren");
const onboarded = await post(
  "tenantOnboardingCommand",
  { businessName: "Wren & Co. Events", legalName: "Wren & Co. Events LLC", timezone: "America/New_York", currency: "USD", trade: "planner" },
  owner,
);
const tenantId = String(onboarded.tenantId);
await db.doc(`subscriptions/${tenantId}`).set({ status: "trialing", checkoutRequired: false, currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString() }, { merge: true });
tokens.delete(owner);
{
  const tenant = await data(`tenants/${tenantId}`);
  record("a planner studio signs up through onboarding", tenant?.trade === "planner" && tenant?.subscriptionPlan === "vendor", `trade ${tenant?.trade}, plan ${tenant?.subscriptionPlan}`);
  const timeline = tenant?.planningTimeline ?? {};
  record(
    "its planning timeline: Final details three months out, automatically, locked two weeks out, no final call",
    timeline.formMonthsBefore === 3 && timeline.formSend === "auto" && timeline.lockDaysBefore === 14 && timeline.finalCall === false && timeline.formAtBooking === false,
    JSON.stringify({ months: timeline.formMonthsBefore, send: timeline.formSend, lock: timeline.lockDaysBefore, finalCall: timeline.finalCall }),
  );
  const forms = await query("questionnaireTemplates", tenantId);
  const finalDetails = forms.find((row) => row.recommendedId === "planner-final-details");
  record("seeded forms: Final details alone, with the vendor section", forms.length === 1 && Boolean(finalDetails) && timeline.formTemplateId === finalDetails?.id && JSON.stringify(finalDetails.sections).includes('"vendor-team"'), forms.map((row) => row.name).join(", "));
  const workflow = (await query("workflowTemplates", tenantId)).find((row) => row.eventTypeId === "wedding");
  record("five readiness checks on a wedding", workflow?.checkpointTemplates?.length === 5, (workflow?.checkpointTemplates ?? []).map((check) => check.name).join(", "));
  const inquiry = await data(`leadCaptureSettings/${tenantId}`);
  record(
    "the inquiry form asks the venue, the tier, the vendors and the wedding's budget",
    inquiry?.inquiryForm?.askBudget === true && (inquiry?.inquiryForm?.questions ?? []).map((q) => q.id).join() === "venue-booked,planning-tier,vendors-booked" && !inquiry?.inquiryEventForm,
    `budget ${inquiry?.inquiryForm?.askBudget}, questions ${(inquiry?.inquiryForm?.questions ?? []).map((q) => q.id).join(", ")}`,
  );
  record("the journey's budget: 6 asks", clientAsks("wedding", "planner").length === 6, clientAsks("wedding", "planner").map((ask) => ask.label).join("; "));
}

// Hours for the discovery call and the walkthrough, QuickBooks (mock), the agreement.
await command("bookingCommand", "setConsultationSettings", tenantId, {
  durationMinutes: 45, bufferMinutes: 15, mode: "open_default",
  windows: ["mon", "tue", "wed", "thu", "fri", "sat"].map((weekday) => ({ day: weekday, startMinute: 9 * 60, endMinute: 17 * 60 })),
  unavailableWindows: [], blockedDates: [], meetingFormats: ["in_person", "phone"], inPersonLocation: "At your venue",
}, owner).catch((error) => record("hours saved", false, String(error.message)));
await db.doc(`integrationConnections/qbo_${tenantId}`).set({
  id: `qbo_${tenantId}`, tenantId, provider: "quickbooks", capability: "invoicing", status: "connected", mockMode: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const agreement = String(PLANNER_STARTER_AGREEMENT)
  .replace("[If you do, say from whom and how much.]", "")
  .replace("[your overtime rate]", "$75")
  .replace("[your travel area]", "30 miles")
  .replace("[your travel rate]", "$0.70 a mile")
  .replace("[Replace with your own cancellation and rescheduling terms.]", "The Client may cancel in writing; payments made to date are kept by the Planner.")
  .replace("[Replace with your own terms.]", "The Planner's liability is limited to the fees paid.");
await attempt("agreement saved from the planner starter", () =>
  command("bookingCommand", "saveAgreementTemplate", tenantId, { templateId: null, name: "Planning agreement", title: starterAgreementFor("planner").title, body: agreement, customFields: [], makeDefault: true }, owner),
);

// The extra assistant per person, offered on the packages; packages from the examples, with their tiers.
const assistant = await command("crmCommand", "saveAddOn", tenantId, {
  addOnId: null, name: "Additional assistant", description: "Another assistant coordinator on the day.", unitPriceCents: 45000, taxable: false, allowQuantity: true, unitLabel: "person", archived: false,
}, owner);
const assistantId = String(assistant.addOnId ?? assistant.id);
const examples = examplePackagesFor("planner", "wedding");
const packages: Record<string, string> = {};
for (const [example, price] of [[examples[0], 750000], [examples[2], 220000]] as const) {
  const created = await command("crmCommand", "createPackage", tenantId, {
    name: example.name, description: example.description, eventTypeId: "wedding", eventTypeLabel: "Wedding", paymentShape: "deposit_and_balance",
    planningScope: example.planningScope, basePriceCents: price, currency: "USD", retainerRule: { type: "percentage", basisPoints: 5000 },
    includedCoverageMinutes: example.coverageHours * 60, includedCoverage: [{ role: "coordinator", count: example.photographers }],
    includedDeliverables: example.deliverables.split(",").map((item) => item.trim()), includedTravelArea: "Within 30 miles",
    addOns: [], addOnIds: [assistantId], taxRateBasisPoints: 0, terms: "Subject to the completed studio agreement.", active: true, publicVisible: false, displayOrder: 0, internalNotes: null,
  }, owner);
  packages[example.planningScope] = String(created.packageId);
}
{
  const pkg = await data(`packages/${packages.coordination}`);
  record("packages from the examples keep their tier", pkg?.planningScope === "coordination" && (await data(`packages/${packages.full}`))?.planningScope === "full", `${pkg?.name}: ${pkg?.planningScope}`);
}

/** An inquiry from the website form, as the couple sends it. */
async function inquire(first: string, last: string, eventDate: string, tier: string, budget: string) {
  const tenant = await data(`tenants/${tenantId}`);
  const clientEmail = `uat-planner-client-${first.toLowerCase()}-${run}@studiohub.test`;
  const response = await fetch(`${FUNCTIONS}/publicLeadIntake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-studiohub-client-ip": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({
      tenantSlug: tenant?.publicSlug, firstName: first, lastName: last, email: clientEmail, phone: "201-555-0142", eventType: "Wedding", eventTypeKey: "wedding",
      servicesRequested: ["other"], message: "We'd love help pulling it all together.", consent: true, eventDate, city: "Montclair, NJ", venue: "Hollow Oak Inn",
      estimatedGuestCount: 140, budgetRange: budget,
      customAnswers: { "venue-booked": "yes", "planning-tier": tier, "vendors-booked": "Florist and photographer so far" }, honeypot: "",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`publicLeadIntake: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  const lead = await waitFor(() => data(`leads/${body.leadId}`), (value) => Boolean(value?.projectId));
  return { leadId: String(body.leadId), projectId: String(lead?.projectId ?? ""), clientEmail, lead };
}

/** The couple books a call or appointment from the studio's link. */
async function bookFromLink(projectId: string, purpose: string, pick = 0) {
  const project = await data(`projects/${projectId}`);
  await post("publicConsultationScheduling", { type: "create_link", tenantId, idempotencyKey: randomUUID(), input: { projectId, contactId: project.clientContactIds[0], mode: "in_person", purpose } }, owner);
  const invite = (await emails(tenantId, "consultation_invitation", projectId)).filter((row) => (row.job.purpose ?? "consultation") === purpose).at(-1);
  const linkToken = tokenFrom(invite?.job?.actionUrl);
  const slots = await post("publicConsultationScheduling", { type: "availability", idempotencyKey: randomUUID(), input: { token: linkToken } });
  const slot = (slots.slots ?? [])[pick];
  if (!slot) throw new Error(`no ${purpose} openings`);
  await post("publicConsultationScheduling", { type: "book", idempotencyKey: randomUUID(), input: { token: linkToken, startsAt: slot.startsAt } });
  return { invite, slot, durationMinutes: slots.durationMinutes };
}

/** Proposal → accepted → agreement signed → retainer paid → booked. */
async function bookToBooked(projectId: string, clientEmail: string, client: string, packageId: string, addOns: Array<{ addOnId: string; quantity: number }>) {
  const locked = await command("crmCommand", "selectPackage", tenantId, { projectId, packageId, selectedAddOns: addOns, mode: "replace", confirmReplace: false, discount: { type: "none" } }, owner);
  const draft = await command("proposalCommand", "create_draft", tenantId, {
    projectId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), notes: null, termsSummary: "Subject to the signed agreement.", retainerDueDate: null, balanceDueDate: null,
  }, owner);
  const proposalId = String(draft.proposalId);
  await command("proposalCommand", "submit_for_approval", tenantId, { proposalId }, owner);
  await command("proposalCommand", "approve", tenantId, { proposalId }, owner);
  for (const job of (await query("pdfJobs", tenantId)).filter((job) => job.proposalId === proposalId)) await drain("pdfJobs", job.id);
  await command("proposalCommand", "send", tenantId, { proposalId }, owner);
  const sent = await email(tenantId, "proposal_sent", projectId);
  await account(clientEmail, client);
  await post("clientInvitationCommand", { type: "accept", idempotencyKey: randomUUID(), input: { token: tokenFrom(sent?.job?.actionUrl) } }, clientEmail);
  await portal("decide_proposal", { tenantId, projectId, proposalId, decision: "accepted", reason: null }, clientEmail);
  await waitFor(() => data(`contractDrafts/${projectId}`), (value) => Boolean(value?.documentHash));
  await command("bookingCommand", "prepareContract", tenantId, { projectId, proposalId, overrides: {} }, owner).catch(() => undefined);
  const prepared = await data(`contractDrafts/${projectId}`);
  await command("bookingCommand", "sendContract", tenantId, { projectId, documentHash: prepared?.documentHash, studioSignerName: "Claire Wren", consent: true }, owner);
  const contract = (await query("contracts", tenantId, { projectId }))[0];
  await portal("sign_contract", {
    tenantId, projectId, contractId: contract.id, documentHash: contract.documentHash, typedName: client, consent: true, consentVersion: "esign-consent-v2",
    billingAddress: { line1: "14 Mill Lane", line2: null, city: "Montclair", region: "NJ", postalCode: "07042", country: "US" },
  }, clientEmail);
  await waitFor(async () => (await query("invoiceReferences", tenantId, { projectId })).find((invoice) => invoice.kind === "retainer"), Boolean);
  await drainAll("providerJobs", tenantId);
  await command("bookingCommand", "recordRetainerPayment", tenantId, { projectId, packageSnapshotId: String(locked.packageSnapshotId), paidAt: day(0), method: "card", reference: null, attestation: true }, owner);
  const booked = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "BOOKED", 240000);
  await drainAll("providerJobs", tenantId);
  return { proposalId, packageSnapshotId: String(locked.packageSnapshotId), contract, booked, sent };
}

// ═══════════════════════════ Phase 3: the planning checklist ═══════════════
const { STARTER_PLANNING_CHECKLISTS, dayBefore, checklistProgress } = await import(`${REPO}/features/planning/planning-checklist.ts`);
const { todayInbox } = await import(`${REPO}/features/today/inbox.ts`);
const checklist = async (projectId: string) => (await query("tasks", tenantId, { projectId })).filter((task) => task.source === "planning_checklist");
const today = day(0);
const months = (amount: number) => ({ amount, unit: "months" });
const weeks = (amount: number) => ({ amount, unit: "weeks" });
const STARTER = STARTER_PLANNING_CHECKLISTS.full.length;

journey = "full planning, 11 months out";
let full: string | null = null;
{
  const eventDate = day(335);
  const inquiry = await attempt("inquiry", () => inquire("Priya", "Shah", eventDate, "Full planning", "About $50,000"));
  if (inquiry) {
    full = inquiry.projectId;
    await attempt("discovery call", () => bookFromLink(full, "consultation", 1));
    const booked = await attempt("booked on Full planning", () => bookToBooked(full, inquiry.clientEmail, "Priya Shah", packages.full, []));
    if (booked) {
      const tasks = await waitFor(() => checklist(full), (rows) => rows.length >= STARTER, 240000);
      record("booking wrote the starter checklist: a task per item, fixed ids", tasks.length === STARTER && tasks.every((task) => task.id.startsWith(`planning_${full}_`)), `${tasks.length} of ${STARTER}`);
      const by = (key: string) => tasks.find((task) => task.checklistKey === key);
      record("twelve months out has passed: the budget and the venue are due today", by("venue")?.dueDate === today && by("budget")?.dueDate === today, `venue ${by("venue")?.dueDate}, budget ${by("budget")?.dueDate}`);
      record("the photographer 10 months out", by("photographer")?.dueDate === dayBefore(eventDate, months(10)), `${by("photographer")?.dueDate} for a wedding on ${eventDate}`);
      record("the seating chart two weeks out", by("seating_chart")?.dueDate === dayBefore(eventDate, weeks(2)), String(by("seating_chart")?.dueDate));
      console.log("        " + [...tasks].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map((task) => `${task.dueDate} ${task.title}`).join("\n        "));
      const project = await data(`projects/${full}`);
      record("the job carries the marker", Boolean(project?.planningChecklist?.appliedAt) && project.planningChecklist.scope === "full" && project.planningChecklist.itemCount === STARTER && project.planningChecklist.studioList === false, JSON.stringify(project?.planningChecklist));
      const inbox = todayInbox({ now: new Date().toISOString(), projects: [project], tasks });
      const cards = inbox.act.filter((item) => item.id.startsWith("task-planning_"));
      record(
        "Today has the two items due today, each opening the job's checklist",
        cards.length === 2 && cards.every((card) => card.action.href === `/studio/projects/${full}#planning-checklist` && card.evidence === "On your planning checklist"),
        cards.map((card) => `${card.title} [${card.facts.join(", ")}]`).join("; "),
      );
      await attempt("mark the venue done", () => command("workflowCommand", "completeTask", tenantId, { taskId: by("venue").id }, owner));
      const handDate = day(45);
      await attempt("move the officiant item by hand", () => command("workflowCommand", "updateTask", tenantId, { taskId: by("officiant").id, dueDate: handDate }, owner));
      const moved = day(363);
      // A signed booking's date moves only through a couple-signed amendment
      // (updateProject answers EVENT_DATE_LOCKED_AFTER_SIGNING, checked here);
      // the amendment's apply step writes projects.eventDate, which is what the
      // trigger watches, so the walk writes that field as the amendment would.
      const locked = await command("crmCommand", "updateProject", tenantId, {
        projectId: full, name: project.name, eventDate: moved, eventType: project.eventType ?? "Wedding",
        venueName: project.venueName ?? null, city: project.city ?? null, timezone: project.timezone ?? "America/New_York",
      }, owner).then(() => "moved").catch((error) => String(error.message));
      record("a signed booking's date is not moved by a plain edit", /EVENT_DATE_LOCKED_AFTER_SIGNING/.test(locked), locked);
      await attempt("the wedding moves four weeks later (as a signed amendment writes it)", () => db.doc(`projects/${full}`).update({ eventDate: moved, updatedAt: new Date().toISOString() }));
      const after = await waitFor(() => checklist(full), (rows) => rows.find((task) => task.checklistKey === "photographer")?.dueDate === dayBefore(moved, months(10)), 240000);
      const a = (key: string) => after.find((task) => task.checklistKey === key);
      record("open items followed the date", a("photographer")?.dueDate === dayBefore(moved, months(10)) && a("seating_chart")?.dueDate === dayBefore(moved, weeks(2)), `photographer ${a("photographer")?.dueDate}, seating chart ${a("seating_chart")?.dueDate} for ${moved}`);
      record("the done venue stayed done on its day; the hand-moved officiant kept its date", a("venue")?.status === "complete" && a("venue")?.dueDate === today && a("officiant")?.dueDate === handDate, `venue ${a("venue")?.status} ${a("venue")?.dueDate}, officiant ${a("officiant")?.dueDate}`);
      record("still due today: the budget (its day is still past)", a("budget")?.dueDate === today, String(a("budget")?.dueDate));
      record("nothing written twice", after.length === STARTER, String(after.length));
      await attempt("add a one-off item on the job", () =>
        command("workflowCommand", "createTask", tenantId, {
          projectId: full, workflowRunId: null, checkpointId: null, title: "Book the shuttle buses", description: "", assignedUserId: null,
          assignedRole: null, dueDate: day(120), priority: "normal", blocking: false, source: "planning_checklist",
        }, owner),
      );
      const progress = checklistProgress(await checklist(full), today);
      record(`the job's panel: 1 of ${STARTER + 1} done`, progress.summary === `1 of ${STARTER + 1} done`, `${progress.summary}; next: ${progress.open.slice(0, 3).map((row) => row.title).join("; ")}`);
    }
  }
}

journey = "the studio's own checklist";
let second: string | null = null;
{
  const refused = await command("planningCommand", "setPlanningChecklist", tenantId, { scope: "full", items: [{ key: "own_x", title: "x", amount: 3, unit: "months" }] }, owner)
    .then(() => "saved")
    .catch((error) => String(error.message));
  record("a nameless item is refused", refused !== "saved", refused);
  const twice = await command("planningCommand", "setPlanningChecklist", tenantId, { scope: "full", items: [{ key: "own_a", title: "Tour the venue", amount: 3, unit: "months" }, { key: "own_a", title: "Tour it again", amount: 2, unit: "months" }] }, owner)
    .then(() => "saved")
    .catch((error) => String(error.message));
  record("the same item twice is refused, in the studio's words", /PLANNING_CHECKLIST_INVALID: Item 2 is in the list twice/.test(twice), twice);
  const own = [
    { key: "own_venue_tour", title: "Tour the venue with the couple", amount: 11, unit: "months" },
    { key: "own_tasting", title: "Book the menu tasting", amount: 4, unit: "months" },
    { key: "own_kit", title: "Pack the emergency kit", amount: 1, unit: "weeks" },
  ];
  await attempt("the studio saves its own full planning list", () => command("planningCommand", "setPlanningChecklist", tenantId, { scope: "full", items: own }, owner));
  const tenant = await data(`tenants/${tenantId}`);
  record("stored on the tenant, the partial list untouched", tenant?.planningChecklists?.full?.items?.length === 3 && !tenant?.planningChecklists?.partial, JSON.stringify(tenant?.planningChecklists?.full?.items?.map((entry) => entry.title)));
  if (full) {
    const first = await checklist(full);
    record("the job already booked keeps its checklist", first.length === STARTER + 1 && !first.some((task) => String(task.checklistKey ?? "").startsWith("own_")), String(first.length));
  }
  const eventDate = day(300);
  const inquiry = await attempt("a second full planning inquiry", () => inquire("Ava", "Lee", eventDate, "Full planning", "About $40,000"));
  if (inquiry) {
    second = inquiry.projectId;
    await attempt("discovery call", () => bookFromLink(second, "consultation", 2));
    const booked = await attempt("booked on Full planning", () => bookToBooked(second, inquiry.clientEmail, "Ava Lee", packages.full, []));
    if (booked) {
      const tasks = await waitFor(() => checklist(second), (rows) => rows.length >= 3, 240000);
      const tour = tasks.find((task) => task.checklistKey === "own_venue_tour");
      record(
        "a job booked afterwards gets the studio's list",
        tasks.length === 3 && Boolean(tour) && tour.dueDate === today && tasks.find((task) => task.checklistKey === "own_kit")?.dueDate === dayBefore(eventDate, weeks(1)),
        tasks.map((task) => `${task.dueDate} ${task.title}`).join("; "),
      );
      record("its marker says it was the studio's list", (await data(`projects/${second}`))?.planningChecklist?.studioList === true, JSON.stringify((await data(`projects/${second}`))?.planningChecklist));
    }
  }
}

journey = "month-of coordination";
let monthOf: string | null = null;
{
  const inquiry = await attempt("inquiry", () => inquire("Maya", "Brooks", day(200), "Month-of coordination", "About $35,000"));
  if (inquiry) {
    monthOf = inquiry.projectId;
    await attempt("discovery call", () => bookFromLink(monthOf, "consultation", 3));
    const booked = await attempt("booked on month-of coordination", () => bookToBooked(monthOf, inquiry.clientEmail, "Maya Brooks", packages.coordination, []));
    if (booked) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const project = await data(`projects/${monthOf}`);
      const tasks = await checklist(monthOf);
      record("a month-of job gets no checklist", project?.planningScope === "coordination" && tasks.length === 0 && !project?.planningChecklist, `scope ${project?.planningScope}, ${tasks.length} checklist tasks, marker ${JSON.stringify(project?.planningChecklist ?? null)}`);
    }
  }
}

const failures = results.filter((row) => !row.ok);
console.log(`\n${results.length - failures.length} passed, ${failures.length} failed. Tenant ${tenantId}; full ${full}; second ${second}; month-of ${monthOf}; owner ${owner}`);
console.log(`WALK_OWNER=${owner} WALK_PASSWORD=${PASSWORD} WALK_TENANT=${tenantId} WALK_FULL=${full} WALK_SECOND=${second} WALK_MONTHOF=${monthOf}`);
process.exit(failures.length);
