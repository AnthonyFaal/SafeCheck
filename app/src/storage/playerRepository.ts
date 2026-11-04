import { getDB, initDB, withRetry, withWriteLock, withDB } from "./db";
import type { RiskProfile } from "../models/RiskProfile";

export type PlayerState = {
  coins: number;
  xp: number;
  difficulty: number;
  phase: number;
  streakDays: number;
  lastPlayedIso?: string | null;
  updatedAtIso: string;
};

export type DailyProgress = {
  dateKey: string;
  streak: number;
  lastPlayedIso?: string | null;
  rewardedPlays: number;
};

/** Maximum number of rewarded (XP/coin-earning) plays per day */
export const REWARDED_PLAYS_PER_DAY = 5;

export function rowsToPlayerState(row: any): PlayerState {
  return {
    coins: Number(row?.coins ?? 0),
    xp: Number(row?.xp ?? 0),
    difficulty: Number(row?.difficulty ?? 1),
    lastPlayedIso: row?.last_played_iso ?? null,
    updatedAtIso: String(row?.updated_at_iso ?? ""),
    streakDays: Number(row?.streak_days ?? 0),
    phase: Number(row?.phase ?? 1)
  };
}

export function toDateKey(d: Date): string {
  // Local date key (mobile-friendly)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getPlayerState(): Promise<PlayerState> {
  await initDB();

  return withDB(async (db) => {
    const row = await db.getFirstAsync<{
      coins: number;
      xp: number;
      difficulty: number;
      phase: number;
      streak_days: number;
      last_played_iso: string | null;
      updated_at_iso: string;
    }>(
      `SELECT 
        coins,
        xp,
        difficulty,
        phase,
        streak_days,
        last_played_iso,
        updated_at_iso
      FROM player_state
      WHERE id = 1;`
    );

    return rowsToPlayerState(row);
  });
}

export async function updatePlayerState(
  patch: Partial<Omit<PlayerState, "updatedAtIso">>
): Promise<PlayerState> {
  await initDB();

  return await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();

      const sets: string[] = [];
      const values: any[] = [];

      if (typeof patch.coins === "number") {
        sets.push("coins = ?");
        values.push(patch.coins);
      }

      if (typeof patch.xp === "number") {
        sets.push("xp = ?");
        values.push(patch.xp);
      }

      if (typeof patch.difficulty === "number") {
        sets.push("difficulty = ?");
        values.push(patch.difficulty);
      }

      if (typeof patch.phase === "number") {
        sets.push("phase = ?");
        values.push(patch.phase);
      }

      if (typeof patch.streakDays === "number") {
        sets.push("streak_days = ?");
        values.push(patch.streakDays);
      }

      sets.push("last_played_iso = ?");
      values.push(patch.lastPlayedIso ?? new Date().toISOString());

      sets.push("updated_at_iso = CURRENT_TIMESTAMP");

      await db.runAsync(
        `UPDATE player_state
        SET ${sets.join(", ")}
        WHERE id = 1;`,
        values
      );

      const updated = await db.getFirstAsync<{
        coins: number;
        xp: number;
        difficulty: number;
        phase: number;
        streak_days: number;
        last_played_iso: string | null;
        updated_at_iso: string;
      }>(
        `SELECT 
          coins,
          xp,
          difficulty,
          phase,
          streak_days,
          last_played_iso,
          updated_at_iso
        FROM player_state
        WHERE id = 1;`
      );

      return rowsToPlayerState(updated);
    })
  );
}

export async function getScenarioPlayCountForDate(
  scenarioId: string,
  dateKey: string
): Promise<number> {
  await initDB();

  return withDB(async (db) => {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
    FROM scenario_history
    WHERE scenario_id = ?
      AND DATE(created_at_iso) = DATE(?)`,
      [scenarioId, dateKey]
    );

    return Number(row?.count ?? 0);
  });
}

export async function recordScenarioOutcome(params: {
  scenarioId: string;
  result: string;
  reactionTimeMs?: number;
  mistakes?: number;
}): Promise<void> {
  await initDB();

  await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();

      await db.runAsync(
        `INSERT INTO scenario_history
        (player_id, scenario_id, result, reaction_time_ms, mistakes, created_at_iso)
        VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP);`,
        [params.scenarioId, params.result, params.reactionTimeMs ?? null, params.mistakes ?? 0]
      );
    })
  );
}

export async function hasPlayedScenarioToday(scenarioId: string, now = new Date()): Promise<boolean> {
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const count = await getScenarioPlayCountForDate(scenarioId, todayKey);
  return count > 0;
}

export async function getRiskProfile(): Promise<RiskProfile> {
  await initDB();

  return withDB(async (db) => {
    const row = await db.getFirstAsync<{
      phishing_score: number;
      social_engineering_score: number;
      financial_score: number;
      identity_score: number;
      password_score: number;
    }>(
      `SELECT
        phishing_score,
        social_engineering_score,
        financial_score,
        identity_score,
        password_score
      FROM risk_profile
      WHERE player_id = 1;`
    );

    return {
      phishing_score: Number(row?.phishing_score ?? 0),
      social_engineering_score: Number(row?.social_engineering_score ?? 0),
      financial_score: Number(row?.financial_score ?? 0),
      identity_score: Number(row?.identity_score ?? 0),
      password_score: Number(row?.password_score ?? 0),
    };
  });
}

/**
 * Returns recently played template IDs (last N unique scenarios),
 * useful for avoiding immediate repeats within a session.
 */
export async function getRecentlyPlayedTemplateIds(limit = 10): Promise<string[]> {
  await initDB();

  return withDB(async (db) => {
    const rows = await db.getAllAsync<{ scenario_id: string }>(
      `SELECT DISTINCT scenario_id
    FROM scenario_history
    WHERE player_id = 1
    ORDER BY id DESC
    LIMIT ?;`,
      [limit]
    );

    return rows.map((r) => r.scenario_id);
  });
}

/**
 * Returns how many rewarded plays the player has used today.
 */
export async function getDailyRewardedPlays(): Promise<number> {
  await initDB();

  return withDB(async (db) => {
    const todayKey = toDateKey(new Date());
    const row = await db.getFirstAsync<{ rewarded_plays: number }>(
      `SELECT rewarded_plays
    FROM daily_progress
    WHERE date_key = ?;`,
      [todayKey]
    );

    return Number(row?.rewarded_plays ?? 0);
  });
}

/**
 * Increments today's rewarded play count. Returns the new count.
 */
export async function incrementDailyRewardedPlays(): Promise<number> {
  await initDB();

  return await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();
      const todayKey = toDateKey(new Date());

      // Ensure row exists first (upsert pattern)
      await db.runAsync(
        `INSERT OR IGNORE INTO daily_progress (date_key, streak, last_played_iso, rewarded_plays, updated_at_iso)
         VALUES (?, 0, NULL, 0, CURRENT_TIMESTAMP);`,
        [todayKey]
      );

      await db.runAsync(
        `UPDATE daily_progress SET rewarded_plays = rewarded_plays + 1, updated_at_iso = CURRENT_TIMESTAMP WHERE date_key = ?;`,
        [todayKey]
      );

      const updated = await db.getFirstAsync<{ rewarded_plays: number }>(
        `SELECT rewarded_plays FROM daily_progress WHERE date_key = ?;`,
        [todayKey]
      );

      return Number(updated?.rewarded_plays ?? 0);
    })
  );
}

export async function getDailyProgress(dateKey: string): Promise<DailyProgress> {
  await initDB();

  return withDB(async (db) => {
    const row = await db.getFirstAsync<{
      date_key: string;
      streak: number;
      last_played_iso: string | null;
      rewarded_plays: number;
    }>(
      `SELECT
        date_key,
        streak,
        last_played_iso,
        rewarded_plays
      FROM daily_progress
      WHERE date_key = ?;`,
      [dateKey]
    );

    return {
      dateKey,
      streak: Number(row?.streak ?? 0),
      lastPlayedIso: row?.last_played_iso ?? null,
      rewardedPlays: Number(row?.rewarded_plays ?? 0),
    };
  });
}

/**
 * Updates daily_progress.streak based on whether last_played day is yesterday.
 * - If already played today: returns existing streak
 * - If played yesterday: streak + 1
 * - If not: streak = 1
 */
export async function touchDailyProgress(now = new Date()): Promise<DailyProgress> {
  await initDB();

  return await withWriteLock(() =>
    withRetry(async () => {
      const db = await getDB();
      const todayKey = toDateKey(now);
      const todayIso = now.toISOString();

      const row = await db.getFirstAsync<{
        date_key: string;
        streak: number;
        last_played_iso: string | null;
      }>(
        `SELECT date_key, streak, last_played_iso
        FROM daily_progress
        WHERE date_key = ?;`,
        [todayKey]
      );

      // If today already exists, return as-is (no re-streaking)
      if (row) {
        return {
          dateKey: todayKey,
          streak: Number(row.streak ?? 0),
          lastPlayedIso: row.last_played_iso ?? null,
          rewardedPlays: 0,
        };
      }

      // Find most recent daily_progress row (to calculate yesterday behavior)
      const last = await db.getFirstAsync<{
        date_key: string;
        streak: number;
        last_played_iso: string | null;
      }>(
        `SELECT date_key, streak, last_played_iso
        FROM daily_progress
        ORDER BY date_key DESC
        LIMIT 1;`
      );

      if (!last || !last.date_key) {
        await db.runAsync(
          `INSERT OR IGNORE INTO daily_progress (date_key, streak, last_played_iso, updated_at_iso)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP);`,
          [todayKey, 1, todayIso]
        );

        return { dateKey: todayKey, streak: 1, lastPlayedIso: todayIso, rewardedPlays: 0 };
      }

      const lastDate = new Date(`${last.date_key}T00:00:00`);
      const diffDays = Math.round((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
      const nextStreak = diffDays === 1 ? Number(last.streak ?? 0) + 1 : 1;

      await db.runAsync(
        `INSERT OR IGNORE INTO daily_progress (date_key, streak, last_played_iso, updated_at_iso)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP);`,
        [todayKey, nextStreak, todayIso]
      );

      // Read back (guarantees row inserted)
      const inserted = await db.getFirstAsync<{
        date_key: string;
        streak: number;
        last_played_iso: string | null;
      }>(
        `SELECT date_key, streak, last_played_iso
        FROM daily_progress
        WHERE date_key = ?;`,
        [todayKey]
      );

      return {
        dateKey: todayKey,
        streak: Number(inserted?.streak ?? nextStreak),
        lastPlayedIso: inserted?.last_played_iso ?? todayIso,
        rewardedPlays: 0,
      };
    })
  );
}

