import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consultationEmailPlan,
  consultationIdOfEmailJob,
} from "../functions/src/booking/consultation-email";
import { renderEmailTemplate, emailTemplateKeys } from "../functions/src/communications/email-templates";
import {
  ZOOM_UNAVAILABLE_CODES,
  createConsultationResourcesWith,
} from "../functions/src/operations/provider-runtime";
import { senderProtection } from "../functions/src/intake/ignorable-sender";
import { isLiveConsultation, currentConsultation } from "../features/consultations/live";
import {
  defaultConsultationMode,
  defaultMeetingFormats,
  videoCallDetail,
  zoomIsConnected,
} from "../features/consultations/meeting-mode";
import { ignorableSenderOf, notInquiryAllowed } from "../features/intake/not-inquiry";
import { todayInbox } from "../features/today/inbox";
import { STUDIO_ACTION_IDS, actionSpec } from "../functions/src/ai/action-catalog";

/**
 * Wave 0: consultations and inquiries (2026-09-30).
 *
 *  1. The Zoom link reaches the couple: consultation emails render from the
 *     consultation at send time, and wait briefly for the meeting to exist.
 *  2. Zoom not connected no longer strands a booking: the Zoom step is
 *     skipped with a reason, the calendar step still runs, and new
 *     consultations stop defaulting to Zoom.
 *  3. A studio's move or cancel tells the couple, by email.
 *  4. A cancelled consultation is not "Meeting booked".
 *  5. "Not an inquiry" never silently learns the studio's own form or mailbox,
 *     only learns when asked, and can be undone.
 *  6. "Not an inquiry" is only offered where the server accepts it.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const brand = {
  studioName: "Hart Light Photography",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "hello@hartlight.test",
};

const zoomConsultation = {
  tenantId: "t1",
  status: "scheduled",
  mode: "zoom",
  startsAt: "2027-01-10T15:00:00.000Z",
  joinUrl: null,
  location: null,
  providerState: "queued",
};

// ── 1. The confirmation carries the link ────────────────────────────────────

test("a Zoom confirmation waits while the meeting is still being made", () => {
  const plan = consultationEmailPlan({
    type: "consultation_confirmation",
    job: { startsAt: zoomConsultation.startsAt },
    consultation: zoomConsultation,
    resourcesJobStatus: "queued",
    attempt: 1,
    maxAttempts: 5,
  });
  assert.deepEqual(plan, { kind: "wait" });
});

test("once the meeting exists, the confirmation carries its join link", () => {
  const plan = consultationEmailPlan({
    type: "consultation_confirmation",
    job: { startsAt: zoomConsultation.startsAt, location: null },
    consultation: {
      ...zoomConsultation,
      joinUrl: "https://zoom.us/j/123",
      providerState: "completed",
    },
    resourcesJobStatus: "succeeded",
    attempt: 2,
    maxAttempts: 5,
  });
  assert.equal(plan.kind, "send");
  if (plan.kind !== "send") return;
  assert.equal(plan.values.joinUrl, "https://zoom.us/j/123");
  const rendered = renderEmailTemplate({
    key: "consultation_confirmation",
    brand,
    recipientName: "Maren Castillo",
    projectName: "Castillo wedding",
    values: { ...plan.values, timezone: "America/New_York" },
  });
  assert.match(rendered.text, /https:\/\/zoom\.us\/j\/123/);
  assert.match(rendered.html, /Join the video call/);
  assert.doesNotMatch(rendered.text, /final meeting details/);
});

test("it never waits past its last attempt, and then says the link will follow", () => {
  for (const [attempt, jobStatus] of [
    [5, "queued"],
    [1, "dead_letter"],
  ] as const) {
    const plan = consultationEmailPlan({
      type: "consultation_confirmation",
      job: {},
      consultation: zoomConsultation,
      resourcesJobStatus: jobStatus,
      attempt,
      maxAttempts: 5,
    });
    assert.equal(plan.kind, "send", `attempt ${attempt}, job ${jobStatus}`);
    if (plan.kind !== "send") continue;
    assert.equal(plan.values.meetingDetailsPending, true);
    const rendered = renderEmailTemplate({ key: "consultation_confirmation", brand, values: plan.values });
    assert.match(rendered.text, /we'll send you the link to join/);
  }
});

test("Zoom skipped (not connected): the confirmation goes at once and says the link will follow", () => {
  const plan = consultationEmailPlan({
    type: "consultation_confirmation",
    job: {},
    consultation: { ...zoomConsultation, providerState: "completed", meetingSkipReason: "ZOOM_NOT_CONNECTED" },
    resourcesJobStatus: "succeeded",
    attempt: 1,
    maxAttempts: 5,
  });
  assert.equal(plan.kind, "send");
  assert.equal(plan.kind === "send" && plan.values.meetingDetailsPending, true);
});

test("a consultation cancelled or replaced before its confirmation went is not confirmed", () => {
  for (const status of ["cancelled", "rescheduled"]) {
    const plan = consultationEmailPlan({
      type: "consultation_confirmation",
      job: {},
      consultation: { ...zoomConsultation, status },
      resourcesJobStatus: null,
      attempt: 1,
      maxAttempts: 5,
    });
    assert.equal(plan.kind, "hold", status);
  }
});

test("older confirmation jobs still find their consultation from the job id", () => {
  assert.equal(
    consultationIdOfEmailJob("consultation_confirmation_consultation_abc", {}),
    "consultation_abc",
  );
  assert.equal(consultationIdOfEmailJob("x", { consultationId: "consultation_def" }), "consultation_def");
  assert.equal(consultationIdOfEmailJob("manual_1", {}), null);
});

test("the email worker plans consultation emails before it renders them", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  const planned = jobs.indexOf("consultationEmailPlanFor(");
  const rendered = jobs.indexOf("renderEmailTemplate({", planned);
  assert.ok(planned > 0 && rendered > planned, "the plan is read before the render");
  // The consultation's values win over the job's (a reminder's may follow; they never overlap).
  assert.match(jobs, /values: \{ \.\.\.context\.values, \.\.\.consultationValues[ ,]/);
  // Every path that queues a confirmation names the consultation.
  for (const path of ["functions/src/booking/commands.ts", "functions/src/booking/public-scheduling.ts"]) {
    const source = read(path);
    for (const anchor of source.matchAll(/emailJobs\/consultation_confirmation_/g)) {
      const window = source.slice(anchor.index!, anchor.index! + 600);
      assert.match(window, /consultationId,/, `${path} queues a confirmation without its consultation`);
    }
  }
});

// ── 2. Zoom not connected ───────────────────────────────────────────────────

function fakeDb(seed: Record<string, Record<string, unknown>>) {
  const store = new Map(Object.entries(seed).map(([path, row]) => [path, { ...row }]));
  return {
    store,
    doc(path: string) {
      return {
        async get() {
          const data = store.get(path);
          return { exists: Boolean(data), get: (field: string) => data?.[field], data: () => data };
        },
        async update(changes: Record<string, unknown>) {
          store.set(path, { ...(store.get(path) ?? {}), ...changes });
        },
      };
    },
  };
}

test("Zoom not connected: the calendar step still runs and the consultation completes with a reason", async () => {
  const db = fakeDb({
    "consultations/c1": {
      ...zoomConsultation,
      endsAt: "2027-01-10T15:45:00.000Z",
      timezone: "America/New_York",
      meetingId: null,
      calendarEventId: null,
    },
  });
  const asked: string[] = [];
  const result = await createConsultationResourcesWith(
    { id: "consultation_c1", get: (field: string) => (field === "tenantId" ? "t1" : undefined) } as never,
    {
      db: db as never,
      connect: async (_tenantId, provider) => {
        asked.push(provider);
        if (provider === "zoom") throw new Error("ZOOM_NOT_CONNECTED");
        return { document: { get: () => undefined }, mock: true, credential: null } as never;
      },
    },
  );
  assert.deepEqual(asked, ["zoom", "google_calendar"], "the calendar step is not skipped");
  const saved = db.store.get("consultations/c1")!;
  assert.equal(saved.providerState, "completed");
  assert.equal(saved.meetingSkipReason, "ZOOM_NOT_CONNECTED");
  assert.match(String(saved.meetingSkipMessage), /Zoom isn't connected/);
  assert.ok(String(saved.calendarEventId).startsWith("mock_gcal_"));
  assert.equal(result.meetingSkipReason, "ZOOM_NOT_CONNECTED");
});

test("a Zoom outage still fails the job, so it is retried", async () => {
  assert.ok(!ZOOM_UNAVAILABLE_CODES.has("ZOOM_CREATE_FAILED"));
  const db = fakeDb({ "consultations/c1": { ...zoomConsultation, meetingId: null } });
  await assert.rejects(
    createConsultationResourcesWith({ id: "consultation_c1", get: () => "t1" } as never, {
      db: db as never,
      connect: async () => {
        throw new Error("ZOOM_TOKEN_REFRESH_FAILED");
      },
    }),
    /ZOOM_TOKEN_REFRESH_FAILED/,
  );
});

test("new consultations default to Zoom only when Zoom is connected", () => {
  assert.equal(defaultConsultationMode(true), "zoom");
  assert.equal(defaultConsultationMode(false), "phone");
  assert.equal(defaultConsultationMode(null), "phone");
  assert.deepEqual(defaultMeetingFormats(false), ["phone"]);
  assert.equal(
    zoomIsConnected({ capability: "meetings", provider: "zoom", state: "ready", summary: "", remedy: null, ok: true }),
    true,
  );
  assert.equal(
    zoomIsConnected({ capability: "meetings", provider: null, state: "none_connected", summary: "", remedy: null, ok: false }),
    false,
  );
  assert.match(videoCallDetail(true), /Zoom link goes out with the confirmation/);
  assert.match(videoCallDetail(false), /you send them the link/);
  // The hard-coded Zoom defaults are gone from the places that made them.
  assert.doesNotMatch(read("components/projects/live-project-detail.tsx"), /mode: "zoom" \}/);
  assert.doesNotMatch(
    read("components/booking/studio-calendar.tsx"),
    /useState<"zoom" \| "in_person" \| "phone" \| "custom">\("zoom"\)/,
  );
  assert.doesNotMatch(read("components/ai/actions/booking-actions.tsx"), /return "zoom";\n\}/);
});

// ── 3. Move and cancel tell the couple ──────────────────────────────────────

test("moved and cancelled consultations have their own emails, with a way to rebook", () => {
  assert.ok(emailTemplateKeys.includes("consultation_rescheduled"));
  assert.ok(emailTemplateKeys.includes("consultation_cancelled"));
  const moved = renderEmailTemplate({
    key: "consultation_rescheduled",
    brand,
    recipientName: "Maren",
    values: {
      startsAt: "2027-01-12T15:00:00.000Z",
      timezone: "America/New_York",
      joinUrl: "https://zoom.us/j/9",
      rescheduleUrl: "https://studio-cue.com/i/token",
    },
  });
  assert.match(moved.subject, /New time/);
  assert.match(moved.text, /January 12, 2027 at 10:00/);
  assert.match(moved.text, /https:\/\/studio-cue\.com\/i\/token/);
  const cancelled = renderEmailTemplate({
    key: "consultation_cancelled",
    brand,
    recipientName: "Maren",
    values: {
      startsAt: "2027-01-12T15:00:00.000Z",
      timezone: "America/New_York",
      rescheduleUrl: "https://studio-cue.com/i/token",
    },
  });
  assert.match(cancelled.subject, /canceled/);
  assert.match(cancelled.html, /Pick another time/);
  // No inquiry page (a job made by hand): they are told to reply instead.
  const noLink = renderEmailTemplate({
    key: "consultation_cancelled",
    brand,
    values: { startsAt: "2027-01-12T15:00:00.000Z" },
  });
  assert.match(noLink.text, /reply to this email/);
});

test("a cancel email only goes about a cancelled consultation; a later move holds an earlier one", () => {
  assert.equal(
    consultationEmailPlan({
      type: "consultation_cancelled",
      job: {},
      consultation: { ...zoomConsultation, status: "cancelled" },
      resourcesJobStatus: null,
      attempt: 1,
      maxAttempts: 5,
    }).kind,
    "send",
  );
  assert.equal(
    consultationEmailPlan({
      type: "consultation_rescheduled",
      job: { startsAt: "2027-01-11T15:00:00.000Z" },
      consultation: { ...zoomConsultation, startsAt: "2027-01-12T15:00:00.000Z", providerState: "rescheduled" },
      resourcesJobStatus: null,
      attempt: 1,
      maxAttempts: 5,
    }).kind,
    "hold",
  );
});

test("cancel and reschedule queue the couple's email, respecting mayContactClient", () => {
  const source = read("functions/src/booking/commands.ts");
  for (const [command, type] of [
    ["cancelConsultation", "consultation_cancelled"],
    ["rescheduleConsultation", "consultation_rescheduled"],
  ] as const) {
    const start = source.indexOf(`command.type === "${command}"`);
    const block = source.slice(start, source.indexOf("} else if (command.type ===", start + 10));
    assert.match(block, new RegExp(`type: "${type}"`), `${command} queues ${type}`);
    assert.match(block, /mayContactClient\(/, `${command} checks the couple may be written to`);
    assert.match(block, /clientNotified/, `${command} tells the screen whether it emailed`);
  }
  // And the screens stop claiming what did not happen.
  const cue = read("components/ai/actions/booking-actions.tsx");
  assert.doesNotMatch(cue, /They've been sent the new time\./);
  assert.doesNotMatch(cue, /comes off both calendars/);
  assert.doesNotMatch(
    read("components/booking/studio-calendar.tsx"),
    /The calendar invitation and any Zoom meeting were updated/,
  );
});

// ── 4. Cancelled is not booked ──────────────────────────────────────────────

test("only scheduled or completed consultations count", () => {
  assert.equal(isLiveConsultation({ status: "scheduled" }), true);
  assert.equal(isLiveConsultation({ status: "completed" }), true);
  assert.equal(isLiveConsultation({ status: "cancelled" }), false);
  assert.equal(isLiveConsultation({ status: "rescheduled" }), false);
  const picked = currentConsultation([
    { id: "a", status: "completed", startsAt: "2027-01-01T10:00:00Z" },
    { id: "b", status: "cancelled", startsAt: "2027-02-01T10:00:00Z" },
  ]);
  assert.equal(picked?.id, "a", "the newest cancelled one is not the current one");
  for (const path of ["components/projects/use-project-journey.ts", "components/today/use-today-inbox.ts"]) {
    // The sales call that is on or happened (tests/final-details-call.test.ts).
    assert.match(read(path), /hasConsultation: forProject\([^)]*\)\.some\(\s*\(record\) => isSalesConsultation\(record\) && isLiveConsultation\(record\),?\s*\)/, path);
  }
});

// ── 5. Ignoring a sender ────────────────────────────────────────────────────

test("a studio's own form, marketplace or mailbox is never learned as 'not an inquiry'", () => {
  const studio = ["hello@hartlight.com", "owner@gmail.com"];
  const cases: Array<[string, string | null, string | null]> = [
    ["form-submission@squarespace.info", "squarespace", "form_or_marketplace"],
    ["no-reply@wix-forms.com", null, "form_or_marketplace"],
    ["forms-receipts-noreply@google.com", null, "form_or_marketplace"],
    ["notifications@typeform.com", null, "form_or_marketplace"],
    ["wordpress@hartlight.com", "wordpress", "studio_address"],
    ["hello@hartlight.com", null, "studio_address"],
    ["noreply@hartlight.com", null, "studio_address"],
    ["noreply@some-site.com", null, "notification_address"],
    ["owner@gmail.com", null, "studio_address"],
    // A shared mailbox provider is not the studio's domain.
    ["newsletter@gmail.com", null, null],
    ["deals@vendor-mail.com", null, null],
  ];
  for (const [sender, formBuilder, expected] of cases) {
    assert.equal(senderProtection({ sender, formBuilder, studioAddresses: studio }), expected, sender);
  }
  assert.equal(
    senderProtection({ sender: "maren@example.com", leadEmail: "Maren@example.com", studioAddresses: [] }),
    "the_couple",
  );
});

test("the command learns a sender only when asked, and says why it kept one", () => {
  const source = read("functions/src/crm/commands.ts");
  const start = source.indexOf('if (command.type === "markLeadNotInquiry")');
  const block = source.slice(start, source.indexOf('if (command.type === "removeIgnoredSender")', start));
  assert.match(block, /command\.input\.ignoreSender && protection === null/);
  assert.match(block, /senderKept/);
  assert.match(source, /ignoreSender: z\.boolean\(\)\.default\(false\)/);
  // Undo: an owner/admin command, listed in settings and reachable from Cue.
  const remove = source.slice(source.indexOf('if (command.type === "removeIgnoredSender")'));
  assert.match(remove.slice(0, 600), /studio_owner", "studio_admin"/);
  assert.match(read("functions/src/communications/commands.ts"), /ignoredSenders:/);
  assert.match(read("components/intake/lead-capture-setup.tsx"), /<IgnoredSenders/);
  assert.ok(STUDIO_ACTION_IDS.has("unignore_sender"));
  assert.equal(actionSpec("unignore_sender")?.ownerAdminOnly, true);
});

test("the confirm step names the sender only when it could be ignored", () => {
  assert.equal(
    ignorableSenderOf({ notificationSender: "Deals@Vendor-Mail.com", formBuilder: "unknown", email: "x@y.com" }),
    "deals@vendor-mail.com",
  );
  // A known form's address carries every inquiry: not offered.
  assert.equal(
    ignorableSenderOf({ notificationSender: "form-submission@squarespace.info", formBuilder: "squarespace" }),
    null,
  );
  // Leads from before capture recorded it: nothing to name, so nothing offered.
  assert.equal(ignorableSenderOf({ formBuilder: "unknown" }), null);
  assert.equal(ignorableSenderOf({ notificationSender: "maren@example.com", email: "maren@example.com" }), null);
  // And capture records it on new leads.
  assert.match(read("functions/src/intake/capture.ts"), /notificationSender: read\.notificationSender,\n/);
  // Every "Not an inquiry" answer goes through the confirm step.
  for (const path of ["components/leads/lead-capture-review.tsx", "components/today/today-inbox.tsx"]) {
    const source = read(path);
    assert.match(source, /<NotInquiryConfirm/, path);
    assert.doesNotMatch(source, /runCrmCommand\("markLeadNotInquiry"/, path);
  }
});

// ── 6. Offered only where it works ──────────────────────────────────────────

test("'Not an inquiry' is not offered on a job the studio made by hand", () => {
  assert.equal(notInquiryAllowed(null), true);
  assert.equal(notInquiryAllowed({ origin: "inquiry", state: "LEAD" }), true);
  assert.equal(notInquiryAllowed({ state: "LEAD" }), false);
  assert.equal(notInquiryAllowed({ origin: "inquiry", state: "CONSULTATION" }), false);
  const now = "2026-09-30T12:00:00.000Z";
  const lead = (id: string, projectId: string) => ({
    id,
    status: "converted",
    displayName: `Couple ${id}`,
    projectId,
    createdAt: now,
  });
  const inbox = todayInbox({
    now,
    leads: [lead("l1", "p-inquiry"), lead("l2", "p-manual")],
    projects: [
      { id: "p-inquiry", state: "LEAD", origin: "inquiry", name: "From an inquiry" },
      { id: "p-manual", state: "LEAD", name: "Made by hand" },
    ],
  } as never);
  const action = (leadId: string) => {
    const item = inbox.act.find((entry) => entry.id === `lead-${leadId}`);
    assert.ok(item, `lead ${leadId} has a card`);
    return item!.action as { notInquiryAllowed?: boolean };
  };
  assert.equal(action("l1").notInquiryAllowed, true);
  assert.equal(action("l2").notInquiryAllowed, false);
});
