"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, LockKeyhole, TriangleAlert } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  getClientAutopayStatus,
  removeClientAutopayCard,
  saveClientAutopayCard,
  tokenizeCardWithIntuit,
  type ClientAutopayStatus,
} from "@/lib/client/portal-client";

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const longDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
    : "its due date";

/** A sample for the demo portal, so the card can be seen without QuickBooks. */
const DEMO_STATUS: ClientAutopayStatus = {
  available: true,
  mock: true,
  tokenUrl: null,
  amountCents: 420000,
  currency: "USD",
  dueDate: "2026-10-03",
  consentText:
    "I authorise the studio to charge this card $4,200.00 for my final balance on October 3, 2026, and to try once more 3 days later if that charge is declined. I can remove the card before then.",
  method: null,
};

const FAILURE_COPY: Record<string, string> = {
  QUICKBOOKS_PAYMENTS_NOT_ACTIVE: "Your studio can't take card payments through QuickBooks yet. Pay with the invoice link instead; nothing was charged.",
  QUICKBOOKS_PAYMENTS_NOT_GRANTED: "Your studio can't take card payments through QuickBooks yet. Pay with the invoice link instead; nothing was charged.",
  CARD_TOKEN_EXPIRED: "That took too long to save. Enter the card again.",
  CARD_REFUSED: "Your bank didn't accept that card. Try another one.",
  CARD_DECLINED: "Your bank didn't accept that card. Try another one.",
};

/**
 * "Save a card for your final balance", on the couple's payments page.
 *
 * Only shown when the studio has autopay on and QuickBooks Payments behind it.
 * Card details go straight to Intuit; the consent the couple ticks is written
 * by the server from the real amount and date, and stored with the card.
 */
export function ClientAutopay() {
  const workspace = useWorkspace();
  const [status, setStatus] = useState<ClientAutopayStatus | null>(dataIsLive ? null : DEMO_STATUS);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [card, setCard] = useState({ name: "", number: "", expMonth: "", expYear: "", cvc: "", postalCode: "" });

  const load = useCallback(async () => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    try {
      setStatus(await getClientAutopayStatus(workspace.tenantId, workspace.projectId));
    } catch {
      // Autopay is an extra; the invoices below still work without it.
      setStatus(null);
    }
  }, [workspace.projectId, workspace.tenantId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // A card being saved settles within seconds; check back until it does.
  useEffect(() => {
    if (status?.method?.status !== "saving") return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load, status?.method?.status]);

  if (!status) return null;
  const method = status.method;
  if (!status.available && method?.status !== "active") return null;

  async function save() {
    if (!status) return;
    setBusy(true);
    setNotice(null);
    try {
      if (!dataIsLive) {
        setStatus({ ...status, method: { id: "demo", status: "active", brand: "Visa", last4: card.number.replace(/\D/g, "").slice(-4) || "4242", expMonth: card.expMonth, expYear: card.expYear, failureCode: null } });
      } else {
        const token = status.mock || !status.tokenUrl
          ? `mock_token_${crypto.randomUUID()}`
          : await tokenizeCardWithIntuit(status.tokenUrl, card);
        await saveClientAutopayCard(workspace.tenantId!, workspace.projectId!, token);
        await load();
      }
      setOpen(false);
      setCard({ name: "", number: "", expMonth: "", expYear: "", cvc: "", postalCode: "" });
      setAgreed(false);
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error && caught.message === "CARD_DETAILS_REJECTED"
          ? "Those card details weren't accepted. Check the number, expiry and security code."
          : friendlyError(caught, "The card could not be saved."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!method || !status) return;
    setBusy(true);
    setNotice(null);
    try {
      if (dataIsLive) {
        await removeClientAutopayCard(workspace.tenantId!, workspace.projectId!, method.id);
        await load();
      } else {
        setStatus({ ...status, method: null });
      }
      setNotice("Card removed. Your final balance won't be charged automatically.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The card could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof card) => ({
    value: card[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setCard((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <section className="panel client-autopay" aria-labelledby="client-autopay-heading">
      <header>
        <CreditCard aria-hidden="true" />
        <span>
          <strong id="client-autopay-heading">
            {method?.status === "active" ? "Your final balance pays itself" : "Pay your final balance automatically"}
          </strong>
          <small>
            {method?.status === "active"
              ? `${method.brand ?? "Card"} ending ${method.last4 ?? ""} will be charged ${money(status.amountCents, status.currency)} on ${longDate(status.dueDate)}. You'll get a receipt by email.`
              : `Save a card and ${money(status.amountCents, status.currency)} is charged on ${longDate(status.dueDate)}, so there's nothing to remember.`}
          </small>
        </span>
      </header>

      {method?.status === "saving" ? (
        <p className="client-autopay-state">
          <LoaderCircle className="spin" size={15} /> Saving your card…
        </p>
      ) : method?.status === "failed" ? (
        <p className="client-autopay-state is-attention" role="alert">
          <TriangleAlert size={15} />
          {FAILURE_COPY[method.failureCode ?? ""] ?? "That card couldn't be saved. Try again or pay with the invoice link."}
        </p>
      ) : null}

      {method?.status === "active" ? (
        <div className="client-autopay-actions">
          <span className="client-autopay-state">
            <CheckCircle2 size={15} /> Card saved
          </span>
          <button className="button button-light" disabled={busy} onClick={() => void remove()} type="button">
            Remove card
          </button>
        </div>
      ) : status.available && !open && method?.status !== "saving" ? (
        <button className="button button-dark" onClick={() => setOpen(true)} type="button">
          Save a card
        </button>
      ) : null}

      {open ? (
        <form
          className="client-autopay-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="is-wide">
            Name on card
            <input autoComplete="cc-name" required {...field("name")} />
          </label>
          <label className="is-wide">
            Card number
            <input autoComplete="cc-number" inputMode="numeric" maxLength={23} pattern="[0-9 ]{12,23}" required {...field("number")} />
          </label>
          <label>
            Month
            <input autoComplete="cc-exp-month" inputMode="numeric" maxLength={2} placeholder="MM" required {...field("expMonth")} />
          </label>
          <label>
            Year
            <input autoComplete="cc-exp-year" inputMode="numeric" maxLength={4} placeholder="YYYY" required {...field("expYear")} />
          </label>
          <label>
            Security code
            <input autoComplete="cc-csc" inputMode="numeric" maxLength={4} required {...field("cvc")} />
          </label>
          <label>
            ZIP / postal code
            <input autoComplete="postal-code" maxLength={10} required {...field("postalCode")} />
          </label>
          <label className="client-autopay-consent is-wide">
            <input checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required type="checkbox" />
            <span>{status.consentText}</span>
          </label>
          <p className="client-autopay-secure is-wide">
            <LockKeyhole aria-hidden="true" size={14} /> Your card details go straight to QuickBooks
            Payments. Your studio and StudioCue never see the full number.
          </p>
          <div className="client-autopay-actions is-wide">
            <button className="button button-dark" disabled={busy || !agreed} type="submit">
              {busy ? <LoaderCircle className="spin" size={14} /> : null}
              Save card
            </button>
            <button className="button button-light" disabled={busy} onClick={() => setOpen(false)} type="button">
              Not now
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
