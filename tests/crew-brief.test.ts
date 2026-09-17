import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  answerText,
  buildCrewBrief,
  fieldReachesCrew,
} from "../features/questionnaires/crew-brief";
import { starterQuestionnaires } from "../features/questionnaires/starter-templates";

/**
 * What of a client's brief reaches the crew.
 *
 * Two failures matter and they pull opposite ways. The do-not-photograph list,
 * minors and restrictions must reach the people holding cameras. Billing
 * contacts, approvers and a couple's private email must not.
 */

const sports = starterQuestionnaires().find((template) => template.eventTypeId === "sports")!;
const corporate = starterQuestionnaires().find((template) => template.eventTypeId === "corporate")!;

test("a sports brief puts who must not appear, and minors, before anything else", () => {
  const brief = buildCrewBrief({
    sections: sports.sections,
    answers: {
      organisation: "Hudson Valley FC",
      "primary-contact": "Dana Ruiz · dana@hvfc.org",
      "day-contact": "Coach Lee · 555-0144",
      "venue-address": "Field 3, Riverside Park",
      "arrival-time": "08:30",
      "minors-present": "Yes",
      "consent-on-file": true,
      "no-photo-list": "Sam K. (U12 blue) — no photos at all",
    },
  });
  assert.equal(brief.beforeYouShoot[0]!.fieldId, "no-photo-list");
  assert.ok(brief.beforeYouShoot.some((item) => item.label === "Under-18s will be photographed"));
  assert.ok(brief.beforeYouShoot.some((item) => item.fieldId === "consent-on-file" && item.text === "Confirmed"));
  const everything = [...brief.beforeYouShoot, ...brief.onTheDay].map((item) => item.fieldId);
  assert.ok(everything.includes("day-contact"));
  // The organiser's own contact and club details stay with the studio.
  assert.ok(!everything.includes("primary-contact"));
  assert.ok(!everything.includes("organisation"));
});

test("a corporate brief never hands crew the billing contact or the approver", () => {
  const brief = buildCrewBrief({
    sections: corporate.sections,
    answers: {
      company: "Northstar",
      "billing-contact": "accounts@northstar.com",
      approver: "VP Marketing",
      "access-notes": "Badge at front desk, ask for Priya",
      "no-photo-list": "Legal team, floor 9",
    },
  });
  const ids = [...brief.beforeYouShoot, ...brief.onTheDay].map((item) => item.fieldId);
  assert.deepEqual(ids.sort(), ["access-notes", "no-photo-list"]);
});

test("a studio's own fields reach crew only when shared on purpose", () => {
  assert.equal(fieldReachesCrew({ id: "parking", label: "Parking", type: "text" }), false);
  assert.equal(fieldReachesCrew({ id: "parking", label: "Parking", type: "text", crewVisible: true }), true);
  // Explicitly private beats the starter list.
  assert.equal(fieldReachesCrew({ id: "no-photo-list", label: "x", type: "long_text", crewVisible: false }), false);
  // A studio-internal note stays internal even with a starter id.
  assert.equal(fieldReachesCrew({ id: "sensitivities", label: "x", type: "long_text", internalOnly: true }), false);
});

test("empty answers and files never appear", () => {
  const brief = buildCrewBrief({
    sections: [
      {
        fields: [
          { id: "restrictions", label: "Restrictions", type: "long_text" },
          { id: "shot-priorities", label: "Shot list", type: "file", crewVisible: true },
        ],
      },
    ],
    answers: { restrictions: "   ", "shot-priorities": { name: "shots.pdf" } },
  });
  assert.deepEqual(brief, { beforeYouShoot: [], onTheDay: [] });
});

test("answers read as words", () => {
  assert.equal(answerText("acknowledgement", false), "Not confirmed");
  assert.equal(answerText("radio", "No"), "No");
  assert.equal(answerText("multi_select", ["Website", "Print"]), "Website, Print");
  assert.equal(answerText("text", ""), "");
});

test("every starter field crew are meant to see still exists", () => {
  // A renamed starter field would silently stop reaching crew.
  const ids = new Set(
    starterQuestionnaires().flatMap((template) =>
      template.sections.flatMap((section) => section.fields.map((field) => field.id)),
    ),
  );
  for (const id of ["no-photo-list", "minors-present", "sensitivities", "restrictions", "day-contact", "on-site-contact"])
    assert.ok(ids.has(id), `${id} no longer exists in the starter briefs`);
});

test("features/ and functions/ build the crew brief identically", () => {
  assert.equal(
    readFileSync("functions/src/planning/crew-brief.ts", "utf8"),
    readFileSync("features/questionnaires/crew-brief.ts", "utf8"),
  );
});

test("the offline event-day brief keeps the before-you-shoot list", () => {
  const views = readFileSync(`${process.cwd()}/components/crew/live-crew-views.tsx`, "utf8");
  const offline = views.slice(views.indexOf("function OfflineCrewBrief"), views.indexOf("export function LiveCrewSchedule"));
  assert.match(offline, /<CrewClientBrief projectId=\{brief\.projectId\} compact offline\/>/);
  // The cached copy carries the project, so the saved brief can find it.
  assert.match(views, /const brief: CachedCrewBrief = \{\n\s+projectId: text\(assignment\.projectId, ""\),/);
  const component = readFileSync(`${process.cwd()}/components/crew/client-brief.tsx`, "utf8");
  // Saved under the prefix sign-out sweeps, so a borrowed phone forgets it.
  assert.match(component, /localStorage\.setItem\(`studiocue:crew-client-brief:/);
});
