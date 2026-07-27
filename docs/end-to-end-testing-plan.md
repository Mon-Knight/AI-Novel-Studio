# End-to-End Testing Plan

## Desktop baseline

`tests/e2e/app-start.spec.ts` verifies isolated Tauri startup, SQLite health, migration 026, and the required autonomous tables. The diagnostic command must report `schemaReady=true`, `foreignKeysEnabled=true`, and `latestMigrationId=026_expert_collaboration_logs`.

## Autonomous flow

1. Open `/novels/:id/autonomous-monitor`.
2. Create a pending job and verify it remains actionable after refresh.
3. Start, pause, resume and cancel the job; verify timestamps and audit rows.
4. Verify quality thresholds and action logs survive restart.

E2E mode uses the Mock Provider and the network guard. API-mode acceptance is a separate manual test with a user-provided key.
