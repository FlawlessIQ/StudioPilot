import type { ZodError } from "zod";

/**
 * The 400 a command endpoint returns when the request fails its schema.
 *
 * Every command endpoint answered `{ error: "INVALID_COMMAND" }`, and
 * `INVALID_COMMAND` had no entry in the client's copy map — so the most common
 * failure in the product reached the studio as whichever generic fallback the
 * calling form happened to pass. A retainer percentage of 1000 on the package
 * a new studio must create before its first proposal reported, in full,
 * "The package could not be created. Try again." — naming no field, no reason,
 * and recommending the one action guaranteed to fail identically.
 *
 * Zod already knows. `error.issues[].path` is the field it rejected, and it was
 * being thrown away at the response. This carries it in the error string,
 * because that is what the clients read: `lib/crm/command-client.ts` and its
 * siblings throw `new Error(result.error)`, and `friendlyError` renders the
 * text after the first colon.
 *
 * `fields` stays alongside for callers that want the paths structurally rather
 * than as prose.
 */
export function invalidCommandResponse(error: ZodError): {
  error: string;
  fields: string[];
} {
  const fields = error.issues
    .map((issue) => issue.path.join("."))
    .filter((path) => path.length > 0);
  return {
    error: fields.length
      ? `INVALID_COMMAND:${describeFields(fields)}`
      : "INVALID_COMMAND",
    fields,
  };
}

/**
 * The rejected fields as something a photographer can read.
 *
 * Paths arrive as `input.retainerRule.basisPoints`; the leading `input` is an
 * artefact of the command envelope and the studio never saw it. Deduplicated,
 * and capped at three — a form that fails on eight fields is better served by
 * "check the highlighted fields" than by a list nobody finishes reading.
 */
function describeFields(fields: readonly string[]): string {
  const names = [
    ...new Set(
      fields.map((path) => {
        const segments = path.split(".").filter((part) => part !== "input");
        return humanise(segments.at(-1) ?? path);
      }),
    ),
  ];
  if (names.length > 3) return "the highlighted fields";
  if (names.length <= 1) return names[0] ?? "the highlighted fields";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** `basisPoints` -> `basis points`, so the sentence reads as English. */
const humanise = (segment: string): string =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
