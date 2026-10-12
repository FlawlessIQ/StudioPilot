import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CLIENT_EMAIL_TYPES,
  portalLinkForJob,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";
import {
  chooseClientMembership,
  chooseClientProject,
  clientJobClosed,
  clientJobSwitcherItems,
  requestedProjectFrom,
  searchWithoutProject,
  unavailableJobNotice,
} from "@/features/client/job-choice";

/**
 * F13, 2026-10-12: Priya Shah had two jobs with Jess Styles Bridal — her
 * wedding and her Sangeet — and the portal opened whichever it remembered.
 * The Sangeet's "Read and sign" showed her the wedding agreement she had
 * already signed, and nothing said the Sangeet existed. Every client email
 * link now names its job, the portal opens it when the account holds it (and
 * never otherwise), and a client with more than one job can switch.
 */

const APP = "https://studio-cue.com";
const SANGEET = "job_sangeet";

// ── The link names its job ────────────────────────────────────────────────

test("a portal link names its job; nothing else is touched", () => {
  assert.equal(portalLinkForJob(`${APP}/client`, APP, SANGEET), `${APP}/client?project=${SANGEET}`);
  assert.equal(portalLinkForJob(`${APP}/client/contract`, APP, SANGEET), `${APP}/client/contract?project=${SANGEET}`);
  assert.equal(portalLinkForJob(`${APP}/client/payments?tab=due`, APP, SANGEET), `${APP}/client/payments?tab=due&project=${SANGEET}`);
  assert.equal(portalLinkForJob(`${APP}/client/messages#latest`, `${APP}/`, SANGEET), `${APP}/client/messages?project=${SANGEET}#latest`);
  // A link that already names a job keeps it.
  assert.equal(portalLinkForJob(`${APP}/client?project=job_wedding`, APP, SANGEET), `${APP}/client?project=job_wedding`);
  // An invitation, an inquiry page, the crew workspace, the studio's own
  // pages, another site, a lookalike path: exactly as they were.
  for (const url of [
    `${APP}/auth/client-invite?token=abc&next=%2Fclient%2Fcontract`,
    `${APP}/i/token123`,
    `${APP}/crew`,
    `${APP}/studio/projects/${SANGEET}`,
    `${APP}/clients`,
    "https://evil.example/client",
    "https://gallery.example.com/client/abc",
    "not a url",
    "",
  ])
    assert.equal(portalLinkForJob(url, APP, SANGEET), url, url);
  // Nothing to add without a job or an app address.
  assert.equal(portalLinkForJob(`${APP}/client`, APP, ""), `${APP}/client`);
  assert.equal(portalLinkForJob(`${APP}/client`, "", SANGEET), `${APP}/client`);
});

const brand = {
  studioName: "Jess Styles Bridal",
  productName: "StudioCue",
  accentColor: "#0f8a5e",
  logoUrl: null,
  contactEmail: "hello@example.com",
  postalAddress: null,
};

/** Every link in a rendered email, text and HTML both. */
function linksIn(email: { text: string; html: string }): string[] {
  const fromText = email.text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  const fromHtml = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
  return [...fromText, ...fromHtml].map((url) => url.replace(/[.,;:!?]+$/, ""));
}

test("every client email's portal links carry the job they are about", () => {
  const values = {
    appUrl: APP,
    portalUrl: `${APP}/client`,
    actionUrl: `${APP}/client/contract`,
    projectId: SANGEET,
    startsAt: "2027-01-01T15:00:00Z",
    amountCents: 75000,
    body: `A note from the studio. Your portal: ${APP}/client.`,
  };
  let portalLinks = 0;
  for (const key of CLIENT_EMAIL_TYPES) {
    const email = renderEmailTemplate({ key, brand, recipientName: "Priya Shah", projectName: "Priya Shah Sangeet", values });
    for (const url of linksIn(email).filter((link) => /^https:\/\/studio-cue\.com\/client(?:[/?#]|$)/.test(link))) {
      portalLinks += 1;
      assert.equal(new URL(url).searchParams.get("project"), SANGEET, `${key}: ${url}`);
    }
  }
  assert.ok(portalLinks >= CLIENT_EMAIL_TYPES.size, `only ${portalLinks} portal links across ${CLIENT_EMAIL_TYPES.size} client emails`);
});

test("a studio's own template words carry the job too, and other links are left alone", () => {
  const email = renderEmailTemplate({
    key: "contract_ready",
    brand,
    recipientName: "Priya Shah",
    projectName: "Priya Shah Sangeet",
    values: {
      appUrl: APP,
      portalUrl: `${APP}/client`,
      actionUrl: `${APP}/auth/client-invite?token=abc&next=%2Fclient%2Fcontract`,
      projectId: SANGEET,
    },
    template: {
      subject: "Your agreement",
      preheader: "Ready to sign",
      eyebrow: "Agreement",
      heading: "Ready to sign",
      paragraphs: ["Sign it in your portal ({{portalUrl}}), or read our FAQ at https://jessstyles.example/faq."],
      actionLabel: null,
      note: null,
      mode: "replace",
    },
  });
  assert.match(email.text, new RegExp(`${APP}/client\\?project=${SANGEET}\\)`));
  assert.match(email.text, /https:\/\/jessstyles\.example\/faq\./);
  // The invitation still goes where it was minted to go.
  assert.match(email.text, /\/auth\/client-invite\?token=abc&next=%2Fclient%2Fcontract/);
  assert.doesNotMatch(email.text, /client-invite[^\s]*project=/);
});

test("before a client has an account their links are unchanged", () => {
  const email = renderEmailTemplate({
    key: "proposal_sent",
    brand,
    recipientName: "Priya Shah",
    projectName: "Priya Shah Sangeet",
    values: { appUrl: APP, portalUrl: `${APP}/i/token123`, actionUrl: `${APP}/auth/client-invite?token=abc`, projectId: SANGEET },
  });
  assert.ok(linksIn(email).every((url) => !url.includes("project=")), linksIn(email).join("\n"));
});

// ── The portal honours it, only within the account ───────────────────────

test("the portal reads the job a link names, and nothing that isn't an id", () => {
  assert.equal(requestedProjectFrom(`?project=${SANGEET}`), SANGEET);
  assert.equal(requestedProjectFrom(new URLSearchParams({ project: "  abc-123_X " })), "abc-123_X");
  for (const search of ["", "?", "?project=", "?project=../../admin", "?project=a/b", `?project=${"x".repeat(161)}`, "?other=1", null, undefined])
    assert.equal(requestedProjectFrom(search), null, String(search));
  assert.equal(searchWithoutProject(`?project=${SANGEET}`), "");
  assert.equal(searchWithoutProject(`?tab=due&project=${SANGEET}`), "?tab=due");
  assert.equal(searchWithoutProject("?tab=due"), "?tab=due");
});

test("a link opens its job only when the account holds it", () => {
  const projects = [{ id: "job_wedding" }, { id: SANGEET }];
  // Priya's Sangeet link, once the Sangeet is on her account.
  assert.deepEqual(
    chooseClientProject({ projects, requestedProjectId: SANGEET, storedProjectId: "job_wedding" }),
    { projectId: SANGEET, requestedUnavailable: false },
  );
  // A link to a job that isn't hers: the job she'd have had anyway, and a note.
  assert.deepEqual(
    chooseClientProject({ projects, requestedProjectId: "job_someone_else", storedProjectId: SANGEET }),
    { projectId: SANGEET, requestedUnavailable: true },
  );
  assert.deepEqual(
    chooseClientProject({ projects, requestedProjectId: "job_someone_else", storedProjectId: "job_gone" }),
    { projectId: "job_wedding", requestedUnavailable: true },
  );
  // No link: the one she chose last, else the first.
  assert.deepEqual(
    chooseClientProject({ projects, requestedProjectId: null, storedProjectId: SANGEET }),
    { projectId: SANGEET, requestedUnavailable: false },
  );
  assert.deepEqual(
    chooseClientProject({ projects, requestedProjectId: null, storedProjectId: null }),
    { projectId: "job_wedding", requestedUnavailable: false },
  );
  assert.deepEqual(
    chooseClientProject({ projects: [], requestedProjectId: SANGEET, storedProjectId: null }),
    { projectId: null, requestedUnavailable: true },
  );
  assert.match(unavailableJobNotice("Priya Shah Wedding"), /can't open, so we've opened Priya Shah Wedding/);
  assert.match(unavailableJobNotice(null), /can't open\./);
});

test("a link picks the studio whose membership holds its job, never one the client lacks", () => {
  const permitted = [
    { tenantId: "tenant_a", projectIds: ["job_a"] },
    { tenantId: "tenant_jess", projectIds: ["job_wedding", SANGEET] },
  ];
  assert.equal(chooseClientMembership(permitted, "tenant_a", SANGEET)?.tenantId, "tenant_jess");
  assert.equal(chooseClientMembership(permitted, "tenant_a", "job_nobody")?.tenantId, "tenant_a");
  assert.equal(chooseClientMembership(permitted, null, null)?.tenantId, "tenant_a");
  assert.equal(chooseClientMembership(permitted, "tenant_jess", null)?.tenantId, "tenant_jess");
  assert.equal(chooseClientMembership([], "tenant_jess", SANGEET), undefined);
});

test("the server refuses a job the membership doesn't list, whatever the link said", () => {
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  const guard = route.slice(route.indexOf("async function requireClientMembership"), route.indexOf("function safeString"));
  assert.match(guard, /value\.status !== "active"/);
  assert.match(guard, /value\.role !== "client"/);
  assert.match(guard, /projectId \? !projectIds\.includes\(projectId\) : false/);
  assert.match(guard, /throw new Error\("PROJECT_ACCESS_DENIED"\)/);
});

test("the portal reads the link's job as it chooses, then takes it off the address", () => {
  const workspace = readFileSync("features/auth/workspace-context.tsx", "utf8");
  assert.match(workspace, /area === "client" \? requestedProjectFrom\(window\.location\.search\) : null/);
  assert.match(workspace, /chooseClientProject\(\{\s*projects: clientProjects,\s*requestedProjectId,/);
  assert.match(workspace, /if \(requestedProjectId\) forgetRequestedProject\(\);/);
  // Signed out, the link survives sign-in: the boundary keeps the query.
  assert.match(readFileSync("features/auth/auth-boundary.tsx", "utf8"), /const here = `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`;/);
});

// ── The switcher ─────────────────────────────────────────────────────────

test("one job: nothing new; two or more: all of them, soonest first, the open one marked", () => {
  const TODAY = "2026-10-12";
  const wedding = { id: "job_wedding", name: "Priya Shah Wedding", eventDate: "2027-03-20" };
  const sangeet = { id: SANGEET, name: "Priya Shah Sangeet", eventDate: "2026-10-12" };
  const trial = { id: "job_trial", name: "Hair trial", eventDate: null };
  assert.equal(clientJobSwitcherItems([], null, TODAY), null);
  assert.equal(clientJobSwitcherItems([wedding], wedding.id, TODAY), null);
  assert.equal(clientJobSwitcherItems([wedding, wedding], wedding.id, TODAY), null);
  assert.deepEqual(clientJobSwitcherItems([wedding, trial, sangeet], SANGEET, TODAY), [
    { ...sangeet, active: true },
    { ...wedding, active: false },
    { ...trial, active: false },
  ]);
  // Exactly one marked, and none when the open job isn't in the list.
  assert.equal(clientJobSwitcherItems([wedding, sangeet], wedding.id, TODAY)!.filter((item) => item.active).length, 1);
  assert.equal(clientJobSwitcherItems([wedding, sangeet], "job_other", TODAY)!.filter((item) => item.active).length, 0);
});

test("a returning client sees the job ahead of them before the one they finished", () => {
  const TODAY = "2026-10-12";
  // Last year's wedding, done; this year's Sangeet, the reason she's here.
  const lastWedding = { id: "job_2025_wedding", name: "Priya Shah Wedding", eventDate: "2025-06-01" };
  const anniversary = { id: "job_2024_shoot", name: "Engagement shoot", eventDate: "2024-09-14" };
  const sangeet = { id: SANGEET, name: "Priya Shah Sangeet", eventDate: "2026-11-01" };
  const reception = { id: "job_reception", name: "Reception", eventDate: "2027-02-01" };
  const undated = { id: "job_undated", name: "Family portraits", eventDate: null };
  const order = (items: ReturnType<typeof clientJobSwitcherItems>) => items!.map((item) => item.id);
  // Still to come, soonest first; then not yet dated; then past, most recent first.
  assert.deepEqual(order(clientJobSwitcherItems([anniversary, lastWedding, undated, reception, sangeet], lastWedding.id, TODAY)), [
    SANGEET,
    "job_reception",
    "job_undated",
    "job_2025_wedding",
    "job_2024_shoot",
  ]);
  // Today counts as still to come.
  assert.deepEqual(order(clientJobSwitcherItems([lastWedding, { ...sangeet, eventDate: TODAY }], null, TODAY)), [SANGEET, "job_2025_wedding"]);
  // Without a date given, the device's own.
  assert.deepEqual(order(clientJobSwitcherItems([lastWedding, { ...sangeet, eventDate: "2999-01-01" }], null)), [SANGEET, "job_2025_wedding"]);
});

test("a job that is over isn't listed beside the live ones, nor opened over them", () => {
  const TODAY = "2026-10-12";
  const wedding = { id: "job_wedding", name: "Priya Shah Wedding", eventDate: "2027-03-20" };
  // A job someone else's form made in her name, declined by the studio.
  const declined = { id: "job_declined", name: "Priya Shah Birthday", eventDate: "2026-12-01", closed: true };
  // Two jobs, one closed: one live job, so nothing new.
  assert.equal(clientJobSwitcherItems([wedding, declined], wedding.id, TODAY), null);
  const sangeet = { id: SANGEET, name: "Priya Shah Sangeet", eventDate: "2026-11-01" };
  assert.deepEqual(
    clientJobSwitcherItems([wedding, declined, sangeet], wedding.id, TODAY)!.map((item) => item.id),
    [SANGEET, "job_wedding"],
  );
  // Open by a link, it is shown, marked, so she can leave it.
  assert.deepEqual(
    clientJobSwitcherItems([wedding, declined], declined.id, TODAY)!.map((item) => [item.id, item.active]),
    [["job_declined", true], ["job_wedding", false]],
  );
  // Without a link, a live job opens before a closed one — even one she last chose.
  const projects = [declined, wedding];
  assert.deepEqual(chooseClientProject({ projects, requestedProjectId: null, storedProjectId: null }), {
    projectId: "job_wedding",
    requestedUnavailable: false,
  });
  assert.deepEqual(chooseClientProject({ projects, requestedProjectId: null, storedProjectId: "job_declined" }), {
    projectId: "job_wedding",
    requestedUnavailable: false,
  });
  // A link still opens it; and when it is all she has, it opens.
  assert.equal(chooseClientProject({ projects, requestedProjectId: "job_declined", storedProjectId: null }).projectId, "job_declined");
  assert.equal(chooseClientProject({ projects: [declined], requestedProjectId: null, storedProjectId: null }).projectId, "job_declined");

  // What "over" means, and where the server says it.
  assert.equal(clientJobClosed({ state: "LOST" }), true);
  assert.equal(clientJobClosed({ state: "ARCHIVED" }), true);
  assert.equal(clientJobClosed({ state: "BOOKED", archivedAt: "2026-10-12T00:00:00Z" }), true);
  for (const state of ["LEAD", "BOOKED", "CLOSED", "CANCELLED", "POSTPONED"])
    assert.equal(clientJobClosed({ state, archivedAt: null }), false, state);
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  const list = route.slice(route.indexOf("async function clientProjects("), route.indexOf("async function availablePackages("));
  assert.match(list, /closed: clientJobClosed\(\{ state, archivedAt: snapshot\.get\("archivedAt"\) \}\),/);
  // And a job not going ahead says so, rather than "In progress".
  assert.match(readFileSync("server/client/portal-experience.ts", "utf8"), /LOST: "Not going ahead",/);
});

test("the switcher sits in the client shell, and remembers the choice", () => {
  const shell = readFileSync("components/layout/portal-shell.tsx", "utf8");
  assert.match(shell, /<ClientJobSwitcher \/>/);
  assert.match(shell, /<ClientJobNotice \/>/);
  const switcher = readFileSync("components/client/kit/client-job-switcher.tsx", "utf8");
  assert.match(switcher, /clientJobSwitcherItems\(workspace\.clientProjects, workspace\.projectId\)/);
  assert.match(switcher, /if \(!items\) return null;/);
  assert.match(switcher, /workspace\.selectProject\(projectId\)/);
  const workspace = readFileSync("features/auth/workspace-context.tsx", "utf8");
  const select = workspace.slice(workspace.indexOf("const selectProject"));
  assert.match(select, /writeStored\(`studiohub\.activeClientProjectId\.\$\{state\.tenantId\}`, projectId\)/);
  // Wraps, never squeezes (CLAUDE.md, UI layout).
  const css = readFileSync("app/kit.css", "utf8");
  assert.match(css, /\.kit-job-switcher-menu > summary \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.kit-job-switcher-list \.kit-row \{[^}]*flex-wrap: wrap;/);
});
