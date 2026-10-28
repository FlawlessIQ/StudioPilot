/**
 * Which imported booking a signed contract dropped into Cue belongs to.
 *
 * Cue read every dropped contract as a signature to record, and recording
 * only takes a job waiting on one. Gabe dropped Kim Karpinski & Drew Gizzi's
 * contract into Cue to fill their forms (2026-10-28); their wedding was
 * imported, already booked, so Cue said "No job is waiting on a signature"
 * and offered to import it as a booking — a second copy of a wedding he
 * already had. Their Final schedule stayed at 9%.
 *
 * The same rule the contract-details reading matches by
 * (functions/src/planning/contract-details.ts matchContractToJob): the
 * contract's event date, and a word of a name it states found in the job's
 * name. Exactly one, or none — Cue doesn't guess a couple's wedding. Pure.
 */

export type ImportedJob = { id: string; name: string; eventDate: string | null };

function nameWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !["and", "the", "wedding", "mitzvah"].includes(word));
}

export function importedJobForContract(
  reading: { clientNames: ReadonlyArray<string>; signerNames: ReadonlyArray<string>; eventDate: string | null },
  jobs: ReadonlyArray<ImportedJob>,
): ImportedJob | null {
  if (!reading.eventDate) return null;
  const read = new Set([...reading.clientNames, ...reading.signerNames].flatMap(nameWords));
  if (!read.size) return null;
  const matching = jobs.filter((job) => job.eventDate === reading.eventDate && nameWords(job.name).some((word) => read.has(word)));
  return matching.length === 1 ? matching[0]! : null;
}
