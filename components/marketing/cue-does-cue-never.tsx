import { Check, ShieldCheck, Sparkles, X } from "lucide-react";

/**
 * What Cue prepares, and what it never does — side by side, so the boundary
 * reads in one glance (docs/marketing-visuals-plan-2026-10-03.md §3).
 *
 * The right-hand column is CLAUDE.md's AI boundary in plain words: AI output
 * never writes payment, signature, permission or readiness-completion fields
 * (tests/ai-write-boundary.test.ts), and model-written drafts always wait for
 * a person. The one exception — routine reminders the studio switches on to
 * send themselves — is deterministic templates, not Cue's writing
 * (features/messaging/trust-dial.ts), and is said in the footnote rather than
 * hidden. Keep the footnote while auto-send exists.
 */
const PREPARES = [
  "Replies to new inquiries, in your voice",
  "Proposals, priced from your packages",
  "The run of show, from your client's answers",
  "Reminders and follow-ups",
  "Crew offers, with the rate on them",
] as const;

const NEVER = [
  { title: "Sends without your yes", text: "Every draft waits for one tap." },
  { title: "Records a payment", text: "That comes from QuickBooks, or from you." },
  { title: "Signs anything", text: "Agreements are signed by people." },
  { title: "Changes who can see what", text: "Permissions are yours alone." },
  { title: "Marks a job ready", text: "Fixed rules decide, never an AI guess." },
] as const;

export function CueDoesCueNever() {
  return (
    <figure className="mk-cue">
      <div className="mk-cue-columns">
        <section aria-label="What Cue prepares" className="mk-cue-col">
          <h3>
            <Sparkles aria-hidden="true" size={17} /> Cue prepares
          </h3>
          <ul>
            {PREPARES.map((item) => (
              <li key={item}>
                <Check aria-hidden="true" size={15} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="What Cue never does" className="mk-cue-col mk-cue-col--never">
          <h3>
            <ShieldCheck aria-hidden="true" size={17} /> Cue never
          </h3>
          <ul>
            {NEVER.map((item) => (
              <li key={item.title}>
                <X aria-hidden="true" size={15} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <figcaption>
        Routine reminders can send on their own, but only the ones you switch on in Settings.
      </figcaption>
    </figure>
  );
}
