import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * What Claude's local UAT run found on 2026-09-29: the StudioCue Mobile UAT
 * plan played against the real app and real Cloud Functions in the emulator,
 * on iPhone WebKit and Android Chrome. Each of these passed every earlier
 * suite, because mock mode and the fixtures didn't reach them.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("the inquiry's event type starts as the Wedding the chips show", () => {
  // The chip showed Wedding chosen while the value was empty, so Continue on
  // step 2 silently refused anyone who didn't tap a type.
  const form = read("components/crm/lead-intake-form.tsx");
  assert.match(form, /<input defaultValue="wedding" type="hidden" \{\.\.\.register\("eventType"\)\} \/>/);
  assert.match(form, /errors\.eventType \?/);
});

test("live mode never starts with the demo records", () => {
  // A real couple saw "Highlight film · RIVERA27" flash before their delivery.
  const views = read("components/client/live-client-views.tsx");
  assert.match(views, /value: dataIsLive \? \[\] : mockClientRecords\(collectionName\)/);
  assert.match(views, /value: dataIsLive \? null : MOCK_CLIENT_PROJECT/);
});

test("crew can answer an offer from inside the app", () => {
  // Membership gains the project on acceptance, so the project check refused
  // an in-app Accept as FORBIDDEN.
  const commands = read("functions/src/crew/commands.ts");
  assert.match(commands, /!hasProject\(parsed\.input\.projectId\) &&\s*parsed\.type !== "respondAssignment"/);
  assert.match(commands, /projectIds: FieldValue\.arrayUnion\(parsed\.input\.projectId\)/);
  // And still only their own offer.
  assert.match(commands, /if \(!internal && !ownsAssignment\) throw new Error\("FORBIDDEN"\)/);
});

test("the day sheet opens with no signal", () => {
  const boundary = read("features/auth/auth-boundary.tsx");
  assert.match(boundary, /area !== "studio" && area !== "platform" && user && rememberedAccess\(area, user\.uid\)/);
  // The marker is swept on sign-out with everything else.
  assert.match(boundary, /`studiocue:access:\$\{area\}:\$\{uid\}`/);
  const sheet = read("components/crew/kit/crew-day-sheet.tsx");
  assert.match(sheet, /const prefix = `studiocue:crew-event-brief:\$\{uid\}:`;/);
});

test("signing out returns a couple or crew member to their own sign-in page", () => {
  const boundary = read("features/auth/auth-boundary.tsx");
  assert.match(boundary, /router\.push\(area \? `\/auth\/login\?next=\$\{encodeURIComponent\(area\)\}` : "\/auth\/login"\)/);
});

test("the loading screen doesn't tell a couple they're opening a studio", () => {
  const boundary = read("features/auth/auth-boundary.tsx");
  assert.match(boundary, /area === "client" \? "Opening your wedding"/);
});

test("a multi-select question is chips, not a text box", () => {
  const form = read("components/client/kit/client-questionnaire.tsx");
  assert.match(form, /field\.type === "multi_select" && field\.options\.length/);
});

test("a proposal refusal is named, not 'could not be saved'", () => {
  const proposal = read("components/client/kit/client-proposal.tsx");
  assert.match(proposal, /const specific = proposalErrorMessage\(code\);/);
});

test("no signal never sends anyone to 'Create your workspace'", () => {
  // Offline, Firestore answered "no memberships" from its cache.
  const boundary = read("features/auth/auth-boundary.tsx");
  assert.match(boundary, /if \(!roles\.length\) throw new Error\("MEMBERSHIPS_UNCONFIRMED"\);/);
  const crew = read("components/crew/kit/crew-data.tsx");
  assert.match(crew, /if \(assignmentSnapshot\.metadata\.fromCache\) throw new Error/);
});

test("a crew refresh after a save keeps the screen", () => {
  const crew = read("components/crew/kit/crew-data.tsx");
  assert.match(crew, /current\.loading \|\| \(!current\.error && \(current\.profile \|\| current\.assignments\.length\)\)/);
});

test("the photo and file buttons stack instead of wrapping", () => {
  const css = read("app/kit.css");
  const rule = css.slice(css.indexOf(".kit-send-row {"), css.indexOf("}", css.indexOf(".kit-send-row {")));
  assert.match(rule, /flex-direction: column/);
});

test("a brand-new studio still reaches onboarding after the server confirms", () => {
  const boundary = read("features/auth/auth-boundary.tsx");
  assert.match(boundary, /confirmation\.message === "NO_ACTIVE_WORKSPACE"\) roles = \[\];/);
});
