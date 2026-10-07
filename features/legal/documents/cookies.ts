import type { LegalDocument } from "../document-types";
import { COOKIES_EFFECTIVE, COOKIES_VERSION, LEGAL_ENTITY } from "../legal";

const { email } = LEGAL_ENTITY;

export const COOKIE_NOTICE: LegalDocument = {
  slug: "cookies",
  path: "/legal/cookies",
  title: "Cookie and Browser Storage Notice",
  description: "The cookies and browser storage StudioCue uses, why, and how to control them. No advertising or cross-site tracking.",
  version: COOKIES_VERSION,
  effective: COOKIES_EFFECTIVE,
  intro: [
    "This notice explains the cookies and similar technologies (such as local storage, session storage and IndexedDB) that StudioCue uses on studio-cue.com and in the Service. It supplements our [Privacy Policy](/privacy).",
    "**In short:** StudioCue uses only the storage it needs to work and to stay secure. We do not use advertising cookies, we do not track you across other websites, and we do not use third-party analytics.",
  ],
  sections: [
    {
      id: "what",
      title: "1. What these technologies are",
      blocks: [
        { p: "Cookies are small text files a website stores in your browser. Local storage, session storage and IndexedDB are similar mechanisms that let a web application keep information on your device between visits. “First-party” storage is set by StudioCue; “third-party” storage is set by another provider whose service is embedded in ours." },
      ],
    },
    {
      id: "use",
      title: "2. What StudioCue uses and why",
      blocks: [
        { table: {
          head: ["Category", "Purpose", "Set by", "Duration"],
          rows: [
            ["Strictly necessary — sign-in", "Keeps you signed in and identifies which workspace you are using, so the Service can show you your data and no one else’s", "StudioCue (Firebase Authentication, in IndexedDB and local storage)", "Until you sign out, or as long as your session remains valid"],
            ["Strictly necessary — security and abuse prevention", "Verifies that requests come from the genuine StudioCue app and a real person, protecting sign-in, inquiry and signing forms from automated abuse", "Google reCAPTCHA Enterprise (Firebase App Check)", "Up to 6 months (Google’s _GRECAPTCHA cookie), and short-lived tokens"],
            ["Functional — preferences", "Remembers choices such as dismissed notices, the last workspace you opened, unsent drafts and view preferences", "StudioCue (local and session storage)", "Until you clear site data, or the end of the browsing session"],
            ["Functional — how you found us", "Remembers the link that brought you to StudioCue (campaign tags, the site that linked here, and any partner or promotion code) so that, if you create a studio, we know which channel or partner to credit. It stays in your browser and reaches us only if you create a studio. Nothing is kept when your browser sends Global Privacy Control", "StudioCue (local storage)", "Until you clear site data"],
            ["Functional — offline access", "Lets crew open an event-day schedule they have already viewed if their connection drops", "StudioCue (service worker cache)", "Until replaced or you clear site data"],
          ],
        } },
        { p: "Google’s use of the information collected through reCAPTCHA is governed by the [Google Privacy Policy](https://policies.google.com/privacy) and [Google Terms of Service](https://policies.google.com/terms)." },
        { p: "Error reports: if StudioCue encounters an error in your browser, it sends us a short technical report of the error, the page and your browser type. Email addresses, links and identifying details are removed before the report is stored. No cookie or identifier is used for this." },
      ],
    },
    {
      id: "not-used",
      title: "3. What StudioCue does not use",
      blocks: [
        { list: [
          "No advertising or retargeting cookies, pixels or tags.",
          "No third-party analytics or session-recording tools.",
          "No social-media tracking plugins.",
          "No sale or sharing of information collected through cookies.",
        ] },
      ],
    },
    {
      id: "control",
      title: "4. Your choices",
      blocks: [
        { p: "Because StudioCue uses only strictly necessary and functional storage, there is no cookie banner and nothing to opt into. You can block or delete cookies and site data through your browser settings; however, blocking strictly necessary storage will prevent you from signing in and using the Service. Clearing functional storage resets your preferences. Global Privacy Control signals are honored as described in our Privacy Policy." },
      ],
    },
    {
      id: "changes",
      title: "5. Changes and contact",
      blocks: [
        { p: `If we begin using a new category of cookie or storage, we will update this notice before doing so and, where the law requires, ask for your consent. Questions: [${email}](mailto:${email}).` },
      ],
    },
  ],
};
