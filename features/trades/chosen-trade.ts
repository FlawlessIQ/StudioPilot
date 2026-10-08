import { isTrade, tradeOf, type Trade } from "@/features/trades/trades";

/**
 * The trade a visitor arrived with, carried to "What do you do?" at signup.
 *
 * `/auth/register?trade=dj` from a DJ landing page, or a vendor invite, is
 * remembered here and preselects the question after the email is verified,
 * the way `?plan=` is (features/subscriptions/chosen-plan.ts). Browser storage
 * is enough: the studio answers the question itself, and the server takes
 * only a trade it knows.
 */
const KEY = "studiocue.chosenTrade";

export function rememberChosenTrade(value: string | null | undefined): void {
  if (!isTrade(value)) return;
  try {
    window.localStorage.setItem(KEY, tradeOf(value));
  } catch {
    // Private mode or blocked storage: the question starts on photography.
  }
}

export function chosenTrade(): Trade | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return isTrade(value) ? tradeOf(value) : null;
  } catch {
    return null;
  }
}
