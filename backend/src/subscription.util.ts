import type { Subscription } from '@prisma/client';

export function isPremiumActive(
  subscription: Pick<Subscription, 'plan' | 'status' | 'currentPeriodEndsAt'> | null | undefined,
): boolean {
  if (subscription?.plan !== 'PREMIUM') return false;
  if (!['ACTIVE', 'CANCELED'].includes(subscription.status)) return false;
  return !subscription.currentPeriodEndsAt || subscription.currentPeriodEndsAt > new Date();
}

// Raised temporarily to support product testing without repeated paywalling.
export const FREE_DAILY_SCAN_LIMIT = 50;
export const PREMIUM_DAILY_SCAN_LIMIT = 100;
export const FREE_HISTORY_LIMIT = 5;
export const PREMIUM_HISTORY_LIMIT = 50;
export const FREE_SCENARIO_LIMIT = 3;
