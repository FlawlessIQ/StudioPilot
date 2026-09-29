import { expect, test, type Page } from "@playwright/test";

/**
 * The couple's personal inquiry link, walked at phone width: missing details,
 * then a time, then booked, then cancelled (M2 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The scheduling endpoint is answered here with the shapes the function
 * returns, so every state can be reached without a studio, a lead or a
 * calendar. Build for it with App Check skipped and no Functions URL:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

// The app's service worker takes over after the first load, and in WebKit a
// request that passes through it skips page.route, so the stubs below went
// unanswered and the real server returned 500. Nothing here is about offline.
test.use({ serviceWorkers: "block" });

const base = {
  studioName: "FlawlessIQ",
  brandAccentColor: "#7C2F3B",
  brandLogoUrl: null,
  firstName: "Harper",
  known: {},
  formats: ["zoom", "phone"],
  inPersonLocation: null,
  durationMinutes: 20,
  takesBookings: true,
  timezone: "America/New_York",
};

// 11:30 AM and 2:00 PM Eastern on Tuesday 6 October, 10:00 AM on the 7th.
const slots = [
  { startsAt: "2026-10-06T15:30:00.000Z", endsAt: "2026-10-06T15:50:00.000Z" },
  { startsAt: "2026-10-06T18:00:00.000Z", endsAt: "2026-10-06T18:20:00.000Z" },
  { startsAt: "2026-10-07T14:00:00.000Z", endsAt: "2026-10-07T14:20:00.000Z" },
];

async function answerScheduling(page: Page) {
  const state = { details: false, booked: null as null | Record<string, unknown> };
  const calls: Array<Record<string, unknown>> = [];
  await page.route("**/api/functions/publicConsultationScheduling", async (route) => {
    const body = route.request().postDataJSON() as { type: string; input: Record<string, unknown> };
    calls.push(body);
    const json = (payload: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    switch (body.type) {
      case "inquiry_preview":
        return json({
          ...base,
          missing: state.details ? [] : ["eventDate", "venue", "estimatedGuestCount"],
          detailsSubmitted: state.details,
          booked: state.booked,
        });
      case "inquiry_details":
        state.details = true;
        return json({ saved: true });
      case "inquiry_availability":
        return json({ slots });
      case "inquiry_book":
        state.booked = {
          startsAt: body.input.startsAt,
          endsAt: "2026-10-06T15:50:00.000Z",
          format: body.input.format,
          joinUrl: body.input.format === "zoom" ? "https://zoom.us/j/1" : null,
          location: null,
        };
        return json({ booked: true });
      case "inquiry_cancel":
        state.booked = null;
        return json({ cancelled: true });
      default:
        return route.fulfill({ status: 400, body: JSON.stringify({ error: "UNEXPECTED" }) });
    }
  });
  return calls;
}

async function fitsThePhone(page: Page) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}

test("details, a time, booked, cancelled — all on a phone", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "iphone-webkit"].includes(testInfo.project.name));
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await answerScheduling(page);
  await page.goto("/i/test-token");

  // The studio's own colour, and only what it does not know yet.
  await expect(page.getByRole("heading", { name: "Hi Harper — tell us about your day" })).toBeVisible();
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector(".kit")!).getPropertyValue("--kit-accent").trim()),
  ).toBe("#7C2F3B");
  await fitsThePhone(page);
  await page.getByLabel("Your wedding date").fill("2027-05-15");
  await page.getByRole("button", { name: "Continue" }).click();

  // A time: format as chips, a day tile, then a time.
  await expect(page.getByRole("heading", { name: "Hi Harper — pick a time to talk with FlawlessIQ" })).toBeVisible();
  await page.getByRole("button", { name: "Phone call" }).click();
  await page.getByRole("button", { name: "Tuesday, October 6" }).click();
  await page.getByRole("button", { name: "11:30 AM" }).click();
  await fitsThePhone(page);
  const book = page.getByRole("button", { name: "Book Tue, Oct 6 · 11:30 AM" });
  await expect(book).toBeEnabled();
  await book.click();

  await expect(page.getByRole("heading", { name: "Hi Harper — you’re booked in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tuesday, October 6 at 11:30 AM" })).toBeVisible();
  await fitsThePhone(page);
  const booked = calls.find((call) => call.type === "inquiry_book")!;
  expect(booked.input).toMatchObject({ startsAt: slots[0]!.startsAt, format: "phone" });

  // Cancelling asks in the page first, and can be backed out of.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  expect(calls.some((call) => call.type === "inquiry_cancel")).toBe(false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("heading", { name: /pick a time to talk/ })).toBeVisible();
  expect(calls.some((call) => call.type === "inquiry_cancel")).toBe(true);
});

/**
 * The consultation invite, the other way a couple books a call. Its times
 * were printed in the phone's time zone under a line saying they were the
 * studio's; the picker now formats them in the studio's zone.
 */
test("the consultation invite books a time in the studio's zone", async ({ page }, testInfo) => {
  test.skip(!["desktop-chromium", "iphone-webkit"].includes(testInfo.project.name));
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: Array<Record<string, unknown>> = [];
  await page.route("**/api/functions/publicConsultationScheduling", async (route) => {
    const body = route.request().postDataJSON() as { type: string; input: Record<string, unknown> };
    calls.push(body);
    const json = (payload: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
    if (body.type === "preview")
      return json({
        studioName: "FlawlessIQ",
        brandAccentColor: "#1F3A5F",
        projectName: "Harper & Devin",
        eventDate: "2027-05-15",
        expiresAt: "2026-10-30T00:00:00.000Z",
        mode: "video_call",
      });
    if (body.type === "availability") return json({ slots, timezone: "America/New_York" });
    if (body.type === "book") return json({ startsAt: body.input.startsAt });
    return route.fulfill({ status: 400, body: JSON.stringify({ error: "UNEXPECTED" }) });
  });
  await page.goto("/schedule/consultation?token=test-token");
  await expect(page.getByRole("heading", { name: "Choose a time with FlawlessIQ" })).toBeVisible();
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector(".kit")!).getPropertyValue("--kit-accent").trim()),
  ).toBe("#1F3A5F");
  await page.getByRole("button", { name: "Tuesday, October 6" }).click();
  await page.getByRole("button", { name: "2:00 PM" }).click();
  await fitsThePhone(page);
  await page.getByRole("button", { name: "Book Tue, Oct 6 · 2:00 PM" }).click();
  await expect(page.getByRole("heading", { name: "You’re booked in" })).toBeVisible();
  await expect(page.getByText(/Tuesday, October 6 at 2:00 PM/)).toBeVisible();
  expect(calls.find((call) => call.type === "book")?.input).toMatchObject({ startsAt: slots[1]!.startsAt });
});
