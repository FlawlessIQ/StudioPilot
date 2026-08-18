import { expect, test } from "@playwright/test";

/**
 * These tests protect the *intent* of the workspace simplification: the
 * photographer always has the same small set of durable destinations, and the
 * home page leads with a single decision rather than a wall of dashboards.
 *
 * They deliberately do not pin the exact nav length or forbid cross-project
 * workspaces. An earlier version asserted `toHaveCount(5)` and
 * `not.toContainText("AI review")`, which turned a point-in-time layout into a
 * requirement — it made restoring the AI review queue and Insights a
 * test failure, even though both are named in the product's own nav plan. The
 * nav assertion below is a floor (these five are always present, in this
 * order), not a ceiling.
 */

const durableDestinations = ["Home", "Projects", "Calendar", "Messages", "People"];

test("photographer navigation always exposes the durable destinations", async ({ page }) => {
  await page.goto("/studio");
  const nav = page.locator(".ds-sidebar");
  await expect(nav).toBeVisible();

  // Each durable destination is present and links somewhere real.
  for (const label of durableDestinations) {
    const item = nav.locator(".ds-nav-item", { hasText: label });
    await expect(item, `"${label}" must stay in the sidebar`).toHaveCount(1);
    await expect(item).toHaveAttribute("href", /\/studio/);
  }

  // And they keep their order, so muscle memory survives.
  const labels = await nav.locator(".ds-nav-item").allInnerTexts();
  const positions = durableDestinations.map((label) =>
    labels.findIndex((text) => text.trim().startsWith(label)),
  );
  expect(positions.every((index) => index >= 0)).toBe(true);
  expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
});

test("the sidebar does not carry project-scoped concepts", async ({ page }) => {
  await page.goto("/studio");
  // Event day and delivery belong to a project, not the top level — surfacing
  // them globally is what made the old nav feel like a filing cabinet.
  await expect(page.locator(".ds-sidebar")).not.toContainText("Event day");
  await expect(page.locator(".ds-sidebar")).not.toContainText("Deliveries");
});

test("home leads with one decision, not competing dashboards", async ({ page }) => {
  await page.goto("/studio");
  const main = page.locator("main");

  // Exactly one primary recommended action, and it names the project it is about.
  const primary = main.getByRole("link", { name: /Review and decide|Create project/ });
  await expect(primary).toHaveCount(1);

  // The concepts the simplification removed stay removed: a generic grid of AI
  // shortcuts, a second "next actions" list, and the full lifecycle rail.
  await expect(main.getByText("Put AI to work", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Next actions", { exact: true })).toHaveCount(0);
  await expect(
    main.getByText("Every project, from hello to gallery", { exact: true }),
  ).toHaveCount(0);
});

test("project workspace uses four outcome-based tabs", async ({ page }) => {
  await page.goto("/studio/projects/demo-project");
  const nav = page.getByRole("navigation", { name: "Project workspace" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link")).toHaveText(["Overview", "Client & booking", "Plan", "Delivery"]);
  await nav.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/\/studio\/planning\?project=demo-project/);
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
});

test("messages reveal the editor only after intent is established", async ({ page }) => {
  await page.goto("/studio/messages");
  // The page is named "Client messages" — it is project messaging with clients,
  // not an email inbox. The nav keeps the shorter "Messages".
  await expect(page.getByRole("heading", { name: /messages/i }).first()).toBeVisible();
  await expect(page.locator(".communications-draft-review")).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Write it myself" }).click();
  await expect(page.locator(".communications-draft-review")).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeVisible();
});

test("delivery asks for project context before showing the release workflow", async ({ page }) => {
  await page.goto("/studio/delivery");
  await expect(page.getByText("Choose the project to deliver", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Secure gallery URL")).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ index: 1 });
  await expect(page.getByLabel("Secure gallery URL")).toBeVisible();
  await expect(page.getByText("Follow-ups and studio defaults", { exact: true })).toBeVisible();
});
