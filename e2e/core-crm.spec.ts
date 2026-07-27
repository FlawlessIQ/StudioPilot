import { expect, test } from "@playwright/test";

test("public inquiry validates and completes in disclosed preview mode", async ({ page }) => {
  await page.goto("/inquiry");
  await expect(page.getByRole("heading", { name: "Let’s make something worth remembering." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send inquiry" })).toBeEnabled();

  await page.getByLabel("First name").fill("Lena");
  await page.getByLabel("Last name").fill("Ortiz");
  await page.getByLabel("Email").fill("lena@example.test");
  await page.getByLabel("Phone").fill("212-555-0112");
  await page.getByLabel("Event date").fill("2027-05-22");
  await page.getByLabel("City").fill("Brooklyn");
  await page.getByLabel("What are you planning?").fill(
    "We are planning an intimate wedding with warm documentary photography.",
  );
  await page.getByRole("button", { name: "Send inquiry" }).click();

  await expect(page.getByRole("heading", { name: "Thank you. We’ll be in touch shortly." })).toBeVisible();
  await expect(page.getByText(/Development preview: no record was persisted/)).toBeVisible();
});

test("core CRM routes expose operational data and filtering", async ({ page }) => {
  await page.goto("/studio/leads");
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByText("Lena & Chris")).toBeVisible();

  await page.getByLabel("Search leads").fill("Hearthwell");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Hearthwell Brands")).toBeVisible();
  await expect(page.getByText("Lena & Chris")).toHaveCount(0);

  await page.goto("/studio/projects?type=corporate");
  await expect(page.getByText("Northstar Annual Summit")).toBeVisible();
  await expect(page.getByText("Maya & Theo Johnson")).toHaveCount(0);

  await page.goto("/studio/packages");
  await expect(page.getByText("Booked pricing stays fixed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create package" })).toHaveAttribute(
    "href",
    "/studio/packages/new",
  );
});

test("workflow operations expose immutable versions, task filters, and readiness", async ({
  page,
}) => {
  await page.goto("/studio/workflows");
  await expect(page.getByRole("heading", { name: "Workflow templates" })).toBeVisible();
  await expect(page.getByText("Wedding Photography").first()).toBeVisible();

  await page.goto("/studio/workflows/wedding-v7");
  await expect(page.getByText("Published version locked")).toBeVisible();
  await expect(page.getByText("AI cannot close these gates.")).toBeVisible();

  await page.goto("/studio/tasks?priority=urgent");
  await expect(page.getByText("Review Johnson schedule comments")).toBeVisible();
  await expect(page.getByText("Request Northstar final shot list")).toHaveCount(0);

  await page.goto("/studio/readiness");
  await expect(page.getByRole("heading", { name: "Event readiness" })).toBeVisible();
  await expect(page.getByText("AI may explain risk, but only verified checkpoint rules determine this view.")).toBeVisible();
  await expect(page.getByText("Not ready").first()).toBeVisible();
});

test("booking operations expose provider evidence and client-safe payment boundaries", async ({
  page,
}) => {
  await page.goto("/studio/calendar");
  await expect(page.getByRole("heading", { name: "Calendar & consultations" })).toBeVisible();
  await page.getByRole("button", { name: "Schedule consultation" }).click();
  await expect(page.getByText(/Development preview: availability/)).toBeVisible();

  await page.goto("/studio/proposals/PROP-204");
  await expect(page.getByText("Version locked")).toBeVisible();
  await expect(page.getByText("Later package edits cannot change this proposal.")).toBeVisible();

  await page.goto("/studio/contracts");
  await expect(page.getByText("No signature inference")).toBeVisible();
  await expect(page.getByText("Partially signed")).toBeVisible();

  await page.goto("/studio/invoices");
  await expect(page.getByText("QuickBooks Online remains the accounting and payment system of record.")).toBeVisible();

  await page.goto("/studio/booking");
  await expect(page.getByRole("heading", { name: "Booking readiness" })).toBeVisible();
  await expect(page.getByText("Booking side effects completed idempotently")).toBeVisible();

  await page.goto("/client/payments");
  await expect(page.getByText("StudioHub never receives your card or bank details.")).toBeVisible();
});

test("planning operations preserve human approval and schedule versions", async ({ page }) => {
  await page.goto("/studio/questionnaires");
  await expect(page.getByRole("heading", { name: "Questionnaires" })).toBeVisible();
  await expect(page.getByText("Family photo list")).toBeVisible();
  await page.goto("/studio/insurance");
  await expect(page.getByText("Legal sufficiency is never automated.")).toBeVisible();
  await expect(page.getByText("Human review required")).toBeVisible();
  await page.goto("/studio/schedules/wedding-booked-v4");
  await expect(page.getByText("Version 3 remains preserved.")).toBeVisible();
  await expect(page.getByText("Ceremony")).toBeVisible();
  await page.goto("/client/schedule");
  await expect(page.getByRole("heading", { name: "Your wedding-day schedule" })).toBeVisible();
  await expect(page.getByText("America/New_York")).toBeVisible();
});

test("crew operations enforce scoped briefs and current schedule acknowledgement", async ({ page }) => {
  await page.goto("/studio/crew");
  await expect(page.getByRole("heading", { name: "Crew operations" })).toBeVisible();
  await expect(page.getByText("v4 acknowledgement due")).toBeVisible();

  await page.goto("/crew/pending");
  await expect(page.getByRole("heading", { name: "Pending jobs" })).toBeVisible();
  await page.getByRole("button", { name: "Accept job" }).click();
  await expect(page.getByText(/Development preview: assignment accepted/)).toBeVisible();

  await page.goto("/crew/schedule");
  await expect(page.getByRole("heading", { name: "Event-day schedule" })).toBeVisible();
  await expect(page.getByText("This schedule changed after your last acknowledgement.")).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge current schedule" }).click();
  await expect(page.getByText(/Development preview: schedule version 4 acknowledged/)).toBeVisible();
  await expect(page.getByText("Package pricing, invoices, and unrelated project information remain hidden.")).toHaveCount(0);
});

test("post-event operations preserve delivery evidence and explicit review confirmation", async ({ page }) => {
  await page.goto("/studio/post-production");
  await expect(page.getByRole("heading", { name: "Post-production" })).toBeVisible();
  await expect(page.getByText("Nora & James Ellis")).toBeVisible();

  await page.goto("/studio/post-production/wedding-delivered");
  await expect(page.getByRole("heading", { name: "Project closeout" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close project" })).toBeDisabled();

  await page.goto("/studio/delivery");
  await page.getByRole("button", { name: "Record & send delivery" }).click();
  await expect(page.getByText(/Development preview: delivery gates passed/)).toBeVisible();

  await page.goto("/studio/reviews");
  await expect(page.getByText("A click is engagement—not completion.")).toBeVisible();

  await page.goto("/studio/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("QuickBooks sync · Jul 26, 6:12 PM")).toBeVisible();

  await page.goto("/client/reviews");
  await page.getByRole("button", { name: "I’ve completed my review" }).click();
  await expect(page.getByText(/Development preview: review confirmed/)).toBeVisible();
});
