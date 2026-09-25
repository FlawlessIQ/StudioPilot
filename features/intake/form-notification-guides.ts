/**
 * How to make a website form email StudioCue directly — alongside the
 * studio's own inbox, not instead of it.
 *
 * Each path uses the builder's own labels, so a studio can follow it with the
 * builder open beside StudioCue. Checked against each builder's help centre on
 * 2026-09-25. Where a builder allows only one recipient (Squarespace, Showit,
 * Pixieset, Google Forms), pointing the form at StudioCue would stop the
 * studio receiving its own inquiries, so those are `supported: false` and the
 * setup sends the studio to the inbox route instead.
 */

export type NotificationGuideKey =
  | "wix"
  | "wordpress_cf7"
  | "wpforms"
  | "gravity_forms"
  | "jotform"
  | "squarespace"
  | "showit"
  | "pixieset"
  | "google_forms";

export type NotificationGuide = {
  key: NotificationGuideKey;
  label: string;
  supported: boolean;
  /** The clicks, in the builder's own words. */
  path: string[];
  /** Where the path starts. */
  link?: string;
  /** One line: the catch, or — when unsupported — why. */
  note?: string;
};

export const NOTIFICATION_GUIDES: ReadonlyArray<NotificationGuide> = [
  {
    key: "wix",
    label: "Wix",
    supported: true,
    path: ["Contacts: add your StudioCue address", "Automations", "Your form's automation", "Send an email", "Recipients", "Pick that contact"],
    link: "https://manage.wix.com/account/sites",
    note: "Wix only emails contacts, so add the address as a contact first.",
  },
  {
    key: "wordpress_cf7",
    label: "Contact Form 7",
    supported: true,
    path: ["Contact", "Your form", "Mail", "To: add a comma, then the address", "Save"],
  },
  {
    key: "wpforms",
    label: "WPForms",
    supported: true,
    path: ["WPForms", "Your form", "Settings", "Notifications", "Send To: add a comma, then the address"],
    note: "No space after the comma.",
  },
  {
    key: "gravity_forms",
    label: "Gravity Forms",
    supported: true,
    path: ["Forms", "Your form", "Settings", "Notifications", "Admin Notification", "Send To: add a comma, then the address"],
  },
  {
    key: "jotform",
    label: "Jotform",
    supported: true,
    path: ["Your form", "Settings", "Emails", "Notification Email", "Recipients", "Add the address"],
    link: "https://www.jotform.com/myforms/",
    note: "Needs a paid plan. The free plan allows one recipient, so use your inbox instead.",
  },
  {
    key: "squarespace",
    label: "Squarespace",
    supported: false,
    path: [],
    note: "Squarespace sends each form to one address only — yours.",
  },
  {
    key: "showit",
    label: "Showit",
    supported: false,
    path: [],
    note: "Showit sends form emails to your account email only.",
  },
  {
    key: "pixieset",
    label: "Pixieset",
    supported: false,
    path: [],
    note: "Pixieset sends inquiries to your account email only.",
  },
  {
    key: "google_forms",
    label: "Google Forms",
    supported: false,
    path: [],
    note: "Google Forms only alerts the form's owner.",
  },
];
