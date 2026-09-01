import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";

/**
 * Where an invitation link points, and that both kinds point there.
 *
 * There are two invitations now. An assignment invite offers specific work; a
 * roster invite has no job attached and exists because adding a collaborator
 * to the directory used to send nothing at all, leaving an inert row the
 * studio maintained by hand. They deliberately share one token shape, one URL
 * and one accept endpoint, so the endpoint can find the token in either
 * collection and a collaborator follows one kind of link whichever they got.
 *
 * That sharing is the fragile part. Nothing at compile time ties the URL these
 * emails are built from to the page that actually exists, and a broken invite
 * link fails silently — it looks fine in the outbox and only fails for a real
 * person, once, on a link that cannot be re-sent to the same token.
 */
const commands = readFileSync(
  `${process.cwd()}/functions/src/crew/commands.ts`,
  "utf8",
);

test("every crew invite link points at a page that exists", () => {
  const links = [...commands.matchAll(/\$\{appUrl\(\)\}(\/[a-z0-9/-]+)\?/g)].map(
    (match) => match[1],
  );
  // Three places mint one: the roster invite, a direct assignment offer, and
  // the cascade working down a ranked list of candidates. All three must land
  // on the same page, and nothing may quietly mint a link somewhere else.
  assert.equal(links.length, 3);
  assert.deepEqual([...new Set(links)], ["/auth/crew-invite"]);
  for (const link of new Set(links)) {
    assert.ok(
      existsSync(`${process.cwd()}/app${link}/page.tsx`),
      `${link} is emailed to crew but has no page`,
    );
  }
});

test("the roster invitation does not read as a job offer", () => {
  const rendered = renderEmailTemplate({
    key: "crew_directory_invitation",
    brand: {
      studioName: "Alder & Muse Photography",
      productName: "StudioCue",
      accentColor: "#35664a",
      logoUrl: "https://example.com/logo.png",
      contactEmail: "hello@example.com",
    },
    values: { inviteUrl: "https://example.com/invite" },
  });
  // The whole point of the separate template: someone added to a roster has
  // not been offered anything, and must not be told a date, a fee or a venue
  // that does not exist.
  const body = `${rendered.subject} ${rendered.text}`.toLowerCase();
  for (const word of ["compensation", "per hour", "respond by", "decline"])
    assert.ok(!body.includes(word), `roster invite implies an offer: ${word}`);
  assert.ok(rendered.html.includes("https://example.com/invite"));
});
