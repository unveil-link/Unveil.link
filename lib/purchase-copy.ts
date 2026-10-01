/**
 * Buyer-facing copy for the purchase flow. Pure strings (no server imports) so client and server components can share it.
 * Raw processor/failure codes must never reach the buyer: always go through friendlyFailure().
 */
export const SALES_FINAL_TEXT =
  "All sales are final. Because this is a digital product delivered immediately, purchases can't be refunded or exchanged once completed.";

const FAILURES: Record<string, string> = {
  card_declined: "Your card was declined. Please try a different card.",
  insufficient_funds: "Your card has insufficient funds. Please try a different card.",
  expired_card: "Your card has expired. Please try a different card.",
  incorrect_cvc: "The security code you entered is incorrect. Please check it and try again.",
  invalid_card_number: "That card number doesn't look right. Please check it and try again.",
  unrecognized_test_card: "Your card couldn't be processed. Please try a different card.",
  session_expired: "This checkout has expired. Please go back to the page and start again.",
  superseded: "This checkout was replaced by a newer one. Please go back to the page and start again.",
  session_error: "We couldn't start this checkout. Please try again.",
  unavailable: "This item is no longer available for purchase. You have not been charged.",
  invalid_at_capture: "This purchase could not be completed. If you were charged, the payment is being refunded.",
};
export const GENERIC_FAILURE = "Your payment could not be completed. Please try again or use a different card.";

/** Codes after which the same hosted session may be paid again (card problems only). */
export const RETRYABLE_FAILURES = new Set([
  "card_declined", "insufficient_funds", "expired_card", "incorrect_cvc", "invalid_card_number", "unrecognized_test_card", "declined",
]);

export function friendlyFailure(code: string | null | undefined): string {
  return (code && FAILURES[code]) || GENERIC_FAILURE;
}
