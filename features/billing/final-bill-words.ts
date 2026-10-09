/**
 * What "Send the final bill" says, before and after.
 *
 * For a studio whose finals are checked first (QuickBooks works out the tax
 * and the bill waits, unsent, for "Send with tax"), pressing Send makes the
 * bill and nothing reaches the couple yet. The step said it "goes to
 * {couple} by email… can be voided, not unsent" for every studio, so GR
 * believed a held final had gone and the couple never got it (2026-10-09).
 */
export function finalBillWords(input: {
  checkedFirst: boolean;
  amount: string | null;
  recipient: string | null;
}): { confirmLabel: string; body: string; done: string } {
  const who = input.recipient ?? "the couple";
  if (input.checkedFirst) {
    return {
      confirmLabel: input.amount ? `Make the ${input.amount} bill` : "Make the bill",
      body: `${input.amount ? `A ${input.amount}` : "The"} final bill is made in QuickBooks, which adds the sales tax. Nothing goes to ${who} until you check the tax and press Send with tax.`,
      done: `The final bill is being made in QuickBooks. Nothing has gone to ${who} yet: check the tax on Invoices, then send it.`,
    };
  }
  return {
    confirmLabel: input.amount ? `Send the ${input.amount} bill` : "Send the bill",
    body: `${input.amount ? `A ${input.amount}` : "The"} final bill goes to ${who} by email from your invoicing app. Once it's out it can be voided, not unsent.`,
    done: `The final bill${input.amount ? ` for ${input.amount}` : ""} is on its way; ${who} gets it by email.`,
  };
}
