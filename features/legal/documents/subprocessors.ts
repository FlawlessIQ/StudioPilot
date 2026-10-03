import type { LegalDocument, LegalBlock } from "../document-types";
import { CONNECTED_SERVICES, CORE_SUBPROCESSORS, LEGAL_ENTITY, SUBPROCESSORS_EFFECTIVE, SUBPROCESSORS_VERSION, type Subprocessor } from "../legal";

const table = (entries: readonly Subprocessor[]): LegalBlock => ({
  table: {
    head: ["Provider", "Service", "Purpose", "Data", "Location"],
    rows: entries.map((entry) => [entry.name, entry.service, entry.purpose, entry.data, entry.location]),
  },
});

export const SUBPROCESSORS: LegalDocument = {
  slug: "subprocessors",
  path: "/subprocessors",
  title: "Subprocessors",
  description: "The service providers that process data for StudioCue, what each does, and where.",
  version: SUBPROCESSORS_VERSION,
  effective: SUBPROCESSORS_EFFECTIVE,
  intro: [
    `${LEGAL_ENTITY.name} uses the service providers below to operate StudioCue. Each receives only the information it needs to perform its service, under a written agreement that requires it to protect that information. As described in our [Data Processing Addendum](/legal/dpa), we update this page at least 15 days before a new subprocessor begins processing Client Data.`,
  ],
  sections: [
    { id: "core", title: "1. Subprocessors used for every Studio", blocks: [table(CORE_SUBPROCESSORS)] },
    {
      id: "connected",
      title: "2. Services a Studio chooses to connect",
      blocks: [
        { p: "These services receive information only if a Studio connects them, and stop receiving it when the Studio disconnects them. They are engaged by the Studio rather than by StudioCue, and are listed here for transparency." },
        table(CONNECTED_SERVICES),
      ],
    },
    {
      id: "updates",
      title: "3. Updates",
      blocks: [
        { p: `To object to a new subprocessor, or for questions, email [${LEGAL_ENTITY.email}](mailto:${LEGAL_ENTITY.email}).` },
      ],
    },
  ],
};
