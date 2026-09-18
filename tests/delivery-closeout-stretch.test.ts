import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emailTemplateKeys,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";
import { parseGalleryAnnouncement } from "../features/post-event/gallery-announcement";
import { calendarDate } from "../features/format/calendar-date";
import { closeoutPendingNote } from "../features/post-event/closeout-attestation";

const brand = {
  studioName: "FlawlessIQ",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "studio@studio-cue.com",
};

/**
 * The album reminder went out twice — a week and a fortnight after delivery —
 * as "There's an update from your studio", with nothing to click, because
 * `album_selection_reminder` had no case and fell to the default. The job
 * recorded both as succeeded, because sending worked and only the copy was
 * wrong. Exactly the crew-invitation failure in CLAUDE.md, one lane over.
 */
test("the album reminder carries the instructions it exists to deliver", () => {
  const rendered = renderEmailTemplate({
    key: "album_selection_reminder",
    brand,
    recipientName: "Iris Bello",
    projectName: "Iris & Theo wedding",
    values: {
      instructionsUrl: "https://flawlessiq.com/album-guide",
      portalUrl: "https://studio-cue.com/client",
    },
  });
  assert.ok(
    !rendered.text.includes("There’s an update from your studio"),
    "must not fall through to the generic update",
  );
  assert.match(rendered.subject, /album/i);
  assert.ok(rendered.text.includes("https://flawlessiq.com/album-guide"));
  assert.ok(rendered.text.includes("https://studio-cue.com/client"));
});

test("an album reminder with no instructions URL still reaches the portal", () => {
  const rendered = renderEmailTemplate({
    key: "album_selection_reminder",
    brand,
    recipientName: "Iris",
    projectName: null,
    values: { portalUrl: "https://studio-cue.com/client" },
  });
  assert.ok(rendered.text.includes("https://studio-cue.com/client"));
  assert.ok(!rendered.text.includes("There’s an update from your studio"));
});

/**
 * The general defence. A scheduler that queues an emailJob of some `type` is
 * promising a template for it; the `default` case is for nothing in particular
 * and must never be what a scheduled client email renders.
 */
test("every email type a scheduler queues has a template", () => {
  const sources = execSync(
    "grep -rl 'emailJobs/' --include='*.ts' functions/src",
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  assert.ok(sources.length > 0, "found no files that queue email jobs");
  const queued = new Set<string>();
  for (const path of sources) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    // Anchor on the emailJobs document, then read the `type` of the record
    // written for it — a `type:` anywhere else in the file belongs to another
    // collection (pdfJobs, providerJobs) and is not an email at all.
    for (const anchor of source.matchAll(/emailJobs\//g)) {
      const window = source.slice(anchor.index!, anchor.index! + 900);
      const type = window.match(/\btype: "([a-z_]+)"/);
      if (type) queued.add(type[1]!);
    }
  }
  assert.ok(queued.size > 3, `only found ${queued.size} queued email types`);
  for (const type of queued)
    assert.ok(
      (emailTemplateKeys as readonly string[]).includes(type),
      `emailJobs of type "${type}" are queued but no template renders them — they would send as "There's an update from your studio"`,
    );
});

/**
 * The delivery email's only link went to the provider, so the couple never
 * reached the portal — where the album selections, the expiry countdown and
 * the download confirmation that clears the closeout all live.
 */
test("delivery and review emails both offer the portal", () => {
  for (const key of ["delivery", "review_request"] as const) {
    const rendered = renderEmailTemplate({
      key,
      brand,
      recipientName: "Iris",
      projectName: "Iris & Theo wedding",
      values: {
        galleryUrl: "https://flawlessiq.pixieset.com/irisandtheo/",
        destinationUrl: "https://g.page/r/example/review",
        portalUrl: "https://studio-cue.com/client",
      },
    });
    assert.ok(
      rendered.text.includes("https://studio-cue.com/client"),
      `${key} must link the portal it tells them to use`,
    );
  }
});

test("the delivery email still leads with the gallery", () => {
  const rendered = renderEmailTemplate({
    key: "delivery",
    brand,
    recipientName: "Iris",
    projectName: "Iris & Theo wedding",
    values: {
      galleryUrl: "https://flawlessiq.pixieset.com/irisandtheo/",
      portalUrl: "https://studio-cue.com/client",
    },
  });
  assert.ok(
    rendered.text.indexOf("pixieset") <
      rendered.text.indexOf("studio-cue.com/client"),
    "the gallery is what they opened the email for",
  );
});

/**
 * "Downloads expire: 20 December 2026" is how a provider writes it, and the
 * panel promises the expiration is extracted so the studio does not retype it.
 */
test("a written expiration date is read, not dropped", () => {
  const wordings = [
    "Downloads expire: 20 December 2026",
    "Your photos will be available until December 20, 2026",
    "Gallery expires on 12/20/2026",
    "Expires: 2026-12-20",
  ];
  for (const wording of wordings) {
    const parsed = parseGalleryAnnouncement(
      `Your gallery is ready: https://flawlessiq.pixieset.com/irisandtheo/\n${wording}`,
    );
    assert.equal(
      parsed.expirationDate,
      "2026-12-20",
      `failed to read "${wording}"`,
    );
  }
});

test("nothing is invented when no expiration is stated", () => {
  const parsed = parseGalleryAnnouncement(
    "Your gallery is ready: https://flawlessiq.pixieset.com/irisandtheo/",
  );
  assert.equal(parsed.expirationDate, "");
});

test("the two calendar-date readers stay identical", () => {
  assert.equal(
    readFileSync("functions/src/operations/calendar-date.ts", "utf8"),
    readFileSync("features/format/calendar-date.ts", "utf8").replace(
      "Duplicated at functions/src/operations/calendar-date.ts;",
      "Duplicated from features/format/calendar-date.ts;",
    ),
  );
  assert.equal(calendarDate("20 December 2026"), "2026-12-20");
});

/**
 * The closeout offered "Mark as done" beside things that were not yet due,
 * with nothing saying so — the studio's only visible move was to vouch for
 * something that had not happened.
 */
test("the closeout says what it is waiting for", () => {
  const review = closeoutPendingNote(
    "review_request",
    { reviewScheduledAt: "2026-09-21T12:00:00.000Z", reviewChannel: "portal" },
    () => "Sep 21",
  );
  assert.match(String(review), /Nothing to do yet/);
  assert.match(String(review), /Sep 21/);
  assert.match(String(review), /portal/);

  const delivery = closeoutPendingNote(
    "delivery",
    { deliverySentAt: "2026-09-18T12:00:00.000Z" },
    () => "Sep 18",
  );
  assert.match(String(delivery), /Sep 18/);
  assert.match(String(delivery), /confirm the download/);

  assert.match(
    String(closeoutPendingNote("album", { albumStatus: "instructions_available" })),
    /album selections/,
  );
});

test("a requirement that is genuinely the studio's gets no excuse", () => {
  assert.equal(closeoutPendingNote("crew", {}), null);
  assert.equal(closeoutPendingNote("insurance", {}), null);
  assert.equal(closeoutPendingNote("schedule", {}), null);
  // The album is only waiting while it sits at the first step.
  assert.equal(closeoutPendingNote("album", { albumStatus: "approved" }), null);
  // Nothing scheduled, nothing to wait for.
  assert.equal(closeoutPendingNote("review_request", {}), null);
});
