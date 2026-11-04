export type Message = {
  id: string;
  sender: string;
  text: string;
  /** Optional character key reference for reliable sender resolution. */
  senderKey?: string;
  /**
   * Optional hint for UI effects (typing delay, urgency labeling, etc.)
   */
  tags?: string[];
};
