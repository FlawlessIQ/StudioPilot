import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureInquiry, leadFieldsFrom, missingInformationFor } from "../functions/src/intake/capture";
import { readInquiryEmail, type InquiryEmail } from "../functions/src/intake/form-email";
import { gmailForwardingConfirmation } from "../functions/src/intake/gmail-forwarding";
import { fillsFor } from "../functions/src/intake/enrich";
import { moveLeadThreadsToProject } from "../functions/src/intake/lead-thread";
import { convertInquiryToJob, projectIdForLead } from "../functions/src/intake/convert";
import { detailsOf, resolveInquiryLink, saveCoupleDetails, withInquiryLink } from "../functions/src/intake/inquiry-link";
import { advanceFollowUp, followUpStep, reopenOnReply } from "../functions/src/intake/follow-ups";
import { providerFromMx } from "../functions/src/intake/mailbox-provider";
import { captureSilent, silenceThreshold } from "../functions/src/intake/health-scheduler";
import { conversationIdFor } from "../functions/src/communications/conversation";
import { gmailFilterQuery, gmailSearchLink, senderDomains } from "../features/intake/forwarding-filters";
import { NOTIFICATION_GUIDES } from "../features/intake/form-notification-guides";
import { todayInbox } from "../features/today/inbox";

/**
 * Inbox capture, end to end against an in-memory Firestore: a website form's
 * notification becomes a lead with a thread; the same couple writing again is
 * attached, not duplicated; a sender the studio dismissed is ignored; a test
 * window captures without creating anything; and the thread follows the lead
 * onto its job.
 */

type Row = Record<string, unknown>;

function fakeFirestore(seed: Record<string, Row> = {}) {
  const store = new Map<string, Row>(Object.entries(seed).map(([path, row]) => [path, { ...row }]));

  const merge = (path: string, data: Row, deep: boolean) => {
    const current = store.get(path);
    store.set(path, deep && current ? { ...current, ...data } : { ...data });
  };

  const snapshot = (path: string) => {
    const data = store.get(path);
    return {
      id: path.split("/").pop() ?? "",
      exists: data !== undefined,
      get: (field: string) => data?.[field],
      data: () => (data ? { ...data } : undefined),
      ref: reference(path),
    };
  };

  function reference(path: string): Record<string, unknown> & { path: string } {
    return {
      path,
      id: path.split("/").pop() ?? "",
      get: async () => snapshot(path),
      set: async (data: Row, options?: { merge?: boolean }) => merge(path, data, Boolean(options?.merge)),
      update: async (data: Row) => {
        if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`);
        merge(path, data, true);
      },
    };
  }

  const matches = (data: Row, [field, op, value]: [string, string, unknown]) => {
    const actual = data[field];
    if (op === "==") return actual === value || (value === null && actual === undefined);
    if (op === "in") return (value as unknown[]).includes(actual);
    if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
    throw new Error(`unsupported op ${op}`);
  };

  const query = (name: string, filters: [string, string, unknown][], cap = Infinity): Record<string, unknown> => ({
    where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]], cap),
    orderBy: () => query(name, filters, cap),
    limit: (count: number) => query(name, filters, count),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${name}/`) && path.split("/").length === 2)
        .filter(([, data]) => filters.every((filter) => matches(data, filter)))
        .slice(0, cap)
        .map(([path]) => snapshot(path));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  const db = {
    doc: (path: string) => reference(path),
    collection: (name: string) => query(name, []),
    batch: () => {
      const pending: Array<() => void> = [];
      return {
        create: (ref: { path: string }, data: Row) => pending.push(() => {
          if (store.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`);
          merge(ref.path, data, false);
        }),
        set: (ref: { path: string }, data: Row, options?: { merge?: boolean }) =>
          pending.push(() => merge(ref.path, data, Boolean(options?.merge))),
        update: (ref: { path: string }, data: Row) => pending.push(() => merge(ref.path, data, true)),
        commit: async () => {
          for (const write of pending) write();
        },
      };
    },
    runTransaction: async <T>(work: (transaction: Record<string, unknown>) => Promise<T>) =>
      work({
        get: async (ref: { path: string; get?: () => Promise<unknown> }) =>
          "get" in ref && typeof ref.get === "function" ? ref.get() : snapshot(ref.path),
        set: (ref: { path: string }, data: Row, options?: { merge?: boolean }) =>
          merge(ref.path, data, Boolean(options?.merge)),
        update: (ref: { path: string }, data: Row) => merge(ref.path, data, true),
        create: (ref: { path: string }, data: Row) => merge(ref.path, data, false),
      }),
  };
  return { db: db as never, store };
}

const now = "2026-09-25T15:00:00.000Z";

function fixture(name: string): InquiryEmail {
  const raw = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/form-emails/${name}.json`, "utf8"));
  return {
    from: raw.from,
    fromName: raw.fromName,
    replyTo: raw.replyTo,
    subject: raw.subject,
    text: raw.text,
    html: raw.html,
    studioAddresses: ["hello@hartlight.example"],
  };
}

const seed = (): Record<string, Row> => ({
  "tenants/t1": { id: "t1", name: "Hart Light" },
});

const rows = (store: Map<string, Row>, collection: string) =>
  [...store.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([, row]) => row);

test("a Squarespace notification becomes a filled-in lead with its own thread", async () => {
  const { db, store } = fakeFirestore(seed());
  const result = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("squarespace-text"),
    providerMessageId: "<m1@squarespace>",
    route: "forward",
    now,
  });
  assert.equal(result.outcome, "lead_created");
  const lead = store.get(`leads/${result.leadId}`)!;
  assert.equal(lead.email, "emma.hart@example.com");
  assert.equal(lead.eventDate, "2027-06-12");
  assert.equal(lead.availabilityStatus, "available");
  assert.equal(lead.source, "website_form");
  assert.equal(lead.formBuilderLabel, "Squarespace form");
  assert.equal(lead.needsConfirmation, false);
  assert.equal(lead.enrichmentPending, true);
  assert.deepEqual(lead.servicesRequested, ["photography", "videography"]);
  assert.ok(store.has(`aiJobs/lead_intake_${result.leadId}`), "the reply is drafted by the intake job");

  // A confirmed inquiry with a date is a job on arrival: quiet, at the
  // inquiry stage, and joined to the lead and the couple's contact.
  assert.ok(result.projectId, "the inquiry became a job");
  assert.equal(lead.status, "converted");
  assert.equal(lead.autoConverted, true);
  assert.equal(lead.projectId, result.projectId);
  const job = store.get(`projects/${result.projectId}`)!;
  assert.equal(job.state, "LEAD");
  assert.equal(job.origin, "inquiry");
  assert.equal(job.eventDate, "2027-06-12");
  assert.equal(job.leadId, result.leadId);
  assert.deepEqual(job.clientContactIds, [lead.primaryContactId]);
  assert.deepEqual(store.get(`contacts/${lead.primaryContactId}`)!.contactTypes, ["prospect"]);

  // The inquiry is the first message on the job's thread; the lead's own
  // thread is left as a pointer, because reply addresses already sent name it.
  const leadThread = conversationIdFor({
    tenantId: "t1",
    leadId: result.leadId,
    participant: { email: "emma.hart@example.com" },
  });
  const jobThread = conversationIdFor({
    tenantId: "t1",
    projectId: String(result.projectId),
    participant: { email: "emma.hart@example.com" },
  });
  assert.equal(store.get(`conversations/${leadThread}`)!.movedTo, jobThread);
  const conversation = store.get(`conversations/${jobThread}`)!;
  assert.equal(conversation.leadId, result.leadId);
  assert.equal(conversation.studioUnreadCount, 1);
  const messages = rows(store, "messages");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.leadId, result.leadId);
  assert.equal(messages[0]!.projectId, result.projectId);

  const settings = store.get("leadCaptureSettings/t1")!;
  assert.equal(settings.lastCaptureAt, now);
});

test("the same email arriving twice is captured once", async () => {
  const { db, store } = fakeFirestore(seed());
  const email = fixture("squarespace-text");
  const first = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<m1>", route: "forward", now });
  const second = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<m1>", route: "forward", now });
  assert.equal(second.outcome, "duplicate");
  assert.equal(second.leadId, first.leadId);
  assert.equal(rows(store, "leads").length, 1);
});

test("the couple writing again joins the job their inquiry became, not a second one", async () => {
  const { db, store } = fakeFirestore(seed());
  const email = fixture("squarespace-text");
  const first = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<m1>", route: "forward", now });
  const again = await captureInquiry({
    db,
    tenantId: "t1",
    email: { ...email, text: email.text.replace("full day coverage", "an engagement session too") },
    providerMessageId: "<m2>",
    route: "forward",
    now: "2026-09-26T10:00:00.000Z",
  });
  assert.equal(again.outcome, "attached_to_project");
  assert.equal(again.projectId, first.projectId);
  assert.equal(rows(store, "leads").length, 1);
  assert.equal(rows(store, "projects").length, 1);
  assert.equal(rows(store, "messages").length, 2);
});

test("an unverified sender at the short address is held, and never joins a couple's thread", async () => {
  const { db, store } = fakeFirestore(seed());
  const email = fixture("squarespace-text");
  const first = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<m1>", route: "forward", now });
  const held = await captureInquiry({
    db,
    tenantId: "t1",
    email,
    providerMessageId: "<m2>",
    route: "forward",
    address: "short",
    reviewReason: "Sent to your StudioCue address from someone@example.test, which StudioCue doesn't recognise yet.",
    now: "2026-09-26T10:00:00.000Z",
  });
  assert.equal(held.outcome, "maybe_created");
  assert.notEqual(held.leadId, first.leadId);
  assert.equal(store.get(`leads/${first.leadId}`)!.inquiryCount, 1);
  assert.equal(store.get(`leads/${held.leadId}`)!.needsConfirmation, true);
  const capture = rows(store, "inboundCaptures").find((row) => row.leadId === held.leadId)!;
  assert.equal(capture.address, "short");
  assert.equal(capture.heldForReview, true);
  assert.match(String(capture.verdictReason), /doesn't recognise/);
});

test("an inquiry from a client with a live job is attached to the job", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "contacts/c1": { tenantId: "t1", normalizedEmail: "emma.hart@example.com", archivedAt: null },
    "projects/p1": { tenantId: "t1", clientContactIds: ["c1"], state: "BOOKED", archivedAt: null },
  });
  const result = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("squarespace-text"),
    providerMessageId: "<m1>",
    route: "forward",
    now,
  });
  assert.equal(result.outcome, "attached_to_project");
  assert.equal(result.projectId, "p1");
  assert.equal(rows(store, "leads").length, 0);
  assert.equal(rows(store, "messages")[0]!.projectId, "p1");
});

test("a sender the studio dismissed is recorded and ignored", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "leadCaptureSettings/t1": { tenantId: "t1", notInquirySenders: ["form-submission@squarespace.info"] },
  });
  const result = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("squarespace-text"),
    providerMessageId: "<m1>",
    route: "forward",
    now,
  });
  assert.equal(result.outcome, "ignored_not_inquiry");
  assert.equal(rows(store, "leads").length, 0);
  assert.equal(store.get(`inboundCaptures/${result.captureId}`)!.outcome, "ignored_not_inquiry");
});

test("during a test window the capture is shown, not turned into a lead", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "leadCaptureSettings/t1": { tenantId: "t1", testWindowUntil: "2026-09-25T15:20:00.000Z" },
  });
  const result = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("wix-html-only"),
    providerMessageId: "<m1>",
    route: "forward",
    now,
  });
  assert.equal(result.outcome, "test");
  assert.equal(rows(store, "leads").length, 0);
  const settings = store.get("leadCaptureSettings/t1")!;
  assert.equal(settings.lastTestCaptureId, result.captureId);
  assert.equal(settings.testWindowUntil, null, "one test per window");
  const capture = store.get(`inboundCaptures/${result.captureId}`)!;
  assert.ok(Array.isArray(capture.fields) && (capture.fields as unknown[]).length > 0);
});

test("a saved form mapping changes how that form is read", async () => {
  const email = fixture("squarespace-text");
  const first = readInquiryEmail(email, { today: now.slice(0, 10) });
  const { db, store } = fakeFirestore(seed());
  // Learn the form key from a test capture, then save a mapping that says
  // "City" is really the venue's town and should be ignored.
  store.set("leadCaptureSettings/t1", { tenantId: "t1", testWindowUntil: "2026-09-25T16:00:00.000Z" });
  const test1 = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<t>", route: "forward", now });
  const formKey = String(store.get(`inboundCaptures/${test1.captureId}`)!.formKey);
  store.set("leadCaptureSettings/t1", {
    tenantId: "t1",
    forms: { [formKey]: { fieldMapping: { city: "ignore" } } },
  });
  assert.equal(first.values.city?.value, "Hudson, NY");
  const result = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<m1>", route: "forward", now });
  assert.equal(store.get(`leads/${result.leadId}`)!.city, null);
});

test("an unsure capture waits for the studio instead of reaching Today", async () => {
  const { db, store } = fakeFirestore(seed());
  const result = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("newsletter-unsure"),
    providerMessageId: "<n1>",
    route: "forward",
    now,
  });
  assert.equal(result.outcome, "maybe_created");
  const lead = store.get(`leads/${result.leadId}`)!;
  assert.equal(lead.needsConfirmation, true);
  const inbox = todayInbox({ now, leads: [{ ...lead, id: String(result.leadId) }] } as never);
  assert.equal(inbox.act.filter((item) => item.id.startsWith("lead-")).length, 0);
});

test("Today says which form an inquiry came from, and whether the date is free", () => {
  const inbox = todayInbox({
    now,
    leads: [
      {
        id: "l1",
        status: "new",
        displayName: "Emma Hart",
        source: "website_form",
        formBuilderLabel: "Wix form",
        eventDate: "2027-06-12",
        availabilityStatus: "available",
        createdAt: now,
      },
      {
        id: "l2",
        status: "new",
        displayName: "Sam Lee",
        source: "marketplace_the_knot",
        formBuilderLabel: "The Knot",
        eventDate: "2027-05-01",
        availabilityStatus: "conflict",
        createdAt: now,
      },
    ],
  } as never);
  const emma = inbox.act.find((item) => item.id === "lead-l1")!;
  const sam = inbox.act.find((item) => item.id === "lead-l2")!;
  assert.equal(emma.evidence, "From your Wix form");
  assert.ok(emma.facts.includes("Date free"));
  assert.equal(sam.evidence, "From The Knot");
  assert.ok(sam.facts.includes("Date already booked"));
});

test("the lead's thread follows it onto the job", async () => {
  const { db, store } = fakeFirestore(seed());
  // Held for review, so it stays a lead until moved by hand here.
  const captured = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("squarespace-text"),
    providerMessageId: "<m1>",
    route: "forward",
    reviewReason: "held for the test",
    now,
  });
  const leadThread = String(store.get(`leads/${captured.leadId}`)!.conversationId);
  const moved = await moveLeadThreadsToProject(db, {
    tenantId: "t1",
    leadId: String(captured.leadId),
    projectId: "p9",
    now,
  });
  const jobThread = conversationIdFor({
    tenantId: "t1",
    projectId: "p9",
    participant: { email: "emma.hart@example.com" },
  });
  assert.deepEqual(moved, [jobThread]);
  assert.equal(store.get(`conversations/${leadThread}`)!.movedTo, jobThread);
  const onJob = store.get(`conversations/${jobThread}`)!;
  assert.equal(onJob.projectId, "p9");
  assert.equal(onJob.messageCount, 1);
  const message = rows(store, "messages")[0]!;
  assert.equal(message.conversationId, jobThread);
  assert.equal(message.projectId, "p9");
  // Running it again (a retried conversion) moves nothing twice.
  assert.deepEqual(
    await moveLeadThreadsToProject(db, { tenantId: "t1", leadId: String(captured.leadId), projectId: "p9", now }),
    [],
  );
});

test("inbound follows a moved thread's pointer", () => {
  const source = readFileSync(`${process.cwd()}/functions/src/communications/inbound.ts`, "utf8");
  assert.match(source, /get\("movedTo"\)/);
  assert.match(source, /leadId: conversation\.leadId \?\? null/);
});

test("an approved inquiry reply carries the lead so it threads", () => {
  const drafted = readFileSync(`${process.cwd()}/functions/src/operations/ai-pdf.ts`, "utf8");
  assert.match(drafted, /structuredOutput:\{[^}]*leadId/);
  const actions = readFileSync(`${process.cwd()}/functions/src/ai/actions.ts`, "utf8");
  assert.match(actions, /leadId: text\(structuredOutput\.leadId\)/);
  const dispatch = readFileSync(`${process.cwd()}/functions/src/ai/approved-communication.ts`, "utf8");
  assert.match(dispatch, /leadId: input\.leadId \?\? null/);
  const jobs = readFileSync(`${process.cwd()}/functions/src/operations/jobs.ts`, "utf8");
  assert.match(jobs, /clientContactEmails\.add\(leadEmail\)/);
});

test("lead fields record where each value came from", () => {
  const read = readInquiryEmail(fixture("squarespace-text"), { today: now.slice(0, 10) });
  const fields = leadFieldsFrom(read);
  assert.equal(fields.fieldProvenance.email?.source, "header");
  assert.equal(fields.fieldProvenance.eventDate?.source, "form");
  assert.deepEqual(missingInformationFor(fields), []);
});

test("the model fills only what is still empty, and says so", () => {
  const fills = fillsFor(
    { venue: "Wildflower Barn", eventDate: null, fieldProvenance: { venue: { source: "form" } } },
    {
      firstName: null,
      lastName: null,
      partnerName: "James",
      email: null,
      phone: null,
      eventDate: "2027-06-12",
      venue: "Somewhere else",
      city: null,
      ceremonyTime: "4pm",
      guestCount: 140,
      budget: null,
      wantsPhotography: true,
      wantsVideography: null,
      referralSource: null,
    },
    "2026-09-25",
  );
  assert.equal(fills.venue, undefined, "a form value is never overwritten");
  assert.equal(fills.eventDate, "2027-06-12");
  assert.equal(fills.estimatedGuestCount, 140);
  assert.equal((fills.fieldProvenance as Record<string, { source: string }>).eventDate!.source, "message");
  assert.equal((fills.fieldProvenance as Record<string, { source: string }>).venue!.source, "form");
  // A date in the past is not a wedding date.
  assert.equal(
    fillsFor({}, { ...emptyExtraction(), eventDate: "2020-01-01" }, "2026-09-25").eventDate,
    undefined,
  );
});

function emptyExtraction() {
  return {
    firstName: null,
    lastName: null,
    partnerName: null,
    email: null,
    phone: null,
    eventDate: null,
    venue: null,
    city: null,
    ceremonyTime: null,
    guestCount: null,
    budget: null,
    wantsPhotography: null,
    wantsVideography: null,
    referralSource: null,
  };
}

test("Gmail's forwarding confirmation is recognised and its code read", () => {
  const confirmation = gmailForwardingConfirmation({
    from: "forwarding-noreply@google.com",
    subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from hello@hartlight.example",
    text:
      "hello@hartlight.example has requested to automatically forward mail to your email address inquiries+abc@in.studio-cue.com.\nConfirmation code: 123456789\n\nTo allow hello@hartlight.example to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc\n",
  });
  assert.ok(confirmation);
  assert.equal(confirmation.code, "123456789");
  assert.match(confirmation.link ?? "", /^https:\/\/mail-settings\.google\.com\//);
  assert.equal(
    gmailForwardingConfirmation({ from: "someone@example.com", subject: "Gmail Forwarding Confirmation", text: "" }),
    null,
    "only Google's own sender counts",
  );
});

test("the mailbox provider is read from MX records", () => {
  assert.equal(providerFromMx("gmail.com", []), "gmail");
  assert.equal(providerFromMx("hartlight.com", ["aspmx.l.google.com."]), "google_workspace");
  assert.equal(providerFromMx("hartlight.com", ["hartlight-com.mail.protection.outlook.com"]), "microsoft_365");
  assert.equal(providerFromMx("hartlight.com", ["mx1.zoho.com"]), "other");
});

test("the Gmail filter forwards only the builders the studio picked", () => {
  const query = gmailFilterQuery(["wix", "the_knot"]);
  assert.equal(
    query,
    "{from:wix-forms.com from:crm.wix.com from:wixsiteautomations.com from:theknot.com from:weddingpro.com}",
  );
  // The Knot and WeddingWire both send leads from weddingpro.com: once, not twice.
  assert.equal(gmailFilterQuery(["the_knot", "weddingwire"]).match(/weddingpro/g)?.length, 1);
  assert.match(gmailFilterQuery(["squarespace"]), /subject:"Form Submission"/);
  assert.equal(gmailFilterQuery([]), "");
  assert.match(gmailSearchLink(query), /^https:\/\/mail\.google\.com\/mail\/u\/0\/#search\//);
});

test("an Outlook rule gets the same sources as sender domains", () => {
  assert.deepEqual(senderDomains(["pixieset", "the_knot", "weddingwire"]), [
    "pixieset.com",
    "pixiesetmail.com",
    "theknot.com",
    "weddingpro.com",
    "weddingwire.com",
  ]);
  // Squarespace's subject narrowing has no place in a sender list.
  assert.deepEqual(senderDomains(["squarespace"]), ["squarespace.info"]);
});

test("a form that can email only one address is never pointed at StudioCue", () => {
  for (const guide of NOTIFICATION_GUIDES) {
    if (guide.supported) {
      assert.ok(guide.steps.length >= 3, `${guide.label} needs its instructions`);
      // The step that needs the address offers it to copy — the one thing a
      // studio must not retype.
      assert.ok(guide.steps.some((step) => step.action === "copy"), `${guide.label} offers the address`);
      if (guide.steps.some((step) => step.action === "open")) assert.ok(guide.link, `${guide.label} opens somewhere`);
      // Button names in bold, so the instruction matches what's on screen.
      assert.ok(guide.steps.every((step) => /\*\*[^*]+\*\*/.test(step.text)), `${guide.label} names its buttons`);
    } else {
      // Pointing a one-recipient form at StudioCue would stop the studio
      // getting its own inquiries; the setup must say why and offer the inbox.
      assert.equal(guide.steps.length, 0, `${guide.label} must not offer instructions`);
      assert.ok(guide.note, `${guide.label} must say why`);
    }
  }
  const unsupported = NOTIFICATION_GUIDES.filter((guide) => !guide.supported).map((guide) => guide.key);
  assert.deepEqual(unsupported.sort(), ["google_forms", "other", "pixieset", "showit", "squarespace"]);
});

test("capture health speaks up once when inquiries stop", () => {
  const day = 86_400_000;
  const daily = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((date) => `${date}T12:00:00.000Z`);
  assert.equal(silenceThreshold(daily), 7 * day, "never less than a week");
  const monthly = ["2026-05-01", "2026-06-01", "2026-07-01"].map((date) => `${date}T12:00:00.000Z`);
  assert.ok(silenceThreshold(monthly) > 80 * day, "a quiet studio's normal is its own");
  const base = { lastCaptureAt: "2026-09-10T12:00:00.000Z", thresholdMs: 7 * day };
  assert.equal(captureSilent({ ...base, alertedForCaptureAt: null, now: Date.parse("2026-09-25T12:00:00.000Z") }), true);
  assert.equal(
    captureSilent({ ...base, alertedForCaptureAt: base.lastCaptureAt, now: Date.parse("2026-09-25T12:00:00.000Z") }),
    false,
    "said once per silence",
  );
  assert.equal(captureSilent({ ...base, alertedForCaptureAt: null, now: Date.parse("2026-09-12T12:00:00.000Z") }), false);
  assert.equal(captureSilent({ lastCaptureAt: null, alertedForCaptureAt: null, thresholdMs: day, now: Date.now() }), false);
});

test("the capture collections are server-written and owner/admin-read", () => {
  const rules = readFileSync(`${process.cwd()}/firestore.rules`, "utf8");
  for (const collection of ["inboundCaptures", "leadCaptureSettings"]) {
    const start = rules.indexOf(`match /${collection}/`);
    assert.notEqual(start, -1, `${collection} has no rule`);
    const block = rules.slice(start, rules.indexOf("}\n", start));
    assert.match(block, /allow write: if false/);
  }
  const allowlist = readFileSync(`${process.cwd()}/scripts/configure-production-function-invokers.sh`, "utf8");
  assert.match(allowlist, /leadcapturehealthscheduler/);
});

test("'not an inquiry' retires the reply drafted to it", () => {
  // Otherwise the draft stays approvable in AI review, and sending it would
  // email a newsletter or a vendor. The read happens in the transaction,
  // before its writes.
  const source = readFileSync(`${process.cwd()}/functions/src/crm/commands.ts`, "utf8");
  const start = source.indexOf('if (command.type === "markLeadNotInquiry")');
  const block = source.slice(start, source.indexOf("lead.not_inquiry", start));
  assert.match(block, /capability", "==", "inquiry_reply_draft"/);
  assert.match(block, /status: "dismissed"/);
  assert.ok(
    block.indexOf("pendingReplies") < block.indexOf("transaction.update(leadReference"),
    "the drafts are read before the first write",
  );
});

import { forwardingConditions } from "../features/intake/forwarding-filters";

test("an Outlook rule gets conditions a rule can hold, not a phrase listed as a sender", () => {
  const conditions = forwardingConditions(["squarespace", "wordpress", "wix"]);
  assert.deepEqual(conditions.senders, ["squarespace.info", "wix-forms.com", "crm.wix.com", "wixsiteautomations.com"]);
  // Squarespace's subject narrowing is kept, as a condition.
  assert.deepEqual(conditions.subjectContains, ["Form Submission"]);
  // WordPress has no sender of its own: its phrase is a message condition.
  assert.deepEqual(conditions.messageContains, ["sent from a contact form on"]);
  assert.ok(!conditions.senders.some((sender) => sender.includes(" ")), "no phrase listed as a sender");
});

test("changing the studio's address says the forwarding address changes too", () => {
  const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
  assert.match(read("features/tenants/identity.ts"), /forwarding address changes with it/);
  assert.match(read("components/intake/lead-capture-setup.tsx"), /Your StudioCue address isn&apos;t ready yet/);
});

test("an inquiry waits for its date, then becomes one job however often it is asked", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "tenants/t1": { id: "t1", name: "Hart Light", timezone: "America/New_York" },
    "leads/l1": {
      id: "l1",
      tenantId: "t1",
      status: "new",
      needsConfirmation: false,
      eventDate: null,
      email: "Maren@Example.test",
      firstName: "Maren",
      lastName: "Castillo",
      displayName: "Maren Castillo",
      eventTypeLabel: "Wedding",
      archivedAt: null,
    },
  });
  assert.deepEqual(await convertInquiryToJob(db, { tenantId: "t1", leadId: "l1", now }), {
    converted: false,
    reason: "no_date",
  });
  assert.equal(rows(store, "projects").length, 0);

  store.get("leads/l1")!.eventDate = "2027-10-09";
  const first = await convertInquiryToJob(db, { tenantId: "t1", leadId: "l1", now });
  assert.deepEqual(first, { converted: true, projectId: projectIdForLead("t1", "l1"), created: true });
  const job = store.get(`projects/${projectIdForLead("t1", "l1")}`)!;
  assert.equal(job.name, "Maren Castillo Wedding");
  assert.equal(job.timezone, "America/New_York");
  assert.equal(job.nextAction, "Reply to the inquiry");
  const contact = store.get(`contacts/${job.clientContactIds && (job.clientContactIds as string[])[0]}`)!;
  assert.equal(contact.normalizedEmail, "maren@example.test");
  assert.deepEqual(contact.contactTypes, ["prospect"]);

  const again = await convertInquiryToJob(db, { tenantId: "t1", leadId: "l1", now });
  assert.deepEqual(again, { converted: true, projectId: first.converted ? first.projectId : "", created: false });
  assert.equal(rows(store, "projects").length, 1);
  assert.equal(rows(store, "contacts").length, 1);
});

test("a maybe, a closed lead and another studio's lead never become jobs", async () => {
  const lead = (extra: Record<string, unknown>) => ({
    tenantId: "t1",
    status: "new",
    needsConfirmation: false,
    eventDate: "2027-10-09",
    email: "a@example.test",
    archivedAt: null,
    ...extra,
  });
  const { db, store } = fakeFirestore({
    ...seed(),
    "leads/maybe": lead({ needsConfirmation: true }),
    "leads/closed": lead({ status: "archived" }),
    "leads/other": lead({ tenantId: "t2" }),
  });
  assert.equal((await convertInquiryToJob(db, { tenantId: "t1", leadId: "maybe", now })).converted, false);
  assert.equal((await convertInquiryToJob(db, { tenantId: "t1", leadId: "closed", now })).converted, false);
  assert.equal((await convertInquiryToJob(db, { tenantId: "t1", leadId: "other", now })).converted, false);
  assert.equal(rows(store, "projects").length, 0);
});

test("a reply carries the couple's link before its sign-off, once, and only when hours are set", async () => {
  const body = "Dear Maya,\n\nThank you — June 12 is free.\n\nWarmly,\nGabe";
  const without = fakeFirestore(seed());
  const bare = await withInquiryLink(without.db, { tenantId: "t1", leadId: "l1", body, now });
  assert.deepEqual(bare, { body, linked: false }, "no hours, no link");

  const { db, store } = fakeFirestore({ ...seed(), "consultationSettings/t1": { tenantId: "t1" } });
  const linked = await withInquiryLink(db, { tenantId: "t1", leadId: "l1", body, now });
  assert.equal(linked.linked, true);
  assert.match(linked.body, /pick a time to talk — it takes two minutes: https:\/\/.+\/i\/[\w-]{43}\n\nWarmly,\nGabe$/);
  const token = String(store.get("inquiryLinks/l1")!.token);
  assert.ok(linked.body.includes(`/i/${token}`));
  // A first paragraph that opens "Thanks…" is not the sign-off (prod walk,
  // 2026-10-06: the link landed straight under "Dear Maya,").
  const thanksFirst =
    "Dear Maya,\n\nThanks so much for reaching out about your wedding at The Madison Hotel on March 13, 2027! Your date is free.\n\nCheers, Conor — FlawlessIQ.";
  const placed = await withInquiryLink(db, { tenantId: "t1", leadId: "l2", body: thanksFirst, now });
  assert.match(placed.body, /^Dear Maya,\n\nThanks so much[^\n]+\n\nTell us a little more about your day[^\n]+\n\nCheers, Conor — FlawlessIQ\.$/);
  // The same inquiry keeps the same link, and it isn't added twice.
  const again = await withInquiryLink(db, { tenantId: "t1", leadId: "l1", body: linked.body, now });
  assert.equal(again.body, linked.body);
});

test("the couple's details fill only what's missing, and a date makes the inquiry a job", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "leads/l1": {
      id: "l1",
      tenantId: "t1",
      status: "new",
      needsConfirmation: false,
      eventDate: null,
      venue: "The Ryland Inn",
      email: "maya@example.test",
      firstName: "Maya",
      lastName: "Test",
      displayName: "Maya Test",
      archivedAt: null,
    },
    "consultationSettings/t1": { tenantId: "t1" },
  });
  await withInquiryLink(db, { tenantId: "t1", leadId: "l1", body: "Hi", now });
  const token = String(store.get("inquiryLinks/l1")!.token);
  const context = await resolveInquiryLink(db, token);
  assert.ok(detailsOf(context.lead).missing.includes("eventDate"));
  assert.ok(!detailsOf(context.lead).missing.includes("venue"));

  const result = await saveCoupleDetails(
    db,
    context,
    { eventDate: "2027-06-12", venue: "Somewhere else", partnerName: "Sam", estimatedGuestCount: 120 },
    now,
  );
  const lead = store.get("leads/l1")!;
  assert.equal(lead.venue, "The Ryland Inn", "what the studio already had is kept");
  assert.equal(lead.eventDate, "2027-06-12");
  assert.equal(lead.displayName, "Maya Test & Sam");
  assert.equal((lead.fieldProvenance as Record<string, { source: string }>).eventDate!.source, "couple");
  assert.ok(result.projectId, "the date made it a job");
  assert.equal(store.get(`projects/${result.projectId}`)!.state, "LEAD");
});

test("a link for an inquiry marked not-an-inquiry stops working", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "leads/l1": { id: "l1", tenantId: "t1", status: "archived", notInquiry: true },
    "consultationSettings/t1": { tenantId: "t1" },
  });
  await withInquiryLink(db, { tenantId: "t1", leadId: "l1", body: "Hi", now });
  const token = String(store.get("inquiryLinks/l1")!.token);
  await assert.rejects(resolveInquiryLink(db, token), /INQUIRY_LINK_NOT_FOUND/);
  await assert.rejects(resolveInquiryLink(db, "x".repeat(43)), /INQUIRY_LINK_NOT_FOUND/);
});

const day = (n: number) => new Date(Date.parse("2026-10-01T12:00:00.000Z") + n * 86_400_000).toISOString();

test("follow-ups count from the studio's last word before the quiet, not from each nudge", () => {
  const base = { lastInboundAt: day(-1), lastOutboundAt: day(0), heardElsewhereAt: null, closeDeferredUntil: null };
  assert.equal(followUpStep({ ...base, round: null, now: day(2) }).kind, "none");
  const first = followUpStep({ ...base, round: null, now: day(3) });
  assert.equal(first.kind, "first");
  // The day-3 nudge was sent: the thread's last outbound moves, the round doesn't.
  const round = { ...first.round!, firstDraftedAt: day(3) };
  assert.equal(followUpStep({ ...base, lastOutboundAt: day(3), round, now: day(6) }).kind, "none");
  const second = followUpStep({ ...base, lastOutboundAt: day(3), round, now: day(7) });
  assert.equal(second.kind, "second");
  const quiet = { ...round, secondDraftedAt: day(7) };
  assert.equal(followUpStep({ ...base, lastOutboundAt: day(7), round: quiet, now: day(14) }).kind, "close");
  // Kept open for a week: not offered again until it passes.
  assert.equal(
    followUpStep({ ...base, lastOutboundAt: day(7), round: quiet, closeDeferredUntil: day(21), now: day(15) }).kind,
    "none",
  );
});

test("the couple writing back, or replying elsewhere, ends the round", () => {
  const round = { startedAt: day(0), firstDraftedAt: day(3), secondDraftedAt: null, closeSuggestedAt: null };
  const wroteBack = followUpStep({
    lastInboundAt: day(4), lastOutboundAt: day(3), heardElsewhereAt: null, closeDeferredUntil: null, round, now: day(8),
  });
  assert.deepEqual(wroteBack, { kind: "none", round: null });
  const elsewhere = followUpStep({
    lastInboundAt: day(-1), lastOutboundAt: day(3), heardElsewhereAt: day(5), closeDeferredUntil: null, round, now: day(8),
  });
  assert.equal(elsewhere.kind, "first", "a new round starts from when they were heard from");
  assert.equal(elsewhere.round!.startedAt, day(5));
});

test("a quiet inquiry gets a templated follow-up on its couple's card, with their link", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "tenants/t1": { id: "t1", name: "Hart Light", brandName: "Hart Light" },
    "consultationSettings/t1": { tenantId: "t1" },
    "projects/p1": { id: "p1", tenantId: "t1", state: "LEAD", archivedAt: null },
    "leads/l1": {
      id: "l1", tenantId: "t1", projectId: "p1", status: "converted", email: "emma@example.test",
      firstName: "Emma", displayName: "Emma Hart", eventDate: "2027-06-12", primaryContactId: "c1",
    },
    "conversations/conv1": {
      id: "conv1", tenantId: "t1", projectId: "p1", leadId: "l1", lastInboundAt: day(-1), lastOutboundAt: day(0),
      lastMessageAt: day(0), lastMessageDirection: "outbound",
    },
  });
  const step = await advanceFollowUp(db, await db.doc("leads/l1").get() as never, day(3));
  assert.equal(step, "first");
  const draft = rows(store, "aiActions")[0]!;
  assert.equal(draft.capability, "inquiry_follow_up");
  assert.equal(draft.status, "review_required");
  const output = draft.structuredOutput as Record<string, unknown>;
  assert.equal(output.recipientEmail, "emma@example.test");
  assert.match(String(output.body), /^Hi Emma,\n\nJust checking my note reached you/);
  assert.match(String(output.body), /\/i\/[\w-]{43}\n\nWarmly,\nHart Light$/);
  // Run again the same day: nothing new.
  await advanceFollowUp(db, await db.doc("leads/l1").get() as never, day(3));
  assert.equal(rows(store, "aiActions").length, 1);
  // The couple books a call: the pending nudge is withdrawn.
  store.get("projects/p1")!.state = "CONSULTATION";
  await advanceFollowUp(db, await db.doc("leads/l1").get() as never, day(4));
  assert.equal(rows(store, "aiActions")[0]!.status, "dismissed");
});

test("a closed inquiry reopens to where it was when the couple writes again", async () => {
  const { db, store } = fakeFirestore({
    ...seed(),
    "projects/p1": { id: "p1", tenantId: "t1", state: "LOST", lostFromState: "CONSULTATION", lostReason: "went_quiet", stateVersion: 3 },
    "leads/l1": { id: "l1", tenantId: "t1", projectId: "p1", status: "lost" },
  });
  assert.equal(await reopenOnReply(db, { tenantId: "t1", projectId: "p1", leadId: "l1", now }), true);
  assert.equal(store.get("projects/p1")!.state, "CONSULTATION");
  assert.equal(store.get("projects/p1")!.lostReason, null);
  assert.equal(store.get("leads/l1")!.status, "converted");
  assert.equal(await reopenOnReply(db, { tenantId: "t1", projectId: "p1", leadId: "l1", now }), false);
});

test("a new inquiry emails the studio once; a maybe doesn't", async () => {
  const { db, store } = fakeFirestore({
    "tenants/t1": { id: "t1", name: "Hart Light", contactEmail: "hello@hartlight.example" },
  });
  const email = fixture("squarespace-text");
  const first = await captureInquiry({ db, tenantId: "t1", email, providerMessageId: "<a1>", route: "forward", now });
  const alert = store.get(`emailJobs/new_inquiry_${first.leadId}`)!;
  assert.equal(alert.type, "studio_new_inquiry");
  assert.equal(alert.recipient, "hello@hartlight.example");
  assert.equal(alert.actionUrl, `https://studio-cue.com/studio/projects/${first.projectId}`);
  const maybe = await captureInquiry({
    db, tenantId: "t1", email: { ...email, text: email.text + " " }, providerMessageId: "<a2>", route: "forward",
    reviewReason: "held", now,
  });
  assert.equal(store.has(`emailJobs/new_inquiry_${maybe.leadId}`), false);
});

test("a form inquiry's alert lists only what was answered, contact first", async () => {
  const { formInquiryDetails } = await import("../functions/src/intake/new-inquiry-alert");
  const rows = formInquiryDetails({
    email: "gabe@example.test",
    phone: "555-0100",
    partnerName: null,
    eventTypeLabel: "Wedding",
    venue: "The Rockleigh, Rockleigh, NJ",
    city: "Rockleigh",
    estimatedGuestCount: 140,
    servicesRequested: ["photography", "engagement_session"],
    budgetRange: null,
    referralSource: "Instagram",
    coiRequired: "not_sure",
    venueContactName: null,
    venueContactEmail: null,
    answers: [{ question: "Getting ready at the venue?", answer: "Yes" }],
  });
  assert.deepEqual(rows, [
    { label: "Email", value: "gabe@example.test" },
    { label: "Phone", value: "555-0100" },
    { label: "Event", value: "Wedding" },
    { label: "Venue", value: "The Rockleigh, Rockleigh, NJ" },
    { label: "Guests", value: "140" },
    { label: "Looking for", value: "Photography, Engagement session" },
    { label: "Heard about you", value: "Instagram" },
    { label: "Venue needs insurance", value: "Not sure" },
    { label: "Getting ready at the venue?", value: "Yes" },
  ]);
});
