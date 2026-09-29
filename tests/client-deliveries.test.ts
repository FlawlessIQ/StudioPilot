import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { linkHost } from "../features/post-event/link-host";
import { clientDeliverable, clientDeliverables, daysLeft, deliveriesHeading } from "../features/client/deliverables";

/**
 * The couple's photos and film (M5 of the mobile-first plan; the portal half
 * of H4). A Vimeo link is a film with a password, not a "secure gallery" with
 * an access code, even before the studio's side records a media type.
 */

test("the host is read from the link", () => {
  assert.deepEqual(linkHost("https://vimeo.com/123"), { host: "vimeo", name: "Vimeo", mediaType: "video" });
  assert.equal(linkHost("https://youtu.be/abc").mediaType, "video");
  assert.equal(linkHost("https://rivera.pixieset.com/x").name, "Pixieset");
  assert.equal(linkHost("https://www.dropbox.com/s/x").mediaType, "files");
  // A white-labelled gallery on the studio's own domain can't be told apart.
  assert.equal(linkHost("https://gallery.mystudio.com/rivera").host, "other");
  assert.equal(linkHost("not a url").host, "other");
});

test("a Vimeo delivery with no media type reads as a film with a password", () => {
  const film = clientDeliverable({ id: "f", galleryUrl: "https://vimeo.com/1", accessCode: "pw" });
  assert.equal(film.mediaType, "video");
  assert.equal(film.title, "Your film");
  assert.equal(film.codeLabel, "Password");
  assert.equal(film.hostName, "Vimeo");
});

test("an old delivery reads as the photo gallery it always was", () => {
  const photos = clientDeliverable({ id: "p", provider: "shootproof", galleryUrl: "https://gallery.mystudio.com/x" });
  assert.equal(photos.mediaType, "photo");
  assert.equal(photos.title, "Your gallery");
  assert.equal(photos.hostName, "ShootProof");
  assert.equal(photos.codeLabel, "Access code");
});

test("H4's fields win when a record has them", () => {
  const peek = clientDeliverable({ id: "s", mediaType: "photo", kind: "sneak_peek", galleryUrl: "https://vimeo.com/1" });
  assert.equal(peek.mediaType, "photo");
  assert.equal(peek.title, "Sneak peek");
  assert.equal(clientDeliverable({ id: "l", label: "Ceremony edit", galleryUrl: "https://vimeo.com/2" }).title, "Ceremony edit");
});

test("newest first, and the heading names what arrived", () => {
  const list = clientDeliverables([
    { id: "a", galleryUrl: "https://x.pixieset.com", deliveryDate: "2027-07-01" },
    { id: "b", galleryUrl: "https://vimeo.com/1", deliveryDate: "2027-08-10" },
  ]);
  assert.deepEqual(list.map((item) => item.id), ["b", "a"]);
  assert.equal(deliveriesHeading(list), "Your photos and film");
  assert.equal(deliveriesHeading([list[0]!]), "Your film");
});

test("days left counts the whole expiry day", () => {
  const now = new Date("2027-07-30T12:00:00").valueOf();
  assert.equal(daysLeft("2027-08-01", now), 3);
  assert.equal(daysLeft("2027-07-01", now)! < 0, true);
  assert.equal(daysLeft(null, now), null);
});

test("a couple can only take the album step in front of them", () => {
  const source = readFileSync("functions/src/post-event/commands.ts", "utf8");
  assert.match(source, /approved: \["design_sent"\]/);
  assert.match(source, /revision_requested: \["design_sent"\]/);
  assert.match(source, /throw new Error\("ALBUM_STEP_NOT_AVAILABLE"\)/);
});

test("the portal passes H4's deliverable fields through to the couple", () => {
  const source = readFileSync("app/api/client/portal/route.ts", "utf8");
  const fields = source.slice(source.indexOf("deliveryRecords: ["), source.indexOf("albumWorkflows: ["));
  for (const field of ["mediaType", "kind", "label"]) assert.match(fields, new RegExp(`"${field}"`));
});

test("every kit screen's empty state knows when its moment has passed", () => {
  for (const screen of [
    "client-proposal",
    "client-contract",
    "client-payments",
    "client-questionnaire",
    "client-schedule",
    "client-files",
    "client-delivery",
    "client-reviews",
  ]) {
    const source = readFileSync(`components/client/kit/${screen}.tsx`, "utf8");
    assert.match(source, /<EmptyMoment\b/, screen);
  }
});

test("nothing the couple reads calls a delivery 'photographs'", () => {
  for (const file of ["features/client/portal-day.ts", "features/client/portal-stage.ts", "features/client/portal-navigation.ts"]) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /photographs/i, file);
  }
});
