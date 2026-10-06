import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDOFF_EMAIL_TYPES,
  cueHandoff,
  handoffHeadline,
  handoffReadSince,
  handoffWhen,
  type HandoffInput,
  type HandoffRecord,
} from "@/features/today/handoff";

const NOW = "2026-10-06T13:00:00.000Z";
const project = { id: "p1", tenantId: "t1", name: "Lena & Chris" };

/** A job the worker sent an hour ago. */
const sent = (fields: Record<string, unknown>): HandoffRecord => ({
  id: String(fields.id ?? `job_${String(fields.type)}`),
  tenantId: "t1",
  projectId: "p1",
  status: "succeeded",
  createdAt: "2026-10-06T11:59:00.000Z",
  completedAt: "2026-10-06T12:00:00.000Z",
  ...fields,
});

const handoff = (emailJobs: HandoffRecord[], more: Partial<HandoffInput> = {}) =>
  cueHandoff({ now: NOW, projects: [project], emailJobs, ...more });
const lines = (emailJobs: HandoffRecord[], more: Partial<HandoffInput> = {}) =>
  handoff(emailJobs, more).map((item) => item.line);

test("the scheduled reminders read as Cue's work, named by client", () => {
  assert.deepEqual(
    lines([
      sent({ type: "contract_reminder" }),
      sent({ type: "questionnaire_reminder" }),
      sent({ type: "event_reminder" }),
      sent({ type: "review_request" }),
      sent({ type: "album_selection_reminder" }),
      sent({ type: "delivery_expiry_reminder" }),
      sent({ type: "final_details_request" }),
      sent({ type: "contract_signed" }),
      sent({ type: "autopay_charged" }),
      sent({ type: "autopay_charge_failed" }),
    ]).sort(),
    [
      "Asked Lena & Chris for a review",
      "Asked Lena & Chris to sign off on the final details",
      "Charged Lena & Chris's saved card and sent the receipt",
      "Reminded Lena & Chris about their form",
      "Reminded Lena & Chris to pick their album photos",
      "Reminded Lena & Chris to sign their agreement",
      "Sent Lena & Chris their signed agreement",
      "Sent Lena & Chris their week-before note",
      "Told Lena & Chris their card was declined",
      "Told Lena & Chris their gallery closes soon",
    ],
  );
});

test("each item links to its job", () => {
  const [item] = handoff([sent({ type: "contract_reminder" })]);
  assert.equal(item?.href, "/studio/projects/p1");
  assert.equal(item?.projectId, "p1");
});

test("an unnamed job falls back to a neutral word, never a wedding one", () => {
  const [item] = handoff([sent({ type: "contract_reminder" })], { projects: [{ id: "p1", name: "" }] });
  assert.equal(item?.line, "Reminded the client to sign their agreement");
});

test("only the last 24 hours count", () => {
  const items = handoff([
    sent({ id: "fresh", type: "contract_reminder", completedAt: "2026-10-05T13:30:00.000Z" }),
    sent({ id: "stale", type: "contract_reminder", completedAt: "2026-10-05T12:30:00.000Z" }),
    sent({ id: "future", type: "contract_reminder", completedAt: "2026-10-06T13:30:00.000Z" }),
    sent({ id: "no-time", type: "contract_reminder", completedAt: null }),
  ]);
  assert.deepEqual(items.map((item) => item.id), ["fresh"]);
});

test("the read window reaches a day further back than the handoff", () => {
  assert.equal(handoffReadSince(NOW), "2026-10-04T13:00:00.000Z");
});

test("nothing that did not actually go out is handled", () => {
  assert.deepEqual(
    lines([
      sent({ id: "queued", type: "contract_reminder", status: "queued" }),
      sent({ id: "dead", type: "contract_reminder", status: "dead_letter" }),
      sent({ id: "held", type: "contract_reminder", result: { held: "client_automations_paused" } }),
      sent({ id: "bounced", type: "contract_reminder", deliveryStatus: "bounce" }),
    ]),
    [],
  );
});

test("anything a person sent, approved or retried is theirs, not Cue's", () => {
  assert.deepEqual(
    lines([
      sent({ id: "a", type: "contract_reminder", requestedBy: "user-1" }),
      sent({ id: "b", type: "event_reminder", retriedBy: "user-1" }),
      sent({ id: "c", type: "review_request", approvedBy: "user-1" }),
      sent({ id: "d", type: "event_reminder", automationRunId: "run-1" }),
    ]),
    [],
  );
});

test("types off the allowlist are never counted", () => {
  assert.deepEqual(
    lines([
      sent({ type: "proposal_sent" }),
      sent({ type: "studio_new_inquiry" }),
      sent({ type: "studio_booking_confirmed" }),
      sent({ type: "contract_ready" }),
      sent({ type: "delivery" }),
      sent({ type: "crew_assignment_cancelled" }),
    ]),
    [],
  );
  for (const type of ["proposal_sent", "delivery", "studio_new_inquiry"])
    assert.ok(!HANDOFF_EMAIL_TYPES.includes(type), type);
});

test("a partner's copy is the same act as the primary send", () => {
  const items = handoff([
    sent({ id: "qr_1", type: "questionnaire_reminder" }),
    sent({ id: "qr_1_partner_0", type: "questionnaire_reminder", partnerOfEmailJobId: "qr_1" }),
  ]);
  assert.equal(items.length, 1);
});

test("the inquiry thank-you names the person from the lead", () => {
  assert.deepEqual(
    lines([sent({ type: "inquiry_acknowledgement", projectId: null, leadId: "l1" })], {
      leads: [{ id: "l1", displayName: "Maya Johnson" }],
    }),
    ["Thanked Maya Johnson for their inquiry"],
  );
});

test("a call confirmation counts only when the client booked it themselves", () => {
  const consultations = [
    { id: "c-self", createdBy: "public-consultation-scheduler" },
    { id: "c-studio", createdBy: "user-1" },
  ];
  assert.deepEqual(
    lines(
      [
        sent({ id: "a", type: "consultation_confirmation", consultationId: "c-self" }),
        sent({ id: "b", type: "consultation_confirmation", consultationId: "c-studio" }),
      ],
      { consultations },
    ),
    ["Confirmed the call Lena & Chris booked"],
  );
});

test("invoices count only when the orchestrator or the scheduler raised them", () => {
  const invoiceReferences = [
    { id: "inv-auto", createdBy: "booking-orchestrator" },
    { id: "inv-final", createdBy: "final-invoice-scheduler" },
    { id: "inv-hand", createdBy: "user-1" },
  ];
  assert.deepEqual(
    lines(
      [
        sent({ id: "a", type: "retainer_invoice", invoiceId: "inv-auto", completedAt: "2026-10-06T12:02:00.000Z" }),
        sent({ id: "b", type: "final_invoice", invoiceId: "inv-final", completedAt: "2026-10-06T12:01:00.000Z" }),
        sent({ id: "c", type: "final_invoice", invoiceId: "inv-hand" }),
        sent({ id: "d", type: "retainer_invoice", invoiceId: "missing" }),
      ],
      { invoiceReferences },
    ),
    ["Sent Lena & Chris their retainer invoice", "Sent Lena & Chris their final invoice"],
  );
});

test("a booking confirmation counts only when the orchestrator completed the booking", () => {
  assert.deepEqual(
    lines([sent({ type: "booking_confirmation" })], { bookingOrchestrations: [{ id: "p1", status: "completed" }] }),
    ["Confirmed Lena & Chris's booking"],
  );
  assert.deepEqual(
    lines([sent({ type: "booking_confirmation" })], { bookingOrchestrations: [{ id: "p1", status: "active" }] }),
    [],
  );
});

test("the details form counts when it went at booking or as the scheduler's review", () => {
  const questionnaireResponses = [
    { id: "r-auto", createdBy: "booking-orchestrator" },
    { id: "r-hand", createdBy: "user-1" },
  ];
  assert.deepEqual(
    lines(
      [
        sent({ id: "questionnaire_request_r-auto", type: "questionnaire_request", completedAt: "2026-10-06T12:02:00.000Z" }),
        sent({ id: "questionnaire_request_r-hand", type: "questionnaire_request" }),
        sent({ id: "questionnaire_review_r-x", type: "questionnaire_request", variant: "review", completedAt: "2026-10-06T12:01:00.000Z" }),
      ],
      { questionnaireResponses },
    ),
    ["Sent Lena & Chris their details form", "Asked Lena & Chris to look over their form again"],
  );
});

test("a billing address ask counts only from the scheduler", () => {
  assert.deepEqual(
    lines([
      sent({ id: "a", type: "billing_address_request", clientOutreachGuard: true }),
      sent({ id: "b", type: "billing_address_request", clientOutreachGuard: false }),
    ]),
    ["Asked Lena & Chris for a billing address"],
  );
});

test("insurance: chases always, the first request only when the automation sent it", () => {
  const insuranceRequests = [
    { id: "req-auto", autoCreated: true },
    { id: "req-approved", autoCreated: true, approvedToSendBy: "user-1" },
    { id: "req-hand" },
  ];
  assert.deepEqual(
    lines(
      [
        sent({ id: "coi_chase_1_req-hand", type: "coi_request", requestId: "req-hand", chaseNumber: 1, completedAt: "2026-10-06T12:03:00.000Z" }),
        sent({ id: "coi_request_req-auto", type: "coi_request", requestId: "req-auto", completedAt: "2026-10-06T12:02:00.000Z" }),
        sent({ id: "coi_request_req-approved", type: "coi_request", requestId: "req-approved" }),
        sent({ id: "coi_request_req-hand", type: "coi_request", requestId: "req-hand" }),
      ],
      { insuranceRequests },
    ),
    [
      "Chased your insurance agent for Lena & Chris's certificate",
      "Asked your insurance agent for Lena & Chris's certificate",
    ],
  );
});

test("crew: call-time reminders, and re-offers only when an offer expired", () => {
  const crewAssignments = [
    { id: "cas_offer_2", createdBy: "crew-cascade-expiry" },
    { id: "cas_offer_1", createdBy: "user-1" },
  ];
  assert.deepEqual(
    lines(
      [
        sent({ id: "a", type: "crew_reminder", recipientName: "Sam", completedAt: "2026-10-06T12:02:00.000Z" }),
        sent({ id: "b", type: "crew_invitation", cascadeId: "cas", assignmentId: "cas_offer_2", recipientName: "Jo", completedAt: "2026-10-06T12:01:00.000Z" }),
        sent({ id: "c", type: "crew_invitation", cascadeId: "cas", assignmentId: "cas_offer_1", recipientName: "Al" }),
        sent({ id: "d", type: "crew_invitation", assignmentId: "direct" }),
      ],
      { crewAssignments },
    ),
    [
      "Reminded Sam of their call time for Lena & Chris",
      "Offered Lena & Chris to Jo when the last offer ran out",
    ],
  );
});

test("lifecycle auto-sends and the automatic call prep count; other messages are a person's", () => {
  const aiActions = [{ id: "ai_1", structuredOutput: { trigger: "day_before_checklist" } }];
  assert.deepEqual(
    lines(
      [
        sent({ id: "lifecycle_email_ai_1", type: "manual_message", aiActionId: "ai_1", completedAt: "2026-10-06T12:03:00.000Z" }),
        sent({ id: "consultation_prep_email_c1", type: "manual_message", completedAt: "2026-10-06T12:02:00.000Z" }),
        sent({ id: "lifecycle_email_ai_unknown", type: "manual_message", aiActionId: "ai_unknown", completedAt: "2026-10-06T12:01:00.000Z" }),
        sent({ id: "ai_email_x", type: "manual_message", aiActionId: "ai_x" }),
        sent({ id: "msg_y", type: "manual_message" }),
      ],
      { aiActions },
    ),
    [
      "Sent Lena & Chris the day-before checklist",
      'Sent Lena & Chris "Ahead of our call"',
      "Sent Lena & Chris a scheduled note",
    ],
  );
});

test("newest first", () => {
  const items = handoff([
    sent({ id: "older", type: "contract_reminder", completedAt: "2026-10-06T08:00:00.000Z" }),
    sent({ id: "newer", type: "event_reminder", completedAt: "2026-10-06T12:00:00.000Z" }),
  ]);
  assert.deepEqual(items.map((item) => item.id), ["newer", "older"]);
});

test("the headline counts both sides, with the right plurals", () => {
  assert.equal(handoffHeadline(7, 4), "Since yesterday, Cue handled 7 things. 4 need you.");
  assert.equal(handoffHeadline(1, 1), "Since yesterday, Cue handled 1 thing. 1 needs you.");
  assert.equal(handoffHeadline(3, 0), "Since yesterday, Cue handled 3 things. Nothing needs you.");
});

test("the phone's one line keeps the count that needs the studio", () => {
  assert.equal(handoffHeadline(5, 21, { short: true }), "Cue handled 5 things. 21 need you.");
});

test("times read as today's clock, or yesterday's", () => {
  assert.equal(handoffWhen("2026-10-06T09:14:00.000Z", NOW, "UTC"), "9:14 AM");
  assert.equal(handoffWhen("2026-10-05T16:02:00.000Z", NOW, "UTC"), "Yesterday 4:02 PM");
});

test("lines name the client, not the job: the recipient, else the job's name without its kind word", async () => {
  const { clientNameFor } = await import("@/features/today/handoff");
  const harper = { name: "Harper Lane wedding", eventKind: "wedding" };
  // Seen on prod 2026-10-06: "Reminded Harper Lane wedding to sign their agreement".
  assert.equal(clientNameFor({ type: "contract_reminder", recipientName: "Harper Lane" }, harper), "Harper Lane");
  assert.equal(clientNameFor({ type: "contract_reminder" }, harper), "Harper Lane");
  assert.equal(clientNameFor({ type: "consultation_confirmation" }, { name: "Tbdwalk Fresh Wedding" }), "Tbdwalk Fresh");
  assert.equal(clientNameFor({ type: "event_reminder", recipientName: "ella@example.com" }, { name: "Lena Marsh Portraits" }), "Lena Marsh");
  // To the crew or the agent, the line is "for {the job}".
  assert.equal(clientNameFor({ type: "crew_reminder", recipientName: "Jordan" }, harper), "Harper Lane wedding");
  assert.equal(clientNameFor({ type: "coi_request" }, harper), "Harper Lane wedding");
});
