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
