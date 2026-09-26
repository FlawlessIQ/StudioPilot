/**
 * How to make a website form email StudioCue directly — alongside the
 * studio's own inbox, not instead of it.
 *
 * Each guide is a numbered set of plain instructions, with the builder's own
 * button and menu names in **bold** so a studio can follow them with the
 * builder open beside StudioCue. (They were a row of breadcrumb chips —
 * "Contacts › Automations › Your form's automation…" — which said where to go
 * but not what to do there; a studio owner couldn't follow them.) A step can
 * carry the one thing it needs: the address to copy, or a link to open.
 *
 * Checked against each builder's help centre on 2026-09-25. Where a builder
 * allows only one recipient (Squarespace, Showit, Pixieset, Google Forms),
 * pointing the form at StudioCue would stop the studio receiving its own
 * inquiries, so those are `supported: false` and the setup offers the inbox
 * route instead.
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
  | "google_forms"
  | "other";

export type GuideStep = {
  /** One instruction. `**Label**` marks the builder's own button or menu name. */
  text: string;
  /** What this step needs to hand the studio: the address, or the builder. */
  action?: "copy" | "open";
};

export type NotificationGuide = {
  key: NotificationGuideKey;
  label: string;
  supported: boolean;
  steps: GuideStep[];
  /** Where the steps start. */
  link?: string;
  /** One line: the catch, or — when unsupported — why. */
  note?: string;
};

export const NOTIFICATION_GUIDES: ReadonlyArray<NotificationGuide> = [
  {
    key: "wix",
    label: "Wix",
    supported: true,
    link: "https://manage.wix.com/account/sites",
    steps: [
      { text: "Open your site's **Dashboard** in Wix and go to **Contacts**.", action: "open" },
      {
        text: "Click **+ New Contact**. Name it **StudioCue inquiries**, paste your StudioCue address as its **Email**, and **Save**.",
        action: "copy",
      },
      {
        text: "Go to **Automations** and open the one that runs when your contact form is submitted. Wix usually names it after the form.",
      },
      {
        text: "In its **Send an email** action, click **Show additional settings**, then **Edit** next to **Recipients**.",
      },
      {
        text: "Tick **StudioCue inquiries** — keep yourself ticked too — then **Apply** and **Save** the automation.",
      },
    ],
    note: "Wix can only email your contacts, which is why the address goes in as a contact first.",
  },
  {
    key: "wordpress_cf7",
    label: "Contact Form 7",
    supported: true,
    steps: [
      { text: "In WordPress, go to **Contact → Contact Forms** and open your inquiry form." },
      { text: "Open the **Mail** tab." },
      {
        text: "In the **To** field, after your own address, type a comma and paste your StudioCue address.",
        action: "copy",
      },
      { text: "Click **Save**." },
    ],
  },
  {
    key: "wpforms",
    label: "WPForms",
    supported: true,
    steps: [
      { text: "In WordPress, go to **WPForms → All Forms** and click **Edit** on your inquiry form." },
      { text: "Open **Settings → Notifications**." },
      {
        text: "In **Send To Email Address**, after your own address, type a comma and paste your StudioCue address.",
        action: "copy",
      },
      { text: "Click **Save**." },
    ],
    note: "No space after the comma — WPForms reads it as part of the address.",
  },
  {
    key: "gravity_forms",
    label: "Gravity Forms",
    supported: true,
    steps: [
      { text: "In WordPress, go to **Forms**, hover your inquiry form and choose **Settings → Notifications**." },
      { text: "Click **Edit** on the **Admin Notification**." },
      {
        text: "In **Send To Email**, after your own address, type a comma and paste your StudioCue address.",
        action: "copy",
      },
      { text: "Click **Update Notification**." },
    ],
  },
  {
    key: "jotform",
    label: "Jotform",
    supported: true,
    link: "https://www.jotform.com/myforms/",
    steps: [
      { text: "Open your inquiry form in **Jotform**'s Form Builder.", action: "open" },
      { text: "Go to **Settings → Emails**, hover the **Notification Email** and click **Edit**." },
      {
        text: "Open the **Recipients** tab and add your StudioCue address under **Recipient Emails**.",
        action: "copy",
      },
      { text: "Click **Save**." },
    ],
    note: "Adding a second recipient needs a paid Jotform plan. On the free plan, use your inbox instead.",
  },
  {
    key: "squarespace",
    label: "Squarespace",
    supported: false,
    steps: [],
    note: "Squarespace sends each form's emails to one address only — yours — so it can't send StudioCue a copy.",
  },
  {
    key: "showit",
    label: "Showit",
    supported: false,
    steps: [],
    note: "Showit sends form emails to your account email only, so it can't send StudioCue a copy.",
  },
  {
    key: "pixieset",
    label: "Pixieset",
    supported: false,
    steps: [],
    note: "Pixieset sends inquiries to your account email only, so it can't send StudioCue a copy.",
  },
  {
    key: "google_forms",
    label: "Google Forms",
    supported: false,
    steps: [],
    note: "Google Forms only alerts the form's owner, so it can't send StudioCue a copy.",
  },
  {
    key: "other",
    label: "Something else / not sure",
    supported: false,
    steps: [],
    note: "No problem — forwarding from your inbox works with any form, whoever runs it.",
  },
];
