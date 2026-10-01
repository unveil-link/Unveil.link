/**
 * Deterministic test cards for the mock processor. No card data is ever stored: only the outcome is derived,
 * from the last four digits (so `4242 4242 4242 4242`, `5555 5555 5555 4242`, ... all work).
 *   4242 -> approved           0002 -> card_declined      9995 -> insufficient_funds
 *   0069 -> expired_card       0127 -> incorrect_cvc      anything else -> declined (unrecognized_test_card)
 */
export type CardOutcome = { approved: true } | { approved: false; failureCode: string };

export const TEST_CARDS = {
  approved: "4242424242424242",
  declined: "4000000000000002",
  insufficientFunds: "4000000000009995",
  expired: "4000000000000069",
  badCvc: "4000000000000127",
} as const;

export function cardOutcome(cardNumber: string): CardOutcome {
  const digits = cardNumber.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits)) return { approved: false, failureCode: "invalid_card_number" };
  switch (digits.slice(-4)) {
    case "4242": return { approved: true };
    case "0002": return { approved: false, failureCode: "card_declined" };
    case "9995": return { approved: false, failureCode: "insufficient_funds" };
    case "0069": return { approved: false, failureCode: "expired_card" };
    case "0127": return { approved: false, failureCode: "incorrect_cvc" };
    default: return { approved: false, failureCode: "unrecognized_test_card" };
  }
}
