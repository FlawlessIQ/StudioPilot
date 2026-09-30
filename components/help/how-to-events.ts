/**
 * Lets anything on the page — a glossary "Learn more", a setup checklist row,
 * a link in Cue — open the How-to popup at a given guide, without threading a
 * context through every tree it might sit in. The popup's host registers
 * itself while mounted; where there is no host (a public page), callers fall
 * back to their link to /how-to/<id>.
 */

const EVENT = "studiocue:how-to";
let hosts = 0;

/** Opens the popup at `id`. False when no popup is mounted to open it. */
export function openHowTo(id: string): boolean {
  if (typeof window === "undefined" || hosts === 0) return false;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
  return true;
}

/** For the popup's host: listen for open requests while mounted. */
export function listenForHowTo(onOpen: (id: string) => void): () => void {
  const handler = (event: Event) => onOpen((event as CustomEvent<string>).detail);
  hosts += 1;
  window.addEventListener(EVENT, handler);
  return () => {
    hosts -= 1;
    window.removeEventListener(EVENT, handler);
  };
}
