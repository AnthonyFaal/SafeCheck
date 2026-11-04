export type LearningUpdate = {
  topicKey: string;
  masteryDelta: number;
  weakSet?: boolean;
};

export class MemoryEngine {
  /**
   * Converts an engine outcome into learning-memory updates.
   * V0.1: SAFE => mastery +, LOSS => mastery - (weakness flag).
   */
  deriveUpdateFromOutcome(topicKey: string | undefined, outcomeKey: string): LearningUpdate | null {
    if (!topicKey) return null;

    if (outcomeKey === 'SAFE') {
      return { topicKey, masteryDelta: 10, weakSet: false };
    }
    if (outcomeKey === 'LOSS') {
      return { topicKey, masteryDelta: -8, weakSet: true };
    }

    return { topicKey, masteryDelta: 0, weakSet: false };
  }
}
