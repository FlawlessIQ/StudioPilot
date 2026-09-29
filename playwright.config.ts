import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Next's development compiler performs full reloads when many uncached App
  // Router routes compile at once. Keep the visual journey deterministic: it
  // is intended to validate every surface, not benchmark route compilation.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  // PLAYWRIGHT_CHANNEL=chrome runs the Chromium projects against the
  // installed Google Chrome when Playwright's own Chromium is not downloaded.
  // Set per project: a WebKit project cannot take a Chrome channel.
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
    {
      // Safari's engine, the way couples and crew mostly see StudioCue. iOS
      // draws date inputs wider than Chrome does and will not shrink them,
      // so a phone-width check that runs only in Chrome passes pages that
      // overflow on an iPhone. Scoped to the mobile layout checks.
      name: "iphone-webkit",
      testMatch: /mobile-.*\.spec\.ts$/,
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    // Exercise the same optimized server artifact that Firebase App Hosting
    // deploys. This also prevents development Fast Refresh from interrupting
    // multi-route visual audits.
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
