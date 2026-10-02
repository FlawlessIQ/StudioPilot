"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * The one piece of "A wedding, start to finish" that needs the browser: on a
 * phone the three lanes (You · Your couple · Your crew) can't sit side by
 * side, so each stage shows one, with a switch. The switches are one setting,
 * not one per stage — a studio asking "what does my couple see?" taps once
 * and reads the whole wedding from the couple's side.
 *
 * Which lanes show is CSS (app/help.css, under `.journey`): wide enough and
 * all three are side by side and the switches hide.
 */

export type JourneyLane = "you" | "couple" | "crew";

const LANES: Array<{ lane: JourneyLane; label: string }> = [
  { lane: "you", label: "You" },
  { lane: "couple", label: "Your couple" },
  { lane: "crew", label: "Your crew" },
];

const LaneContext = createContext<{ lane: JourneyLane; setLane: (lane: JourneyLane) => void }>({
  lane: "you",
  setLane: () => undefined,
});

export function JourneyLaneScope({ children }: { children: ReactNode }) {
  const [lane, setLane] = useState<JourneyLane>("you");
  return (
    <LaneContext.Provider value={{ lane, setLane }}>
      <div className="journey" data-lane={lane}>
        {children}
      </div>
    </LaneContext.Provider>
  );
}

export function JourneyLaneSwitch({ stage }: { stage: string }) {
  const { lane, setLane } = useContext(LaneContext);
  return (
    <div aria-label={`Whose side of ${stage} to show`} className="journey-switch" role="group">
      {LANES.map((option) => (
        <button
          aria-pressed={lane === option.lane}
          key={option.lane}
          onClick={() => setLane(option.lane)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
