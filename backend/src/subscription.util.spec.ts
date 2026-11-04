import { isPremiumActive } from './subscription.util';

describe('isPremiumActive', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it('allows an active Premium subscription within its period', () => {
    expect(isPremiumActive({ plan: 'PREMIUM', status: 'ACTIVE', currentPeriodEndsAt: future })).toBe(true);
  });

  it('keeps a cancelled subscription active through its paid period', () => {
    expect(isPremiumActive({ plan: 'PREMIUM', status: 'CANCELED', currentPeriodEndsAt: future })).toBe(true);
  });

  it('expires Premium when its paid period ends', () => {
    expect(isPremiumActive({ plan: 'PREMIUM', status: 'ACTIVE', currentPeriodEndsAt: past })).toBe(false);
  });
});
