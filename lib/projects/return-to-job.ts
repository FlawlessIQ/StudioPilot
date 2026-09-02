import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Finishing a step takes you back to the job.
 *
 * Every journey step is reached from the job page — "YOUR NEXT MOVE" links to
 * the page where the work happens. Nothing linked back. Publishing a run of
 * show set a notice near the top of a long page and left you sitting at the
 * bottom next to the button you had just pressed, with no way to tell whether
 * it had worked. The reported symptom was "I don't know if it worked", and the
 * honest reading is that the page said so somewhere you could not see.
 *
 * A notice further up is not the fix. The job page already shows the step as
 * complete and names the next move, so returning there *is* the confirmation,
 * and it is the same answer for every step rather than a bespoke message per
 * page.
 *
 * The short delay is deliberate: the success notice should be readable before
 * the view changes, so the outcome is stated and then demonstrated. Pass
 * `delayMs: 0` where the caller has already shown one.
 */
export function useReturnToJob(projectId: string | null) {
  const router = useRouter();
  return useCallback(
    (options?: { delayMs?: number }) => {
      // `window.location` rather than `useSearchParams`, which would oblige
      // every page using this to sit inside a Suspense boundary. This only
      // ever runs from a click handler, so the window is always there.
      const search =
        typeof window === "undefined" ? "" : window.location.search;
      const requested = new URLSearchParams(search).get("returnTo");
      // Only ever an in-app path: a `returnTo` arrives from the URL, and
      // pushing whatever it says would be an open redirect.
      const explicit =
        requested && /^\/[a-z]/.test(requested) && !requested.startsWith("//")
          ? requested
          : null;
      const target =
        explicit ??
        (projectId ? `/studio/projects/${projectId}` : "/studio/projects");
      const delay = options?.delayMs ?? 1100;
      if (delay <= 0) {
        router.push(target);
        return;
      }
      window.setTimeout(() => router.push(target), delay);
    },
    [projectId, router],
  );
}
