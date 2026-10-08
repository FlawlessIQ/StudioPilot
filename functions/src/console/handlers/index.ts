import type { ConsoleHandler } from "../command-kit.js";
import { billingHandlers } from "./billing.js";
import { codeHandlers } from "./codes.js";
import { leadHandlers } from "./leads.js";
import { crmHandlers } from "./crm.js";
import { inboxHandlers } from "./inbox.js";
import { featureHandlers } from "./features.js";
import { operationsHandlers } from "./operations.js";
import { peopleHandlers } from "./people.js";
import { settingsHandlers } from "./settings.js";
import { studioHandlers } from "./studios.js";
import { supportHandlers } from "./support.js";

/** Every Console command, by its `type`. saasAdminCommand dispatches here. */
export const consoleHandlers: Record<string, ConsoleHandler> = {
  ...studioHandlers,
  ...crmHandlers,
  ...peopleHandlers,
  ...billingHandlers,
  ...codeHandlers,
  ...leadHandlers,
  ...inboxHandlers,
  ...supportHandlers,
  ...operationsHandlers,
  ...featureHandlers,
  ...settingsHandlers,
};
