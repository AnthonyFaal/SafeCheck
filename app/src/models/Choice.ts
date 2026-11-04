export type Choice = {
  id: string;
  text: string;

  /**
   * Result key used by the consequence engine (e.g. "SAFE", "LOSS", etc.)
   * This is data-driven and not hardcoded in UI.
   */
  resultKey: string;

  /**
   * Optional learning topic to update mastery/weakness (e.g. "OTP_THEFT").
   */
  topicKey?: string;

  /**
   * Optional risk deltas to apply immediately to player risk profile.
   * Values are additive (can be negative).
   */
  riskDelta?: Partial<{
    phishing: number;
    socialEngineering: number;
    financial: number;
    identity: number;
    password: number;
  }>;
};
