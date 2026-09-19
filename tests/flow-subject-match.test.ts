import assert from "node:assert/strict";
import test from "node:test";
import {
  matchSubject,
  normaliseSubject,
  unmatchedSubjectNotice,
} from "@/features/ai/flow-subject";

/**
 * Joining the words the operator used to the record they meant.
 *
 * From live use: "add albert gershengoren to 2nd photogrpaher for erin and joe
 * demattia" opened a picker with no sign of Albert, three times. The strictness
 * here is the point — a wrong match offers a wedding to the wrong person, at a
 * fee, by email, so anything short of certain asks instead.
 */

const ROSTER = [
  { id: "c1", name: "Albert Gershengoren" },
  { id: "c2", name: "Sam Rivera" },
  { id: "c3", name: "Dana O'Brien" },
];

test("the operator's own words find the record", () => {
  assert.deepEqual(matchSubject("albert gershengoren", ROSTER), {
    kind: "matched",
    id: "c1",
    name: "Albert Gershengoren",
  });
});

test("case, punctuation and accents do not matter", () => {
  assert.equal(normaliseSubject("Dana O'Brien"), "dana o brien");
  for (const typed of ["DANA O'BRIEN", "dana o brien", " Dana  O'Brien "]) {
    const match = matchSubject(typed, ROSTER);
    assert.equal(match.kind, "matched", typed);
    assert.equal(match.kind === "matched" && match.id, "c3", typed);
  }
});

test("a spelling the roster does not share is not forced into a match", () => {
  // "Obrien" has no apostrophe to normalise away and is one token, so it is
  // not the same word as "o" + "brien". Better asked than guessed.
  assert.equal(matchSubject("Dana Obrien", ROSTER).kind, "unmatched");
});

test("every word must be present, not merely some", () => {
  // Guards the reverse containment: a candidate whose name is a subset of what
  // was typed is not a match.
  assert.equal(matchSubject("albert gershengoren junior", ROSTER).kind, "unmatched");
});

test("a partial name that fits one record is enough", () => {
  assert.deepEqual(matchSubject("gershengoren", ROSTER), {
    kind: "matched",
    id: "c1",
    name: "Albert Gershengoren",
  });
});

/** Two Alberts is a question, not a coin flip. */
test("words that fit more than one record are ambiguous", () => {
  const two = [...ROSTER, { id: "c4", name: "Albert Nunez" }];
  const match = matchSubject("albert", two);
  assert.equal(match.kind, "ambiguous");
  assert.deepEqual(match.kind === "ambiguous" && match.ids.sort(), ["c1", "c4"]);
});

test("an exact name wins over records that merely contain the words", () => {
  const tricky = [
    { id: "p1", name: "Gold Photo" },
    { id: "p2", name: "Gold Photo Package" },
  ];
  assert.deepEqual(matchSubject("Gold Photo", tricky), {
    kind: "matched",
    id: "p1",
    name: "Gold Photo",
  });
});

test("package-style names match the way studios say them", () => {
  const packages = [
    { id: "p1", name: "Gold Cinematic Package" },
    { id: "p2", name: "Silver Photo Package" },
  ];
  assert.deepEqual(matchSubject("gold cinematic", packages), {
    kind: "matched",
    id: "p1",
    name: "Gold Cinematic Package",
  });
});

test("naming somebody who is not there is unmatched, not a guess", () => {
  assert.equal(matchSubject("Jordan Vance", ROSTER).kind, "unmatched");
});

/** No subject means the flow behaves exactly as it always has. */
test("no subject is not a failure", () => {
  for (const empty of [null, undefined, "", "   "])
    assert.equal(matchSubject(empty, ROSTER).kind, "none");
});

test("an empty roster cannot match anything", () => {
  assert.equal(matchSubject("albert", []).kind, "unmatched");
});

test("records missing a name or id are skipped rather than matched", () => {
  const broken = [
    { id: "", name: "Albert Gershengoren" },
    { id: "c9", name: "" },
  ];
  assert.equal(matchSubject("albert gershengoren", broken).kind, "unmatched");
});

test("the unmatched notice names the thing and where to fix it", () => {
  const notice = unmatchedSubjectNotice("Albert Gershengoren", "crew");
  assert.match(notice, /Albert Gershengoren/);
  assert.match(notice, /crew list/);
  assert.match(notice, /People/);
  assert.match(unmatchedSubjectNotice("Gold Cinematic", "package"), /Library/);
});
