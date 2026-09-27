import assert from "node:assert/strict";
import test from "node:test";
import { iconButtonTitle } from "../features/ui/icon-button-title";

const base = { visibleText: "", ariaLabel: "Suspend Sam", title: null, titleIsOurs: false };

test("an icon-only control gets its accessible name as a tooltip", () => {
  assert.equal(iconButtonTitle(base), "Suspend Sam");
});

test("a control with visible words, its own title, or no name is left alone", () => {
  assert.equal(iconButtonTitle({ ...base, visibleText: "Suspend" }), null);
  assert.equal(iconButtonTitle({ ...base, title: "Custom" }), null);
  assert.equal(iconButtonTitle({ ...base, ariaLabel: null }), null);
  assert.equal(iconButtonTitle({ ...base, ariaLabel: "  " }), null);
});

test("a tooltip we set follows the label when it changes", () => {
  assert.equal(
    iconButtonTitle({ ...base, ariaLabel: "Reactivate Sam", title: "Suspend Sam", titleIsOurs: true }),
    "Reactivate Sam",
  );
  assert.equal(iconButtonTitle({ ...base, title: "Suspend Sam", titleIsOurs: true }), null);
});
