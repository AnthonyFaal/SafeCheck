import { getDB, withWriteLock, withRetry } from '../storage/db';
import { rowsToPlayerState, toDateKey, REWARDED_PLAYS_PER_DAY } from '../storage/playerRepository';
import type { PlayerState } from '../storage/playerRepository';
import type { Choice } from '../models/Choice';
import type { EngineResult } from '../core/game/GameEngine';
import { MemoryEngine } from '../core/learning/MemoryEngine';

export type PersistOutcomeParams = {
  result: EngineResult;
  choice: Choice;
  player: PlayerState;
  rewardedPlaysLeft: number;
  scenarioPlayCount: number | null;
};

export type PersistOutcomeResult = {
  updatedPlayer: PlayerState;
  bonusMessage: string;
  isRewarded: boolean;
};

/**
 * Persists a game outcome in a single atomic SQLite transaction.
 * All DB writes succeed together or roll back together — no data inconsistency.
 */
export async function persistGameOutcome(
  params: PersistOutcomeParams
): Promise<PersistOutcomeResult> {
  const { result, choice, player, rewardedPlaysLeft, scenarioPlayCount } = params;

  const outcomeKey =
    result.step.type === 'consequence' ? result.step.consequence.outcomeKey : 'UNKNOWN';
  const isSafe = outcomeKey === 'SAFE';
  const alreadyPlayedToday = scenarioPlayCount != null && scenarioPlayCount > 0;
  const rewardedCapExhausted = rewardedPlaysLeft <= 0;
  const isRewarded = !alreadyPlayedToday && !rewardedCapExhausted;

  const coinsEarned = isRewarded ? (isSafe ? 10 : 3) : 0;
  const xpEarned = isRewarded ? (isSafe ? 20 : 8) : 0;
  const nextXp = (player?.xp ?? 0) + xpEarned;
  const nextCoins = (player?.coins ?? 0) + coinsEarned;
  const difficultyDelta = isRewarded ? (isSafe ? 1 : -1) : 0;
  const nextDifficulty = Math.min(5, Math.max(1, (player?.difficulty ?? 1) + difficultyDelta));

  const nextPhase = nextXp >= 3000 ? 4 : nextXp >= 1500 ? 3 : nextXp >= 500 ? 2 : 1;

  return await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();

      // BEGIN atomic transaction
      await db.execAsync('BEGIN TRANSACTION;');

      try {
        // 1. Update player state
        await db.runAsync(
          `UPDATE player_state SET
            xp = ?,
            coins = ?,
            difficulty = ?,
            phase = ?,
            last_played_iso = ?,
            updated_at_iso = CURRENT_TIMESTAMP
          WHERE id = 1;`,
          [nextXp, nextCoins, nextDifficulty, nextPhase, new Date().toISOString()]
        );

        // 2. Record scenario outcome
        await db.runAsync(
          `INSERT INTO scenario_history
            (player_id, scenario_id, result, mistakes, created_at_iso)
          VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP);`,
          [result.scenario.templateId, outcomeKey, outcomeKey === 'SAFE' ? 0 : 1]
        );

        // 3. Update daily progress
        const todayKey = toDateKey(new Date());

        // Check if today's row exists
        const existingDaily = await db.getFirstAsync<{ streak: number }>(
          `SELECT streak FROM daily_progress WHERE date_key = ?;`,
          [todayKey]
        );

        if (!existingDaily) {
          // Calculate streak by checking last played date
          const lastDaily = await db.getFirstAsync<{ date_key: string; streak: number }>(
            `SELECT date_key, streak FROM daily_progress ORDER BY date_key DESC LIMIT 1;`
          );

          let streak = 1;
          if (lastDaily?.date_key) {
            const lastDate = new Date(lastDaily.date_key + 'T00:00:00');
            const diffDays = Math.round(
              (new Date().getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000)
            );
            streak = diffDays === 1 ? (lastDaily.streak ?? 0) + 1 : 1;
          }

          await db.runAsync(
            `INSERT INTO daily_progress (date_key, streak, last_played_iso, rewarded_plays, updated_at_iso)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP);`,
            [
              todayKey,
              streak,
              new Date().toISOString(),
              isRewarded ? 1 : 0,
            ]
          );
        } else {
          // Update existing daily row
          if (isRewarded) {
            await db.runAsync(
              `UPDATE daily_progress SET
                rewarded_plays = rewarded_plays + 1,
                last_played_iso = ?,
                updated_at_iso = CURRENT_TIMESTAMP
              WHERE date_key = ?;`,
              [new Date().toISOString(), todayKey]
            );
          }
        }

        // 4. Update learning memory
        const memoryEngine = new MemoryEngine();
        const learning = memoryEngine.deriveUpdateFromOutcome(choice.topicKey, outcomeKey);
        if (learning) {
          await db.runAsync(
            `INSERT OR IGNORE INTO learning_memory
              (topic_key, mastery, attempts, successes, weak, updated_at_iso)
            VALUES (?, 0, 0, 0, 0, CURRENT_TIMESTAMP);`,
            [learning.topicKey]
          );

          await db.runAsync(
            `UPDATE learning_memory SET
              mastery = mastery + ?,
              attempts = attempts + 1,
              successes = successes + CASE WHEN ? > 0 THEN 1 ELSE 0 END,
              weak = ?,
              updated_at_iso = CURRENT_TIMESTAMP
            WHERE topic_key = ?;`,
            [learning.masteryDelta, learning.masteryDelta, learning.weakSet ? 1 : 0, learning.topicKey]
          );
        }

        // 5. Update risk profile (if choice has risk delta)
        if (choice.riskDelta) {
          await db.runAsync(
            `UPDATE risk_profile SET
              phishing_score = phishing_score + ?,
              social_engineering_score = social_engineering_score + ?,
              financial_score = financial_score + ?,
              identity_score = identity_score + ?,
              password_score = password_score + ?,
              updated_at_iso = CURRENT_TIMESTAMP
            WHERE player_id = 1;`,
            [
              choice.riskDelta.phishing ?? 0,
              choice.riskDelta.socialEngineering ?? 0,
              choice.riskDelta.financial ?? 0,
              choice.riskDelta.identity ?? 0,
              choice.riskDelta.password ?? 0,
            ]
          );
        }

        // COMMIT — all writes succeed together
        await db.execAsync('COMMIT;');

        // Read back updated player state
        const updatedRow = await db.getFirstAsync<{
          coins: number;
          xp: number;
          difficulty: number;
          phase: number;
          streak_days: number;
          last_played_iso: string | null;
          updated_at_iso: string;
        }>(
          `SELECT coins, xp, difficulty, phase, streak_days, last_played_iso, updated_at_iso
           FROM player_state WHERE id = 1;`
        );

        const updatedPlayer = rowsToPlayerState(updatedRow);

        const bonusMessage = rewardedCapExhausted
          ? 'Daily reward limit reached — still earning useful practice data!'
          : alreadyPlayedToday
            ? 'Already completed today — no extra XP or coins, but good practice!'
            : `+${xpEarned} XP · +${coinsEarned} coins earned`;

        return { updatedPlayer, bonusMessage, isRewarded };
      } catch (error) {
        // ROLLBACK on any failure — data stays consistent
        await db.execAsync('ROLLBACK;');
        throw error;
      }
    })
  );
}

