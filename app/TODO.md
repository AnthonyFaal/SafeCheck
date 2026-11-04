# Fix: "Cannot use shared object that was already released" SQLite Error

## Steps

### Step 1: Update `src/storage/db.ts` - Add stale connection recovery
- [x] Add database generation counter and `getCurrentGeneration()` function
- [x] Extend `withRetry()` to handle "shared object already released" errors via `isStaleConnectionError()`
- [x] Add `forceReconnect()` to invalidate all cached state and force fresh connection
- [x] Add `withDB()` helper that re-acquires DB connection on each retry attempt
- [x] Add hot reload cleanup via `module.hot.dispose()`
- [x] Increment generation in `getDB()`, `closeDB()`, and `forceReconnect()`

### Step 2: Update repository files to use `withDB` for critical DB operations
- [x] Update `playerRepository.ts` to use `withDB` for read operations
- [x] Update `learningRepository.ts` to use `withDB` for read operations
- [x] Update `persistenceService.ts` - already uses `withRetry` inside `withWriteLock`

### Step 3: Verification
- [x] Verify TypeScript compiles without errors
- [ ] Verify the app runs without the error



