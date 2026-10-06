import { planCards } from "@/config/saas-plans";
import { ASSISTANT_WAGE } from "@/features/marketing/cue-duties";

/**
 * Hire someone, buy a CRM, or Cue. The wage is the BLS median for an
 * administrative assistant (features/marketing/cue-duties.ts ASSISTANT_WAGE),
 * cited under the table. No competitor is named or priced: "a CRM" is the
 * category, and its cost is the photographer's own time.
 */
const ROWS: ReadonlyArray<{ label: string; hire: string; crm: string; cue: string }> = [
  {
    label: "Who does the work",
    hire: "They do, once you've trained them",
    crm: "You do. It keeps the records",
    cue: "Cue does. You approve what matters",
  },
  {
    label: "Hours",
    hire: "Theirs",
    crm: "Yours, usually evenings",
    cue: "Every hour, weekends included",
  },
  {
    label: "Learns how you work",
    hire: "Over months",
    crm: "Only what you set up",
    cue: "From your own agreement, packages and forms",
  },
  {
    label: "If they leave",
    hire: "You start over",
    crm: "Nothing changes, because you were doing it",
    cue: "Nothing to leave",
  },
];

export function HireComparison() {
  const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
  const cost = {
    hire: `${usd(ASSISTANT_WAGE.annual)} a year, at the US median`,
    crm: "A monthly fee, plus your time",
    cue: `${planCards[0].monthly} a month`,
  };
  return (
    <figure className="mk-compare">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Compared</span>
            </th>
            <th scope="col">Hire an assistant</th>
            <th scope="col">Buy a CRM</th>
            <th className="mk-compare-cue" scope="col">
              Cue
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td data-label="Hire an assistant">{row.hire}</td>
              <td data-label="Buy a CRM">{row.crm}</td>
              <td className="mk-compare-cue" data-label="Cue">
                {row.cue}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">Cost</th>
            <td data-label="Hire an assistant">{cost.hire}</td>
            <td data-label="Buy a CRM">{cost.crm}</td>
            <td className="mk-compare-cue" data-label="Cue">
              <strong>{cost.cue}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <figcaption>
        {`Median pay for ${ASSISTANT_WAGE.occupation}: ${usd(ASSISTANT_WAGE.annual)} a year, $${ASSISTANT_WAGE.hourly.toFixed(2)} an hour. Source: `}
        <a href={ASSISTANT_WAGE.url} rel="noopener noreferrer" target="_blank">
          {ASSISTANT_WAGE.source}
        </a>
        .
      </figcaption>
    </figure>
  );
}
