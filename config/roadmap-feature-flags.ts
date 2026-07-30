import { z } from "zod";

export const roadmapFeatureKeySchema = z.enum([
  "studio_import_foundation",
  "studio_import_processing",
  "studio_import_activation",
  "project_lifecycle_cockpit",
  "ai_approval_queue",
  "inquiry_booking_autopilot",
  "planning_intelligence",
  "crew_offer_cascade",
  "client_delivery_hub",
  "pilot_release_evidence",
]);

export type RoadmapFeatureKey = z.infer<typeof roadmapFeatureKeySchema>;

export type RoadmapFeatureDefinition = {
  key: RoadmapFeatureKey;
  release: number;
  label: string;
  description: string;
  defaultEnabled: boolean;
  ownerOnly: boolean;
};

export const roadmapFeatureRegistry: readonly RoadmapFeatureDefinition[] = [
  {
    key: "studio_import_foundation",
    release: 0,
    label: "Studio import foundation",
    description: "Shared file policy, import contracts, AI records, and measurement.",
    defaultEnabled: true,
    ownerOnly: true,
  },
  {
    key: "studio_import_processing",
    release: 1,
    label: "Studio import processing",
    description: "Secure upload, file safety, classification, and extraction.",
    defaultEnabled: true,
    ownerOnly: true,
  },
  {
    key: "studio_import_activation",
    release: 1,
    label: "Studio import activation",
    description: "Review, approve, activate, and roll back imported studio assets.",
    defaultEnabled: true,
    ownerOnly: true,
  },
  {
    key: "project_lifecycle_cockpit",
    release: 2,
    label: "Project lifecycle cockpit",
    description: "Project-first operation across inquiry, booking, planning, event, and delivery.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "ai_approval_queue",
    release: 2,
    label: "AI approval queue",
    description: "Prepared, cited AI work with approval and deterministic execution.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "inquiry_booking_autopilot",
    release: 3,
    label: "Inquiry and booking autopilot",
    description: "Inquiry, consultation, proposal, contract, and retainer preparation.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "planning_intelligence",
    release: 4,
    label: "Planning intelligence",
    description: "Questionnaire review, timing rules, schedule drafts, invoice, and COI assistance.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "crew_offer_cascade",
    release: 5,
    label: "Crew offer cascade",
    description: "Ranked, expiring crew offers with deterministic assignment.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "client_delivery_hub",
    release: 6,
    label: "Client delivery hub",
    description: "Persistent artifacts, gallery, album, review, and closeout workflow.",
    defaultEnabled: true,
    ownerOnly: false,
  },
  {
    key: "pilot_release_evidence",
    release: 7,
    label: "Pilot release evidence",
    description:
      "Measured value, AI quality, authority, reliability, incident, staffing, and provider launch gates.",
    defaultEnabled: true,
    ownerOnly: true,
  },
] as const;

export function roadmapFeatureDefaults(): Readonly<
  Record<RoadmapFeatureKey, boolean>
> {
  return Object.fromEntries(
    roadmapFeatureRegistry.map((feature) => [
      feature.key,
      feature.defaultEnabled,
    ]),
  ) as Record<RoadmapFeatureKey, boolean>;
}
