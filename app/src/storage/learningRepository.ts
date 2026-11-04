import { getDB, initDB, withRetry, withWriteLock, withDB } from "./db";

export async function updateLearningMemory(params: {
  topicKey: string;
  masteryDelta: number;
  weakSet: boolean;
}): Promise<void> {
  // initDB() internally calls getDB(), so no need to call getDB() separately
  await initDB();

  const { topicKey, masteryDelta, weakSet } = params;
  const weakValue = weakSet ? 1 : 0;

  // Wrap both operations in a write lock + transaction for atomicity
  await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();

      await db.runAsync(
        `INSERT OR IGNORE INTO learning_memory
        (topic_key, mastery, attempts, successes, weak, updated_at_iso)
        VALUES (?, 0, 0, 0, 0, CURRENT_TIMESTAMP);`,
        [topicKey]
      );

      await db.runAsync(
        `UPDATE learning_memory
        SET
          mastery = mastery + ?,
          attempts = attempts + 1,
          successes = successes + CASE WHEN ? > 0 THEN 1 ELSE 0 END,
          weak = ?,
          updated_at_iso = CURRENT_TIMESTAMP
        WHERE topic_key = ?;`,
        [masteryDelta, masteryDelta, weakValue, topicKey]
      );
    })
  );
}

export async function updateRiskProfile(params: {
  phishingDelta: number;
  socialEngineeringDelta: number;
  financialDelta: number;
  identityDelta: number;
  passwordDelta: number;
}): Promise<void> {
  // initDB() internally calls getDB(), so no need to call getDB() separately
  await initDB();

  await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();

      await db.runAsync(
        `UPDATE risk_profile
        SET
          phishing_score = phishing_score + ?,
          social_engineering_score = social_engineering_score + ?,
          financial_score = financial_score + ?,
          identity_score = identity_score + ?,
          password_score = password_score + ?,
          updated_at_iso = CURRENT_TIMESTAMP
        WHERE player_id = 1;`,
        [
          params.phishingDelta,
          params.socialEngineeringDelta,
          params.financialDelta,
          params.identityDelta,
          params.passwordDelta,
        ]
      );
    })
  );
}

export type LearningMemoryRow = {
  topicKey: string;
  mastery: number;
  attempts: number;
  successes: number;
  weak: boolean;
};

export async function getLearningMemory(): Promise<LearningMemoryRow[]> {
  await initDB();

  return withDB(async (db) => {
    const rows = await db.getAllAsync<{
      topic_key: string;
      mastery: number;
      attempts: number;
      successes: number;
      weak: number;
    }>(
      `SELECT topic_key, mastery, attempts, successes, weak FROM learning_memory ORDER BY mastery ASC`
    );

    return rows.map((r) => ({
      topicKey: r.topic_key,
      mastery: r.mastery,
      attempts: r.attempts,
      successes: r.successes,
      weak: r.weak === 1,
    }));
  });
}

export async function getWeakTopics(limit = 3): Promise<LearningMemoryRow[]> {
  const all = await getLearningMemory();
  return all.filter((r) => r.weak || r.mastery < 50).slice(0, limit);
}

