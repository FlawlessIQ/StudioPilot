import type { CSSProperties } from "react";
import { marketingScreen, type ScreenName } from "@/features/marketing/screens";

/**
 * The website's still visuals (docs/marketing-visuals-plan-2026-10-03.md §3):
 * a real screen of Ella & Marcus's wedding, shown in the film's frames — a
 * laptop window for the studio's screens, a phone for the couple's and the
 * crew's. Each image is lazy, 1× and 2×, with its width and height set so
 * nothing jumps as it loads, and its alt text from features/marketing/screens.json.
 */

/** The part of a screenshot to show, as fractions of its width and height. */
export type Crop = { top?: number; bottom?: number; left?: number; right?: number };

/** A numbered marker over a screen, at a point in % of what's shown. */
export type Pin = { x: number; y: number; label: string; text?: string };

function ScreenImage({ name, crop }: { name: ScreenName; crop?: Crop }) {
  const screen = marketingScreen(name);
  const { top = 0, left = 0, right = 1 } = crop ?? {};
  // A crop is a window onto the whole image: the box takes the shown part's
  // shape, and the image is scaled and shifted inside it.
  const style: CSSProperties | undefined = crop
    ? {
        width: `${100 / (right - left)}%`,
        transform: `translate(${-left * 100}%, ${-top * 100}%)`,
      }
    : undefined;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static WebP at 1× and 2×; next/image adds nothing here
    <img
      alt={screen.alt}
      decoding="async"
      height={screen.height}
      loading="lazy"
      src={screen.src}
      srcSet={screen.srcSet}
      style={style}
      width={screen.width}
    />
  );
}

function viewStyle(name: ScreenName, crop?: Crop): CSSProperties | undefined {
  if (!crop) return undefined;
  const { width, height } = marketingScreen(name);
  const { top = 0, bottom = 1, left = 0, right = 1 } = crop;
  return { aspectRatio: `${Math.round(width * (right - left))} / ${Math.round(height * (bottom - top))}` };
}

/**
 * A studio screen in a laptop window, with optional numbered pins and their
 * legend underneath. Pins are HTML over the image, so their numbers stay
 * crisp; the legend is the words, read in order by a screen reader (the
 * numbers on the picture are hidden from it).
 */
export function AnnotatedShot({
  screen,
  crop,
  pins = [],
  caption,
  className,
}: {
  screen: ScreenName;
  crop?: Crop;
  pins?: Pin[];
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={["mk-shot", className].filter(Boolean).join(" ")}>
      <div className="mk-shot-window">
        <div className="mk-shot-view" data-cropped={crop ? "true" : undefined} style={viewStyle(screen, crop)}>
          <ScreenImage crop={crop} name={screen} />
          {pins.map((pin, index) => (
            <span aria-hidden="true" className="mk-pin" key={pin.label} style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      {pins.length > 0 ? (
        <ol className="mk-shot-legend">
          {pins.map((pin, index) => (
            <li key={pin.label}>
              <span aria-hidden="true" className="mk-pin-num">
                {index + 1}
              </span>
              <span>
                <strong>{pin.label}</strong>
                {pin.text ? <small>{pin.text}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/** A couple's or crew member's screen in a phone, with a line under it. */
export function PhoneShot({
  screen,
  caption,
  crop,
  className,
}: {
  screen: ScreenName;
  caption?: string;
  crop?: Crop;
  className?: string;
}) {
  return (
    <figure className={["mk-device", className].filter(Boolean).join(" ")}>
      <div className="mk-device-body">
        <div className="mk-device-screen" data-cropped={crop ? "true" : undefined} style={viewStyle(screen, crop)}>
          <ScreenImage crop={crop} name={screen} />
        </div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
