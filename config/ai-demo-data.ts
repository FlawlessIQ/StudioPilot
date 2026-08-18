/**
 * Demo fixtures for the approval and in-flight collections.
 *
 * Without these, every AI surface in the app renders zero: the AI control
 * centre shows 0/0/0, each project's "Prepared for you" tray says nothing is
 * waiting, and Insights reports "approvals completed: 0". None of that is a
 * bug in the features — `demoTenantDocuments` simply had no fixtures for the
 * collections that feed them, so mock mode returned an empty array.
 *
 * Field names here must match what the consumers actually read:
 * `dailyCommandProjection` (features/dashboard/daily-command-center.ts) for the
 * approvals / exceptions / working buckets, and `AiQueueCard`
 * (components/ai/ai-approval-queue.tsx) for the card itself. There is at least
 * one record per status branch those two files filter on.
 */

export type DemoAiSourceReference = {
  type: string;
  entityType: string;
  entityId: string;
  label: string;
  locator: string;
};

export type DemoAiAction = {
  id: string;
  project: string;
  capability: string;
  title: string;
  status: "review_required" | "approved" | "rejected";
  authorityBoundary: string;
  confidence: { overall: number; label: string };
  validation: { issues: Array<{ code: string; severity: string; message: string }> };
  sourceReferences: DemoAiSourceReference[];
  downstreamCommand: { commandType: string } | null;
  structuredOutput: Record<string, unknown>;
  snoozedUntil: string | null;
  ageHours: number;
};

/**
 * Two of these are message drafts (subject + body), which is what routes the
 * card to the friendly subject/body editor rather than the structured-field
 * editor. The inquiry reply is deliberately `inquiry_reply_draft` with a
 * recipientEmail so the approve-then-send path is reachable.
 */
export const demoAiActions: DemoAiAction[] = [
  {
    id: "AIA-4101",
    project: "Maya & Theo Johnson",
    capability: "inquiry_reply_draft",
    title: "Reply to Lena & Chris about August availability",
    status: "review_required",
    authorityBoundary: "advisory_only",
    confidence: { overall: 0.91, label: "high" },
    validation: { issues: [] },
    sourceReferences: [
      {
        type: "project_fact",
        entityType: "lead",
        entityId: "LEAD-3001",
        label: "Inquiry from Lena & Chris",
        locator: "received 2 days ago",
      },
      {
        type: "package_fact",
        entityType: "package",
        entityId: "PKG-201",
        label: "Signature Wedding Collection",
        locator: "current price list",
      },
    ],
    downstreamCommand: { commandType: "sendApprovedDraft" },
    structuredOutput: {
      subject: "Your August 2027 wedding — availability and next steps",
      body:
        "Hi Lena and Chris,\n\nThank you for reaching out about your August 2027 " +
        "wedding at The Foundry. I do have that date open, and it would be a " +
        "genuine pleasure to photograph your day.\n\nMy Signature Wedding " +
        "Collection covers eight hours with two photographers and a hand-" +
        "finished album. I have attached the full details.\n\nWould a short call " +
        "this week suit you? I would love to hear how you are imagining the day.\n\n" +
        "Warmly,\nReese",
      recipientName: "Lena & Chris",
      recipientEmail: "lena.ortiz@example.test",
    },
    snoozedUntil: null,
    ageHours: 3,
  },
  {
    id: "AIA-4102",
    project: "Northstar Annual Summit",
    capability: "shot_list_request",
    title: "Request the final shot list from Northstar",
    status: "review_required",
    authorityBoundary: "advisory_only",
    confidence: { overall: 0.78, label: "medium" },
    validation: {
      issues: [
        {
          code: "MISSING_CONTACT_ROLE",
          severity: "advisory",
          message: "No on-site contact is recorded for the Pier 59 load-in.",
        },
      ],
    },
    sourceReferences: [
      {
        type: "questionnaire_answer",
        entityType: "questionnaireResponse",
        entityId: "QR-812",
        label: "Northstar event questionnaire",
        locator: "submitted, awaiting review",
      },
    ],
    downstreamCommand: { commandType: "sendApprovedDraft" },
    structuredOutput: {
      subject: "Northstar Summit — confirming your final shot list",
      body:
        "Hi Priya,\n\nWe are three weeks out from the Summit and I want to lock " +
        "the shot list so the team can plan coverage.\n\nCould you confirm the " +
        "keynote running order and whether the sponsor wall needs dedicated " +
        "coverage? Once I have that I will send the final run of show.\n\n" +
        "Best,\nReese",
      recipientName: "Priya Raman",
      recipientEmail: "priya.raman@example.test",
    },
    snoozedUntil: null,
    ageHours: 26,
  },
  {
    id: "AIA-4103",
    project: "Maya & Theo Johnson",
    capability: "run_of_show_draft",
    title: "Wedding-day run of show — 7 hours, two gaps flagged",
    status: "review_required",
    authorityBoundary: "advisory_only",
    confidence: { overall: 0.64, label: "medium" },
    validation: {
      issues: [
        {
          code: "TRAVEL_UNVERIFIED",
          severity: "advisory",
          message: "Travel time between the ceremony and The Foundry is estimated, not confirmed.",
        },
      ],
    },
    sourceReferences: [
      {
        type: "timing_rule",
        entityType: "timingRule",
        entityId: "TR-14",
        label: "Start two hours before ceremony",
        locator: "studio timing rules",
      },
      {
        type: "project_fact",
        entityType: "project",
        entityId: "PRJ-2048",
        label: "The Foundry, 2026-08-15",
        locator: "project record",
      },
    ],
    downstreamCommand: null,
    structuredOutput: {
      coverageStart: "14:00",
      coverageEnd: "21:00",
      itemCount: 11,
      assumptions: [
        "Getting-ready coverage begins at the hotel, not the venue.",
        "Travel between locations doubled per studio timing rules.",
      ],
      missingInformation: ["Confirmed sunset-portrait window"],
    },
    snoozedUntil: null,
    ageHours: 50,
  },
];

export const demoActionReceipts = [
  {
    id: "RCPT-9001",
    project: "Sofia & Miles Carter",
    title: "Event-day briefing sent to crew",
    summary: "Approved by you, then delivered to 3 crew members.",
    status: "completed",
    providerEvidence: "SendGrid message 8f21c4",
    canRetry: false,
    canCancel: false,
    ageHours: 6,
  },
  {
    id: "RCPT-9002",
    project: "Priya & Jordan",
    title: "Gallery delivery email sent",
    summary: "Approved by you. Client opened the gallery 2 hours later.",
    status: "completed",
    providerEvidence: "SendGrid message 3ba907",
    canRetry: false,
    canCancel: false,
    ageHours: 30,
  },
];

export const demoAutomationApprovals = [
  {
    id: "APR-5501",
    project: "Hudson Valley Athletics",
    actionType: "send_retainer_reminder",
    status: "pending",
    ageHours: 5,
  },
];

export const demoCommunicationDrafts = [
  {
    id: "CD-6601",
    project: "Maya & Theo Johnson",
    subject: "Final schedule for your wedding day",
    status: "needs_approval",
    recipient: "maya.johnson@example.test",
    body: "Hi Maya and Theo, here is the final run of show for the 15th.",
    ageHours: 4,
  },
  {
    id: "CD-6602",
    project: "Sofia & Miles Carter",
    subject: "Your gallery is ready",
    status: "approved_unsent",
    recipient: "sofia.carter@example.test",
    body: "Hi Sofia and Miles, your gallery is live and ready to share.",
    ageHours: 12,
  },
];

export const demoDeliveryDrafts = [
  {
    id: "DD-7701",
    project: "Priya & Jordan",
    status: "review_required",
    galleryUrl: "https://gallery.example.test/priya-jordan",
    ageHours: 9,
  },
];

export const demoBookingOrchestrations = [
  {
    id: "BO-8801",
    project: "Northstar Annual Summit",
    status: "active",
    currentStep: "awaiting_signature",
    ageHours: 2,
  },
  {
    id: "BO-8802",
    project: "Hudson Valley Athletics",
    status: "needs_attention",
    currentStep: "retainer_blocked",
    ageHours: 20,
  },
];

export const demoCrewCascades = [
  {
    id: "CC-9901",
    project: "Hudson Valley Athletics",
    role: "second_photographer",
    status: "active",
    candidateIndex: 2,
    candidateCount: 4,
    ageHours: 1,
  },
  {
    id: "CC-9902",
    project: "Northstar Annual Summit",
    role: "videographer",
    status: "exhausted",
    candidateIndex: 3,
    candidateCount: 3,
    ageHours: 40,
  },
];

/** `dueInDays` is negative for the overdue cases the exceptions bucket looks for. */
export const demoTasks = [
  {
    id: "TSK-1201",
    project: "Maya & Theo Johnson",
    title: "Confirm final headcount with The Foundry",
    status: "open",
    dueInDays: -3,
  },
  {
    id: "TSK-1202",
    project: "Hudson Valley Athletics",
    title: "Chase signed organization agreement",
    status: "in_progress",
    dueInDays: -1,
  },
  {
    id: "TSK-1203",
    project: "Northstar Annual Summit",
    title: "Book parking permits for the crew van",
    status: "open",
    dueInDays: 6,
  },
];
