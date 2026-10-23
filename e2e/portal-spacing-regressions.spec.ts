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

/**
 * No panel may let its text touch its border.
 *
 * `.panel` and `.ds-card` supply background, border and radius but no padding,
 * so each usage has to remember its own inset. The previous check named two
 * selectors while claiming to cover "studio panels", which is why the fault
 * spread unnoticed.
 *
 * This measures the rendered gap between a panel's border and the nearest text
 * it contains — not its declared padding. That distinction matters: table
 * panels correctly delegate the inset to their rows so hover backgrounds can
 * span the full width, and asserting on `padding` alone flags them wrongly.
 */
async function panelInsetOffenders(page: Page, route: string, minimum = 12) {
  await page.goto(route);
  // A design-system page, or a mobile-kit screen (the couple's rebuilt
  // screens, docs/mobile-first-client-crew-plan-2026-09-28.md).
  await expect(page.locator(".ds-content, .kit-main").first()).toBeVisible();
  return page.evaluate(
    ({ min, route: currentRoute }) => {
      const visible = (el: Element) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 20;
      };
      const offenders: string[] = [];
      for (const panel of Array.from(document.querySelectorAll(".panel, .ds-card, .kit-card, .kit-list"))) {
        if (!visible(panel)) continue;
        const box = panel.getBoundingClientRect();
        if ((panel.textContent ?? "").trim().length < 12) continue;

        // nearest text to each border, whoever supplies the inset
        let worst: { gap: number; side: string; text: string } | null = null;
        for (const el of Array.from(panel.querySelectorAll("*"))) {
          if (!visible(el)) continue;
          // only elements holding their own text
          const own = Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1,
          );
          if (!own) continue;
          const r = el.getBoundingClientRect();
          const gaps: Array<[string, number]> = [
            ["left", r.left - box.left],
            ["right", box.right - r.right],
            ["top", r.top - box.top],
            ["bottom", box.bottom - r.bottom],
          ];
          for (const [side, gap] of gaps) {
            // negative means it overflows the panel, which is worse still
            if (gap < min && (!worst || gap < worst.gap)) {
              worst = {
                gap: Math.round(gap),
                side,
                text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32),
              };
            }
          }
        }
        if (worst) {
          offenders.push(
            `${currentRoute}  .${String(panel.className).trim().split(/\s+/).join(".").slice(0, 46)}` +
              `  ${worst.side} gap ${worst.gap}px  "${worst.text}"`,
          );
        }
      }
      return offenders;
    },
    { min: minimum, route },
  );
}

async function expectShellGutter(page: Page, route: string) {
  await page.goto(route);
  // A page that awaits its searchParams streams in: at the load event its
  // shell can still sit in React's hidden Suspense holder, zero-sized, so the
  // first route on a cold server measured a 0px gutter.
  // The studio's design-system shell, or the mobile kit the couple's and
  // crew's screens were rebuilt on (2026-09-29), which has no `.ds-content`.
  const shell = page.locator(".ds-content, .kit-main").first();
  await expect(shell).toBeVisible();
  const geometry = await shell.evaluate((content) => {
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
  // The brief shows the nearest upcoming event, and the demo jobs
  // (config/crm-demo-data.ts) are dated Aug–Sep 2026. Read it the week before
  // the first one, so the dates passing cannot leave only the empty state.
  await page.clock.setFixedTime(new Date("2026-08-10T10:00:00"));
  await page.goto("/studio/event-day");
  // The phone brief is deliberately compact (245bcdb8: 14px 16px at 640px and
  // under), still inset from the border; wider windows keep the full 20px+.
  const phone = (page.viewportSize()?.width ?? 1280) <= 640;
  const inset = phone ? 14 : 20;
  const edge = phone ? 14 : 18;
  await expectInset(page, ".event-day-timeline", inset);
  await expectInset(page, ".event-day-ask", inset);

  const contained = await page.evaluate((min) => {
    const card = document.querySelector(".event-day-ask")!.getBoundingClientRect();
    const form = document.querySelector(".event-day-ask form")!.getBoundingClientRect();
    const prompts = document
      .querySelector(".event-day-quick-questions")!
      .getBoundingClientRect();
    return {
      form: form.left >= card.left + min && form.right <= card.right - min,
      prompts:
        prompts.left >= card.left + min && prompts.right <= card.right - min,
    };
  }, edge);
  expect(contained.form).toBe(true);
  expect(contained.prompts).toBe(true);
});

test("content-bearing studio panels no longer touch their borders", async ({
  page,
}) => {
  await page.goto("/studio/invoices");
  await expectInset(page, ".final-invoice-empty", 18);
  // The dashboard's `.studio-focus-hero` went with StudioDashboard (setup v2,
  // 363a336a). Today's panels are measured by "every panel insets its own
  // content" below.
});

test("every panel insets its own content", async ({ page }) => {
  const all: string[] = [];
  for (const route of [
    "/studio",
    "/studio/projects",
    "/studio/calendar",
    "/studio/messages",
    "/studio/clients",
    "/studio/crew",
    "/studio/reports",
    "/studio/ai-queue",
    "/studio/leads",
    "/studio/invoices",
    "/studio/ai-queue",
    "/studio/setup",
    // the same base classes build the client and crew shells
    "/client",
    "/client/messages",
    "/crew",
    "/crew/jobs",
  ]) {
    all.push(...(await panelInsetOffenders(page, route)));
  }
  expect(all, `panels must inset their own content:\n${all.join("\n")}`).toEqual([]);
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
    "/crew/jobs",
    "/crew/prep",
    "/crew/account",
  ]) {
    await test.step(route, async () => expectShellGutter(page, route));
  }
});

test("customer and crew content cards retain their component insets", async ({
  page,
}) => {
  // Messages is a chat now (M4): the composer is the sticky bar, which keeps
  // the shell gutter either side of its field.
  await page.goto("/client/messages");
  const composerPadding = await page.locator(".kit-composer").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingLeft, style.paddingRight].map(Number.parseFloat);
  });
  expect(Math.min(...composerPadding)).toBeGreaterThanOrEqual(16);

  // Crew jobs are compact kit rows (M6); the list keeps its own inset.
  await page.goto("/crew/jobs");
  const crewList = page.locator(".kit-list").first();
  await expect(crewList).toBeVisible();
  const crewPadding = await crewList.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingLeft, style.paddingRight].map(Number.parseFloat);
  });
  expect(Math.min(...crewPadding)).toBeGreaterThanOrEqual(16);
});
