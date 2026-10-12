/**
 * Upgrading mid-trial keeps the days the user was promised: Checkout sets
 * `trial_end` to the app trial's end so the card is collected now and first
 * charged then. Stripe requires `trial_end` at least 48h out, and a shorter
 * remainder is not worth a trialing subscription, so those users are billed
 * immediately. Shared by the checkout route and the billing panel copy.
 */
export const TRIAL_CARRYOVER_MIN_MS = 48 * 60 * 60 * 1000;

export function honoursRemainingTrial(
  trialEndsAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!trialEndsAt) return false;
  const end = Date.parse(trialEndsAt);
  return Number.isFinite(end) && end - now.getTime() > TRIAL_CARRYOVER_MIN_MS;
}
