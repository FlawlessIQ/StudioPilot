import { z } from "zod";

/**
 * Message Studio — deterministic core.
 *
 * A "message trigger" is a moment in the client lifecycle where the studio
 * would normally write an email by hand. Every trigger produces a DRAFT that
 * lands in the AI review queue; approval is always human. AI may personalize
 * wording; it never computes money, dates, or links — those arrive as
 * deterministic facts.
 */

export const messageTriggerSchema = z.enum([
  "inquiry_reply",
  "consultation_dates",
  "proposal_cover",
  "schedule_confirmation",
  "final_invoice_notice",
  "day_before_checklist",
  "delivery_note",
  "album_selection_reminder",
  "review_request",
]);
export type MessageTrigger = z.infer<typeof messageTriggerSchema>;

/** Which aiActions capability each trigger reports as. */
export const triggerCapability: Record<
  MessageTrigger,
  | "inquiry_reply_draft"
  | "proposal_draft"
  | "delivery_message_draft"
  | "review_request_draft"
> = {
  inquiry_reply: "inquiry_reply_draft",
  consultation_dates: "inquiry_reply_draft",
  proposal_cover: "proposal_draft",
  schedule_confirmation: "delivery_message_draft",
  final_invoice_notice: "delivery_message_draft",
  day_before_checklist: "delivery_message_draft",
  delivery_note: "delivery_message_draft",
  album_selection_reminder: "delivery_message_draft",
  review_request: "review_request_draft",
};

/** Structured output every message draft must satisfy. */
export const messageDraftOutputSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  recipientEmail: z.string().email().nullable(),
  recipientName: z.string().max(160).nullable(),
  highlights: z.array(z.string().max(300)).max(10).default([]),
  missingInformation: z.array(z.string().max(300)).max(10).default([]),
});
export type MessageDraftOutput = z.infer<typeof messageDraftOutputSchema>;

/**
 * Lifecycle timeline settings — stored on the tenant document under
 * `lifecycleMessaging`. Every entry defaults to enabled so a new studio gets
 * the full pack without configuration; each is a single toggle to switch off.
 */
export const lifecycleTriggerSettingSchema = z.object({
  enabled: z.boolean(),
  offsetDays: z.number().int().min(-365).max(0),
  /**
   * Trust dial. false = every draft waits for review (default). true = this
   * deterministic, template-rendered message may send without a per-message
   * approval — an explicit, owner-only, audited opt-in. AI-personalized
   * messages never auto-send regardless of this setting.
   */
  autoSend: z.boolean().default(false),
});

export const lifecycleMessagingSettingsSchema = z.object({
  schedule_confirmation: lifecycleTriggerSettingSchema,
  final_invoice_notice: lifecycleTriggerSettingSchema,
  day_before_checklist: lifecycleTriggerSettingSchema,
});
export type LifecycleMessagingSettings = z.infer<
  typeof lifecycleMessagingSettingsSchema
>;

/** Gabriel-calibrated defaults: confirm + invoice a month out, checklist the day before. */
export const defaultLifecycleMessagingSettings: LifecycleMessagingSettings = {
  schedule_confirmation: { enabled: true, offsetDays: -30, autoSend: false },
  final_invoice_notice: { enabled: true, offsetDays: -30, autoSend: false },
  day_before_checklist: { enabled: true, offsetDays: -1, autoSend: false },
};

export const lifecycleTriggers = Object.keys(
  defaultLifecycleMessagingSettings,
) as Array<keyof LifecycleMessagingSettings>;
