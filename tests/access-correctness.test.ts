import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

// ── Invited people are not sent to "Create your workspace" ──

test("onboarding asks for waiting invitations before offering to create a studio", () => {
  const form = read("features/auth/onboarding-form.tsx");
  assert.match(form, /const waiting = await pendingInvitations\(auth\);/);
  // Asked on arrival and again once a fresh email is verified on the wall.
  assert.equal(form.match(/await pendingInvitations\(auth\)/g)?.length, 2);
  assert.match(form, /setPhase\("invited"\)/);
  assert.match(form, /set up my own studio/);
});

test("the invitation lookup answers only a verified email and accepts nothing", () => {
  const route = read("app/api/auth/pending-invitations/route.ts");
  assert.match(route, /identity\.email_verified !== true/);
  assert.match(route, /verifyIdToken\(token, true\)/);
  for (const collection of ["clientInvitations", "tenantInvitations", "crewProfiles"]) {
    assert.match(route, new RegExp(`collection\\("${collection}"\\)`), collection);
  }
  assert.doesNotMatch(route, /\.(update|set|create)\(/, "joining still takes the invitation link");
});

// ── Crew threads ──

test("both crew-message queries name the job, so the rules can check the assignment", () => {
  for (const file of ["components/studio/live-record-detail.tsx", "components/crew/kit/crew-parts.tsx"]) {
    const source = read(file);
    const query = source.slice(source.indexOf('collection(getFirebaseClient().firestore, "crewMessages")'));
    assert.match(query.slice(0, 600), /where\("projectId", "==", String\(assignment\.projectId \?\? ""\)\)/, file);
  }
  // The rule the query has to satisfy.
  assert.match(read("firestore.rules"), /match \/crewMessages\/\{messageId\}[\s\S]{0,400}isAssignedToProject\(resource\.data\.tenantId, resource\.data\.projectId\)/);
});

// ── Studio records ──

test("records are filtered by job in the query, not after a 250-record cut", () => {
  const route = read("app/api/studio/records/route.ts");
  assert.match(route, /tenantRecords\.where\("projectId", "==", input\.projectId\)\.limit\(250\)/);
  assert.match(route, /tenantRecords\.where\("projectIds", "array-contains", input\.projectId\)\.limit\(250\)/);
  assert.doesNotMatch(route, /record\.projectId === input\.projectId/, "no filtering after the limit");
  assert.match(route, /accessAllowsViewing\(subscriptionAccess\(subscription\.data\(\)\)\)/);
});
