import assert from "node:assert/strict";
import test from "node:test";
import { parseGalleryAnnouncement } from "../features/post-event/gallery-announcement";

test("extracts Pixieset delivery facts without inventing missing values", () => {
  assert.deepEqual(
    parseGalleryAnnouncement(`
      Your gallery is ready: https://flawlessiq.pixieset.com/smith-wedding/
      Download PIN: 4821
      Gallery expires on 2027-09-30.
    `),
    {
      provider: "pixieset",
      galleryUrl: "https://flawlessiq.pixieset.com/smith-wedding/",
      accessCode: "4821",
      expirationDate: "2027-09-30",
    },
  );
});

test("normalizes a US expiration date and leaves unknown providers manual", () => {
  assert.deepEqual(
    parseGalleryAnnouncement(
      "Open www.example-gallery.com/jones. Password: BLUEBIRD. Expires 8/5/2027",
    ),
    {
      provider: "manual",
      galleryUrl: "https://www.example-gallery.com/jones",
      accessCode: "BLUEBIRD",
      expirationDate: "2027-08-05",
    },
  );
});
