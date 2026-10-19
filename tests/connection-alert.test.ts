import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { todayInbox } from "@/features/today/inbox";
import { CONNECTION_CONSEQUENCES } from "@/features/integrations/connection-consequence";
import { CONNECTION_CONSEQUENCES as SERVER_CONSEQUENCES } from "../functions/src/integrations/connection-alert";

/**
 * A broken connection is told, not just shown. FlawlessIQ's Google Calendar
 * stopped accepting StudioCue's sign-in on Oct 12 and nothing said so until a
 * test found it on Oct 15.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("the studio and the server say the same thing about what stops", () => {
  assert.deepEqual(SERVER_CONSEQUENCES, CONNECTION_CONSEQUENCES);
});

test("the studio is emailed once, at the moment the connection is marked broken", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /await document\.ref\.update\(\{status:"error",lastError:code,updatedAt:brokenAt\}\);\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await queueConnectionBrokenAlert\(/);
  assert.match(read("functions/src/saas/billing-hold.ts"), /"studio_connection_broken",/);
});

test("Today's card says what has stopped, not that automation is paused", () => {
  const inbox = todayInbox({
    now: "2026-10-19T12:00:00.000Z",
    integrationConnections: [{ id: "t1_google_calendar", tenantId: "t1", provider: "google_calendar", status: "error", lastError: "GOOGLE_CALENDAR_REAUTH_REQUIRED" }],
  } as unknown as Parameters<typeof todayInbox>[0]);
  const card = inbox.act.find((item) => item.id === "connection-t1_google_calendar");
  assert.equal(card?.title, "Reconnect Google Calendar");
  assert.match(card?.detail ?? "", /won't go on your calendar/);
});
