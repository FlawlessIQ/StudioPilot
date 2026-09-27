/**
 * What to say when "Continue with Google" doesn't finish. Plain data so it can
 * be tested without a browser.
 *
 * Closing the Google window is a change of mind, not an error: say nothing.
 */
export function googleSignInMessage(code: string): string {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the Google window. Allow pop-ups for this site, then try again.";
    case "auth/account-exists-with-different-credential":
      return "That address already has a StudioCue password. Sign in with your email and password instead.";
    case "auth/network-request-failed":
      return "We couldn’t reach Google. Check your connection and try again.";
    default:
      return "We couldn’t sign you in with Google just now. Try again, or use your email and password.";
  }
}
