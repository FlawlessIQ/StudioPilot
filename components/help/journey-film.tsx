"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, Play, X } from "lucide-react";
import { HelpVideoPlayer } from "@/components/help/video-player";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { formatMinutes, helpVideo, helpVideoLength } from "@/features/help/videos";
import { JOURNEY_FILM_ID } from "@/features/journey/expected-timeline";

/**
 * The journey film — one wedding, inquiry to album — wherever someone is
 * offered it: the homepage's Watch button, the setup banner, Today's card and
 * the help hub. One dialog and one player for all of them, so a fix to how the
 * film plays lands everywhere at once.
 *
 * Every placement degrades to a plain link to the written page: with no media
 * base (NEXT_PUBLIC_HOW_TO_MEDIA_BASE unset, as in local dev) there is no film
 * to show, and without JavaScript the link is what the button already is.
 *
 * Wedding copy on purpose: callers inside the app show these only to studios
 * that shoot weddings (useStudioJobTypes), as JourneyTodayCard always has.
 */
const FILM_TITLE = "A wedding, start to finish";

function journeyFilm() {
  return helpVideo(JOURNEY_FILM_ID);
}

function JourneyFilmDialog({
  open,
  onClose,
  pageHref,
  startAt,
}: {
  open: boolean;
  onClose: () => void;
  pageHref: string;
  startAt?: number;
}) {
  const film = journeyFilm();
  // Mounted only while open, so each opening starts where its button says.
  if (!film || !open) return null;
  return (
    <SheetDialog label={FILM_TITLE} onClose={onClose} open={open} width="film">
      <div className="journey-film-sheet">
        <header>
          <strong>{FILM_TITLE}</strong>
          <small>
            {`${formatMinutes(film.durationSec)} · from the first inquiry to the album, with your couple’s and your crew’s screens.`}
          </small>
        </header>
        <HelpVideoPlayer autoPlay id={JOURNEY_FILM_ID} startAt={startAt} />
        <Link className="journey-film-page-link" href={pageHref}>
          Read it stage by stage <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
    </SheetDialog>
  );
}

/** A plain click opens the film here; a new-tab click follows the link. */
function opensHere(event: MouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A link to the journey page that, once the page has loaded, opens the film
 * in a dialog instead. `href` is the written page — the public one on the
 * website, the studio's own inside the app — and is also where the dialog's
 * "Read it stage by stage" goes.
 */
export function JourneyFilmButton({
  children,
  className,
  href,
  startAt,
  label,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  /** Seconds into the film to open at: a chapter's start (features/help/video-manifest.json). */
  startAt?: number;
  /** An accessible name, for a button whose children are a picture. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const film = journeyFilm();
  return (
    <>
      <Link
        aria-label={label}
        className={className}
        href={href}
        onClick={(event) => {
          if (!film || !opensHere(event)) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </Link>
      <JourneyFilmDialog onClose={() => setOpen(false)} open={open} pageHref={href} startAt={startAt} />
    </>
  );
}

/**
 * The film's poster with a play button and its length, then a line of words
 * and two ways in: watch it here, or read it stage by stage. Today's card and
 * the help hub. Without a published film it is the words and the link.
 */
export function JourneyFilmTeaser({
  title,
  text,
  pageHref,
  linkLabel = "Read it stage by stage",
}: {
  title: string;
  text: string;
  pageHref: string;
  linkLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const film = journeyFilm();
  const length = film ? formatMinutes(film.durationSec) : null;
  return (
    <div className="journey-film-teaser">
      {film ? (
        <button
          aria-label={`Play the film, ${length}`}
          className="journey-film-poster"
          onClick={() => setOpen(true)}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host */}
          <img alt="" loading="lazy" src={film.posterSrc} />
          <span aria-hidden="true" className="journey-film-play">
            <Play size={18} />
          </span>
          <span aria-hidden="true" className="journey-film-length">
            {length}
          </span>
        </button>
      ) : null}
      <div className="journey-film-teaser-copy">
        <strong>{title}</strong>
        <small>{text}</small>
        <div className="journey-film-teaser-actions">
          {film ? (
            <button className="button button-dark" onClick={() => setOpen(true)} type="button">
              <Play aria-hidden="true" size={15} /> Watch · {length}
            </button>
          ) : null}
          <Link className={film ? "journey-film-page-link" : "button button-light"} href={pageHref}>
            {film ? linkLabel : "Take a look"} <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </div>
      </div>
      <JourneyFilmDialog onClose={() => setOpen(false)} open={open} pageHref={pageHref} />
    </div>
  );
}

/**
 * Dismissed per person, in this browser: a convenience, not a record. Read
 * after hydration (the server can't see localStorage), so a dismissed card
 * never renders on the server and never flashes; if storage is unavailable the
 * card hides for this visit only and shows again next time.
 */
const DISMISS_EVENT = "studiocue:dismissed";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function useDismissed(key: string): [boolean, () => void] {
  const subscribe = useCallback((changed: () => void) => {
    window.addEventListener(DISMISS_EVENT, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(DISMISS_EVENT, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  const stored = useSyncExternalStore(
    subscribe,
    () => readFlag(key),
    // Hidden on the server: shown only once the browser says it wasn't dismissed.
    () => true,
  );
  const [hiddenNow, setHiddenNow] = useState(false);
  const dismiss = useCallback(() => {
    setHiddenNow(true);
    try {
      window.localStorage.setItem(key, "1");
      window.dispatchEvent(new Event(DISMISS_EVENT));
    } catch {
      // Hidden for this visit only.
    }
  }, [key]);
  return [stored || hiddenNow, dismiss];
}

/**
 * Setup's first line, before the questions: the film, for a studio about to
 * configure something it has never seen run. The caller shows it only to a
 * studio that shoots weddings. Gone once dismissed, per person; absent
 * altogether where the film isn't published.
 */
export function JourneySetupBanner() {
  const { userId } = useWorkspace();
  const [dismissed, dismiss] = useDismissed(`studiocue.journeySetupBanner.dismissed:${userId ?? "anon"}`);
  const length = helpVideoLength(JOURNEY_FILM_ID);
  if (dismissed || !length) return null;
  return (
    <div className="journey-film-banner">
      <JourneyFilmButton className="journey-film-banner-link" href="/studio/help/journey">
        <span aria-hidden="true" className="journey-film-banner-play">
          <Play size={13} />
        </span>
        <span>
          <strong>Before you start:</strong> watch a wedding run, start to finish · {length}
        </span>
      </JourneyFilmButton>
      <button aria-label="Hide this" className="journey-today-dismiss" onClick={dismiss} type="button">
        <X size={15} />
      </button>
    </div>
  );
}
