/**
 * Which job type an imported details form is for.
 *
 * Every imported form was saved as a wedding form, so a studio that imported
 * its corporate brief still saw "Build a form" on every corporate job (Today
 * looks for a form matching the job's type), while setup said the form was
 * done (docs/onboarding-assessment-2026-09-26.md). The form's own name is the
 * best evidence; the three types are the ones StudioCue's starter forms use.
 * A name that says nothing keeps the old answer.
 */
export function questionnaireEventType(name: unknown): "wedding" | "corporate" | "sports" {
  const text = typeof name === "string" ? name.toLowerCase() : "";
  if (/\b(corporate|headshots?|brand(ing)?|conference|business|event brief|company)\b/.test(text)) return "corporate";
  if (/\b(sports?|team|league|tournament|club|match|game day)\b/.test(text)) return "sports";
  return "wedding";
}
