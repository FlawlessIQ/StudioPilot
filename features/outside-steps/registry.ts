/**
 * Steps a studio has to take outside StudioCue, in one place.
 *
 * Each feature that depends on another company's app used to explain itself
 * in its own words: autopay had a warning box, inquiry capture had guided
 * sheets, and neither could tell whether the studio had done the thing. A
 * step here says what it is, why, where (the exact menu path and a link), who
 * usually does it, how long it takes, what it unlocks, and how StudioCue
 * knows it's done — detected where there is a signal, asked where there isn't.
 *
 * Plain data and pure functions: rendered by components/outside-steps, the
 * ids mirrored in functions/src/integrations/commands.ts (tests keep them in
 * step).
 */

export const OUTSIDE_STEP_IDS = [
  "quickbooks_payments_apply",
  "quickbooks_payments_reconnect",
  "inquiry_capture",
] as const;

export type OutsideStepId = (typeof OUTSIDE_STEP_IDS)[number];

export type OutsideStepInstruction = {
  title: string;
  /** One instruction. `**Label**` marks the other app's own button or menu. */
  text: string;
  /** A click path in the other app, shown as chips. */
  path?: string[];
  link?: { href: string; label: string };
  tip?: string;
};

export type OutsideStep = {
  id: OutsideStepId;
  title: string;
  /** Where it happens. */
  where: string;
  /** Why the studio should bother, in one line. */
  why: string;
  /** Who usually does it. */
  who: string;
  /** How long the other company usually takes, when there is a wait. */
  wait?: string;
  /** What finishing it unlocks in StudioCue. */
  unlocks: string;
  /** Automatic: StudioCue sees it. Manual: the studio tells us. */
  detection: "automatic" | "manual";
  instructions: OutsideStepInstruction[];
  /** Where the step's card lives in StudioCue: the reminder links here. */
  home: string;
  /**
   * How many days a step the studio has started may sit before Today asks
   * about it. Absent: no reminder for waiting.
   */
  waitDays?: number;
  /** The reminder, when a wait runs long. `{days}` is replaced. */
  reminder?: { title: string; detail: string };
  /**
   * For a step StudioCue detects, a way for the studio to say it has started
   * while the proof is still on its way — "I've set it up" before the first
   * inquiry arrives.
   */
  markLabel?: string;
};

export const OUTSIDE_STEPS: Record<OutsideStepId, OutsideStep> = {
  quickbooks_payments_apply: {
    id: "quickbooks_payments_apply",
    title: "Apply for QuickBooks Payments",
    where: "QuickBooks",
    why: "Autopay charges cards through QuickBooks Payments, a merchant account Intuit approves for your business.",
    who: "You, or whoever runs your books",
    wait: "Intuit usually decides in 2–3 business days",
    unlocks: "Couples can save a card and the final balance pays itself",
    detection: "manual",
    home: "/studio/integrations?tab=autopay",
    waitDays: 4,
    reminder: {
      title: "Heard back from Intuit?",
      detail: "You applied for QuickBooks Payments {days} days ago; Intuit usually decides in 2–3 business days. Check your email, then update the step.",
    },
    instructions: [
      {
        title: "Open Payments in QuickBooks",
        text: "Sign in to QuickBooks Online, then open **Settings** (the gear) → **Account and settings** → **Payments**.",
        path: ["Settings", "Account and settings", "Payments"],
        link: { href: "https://qbo.intuit.com/", label: "Open QuickBooks" },
      },
      {
        title: "Apply",
        text: "Choose **Learn more** or **Set up payments** and complete the application: your business details and the bank account payouts go to.",
        tip: "Intuit may ask for ID or a recent bank statement. Have them to hand.",
      },
      {
        title: "Wait for Intuit's email",
        text: "Intuit emails you when you're approved. Come back here and mark this done; then reconnect QuickBooks for payments below.",
      },
    ],
  },
  quickbooks_payments_reconnect: {
    id: "quickbooks_payments_reconnect",
    title: "Let StudioCue take payments through QuickBooks",
    where: "QuickBooks (Intuit's consent screen)",
    why: "StudioCue asks Intuit for one extra permission: to save a couple's card and charge it on the due date.",
    who: "You — whoever connected QuickBooks",
    unlocks: "Switching autopay on for your couples",
    detection: "automatic",
    home: "/studio/integrations?tab=autopay",
    instructions: [
      {
        title: "Reconnect QuickBooks",
        text: "Press **Reconnect QuickBooks for payments** below. Intuit opens and asks you to approve.",
      },
      {
        title: "Approve the payments permission",
        text: "On Intuit's screen, check the list includes **payments**, then choose **Connect**.",
        tip: "Do this after Intuit has approved your QuickBooks Payments application — before then, cards can't be saved.",
      },
      {
        title: "You're back in StudioCue",
        text: "StudioCue sees the new permission and ticks this off by itself.",
      },
    ],
  },
  inquiry_capture: {
    id: "inquiry_capture",
    title: "Send inquiries to StudioCue automatically",
    where: "your website form or inbox",
    why: "Every inquiry lands in StudioCue with a reply drafted, instead of waiting in your inbox for you to copy it across.",
    who: "You, or whoever looks after your website",
    wait: "Done as soon as the first inquiry — or your test — arrives",
    unlocks: "Inquiries on Today with a reply ready to send",
    detection: "automatic",
    home: "/studio/settings/inquiry-capture",
    waitDays: 3,
    markLabel: "I've set it up",
    reminder: {
      title: "No inquiry has come through yet",
      detail: "You set up inquiry capture {days} days ago and nothing has arrived. Send yourself a test to check it works.",
    },
    instructions: [
      {
        title: "Choose how inquiries reach StudioCue",
        text: "In **Inquiry capture**, pick your **website form** (it emails StudioCue too) or your **inbox** (a filter forwards form emails on). Each opens its own step-by-step guide.",
        link: { href: "/studio/settings/inquiry-capture", label: "Open Inquiry capture" },
      },
      {
        title: "Make the change in your form or inbox",
        text: "Follow the guide for your form builder or mail app. It takes a few minutes and uses your StudioCue address.",
      },
      {
        title: "Send a test",
        text: "Use **Test** in Inquiry capture. StudioCue ticks this off the moment the test — or your first real inquiry — arrives.",
      },
    ],
  },
};

export type OutsideStepRecord = { state?: unknown; at?: unknown };

export type OutsideStepStatus = {
  state: "not_started" | "waiting" | "done" | "attention";
  /** Said beside the state. */
  label: string;
  /** StudioCue saw it, rather than being told. */
  detected: boolean;
  /** When the studio said it started or finished. */
  since: string | null;
};

type Signals = {
  /** What the studio told us: tenants/{id}.outsideSteps[stepId]. */
  record?: OutsideStepRecord | null;
  /** QuickBooks is connected with the payments permission. */
  paymentsGranted?: boolean;
  /** A couple's card saved successfully: Payments is active. */
  activeCards?: number;
  /** A card was refused because QuickBooks Payments isn't active. */
  paymentsRefused?: boolean;
  /** An inquiry, or the studio's test, arrived by capture. */
  captured?: boolean;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Where a step stands, from what StudioCue can see and what it was told. */
export function outsideStepStatus(id: OutsideStepId, signals: Signals): OutsideStepStatus {
  const recorded = text(signals.record?.state);
  const since = text(signals.record?.at) || null;
  if (id === "quickbooks_payments_apply") {
    if ((signals.activeCards ?? 0) > 0)
      return { state: "done", label: "Approved — cards are being saved", detected: true, since };
    if (signals.paymentsRefused)
      return {
        state: "attention",
        label: "Intuit says QuickBooks Payments isn't active yet",
        detected: true,
        since,
      };
    if (recorded === "done") return { state: "done", label: "Approved", detected: false, since };
    if (recorded === "waiting")
      return { state: "waiting", label: "Applied — waiting on Intuit", detected: false, since };
    return { state: "not_started", label: "Not started", detected: false, since: null };
  }
  if (id === "inquiry_capture") {
    if (signals.captured)
      return { state: "done", label: "Inquiries are arriving", detected: true, since };
    if (recorded === "waiting" || recorded === "done")
      return { state: "waiting", label: "Set up — waiting for the first inquiry", detected: false, since };
    return { state: "not_started", label: "Not set up", detected: false, since: null };
  }
  // quickbooks_payments_reconnect: Intuit's grant is the proof.
  if (signals.paymentsGranted)
    return { state: "done", label: "Permission granted", detected: true, since };
  return { state: "not_started", label: "Not yet", detected: false, since: null };
}

export type OutsideStepReminder = {
  stepId: OutsideStepId;
  title: string;
  detail: string;
  href: string;
  where: string;
  /** Something went wrong, rather than a wait running long. */
  urgent: boolean;
  since: string | null;
};

/**
 * What Today should say about a step, if anything: a problem the other
 * company reported, or a wait the studio started that has run past its
 * usual length. Steps nobody started are never nagged about.
 */
export function outsideStepReminder(
  id: OutsideStepId,
  status: OutsideStepStatus,
  now: Date,
): OutsideStepReminder | null {
  const step = OUTSIDE_STEPS[id];
  if (status.state === "attention")
    return {
      stepId: id,
      title: `${step.title}: needs a look`,
      detail: `${status.label}.`,
      href: step.home,
      where: step.where,
      urgent: true,
      since: status.since,
    };
  if (status.state !== "waiting" || !step.waitDays || !step.reminder || !status.since) return null;
  const started = Date.parse(status.since);
  if (!Number.isFinite(started)) return null;
  const days = Math.floor((now.getTime() - started) / 86_400_000);
  if (days < step.waitDays) return null;
  return {
    stepId: id,
    title: step.reminder.title,
    detail: step.reminder.detail.replace("{days}", String(days)),
    href: step.home,
    where: step.where,
    urgent: false,
    since: status.since,
  };
}
