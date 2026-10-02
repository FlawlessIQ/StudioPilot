import { Camera, CircleCheck, Heart, Sparkles, Store } from "lucide-react";
import { RichText } from "@/components/help/rich-text";
import { HelpVideoPlayer } from "@/components/help/video-player";
import { JourneyLaneScope, JourneyLaneSwitch } from "@/components/help/wedding-journey-lanes";
import {
  EXPECTED_TIMELINE,
  JOURNEY_FILM_ID,
  JOURNEY_STOPS,
  whenLabel,
  type ExpectedStage,
  type JourneyMoment,
} from "@/features/journey/expected-timeline";

/**
 * "A wedding, start to finish" — one wedding from inquiry to closed: what
 * StudioCue does by itself, what the studio approves, and what the couple and
 * the crew see at each stage. The same view renders in the studio
 * (/studio/help/journey) and on the website (/how-to/wedding-journey).
 *
 * Every word and every timing comes from features/journey/expected-timeline.ts,
 * which tests/expected-timeline.test.ts holds to the schedulers. The film and
 * its chapters appear by themselves once the video pipeline publishes them to
 * the manifest; until then the page is complete as text.
 */
export function WeddingJourney() {
  const firstOfStop = new Map<string, string>();
  for (const stage of EXPECTED_TIMELINE) if (!firstOfStop.has(stage.stop)) firstOfStop.set(stage.stop, stage.id);
  return (
    <JourneyLaneScope>
      <nav aria-label="The stages of a wedding" className="journey-stops">
        <ol>
          {JOURNEY_STOPS.map((stop) => (
            <li key={stop.id}>
              <a href={`#stage-${firstOfStop.get(stop.id)}`}>
                <span aria-hidden="true" className="journey-stop-dot" />
                {stop.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <HelpVideoPlayer id={JOURNEY_FILM_ID} />

      <div className="journey-legend">
        <span>
          <Sparkles aria-hidden="true" size={15} /> StudioCue does this by itself
        </span>
        <span>
          <CircleCheck aria-hidden="true" size={15} /> You approve — usually one tap on Today
        </span>
      </div>

      <ol className="journey-stages">
        {EXPECTED_TIMELINE.map((stage, index) => (
          <Stage index={index + 1} key={stage.id} stage={stage} />
        ))}
      </ol>

      <p className="journey-footnote">
        Timings are StudioCue&rsquo;s defaults. You can change the planning form, the lock, the
        crew answer window and which messages send themselves in Settings.
      </p>
    </JourneyLaneScope>
  );
}

function Stage({ stage, index }: { stage: ExpectedStage; index: number }) {
  return (
    <li className="journey-stage" id={`stage-${stage.id}`}>
      <header className="journey-stage-head">
        <span aria-hidden="true" className="journey-stage-num">
          {index}
        </span>
        <p className="journey-stage-when">{stage.when}</p>
        <h2>{stage.title}</h2>
        <p className="journey-stage-summary">{stage.summary}</p>
      </header>

      <HelpVideoPlayer id={stage.video ?? undefined} />

      <JourneyLaneSwitch stage={stage.title} />

      <div className="journey-lanes">
        <section className="journey-lane" data-lane="you">
          <h3>
            <Store aria-hidden="true" size={14} /> You
          </h3>
          <div className="journey-group is-auto">
            <h4>
              <Sparkles aria-hidden="true" size={14} /> StudioCue does this by itself
            </h4>
            <Moments empty="Nothing runs by itself here." moments={stage.byItself} />
          </div>
          <div className="journey-group is-approve">
            <h4>
              <CircleCheck aria-hidden="true" size={14} /> You approve
            </h4>
            <Moments empty="Nothing to approve. This is the quiet part." moments={stage.youApprove} />
          </div>
        </section>
        <section className="journey-lane" data-lane="couple">
          <h3>
            <Heart aria-hidden="true" size={14} /> Your couple
          </h3>
          <div className="journey-group is-plain">
            <Moments empty="Nothing for them yet." moments={stage.couple} />
          </div>
        </section>
        <section className="journey-lane" data-lane="crew">
          <h3>
            <Camera aria-hidden="true" size={14} /> Your crew
          </h3>
          <div className="journey-group is-plain">
            <Moments empty="Nothing for your crew yet." moments={stage.crew ?? []} />
          </div>
        </section>
      </div>
    </li>
  );
}

function Moments({ moments, empty }: { moments: JourneyMoment[]; empty: string }) {
  if (!moments.length) return <p className="journey-empty">{empty}</p>;
  return (
    <ul className="journey-items">
      {moments.map((moment) => (
        <li key={moment.text}>
          {moment.at ? <span className="journey-when">{whenLabel(moment.at)}</span> : null}
          <span>
            <RichText text={moment.text} />
          </span>
          {moment.note ? <small className="journey-note">{moment.note}</small> : null}
        </li>
      ))}
    </ul>
  );
}
