import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLIENT_AREA_ROUTES,
  clientAreaItems,
} from "@/features/client/portal-navigation";
import {
  buildClientPortalExperience,
  clientProjectStates,
  type ClientNavigation,
} from "@/server/client/portal-experience";

/**
 * The rule this file holds: an area the server says exists is an area the
 * couple can reach from the nav.
 *
 * Nine portal routes competed for one dynamic nav slot, so a run of show
 * holding "Approve this version" was reachable only by typing the URL, while
 * the server had been returning `schedule: true` in a `ClientNavigation` that
 * nothing read. tests/route-reachability.test.ts could not catch it — the
 * server's destination map writes `href: "/client/schedule"` for every area,
 * which reads as a link to a source scan. Proved: removing the schedule entry
 * from the nav left that guard green. Reachability is a property of the nav,
 * and this drives the nav.
 */

const FLAGS = Object.keys(CLIENT_AREA_ROUTES) as Array<keyof ClientNavigation>;

function* navigations(): Generator<ClientNavigation> {
  // Every combination of the nine flags — 512 navs.
  for (let bits = 0; bits < 1 << FLAGS.length; bits++) {
    const nav = {} as ClientNavigation;
    FLAGS.forEach((flag, i) => {
      nav[flag] = Boolean(bits & (1 << i));
    });
    yield nav;
  }
}

test("every area the server reports is in the nav, and no other", () => {
  const failures: string[] = [];
  for (const nav of navigations()) {
    const hrefs = new Set(clientAreaItems(nav).map((item) => item.href));
    for (const flag of FLAGS) {
      const route = CLIENT_AREA_ROUTES[flag];
      if (!route) continue;
      if (nav[flag] && !hrefs.has(route)) {
        failures.push(`${flag}=true but ${route} is not in the nav`);
      }
      if (!nav[flag] && hrefs.has(route) && route !== "/client/project") {
        failures.push(`${flag}=false but ${route} is in the nav`);
      }
    }
    if (failures.length > 6) break;
  }
  assert.deepEqual(
    failures.slice(0, 6),
    [],
    `An area the server reports must appear in the nav — otherwise it is reachable only by typing the URL.\n${failures.slice(0, 6).map((l) => `  ${l}`).join("\n")}`,
  );
});

test("the event page is always reachable", () => {
  for (const nav of navigations()) {
    assert.ok(
      clientAreaItems(nav).some((item) => item.href === "/client/project"),
    );
  }
});

test("a schedule awaiting the couple is reachable at every stage that has one", () => {
  /**
   * The case that started this: PLANNING, a schedule at client_review. The
   * server reports the area and the nav must show it — independent of which
   * page the next-action slot happens to point at.
   */
  for (const state of clientProjectStates) {
    const experience = buildClientPortalExperience({
      state,
      availability: { schedule: true },
      checkpoints: [],
      currentSchedule: { status: "client_review", version: 4 },
    });
    if (!experience.navigation.schedule) continue;
    assert.ok(
      clientAreaItems(experience.navigation).some(
        (item) => item.href === "/client/schedule",
      ),
      `${state}: server reports schedule, nav does not show it`,
    );
  }
});

test("nothing in the nav points outside the portal", () => {
  for (const nav of navigations()) {
    for (const item of clientAreaItems(nav)) {
      assert.match(item.href, /^\/client(\/|$)/, item.href);
    }
  }
});
