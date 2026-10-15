/**
 * Open a link that has to be fetched first (a signed copy, a stored file) in
 * a new tab. The tab is opened while the tap still counts as a tap: one
 * opened after the await is a pop-up, and Safari on an iPhone blocks it
 * silently — "Download signed copy" did nothing at all (prod walk,
 * 2026-10-14). With pop-ups blocked outright, the page itself goes there.
 */
export async function openInNewTab(getUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("", "_blank");
  let url: string;
  try {
    url = await getUrl();
  } catch (caught) {
    tab?.close();
    throw caught;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    window.location.assign(url);
  }
}
