import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deliverableDueDate,
  deliveryProgress,
  expectedDeliverables,
  releaseHeadline,
  releasedKind,
} from "../features/post-event/deliverables.ts";
import { releaseItems } from "../functions/src/post-event/release.ts";
import {
  classifyAnnouncement,
  followTrackedLink,
  isOpaqueTracker,
  parseInboundGalleryAnnouncement,
} from "../functions/src/post-event/inbound.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * H4 — post-wedding delivery, photo and video (docs/delivery-plan-2026-09-28.md).
 */
const read = (path: string) => readFileSync(path, "utf8");
const body = (path: string) => {
  const source = read(path);
  return source.slice(source.indexOf("*/\n") + 3);
};

test("the functions copies of the delivery rules match the app's", () => {
  assert.equal(body("functions/src/post-event/deliverables.ts"), body("features/post-event/deliverables.ts"));
  assert.equal(body("functions/src/post-event/link-host.ts"), body("features/post-event/link-host.ts"));
});

test("a job expects what its package covers: a gallery, a film, or both", () => {
  const kinds = (input: Parameters<typeof expectedDeliverables>[0]) => expectedDeliverables(input).map((item) => item.kind);
  assert.deepEqual(kinds({ coverage: null }), ["gallery"]);
  assert.deepEqual(kinds({ coverage: { photographers: 2, videographers: 0 } }), ["gallery"]);
  assert.deepEqual(kinds({ coverage: { photographers: 1, videographers: 1 } }), ["gallery", "highlight_film"]);
  assert.deepEqual(kinds({ coverage: { photographers: 0, videographers: 2 } }), ["highlight_film"]);
  assert.deepEqual(
    kinds({ coverage: { photographers: 1, videographers: 1 }, includedDeliverables: ["Sneak peek in a week", "Full-length film"] }),
    ["sneak_peek", "gallery", "highlight_film", "full_film"],
  );
  // What the studio set wins over what is implied.
  assert.deepEqual(
    kinds({
      coverage: { photographers: 1, videographers: 1 },
      deliverables: [{ kind: "full_film", label: "Documentary edit", turnaroundDays: 120, final: true }],
    }),
    ["full_film"],
  );
});

test("a job is delivered when every final deliverable has gone out, not on the first", () => {
  const expected = expectedDeliverables({ coverage: { photographers: 1, videographers: 1 }, includedDeliverables: ["sneak peek"] });
  const photos = deliveryProgress(expected, [{ kind: "gallery", status: "sent" }]);
  assert.equal(photos.complete, false);
  assert.deepEqual(photos.outstanding.filter((item) => item.final).map((item) => item.kind), ["highlight_film"]);
  // A sneak peek is not final: it neither completes nor is owed.
  assert.equal(deliveryProgress(expected, [{ kind: "sneak_peek", status: "sent" }]).complete, false);
  assert.equal(
    deliveryProgress(expected, [
      { kind: "gallery", status: "sent" },
      { kind: "highlight_film", status: "viewed" },
    ]).complete,
    true,
  );
  // A revoked release doesn't count.
  assert.equal(deliveryProgress(expectedDeliverables({ coverage: null }), [{ kind: "gallery", status: "revoked" }]).complete, false);
});

test("a delivery from before kinds reads as a gallery, or a film if it was video", () => {
  assert.equal(releasedKind({ provider: "pixieset" }), "gallery");
  assert.equal(releasedKind({ mediaType: "video" }), "highlight_film");
  assert.equal(releasedKind({ kind: "film" }), "highlight_film");
});

test("each deliverable is due by the package's turnaround, not 42 days for everything", () => {
  const [gallery, film] = expectedDeliverables({ coverage: { photographers: 1, videographers: 1 } });
  assert.equal(deliverableDueDate("2027-06-12", gallery!), "2027-07-24");
  assert.equal(deliverableDueDate("2027-06-12", film!), "2027-08-11");
  assert.equal(deliverableDueDate(null, gallery!), null);
});

test("the email says what went out", () => {
  assert.equal(releaseHeadline([{ mediaType: "photo", kind: "gallery" }]).heading, "Your photographs are ready");
  assert.equal(releaseHeadline([{ mediaType: "video", kind: "highlight_film" }]).heading, "Your film is ready");
  assert.equal(
    releaseHeadline([
      { mediaType: "photo", kind: "gallery" },
      { mediaType: "video", kind: "highlight_film" },
    ]).heading,
    "Your photos and film are ready",
  );
  assert.equal(releaseHeadline([{ mediaType: "photo", kind: "sneak_peek" }]).heading, "A sneak peek is ready");
});

test("a photos-and-film email has a button for each, the code for each, and the studio's own line", () => {
  const rendered = renderEmailTemplate({
    key: "delivery",
    brand: { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Harper Lane",
    projectName: "Harper Lane wedding",
    values: {
      items: [
        { mediaType: "photo", kind: "gallery", label: "Photo gallery", openUrl: "https://studio-cue.com/d/aaaaaaaaaaaaaaaaaaaa", accessCode: "4411", expirationDate: "2027-12-01" },
        { mediaType: "video", kind: "highlight_film", label: "Highlight film", openUrl: "https://studio-cue.com/d/bbbbbbbbbbbbbbbbbbbb", accessCode: "vows", expirationDate: null },
      ],
      note: "It was a joy to be part of your day.",
      timezone: "America/New_York",
    },
  });
  assert.match(rendered.subject, /^Your photos and film are ready — FlawlessIQ$/);
  assert.match(rendered.text, /Open your photographs: https:\/\/studio-cue\.com\/d\/aaaa/);
  assert.match(rendered.text, /Watch your highlight film: https:\/\/studio-cue\.com\/d\/bbbb/);
  assert.match(rendered.text, /Photo gallery access code: 4411/);
  assert.match(rendered.text, /Highlight film password: vows/);
  assert.match(rendered.text, /It was a joy to be part of your day\./);
  assert.doesNotMatch(rendered.subject, /photographs are ready/);
});

test("a film with no password reads as the couple's, not the job's (walked 2026-09-29)", () => {
  const rendered = renderEmailTemplate({
    key: "delivery",
    brand: { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Delivery Walk Test",
    projectName: "Delivery Walk Test",
    values: {
      items: [{ mediaType: "video", kind: "highlight_film", label: "Highlight film", openUrl: "https://studio-cue.com/d/cccccccccccccccccccc", accessCode: null, expirationDate: null }],
      timezone: "America/New_York",
    },
  });
  // It said "We've finished this for Delivery Walk Test. Keep any password private."
  assert.doesNotMatch(rendered.text, /finished this for/);
  assert.doesNotMatch(rendered.text, /password/i);
  assert.match(rendered.text, /opens it in your browser/);
  // The studio's preview promises the same line.
  const preview = readFileSync("components/post-event/delivery-form.tsx", "utf8");
  assert.ok(preview.includes("It's ready whenever you are — the button below opens it in your browser."));
  assert.ok(!preview.includes("opens in their browser"));
});

test("an email queued before items still sends its one gallery", () => {
  const rendered = renderEmailTemplate({
    key: "delivery",
    brand: { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    values: { galleryUrl: "https://gallery.pixieset.com/x", accessCode: "1234" },
  });
  assert.match(rendered.subject, /Your photographs are ready/);
  assert.match(rendered.text, /Open your photographs: https:\/\/gallery\.pixieset\.com\/x/);
});

test("the inbox knows a film from a gallery, and a sneak peek from both", () => {
  assert.equal(classifyAnnouncement("Your highlight film is ready to watch", "video"), "highlight_film");
  assert.equal(classifyAnnouncement("Here is the full film from the day", "video"), "full_film");
  assert.equal(classifyAnnouncement("A sneak peek from Saturday!", "photo"), "sneak_peek");
  assert.equal(classifyAnnouncement("Your gallery is live", "photo"), "gallery");
  const parsed = parseInboundGalleryAnnouncement(
    "Your film is ready https://vimeo.com/123456 Password: vows2027",
  );
  assert.equal(parsed.provider, "vimeo");
  assert.equal(parsed.mediaType, "video");
  assert.equal(parsed.kind, "highlight_film");
});

test("a tracking redirect is followed to the gallery it hides", async () => {
  const tracked = "https://url5544.studio-cue.com/ls/click?upn=abc";
  assert.equal(isOpaqueTracker(tracked), true);
  assert.equal(isOpaqueTracker("https://gallery.pixieset.com/x"), false);
  const hops: Record<string, string> = {
    [tracked]: "https://click.example.com/r/2",
    "https://click.example.com/r/2": "https://vimeo.com/987",
  };
  const fakeFetch = (async (url: string) =>
    new Response(null, { status: 302, headers: hops[url] ? { location: hops[url]! } : {} })) as unknown as typeof fetch;
  assert.equal(await followTrackedLink(tracked, fakeFetch), "https://vimeo.com/987");
});

test("an older client's one-link release still reads as one item", () => {
  const items = releaseItems({
    projectId: "p1",
    galleryUrl: "https://vimeo.com/1",
    accessCode: "x",
    expirationDate: null,
    deliveryDraftId: null,
    deliveryDate: "2027-07-01",
    notes: null,
    messageToCouple: null,
    reviewDestinationUrl: "https://g.page/r/x",
    reviewDestinationLabel: "google",
    albumIncluded: false,
    albumInstructionsUrl: null,
    saveStudioDefaults: false,
    completeDelivery: false,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, "highlight_film");
});

test("release is repeatable, gated on the backup only, with follow-ups once per job", () => {
  const release = read("functions/src/post-event/release.ts");
  assert.match(release, /const RELEASABLE_STATES = \["POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"\];/);
  assert.match(release, /steps\.backup_complete\?\.complete !== true/);
  assert.doesNotMatch(release, /editing_complete\?\.complete !== true/);
  // Keyed by the project, so a second delivery never schedules them again.
  assert.match(release, /reviewRequests\/review_\$\{input\.projectId\}_\$\{sequence\}/);
  assert.match(release, /albumWorkflows\/album_\$\{input\.projectId\}/);
  assert.match(release, /const becomesDelivered = state === "POST_PRODUCTION" && \(after\.complete \|\| input\.completeDelivery\);/);
  // Dated from the moment of delivery, not a backdated delivery date (D3).
  assert.match(release, /const start = Date\.parse\(input\.now\);/);
});

test("the couple's links record that they opened them, and go nowhere else", () => {
  const route = read("app/d/[token]/route.ts");
  assert.match(route, /\.where\("viewToken", "==", token\)/);
  assert.match(route, /return Response\.redirect\(target, 302\);/);
  assert.match(route, /request\.headers\.get\("sec-fetch-mode"\) === "navigate"/);
  assert.match(read("app/api/client/portal/route.ts"), /sanitized\.openUrl = `\/d\/\$\{value\.viewToken\}`;/);
});

test("the first review ask moves the job on, and doesn't assume photography", () => {
  const jobs = read("functions/src/post-event/jobs.ts");
  assert.match(jobs, /project\.get\("state"\) === "DELIVERED"\) \{\s*transaction\.update\(projectReference, \{\s*state: "REVIEW_REQUESTED",/);
  assert.doesNotMatch(jobs, /How was your photography experience\?/);
});

test("the inbox address stays until the job is filed away", () => {
  assert.match(
    read("components/post-event/post-production-checklist.tsx"),
    /inboxAddress && steps\.project_archived\?\.complete !== true/,
  );
});
