import { expect, test } from "@playwright/test";

async function openMobileNavigation(
  page: import("@playwright/test").Page,
  accessibleName: string,
) {
  const menuButton = page.getByRole("button", {
    name: accessibleName,
    exact: true,
  });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
}

test("studio navigation preserves the authorized workspace shell", async ({
  page,
}) => {
  await page.goto("/studio");
  await page.evaluate(() => {
    Object.assign(window, {
      __studioCueShell: document.querySelector(".app-frame"),
    });
  });

  await openMobileNavigation(page, "Open navigation");
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/calendar$/);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("Verifying access…")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__studioCueShell") ===
        document.querySelector(".app-frame"),
    ),
  ).toBe(true);
});

test("client navigation preserves the authorized portal shell", async ({
  page,
}) => {
  await page.goto("/client");
  await page.evaluate(() => {
    Object.assign(window, {
      __studioCuePortalShell: document.querySelector(".portal-frame"),
    });
  });

  await openMobileNavigation(page, "Open client navigation");
  await page
    .getByRole("link", { name: "Project records", exact: true })
    .click();
  await expect(page).toHaveURL(/\/client\/documents$/);
  await expect(page.getByText("Verifying access…")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__studioCuePortalShell") ===
        document.querySelector(".portal-frame"),
    ),
  ).toBe(true);
});

test("crew navigation preserves the authorized assignment shell", async ({
  page,
}) => {
  await page.goto("/crew");
  await page.evaluate(() => {
    Object.assign(window, {
      __studioCueCrewShell: document.querySelector(".crew-portal-frame"),
    });
  });

  await openMobileNavigation(page, "Open crew navigation");
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page).toHaveURL(/\/crew\/jobs$/);
  await expect(page.getByText("Verifying access…")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__studioCueCrewShell") ===
        document.querySelector(".crew-portal-frame"),
    ),
  ).toBe(true);
});
