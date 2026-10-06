import { CircleCheck, Clock3 } from "lucide-react";
import { MONDAY_WAITING, SATURDAY_LOG } from "@/features/marketing/cue-duties";

/**
 * "While you were shooting": one example Saturday of what Cue did on its own,
 * then what it left for Monday. Built in the page, not a screenshot, so the
 * words stay held to features/marketing/cue-duties.ts: every log line is an
 * `on_its_own` duty and every Monday line a `you_approve` one
 * (tests/marketing-claims.test.ts).
 */
export function SaturdayLog() {
  return (
    <figure className="mk-log">
      <div className="mk-log-card">
        <header className="mk-log-head">
          <span className="mk-log-day">Saturday</span>
          <span>While you were out shooting all day</span>
        </header>
        <ol className="mk-log-list">
          {SATURDAY_LOG.map((entry) => (
            <li key={entry.time}>
              <time>{entry.time}</time>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
        <section aria-label="Waiting for you on Monday" className="mk-log-waiting">
          <h3>
            <Clock3 aria-hidden="true" size={16} /> Waiting for you on Monday
          </h3>
          <ul>
            {MONDAY_WAITING.map((item) => (
              <li key={item.text}>
                <CircleCheck aria-hidden="true" size={15} />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="mk-log-total">
          {`${SATURDAY_LOG.length} things done. ${MONDAY_WAITING.length} waiting for one tap each.`}
        </p>
      </div>
      <figcaption>
        An example Saturday. Some of this needs QuickBooks, Google Calendar or your insurance details connected
        first.
      </figcaption>
    </figure>
  );
}
