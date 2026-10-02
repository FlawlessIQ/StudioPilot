/**
 * Rearranging a questionnaire template in the studio's editor: questions up,
 * down and into another section; sections added, renamed, moved and removed.
 *
 * Pure, so every move is tested without a browser. Each returns new sections;
 * the editor then runs repairTemplateLinks (template-rules.ts), because a move
 * can put a question above the one its "show only when" or suggested time
 * reads, and says what it cleared.
 *
 * And what a question's wording sends where (questionDestinations): the
 * agreement's Schedule A and the four-week lock sort questions by what they
 * ask (contracts/event-details.ts, planning/details-lock.ts), so rewording
 * "Ceremony location" as "Ceremony notes" quietly takes it out of both. The
 * editor says so as they type.
 */

import { eventDetailCategory } from "../contracts/event-details";
import { locksWithDetails } from "../planning/details-lock";

type Field = { id: string };
type Section<F extends Field> = { id: string; title: string; fields: F[] };

/** Where a question is: its section's index and its own. */
function locate<F extends Field>(sections: readonly Section<F>[], fieldId: string): [number, number] | null {
  for (const [sectionIndex, section] of sections.entries()) {
    const fieldIndex = section.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex >= 0) return [sectionIndex, fieldIndex];
  }
  return null;
}

/**
 * A question one place up or down. At the top or bottom of its section it
 * crosses into the neighbouring one (to its end, or its start), so a studio
 * can walk a question anywhere with the arrows alone.
 */
export function moveField<F extends Field, S extends Section<F>>(sections: readonly S[], fieldId: string, direction: -1 | 1): S[] {
  const at = locate(sections, fieldId);
  if (!at) return [...sections];
  const [sectionIndex, fieldIndex] = at;
  const next = sections.map((section) => ({ ...section, fields: [...section.fields] }));
  const fields = next[sectionIndex]!.fields;
  const target = fieldIndex + direction;
  if (target >= 0 && target < fields.length) {
    [fields[fieldIndex], fields[target]] = [fields[target]!, fields[fieldIndex]!];
    return next;
  }
  const neighbour = next[sectionIndex + direction];
  if (!neighbour) return [...sections];
  const [field] = fields.splice(fieldIndex, 1);
  if (direction === -1) neighbour.fields.push(field!);
  else neighbour.fields.unshift(field!);
  return next;
}

/** A question to the end of another section. */
export function moveFieldToSection<F extends Field, S extends Section<F>>(sections: readonly S[], fieldId: string, sectionId: string): S[] {
  const at = locate(sections, fieldId);
  const targetIndex = sections.findIndex((section) => section.id === sectionId);
  if (!at || targetIndex < 0 || targetIndex === at[0]) return [...sections];
  const next = sections.map((section) => ({ ...section, fields: [...section.fields] }));
  const [field] = next[at[0]]!.fields.splice(at[1], 1);
  next[targetIndex]!.fields.push(field!);
  return next;
}

/** A section one place up or down, its questions with it. */
export function moveSection<S extends { id: string }>(sections: readonly S[], sectionId: string, direction: -1 | 1): S[] {
  const index = sections.findIndex((section) => section.id === sectionId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sections.length) return [...sections];
  const next = [...sections];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * A section removed. Its questions go to the end of `moveTo` when given, and
 * with it otherwise. The last section can't go: a form needs somewhere for
 * questions to live.
 */
export function removeSection<F extends Field, S extends Section<F>>(sections: readonly S[], sectionId: string, moveTo: string | null): S[] {
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index < 0 || sections.length <= 1) return [...sections];
  const removed = sections[index]!;
  return sections
    .filter((section) => section.id !== sectionId)
    .map((section) => (section.id === moveTo ? { ...section, fields: [...section.fields, ...removed.fields] } : section));
}

/** A section id not already in the form. */
export function newSectionId(sections: readonly { id: string }[]): string {
  const taken = new Set(sections.map((section) => section.id));
  for (let count = sections.length + 1; ; count += 1) if (!taken.has(`section-${count}`)) return `section-${count}`;
}

export type QuestionDestination = "contract" | "locks";

/** Where this question's answer goes besides the form, from its wording and type. */
export function questionDestinations(field: { label?: string; type?: string; internalOnly?: boolean }): QuestionDestination[] {
  const label = String(field.label ?? "").trim();
  if (!label || field.internalOnly || ["information", "file", "acknowledgement", "checkbox"].includes(String(field.type ?? "")))
    return [];
  const destinations: QuestionDestination[] = [];
  if (eventDetailCategory(label)) destinations.push("contract");
  if (locksWithDetails({ label, type: field.type })) destinations.push("locks");
  return destinations;
}
