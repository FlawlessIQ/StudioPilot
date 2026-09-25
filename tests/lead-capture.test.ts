import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureInquiry, leadFieldsFrom, missingInformationFor } from "../functions/src/intake/capture";
import { readInquiryEmail, type InquiryEmail } from "../functions/src/intake/form-email";
import { gmailForwardingConfirmation } from "../functions/src/intake/gmail-forwarding";
import { fillsFor } from "../functions/src/intake/enrich";
import { moveLeadThreadsToProject } from "../functions/src/intake/lead-thread";
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

  // The inquiry is the first message on the lead's thread, keyed so the
  // studio's reply (sent with the lead id) lands on the same conversation.
  const expectedThread = conversationIdFor({
    tenantId: "t1",
    leadId: result.leadId,
    participant: { email: "emma.hart@example.com" },
  });
  assert.equal(lead.conversationId, expectedThread);
  const conversation = store.get(`conversations/${expectedThread}`)!;
  assert.equal(conversation.leadId, result.leadId);
  assert.equal(conversation.studioUnreadCount, 1);
  const messages = rows(store, "messages");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.leadId, result.leadId);

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

test("the couple writing again is attached to their open lead, not a second one", async () => {
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
  assert.equal(again.outcome, "attached_to_lead");
  assert.equal(again.leadId, first.leadId);
  assert.equal(rows(store, "leads").length, 1);
  assert.equal(store.get(`leads/${first.leadId}`)!.inquiryCount, 2);
  assert.equal(rows(store, "messages").length, 2);
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
  const captured = await captureInquiry({
    db,
    tenantId: "t1",
    email: fixture("squarespace-text"),
    providerMessageId: "<m1>",
    route: "forward",
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
      assert.ok(guide.path.length >= 3, `${guide.label} needs its click path`);
    } else {
      // Pointing a one-recipient form at StudioCue would stop the studio
      // getting its own inquiries; the setup must say why and offer the inbox.
      assert.equal(guide.path.length, 0, `${guide.label} must not offer a path`);
      assert.ok(guide.note, `${guide.label} must say why`);
    }
  }
  const unsupported = NOTIFICATION_GUIDES.filter((guide) => !guide.supported).map((guide) => guide.key);
  assert.deepEqual(unsupported.sort(), ["google_forms", "pixieset", "showit", "squarespace"]);
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
