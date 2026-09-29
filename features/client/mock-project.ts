import type { ClientPortalProject } from "@/lib/client/portal-client";

/**
 * The couple's project in mock mode, so every client screen can be walked and
 * tested without Firebase (Home only ever showed "Project details will
 * appear after assignment" before). It matches the mock proposal in
 * components/client/live-client-views.tsx: a proposal waiting for review.
 */
export const MOCK_CLIENT_PROJECT: ClientPortalProject = {
  id: "demo-project",
  name: "Harper & Devin",
  eventType: "wedding",
  eventDate: "2027-05-15",
  timezone: "America/New_York",
  venueName: "Oak Hill Barn",
  city: "Hudson, NY",
  leadPhotographerName: "Conor",
  clientStage: "proposal",
  clientProgress: 25,
  clientCheckpointCount: 8,
  nextClientAction: {
    name: "Review your proposal",
    description: "Look through the Signature Collection, then accept it or ask for changes.",
    dueDate: null,
    ownerType: "client",
    responsibility: "client",
    href: "/client/proposal",
    actionLabel: "Review proposal",
  },
  navigation: {
    proposal: true,
    package: false,
    contract: true,
    payments: true,
    questionnaire: true,
    schedule: true,
    files: true,
    delivery: true,
    reviews: true,
  },
  milestones: [
    { id: "inquiry", label: "Inquiry", description: "You got in touch.", status: "complete" },
    { id: "consultation", label: "Consultation", description: "You talked it through.", status: "complete" },
    { id: "proposal", label: "Proposal", description: "Review your package and price.", status: "current" },
    { id: "agreement", label: "Agreement & retainer", description: "Sign and pay the retainer to secure your date.", status: "upcoming" },
    { id: "planning", label: "Planning", description: "Your details form and timeline.", status: "upcoming" },
    { id: "wedding", label: "Wedding day", description: "May 15, 2027.", status: "upcoming" },
    { id: "delivery", label: "Photos & film", description: "About six weeks after the day.", status: "upcoming" },
  ],
  checkpoints: [],
};
