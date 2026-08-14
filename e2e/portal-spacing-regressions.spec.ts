import { expect, test, type Page } from "@playwright/test";

async function expectInset(
  page: Page,
  selector: string,
  minimum = 18,
) {
  const target = page.locator(selector).first();
  await expect(target).toBeVisible();
  const padding = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
  });
  expect(Math.min(...Object.values(padding))).toBeGreaterThanOrEqual(minimum);
}

async function expectShellGutter(page: Page, route: string) {
  await page.goto(route);
  const geometry = await page.locator(".ds-content").evaluate((content) => {
    const contentRect = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    const first = Array.from(content.children).find((child) => {
      const rect = child.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const firstRect = first?.getBoundingClientRect();
    return {
      contentLeft: contentRect.left,
      contentRight: contentRect.right,
      firstLeft: firstRect?.left ?? contentRect.left,
      firstRight: firstRect?.right ?? contentRect.right,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

  expect(geometry.paddingLeft, `${route} left page gutter`).toBeGreaterThanOrEqual(14);
  expect(geometry.paddingRight, `${route} right page gutter`).toBeGreaterThanOrEqual(14);
  expect(geometry.firstLeft, `${route} content begins inside its gutter`).toBeGreaterThanOrEqual(
    geometry.contentLeft + geometry.paddingLeft - 1,
  );
  expect(geometry.firstRight, `${route} content ends inside its gutter`).toBeLessThanOrEqual(
    geometry.contentRight - geometry.paddingRight + 1,
  );
  expect(geometry.overflow, `${route} must not overflow the viewport`).toBeLessThanOrEqual(1);
}

test("event-day content cards preserve readable interior margins", async ({
  page,
}) => {
  await page.goto("/studio/event-day");
  await expectInset(page, ".event-day-timeline", 20);
  await expectInset(page, ".event-day-ask", 20);

  const contained = await page.evaluate(() => {
    const card = document.querySelector(".event-day-ask")!.getBoundingClientRect();
    const form = document.querySelector(".event-day-ask form")!.getBoundingClientRect();
    const prompts = document
      .querySelector(".event-day-quick-questions")!
      .getBoundingClientRect();
    return {
      form: form.left >= card.left + 18 && form.right <= card.right - 18,
      prompts:
        prompts.left >= card.left + 18 && prompts.right <= card.right - 18,
    };
  });
  expect(contained.form).toBe(true);
  expect(contained.prompts).toBe(true);
});

test("content-bearing studio panels no longer touch their borders", async ({
  page,
}) => {
  await page.goto("/studio/invoices");
  await expectInset(page, ".final-invoice-empty", 18);

  await page.goto("/studio");
  await expectInset(page, ".studio-focus-hero", 20);
});

test("studio, customer, and crew flows retain consistent page gutters", async ({
  page,
}) => {
  for (const route of [
    "/studio/vendors",
    "/studio/event-day",
    "/client",
    "/client/messages",
    "/client/proposal",
    "/crew",
    "/crew/accepted",
    "/crew/availability",
  ]) {
    await test.step(route, async () => expectShellGutter(page, route));
  }
});

test("customer and crew content cards retain their component insets", async ({
  page,
}) => {
  await page.goto("/client/messages");
  await expectInset(page, ".client-message-composer", 20);

  await page.goto("/crew/accepted");
  const crewState = page.locator(".team-state, .crew-job-brief").first();
  await expect(crewState).toBeVisible();
  const crewPadding = await crewState.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.paddingTop,
      style.paddingRight,
      style.paddingBottom,
      style.paddingLeft,
    ].map(Number.parseFloat);
  });
  expect(Math.min(...crewPadding)).toBeGreaterThanOrEqual(20);
});
