import * as SQLite from "expo-sqlite";

const DB_NAME = "scam_awareness.db";

type DB = SQLite.SQLiteDatabase;

let database: DB | null = null;
let dbInitialized = false;

/**
 * Shared promise for database opening — ensures only ONE call to openDatabaseAsync.
 * All concurrent callers await this same promise.
 */
let dbOpenPromise: Promise<DB> | null = null;

/**
 * Shared promise for database initialization (DDL) — ensures only ONE init runs.
 * All concurrent callers await this same promise, preventing racing DDL calls.
 */
let initPromise: Promise<void> | null = null;

/**
 * Write serialization queue — ensures all write operations execute sequentially.
 * Each write is chained onto this promise, preventing concurrent write-write conflicts.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Monotonically increasing counter that increments each time a new database
 * connection is opened. Used to detect stale connections (e.g. after hot reload)
 * where the native handle has been released but JS still holds a reference.
 */
let databaseGeneration = 0;

/**
 * Returns the current database generation. Consumers can compare values across
 * calls to detect whether a reconnection occurred in between operations.
 */
export function getCurrentGeneration(): number {
  return databaseGeneration;
}

/**
 * Serializes write operations by chaining them onto a shared promise.
 * This prevents "database is locked" errors caused by concurrent writes.
 */
export async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  let error: any = undefined;
  const prev = writeQueue;
  writeQueue = prev.then(async () => {
    try {
      result = await fn();
    } catch (e) {
      error = e;
    }
  });
  await writeQueue;
  if (error !== undefined) throw error;
  return result;
}

/**
 * Retry wrapper for transient SQLite errors.
 * Retries up to `maxRetries` times with exponential backoff.
 * Handles both "database is locked" and "shared object already released" errors.
 * When a stale connection is detected, forces a full reconnection.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message ?? error ?? "");
      const isLocked = message.includes("database is locked") || message.includes("busy");
      const isStale = isStaleConnectionError(message);

      if (isLocked || isStale) {
        if (isStale) {
          console.warn(`[DB] Stale connection detected (attempt ${attempt + 1}/${maxRetries}):`, message);
          // Force reconnection by invalidating all cached state
          await forceReconnect();
        }
        const delay = Math.min(200 * Math.pow(2, attempt), 2000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Checks if an error message indicates a stale/corrupted native database handle
 * that has been released by the Android runtime (e.g. after hot reload).
 */
function isStaleConnectionError(message: string): boolean {
  const stalePatterns = [
    "shared object that was already released",
    "prepareAsync",
    "NativeStatement",
    "Cannot use shared object",
    "NativeDatabase.prepareAsync",
    "database handle is closed",
    "database connection closed",
  ];
  return stalePatterns.some((pattern) => message.includes(pattern));
}

/**
 * Forces a complete database reconnection by invalidating all cached state.
 * After this call, the next getDB()/initDB() call will open a fresh connection.
 */
export async function forceReconnect(): Promise<void> {
  // Close the current handle if still valid
  if (database) {
    try {
      await database.closeAsync();
    } catch {
      // Ignore close errors — the handle may already be released
    }
  }
  // Invalidate all cached state to force a fresh open on next access
  database = null;
  dbInitialized = false;
  initPromise = null;
  dbOpenPromise = null;
  databaseGeneration++;
}

/**
 * Returns the database instance, opening it if necessary.
 * Uses a shared promise (dbOpenPromise) to ensure only ONE call to
 * SQLite.openDatabaseAsync() is ever made concurrently — all concurrent
 * callers await the same promise, eliminating NullPointerException races.
 */
export async function getDB(): Promise<DB> {
  if (database) return database;

  if (!dbOpenPromise) {
    dbOpenPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);

      // Critical: Enable WAL mode for concurrent read/write support
      // WAL allows readers to proceed while a writer is active
      await db.execAsync("PRAGMA journal_mode=WAL;");

      // Wait up to 5 seconds for locks instead of failing immediately
      await db.execAsync("PRAGMA busy_timeout=5000;");

      // WAL mode performs best with NORMAL synchronous
      await db.execAsync("PRAGMA synchronous=NORMAL;");

      // 8MB page cache for better read performance
      await db.execAsync("PRAGMA cache_size=-8000;");

      // Store foreign keys enforcement
      await db.execAsync("PRAGMA foreign_keys=ON;");

      database = db;
      databaseGeneration++;
      return db;
    })();
  }

  return dbOpenPromise;
}

/**
 * Executes a database operation inside a retry wrapper that re-acquires the
 * DB connection on each attempt. This is essential for recovering from stale
 * native handles (e.g. after hot reload) — each retry calls getDB() fresh,
 * so after forceReconnect() invalidates the cached connection, the next
 * attempt opens a new one transparently.
 *
 * Usage:
 *   await withDB(async (db) => {
 *     return db.getFirstAsync(...);
 *   });
 */
export async function withDB<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const db = await getDB();
    return fn(db);
  });
}

/**
 * Close and release the database handle. Useful for cleanup on hot reload.
 * After calling this, the next getDB() call will open a fresh connection.
 */
export async function closeDB(): Promise<void> {
  if (database) {
    try {
      await database.closeAsync();
    } catch {
      // Ignore close errors
    }
    database = null;
    dbInitialized = false;
    initPromise = null;
    dbOpenPromise = null;
    databaseGeneration++;
  }
}

// Hot reload cleanup: ensure native handle is released when the module reloads
// in Expo's development environment, preventing stale native references.
try {
  const globalModule = (globalThis as any)?.module;
  if (globalModule?.hot) {
    globalModule.hot.dispose(() => {
      if (database) {
        try {
          database.closeAsync().catch(() => {});
        } catch {
          // Ignore close errors
        }
        database = null;
        dbInitialized = false;
        initPromise = null;
        dbOpenPromise = null;
        databaseGeneration++;
      }
    });
  }
} catch {
  // module.hot not available — not in dev mode
}

/**
 * Initialize the database schema (DDL) if not already done.
 * Uses a shared promise (initPromise) so that concurrent callers all await
 * the SAME initialization promise, preventing:
 *   1. Multiple CREATE TABLE statements racing each other
 *   2. Multiple openDatabaseAsync calls racing each other
 *   3. NullPointerException from NativeDatabase.prepareAsync
 */
export async function initDB(): Promise<void> {
  // Fast path: already initialized
  if (dbInitialized) return;

  // Deduplicate concurrent init calls via shared promise
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Double-check after acquiring the shared promise
    if (dbInitialized) return;

    const db = await getDB();

    try {
      // Use write lock + retry for DDL to prevent any possible lock contention
      await withWriteLock(() =>
        withRetry(async () => {
          await db.execAsync(`
            CREATE TABLE IF NOT EXISTS player_state (
              id INTEGER PRIMARY KEY NOT NULL DEFAULT 1,
              coins INTEGER NOT NULL DEFAULT 0,
              xp INTEGER NOT NULL DEFAULT 0,
              difficulty INTEGER NOT NULL DEFAULT 1,
              phase INTEGER NOT NULL DEFAULT 1,
              streak_days INTEGER NOT NULL DEFAULT 0,
              last_played_iso TEXT,
              updated_at_iso TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS risk_profile (
              player_id INTEGER PRIMARY KEY NOT NULL DEFAULT 1,
              phishing_score REAL NOT NULL DEFAULT 0,
              social_engineering_score REAL NOT NULL DEFAULT 0,
              financial_score REAL NOT NULL DEFAULT 0,
              identity_score REAL NOT NULL DEFAULT 0,
              password_score REAL NOT NULL DEFAULT 0,
              updated_at_iso TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS learning_memory (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              topic_key TEXT NOT NULL UNIQUE,
              mastery REAL NOT NULL DEFAULT 0,
              attempts INTEGER NOT NULL DEFAULT 0,
              successes INTEGER NOT NULL DEFAULT 0,
              weak INTEGER NOT NULL DEFAULT 0,
              updated_at_iso TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scenario_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              player_id INTEGER NOT NULL DEFAULT 1,
              scenario_id TEXT NOT NULL,
              result TEXT NOT NULL,
              reaction_time_ms INTEGER,
              mistakes INTEGER NOT NULL DEFAULT 0,
              created_at_iso TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS daily_progress (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              date_key TEXT NOT NULL UNIQUE,
              streak INTEGER NOT NULL DEFAULT 0,
              last_played_iso TEXT,
              rewarded_plays INTEGER NOT NULL DEFAULT 0,
              updated_at_iso TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY NOT NULL,
              value TEXT NOT NULL
            );
          `);

          // Add missing columns for older DBs (ignore errors if column already exists)
          try {
            await db.execAsync(`ALTER TABLE player_state ADD COLUMN phase INTEGER NOT NULL DEFAULT 1;`);
          } catch {
            // Column may already exist
          }

          try {
            await db.execAsync(`ALTER TABLE player_state ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0;`);
          } catch {
            // Column may already exist
          }

          try {
            await db.execAsync(`ALTER TABLE daily_progress ADD COLUMN rewarded_plays INTEGER NOT NULL DEFAULT 0;`);
          } catch {
            // Column may already exist
          }

          // Initialize default player state row
          await db.execAsync(`
            INSERT OR IGNORE INTO player_state
            (id, coins, xp, difficulty, phase, streak_days, updated_at_iso)
            VALUES
            (1, 0, 0, 1, 1, 0, CURRENT_TIMESTAMP);

            INSERT OR IGNORE INTO risk_profile
            (
              player_id,
              phishing_score,
              social_engineering_score,
              financial_score,
              identity_score,
              password_score,
              updated_at_iso
            )
            VALUES
            (1, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP);
          `);
        })
      );

      dbInitialized = true;
    } catch (error) {
      console.error("Database initialization failed:", error);
      initPromise = null; // Allow retry on next call
      throw error;
    }
  })();

  return initPromise;
}

// Issue #11 Fix: Persist dark mode setting
export async function getSetting(key: string): Promise<string | null> {
  try {
    await initDB();
    const row = await withDB((db) =>
      db.getFirstAsync<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = ?;`,
        [key]
      )
    );
    return row?.value ?? null;
  } catch (error) {
    console.error(`Failed to read setting "${key}":`, error);
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    await initDB();
    await withWriteLock(() =>
      withRetry(async () => {
        const db = await getDB();
        await db.runAsync(
          `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
          [key, value]
        );
      })
    );
  } catch (error) {
    console.error(`Failed to save setting "${key}":`, error);
  }
}

